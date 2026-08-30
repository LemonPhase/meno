import {
  SESSION_MAX_AGE,
  isBadToken,
  sessionCookie,
  signIn,
  viewerFrom,
} from "@/lib/auth";

/** Who is reading — null when signed out. The shell's first question. */
export async function GET(request: Request) {
  return Response.json({ viewer: await viewerFrom(request) });
}

/** Sign in: trade the Google ID token for the httpOnly session cookie. */
export async function POST(request: Request) {
  let idToken: unknown;
  try {
    ({ idToken } = await request.json());
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof idToken !== "string" || idToken.trim() === "") {
    return Response.json({ error: "idToken is required" }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof signIn>>;
  try {
    result = await signIn(idToken.trim());
  } catch (error) {
    // Only a bad token is the browser's problem. Anything else is this
    // server's — most often a credential that can verify a token but not
    // mint a cookie — and answering 401 for it sends whoever is debugging
    // to look at the sign-in they just completed correctly.
    if (isBadToken(error)) {
      return Response.json({ error: "sign-in could not be verified" }, { status: 401 });
    }
    console.error("[auth] could not mint a session cookie:", error);
    return Response.json(
      { error: "sign-in is misconfigured on the server — see the server log" },
      { status: 500 },
    );
  }

  return Response.json(
    { viewer: result.viewer },
    { headers: { "Set-Cookie": sessionCookie(result.cookie, SESSION_MAX_AGE) } },
  );
}

/** Sign out: drop the cookie. */
export async function DELETE() {
  return Response.json(
    { viewer: null },
    { headers: { "Set-Cookie": sessionCookie("", 0) } },
  );
}
