"use client";

// Management dashboard (spec §15, source PDF §4). Every number here is DERIVED
// from normal system usage — no separate reporting, no new writable state.
// The views are security_invoker, so this one page serves a rep (own numbers),
// a manager (their chain) and an admin (the org) without a role switch.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { DANGER_EXCEPTIONS, exceptionLabel } from "@/lib/domain/exceptions";
import { latestStartedWeek, type ChannelRow } from "@/lib/domain/channel";
import type { WonMonthRow } from "@/components/month-by-month";
import { PlanLens } from "@/components/plan-lens";
import { MonthByMonth } from "@/components/month-by-month";
import { RolloutTimeline } from "@/components/rollout-timeline";
import type { RolloutCounts } from "@/lib/domain/rollout";
import { formatDay } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface PipelineRow {
  owner_id: string;
  territory_id: string | null;
  stage: string;
  opportunity_count: number;
  total_value: number;
  weighted_value: number;
}
interface ScorecardRow {
  membership_id: string;
  rep_name: string;
  territory_name: string | null;
  activities_30d: number;
  open_opportunities: number;
  pipeline_value: number;
  weighted_value: number;
  open_next_actions: number;
  overdue_next_actions: number;
  quotes_outstanding: number;
  last_activity_at: string | null;
}
interface TerritoryRow {
  territory_id: string;
  territory_name: string;
  account_count: number;
  strategic_accounts: number;
  accounts_with_activity_30d: number;
  open_opportunities: number;
  pipeline_value: number;
  project_count: number;
}
interface PlannedRow {
  owner_id: string;
  week_start: string;
  planned_total: number;
  planned_done: number;
  unplanned: number;
}
interface FlowRow {
  week_start: string;
  advanced: number;
  won: number;
  lost: number;
  created: number;
}
interface ExceptionRow {
  exception_type: string | null;
  subject_type: string | null;
  subject_id: string | null;
  owner_membership_id: string | null;
}

// Pipeline stages in funnel order; WON/LOST/ON_HOLD are outcomes, not stages
// you sit in, so they read as tiles rather than funnel rows.
const FUNNEL = ["IDENTIFIED", "QUALIFIED", "DEVELOPMENT", "QUOTE", "DECISION"];

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const timeOfDay = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
interface HubspotHealth {
  configured: boolean;
  unresolvedErrors: number;
  lastPassAt: string | null;
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card card-pad">
      <div className="t-meta uppercase tracking-wide">{label}</div>
      <div className="fig fig-xl mt-1">{value}</div>
      {hint && <div className="t-meta mt-0.5">{hint}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { profile } = useOffline();
  const [pipeline, setPipeline] = useState<PipelineRow[]>([]);
  const [scorecard, setScorecard] = useState<ScorecardRow[]>([]);
  const [territories, setTerritories] = useState<TerritoryRow[]>([]);
  const [planned, setPlanned] = useState<PlannedRow[]>([]);
  const [flow, setFlow] = useState<FlowRow[]>([]);
  const [slipping, setSlipping] = useState<ExceptionRow[]>([]);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [rollout, setRollout] = useState<RolloutCounts | null>(null);
  const [channel, setChannel] = useState<ChannelRow[]>([]);
  const [wonMonths, setWonMonths] = useState<WonMonthRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Admin-only card (Task 13); the route 403s reps, and we render nothing
  // on any non-200 or unconfigured response rather than surface a jargon
  // error a rep can't act on.
  const [hubspotHealth, setHubspotHealth] = useState<HubspotHealth | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [p, s, t, pv, f, ex, ro, ch, wm] = await Promise.all([
      supabase
        .from("dashboard_pipeline")
        .select("owner_id, territory_id, stage, opportunity_count, total_value, weighted_value"),
      supabase
        .from("dashboard_rep_scorecard")
        .select(
          "membership_id, rep_name, territory_name, activities_30d, open_opportunities, pipeline_value, weighted_value, open_next_actions, overdue_next_actions, quotes_outstanding, last_activity_at",
        )
        .order("rep_name"),
      supabase
        .from("dashboard_territory")
        .select(
          "territory_id, territory_name, account_count, strategic_accounts, accounts_with_activity_30d, open_opportunities, pipeline_value, project_count",
        )
        .order("territory_name"),
      supabase
        .from("dashboard_planned_vs_actual")
        .select("owner_id, week_start, planned_total, planned_done, unplanned")
        .order("week_start", { ascending: false })
        .limit(24),
      supabase
        .from("dashboard_stage_flow")
        .select("week_start, advanced, won, lost, created")
        .order("week_start", { ascending: false })
        .limit(12),
      // Management by exception, chain-wide. Same view the rep's day uses —
      // RLS is what makes it "their chain" here and "mine" there.
      supabase
        .from("exceptions")
        .select("exception_type, subject_type, subject_id, owner_membership_id")
        .limit(1000),
      supabase
        .from("dashboard_rollout")
        .select(
          "branches, pk_done, merchandiser_done, display_wall_done, material_done, fully_through, not_started, pk_pending, merchandiser_pending, display_wall_pending, material_pending",
        )
        .maybeSingle(),
      // The same plan, one row per account, carrying the distributor behind
      // each door — this is what lets the bars split and the lens switch.
      supabase
        .from("dashboard_plan_by_channel")
        .select(
          "owner_id, week_start, account_id, account_name, account_type, distributor_id, distributor_name, distributor_options, planned_total, planned_done, planned_owed, planned_missed",
        )
        .order("week_start", { ascending: false })
        .limit(1000),
      supabase
        .from("dashboard_won_monthly")
        .select("owner_id, dealer_id, dealer_name, month, unit, won_qty, won_value, deals")
        .order("month", { ascending: false })
        .limit(1000),
    ]);
    const firstError = [p, s, t, pv, f].map((r) => r.error).find(Boolean);
    // The exception union is additive to this page — if it fails, the numbers
    // above are still true, so it must not blank the whole dashboard.
    if (firstError) {
      setError(firstError.message);
      setLoaded(true);
      return;
    }
    setPipeline((p.data as PipelineRow[]) ?? []);
    setScorecard((s.data as ScorecardRow[]) ?? []);
    setTerritories((t.data as TerritoryRow[]) ?? []);
    setPlanned((pv.data as PlannedRow[]) ?? []);
    setFlow((f.data as FlowRow[]) ?? []);
    setSlipping(ex.error ? [] : ((ex.data as ExceptionRow[]) ?? []));
    setRollout(ro.error ? null : ((ro.data as RolloutCounts | null) ?? null));
    setChannel(ch.error ? [] : ((ch.data as ChannelRow[]) ?? []));
    setWonMonths(wm.error ? [] : ((wm.data as WonMonthRow[]) ?? []));
    setLoadedAt(Date.now());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [profile, load]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    fetch("/api/hubspot/health")
      .then((res) => (res.ok ? (res.json() as Promise<HubspotHealth>) : null))
      .then((data) => {
        if (!cancelled && data?.configured) setHubspotHealth(data);
      })
      .catch(() => {
        // Not configured / not visible to this role — the card simply
        // doesn't render; no error surfaced for a non-actionable failure.
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const repName = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of scorecard) {
      if (r.membership_id) m.set(r.membership_id, r.rep_name ?? "—");
    }
    return m;
  }, [scorecard]);

  // The patch under the name, as the demo has it — a rep is a person in a
  // place, and "SoCal" is what tells a manager which week they are reading.
  const repPatch = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of scorecard) {
      if (r.membership_id) m.set(r.membership_id, r.territory_name ?? "No territory");
    }
    return m;
  }, [scorecard]);

  // The same week, read through whichever lens is selected. The week comes
  // from the channel rows themselves so the bars and the caption can never
  // disagree, and the future-week guard is the same one thisWeek applies:
  // asking "did they do what they said" about a week nobody has lived yet
  // accuses people of nothing.
  const channelWeek = useMemo(
    () => (loadedAt === null ? null : latestStartedWeek(channel, loadedAt)),
    [channel, loadedAt],
  );

  // Unplanned work is a rep's own number — it is a visit that never had a plan
  // to belong to, so it cannot be attributed to a distributor or a door. It
  // rides along on the rep lens only, from the view that does count it.
  const unplannedByRep = useMemo(() => {
    const m = new Map<string, number>();
    if (!channelWeek) return m;
    for (const r of planned) {
      if (r.week_start !== channelWeek) continue;
      m.set(r.owner_id, (m.get(r.owner_id) ?? 0) + Number(r.unplanned));
    }
    return m;
  }, [planned, channelWeek]);

  // Grouped by what is wrong, with the people it belongs to — the demo's
  // "what's slipping", which is a manager's read of the same exception union
  // a rep sees one row at a time.
  const slippingGroups = useMemo(() => {
    const map = new Map<string, { count: number; who: Set<string>; account: boolean }>();
    for (const e of slipping) {
      if (!e.exception_type) continue;
      const cur = map.get(e.exception_type) ?? {
        count: 0,
        who: new Set<string>(),
        account: e.subject_type === "account",
      };
      cur.count += 1;
      const who = e.owner_membership_id ? repName.get(e.owner_membership_id) : null;
      if (who) cur.who.add(who);
      map.set(e.exception_type, cur);
    }
    return [...map.entries()]
      .map(([type, v]) => ({
        type,
        count: v.count,
        who: [...v.who].sort(),
        account: v.account,
        danger: DANGER_EXCEPTIONS.has(type),
      }))
      .sort((a, b) => Number(b.danger) - Number(a.danger) || b.count - a.count);
  }, [slipping, repName]);

  const byStage = useMemo(() => {
    const map = new Map<string, { count: number; value: number; weighted: number }>();
    for (const row of pipeline) {
      const cur = map.get(row.stage) ?? { count: 0, value: 0, weighted: 0 };
      cur.count += Number(row.opportunity_count);
      cur.value += Number(row.total_value);
      cur.weighted += Number(row.weighted_value);
      map.set(row.stage, cur);
    }
    return map;
  }, [pipeline]);

  const totals = useMemo(() => {
    let active = 0;
    let weighted = 0;
    let openCount = 0;
    for (const stage of FUNNEL) {
      const row = byStage.get(stage);
      if (!row) continue;
      active += row.value;
      weighted += row.weighted;
      openCount += row.count;
    }
    return {
      active,
      weighted,
      openCount,
      won: byStage.get("WON")?.count ?? 0,
      lost: byStage.get("LOST")?.count ?? 0,
      quotes: byStage.get("QUOTE")?.count ?? 0,
      onHold: byStage.get("ON_HOLD")?.count ?? 0,
    };
  }, [byStage]);

  const funnelMax = useMemo(
    () => Math.max(1, ...FUNNEL.map((s) => byStage.get(s)?.value ?? 0)),
    [byStage],
  );

  const thisWeekFlow = flow[0];

  const plannedRecent = useMemo(() => {
    // Roll the per-rep rows up to one line per week for the summary table.
    const map = new Map<string, { planned: number; done: number; unplanned: number }>();
    for (const row of planned) {
      const cur = map.get(row.week_start) ?? { planned: 0, done: 0, unplanned: 0 };
      cur.planned += Number(row.planned_total);
      cur.done += Number(row.planned_done);
      cur.unplanned += Number(row.unplanned);
      map.set(row.week_start, cur);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 6);
  }, [planned]);

  return (
    <div className="flex flex-col gap-7">
      {/* title lives in the nav bar; --data-1 is a global token validated
          against the GMX surfaces */}
      {error && (
        <p className="t-sub" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      {/* HubSpot sync health (Task 13) — manager/admin only, and only once
          HubSpot is actually connected; a rep or an unconfigured org sees
          nothing here. */}
      {hubspotHealth && (
        <div className="card card-pad">
          <div className="t-meta uppercase tracking-wide">HubSpot sync</div>
          <div className="mt-1 text-sm">
            {hubspotHealth.unresolvedErrors > 0
              ? `${hubspotHealth.unresolvedErrors} change${hubspotHealth.unresolvedErrors === 1 ? "" : "s"} need${hubspotHealth.unresolvedErrors === 1 ? "s" : ""} attention`
              : hubspotHealth.lastPassAt
                ? `Up to date · last pass ${timeOfDay.format(new Date(hubspotHealth.lastPassAt))}`
                : "Up to date"}
          </div>
        </div>
      )}

      {/* Commercial overview — headline numbers are tiles, not charts */}
      <section className="grid grid-cols-2 gap-3">
        <StatTile
          label="Active pipeline"
          value={money.format(totals.active)}
          hint={`${totals.openCount} open opportunit${totals.openCount === 1 ? "y" : "ies"}`}
        />
        <StatTile
          label="Weighted"
          // a confident $0 beside a real pipeline reads as a bug; the honest
          // answer is "nobody has set probabilities yet"
          value={
            totals.weighted === 0 && totals.active > 0
              ? "—"
              : money.format(totals.weighted)
          }
          hint={
            totals.weighted === 0 && totals.active > 0
              ? "no probabilities set yet"
              : "value × probability"
          }
        />
        <StatTile
          label="Quotes outstanding"
          value={String(totals.quotes)}
          hint={totals.onHold > 0 ? `${totals.onHold} on hold` : undefined}
        />
        <StatTile
          label="Won / lost"
          value={`${totals.won} / ${totals.lost}`}
          hint={
            thisWeekFlow
              ? `${thisWeekFlow.advanced} advanced, ${thisWeekFlow.created} new this week`
              : "no movement recorded yet"
          }
        />
      </section>

      {/* The same lens the manager's home leads with — one component, so the
          landing and the report can never show different numbers for the same
          week. */}
      <PlanLens
        rows={channel}
        repName={repName}
        repPatch={repPatch}
        unplannedByRep={unplannedByRep}
        nowMs={loadedAt}
      />

      {/* Bianca's tracker, drawn as the journey a branch walks. */}
      {rollout && <RolloutTimeline counts={rollout} />}

      {/* What's slipping. The same exception union the rep meets one row at a
          time, read as a list of problems with names against them. */}
      {slippingGroups.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">What&rsquo;s slipping</h2>
            <span className="t-meta">{slipping.length}</span>
          </div>
          <ul className="list">
            {slippingGroups.map((g) => {
              const body = (
                <>
                  <span className="row-body">
                    <span className="t-title block truncate">
                      {exceptionLabel(g.type)}
                    </span>
                    <span className="t-sub block truncate">
                      {g.who.length > 0 ? g.who.join(", ") : "across the chain"}
                    </span>
                  </span>
                  <span
                    className="t-title tabular-nums"
                    style={g.danger ? { color: "var(--danger)" } : undefined}
                  >
                    {g.count}
                  </span>
                </>
              );
              // Account-shaped exceptions have a list to land on; the rest
              // would be a link to nowhere, so they stay as rows.
              return (
                <li key={g.type}>
                  {g.account ? (
                    <Link href="/accounts" className="row">
                      {body}
                    </Link>
                  ) : (
                    <div className="row">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <MonthByMonth rows={wonMonths} nowMs={loadedAt} />

      {/* Pipeline by stage — one series, so bar length carries everything and
          the heading names it; values are direct-labelled. */}
      {/* section heads speak the same dialect as every other screen —
          bold sentence case, count/action on the right */}
      <section>
        <div className="section-head">
          <h2 className="t-section">Pipeline by stage</h2>
        </div>
        {totals.openCount === 0 ? (
          <p className="text-sm opacity-60">No open opportunities yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {FUNNEL.map((stage) => {
              const row = byStage.get(stage);
              const value = row?.value ?? 0;
              const pct = (value / funnelMax) * 100;
              return (
                <div
                  key={stage}
                  // Geometry stays in inline styles: the bar width is data-driven
                  // anyway, and it keeps the mark independent of utility-class
                  // generation.
                  style={{
                    display: "grid",
                    gridTemplateColumns: "7.5rem 1fr auto",
                    alignItems: "center",
                    gap: "0.75rem",
                  }}
                  title={`${stage.replaceAll("_", " ")}: ${row?.count ?? 0} opportunities, ${money.format(value)} (weighted ${money.format(row?.weighted ?? 0)})`}
                >
                  <span className="truncate text-xs opacity-70">
                    {stage.replaceAll("_", " ")}
                  </span>
                  {/* track keeps every row the same height so the bars share a
                      baseline; 4px rounded data-end, square at the axis */}
                  <div style={{ height: "1.25rem" }}>
                    <div
                      style={{
                        width: `${Math.max(pct, value > 0 ? 2 : 0)}%`,
                        height: "100%",
                        background: "var(--data-1)",
                        borderRadius: "0 4px 4px 0",
                      }}
                    />
                  </div>
                  <span className="tabular-nums text-xs opacity-70">
                    {row?.count ?? 0} · {money.format(value)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Sales representative rollup — many attributes per rep: a table */}
      <section>
        <div className="section-head">
          <h2 className="t-section">By representative</h2>
          <Link href="/weekly" className="t-action">
            Weekly review
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="t-meta text-left uppercase" style={{ borderBottom: "1px solid var(--rule)" }}>
                <th className="py-2 pr-3 font-medium">Rep</th>
                <th className="py-2 pr-3 text-right font-medium">Acts 30d</th>
                <th className="py-2 pr-3 text-right font-medium">Open</th>
                <th className="py-2 pr-3 text-right font-medium">Pipeline</th>
                <th className="py-2 text-right font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {scorecard.map((r) => (
                <tr
                  key={r.membership_id}
                  style={{ borderBottom: "1px solid var(--rule)" }}
                >
                  <td className="py-2 pr-3">
                    {/* The counts answer "is this rep working"; they never say
                        which doors. The name opens their accounts so a manager
                        can go from a number to the thing it is about. */}
                    <Link
                      href={`/accounts?owner=${r.membership_id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {r.rep_name}
                    </Link>
                    {r.territory_name && (
                      <div className="text-xs opacity-60">{r.territory_name}</div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.activities_30d}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {r.open_opportunities}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {money.format(Number(r.pipeline_value))}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.overdue_next_actions > 0 ? (
                      <span
                        className="font-semibold"
                        style={{ color: "var(--danger)" }}
                      >
                        {r.overdue_next_actions}
                      </span>
                    ) : (
                      <span style={{ color: "var(--ink-muted)" }}>0</span>
                    )}
                  </td>
                </tr>
              ))}
              {loaded && scorecard.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-sm opacity-60">
                    No representatives visible.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Planned vs actual (D46) — the manager's real question */}
      <section>
        <div className="section-head">
          <h2 className="t-section">Planned vs actual</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] text-sm">
            <thead>
              <tr className="t-meta text-left uppercase" style={{ borderBottom: "1px solid var(--rule)" }}>
                <th className="py-2 pr-3 font-medium">Week of</th>
                <th className="py-2 pr-3 text-right font-medium">Planned</th>
                <th className="py-2 pr-3 text-right font-medium">Done</th>
                <th className="py-2 pr-3 text-right font-medium">Unplanned</th>
                <th className="py-2 text-right font-medium">Kept</th>
              </tr>
            </thead>
            <tbody>
              {plannedRecent.map(([week, v]) => (
                <tr
                  key={week}
                  style={{ borderBottom: "1px solid var(--rule)" }}
                >
                  <td className="py-2 pr-3">{formatDay(week)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{v.planned}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{v.done}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{v.unplanned}</td>
                  <td className="py-2 text-right tabular-nums">
                    {v.planned === 0
                      ? "—"
                      : `${Math.round((100 * v.done) / v.planned)}%`}
                  </td>
                </tr>
              ))}
              {loaded && plannedRecent.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-sm opacity-60">
                    Nothing planned or recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Territory */}
      <section>
        <div className="section-head">
          <h2 className="t-section">Territory</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="t-meta text-left uppercase" style={{ borderBottom: "1px solid var(--rule)" }}>
                <th className="py-2 pr-3 font-medium">Territory</th>
                <th className="py-2 pr-3 text-right font-medium">Accounts</th>
                <th className="py-2 pr-3 text-right font-medium">Covered 30d</th>
                <th className="py-2 text-right font-medium">Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {territories.map((t) => (
                <tr
                  key={t.territory_id}
                  style={{ borderBottom: "1px solid var(--rule)" }}
                >
                  <td className="py-2 pr-3">
                    <div className="font-medium">{t.territory_name}</div>
                    <div className="text-xs opacity-60">
                      {t.strategic_accounts} strategic · {t.project_count}{" "}
                      {Number(t.project_count) === 1 ? "project" : "projects"}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {t.account_count}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {t.accounts_with_activity_30d}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money.format(Number(t.pipeline_value))}
                  </td>
                </tr>
              ))}
              {loaded && territories.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-sm opacity-60">
                    No territories visible.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
