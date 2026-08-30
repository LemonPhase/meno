FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
# NEXT_PUBLIC_* is inlined into the client bundle at build time, so the
# Firebase web config has to be here and not only in the runtime env — a
# build without it ships a page that cannot sign anybody in. Only these two
# matter: they are all Firebase Auth reads. Both are public identifiers
# (they name the project; they do not authorize anything).
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
# Missing, these do not fail the build — they inline as "" and produce a
# page that cannot sign anybody in, successfully. Nothing downstream
# notices: the image builds, the deploy goes green, and the smoke check
# passes because it asks a server route that never reads them. Fail here
# instead, where the unset variable is still the obvious cause.
RUN test -n "$NEXT_PUBLIC_FIREBASE_API_KEY" \
    && test -n "$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN" \
    || { echo "Missing Firebase web config: pass NEXT_PUBLIC_FIREBASE_API_KEY and" >&2; \
         echo "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN as --build-arg. In CI they come from" >&2; \
         echo "GitHub repo variables of the same name — see the README." >&2; \
         exit 1; }
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
