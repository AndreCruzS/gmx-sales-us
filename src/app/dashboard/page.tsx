"use client";

// Management dashboard (spec §15, source PDF §4). Every number here is DERIVED
// from normal system usage — no separate reporting, no new writable state.
// The views are security_invoker, so this one page serves a rep (own numbers),
// a manager (their chain) and an admin (the org) without a role switch.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { DANGER_EXCEPTIONS, exceptionLabel } from "@/lib/domain/exceptions";
import {
  groupFor,
  latestStartedWeek,
  type ChannelRow,
  type Lens,
} from "@/lib/domain/channel";
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
// The rollout funnel, from the California tracker: a branch is gated on four
// things before it can sell. Separate from the opportunity pipeline below,
// which tracks a deal rather than a door.
interface RolloutRow {
  branches: number | null;
  pk_done: number | null;
  merchandiser_done: number | null;
  display_wall_done: number | null;
  material_done: number | null;
  fully_through: number | null;
  not_started: number | null;
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

// The three ways leadership asked to read the team (13 Aug markup): the rep,
// the house the product comes through, and the door it is sold at.
const LENSES: readonly (readonly [Lens, string])[] = [
  ["rep", "By rep"],
  ["distributor", "By distributor"],
  ["dealer", "By dealer"],
];

const LENS_NOUN: Record<Lens, string> = {
  rep: "rep",
  distributor: "distributor",
  dealer: "dealer",
};

/** Where a bar goes when it is clicked. A rep opens their own week; a
 *  distributor or a dealer is an account, and the account page is already the
 *  place that answers "who is this and what is happening there". */
function rowHref(lens: Lens, id: string): string {
  if (lens === "rep") return `/dashboard/rep/${id}`;
  return id === "none" || id === "several" || id === "unassigned"
    ? "/accounts"
    : `/accounts/${id}`;
}

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const timeOfDay = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
const MONTH_DAY = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
/** The Monday a week began, as a date a manager can put against a calendar. */
function weekOf(iso: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : MONTH_DAY.format(d);
}

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
  const [slipping, setSlipping] = useState<ExceptionRow[]>([]);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [rollout, setRollout] = useState<RolloutRow | null>(null);
  const [channel, setChannel] = useState<ChannelRow[]>([]);
  // Which way the team is being read. "By rep" is the opening question a
  // manager asks; the other two are the ones leadership asked for.
  const [lens, setLens] = useState<Lens>("rep");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Admin-only card (Task 13); the route 403s reps, and we render nothing
  // on any non-200 or unconfigured response rather than surface a jargon
  // error a rep can't act on.
  const [hubspotHealth, setHubspotHealth] = useState<HubspotHealth | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [p, s, t, pv, f, ex, ro, ch] = await Promise.all([
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
          "branches, pk_done, merchandiser_done, display_wall_done, material_done, fully_through, not_started",
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
    setRollout(ro.error ? null : ((ro.data as RolloutRow | null) ?? null));
    setChannel(ch.error ? [] : ((ch.data as ChannelRow[]) ?? []));
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

  const groups = useMemo(() => {
    if (!channelWeek) return [];
    return groupFor(
      lens,
      channel.filter((r) => r.week_start === channelWeek),
      repName,
    );
  }, [channel, channelWeek, lens, repName]);

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

      {/* Did they do what they said. A manager's day is people before money,
          so this sits above the pipeline. One bar per rep, the plan they made
          against the part of it they kept — and, since the 13 Aug markup, the
          kept part split by whose distributor business it was. The lens turns
          the same week inside out: by rep, by distributor, by dealer. */}
      {groups.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Did they do what they said</h2>
            {/* An absolute date, not formatDay: that one is relative ("in 5
                days"), which is right on a due date and nonsense after
                "week of". */}
            <span className="t-meta">
              {channelWeek ? `week of ${weekOf(channelWeek)}` : ""}
            </span>
          </div>

          <div className="chip-row mb-3" role="group" aria-label="Look at the week by">
            {LENSES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="chip"
                aria-pressed={lens === key}
                onClick={() => setLens(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="t-sub mb-1 px-1">
            Every bar is one {LENS_NOUN[lens]}&rsquo;s week. Mileage is
            reimbursed, so a visit that was planned and never happened is a cost
            as well as a gap.
          </p>

          <ul className="card card-pad">
            {groups.map((g) => {
              const unplanned = lens === "rep" ? (unplannedByRep.get(g.id) ?? 0) : 0;
              // done already contains owed: the solid teal is the part that was
              // written up, and the clay beside it is the part that was not.
              const bar: readonly (readonly [string, number])[] = [
                ["is-done", g.done - g.owed],
                ["is-owed", g.owed],
                ["is-missed", g.missed],
                ["is-left", g.left],
              ];
              const note = g.missed
                ? `${g.missed} never happened`
                : g.owed
                  ? `${g.owed} owes a note`
                  : g.left
                    ? `${g.left} still to come`
                    : "all logged";
              return (
                <li key={g.id}>
                  <Link href={rowHref(lens, g.id)} className="pva-row">
                    <span>
                      <span className="pva-name">{g.label}</span>
                      <span className="pva-sub">
                        {lens === "rep"
                          ? (repPatch.get(g.id) ?? "—")
                          : `${g.segments.length} ${g.segments.length === 1 ? "door" : "doors"}`}
                      </span>
                    </span>
                    <span
                      className="pva-track"
                      role="img"
                      aria-label={`${g.done} of ${g.total} planned visits done; ${note}`}
                    >
                      {bar.map(([cls, n]) =>
                        n > 0 ? (
                          <span
                            key={cls}
                            className={`pva-seg ${cls}`}
                            style={{ flex: n }}
                          />
                        ) : null,
                      )}
                    </span>
                    <span className="pva-fig">
                      {g.done}/{g.total}
                      <small>
                        {note}
                        {unplanned > 0 ? ` · ${unplanned} unplanned` : ""}
                      </small>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <p className="pva-legend">
            <span>
              <i className="pva-seg is-done" />
              done and logged
            </span>
            <span>
              <i className="pva-seg is-owed" />
              done, owes a note
            </span>
            <span>
              <i className="pva-seg is-missed" />
              never happened
            </span>
            <span>
              <i className="pva-seg is-left" />
              still to come
            </span>
          </p>
        </section>
      )}

      {/* Getting dealers selling. Four gates from the rollout tracker, shown
          as four independent bars rather than a funnel, because they complete
          out of order — walls go up with no merchandiser behind them, and a
          funnel would report that branch as further along than it is. */}
      {rollout && (rollout.branches ?? 0) > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Getting dealers selling</h2>
            <span className="t-meta">{rollout.branches} branches</span>
          </div>
          <ul className="stack-sm">
            {(
              [
                ["PK class done", rollout.pk_done],
                ["Merchandiser assigned", rollout.merchandiser_done],
                ["Display wall up", rollout.display_wall_done],
                ["Material in stock", rollout.material_done],
              ] as const
            ).map(([label, done]) => {
              const n = done ?? 0;
              const total = rollout.branches ?? 0;
              const pct = total === 0 ? 0 : Math.round((100 * n) / total);
              return (
                <li key={label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="t-title">{label}</span>
                    <span className="t-meta tabular-nums">
                      {n}/{total}
                    </span>
                  </div>
                  <div
                    className="mt-1 flex h-2 overflow-hidden rounded"
                    style={{ background: "var(--rule)" }}
                    role="img"
                    aria-label={`${n} of ${total} branches: ${label}`}
                  >
                    <span
                      style={{
                        width: `${pct}%`,
                        background: "var(--accent, currentColor)",
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="t-sub px-1">
            {rollout.fully_through} through all four
            {(rollout.not_started ?? 0) > 0
              ? `, ${rollout.not_started} not started`
              : ""}
            . A branch can clear a later gate with an earlier one still open —
            that gap is the queue.
          </p>
        </section>
      )}

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
