import { describe, expect, it } from "vitest";
import { agentSourceOf, isAllowedEmail, isKnownAgentRedirect } from "../auth";
import { checkConfirmation, confirmationReason, issueConfirmation } from "../confirm";
import { linkTo, receipt } from "../receipt";
import { fail, needsConfirmation, ok } from "../result";

const SECRET = "x".repeat(40);
const S = { userId: "u1", tool: "plan_follow_up", args: { a: 1, b: [1, 2] } };
const t0 = new Date("2026-11-04T10:00:00Z");
const plus = (min: number) => new Date(t0.getTime() + min * 60000);

describe("auth", () => {
  it("agentSourceOf", () => {
    expect(agentSourceOf("muse-id", "muse-id")).toBe("muse");
    expect(agentSourceOf("x", "muse-id")).toBe("claude");
    expect(agentSourceOf(undefined, undefined)).toBe("claude");
  });
  it("agentSourceOf takes a comma list (Muse re-registers on every reconnect)", () => {
    const l = " id-a , id-b,id-c ";
    expect(agentSourceOf("id-b", l)).toBe("muse");
    expect(agentSourceOf("id-c", l)).toBe("muse");
    expect(agentSourceOf("id-d", l)).toBe("claude");
    expect(agentSourceOf("", ",,")).toBe("claude");
  });
  it("isAllowedEmail", () => {
    const l = "andre.cruz@gmxgroup.com,bianca@gmxgroup.us";
    expect(isAllowedEmail("Bianca@GMXgroup.us", l)).toBe(true);
    expect(isAllowedEmail("tj@gmxgroup.com", l)).toBe(false);
    expect(isAllowedEmail(undefined, l)).toBe(false);
    expect(isAllowedEmail("a@b.c", "")).toBe(false);
    expect(isAllowedEmail("a@b.c", undefined)).toBe(false);
  });
});

describe("isKnownAgentRedirect", () => {
  it("accepts the known agents over https", () => {
    for (const u of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/cb",
      "https://muse.ai/oauth",
      "https://platform.muse.ai/oauth/callback?x=1",
      // Meta's Muse registered with this callback in prod (2026-11-05)
      "https://agent.meta.ai/api/hatch/oauth/callback",
    ])
      expect(isKnownAgentRedirect(u), u).toBe(true);
  });
  it("accepts localhost over http or https", () => {
    expect(isKnownAgentRedirect("http://localhost:6274/oauth/callback")).toBe(true);
    expect(isKnownAgentRedirect("http://127.0.0.1:33418/cb")).toBe(true);
  });
  it("refuses plain http for the public hosts", () => {
    expect(isKnownAgentRedirect("http://claude.ai/cb")).toBe(false);
  });
  it("refuses userinfo tricks, suffixes, lookalikes and junk", () => {
    for (const u of [
      "https://claude.ai@evil.com/cb",
      "https://claude.ai:pw@evil.com/cb",
      "https://claude.ai.evil.com/cb",
      "https://evilclaude.ai/cb",
      "https://evil.meta.ai/cb",
      "https://agent.meta.ai.evil.com/cb",
      "https://evil.com/?https://claude.ai",
      "https://evil.localhost/cb",
      "javascript:alert(1)",
      "claude.ai",
      "",
    ])
      expect(isKnownAgentRedirect(u), u).toBe(false);
    expect(isKnownAgentRedirect(undefined)).toBe(false);
    expect(isKnownAgentRedirect(null)).toBe(false);
  });
});

describe("confirm", () => {
  const { code, expiresAt } = issueConfirmation(S, t0, SECRET);
  it("valid within ttl", () => {
    expect(expiresAt).toBe(plus(5).toISOString());
    expect(checkConfirmation(code, S, plus(4), SECRET)).toBe(true);
  });
  it("expired", () => expect(checkConfirmation(code, S, plus(6), SECRET)).toBe(false));
  it("binds args, user, tool", () => {
    expect(checkConfirmation(code, { ...S, args: { a: 2 } }, plus(1), SECRET)).toBe(false);
    expect(checkConfirmation(code, { ...S, userId: "u2" }, plus(1), SECRET)).toBe(false);
    expect(checkConfirmation(code, { ...S, tool: "other" }, plus(1), SECRET)).toBe(false);
  });
  it("ignores confirmation key and key order", () => {
    expect(checkConfirmation(code, { ...S, args: { b: [1, 2], confirmation: code, a: 1 } }, plus(1), SECRET)).toBe(true);
  });
  it("malformed codes are false", () => {
    for (const c of ["", "abc", ".", "a.b.c", "!!!.@@@", "MQ."]) expect(checkConfirmation(c, S, plus(1), SECRET)).toBe(false);
  });
  it("weak secret", () => {
    expect(() => issueConfirmation(S, t0, "short")).toThrow(/MCP_CONFIRM_SECRET/);
    expect(checkConfirmation(code, S, plus(1), "short")).toBe(false);
  });
  it("confirmationReason", () => {
    const me = { membershipId: "A" };
    expect(confirmationReason("plan_follow_up", { owner_id: "B" }, me)).toMatch(/someone else/);
    expect(confirmationReason("plan_follow_up", { owner_id: "A" }, me)).toBeNull();
    expect(confirmationReason("plan_follow_up", { items: [1, 2, 3, 4, 5] }, me)).toMatch(/5 or more/);
    expect(confirmationReason("plan_follow_up", { items: [1, 2, 3, 4] }, me)).toBeNull();
    expect(confirmationReason("delete_visit", {}, me)).toMatch(/deletes/);
    expect(confirmationReason("set_territory_target", {}, me)).toMatch(/admin setting/);
  });
});

describe("receipt and result", () => {
  it("linkTo", () => {
    process.env.MCP_PUBLIC_ORIGIN = "https://sales.gmxgroup.com/";
    expect(linkTo("/visits/pk?item=1")).toBe("https://sales.gmxgroup.com/visits/pk?item=1");
    expect(linkTo("visits")).toBe("https://sales.gmxgroup.com/visits");
  });
  it("receipt", () => {
    process.env.MCP_PUBLIC_ORIGIN = "https://sales.gmxgroup.com";
    expect(receipt(["Done."], [{ id: "1", path: "/x" }])).toBe("Done.\nOpen: https://sales.gmxgroup.com/x");
  });
  it("results", () => {
    expect(ok("hi", { a: 1 }).structuredContent).toEqual({ a: 1 });
    expect(ok("hi", [1]).structuredContent).toEqual({ items: [1] });
    expect(ok("hi").structuredContent).toBeUndefined();
    expect(fail("no").isError).toBe(true);
    const n = needsConfirmation("P", "C", "E");
    expect(n.isError).toBeUndefined();
    expect(n.content[0].text).toContain('confirmation: "C"');
    expect(n.structuredContent).toEqual({ needs_confirmation: true, confirmation: "C", expires_at: "E" });
  });
});
