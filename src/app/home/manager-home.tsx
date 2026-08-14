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
import { ChevronRightIcon } from "@/components/icons";
import { groupByRep, latestStartedWeek, type ChannelRow } from "@/lib/domain/channel";
import { DANGER_EXCEPTIONS, exceptionLabel } from "@/lib/domain/exceptions";
import { compareByNeed, repState, teamNarrative } from "@/lib/domain/team";
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
interface TodayRow {
  owner_id: string;
}
interface RolloutRow {
  branches: number | null;
  pk_done: number | null;
  merchandiser_done: number | null;
  display_wall_done: number | null;
  material_done: number | null;
  fully_through: number | null;
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
  const [todayRows, setTodayRows] = useState<TodayRow[]>([]);
  const [rollout, setRollout] = useState<RolloutRow | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [hour, setHour] = useState<number | null>(null);

  // The clock is an external system; stamped once, never read during a render.
  useEffect(() => {
    const t = setTimeout(() => setHour(new Date().getHours()), 0);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    const [ch, sc, ex, td, ro] = await Promise.all([
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
      // Who has stops on today — the only "where they are" this database can
      // actually answer for.
      supabase.from("next_actions").select("owner_id").eq("due_date", todayIso),
      supabase
        .from("dashboard_rollout")
        .select(
          "branches, pk_done, merchandiser_done, display_wall_done, material_done, fully_through",
        )
        .maybeSingle(),
    ]);
    setChannel(ch.error ? [] : ((ch.data as ChannelRow[]) ?? []));
    setScorecard(sc.error ? [] : ((sc.data as ScorecardRow[]) ?? []));
    setSlipping(ex.error ? [] : ((ex.data as ExceptionRow[]) ?? []));
    setTodayRows(td.error ? [] : ((td.data as TodayRow[]) ?? []));
    setRollout(ro.error ? null : ((ro.data as RolloutRow | null) ?? null));
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

  const stopsToday = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of todayRows) m.set(r.owner_id, (m.get(r.owner_id) ?? 0) + 1);
    return m;
  }, [todayRows]);

  const week = useMemo(
    () => (loadedAt === null ? null : latestStartedWeek(channel, loadedAt)),
    [channel, loadedAt],
  );

  const team = useMemo(() => {
    if (!week) return [];
    const names = new Map([...repMeta].map(([id, v]) => [id, v.name]));
    return groupByRep(
      channel.filter((r) => r.week_start === week),
      names,
    )
      .map((g) => {
        const meta = repMeta.get(g.id);
        return {
          ...g,
          name: meta?.name ?? g.label,
          patch: meta?.patch ?? "No patch",
          state: repState({
            todayStops: stopsToday.get(g.id) ?? 0,
            owed: g.owed,
            missed: g.missed,
          }),
        };
      })
      .sort(compareByNeed);
  }, [channel, week, repMeta, stopsToday]);

  const narrative = useMemo(() => teamNarrative(team), [team]);

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

  const gates = useMemo(() => {
    if (!rollout || (rollout.branches ?? 0) === 0) return null;
    const total = rollout.branches ?? 0;
    return {
      total,
      done: rollout.fully_through ?? 0,
      rows: [
        ["PK class", rollout.pk_done ?? 0],
        ["Merchandiser", rollout.merchandiser_done ?? 0],
        ["Display wall", rollout.display_wall_done ?? 0],
        ["Material", rollout.material_done ?? 0],
      ] as const,
    };
  }, [rollout]);

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

      <section>
        <div className="section-head">
          <h2 className="t-section">
            The team <span style={{ color: "var(--ink-muted)" }}>&amp; where they are</span>
          </h2>
          <Link href="/dashboard" className="t-action">
            The whole book
          </Link>
        </div>
        {team.length === 0 ? (
          <p className="t-sub px-1">No plans on the book this week.</p>
        ) : (
          <ul className="list">
            {team.map((r) => {
              const bar = [
                ["is-done", r.done - r.owed],
                ["is-owed", r.owed],
                ["is-missed", r.missed],
                ["is-left", r.left],
              ] as const;
              return (
                <li key={r.id}>
                  <Link href={`/dashboard/rep/${r.id}`} className="row">
                    <span
                      className="navbar-avatar shrink-0"
                      aria-hidden="true"
                      style={{ width: 36, height: 36, fontSize: 12 }}
                    >
                      {r.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="row-body">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="t-title truncate">{r.name}</span>
                        <span className="t-meta shrink-0 tabular-nums">
                          {r.done}/{r.total}
                        </span>
                      </span>
                      <span className="t-sub block truncate">{r.patch}</span>
                      <span
                        className="mt-1.5 flex h-2 overflow-hidden rounded"
                        style={{ background: "var(--rule)" }}
                        role="img"
                        aria-label={`${r.done} of ${r.total} planned visits done`}
                      >
                        {bar.map(([cls, n]) =>
                          n > 0 ? (
                            <span key={cls} className={`pva-seg ${cls}`} style={{ flex: n }} />
                          ) : null,
                        )}
                      </span>
                      <span
                        className="t-meta mt-1 block"
                        style={{ color: r.state.alarm ? "var(--danger)" : undefined }}
                      >
                        {r.state.label}
                      </span>
                    </span>
                    <ChevronRightIcon
                      size={16}
                      style={{ color: "var(--ink-muted)", flexShrink: 0 }}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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

      {gates && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Getting dealers selling</h2>
            <span className="t-meta">
              {gates.done}/{gates.total} through
            </span>
          </div>
          <div className="card card-pad">
            <ul className="flex flex-col gap-2.5">
              {gates.rows.map(([label, n]) => (
                <li key={label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="t-sub">{label}</span>
                    <span className="t-meta tabular-nums">
                      {n}/{gates.total}
                    </span>
                  </div>
                  <div
                    className="mt-1 flex h-2 overflow-hidden rounded"
                    style={{ background: "var(--rule)" }}
                    role="img"
                    aria-label={`${n} of ${gates.total} branches: ${label}`}
                  >
                    <span
                      style={{
                        width: gates.total === 0 ? 0 : `${(100 * n) / gates.total}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
