import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentContext } from "../context";
import { contextFor, useLocalStack } from "./it-helpers";

const run = Date.now().toString(36);
/** Independent truth: SQL straight into the local database container. */
const sql = (q: string) =>
  execFileSync("docker", ["exec", "supabase_db_gmx-sales-us", "psql", "-U", "postgres", "-tAc", q], { encoding: "utf8" }).trim();
const text = (r: { content: { text: string }[] }) => r.content[0].text;

describe.skipIf(!process.env.MCP_IT)("quotes through the agent (local stack)", () => {
  let admin: AgentContext;
  let tj: AgentContext;
  let q: typeof import("../tools/quotes");
  let a: typeof import("../tools/accounts");
  let u: typeof import("../tools/undo");
  let accountId = "";
  let quoteId = "";

  beforeAll(async () => {
    useLocalStack();
    q = await import("../tools/quotes");
    a = await import("../tools/accounts");
    u = await import("../tools/undo");
    admin = await contextFor("bianca@gmxgroup.com");
    tj = await contextFor("tj@gmxgroup.com");
    const r = await a.createAccount(tj, {
      name: `Quote Lumber ${run} Boise`,
      account_type: "DEALER",
      city: "Boise",
      state: "ID",
      lead_source: "COLD_OUTREACH",
    });
    accountId = (r.structuredContent as { id: string }).id;
  });

  const read = async (c: AgentContext) => {
    const { data } = await c.db.from("opportunities").select("*").eq("id", quoteId).single();
    return data!;
  };

  it("create_quote opens a priced quote with its follow-up", async () => {
    const r = await q.createQuote(tj, {
      account_id: accountId,
      product: "Thermo-Ash Decking 5/4x6",
      quantity_lf: 2000,
      price_per_lf: 4.25,
      status: "Priced, waiting on the buyer",
    });
    expect(r.isError).toBeFalsy();
    quoteId = (r.structuredContent as { id: string }).id;
    expect(text(r)).toContain("$8,500");
    expect(text(r)).toContain(`/accounts/${accountId}`);
    const d = await read(tj);
    expect(d).toMatchObject({
      stage: "QUOTE",
      estimated_revenue: 8500,
      product: "Thermo-Ash Decking 5/4x6",
      estimated_quantity: 2000,
      quantity_unit: "LF",
      owner_id: tj.me.membershipId,
      current_status: "Priced, waiting on the buyer",
    });
    expect(sql(`select to_stage from opportunity_stage_events where opportunity_id = '${quoteId}'`)).toBe("QUOTE");
    expect(sql(`select kind || ' ' || (owner_id = '${tj.me.membershipId}') from next_actions where opportunity_id = '${quoteId}' and completed_at is null`)).toBe("QUOTE_FOLLOW_UP true");
  });

  it("refuses a price with no quantity", async () => {
    const r = await q.createQuote(tj, { account_id: accountId, product: "Ipe", price_per_lf: 9, status: "x" });
    expect(r.isError).toBe(true);
  });

  it("update_quote refuses a stale read", async () => {
    const r = await q.updateQuote(tj, { id: quoteId, updated_at: "2020-01-01T00:00:00Z", stage: "WON" });
    expect(text(r)).toContain("changed since");
  });

  it("an admin changing tj's quote needs a yes", async () => {
    const d = await read(admin);
    const r = await q.updateQuote(admin, { id: quoteId, updated_at: d.updated_at, status: "Chasing" });
    expect(r.structuredContent).toMatchObject({ needs_confirmation: true });
    expect((await read(admin)).current_status).toBe("Priced, waiting on the buyer");
  });

  it("update_quote wins it, names the open follow-up, and undo puts it back", async () => {
    const d = await read(tj);
    const r = await q.updateQuote(tj, { id: quoteId, updated_at: d.updated_at, stage: "WON", value: 9000, status: "PO received" });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Still open on this quote");
    expect(await read(tj)).toMatchObject({ stage: "WON", estimated_revenue: 9000 });
    expect(sql(`select count(*) from opportunity_stage_events where opportunity_id = '${quoteId}' and to_stage = 'WON'`)).toBe("1");

    const s = await q.quoteSummaryTool(tj, {});
    expect(text(s)).toContain("$9,000");
    const sc = s.structuredContent as { won: number; closed_revenue: number };
    expect(sc.won).toBeGreaterThanOrEqual(1);

    const un = await u.undoLast(tj, {});
    expect(un.isError).toBeFalsy();
    expect(await read(tj)).toMatchObject({ stage: "QUOTE", estimated_revenue: 8500, current_status: "Priced, waiting on the buyer" });
  });

  it("an open stage with no follow-up gets one planned", async () => {
    sql(`update next_actions set completed_at = now() where opportunity_id = '${quoteId}'`);
    const d = await read(tj);
    const r = await q.updateQuote(tj, { id: quoteId, updated_at: d.updated_at, stage: "DECISION" });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("planned one");
    expect(sql(`select count(*) from next_actions where opportunity_id = '${quoteId}' and completed_at is null`)).toBe("1");
  });

  it("lost needs no follow-up and keeps the reason", async () => {
    const d = await read(tj);
    const r = await q.updateQuote(tj, { id: quoteId, updated_at: d.updated_at, stage: "LOST", reason: "Went with composite" });
    expect(r.isError).toBeFalsy();
    expect(await read(tj)).toMatchObject({ stage: "LOST", current_blocker: "Went with composite" });
  });

  it("quote_summary: the admin reads tj's board; get_account lists the quote", async () => {
    const s = await q.quoteSummaryTool(admin, { owner_id: tj.me.membershipId });
    expect(s.isError).toBeFalsy();
    expect(text(s)).toContain("Quotes on the platform");
    const g = await a.getAccount(tj, { id: accountId });
    expect(text(g)).toContain(quoteId);
  });
});
