/**
 * Which Session a request is about. Sessions run concurrently, so every
 * mutating route takes one — by `sessionId` in the body or `?session=` in
 * the URL. Omitted, it means the Session the app opens on.
 */
export function sessionIdFrom(
  request?: Request,
  body?: Record<string, unknown>,
): string | undefined {
  const fromBody = body?.sessionId;
  if (typeof fromBody === "string" && fromBody !== "") return fromBody;
  if (!request) return undefined;
  try {
    return new URL(request.url).searchParams.get("session") ?? undefined;
  } catch {
    return undefined;
  }
}
