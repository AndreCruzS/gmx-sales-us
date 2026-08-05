// Shared JWT-claim reader for routes that need the caller's active org
// without a round trip: Supabase mints `org_id` into the access token
// (see the custom access-token hook), so a route can read it straight off
// the JWT payload instead of joining through `memberships` first.

/** Decodes the org_id claim out of a Supabase access token. Returns null on
 *  a missing/malformed token or a token with no org_id claim rather than
 *  throwing — callers treat both as "no active org". */
export function orgIdFromJwt(token: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    return payload.org_id ?? null;
  } catch {
    return null;
  }
}
