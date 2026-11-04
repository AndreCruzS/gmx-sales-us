import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { AgentAuthError } from "../auth";
import { contextFrom, loadMe } from "../context";

function stub(tables: Record<string, unknown>): SupabaseClient<Database> {
  return {
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: tables[t] ?? null, error: null });
      return q;
    },
  } as unknown as SupabaseClient<Database>;
}

const claims = { sub: "u1", org_id: "o1", email: "a@b.com" };

describe("loadMe", () => {
  it("rejects a token without org_id", async () => {
    const err = await loadMe(stub({}), { sub: "u1" }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentAuthError);
    expect(err.message).toBe("Your GMX Sales account has no active organisation.");
  });
  it("rejects when there is no active membership", async () => {
    await expect(loadMe(stub({}), claims)).rejects.toThrow("no active organisation");
  });
  it("returns Me with the membership role", async () => {
    const me = await loadMe(
      stub({
        memberships: { id: "m1", role: "manager", territories: { name: "West" } },
        users: { email: "a@b.com", full_name: null },
      }),
      claims,
    );
    expect(me).toMatchObject({
      userId: "u1", membershipId: "m1", orgId: "o1", role: "manager",
      name: "a@b.com", timeZone: "America/Los_Angeles", territory: "West",
    });
  });
});

describe("contextFrom", () => {
  it("requires a session", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "x";
    await expect(
      contextFrom({ token: "t", clientId: "", scopes: [], extra: { claims } }),
    ).rejects.toThrow("no session");
  });
});
