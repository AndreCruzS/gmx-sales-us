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
import { TeamSales, type CustomerSalesRow, type Focus } from "@/components/team-sales";
import { useTween } from "@/lib/ui/use-tween";
import { MonthByMonth, type WonMonthRow } from "@/components/month-by-month";
import { RolloutTimeline } from "@/components/rollout-timeline";
import type { RolloutCounts } from "@/lib/domain/rollout";
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
// rather than for the book.
interface BranchRow {
  account_id: string;
  pk_state: string;
  merchandiser_state: string;
  display_wall_state: string;
  material_state: string;
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
  const [rollout, setRollout] = useState<RolloutCounts | null>(null);
  const [wonMonths, setWonMonths] = useState<WonMonthRow[]>([]);
  const [pipeline, setPipeline] = useState<PipelineRow[]>([]);
  const [dealerSales, setDealerSales] = useState<CustomerSalesRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [hour, setHour] = useState<number | null>(null);

  // The clock is an external system; stamped once, never read during a render.
  useEffect(() => {
    const t = setTimeout(() => setHour(new Date().getHours()), 0);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [ch, sc, ex, ro, wm, pl, ds, br] = await Promise.all([
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
        .from("dashboard_rollout")
        .select(
          "branches, pk_done, merchandiser_done, display_wall_done, material_done, fully_through, not_started, pk_pending, merchandiser_pending, display_wall_pending, material_pending",
        )
        .maybeSingle(),
      supabase
        .from("dashboard_won_monthly")
        .select("customer_id, month, unit, won_qty, won_value")
        .order("month", { ascending: false })
        .limit(1000),
      supabase
        .from("dashboard_pipeline")
        .select("stage, opportunity_count, total_value"),
      supabase
        .from("dashboard_customer_sales")
        .select(
          "owner_id, customer_id, customer_name, customer_type, unit, won_qty, out_qty, open_qty, won_value",
        )
        .limit(500),
      supabase
        .from("account_rollout_status")
        .select(
          "account_id, pk_state, merchandiser_state, display_wall_state, material_state",
        )
        .limit(500),
    ]);
    setChannel(ch.error ? [] : ((ch.data as ChannelRow[]) ?? []));
    setScorecard(sc.error ? [] : ((sc.data as ScorecardRow[]) ?? []));
    setSlipping(ex.error ? [] : ((ex.data as ExceptionRow[]) ?? []));
    setRollout(ro.error ? null : ((ro.data as RolloutCounts | null) ?? null));
    setWonMonths(wm.error ? [] : ((wm.data as WonMonthRow[]) ?? []));
    setPipeline(pl.error ? [] : ((pl.data as PipelineRow[]) ?? []));
    setDealerSales(ds.error ? [] : ((ds.data as CustomerSalesRow[]) ?? []));
    setBranches(br.error ? [] : ((br.data as BranchRow[]) ?? []));
    setLoadedAt(Date.now());
  }, []);

  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [profile, load, status.lastPulledAt]);

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

  // The money, in the two numbers a director asks for first: what is open, and
  // what is priced and waiting on somebody. When a customer is chosen these
  // become that customer's, from the sales view rather than the org pipeline —
  // the same figures, asked of one door.
  const totals = useMemo(() => {
    if (focus) {
      const mine = dealerSales.filter((r) => r.customer_id === focus.id);
      return {
        open: mine.reduce((n, r) => n + Number(r.won_value), 0),
        openCount: mine.length,
        quotes: mine.reduce((n, r) => n + Number(r.out_qty), 0),
        openLabel: "Won with them",
        openHint: "in this book",
        quotesLabel: "Out for quote",
        quotesHint: "LF waiting on an answer",
        quotesIsMoney: false,
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
      openCount,
      quotes,
      openLabel: "Open pipeline",
      openHint: `${openCount} open ${openCount === 1 ? "deal" : "deals"}`,
      quotesLabel: "Out for quote",
      quotesHint: "waiting on an answer",
      quotesIsMoney: false,
    };
  }, [pipeline, focus, dealerSales]);

  // Month by month narrows to the chosen customer; the rollout narrows to
  // their own branch, and simply does not apply to a distributor.
  const monthRows = useMemo(
    () => (focus ? wonMonths.filter((r) => r.customer_id === focus.id) : wonMonths),
    [wonMonths, focus],
  );

  const focusedGates = useMemo(() => {
    if (!focus) return null;
    const b = branches.find((x) => x.account_id === focus.id);
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
      merchandiser_pending: pending(b.merchandiser_state),
      display_wall_pending: pending(b.display_wall_state),
      material_pending: pending(b.material_state),
      fully_through:
        on(b.pk_state) + on(b.merchandiser_state) + on(b.display_wall_state) + on(b.material_state) === 4
          ? 1
          : 0,
      not_started: 0,
    };
  }, [focus, branches]);

  // Grouped by what is wrong, most of it first — the same union a rep meets one
  // row at a time, read as a list of problems with names against them.
  const slippingGroups = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of slipping) {
      if (!e.exception_type) continue;
      if (focus && e.subject_id !== focus.id) continue;
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

  return (
    <div className="stack pt-2">
      <section>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">
          {greeting(hour)}, {name}
        </h1>
        <p className="t-sub mt-1" style={{ maxWidth: "52ch" }}>
          {narrative}
        </p>
      </section>

      {focus && (
        <div className="focus-bar">
          <span className="focus-swatch" style={{ background: focus.colour }} aria-hidden="true" />
          <span className="min-w-0">
            <span className="focus-name block truncate">{focus.name}</span>
            <span className="focus-kind">
              {focus.kind === "DISTRIBUTOR"
                ? "distributor · everything below is theirs"
                : focus.kind === "DEALER"
                  ? "dealer · everything below is theirs"
                  : "everything below is theirs"}
            </span>
          </span>
          <button type="button" className="focus-clear" onClick={() => setFocus(null)}>
            Show all
          </button>
        </div>
      )}

      <section className="adapt grid grid-cols-2 gap-3" key={`tiles-${focus?.id ?? "all"}`}>
        <div className="card card-pad">
          <div className="t-meta uppercase tracking-wide">{totals.openLabel}</div>
          <div className="mt-1 text-2xl font-bold tracking-tight">
            {formatMoney(Math.round(openTween))}
          </div>
          <div className="t-meta mt-0.5">{totals.openHint}</div>
        </div>
        <div className="card card-pad">
          <div className="t-meta uppercase tracking-wide">{totals.quotesLabel}</div>
          <div className="mt-1 text-2xl font-bold tracking-tight">
            {QTY.format(Math.round(quotesTween))}
          </div>
          <div className="t-meta mt-0.5">{totals.quotesHint}</div>
        </div>
      </section>

      {/* Sales first: the bar they asked for, banded by customer, opening in
          place rather than sending anyone to another screen. */}
      <TeamSales
        rows={dealerSales}
        repMeta={repMeta}
        focus={focus}
        onFocus={setFocus}
      />

      {/* Bianca's tracker, as the journey a branch walks rather than four
          numbers in a box. */}
      {/* The rollout answers for one branch when one is chosen, and steps
          aside for a distributor — a house does not have a display wall. */}
      <div className="adapt" key={`gates-${focus?.id ?? "all"}`}>
        {focus ? (
          focusedGates ? (
            <RolloutTimeline counts={focusedGates} heading="Their rollout" />
          ) : null
        ) : (
          rollout && <RolloutTimeline counts={rollout} />
        )}
      </div>

      <div className="adapt" key={`months-${focus?.id ?? "all"}`}>
        <MonthByMonth rows={monthRows} nowMs={loadedAt} />
      </div>

      {slippingGroups.length > 0 && (
        <section className="adapt" key={`slip-${focus?.id ?? "all"}`}>
          <div className="section-head">
            <h2 className="t-section">What&rsquo;s slipping</h2>
            <Link href="/dashboard" className="t-action">
              All of it
            </Link>
          </div>
          <ul className="list">
            {slippingGroups.map((g) => (
              <li key={g.type}>
                <Link href="/accounts" className="row">
                  <span className="row-body">
                    <span className="t-title">{exceptionLabel(g.type)}</span>
                  </span>
                  <span
                    className="shrink-0 text-[19px] font-bold tabular-nums"
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
