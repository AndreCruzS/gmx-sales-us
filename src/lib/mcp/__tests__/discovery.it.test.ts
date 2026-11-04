import { beforeAll, describe, expect, it } from "vitest";
import type { AgentContext } from "../context";
import { contextFor, useLocalStack } from "./it-helpers";

describe.skipIf(!process.env.MCP_IT)("discovery tools (local stack)", () => {
  let tj: AgentContext;
  let admin: AgentContext;
  let t: typeof import("../tools/discovery");

  beforeAll(async () => {
    useLocalStack();
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
