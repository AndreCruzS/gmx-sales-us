import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "../context";
import { contextFor, useLocalStack } from "./it-helpers";

// The catalog lives in another project; the local stack has no credentials
// for it. The fold and the ranking are search.ts's own; here only its answers.
const cat = vi.hoisted(() => {
  const item = (sku: string, over: Record<string, unknown> = {}) => ({
    sku,
    randomLength: false,
    description: `Thermo Ash ${sku}`,
    species: "Thermo-Ash",
    profile: "Square",
    nominal_size: "5/4x6",
    base_uom: "PC",
    lf_per_piece: 16,
    piecesAvailable: 50,
    lfAvailable: 800,
    branches: 2,
    thermo: true,
    ...over,
  });
  return { on: true, items: [item("TA546-16"), item("TA546-RL", { randomLength: true, lf_per_piece: null })] };
});
vi.mock("@/lib/catalog/search", async (orig) => ({
  ...(await orig<typeof import("@/lib/catalog/search")>()),
  catalogConfigured: () => cat.on,
  catalogBySkus: async (skus: string[]) => ({
    items: cat.items.filter((i) => skus.some((s) => s.toUpperCase() === i.sku)),
    refreshedAt: null,
  }),
  searchCatalog: async () => ({ items: cat.items, refreshedAt: null }),
}));

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

  it("search_catalog answers with skus", async () => {
    const r = await q.searchCatalogTool(tj, { query: "thermo ash 5/4x6" });
    expect(text(r)).toContain("TA546-16");
    expect(text(r)).toContain("random length");
  });

  it("an unknown sku saves nothing", async () => {
    const before = sql(`select count(*) from opportunities where primary_account_id = '${accountId}'`);
    const r = await q.createQuote(tj, {
      account_id: accountId,
      lines: [
        { sku: "TA546-16", quantity: 10, unit: "PC" },
        { sku: "MADE-UP-9", quantity: 10, unit: "LF" },
      ],
      status: "x",
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("MADE-UP-9");
    expect(sql(`select count(*) from opportunities where primary_account_id = '${accountId}'`)).toBe(before);
  });

  it("with the catalog on, words alone are refused", async () => {
    const r = await q.createQuote(tj, { account_id: accountId, product: "Ipe", value: 100, status: "x" });
    expect(text(r)).toContain("search_catalog");
  });

  it("create_quote opens a quote from catalog lines, with its follow-up", async () => {
    const r = await q.createQuote(tj, {
      account_id: accountId,
      lines: [
        { sku: "ta546-16", quantity: 100, unit: "PC", price_per_lf: 4.25 }, // 1,600 LF → $6,800
        { sku: "TA546-RL", quantity: 400, unit: "LF", price_per_lf: 4.25 }, // $1,700
      ],
      status: "Priced, waiting on the buyer",
    });
    expect(r.isError).toBeFalsy();
    quoteId = (r.structuredContent as { id: string }).id;
    expect(text(r)).toContain("$8,500");
    expect(text(r)).toContain("100 PC = 1,600 LF");
    expect(text(r)).toContain(`/accounts/${accountId}`);
    const d = await read(tj);
    expect(d).toMatchObject({
      stage: "QUOTE",
      estimated_revenue: 8500,
      product: null,
      owner_id: tj.me.membershipId,
      current_status: "Priced, waiting on the buyer",
    });
    expect(d.name).toContain("Thermo-Ash 5/4x6 +1");
    expect(sql(`select string_agg(sku || ':' || input_uom || ':' || lf || ':' || price_per_lf, ',' order by sku) from quote_items where opportunity_id = '${quoteId}'`)).toBe(
      "TA546-16:PC:1600.00:4.25,TA546-RL:LF:400.00:4.25",
    );
    expect(sql(`select to_stage from opportunity_stage_events where opportunity_id = '${quoteId}'`)).toBe("QUOTE");
    expect(sql(`select kind || ' ' || (owner_id = '${tj.me.membershipId}') from next_actions where opportunity_id = '${quoteId}' and completed_at is null`)).toBe("QUOTE_FOLLOW_UP true");
  });

  it("a catalog quote's products are not overwritten by words", async () => {
    const d = await read(tj);
    const r = await q.updateQuote(tj, { id: quoteId, updated_at: d.updated_at, product: "Ipe" });
    expect(text(r)).toContain("catalog lines");
  });

  it("with no catalog connected, the product is taken in words", async () => {
    cat.on = false;
    try {
      const bad = await q.createQuote(tj, { account_id: accountId, product: "Ipe", price_per_lf: 9, status: "x" });
      expect(bad.isError).toBe(true);
      const r = await q.createQuote(tj, { account_id: accountId, product: "Ipe 1x6", quantity_lf: 100, price_per_lf: 9, status: "Sent" });
      expect(r.isError).toBeFalsy();
      const id = (r.structuredContent as { id: string }).id;
      expect(sql(`select product || ' ' || estimated_quantity || ' ' || estimated_revenue from opportunities where id = '${id}'`)).toBe("Ipe 1x6 100 900.00");
    } finally {
      cat.on = true;
    }
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
