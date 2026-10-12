// THE OWNER'S KEY, RENEWED ON THE SERVER. The desk account that owns the team
// calendar granted the app once (/settings/google); Google handed back a
// refresh token that lives in google_connections. Every call to the calendar
// first turns that token into a short-lived access token here, with the
// OAuth client the login already uses (project gmx-sales-metrics).
//
// invalid_grant is the one failure with a human fix — the owner revoked the
// app, or the grant expired — so it is its own error and the sync surfaces
// it in words rather than retrying for ever.

export class GoogleReauthNeeded extends Error {
  constructor() {
    super("the calendar owner must reconnect Google");
    this.name = "GoogleReauthNeeded";
  }
}

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export function oauthClientFromEnv(): OAuthClient | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const cache = new Map<string, { token: string; expiresAt: number }>();

export async function accessTokenFromRefresh(
  client: OAuthClient,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const hit = cache.get(refreshToken);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (res.status === 400 && body.error === "invalid_grant") {
    cache.delete(refreshToken);
    throw new GoogleReauthNeeded();
  }
  if (!res.ok || !body.access_token) {
    throw new Error(`token ${res.status}: ${body.error ?? "no access_token"}`);
  }
  cache.set(refreshToken, {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  return body.access_token;
}
