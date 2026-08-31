#!/usr/bin/env bash
# Delete the Cloud Run services left behind by pull-request previews.
#
#   npm run previews                    # list what would go, delete nothing
#   npm run previews -- --apply         # delete the ones whose PR is closed
#   npm run previews -- --all --apply   # delete every preview, open or not
#
# The preview for a PR is normally deleted when the PR closes, by
# .github/workflows/preview-cleanup.yml. This is for the ones that workflow
# never got: previews from before it existed, a teardown that failed on a
# permission or a network blip, a PR closed while Actions was down. Nothing
# reports those — an orphan is a service nobody is looking at, still serving
# old code against the production Firestore — so this is the sweep.
#
# It only ever touches services carrying the meno-preview label AND named
# meno-pr-<number>. Production is neither, and no flag here can reach it.
#
# Project and region come from .env.local, the same file the app reads.
set -euo pipefail

cd "$(dirname "$0")/.."

apply=false
all=false
project="${GCP_PROJECT_ID:-}"
region="${GCP_REGION:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=true ;;
    --all) all=true ;;
    --project) project="$2"; shift ;;
    --region) region="$2"; shift ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

from_env_local() {
  sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"?([^\"#[:space:]]+)\"?.*/\1/p" \
    .env.local 2>/dev/null | tail -1
}
[ -n "$project" ] || project="$(from_env_local GCP_PROJECT_ID)"
# Not GCP_LOCATION: that one is "global", the Vertex endpoint, and Cloud Run
# has never heard of it. GCP_REGION is a repository variable rather than
# something .env.local usually carries, so the deploy's own region stands as
# the default.
[ -n "$region" ] || region="$(from_env_local GCP_REGION)"
[ -n "$region" ] || region="europe-west2"

if ! command -v gcloud > /dev/null; then
  echo "gcloud is not installed — this talks to Cloud Run and cannot work" >&2
  echo "without it. https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi
if [ -z "$project" ]; then
  echo "No project. Set GCP_PROJECT_ID in .env.local, or pass --project." >&2
  exit 1
fi

# Whether a PR is closed is a question only GitHub can answer. Without the
# CLI this can still list, and still delete with --all, but it cannot tell
# which ones are finished with.
knows_prs=false
if command -v gh > /dev/null && gh auth status > /dev/null 2>&1; then
  knows_prs=true
fi

echo "Project: $project · region: $region"
$apply || echo "Dry run — nothing will be deleted. Add --apply to delete."

services=$(gcloud run services list \
  --project "$project" --region "$region" \
  --filter "metadata.labels.meno-preview=true" \
  --format "value(metadata.name)")

if [ -z "$services" ]; then
  echo "No preview services."
  exit 0
fi

for service in $services; do
  # The label is the filter; the name is the second, independent guard.
  if ! printf '%s' "$service" | grep -qE '^meno-pr-[0-9]+$'; then
    echo "skip   $service — labelled a preview but not named like one"
    continue
  fi
  pr="${service#meno-pr-}"

  state="unknown"
  if $knows_prs; then
    state=$(gh pr view "$pr" --json state --jq '.state' 2>/dev/null || echo "unknown")
  fi
  if ! $all && [ "$state" != "CLOSED" ] && [ "$state" != "MERGED" ]; then
    case "$state" in
      OPEN) echo "keep   $service — PR #$pr is still open" ;;
      *) echo "keep   $service — cannot tell what PR #$pr is doing (gh not signed in; --all overrides)" ;;
    esac
    continue
  fi

  if ! $apply; then
    echo "would delete  $service (PR #$pr is $state)"
    continue
  fi

  url=$(gcloud run services describe "$service" \
    --project "$project" --region "$region" \
    --format "value(status.url)" 2>/dev/null || true)
  gcloud run services delete "$service" \
    --project "$project" --region "$region" --quiet
  echo "deleted  $service"

  # Its images are worth going too: a preview builds one per push, and they
  # are the part of this that actually costs money once nobody is serving.
  repo="$region-docker.pkg.dev/$project/meno/meno"
  for tag in $(gcloud artifacts docker tags list "$repo" \
      --project "$project" --format "value(tag)" 2>/dev/null \
      | grep -E "(^|/)pr-$pr-" || true); do
    gcloud artifacts docker images delete "$repo:${tag##*/}" \
      --project "$project" --delete-tags --quiet > /dev/null 2>&1 \
      || echo "         (could not delete image $tag)"
  done

  # And the sign-in domain, if this project ever got one added: the deploy
  # adds the preview's host to Firebase Auth, so a stale one should not
  # outlive the service. Quiet when the permission is not there — that is
  # the same case as its never having been added.
  if [ -n "$url" ]; then
    host="${url#https://}"
    api="https://identitytoolkit.googleapis.com/admin/v2/projects/$project/config"
    token=$(gcloud auth print-access-token 2>/dev/null || true)
    if [ -n "$token" ] && command -v jq > /dev/null; then
      current=$(curl -sf -H "Authorization: Bearer $token" "$api" \
        | jq -c '.authorizedDomains // []' 2>/dev/null || true)
      if [ -n "$current" ] && echo "$current" | jq -e --arg h "$host" 'index($h)' > /dev/null; then
        body=$(echo "$current" | jq -c --arg h "$host" '{authorizedDomains: (. - [$h])}')
        curl -sf -X PATCH -H "Authorization: Bearer $token" \
          -H "Content-Type: application/json" \
          "$api?updateMask=authorizedDomains" -d "$body" > /dev/null \
          && echo "         un-authorized $host" \
          || echo "         (could not un-authorize $host)"
      fi
    fi
  fi
done
