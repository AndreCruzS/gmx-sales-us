import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL_ = "http://127.0.0.1:54341";
// Local-stack demo anon key (public, identical for every `supabase start`).
const ANON =
  process.env.MCP_IT_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

describe.skipIf(!process.env.MCP_IT)("agent token (local stack)", () => {
  let token = "";
  let verifyAgentToken: typeof import("../context").verifyAgentToken;
  let loadMe: typeof import("../context").loadMe;
  let dbForToken: typeof import("../context").dbForToken;
  const req = new Request("http://localhost/api/mcp");

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
    ({ verifyAgentToken, loadMe, dbForToken } = await import("../context"));
    const { data, error } = await createClient(URL_, ANON).auth.signInWithPassword({
      email: "tj@gmxgroup.com",
      password: "password123",
    });
    if (error) throw error;
    token = data.session!.access_token;
  });

  it("accepts any member, with no allow-list", async () => {
    delete process.env.MCP_ALLOWED_EMAILS;
    const info = await verifyAgentToken(req, token);
    expect(info?.token).toBe(token);
    expect((info?.extra?.claims as { email: string }).email).toBe("tj@gmxgroup.com");
  });
  it("refuses a signed-in person with no membership", async () => {
    const { contextFrom } = await import("../context");
    const stranger = `stranger-${Date.now()}@example.com`;
    const { data, error } = await createClient(URL_, ANON).auth.signUp({ email: stranger, password: "password123" });
    if (error) throw error;
    const info = await verifyAgentToken(req, data.session!.access_token);
    expect(info).toBeDefined();
    await expect(contextFrom(info!)).rejects.toThrow(/no active organisation/);
  });
  it("refuses garbage and missing tokens", async () => {
    expect(await verifyAgentToken(req, "garbage")).toBeUndefined();
    expect(await verifyAgentToken(req, undefined)).toBeUndefined();
  });
  it("loads tj as a rep of the seeded org", async () => {
    const info = await verifyAgentToken(req, token);
    const me = await loadMe(dbForToken(token), info!.extra!.claims as Record<string, unknown>);
    expect(me.role).toBe("rep");
    expect(me.orgId).toBe("11111111-1111-1111-1111-111111111111");
  });
});
