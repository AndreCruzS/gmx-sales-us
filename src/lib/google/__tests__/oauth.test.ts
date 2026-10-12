// The owner's refresh token becomes an access token on the server, with the
// OAuth client the login already uses. invalid_grant is the one failure a
// person fixes (reconnect), so it is its own error.

import { describe, expect, it, vi } from "vitest";
import { accessTokenFromRefresh, GoogleReauthNeeded } from "../oauth";

const CLIENT = { clientId: "id", clientSecret: "secret" };

function fetchReturning(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

function calls(f: typeof fetch): [string, RequestInit][] {
  return (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
}

describe("accessTokenFromRefresh", () => {
  it("posts the refresh grant and returns the access token", async () => {
    const f = fetchReturning(200, { access_token: "ya29.x", expires_in: 3599 });
    const tok = await accessTokenFromRefresh(CLIENT, "r1", f);
    expect(tok).toBe("ya29.x");
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("refresh_token=r1");
    expect(String(init.body)).toContain("client_secret=secret");
  });

  it("caches by refresh token until close to expiry", async () => {
    const f = fetchReturning(200, { access_token: "ya29.y", expires_in: 3599 });
    await accessTokenFromRefresh(CLIENT, "r2", f);
    await accessTokenFromRefresh(CLIENT, "r2", f);
    expect(calls(f).length).toBe(1);
  });

  it("throws GoogleReauthNeeded on invalid_grant", async () => {
    const f = fetchReturning(400, { error: "invalid_grant" });
    await expect(accessTokenFromRefresh(CLIENT, "r3", f)).rejects.toBeInstanceOf(
      GoogleReauthNeeded,
    );
  });

  it("throws a plain Error on any other failure", async () => {
    const f = fetchReturning(500, { error: "boom" });
    await expect(accessTokenFromRefresh(CLIENT, "r4", f)).rejects.toThrow(/token 500/);
  });
});
