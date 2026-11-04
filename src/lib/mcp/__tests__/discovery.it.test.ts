import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { AgentContext } from "../context";

const URL_ = "http://127.0.0.1:54341";
// Local-stack demo anon key (public, identical for every `supabase start`).
const ANON =
  process.env.MCP_IT_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

async function contextFor(email: string): Promise<AgentContext> {
  process.env.MCP_ALLOWED_EMAILS = email;
  const { verifyAgentToken, contextFrom } = await import("../context");
  const { data, error } = await createClient(URL_, ANON).auth.signInWithPassword({ email, password: "password123" });
  if (error) throw error;
  const info = await verifyAgentToken(new Request("http://localhost/api/mcp"), data.session!.access_token);
  return contextFrom(info!);
}

describe.skipIf(!process.env.MCP_IT)("discovery tools (local stack)", () => {
  let tj: AgentContext;
  let admin: AgentContext;
  let t: typeof import("../tools/discovery");

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
    t = await import("../tools/discovery");
    tj = await contextFor("tj@gmxgroup.com");
    admin = await contextFor("bianca@gmxgroup.com");
  });

  it("about_me names the role, organisation and today", async () => {
    const r = await t.aboutMe(tj);
    expect(r.isError).toBeFalsy();
    const d = r.structuredContent as Record<string, string>;
    expect(d.role).toBe("rep");
    expect(d.email).toBe("tj@gmxgroup.com");
    expect(d.organisation).toBeTruthy();
    expect(d.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.weekday).toMatch(/day$/);
    expect(d.agent).toBe("claude");
  });

  it("find returns every branch of a banner", async () => {
    // tj may not see the Ganahl banner (CA territory); fall back to the admin.
    let ctx = tj;
    let r = await t.find(ctx, { query: "Ganahl", kind: "account" });
    let items = (r.structuredContent?.items ?? []) as { name: string; city: string | null }[];
    if (items.length < 2) {
      ctx = admin;
      r = await t.find(ctx, { query: "Ganahl", kind: "account" });
      items = (r.structuredContent?.items ?? []) as { name: string; city: string | null }[];
    }
    const names = items.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(["Ganahl Anaheim", "Ganahl Buena Park", "Ganahl Corona"]));
    expect(items.find((i) => i.name === "Ganahl Anaheim")?.city).toBe("Anaheim");
    expect(items.find((i) => i.name === "Ganahl Buena Park")?.city).toBe("Buena Park");
    expect(r.content[0].text).toContain("ask the person which one");
  });

  it("find honours the limit and escapes wildcards", async () => {
    const r = await t.find(admin, { query: "Ganahl", kind: "account", limit: 2 });
    expect((r.structuredContent?.items as unknown[]).length).toBe(2);
    const w = await t.find(admin, { query: "%", kind: "account" });
    expect(w.content[0].text).toMatch(/Nothing matches/);
  });

  it("find finds people", async () => {
    const r = await t.find(admin, { query: "tj", kind: "person" });
    const items = (r.structuredContent?.items ?? []) as { kind: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].kind).toBe("person");
  });

  it("platform_guide returns the guide", async () => {
    const r = await t.platformGuide();
    expect(r.content[0].text).toContain("Do now 1");
  });
});
