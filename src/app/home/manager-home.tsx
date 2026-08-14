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
import { PlanLens } from "@/components/plan-lens";
import { TeamSales, type DealerSalesRow } from "@/components/team-sales";
import { MonthByMonth, type WonMonthRow } from "@/components/month-by-month";
import { RolloutTimeline } from "@/components/rollout-timeline";
import type { RolloutCounts } from "@/lib/domain/rollout";
import { formatMoney } from "@/lib/format";
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
}
interface PipelineRow {
  stage: string;
  opportunity_count: number;
  total_value: number;
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
  const [dealerSales, setDealerSales] = useState<DealerSalesRow[]>([]);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [hour, setHour] = useState<number | null>(null);

  // The clock is an external system; stamped once, never read during a render.
  useEffect(() => {
    const t = setTimeout(() => setHour(new Date().getHours()), 0);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [ch, sc, ex, ro, wm, pl, ds] = await Promise.all([
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
        .select("exception_type, owner_membership_id")
        .limit(1000),
      supabase
        .from("dashboard_rollout")
        .select(
          "branches, pk_done, merchandiser_done, display_wall_done, material_done, fully_through, not_started, pk_pending, merchandiser_pending, display_wall_pending, material_pending",
        )
        .maybeSingle(),
      supabase
        .from("dashboard_won_monthly")
        .select("month, unit, won_qty, won_value")
        .order("month", { ascending: false })
        .limit(1000),
      supabase
        .from("dashboard_pipeline")
        .select("stage, opportunity_count, total_value"),
      supabase
        .from("dashboard_dealer_sales")
        .select(
          "owner_id, dealer_id, dealer_name, unit, won_qty, out_qty, open_qty, won_value",
        )
        .limit(500),
    ]);
    setChannel(ch.error ? [] : ((ch.data as ChannelRow[]) ?? []));
    setScorecard(sc.error ? [] : ((sc.data as ScorecardRow[]) ?? []));
    setSlipping(ex.error ? [] : ((ex.data as ExceptionRow[]) ?? []));
    setRollout(ro.error ? null : ((ro.data as RolloutCounts | null) ?? null));
    setWonMonths(wm.error ? [] : ((wm.data as WonMonthRow[]) ?? []));
    setPipeline(pl.error ? [] : ((pl.data as PipelineRow[]) ?? []));
    setDealerSales(ds.error ? [] : ((ds.data as DealerSalesRow[]) ?? []));
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
  const repPatch = useMemo(
    () => new Map([...repMeta].map(([id, v]) => [id, v.patch])),
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
  // what is priced and waiting on somebody.
  const totals = useMemo(() => {
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
    return { open, openCount, quotes };
  }, [pipeline]);

  // Grouped by what is wrong, most of it first — the same union a rep meets one
  // row at a time, read as a list of problems with names against them.
  const slippingGroups = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of slipping) {
      if (!e.exception_type) continue;
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
  }, [slipping]);

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

      <section className="grid grid-cols-2 gap-3">
        <div className="card card-pad">
          <div className="t-meta uppercase tracking-wide">Open pipeline</div>
          <div className="mt-1 text-2xl font-bold tracking-tight">
            {formatMoney(totals.open)}
          </div>
          <div className="t-meta mt-0.5">
            {totals.openCount} open {totals.openCount === 1 ? "deal" : "deals"}
          </div>
        </div>
        <div className="card card-pad">
          <div className="t-meta uppercase tracking-wide">Out for quote</div>
          <div className="mt-1 text-2xl font-bold tracking-tight">
            {totals.quotes}
          </div>
          <div className="t-meta mt-0.5">waiting on an answer</div>
        </div>
      </section>

      {/* Sales first: the bar they asked for, banded by customer, opening in
          place rather than sending anyone to another screen. */}
      <TeamSales rows={dealerSales} repMeta={repMeta} />

      {/* The lens leadership marked up, on the screen they open rather than
          one they have to go and find: the same week by rep, by distributor,
          by dealer. Tapping a row opens whoever or whatever it names. */}
      <PlanLens
        rows={channel}
        repName={repName}
        repPatch={repPatch}
        nowMs={loadedAt}
        heading="The team &amp; the week"
      />

      {/* Bianca's tracker, as the journey a branch walks rather than four
          numbers in a box. */}
      {rollout && <RolloutTimeline counts={rollout} />}

      <MonthByMonth rows={wonMonths} nowMs={loadedAt} />

      {slippingGroups.length > 0 && (
        <section>
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
