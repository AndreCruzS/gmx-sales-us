import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { configuredOrigin, mcpResourceUrl } from "../metadata";
import { logActionQuiet, NO_UNDO } from "../actions-log";
import { changes } from "../receipt";
import { tool } from "../server";
import { gate } from "../tools/shared";
import type { AgentContext } from "../context";

const ctx = { me: { userId: "u1", membershipId: "m1" } } as unknown as AgentContext;
const run = (fn: () => Promise<unknown>) => tool<object>(async () => ctx, fn as never)({}, {});

describe("tool() error mapping", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a schema error names the field and the first problem", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await run(async () => z.object({ due_date: z.string().regex(/^\d{4}$/, "must be a year") }).parse({ due_date: "x" }));
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("due_date: must be a year");
  });

  it("an invalid date reads as plain English with the ISO example", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await run(async () => new Date("not a date").toISOString());
    expect(r.content[0].text).toContain("use ISO 8601 with the UTC offset, e.g. 2026-11-04T18:30:00-08:00");
  });

  it("an invalid time zone has its own sentence", async () => {
    const r = await run(async () => new Intl.DateTimeFormat("en-US", { timeZone: "Mars/Base" }));
    expect(r.content[0].text).toContain("IANA name");
  });

  it("anything else is still the generic message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await run(async () => {
      throw new Error("boom");
    });
    expect(r.content[0].text).toBe("Something went wrong on GMX Sales — try again.");
  });
});

describe("the confirmation gate without its secret", () => {
  it("says confirmations aren't set up instead of 'try again'", () => {
    const saved = process.env.MCP_CONFIRM_SECRET;
    process.env.MCP_CONFIRM_SECRET = "short";
    try {
      const r = gate(ctx, "plan_follow_up", { owner_id: "other" }, () => "x");
      expect(r?.isError).toBe(true);
      expect(r?.content[0].text).toBe("Confirmations aren't set up on the server yet — tell Andre.");
    } finally {
      if (saved === undefined) delete process.env.MCP_CONFIRM_SECRET;
      else process.env.MCP_CONFIRM_SECRET = saved;
    }
  });
});

describe("public origin", () => {
  it("strips trailing slashes, and an unset or blank value is undefined", () => {
    expect(configuredOrigin("https://sales.gmxgroup.com/")).toBe("https://sales.gmxgroup.com");
    expect(configuredOrigin("https://sales.gmxgroup.com//")).toBe("https://sales.gmxgroup.com");
    expect(configuredOrigin("  ")).toBeUndefined();
    expect(configuredOrigin(undefined)).toBeUndefined();
  });
  it("the resource url agrees with the route's origin", () => {
    const saved = process.env.MCP_PUBLIC_ORIGIN;
    process.env.MCP_PUBLIC_ORIGIN = "https://sales.gmxgroup.com/";
    try {
      expect(mcpResourceUrl(new Request("http://localhost/x"))).toBe("https://sales.gmxgroup.com/api/mcp");
    } finally {
      if (saved === undefined) delete process.env.MCP_PUBLIC_ORIGIN;
      else process.env.MCP_PUBLIC_ORIGIN = saved;
    }
  });
});

describe("receipt changes", () => {
  it("echoes old → new for the patched fields", () => {
    expect(changes({ due_date: "2026-12-04", completed_at: null, action: null }, { due_date: "2026-12-05", completed_at: "2026-11-04T10:00:00Z", action: "Call" })).toBe(
      "due_date: 2026-12-04 → 2026-12-05; completed_at: open → done; action: empty → Call",
    );
  });
});

describe("a log failure after a successful write", () => {
  it("is a note about undo, never an error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = {
      sessionId: "s",
      via: "claude",
      db: { from: () => ({ insert: async () => ({ error: new Error("log table down") }) }) },
    } as unknown as AgentContext;
    expect(await logActionQuiet(failing, { tool: "t", entity: "next_actions", entityId: "i", op: "create" })).toBe(NO_UNDO);
    const fine = { ...failing, db: { from: () => ({ insert: async () => ({ error: null }) }) } } as unknown as AgentContext;
    expect(await logActionQuiet(fine, { tool: "t", entity: "next_actions", entityId: "i", op: "create" })).toBeNull();
  });
});

describe("dbId", () => {
  it("accepts the seeded ids prod still has (Russin is d0000000-…-0007)", async () => {
    const { dbId } = await import("../tools/shared");
    expect(dbId().safeParse("d0000000-0000-0000-0000-000000000007").success).toBe(true);
    expect(dbId().safeParse("6AA2F0CE-CB6D-4F4D-878A-EDF342950B7F").success).toBe(true);
    for (const bad of ["", "Russin", "d0000000-0000-0000-0000-00000000000", "d0000000000000000000000000000007"])
      expect(dbId().safeParse(bad).success, bad).toBe(false);
  });
});
