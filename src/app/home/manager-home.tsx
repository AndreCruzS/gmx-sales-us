"use client";

// Home, for someone who manages the day rather than lives it.
//
// Bianca was being shown a rep's app with her name on it: a route she does not
// walk, "2 visits left this week" counted across other people's diaries, and a
// Done button on Deon's stop. RLS was right — an admin sees the org — but the
// screen was written in the first person and never asked who was reading it.
//
// So she gets her own: the team first, because a manager opens the app to find
// out who needs them; then what is slipping; then how far the dealers have got.
// The deeper tables stay on Insights — this is the landing, not the report.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { groupByRep, latestStartedWeek, type ChannelRow } from "@/lib/domain/channel";
import { ManagerHomeSkeleton } from "./home-skeleton";
import { TeamSales, type Focus } from "@/components/team-sales";
import {
  latestPeriods,
  movementLabel,
  periodLabel,
  type BranchRef,
  type PathStep,
  type SellLens,
  type SellThroughRow,
} from "@/lib/domain/sell-through";
import { useTween } from "@/lib/ui/use-tween";
import { MonthByMonth, type WonMonthRow } from "@/components/month-by-month";
import { RolloutTimeline } from "@/components/rollout-timeline";
import type { PkAccount, RolloutCounts } from "@/lib/domain/rollout";
import { formatMoney } from "@/lib/format";

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
import { DANGER_EXCEPTIONS, exceptionLabel } from "@/lib/domain/exceptions";
import { teamNarrative } from "@/lib/domain/team";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ScorecardRow {
  membership_id: string;
  rep_name: string;
  territory_name: string | null;
}
interface ExceptionRow {
  exception_type: string | null;
  owner_membership_id: string | null;
  subject_id: string | null;
  /** The subject's name — an exception is always ABOUT somebody. */
  title: string | null;
}
interface PipelineRow {
  stage: string;
  opportunity_count: number;
  total_value: number;
}
// One branch's own gates, for when the screen is answering for one customer
// rather than for the book — and, since the PK unfold, for the book itself:
// the general counts are summed from these rows so the three-gate reading and
// the class counts come from one query instead of two answers that can drift.
interface BranchRow {
  account_id: string;
  org_id: string;
  name: string;
  pk_state: string;
  merchandiser_state: string;
  display_wall_state: string;
  material_state: string;
  pk_count: number;
}

// Our sell-out, read light: the Overview needs money and status, never the
// item lists — those live on /orders.
interface SellOutOrder {
  customer_id: string | null;
  status: string;
  total_value: number | null;
  order_date_po: string | null;
  created_at: string | null;
  archived_at: string | null;
}
interface OrderLinkRow {
  customer_id: string;
  account_id: string;
  accounts: { name: string } | null;
}
interface HouseReturnRow {
  distributor_id: string | null;
  period: string;
  period_kind: "MONTH" | "YTD" | null;
}

// THE LAW (Andre, 2026-09-03): only an invoiced order is a sale. Everything
// else is material in motion — visible, never revenue.
const INVOICED_STATUSES = new Set(["Invoice_Sent", "Completed"]);

function greeting(hour: number | null): string {
  if (hour === null) return "Hello";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function ManagerHome({ name }: { name: string }) {
  const { profile, status } = useOffline();

  const [channel, setChannel] = useState<ChannelRow[]>([]);
  const [scorecard, setScorecard] = useState<ScorecardRow[]>([]);
  const [slipping, setSlipping] = useState<ExceptionRow[]>([]);
  const [wonMonths, setWonMonths] = useState<WonMonthRow[]>([]);
  const [pipeline, setPipeline] = useState<PipelineRow[]>([]);
  const [sellRows, setSellRows] = useState<SellThroughRow[]>([]);
  // Every month the book holds, newest first — the masthead's period picker.
  // The picked month is a REQUEST: load() honours it while it exists and
  // falls back to the newest when it doesn't (a removed upload, say).
  const [months, setMonths] = useState<string[]>([]);
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  const [sellBranches, setSellBranches] = useState<BranchRef[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  // The synced order book, read light, plus who each customer is and which
  // houses have ever sent their return — the sell-out tiles and the
  // return-chasing read are built from these three.
  const [sellOut, setSellOut] = useState<SellOutOrder[]>([]);
  const [orderLinks, setOrderLinks] = useState<OrderLinkRow[]>([]);
  const [houseReturns, setHouseReturns] = useState<HouseReturnRow[]>([]);
  const [focus, setFocus] = useState<Focus | null>(null);
  // The walk down the chain lives here, not in the section: "Show all" has to
  // undo where you are as well as what the page is answering for.
  const [path, setPath] = useState<PathStep[]>([]);
  // Which lens the sales card is being read through. Lifted for one reason:
  // the rollout book answers for REPS — under Region or Distribution it is a
  // list about people nobody on the screen is asking about (João, 2026-08-28).
  const [salesLens, setSalesLens] = useState<SellLens>("region");
  // And which window: the footnote and the quiet ranking answer for the same
  // reading the card is giving, month or year-so-far.
  const [salesMode, setSalesMode] = useState<"month" | "ytd">("month");
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  // Set when the load did not come back at all. Distinct from "every query
  // errored", which load() already absorbs into empty lists — this is the case
  // where there was no answer to absorb, and it is the difference between a page
  // that can honestly show nothing and a page that must say why.
  const [loadFailed, setLoadFailed] = useState(false);
  const [hour, setHour] = useState<number | null>(null);

  // The clock is an external system; stamped once, never read during a render.
  useEffect(() => {
    const t = setTimeout(() => setHour(new Date().getHours()), 0);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    // WHICH months exist, before fetching any of them. The old shape — rows
    // newest-first under a blind limit(2000) — held the whole book while the
    // book was one distributor and two files, but five distributors sending
    // months would hit the cap MID-PERIOD and silently corrupt even the
    // latest reading. The periods view is a handful of rows per month; the
    // row fetches below then name their periods exactly.
    const pv = await supabase
      .from("sell_through_periods")
      .select("period, period_kind")
      .limit(2000);
    const periodRows =
      (pv.data as { period: string; period_kind: "MONTH" | "YTD" | null }[] | null) ?? [];
    const monthsAvail = [
      ...new Set(
        periodRows.filter((r) => r.period_kind !== "YTD").map((r) => r.period),
      ),
    ]
      .sort()
      .reverse();
    // The month being read: the chosen one while it still exists, else the
    // newest. Its comparison month is the previous UPLOADED month, not the
    // calendar's — a distributor that skips a month must not read against
    // nothing.
    const chosen =
      pickedMonth && monthsAvail.includes(pickedMonth)
        ? pickedMonth
        : (monthsAvail[0] ?? null);
    const prevOfChosen = chosen
      ? (monthsAvail[monthsAvail.indexOf(chosen) + 1] ?? null)
      : null;
    const wantedMonths = [chosen, prevOfChosen].filter(
      (p): p is string => p !== null,
    );
    const ytdPeriod =
      [
        ...new Set(
          periodRows.filter((r) => r.period_kind === "YTD").map((r) => r.period),
        ),
      ]
        .sort()
        .reverse()[0] ?? null;
    const SELL_COLS =
      "period, rep_id, rep_name, region_id, region_name, market_owner_name, distributor_id, distributor_name, branch_id, branch_name, branch_city, branch_state, dealer_id, dealer_name, dealer_label, product, quantity, unit, value, ly_quantity, period_kind";
    const none = Promise.resolve({ data: [], error: null });
    const [ch, sc, ex, wm, pl, st, sy, sb, br, so, ol, hr] = await Promise.all([
      supabase
        .from("dashboard_plan_by_channel")
        .select(
          "owner_id, week_start, account_id, account_name, account_type, distributor_id, distributor_name, distributor_options, planned_total, planned_done, planned_owed, planned_missed",
        )
        .order("week_start", { ascending: false })
        .limit(1000),
      supabase
        .from("dashboard_rep_scorecard")
        .select("membership_id, rep_name, territory_name")
        .order("rep_name"),
      supabase
        .from("exceptions")
        .select("exception_type, owner_membership_id, subject_id, title")
        .limit(1000),
      supabase
        .from("dashboard_won_monthly")
        .select("customer_id, month, unit, won_qty, won_value")
        .order("month", { ascending: false })
        .limit(1000),
      supabase
        .from("dashboard_pipeline")
        .select("stage, opportunity_count, total_value"),
      // The distributors' own report: exactly the month being read and the
      // one before it. `period_kind is null` rides along for rows loaded
      // before the kind existed — they were always monthly.
      wantedMonths.length > 0
        ? supabase
            .from("sell_through_rows")
            .select(SELL_COLS)
            .in("period", wantedMonths)
            .or("period_kind.eq.MONTH,period_kind.is.null")
            .limit(10000)
        : none,
      // And the year-so-far aggregate, its latest file only.
      ytdPeriod
        ? supabase
            .from("sell_through_rows")
            .select(SELL_COLS)
            .eq("period_kind", "YTD")
            .eq("period", ytdPeriod)
            .limit(10000)
        : none,
      // Including the branches that bought nothing — the gaps are the point of
      // a coverage map, and sell_through_rows only carries branches with sales.
      supabase
        .from("distributor_branches")
        .select("id, distributor_id, name, city, state")
        .limit(500),
      supabase
        .from("account_rollout_status")
        .select(
          "account_id, org_id, name, pk_state, merchandiser_state, display_wall_state, material_state, pk_count",
        )
        .limit(500),
      // Our sell-out, money and status only — the item lists stay on /orders.
      supabase
        .from("orders_mirror")
        .select(
          "customer_id, status, total_value, order_date_po, created_at, archived_at",
        )
        .limit(1000),
      supabase
        .from("order_customer_links")
        .select("customer_id, account_id, accounts(name)"),
      supabase
        .from("sell_through_house_periods")
        .select("distributor_id, period, period_kind")
        .limit(2000),
    ]);
    setChannel(ch.error ? [] : ((ch.data as ChannelRow[]) ?? []));
    setScorecard(sc.error ? [] : ((sc.data as ScorecardRow[]) ?? []));
    setSlipping(ex.error ? [] : ((ex.data as ExceptionRow[]) ?? []));
    setWonMonths(wm.error ? [] : ((wm.data as WonMonthRow[]) ?? []));
    setPipeline(pl.error ? [] : ((pl.data as PipelineRow[]) ?? []));
    setSellRows([
      ...(st.error ? [] : ((st.data as SellThroughRow[]) ?? [])),
      ...(sy.error ? [] : ((sy.data as SellThroughRow[]) ?? [])),
    ]);
    setMonths(monthsAvail);
    setSellBranches(sb.error ? [] : ((sb.data as BranchRef[]) ?? []));
    setBranches(br.error ? [] : ((br.data as BranchRow[]) ?? []));
    setSellOut(so.error ? [] : ((so.data as unknown as SellOutOrder[]) ?? []));
    setOrderLinks(ol.error ? [] : ((ol.data as unknown as OrderLinkRow[]) ?? []));
    setHouseReturns(
      hr.error ? [] : ((hr.data as unknown as HouseReturnRow[]) ?? []),
    );
    setLoadedAt(Date.now());
  }, [pickedMonth]);

  // Every attempt must CONCLUDE, or the skeleton is a spinner with no way out —
  // the exact failure this whole change was meant to avoid, moved one screen
  // along. This home is network-only, unlike the rep's day, so "no signal" is a
  // real state it has to be able to say out loud rather than draw as zeros.
  const attempt = useCallback(async () => {
    setLoadFailed(false);
    try {
      await load();
    } catch {
      setLoadFailed(true);
    }
  }, [load]);

  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => void attempt(), 0);
    return () => clearTimeout(timer);
  }, [profile, attempt, status.lastPulledAt]);

  const repMeta = useMemo(() => {
    const m = new Map<string, { name: string; patch: string }>();
    for (const r of scorecard) {
      if (r.membership_id) {
        m.set(r.membership_id, {
          name: r.rep_name ?? "—",
          patch: r.territory_name ?? "No patch",
        });
      }
    }
    return m;
  }, [scorecard]);

  const repName = useMemo(
    () => new Map([...repMeta].map(([id, v]) => [id, v.name])),
    [repMeta],
  );
  const week = useMemo(
    () => (loadedAt === null ? null : latestStartedWeek(channel, loadedAt)),
    [channel, loadedAt],
  );

  // Only the week's numbers, for the sentence above. The rows themselves are
  // the lens's job now.
  const team = useMemo(() => {
    if (!week) return [];
    return groupByRep(channel.filter((r) => r.week_start === week), repName);
  }, [channel, week, repName]);

  const narrative = useMemo(() => teamNarrative(team), [team]);

  // The two months the sell-through is good for. Never "this month and last" —
  // a distributor that skips a month must not make the comparison read against
  // nothing.
  // The two windows never mix: a YTD aggregate inside the monthly pair would
  // double the book, and a month inside the YTD reading would understate it.
  const monthlyRows = useMemo(
    () => sellRows.filter((r) => r.period_kind !== "YTD"),
    [sellRows],
  );
  const ytdSellRows = useMemo(
    () => sellRows.filter((r) => r.period_kind === "YTD"),
    [sellRows],
  );
  const { latest, previous } = useMemo(
    () => latestPeriods(monthlyRows),
    [monthlyRows],
  );

  // The two figures at the top. With nothing chosen they are the money a
  // director asks for first: what is open, and what is waiting on somebody.
  //
  // Once a CUSTOMER is chosen they switch to linear feet, and that is deliberate
  // rather than cosmetic. GMX does not sell to a dealer — the distributor does —
  // so a dealer's row in our own pipeline is legitimately empty, and a tile
  // reading $0 would say "no business here" about a yard buying nine thousand
  // feet a month. The honest pair for one door is what it bought, and what it
  // bought the month before.
  const totals = useMemo(() => {
    if (focus) {
      // Straight off the focus: the section that drew the bar has already
      // scoped these to the same walk, so the tile and the bar cannot disagree.
      const now = focus.qty;
      const before = focus.prevQty;
      return {
        open: now,
        openIsMoney: false,
        openLabel: `Bought · ${periodLabel(latest)}`,
        openHint: movementLabel(now, before, previous) ?? "no month to compare",
        quotes: before,
        quotesLabel: previous ? `Bought · ${periodLabel(previous)}` : "Month before",
        quotesHint: previous ? "the month before" : "no earlier file loaded",
      };
    }
    let open = 0;
    let openCount = 0;
    let quotes = 0;
    for (const r of pipeline) {
      if (r.stage === "WON" || r.stage === "LOST") continue;
      open += Number(r.total_value);
      openCount += Number(r.opportunity_count);
      if (r.stage === "QUOTE" || r.stage === "DECISION") {
        quotes += Number(r.opportunity_count);
      }
    }
    return {
      open,
      openIsMoney: true,
      openLabel: "Open pipeline",
      openHint: `${openCount} open ${openCount === 1 ? "deal" : "deals"}`,
      quotes,
      quotesLabel: "Out for quote",
      quotesHint: "waiting on an answer",
    };
  }, [pipeline, focus, latest, previous]);

  // Month by month narrows to the chosen customer; the rollout narrows to
  // their own branch, and simply does not apply to a distributor.
  const monthRows = useMemo(
    () => (focus ? wonMonths.filter((r) => r.customer_id === focus.accountId) : wonMonths),
    [wonMonths, focus],
  );

  // Three visible gates since the 2026-08-28 review — the merchandiser stays
  // in the row but out of every reading, and "through" means through the three
  // that are on the screen.
  const gatesOn = (b: BranchRow) => {
    const on = (v: string) => (v === "OK" ? 1 : 0);
    return on(b.pk_state) + on(b.material_state) + on(b.display_wall_state);
  };

  // Summed from the same rows the unfold lists, so the book's counts and the
  // names behind them cannot disagree. dashboard_rollout still exists for the
  // desktop stopgap; this screen stopped asking two sources one question.
  const rollout = useMemo<RolloutCounts | null>(() => {
    if (branches.length === 0) return null;
    const on = (v: string) => (v === "OK" ? 1 : 0);
    const pend = (v: string) => (v === "PENDING" ? 1 : 0);
    const sum = (f: (b: BranchRow) => number) => branches.reduce((n, b) => n + f(b), 0);
    return {
      branches: branches.length,
      pk_done: sum((b) => on(b.pk_state)),
      merchandiser_done: sum((b) => on(b.merchandiser_state)),
      display_wall_done: sum((b) => on(b.display_wall_state)),
      material_done: sum((b) => on(b.material_state)),
      fully_through: branches.filter((b) => gatesOn(b) === 3).length,
      not_started: branches.filter((b) => gatesOn(b) === 0).length,
      pk_pending: sum((b) => pend(b.pk_state)),
      merchandiser_pending: 0,
      display_wall_pending: sum((b) => pend(b.display_wall_state)),
      material_pending: sum((b) => pend(b.material_state)),
      pk_total: sum((b) => b.pk_count),
    };
  }, [branches]);

  const pkAccounts = useMemo<PkAccount[]>(
    () =>
      branches
        .map((b) => ({ account_id: b.account_id, name: b.name, pk_count: b.pk_count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [branches],
  );

  // The checkbox and its "again": one writer, the count — the trigger keeps
  // pk_state agreeing on the server. Optimistic, then the truth reloaded only
  // on failure, because the row being ticked is already on the screen.
  const setPkCount = useCallback(
    async (accountId: string, next: number) => {
      const row = branches.find((b) => b.account_id === accountId);
      if (!row || next < 0) return;
      setBranches((prev) =>
        prev.map((b) =>
          b.account_id === accountId
            ? {
                ...b,
                pk_count: next,
                pk_state: next > 0 ? "OK" : b.pk_state === "OK" ? "NO" : b.pk_state,
              }
            : b,
        ),
      );
      const { error } = await getSupabaseBrowserClient()
        .from("account_rollout")
        .upsert(
          { account_id: accountId, org_id: row.org_id, pk_count: next },
          { onConflict: "account_id" },
        );
      if (error) void attempt();
    },
    [branches, attempt],
  );

  const focusedGates = useMemo(() => {
    if (!focus) return null;
    const b = branches.find((x) => x.account_id === focus.accountId);
    if (!b) return null;
    const on = (v: string) => (v === "OK" ? 1 : 0);
    const pending = (v: string) => (v === "PENDING" ? 1 : 0);
    return {
      branches: 1,
      pk_done: on(b.pk_state),
      merchandiser_done: on(b.merchandiser_state),
      display_wall_done: on(b.display_wall_state),
      material_done: on(b.material_state),
      pk_pending: pending(b.pk_state),
      merchandiser_pending: 0,
      display_wall_pending: pending(b.display_wall_state),
      material_pending: pending(b.material_state),
      fully_through: gatesOn(b) === 3 ? 1 : 0,
      not_started: 0,
      pk_total: b.pk_count,
    };
  }, [focus, branches]);

  // The one branch's own unfold row, so the class can be recorded from the
  // focused reading with the same control the book uses.
  const focusedPk = useMemo<PkAccount[] | undefined>(() => {
    if (!focus) return undefined;
    const b = branches.find((x) => x.account_id === focus.accountId);
    return b ? [{ account_id: b.account_id, name: b.name, pk_count: b.pk_count }] : undefined;
  }, [focus, branches]);

  // GONE QUIET, MEANING QUIET (Andre, 2026-09-01: "se comprou esse mês que
  // passou não é quiet") — AND THEN THE FADING, because the silent alone
  // made the card thinner than the trouble is (Andre, same day: "precisa
  // ter mais dados como antes"). Two chapters, one register:
  //   1. Silent — absent from our latest file. Gone against last year (LY
  //      volume, zero this year) or gone mid-year (bought in the YTD window,
  //      nothing in the newest monthly file, provable only when that file
  //      is newer than the YTD cut). The figure is the volume that went
  //      silent. Whoever came back in a later file is out.
  //   2. Fading — still in the file, but buying LESS than before: the drop
  //      named in percent, the figure their current volume.
  // Stable and rising dealers stay out: this card is what's slipping, not
  // the whole book. Inside each chapter the biggest loss leads.
  const quietYtd = salesMode === "ytd" && ytdSellRows.length > 0;
  const quietRanking = useMemo(() => {
    const base = quietYtd ? ytdSellRows : monthlyRows;
    const pLatest = quietYtd
      ? ([...new Set(ytdSellRows.map((r) => r.period))].sort().reverse()[0] ?? null)
      : latest;
    const empty = {
      rows: [] as {
        key: string;
        accountId: string | null;
        name: string;
        /** Silent rows: the volume that went quiet. Fading rows: what they
         *  still buy. Either way, the number that matters now. */
        stake: number;
        unit: string;
        /** The verdict: "stopped buying", silence since the newest file, or
         *  the drop in percent. */
        verdict: string;
        /** WHEN they were last heard, or what they used to buy
         *  (Andre, 2026-08-31: if we don't know, we say so). */
        when: string | null;
        /** 0/1 = silent (year-long, then mid-year); 2 = fading. */
        chapter: 0 | 1 | 2;
      }[],
      hasPrev: false,
    };
    if (!pLatest) return empty;
    const cur = new Map<string, number>();
    const prev = new Map<string, number>();
    const names = new Map<string, string>();
    const ids = new Map<string, string | null>();
    // The window AFTER the YTD cut — the monthly files. A dealer at zero for
    // January–June who bought in July has not stopped; without this map the
    // ranking would send a rep to rescue an account that already came back.
    const later = new Map<string, number>();
    if (quietYtd && latest) {
      for (const r of monthlyRows) {
        if (r.period !== latest) continue;
        const key = r.dealer_id ?? r.dealer_label;
        later.set(key, (later.get(key) ?? 0) + Number(r.quantity));
      }
    }
    let unit = "LF";
    for (const r of base) {
      const key = r.dealer_id ?? r.dealer_label;
      names.set(key, r.dealer_name ?? r.dealer_label);
      ids.set(key, r.dealer_id);
      unit = r.unit || unit;
      if (r.period === pLatest) {
        cur.set(key, (cur.get(key) ?? 0) + Number(r.quantity));
        if (quietYtd)
          prev.set(key, (prev.get(key) ?? 0) + Number(r.ly_quantity ?? 0));
      } else if (!quietYtd && previous && r.period === previous) {
        prev.set(key, (prev.get(key) ?? 0) + Number(r.quantity));
      }
    }
    const hasPrev = quietYtd
      ? [...prev.values()].some((v) => v > 0)
      : previous !== null;
    const lyYear = Number(pLatest.slice(0, 4)) - 1;
    // The later file is only proof of silence when somebody is IN it.
    const laterFileExists = later.size > 0;
    const keys = new Set([...cur.keys(), ...prev.keys()]);
    const rows: (typeof empty)["rows"] = [];
    const grouped: {
      group: number;
      loss: number;
      row: (typeof empty)["rows"][number];
    }[] = [];
    for (const k of keys) {
      const c = cur.get(k) ?? 0;
      const p = prev.get(k) ?? 0;
      const common = {
        key: k,
        accountId: ids.get(k) ?? null,
        name: names.get(k) ?? k,
        unit,
      };
      if (hasPrev && p > 0 && c === 0) {
        // Silent for the whole window — unless a later monthly file already
        // heard from them, in which case they are simply NOT QUIET.
        if (quietYtd && (later.get(k) ?? 0) > 0) continue;
        grouped.push({
          group: 0,
          loss: p,
          row: {
            ...common,
            stake: p,
            verdict: "stopped buying",
            when: quietYtd
              ? // Their last trace is the LY aggregate — a year, not a month,
                // and the gap is named rather than smoothed over.
                `last bought in ${lyYear} · month unknown`
              : `last bought ${periodLabel(previous)}`,
            chapter: 0 as const,
          },
        });
      } else if (quietYtd && c > 0 && laterFileExists && (later.get(k) ?? 0) === 0) {
        // Bought inside the YTD window, silent in the newest monthly file.
        grouped.push({
          group: 1,
          loss: c,
          row: {
            ...common,
            stake: c,
            verdict: latest ? `nothing in ${periodLabel(latest)}` : "gone quiet",
            when: "bought earlier this year",
            chapter: 1 as const,
          },
        });
      } else if (hasPrev && p > 0 && c > 0 && c < p) {
        // Still in the file, buying less — the fading chapter. The drop is
        // named in percent; the biggest ABSOLUTE loss leads, because 90% of
        // a thin account is smaller trouble than 30% of a fat one.
        grouped.push({
          group: 2,
          loss: p - c,
          row: {
            ...common,
            stake: c,
            verdict: `down ${Math.round((100 * (p - c)) / p)}% on ${
              quietYtd ? "last year" : periodLabel(previous)
            }`,
            when: `was ${QTY.format(p)} ${unit}`,
            chapter: 2 as const,
          },
        });
      }
      // Steady or growing means not slipping — not this card's business.
    }
    grouped.sort((a, b) => a.group - b.group || b.loss - a.loss);
    for (const g of grouped) rows.push(g.row);
    return { rows, hasPrev };
  }, [quietYtd, ytdSellRows, monthlyRows, latest, previous]);

  // The ranking answers for the whole book under the region lens; a chosen
  // customer narrows the section to themselves like everything else does.
  const quietAsRanking =
    salesLens === "region" && !focus && quietRanking.rows.length > 0;

  // Grouped by what is wrong, most of it first — the same union a rep meets one
  // row at a time, read as a list of problems with names against them.
  const slippingGroups = useMemo(() => {
    const map = new Map<string, { count: number; names: string[] }>();
    for (const e of slipping) {
      if (!e.exception_type) continue;
      if (focus && e.subject_id !== focus.accountId) continue;
      const g = map.get(e.exception_type) ?? { count: 0, names: [] };
      g.count += 1;
      if (e.title) g.names.push(e.title);
      map.set(e.exception_type, g);
    }
    return [...map.entries()]
      .map(([type, g]) => ({
        type,
        count: g.count,
        names: g.names,
        danger: DANGER_EXCEPTIONS.has(type),
      }))
      .sort((a, b) => Number(b.danger) - Number(a.danger) || b.count - a.count)
      .slice(0, 4);
  }, [slipping, focus]);

  // ── Our sell-out, on the masthead of the day ──────────────────────────────
  // Invoiced POs by their PO month (the invoice date is the order system's
  // fact and doesn't ride the mirror; the PO month is the honest attribution
  // we hold). "In motion" is everything accepted and not yet invoiced —
  // visible, never counted as sold.
  const sellOutTiles = useMemo(() => {
    const now = new Date();
    const ym = (y: number, m: number) =>
      `${y}-${String(m + 1).padStart(2, "0")}`;
    const thisMonth = ym(now.getFullYear(), now.getMonth());
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = ym(prev.getFullYear(), prev.getMonth());
    let invoicedThis = 0;
    let invoicedPrev = 0;
    let motion = 0;
    let motionCount = 0;
    for (const o of sellOut) {
      const v = Number(o.total_value) || 0;
      if (INVOICED_STATUSES.has(o.status)) {
        const m = (o.order_date_po ?? o.created_at ?? "").slice(0, 7);
        if (m === thisMonth) invoicedThis += v;
        else if (m === prevMonth) invoicedPrev += v;
      } else if (!o.archived_at) {
        motion += v;
        motionCount += 1;
      }
    }
    return {
      invoicedThis,
      invoicedPrev,
      motion,
      motionCount,
      monthName: now.toLocaleString("en-US", { month: "long" }),
      prevMonthName: prev.toLocaleString("en-US", { month: "long" }),
    };
  }, [sellOut]);

  // The houses to chase: sold to (invoiced), linked to an account, and not a
  // single monthly return since their first invoiced PO. The distributor's
  // own file is the only proof their floor is moving — its absence is a
  // slipping item with a name and a number, not a mystery.
  const returnChasers = useMemo(() => {
    const accountOf = new Map(
      orderLinks.map((l) => [
        l.customer_id,
        { id: l.account_id, name: l.accounts?.name ?? null },
      ]),
    );
    const byAccount = new Map<
      string,
      { id: string; name: string; dollars: number; firstMonth: string | null }
    >();
    for (const o of sellOut) {
      if (!o.customer_id || !INVOICED_STATUSES.has(o.status)) continue;
      const acct = accountOf.get(o.customer_id);
      if (!acct?.name) continue;
      const entry = byAccount.get(acct.id) ?? {
        id: acct.id,
        name: acct.name,
        dollars: 0,
        firstMonth: null,
      };
      entry.dollars += Number(o.total_value) || 0;
      const m = (o.order_date_po ?? o.created_at ?? "").slice(0, 7) || null;
      if (m && (!entry.firstMonth || m < entry.firstMonth)) entry.firstMonth = m;
      byAccount.set(acct.id, entry);
    }
    const list = [...byAccount.values()]
      .filter((h) => {
        if (h.dollars <= 0) return false;
        const mark = h.firstMonth ? `${h.firstMonth}-01` : null;
        return !houseReturns.some(
          (r) =>
            r.distributor_id === h.id &&
            r.period_kind !== "YTD" &&
            (!mark || r.period >= mark),
        );
      })
      .sort((a, b) => b.dollars - a.dollars);
    return focus ? list.filter((h) => h.id === focus.accountId) : list;
  }, [sellOut, orderLinks, houseReturns, focus]);

  // The figures travel to their new value rather than jumping, so a number
  // that changed because someone asked a different question looks like it.
  const openTween = useTween(totals.open);
  const quotesTween = useTween(totals.quotes);

  // NOTHING IS ASSERTED BEFORE THE FIRST LOAD LANDS.
  //
  // Every piece of state here starts empty, which used to mean this screen mounted
  // as a finished page with nothing in it: "Open pipeline $0 · 0 open deals" over
  // a sales bar reading 0 LF, held for as long as nine network queries took, and
  // then silently replaced by $180,000. A zero is a number. Nothing on screen told
  // the reader it was a placeholder, so it was not a slow answer — it was a wrong
  // one, and the reader had no way to know.
  //
  // loadedAt is the honest gate: it is stamped when the load returns, so it says
  // "these figures came from somewhere" and not merely "time has passed".
  if (loadedAt === null && !loadFailed) {
    return <ManagerHomeSkeleton name={name} />;
  }

  // No answer at all. Drawn as a state rather than as zeros, because this home is
  // network-only and a manager with no signal has genuinely not been told anything
  // — where "$0 open pipeline" tells them something false. The greeting stays: it
  // came off the cached profile and is still true.
  if (loadedAt === null) {
    return (
      <div className="stack pt-2">
        <section>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">
            {greeting(hour)}, {name}
          </h1>
          <p className="t-sub mt-1" style={{ maxWidth: "52ch" }}>
            The team&apos;s numbers live on the server and this device can&apos;t
            reach it right now. Nothing is lost &mdash; anything you record still
            saves and syncs when you&apos;re back.
          </p>
        </section>
        <button
          type="button"
          onClick={() => void attempt()}
          className="btn-secondary w-full"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    // mgr-home + data-desk: INERT on the phone — the attributes exist so the
    // desk (>=1280px) can place these same children on a two-column grid
    // without touching the mobile DOM or its order. Mobile is mandatory-as-is
    // (Andre, 2026-08-31); the desk is a second reading of the same page.
    <div className="stack pt-2 mgr-home">
      <section data-desk="hero">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">
          {greeting(hour)}, {name}
        </h1>
        <p className="t-sub mt-1" style={{ maxWidth: "52ch" }}>
          {narrative}
        </p>
      </section>

      {focus && (
        <div className="focus-bar" data-desk="focus">
          <span className="focus-swatch" style={{ background: focus.colour }} aria-hidden="true" />
          <span className="min-w-0">
            <span className="focus-name block truncate">{focus.name}</span>
            {/* When the thing being read is one of our accounts, the sections
                below really are its own. When it is NOT — a branch in someone
                else's network, or a name off a file we could not match — they
                are keyed to the nearest account instead, and this line has to
                say so. Claiming "everything below is theirs" over a branch's
                name is a small lie that makes every figure under it suspect. */}
            <span className="focus-kind">
              {focus.id === focus.accountId
                ? focus.kind === "DISTRIBUTOR"
                  ? "distributor · everything below is theirs"
                  : "dealer · everything below is theirs"
                : `${focus.dim === "branch" ? "branch" : "unmatched name"} · the rest of the page follows ${focus.accountName}`}
            </span>
          </span>
          {/* Undoes the WALK as well as the focus: leaving the page narrowed
              three links deep while the bar above says "all" would be two
              screens disagreeing about what is being read. */}
          <button
            type="button"
            className="focus-clear"
            onClick={() => {
              setFocus(null);
              setPath([]);
            }}
          >
            Show all
          </button>
        </div>
      )}

      {/* The figures read INLINE, one ruled strip, not a grid of boxes
          (Andre, 2026-09-04: "não faz sentido, poderia ser inline") — four
          numbers on one line are a masthead; four cards are furniture. */}
      <section
        className="adapt stat-row"
        data-desk="tiles"
        key={`tiles-${focus?.id ?? "all"}`}
      >
        <div className="stat">
          <div className="t-meta uppercase tracking-wide">{totals.openLabel}</div>
          <div className="fig fig-lg mt-1">
            {totals.openIsMoney
              ? formatMoney(Math.round(openTween))
              : `${QTY.format(Math.round(openTween))} LF`}
          </div>
          <div className="t-hint mt-0.5">{totals.openHint}</div>
        </div>
        <div className="stat">
          <div className="t-meta uppercase tracking-wide">{totals.quotesLabel}</div>
          <div className="fig fig-lg mt-1">
            {totals.openIsMoney
              ? QTY.format(Math.round(quotesTween))
              : `${QTY.format(Math.round(quotesTween))} LF`}
          </div>
          <div className="t-hint mt-0.5">{totals.quotesHint}</div>
        </div>

        {/* Our sell-out beside the pipeline pair — the money that already
            exists. Both stats are the Overview's door to /orders. Hidden
            while a customer is chosen: the pair above already switched to
            that door's own buying, and a company-wide figure under a focus
            bar would be two screens disagreeing. */}
        {!focus && (
          <>
            {/* Early in a month nothing is invoiced yet, and a leading "$0"
                reads dead the way the placeholder zeros once did — so until
                the current month has money, the stat leads with the last
                month that does and says so. Both statements are true; one
                of them is also useful. */}
            {sellOutTiles.invoicedThis > 0 ? (
              <Link href="/orders" className="stat">
                <div className="t-meta uppercase tracking-wide">
                  Sell-out · {sellOutTiles.monthName}
                </div>
                <div className="fig fig-lg mt-1">
                  {formatMoney(Math.round(sellOutTiles.invoicedThis))}
                </div>
                <div className="t-hint mt-0.5">
                  {formatMoney(Math.round(sellOutTiles.invoicedPrev))} in{" "}
                  {sellOutTiles.prevMonthName}
                </div>
              </Link>
            ) : (
              <Link href="/orders" className="stat">
                <div className="t-meta uppercase tracking-wide">
                  Sell-out · {sellOutTiles.prevMonthName}
                </div>
                <div className="fig fig-lg mt-1">
                  {formatMoney(Math.round(sellOutTiles.invoicedPrev))}
                </div>
                <div className="t-hint mt-0.5">
                  nothing invoiced in {sellOutTiles.monthName} yet
                </div>
              </Link>
            )}
            <Link href="/orders" className="stat">
              <div className="t-meta uppercase tracking-wide">In motion</div>
              <div className="fig fig-lg mt-1">
                {QTY.format(sellOutTiles.motionCount)}
              </div>
              <div className="t-hint mt-0.5">
                {formatMoney(Math.round(sellOutTiles.motion))} on the way
              </div>
            </Link>
          </>
        )}
      </section>

      {/* Sales first: the distributors' sell-through, banded by whoever is not
          the row, walking rep → distributor → branch → dealer in place rather
          than sending anyone to another screen. */}
      <div data-desk="sales">
      <TeamSales
        rows={monthlyRows}
        ytdRows={ytdSellRows}
        branches={sellBranches}
        latest={latest}
        previous={previous}
        months={months}
        onPickMonth={setPickedMonth}
        path={path}
        onPath={setPath}
        onFocus={setFocus}
        onLens={setSalesLens}
        onMode={setSalesMode}
      />
      </div>

      {/* Bianca's tracker, as the journey a branch walks rather than four
          numbers in a box — and ONLY under the Rep lens: the gates are the
          reps' work, and next to a region or a distributor reading they were
          an answer to a question nobody had asked. */}
      {/* The rollout answers for one branch when one is chosen, and steps
          aside for a distributor — a house does not have a display wall. */}
      {salesLens === "rep" && (
        <div className="adapt" data-desk="gates" key={`gates-${focus?.id ?? "all"}`}>
          {focus ? (
            focusedGates ? (
              <RolloutTimeline
                counts={focusedGates}
                heading="Their rollout"
                pkAccounts={focusedPk}
                onPkCount={setPkCount}
              />
            ) : null
          ) : (
            rollout && (
              <RolloutTimeline
                counts={rollout}
                pkAccounts={pkAccounts}
                onPkCount={setPkCount}
              />
            )
          )}
        </div>
      )}

      <div className="adapt" data-desk="months" key={`months-${focus?.id ?? "all"}`}>
        <MonthByMonth rows={monthRows} nowMs={loadedAt} />
      </div>

      {(slippingGroups.length > 0 || quietAsRanking || returnChasers.length > 0) && (
        <section className="adapt" data-desk="slipping" key={`slip-${focus?.id ?? "all"}`}>
          <div className="section-head">
            <h2 className="t-section">What&rsquo;s slipping</h2>
            <Link href="/dashboard" className="t-action">
              All of it
            </Link>
          </div>

          {/* The missing returns: houses we have INVOICED and never heard
              back from — no sell-through file since their first PO. Their
              floor cannot be read until the paper arrives, so the absence
              itself is the slipping item, with the money that is waiting on
              it. */}
          {returnChasers.length > 0 && (
            <ul className="list mb-3">
              <li>
                <Link href="/orders" className="row slip-group">
                  <span className="slip-group-head">
                    <span className="row-body">
                      <span className="t-title">
                        Sold to, but no sell-through return on file
                      </span>
                    </span>
                    <span
                      className="fig fig-lg shrink-0"
                      style={{ color: "var(--danger)" }}
                    >
                      {returnChasers.length}
                    </span>
                  </span>
                  <span className="slip-names">
                    {returnChasers.slice(0, 6).map((h) => (
                      <span key={h.id} className="slip-name">
                        {h.name} — {formatMoney(Math.round(h.dollars))}
                      </span>
                    ))}
                    {returnChasers.length > 6 && (
                      <span className="t-hint">
                        + {returnChasers.length - 6} more
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            </ul>
          )}

          {/* The quiet accounts, RANKED by their buying — the one that stopped
              is first and the one still growing is last, so "who do I call
              first" is answered by reading top to bottom. Replaces the bare
              count under the region lens; the other exception groups keep
              their chips below. */}
          {quietAsRanking && (
            <div className="card mb-3">
              <div className="quiet-head">
                <span className="t-title">Account gone quiet</span>
                <span className="t-hint">
                  the silent first, then the fading — biggest loss leading
                </span>
              </div>
              <div className="quiet-scroll">
              <ul className="list">
                {quietRanking.rows.map((r, i) => {
                  const prevRow = quietRanking.rows[i - 1];
                  const chapterLabel =
                    r.chapter === 2 && (!prevRow || prevRow.chapter !== 2)
                      ? "still buying, but fading"
                      : r.chapter < 2 && !prevRow
                        ? "gone quiet"
                        : null;
                  const body = (
                    <>
                      <span className="row-body">
                        <span className="quiet-name">{r.name}</span>
                        {/* WHEN they were last heard — under the name, where
                            there is room; the figure column keeps the verdict
                            and the volume that went silent. */}
                        {r.when && (
                          <span className="t-hint quiet-since">{r.when}</span>
                        )}
                      </span>
                      <span className="quiet-fig">
                        <span className="fig fig-md">
                          {QTY.format(r.stake)} {r.unit}
                        </span>
                        <span className="sales-move" data-dir="down">
                          {r.verdict}
                        </span>
                      </span>
                    </>
                  );
                  return (
                    <li key={r.key}>
                      {chapterLabel && (
                        <p className="quiet-chapter">{chapterLabel}</p>
                      )}
                      {r.accountId ? (
                        <Link href={`/accounts/${r.accountId}`} className="row quiet-row">
                          {body}
                        </Link>
                      ) : (
                        <div className="row quiet-row">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
              </div>
              {quietRanking.rows.length > 10 && (
                <p className="t-hint quiet-more">
                  and {quietRanking.rows.length - 10} more —{" "}
                  <Link href="/accounts" className="underline underline-offset-2">
                    all accounts
                  </Link>
                </p>
              )}
            </div>
          )}

          <ul className="list">
            {slippingGroups
              .filter((g) => !(quietAsRanking && g.type === "STRATEGIC_ACCOUNT_QUIET"))
              .map((g) => (
                <li key={g.type}>
                  <Link href="/accounts" className="row slip-group">
                    <span className="slip-group-head">
                      <span className="row-body">
                        <span className="t-title">{exceptionLabel(g.type)}</span>
                      </span>
                      <span
                        className="fig fig-lg shrink-0"
                        style={{ color: g.danger ? "var(--danger)" : "var(--ink-primary)" }}
                      >
                        {g.count}
                      </span>
                    </span>
                    {/* WHO, not only how many — the desk has the room, and a
                        count with no names is a question, not an answer. */}
                    {g.names.length > 0 && (
                      <span className="slip-names">
                        {g.names.slice(0, 6).map((n) => (
                          <span key={n} className="slip-name">
                            {n}
                          </span>
                        ))}
                        {g.count > 6 && (
                          <span className="t-hint">+ {g.count - 6} more</span>
                        )}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}

    </div>
  );
}
