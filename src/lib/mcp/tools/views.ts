import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  buildDealerLines,
  lastVisitByAccount,
  openByAccount,
  type DealerAccountRef,
} from "@/lib/dealers-board";
import { tierDealers, untieredTargets } from "@/lib/domain/dealer-tiers";
import type { DealerItem } from "@/components/dealers-todos";
import {
  periodLabel,
  scopeVolume,
  yearSoFar,
  type SellThroughRow,
} from "@/lib/domain/sell-through";
import { fetchAllPages } from "@/lib/supabase/page";
import type { AgentContext } from "../context";
import { ok, type CallToolResult } from "../result";
import { tool, type GetCtx } from "../server";

export type DealersOverviewArgs = { territory?: string; limit?: number; offset?: number };
export type SalesSummaryArgs = { period?: "month" | "ytd"; distributor_id?: string };

// The same select lists the pages use, verbatim.
const SELL_COLS =
  "period, rep_id, rep_name, region_id, region_name, market_owner_name, distributor_id, distributor_name, branch_id, branch_name, branch_city, branch_state, dealer_id, dealer_name, dealer_label, product, quantity, unit, value, ly_quantity, period_kind, is_house_account, detail";
const ITEM_COLS =
  "id, action, due_date, owner_id, account_id, item_type, source, entered_by, completed_at, priority, account:accounts!next_actions_account_id_fkey(name), activity:activities!next_actions_activity_id_fkey(activity_type)";
const VISIT_TYPES = ["DEALER_VISIT", "DISTRIBUTOR_VISIT", "JOBSITE_VISIT", "PK_TRAINING"];

const isoOf = (d: Date) => d.toISOString().slice(0, 10);

function shiftMonth(period: string, by: number): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7)) - 1 + by;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/** The generated view types are looser than the app's row shape; the page reads them as SellThroughRow. */
const asRows = (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) =>
  q.then((r) => ({ data: r.data as SellThroughRow[] | null, error: r.error }));

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// ---- dealers_overview (app/dealers/page.tsx, same fetches and lines) -------

export async function dealersOverview(ctx: AgentContext, args: DealersOverviewArgs): Promise<CallToolResult> {
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(args.offset ?? 0), 0);
  const db = ctx.db;
  const now = new Date();
  const first = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const start = shiftMonth(first, -12);

  const [rows, accounts, items, visits] = await Promise.all([
    fetchAllPages<SellThroughRow>((from, to) =>
      asRows(db.from("sell_through_rows").select(SELL_COLS).gte("period", start).lt("period", first).order("period").order("row_id").range(from, to)),
    ),
    fetchAllPages<DealerAccountRef>((from, to) =>
      db.from("accounts").select("id, name, owner_id, territory_id").eq("account_type", "DEALER").order("id").range(from, to),
    ),
    fetchAllPages<DealerItem>((from, to) =>
      db
        .from("next_actions")
        .select(ITEM_COLS)
        .is("completed_at", null)
        .not("item_type", "is", null)
        .order("due_date")
        .order("id")
        .range(from, to)
        .then((r) => ({ data: r.data as unknown as DealerItem[] | null, error: r.error })),
    ),
    fetchAllPages<{ primary_account_id: string; occurred_at: string }>((from, to) =>
      db
        .from("activities")
        .select("primary_account_id, occurred_at")
        .in("activity_type", VISIT_TYPES as never)
        .lte("occurred_at", now.toISOString())
        .order("occurred_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
  ]);

  // Tiers are worked out from every dealer's sales: only an admin reads them all.
  const showTiers = ctx.me.role === "admin";
  const tiers = tierDealers(rows, first);
  const untiered = untieredTargets(accounts, tiers);
  const lines = buildDealerLines({
    tiers,
    untiered,
    accountById: new Map(accounts.map((a) => [a.id, a])),
    openBy: openByAccount(items, isoOf(now)),
    lastVisit: lastVisitByAccount(visits),
    showTiers,
  });
  const marketNames = new Map<string, string>();
  for (const r of rows) if (r.region_id && r.region_name) marketNames.set(r.region_id, r.region_name);

  const filtered = args.territory ? lines.filter((l) => l.market === args.territory) : lines;
  const page = filtered.slice(offset, offset + limit);
  const out = page.map((l) => ({
    name: l.name,
    account_id: l.accountId,
    market_id: l.market,
    market: marketNames.get(l.market) ?? null,
    tier: showTiers ? l.tier : null,
    open_items: l.open,
    late_items: l.late,
    last_visit: l.lastVisit,
    lf_last_12_months: Math.round(l.lf),
  }));
  if (out.length === 0) return ok("No dealers to show.", { dealers: [], total: filtered.length, offset, limit });
  const text = out
    .map(
      (d) =>
        `- ${d.name}${d.tier ? ` [${d.tier}]` : ""}: ${d.open_items} open, ${d.late_items} late, last visit ${d.last_visit ?? "never"}, ${QTY.format(d.lf_last_12_months)} LF in the last 12 months`,
    )
    .join("\n");
  const more = offset + out.length < filtered.length ? `\nMore: call again with offset ${offset + out.length}.` : "";
  return ok(`${filtered.length} dealers (showing ${out.length}):\n${text}${more}`, {
    dealers: out,
    total: filtered.length,
    offset,
    limit,
    window: `${shiftMonth(first, -12)} to ${shiftMonth(first, -1)}`,
  });
}

// ---- sales_summary (home/manager-home.tsx, same fetches and helpers) ------

const isLf = (r: SellThroughRow) => r.unit === null || r.unit.toUpperCase() === "LF";

export async function salesSummary(ctx: AgentContext, args: SalesSummaryArgs): Promise<CallToolResult> {
  const mode = args.period ?? "month";
  const db = ctx.db;
  const pv = await db.from("sell_through_periods").select("period, period_kind").limit(2000);
  if (pv.error) throw pv.error;
  const periodRows = pv.data ?? [];
  const months = [...new Set(periodRows.filter((r) => r.period_kind !== "YTD").map((r) => r.period))]
    .filter((m): m is string => m !== null)
    .sort()
    .reverse();
  const keep = (r: SellThroughRow) => (!args.distributor_id || r.distributor_id === args.distributor_id) && isLf(r);

  if (mode === "ytd") {
    const ytdPeriod =
      [...new Set(periodRows.filter((r) => r.period_kind === "YTD").map((r) => r.period))]
        .filter((m): m is string => m !== null)
        .sort()
        .reverse()[0] ?? null;
    if (!ytdPeriod) return ok("No year-to-date file has been loaded yet.", { period: "ytd", lf: null });
    const ytdRows = (
      await fetchAllPages<SellThroughRow>((from, to) =>
        asRows(db.from("sell_through_rows").select(SELL_COLS).eq("period_kind", "YTD").eq("period", ytdPeriod).order("row_id").range(from, to)),
      )
    ).filter(keep);
    const after = months.filter((m) => m > ytdPeriod && m.slice(0, 4) === ytdPeriod.slice(0, 4));
    const monthly =
      after.length > 0
        ? (
            await fetchAllPages<SellThroughRow>((from, to) =>
              asRows(
                db
                  .from("sell_through_rows")
                  .select(SELL_COLS)
                  .in("period", after)
                  .or("period_kind.eq.MONTH,period_kind.is.null")
                  .order("row_id")
                  .range(from, to),
              ),
            )
          ).filter(keep)
        : [];
    const year = yearSoFar(ytdRows, monthly);
    if (!year) return ok("No year-to-date file has been loaded yet.", { period: "ytd", lf: null });
    const lf = scopeVolume(year.current, []);
    const lastYear = year.previous ? scopeVolume(year.prior, []) : null;
    return ok(
      `Year to date through ${periodLabel(year.latest)}: ${QTY.format(lf)} LF sold through by the distributors${lastYear !== null ? `, against ${QTY.format(lastYear)} LF in the same window last year` : ""}. Sell-through arrives a month behind.`,
      { period: "ytd", through: year.latest, lf, last_year_lf: lastYear, unit: "LF" },
    );
  }

  const latest = months[0] ?? null;
  if (!latest) return ok("No monthly sell-through file has been loaded yet.", { period: "month", lf: null });
  const previous = months.find((m) => m < latest) ?? null;
  const wanted = [latest, previous].filter((p): p is string => p !== null);
  const rows = (
    await fetchAllPages<SellThroughRow>((from, to) =>
      asRows(
        db
          .from("sell_through_rows")
          .select(SELL_COLS)
          .in("period", wanted)
          .or("period_kind.eq.MONTH,period_kind.is.null")
          .order("row_id")
          .range(from, to),
      ),
    )
  ).filter(keep);
  const lf = scopeVolume(rows.filter((r) => r.period === latest), []);
  const before = previous ? scopeVolume(rows.filter((r) => r.period === previous), []) : null;
  return ok(
    `${periodLabel(latest)}: ${QTY.format(lf)} LF sold through by the distributors${before !== null ? `, against ${QTY.format(before)} LF in ${periodLabel(previous)}` : ""}. Sell-through arrives a month behind.`,
    { period: "month", month: latest, lf, previous_month: previous, previous_lf: before, unit: "LF" },
  );
}

// ---- routine_list (app/routine/page.tsx, same view, same order) -----------

export async function routineList(ctx: AgentContext): Promise<CallToolResult> {
  const { data, error } = await ctx.db
    .from("routine_items")
    .select("kind, item_id, org_id, owner_membership_id, account_id, account_name, action, context_date, due_date")
    .order("due_date")
    .limit(200);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return ok("The routine is clear: nothing is waiting.", { items: [] });
  const text = rows
    .map((r) => `- ${r.due_date}: ${r.action}${r.account_name ? ` (${r.account_name})` : ""} [${r.kind}] — id ${r.item_id}`)
    .join("\n");
  return ok(`${rows.length} routine item${rows.length === 1 ? "" : "s"}:\n${text}`, { items: rows });
}

// ---- registration ---------------------------------------------------------

export function registerViewTools(server: McpServer, getCtx: GetCtx) {
  server.registerTool(
    "dealers_overview",
    {
      title: "Dealers overview",
      description:
        "The Dealers board as a list: each dealer with its tier (admins only), open and late to-dos, last visit and LF in the last 12 months, ordered like the board. territory is a market id from a previous result. Pages of 50 (max 200): use offset for more. Read-only.",
      inputSchema: z.object({
        territory: z.string().optional().describe("Only this market (market_id from a previous result)"),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
    tool<DealersOverviewArgs>(getCtx, (ctx, a) => dealersOverview(ctx, a)),
  );

  server.registerTool(
    "sales_summary",
    {
      title: "Sales summary",
      description:
        "What the distributors sold through, in LF (linear feet, the one measure): the latest month with the month before it, or the year to date with the same window last year. Distributor files arrive a month behind. Optionally narrowed to one distributor. Read-only.",
      inputSchema: z.object({
        period: z.enum(["month", "ytd"]).optional().describe("Default: month"),
        distributor_id: z.string().uuid().optional(),
      }),
    },
    tool<SalesSummaryArgs>(getCtx, (ctx, a) => salesSummary(ctx, a)),
  );

  server.registerTool(
    "routine_list",
    {
      title: "The routine",
      description:
        "The routine list: sample and quote follow-ups and display checks that are waiting, by due date (at most 200). Read-only.",
      inputSchema: z.object({}),
    },
    tool<Record<string, never>>(getCtx, (ctx) => routineList(ctx)),
  );
}
