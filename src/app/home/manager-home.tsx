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
  moveDir,
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
  const [sellBranches, setSellBranches] = useState<BranchRef[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
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
    const [ch, sc, ex, wm, pl, st, sb, br] = await Promise.all([
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
        .select("exception_type, owner_membership_id, subject_id")
        .limit(1000),
      supabase
        .from("dashboard_won_monthly")
        .select("customer_id, month, unit, won_qty, won_value")
        .order("month", { ascending: false })
        .limit(1000),
      supabase
        .from("dashboard_pipeline")
        .select("stage, opportunity_count, total_value"),
      // The distributors' own report. Newest months first and capped, because
      // only the latest month and the one before it are ever drawn — a year of
      // history would be a year of rows shipped to a phone to show two.
      supabase
        .from("sell_through_rows")
        .select(
          "period, rep_id, rep_name, region_id, region_name, market_owner_name, distributor_id, distributor_name, branch_id, branch_name, branch_city, branch_state, dealer_id, dealer_name, dealer_label, product, quantity, unit, value, ly_quantity, period_kind",
        )
        .order("period", { ascending: false })
        .limit(2000),
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
    ]);
    setChannel(ch.error ? [] : ((ch.data as ChannelRow[]) ?? []));
    setScorecard(sc.error ? [] : ((sc.data as ScorecardRow[]) ?? []));
    setSlipping(ex.error ? [] : ((ex.data as ExceptionRow[]) ?? []));
    setWonMonths(wm.error ? [] : ((wm.data as WonMonthRow[]) ?? []));
    setPipeline(pl.error ? [] : ((pl.data as PipelineRow[]) ?? []));
    setSellRows(st.error ? [] : ((st.data as SellThroughRow[]) ?? []));
    setSellBranches(sb.error ? [] : ((sb.data as BranchRef[]) ?? []));
    setBranches(br.error ? [] : ((br.data as BranchRow[]) ?? []));
    setLoadedAt(Date.now());
  }, []);

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

  // GONE QUIET AS A RANKING, under the region reading (Andre, 2026-08-28).
  // A count ("4") says there is trouble; it does not say WHERE TO GO FIRST.
  // The buying itself does: every dealer in the book, ordered from the one
  // that stopped buying to the one still growing — attention runs down the
  // list. With no earlier file to move against, the smallest buyers lead,
  // because a thin month is the quietest signal there is.
  // It follows the card's window: under "Year so far" the comparison is the
  // file's own LY column — which is where the dealers who bought all of last
  // year and nothing this year finally get named instead of skipped.
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
        qty: number;
        prevQty: number;
        score: number;
        unit: string;
        /** WHEN they stopped, as honestly as the data allows: a month when the
         *  windows say one, a year with its uncertainty named when they don't
         *  (Andre, 2026-08-31: if we don't know, we say so). */
        quietSince: string | null;
        /** They zeroed the YTD window but appear in a later monthly file —
         *  not stopped at all. Ranked calm and said out loud. */
        backIn: string | null;
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
    const keys = new Set([...cur.keys(), ...prev.keys()]);
    const rows = [...keys]
      .map((k) => {
        const c = cur.get(k) ?? 0;
        const p = prev.get(k) ?? 0;
        const stopped = hasPrev && p > 0 && c === 0;
        const cameBack = stopped && quietYtd && (later.get(k) ?? 0) > 0;
        // Attention, as a number: stopped < falling < level < rising < back/new.
        const score = !hasPrev
          ? c
          : cameBack
            ? 1e9
            : p === 0
              ? Number.POSITIVE_INFINITY
              : c === 0
                ? Number.NEGATIVE_INFINITY
                : (c - p) / p;
        return {
          key: k,
          accountId: ids.get(k) ?? null,
          name: names.get(k) ?? k,
          qty: c,
          prevQty: p,
          score,
          unit,
          quietSince:
            stopped && !cameBack
              ? quietYtd
                ? // Their last trace is the LY aggregate — a year, not a month,
                  // and the gap is named rather than smoothed over.
                  `last bought in ${lyYear} · month unknown`
                : `last bought ${periodLabel(previous)}`
              : null,
          backIn: cameBack && latest ? `back in ${periodLabel(latest)}` : null,
        };
      })
      .filter((r) => r.qty > 0 || r.prevQty > 0);
    rows.sort((a, b) => a.score - b.score || a.qty - b.qty);
    return { rows, hasPrev };
  }, [quietYtd, ytdSellRows, monthlyRows, latest, previous]);

  // The ranking answers for the whole book under the region lens; a chosen
  // customer narrows the section to themselves like everything else does.
  const quietAsRanking =
    salesLens === "region" && !focus && quietRanking.rows.length > 0;
  const quietPrevKey = quietYtd ? "last-year" : previous;
  const quietLabels = quietYtd
    ? { on: "last year", fresh: "new this year" }
    : undefined;

  // Grouped by what is wrong, most of it first — the same union a rep meets one
  // row at a time, read as a list of problems with names against them.
  const slippingGroups = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of slipping) {
      if (!e.exception_type) continue;
      if (focus && e.subject_id !== focus.accountId) continue;
      map.set(e.exception_type, (map.get(e.exception_type) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([type, count]) => ({
        type,
        count,
        danger: DANGER_EXCEPTIONS.has(type),
      }))
      .sort((a, b) => Number(b.danger) - Number(a.danger) || b.count - a.count)
      .slice(0, 4);
  }, [slipping, focus]);

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

      <section
        className="adapt grid grid-cols-2 gap-3"
        data-desk="tiles"
        key={`tiles-${focus?.id ?? "all"}`}
      >
        <div className="card card-pad">
          <div className="t-meta uppercase tracking-wide">{totals.openLabel}</div>
          <div className="fig fig-xl mt-1">
            {totals.openIsMoney
              ? formatMoney(Math.round(openTween))
              : `${QTY.format(Math.round(openTween))} LF`}
          </div>
          <div className="t-hint mt-0.5">{totals.openHint}</div>
        </div>
        <div className="card card-pad">
          <div className="t-meta uppercase tracking-wide">{totals.quotesLabel}</div>
          <div className="fig fig-xl mt-1">
            {totals.openIsMoney
              ? QTY.format(Math.round(quotesTween))
              : `${QTY.format(Math.round(quotesTween))} LF`}
          </div>
          <div className="t-hint mt-0.5">{totals.quotesHint}</div>
        </div>
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

      {(slippingGroups.length > 0 || quietAsRanking) && (
        <section className="adapt" data-desk="slipping" key={`slip-${focus?.id ?? "all"}`}>
          <div className="section-head">
            <h2 className="t-section">What&rsquo;s slipping</h2>
            <Link href="/dashboard" className="t-action">
              All of it
            </Link>
          </div>

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
                  {quietRanking.hasPrev
                    ? quietYtd
                      ? "ranked against last year — most in need first"
                      : "ranked by buying — most in need first"
                    : "ranked by volume — no earlier file to move against"}
                </span>
              </div>
              <ul className="list">
                {quietRanking.rows.slice(0, 10).map((r) => {
                  const stopped = r.prevQty > 0 && r.qty === 0 && !r.backIn;
                  const body = (
                    <>
                      <span className="row-body">
                        <span className="quiet-name">{r.name}</span>
                        {/* WHEN it stopped, or that we cannot know: a month if
                            the windows say one, the year with its gap named
                            when they don't. Under the NAME, where there is
                            room — the figure column keeps the verdict. */}
                        {stopped && r.quietSince && (
                          <span className="t-hint quiet-since">{r.quietSince}</span>
                        )}
                      </span>
                      <span className="quiet-fig">
                        <span className="fig fig-md">
                          {QTY.format(r.qty)} {r.unit}
                        </span>
                        {quietRanking.hasPrev &&
                          (r.backIn ? (
                            <span className="sales-move" data-dir="up">
                              {r.backIn}
                            </span>
                          ) : stopped ? (
                            <span className="sales-move" data-dir="down">
                              stopped buying
                            </span>
                          ) : (
                            <span
                              className="sales-move"
                              data-dir={moveDir(r.qty, r.prevQty, quietPrevKey)}
                            >
                              {r.prevQty === 0
                                ? (quietLabels?.fresh ?? "new this month")
                                : (movementLabel(r.qty, r.prevQty, quietPrevKey, quietLabels) ?? "—")}
                            </span>
                          ))}
                      </span>
                    </>
                  );
                  return (
                    <li key={r.key}>
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
              {quietRanking.rows.length > 10 && (
                <p className="t-hint quiet-more">
                  and {quietRanking.rows.length - 10} calmer below —{" "}
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
                  <Link href="/accounts" className="row">
                    <span className="row-body">
                      <span className="t-title">{exceptionLabel(g.type)}</span>
                    </span>
                    <span
                      className="fig fig-lg shrink-0"
                      style={{ color: g.danger ? "var(--danger)" : "var(--ink-primary)" }}
                    >
                      {g.count}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}

    </div>
  );
}
