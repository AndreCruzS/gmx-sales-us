// Service-account token exchange (spec §6): sign a JWT with the SA key,
// optionally impersonating a mailbox via `sub` (domain-wide delegation).
// Gmail reads AS the rep (sub = mailbox); Calendar acts as the SA itself —
// it owns the rep calendars and shares them by ACL.

import { SignJWT, importPKCS8 } from "jose";

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

const cache = new Map<string, { token: string; expiresAt: number }>();

export async function serviceAccountToken(
  key: ServiceAccountKey,
  scope: string,
  subject?: string,
): Promise<string> {
  const cacheKey = `${scope}::${subject ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const pk = await importPKCS8(key.private_key, "RS256");
  let jwt = new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(key.client_email)
    .setAudience(key.token_uri)
    .setIssuedAt()
    .setExpirationTime("1h");
  if (subject) jwt = jwt.setSubject(subject);
  const assertion = await jwt.sign(pk);

  const res = await fetch(key.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  });
  return body.access_token;
}
