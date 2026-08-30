import { getAuth } from "firebase-admin/auth";
import { adminApp } from "./firebase-admin";
import type { Viewer } from "./types";

/**
 * Identity. The browser signs in with Google (Firebase Auth), posts the ID
 * token to /api/auth/session once, and gets back an httpOnly session cookie
 * — so every fetch the app already makes carries the reader, and no call
 * site has to remember to attach a token.
 *
 * The uid *is* the graphId: `graphs/{uid}` (ADR-0002, one Graph per user).
 * Scoping is therefore structural — a request cannot name another user's
 * Session, because it never reaches their subtree.
 *
 * The uid is read off the Request rather than Next's ambient `cookies()`:
 * the tests call route handlers as plain functions with a hand-built
 * Request, where there is no request context for `cookies()` to find.
 */

export const SESSION_COOKIE = "meno_session";

/** Firebase caps session cookies at 14 days; take all of it. */
export const SESSION_MAX_AGE = 14 * 24 * 60 * 60;

/**
 * MENO_AUTH=scripted takes the cookie at face value as the uid — the same
 * seam MENO_MODEL=scripted opens for the model, and for the same reason:
 * the tests, and interface work that shouldn't need Firebase Auth
 * configured. It is a hole in the front door, so it is barred in production.
 */
const scripted = process.env.MENO_AUTH === "scripted";
if (scripted && process.env.NODE_ENV === "production") {
  throw new Error(
    "MENO_AUTH=scripted accepts any uid without verification and must never " +
      "run in production. Unset it.",
  );
}

/** One named cookie off a request, without pulling in a cookie parser. */
export function readCookie(
  request: Request | undefined,
  name: string,
): string | null {
  const header = request?.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // A cookie we cannot even decode is one we could never trust. It has
      // to read as signed out: this runs before viewerFrom's try, so
      // letting URIError escape 500s every route that reads a cookie.
      return null;
    }
  }
  return null;
}

/** Who is reading, or null when signed out. */
export async function viewerFrom(request?: Request): Promise<Viewer | null> {
  const cookie = readCookie(request, SESSION_COOKIE);
  if (!cookie) return null;
  if (scripted) return { uid: cookie, name: cookie, email: null };
  try {
    // Not checkRevoked: that costs a round trip to Google on every single
    // request. The cookie's own expiry is the bound, and signing out drops it.
    const claims = await getAuth(adminApp).verifySessionCookie(cookie);
    return {
      uid: claims.uid,
      name: typeof claims.name === "string" ? claims.name : null,
      email: claims.email ?? null,
    };
  } catch (error) {
    // Expired, revoked or forged all read the same from here: signed out.
    // Anything else is this server failing to *ask* — the keys fetch, most
    // likely — and quietly signing everyone out is how an outage looks like
    // a login bug for as long as nobody reads a log.
    if (!isBadToken(error)) {
      console.error("[auth] could not verify the session cookie:", error);
    }
    return null;
  }
}

/** The Graph this request may touch, or null when signed out. */
export async function graphIdFrom(request?: Request): Promise<string | null> {
  return (await viewerFrom(request))?.uid ?? null;
}

export function unauthorized(): Response {
  return Response.json({ error: "sign in required" }, { status: 401 });
}

/**
 * Codes that mean the *token* was bad — the only ones the browser can do
 * anything about. Everything else (a missing credential, a denied Identity
 * Toolkit call) is the server being misconfigured, and reporting that as
 * "your sign-in failed" sends whoever is debugging it to the wrong place.
 */
const BAD_TOKEN = new Set([
  "auth/argument-error",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/invalid-id-token",
  "auth/user-disabled",
  "auth/user-not-found",
  // The session cookie rejects under its own names, on the read path.
  "auth/invalid-session-cookie",
  "auth/session-cookie-expired",
  "auth/session-cookie-revoked",
]);

export function isBadToken(error: unknown): boolean {
  return BAD_TOKEN.has((error as { code?: string })?.code ?? "");
}

/**
 * Trade a Google ID token for a session cookie. The ID token is verified
 * first so a bad one fails here, plainly, rather than inside the mint.
 *
 * The two calls do NOT need the same credentials, which is worth knowing
 * when this breaks: `verifyIdToken` only fetches Google's public signing
 * keys and needs none, while `createSessionCookie` is an authenticated call
 * to the Identity Toolkit that Google will not accept end-user credentials
 * for. So `gcloud auth application-default login` is enough to run the rest
 * of Meno locally and *not* enough to sign in — that combination fails only
 * on the mint, with everything either side of it working.
 */
export async function signIn(
  idToken: string,
): Promise<{ viewer: Viewer; cookie: string }> {
  if (scripted) {
    return {
      viewer: { uid: idToken, name: idToken, email: null },
      cookie: idToken,
    };
  }
  const auth = getAuth(adminApp);
  const claims = await auth.verifyIdToken(idToken);
  const cookie = await auth.createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE * 1000,
  });
  return {
    viewer: {
      uid: claims.uid,
      name: typeof claims.name === "string" ? claims.name : null,
      email: claims.email ?? null,
    },
    cookie,
  };
}

/** `Set-Cookie` for the session; maxAge 0 clears it. */
export function sessionCookie(value: string, maxAge: number): string {
  const attrs = [
    `${SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  // Cloud Run is https; localhost is not, and Secure would drop the cookie.
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}
