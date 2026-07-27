"use client";

// Management dashboard (spec §15, source PDF §4). Every number here is DERIVED
// from normal system usage — no separate reporting, no new writable state.
// The views are security_invoker, so this one page serves a rep (own numbers),
// a manager (their chain) and an admin (the org) without a role switch.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
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

// Pipeline stages in funnel order; WON/LOST/ON_HOLD are outcomes, not stages
// you sit in, so they read as tiles rather than funnel rows.
const FUNNEL = ["IDENTIFIED", "QUALIFIED", "DEVELOPMENT", "QUOTE", "DECISION"];

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

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
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
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
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [p, s, t, pv, f] = await Promise.all([
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
    ]);
    const firstError = [p, s, t, pv, f].map((r) => r.error).find(Boolean);
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
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [profile, load]);

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

      {/* Commercial overview — headline numbers are tiles, not charts */}
      <section className="grid grid-cols-2 gap-3">
        <StatTile
          label="Active pipeline"
          value={money.format(totals.active)}
          hint={`${totals.openCount} open opportunit${totals.openCount === 1 ? "y" : "ies"}`}
        />
        <StatTile
          label="Weighted"
          value={money.format(totals.weighted)}
          hint="value × probability"
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

      {/* Pipeline by stage — one series, so bar length carries everything and
          the heading names it; values are direct-labelled. */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide opacity-60">
          Pipeline by stage
        </h2>
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
                    <div className="font-medium">{r.rep_name}</div>
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
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">
          Planned vs actual
        </h2>
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
                  <td className="py-2 pr-3 tabular-nums">{week}</td>
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
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">
          Territory
        </h2>
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
