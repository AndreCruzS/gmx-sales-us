"use client";

// One rep, opened from their bar on the team view.
//
// Leadership asked to be able to click a bar, and this is what a click is for:
// the bar says a week went 3/5, and a manager's next question is always the
// same — what is behind it, and is the commercial side of this patch moving.
// So the page is the demo's rep panel: the week, the patch, and the money.
//
// Every number here already exists somewhere else in the app. This screen adds
// no new truth, it just puts one person's version of it on one page — which is
// why it reads the same views the team page reads, scoped by RLS rather than
// by a role check.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useOffline } from "@/components/offline-provider";
import { ChevronRightIcon } from "@/components/icons";
import { groupByRep, type ChannelRow } from "@/lib/domain/channel";
import { displayAccountName, formatMoney } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Scorecard {
  membership_id: string;
  rep_name: string;
  territory_name: string | null;
  activities_30d: number;
  open_opportunities: number;
  pipeline_value: number;
  open_next_actions: number;
  overdue_next_actions: number;
  quotes_outstanding: number;
}

interface AccountRow {
  id: string;
  name: string;
  account_type: string;
  has_display_wall: boolean | null;
}

interface ExceptionRow {
  exception_type: string | null;
  subject_id: string | null;
}

/** "Deon Rep" → DR; the same two-letter badge the team list uses. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function Stat({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="t-sub">{label}</span>
      <span
        className="text-[15px] font-bold tabular-nums"
        style={{ color: warn ? "var(--danger)" : "var(--ink-primary)" }}
      >
        {value}
      </span>
    </div>
  );
}

export default function RepPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useOffline();

  const [rep, setRep] = useState<Scorecard | null>(null);
  const [channel, setChannel] = useState<ChannelRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [flags, setFlags] = useState<ExceptionRow[]>([]);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [s, ch, acc, ex] = await Promise.all([
      supabase
        .from("dashboard_rep_scorecard")
        .select(
          "membership_id, rep_name, territory_name, activities_30d, open_opportunities, pipeline_value, open_next_actions, overdue_next_actions, quotes_outstanding",
        )
        .eq("membership_id", id)
        .maybeSingle(),
      supabase
        .from("dashboard_plan_by_channel")
        .select(
          "owner_id, week_start, account_id, account_name, account_type, distributor_id, distributor_name, distributor_options, planned_total, planned_done, planned_owed, planned_missed",
        )
        .eq("owner_id", id)
        .order("week_start", { ascending: false })
        .limit(200),
      supabase
        .from("accounts")
        .select("id, name, account_type, has_display_wall")
        .eq("owner_id", id)
        .order("name")
        .limit(500),
      supabase
        .from("exceptions")
        .select("exception_type, subject_id")
        .eq("subject_type", "account")
        .eq("owner_membership_id", id)
        .limit(500),
    ]);
    setRep(s.error ? null : ((s.data as Scorecard | null) ?? null));
    setChannel(ch.error ? [] : ((ch.data as ChannelRow[]) ?? []));
    setAccounts(acc.error ? [] : ((acc.data as AccountRow[]) ?? []));
    setFlags(ex.error ? [] : ((ex.data as ExceptionRow[]) ?? []));
    setLoadedAt(Date.now());
    setLoaded(true);
  }, [id]);

  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [profile, load]);

  // This week and next, named off the clock stamped at load rather than read
  // during a render.
  const weeks = useMemo(() => {
    if (loadedAt === null) return { current: null, next: null };
    const d = new Date(loadedAt);
    // Monday of the current week, in local time — the same boundary
    // date_trunc('week', …) uses in the view.
    const day = (d.getDay() + 6) % 7;
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
    const iso = (x: Date) =>
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    const nextMonday = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + 7,
    );
    return { current: iso(monday), next: iso(nextMonday) };
  }, [loadedAt]);

  // Pulled out as plain strings: a dependency array wants values it can compare,
  // not an object rebuilt on every render.
  const { current: thisWeek, next: nextWeek } = weeks;

  const week = useMemo(() => {
    if (!thisWeek || !rep) return null;
    const rows = channel.filter((r) => r.week_start === thisWeek);
    if (rows.length === 0) return null;
    return groupByRep(rows, new Map([[id, rep.rep_name]]))[0] ?? null;
  }, [channel, thisWeek, rep, id]);

  const bookedNextWeek = useMemo(
    () =>
      nextWeek === null
        ? 0
        : channel
            .filter((r) => r.week_start === nextWeek)
            .reduce((n, r) => n + r.planned_total, 0),
    [channel, nextWeek],
  );

  const patch = useMemo(() => {
    const flagged = (type: string) =>
      new Set(
        flags.filter((f) => f.exception_type === type).map((f) => f.subject_id),
      );
    const noCaptain = flagged("NO_CHAMPION");
    const wallTrouble = flagged("DISPLAY_NOT_VERIFIED");
    return {
      accounts: accounts.length,
      noCaptain: accounts.filter((a) => noCaptain.has(a.id)).length,
      wallsUp: accounts.filter((a) => a.has_display_wall).length,
      wallsBad: accounts.filter((a) => wallTrouble.has(a.id)).length,
    };
  }, [accounts, flags]);

  if (loaded && !rep) {
    return (
      <div className="stack pt-2">
        <Link href="/dashboard" className="t-action">
          ← Back to the team
        </Link>
        <p className="t-sub px-1">
          That rep isn&rsquo;t in your chain, or hasn&rsquo;t loaded yet.
        </p>
      </div>
    );
  }
  if (!rep) return null;

  const bar: readonly (readonly [string, number])[] = week
    ? [
        ["is-done", week.done - week.owed],
        ["is-owed", week.owed],
        ["is-missed", week.missed],
        ["is-left", week.left],
      ]
    : [];

  return (
    <div className="stack pt-2">
      <Link href="/dashboard" className="t-action">
        ← Back to the team
      </Link>

      <section>
        <div className="flex items-center gap-3">
          <span className="navbar-avatar" aria-hidden="true">
            {initials(rep.rep_name)}
          </span>
          <span>
            <h1 className="text-[24px] font-extrabold tracking-tight">
              {rep.rep_name}
            </h1>
            <p className="t-sub">
              {rep.territory_name ?? "No territory"} · {patch.accounts}{" "}
              {patch.accounts === 1 ? "account" : "accounts"}
            </p>
          </span>
        </div>

        {/* The one sentence a manager reads before any number. */}
        <p className="t-sub mt-2" style={{ maxWidth: "56ch" }}>
          {week
            ? week.missed > 0
              ? `${week.missed} planned ${week.missed === 1 ? "visit" : "visits"} never happened this week.`
              : week.owed > 0
                ? `Owes ${week.owed === 1 ? "a debrief" : `${week.owed} debriefs`} from this week.`
                : week.left > 0
                  ? `${week.left} still ahead of them this week.`
                  : "Everything planned was done and logged."
            : "Nothing planned this week."}{" "}
          {bookedNextWeek === 0
            ? "Next week is empty."
            : `Next week is ${bookedNextWeek === 1 ? "thin — one visit" : `${bookedNextWeek} visits`} booked.`}
        </p>
      </section>

      {/* Miles are not a tile here: mileage is reimbursed and the demo shows it,
          but this app does not track a single mile, and a tile that always
          reads "—" teaches a manager to stop looking at the row. */}
      <section className="grid grid-cols-2 gap-3">
        <div className="card card-pad">
          <div
            className="text-2xl font-bold tracking-tight"
            style={{ color: week?.missed ? "var(--danger)" : "var(--accent-ink)" }}
          >
            {week ? `${week.done}/${week.total}` : "–"}
          </div>
          <div className="t-meta mt-0.5">Visits done this week</div>
        </div>
        <div className="card card-pad">
          <div
            className="text-2xl font-bold tracking-tight"
            style={{ color: week?.missed ? "var(--danger)" : undefined }}
          >
            {week?.missed ?? 0}
          </div>
          <div className="t-meta mt-0.5">Planned, never happened</div>
        </div>
        <div className="card card-pad">
          <div
            className="text-2xl font-bold tracking-tight"
            style={{ color: bookedNextWeek === 0 ? "var(--danger)" : undefined }}
          >
            {bookedNextWeek}
          </div>
          <div className="t-meta mt-0.5">Booked for next week</div>
        </div>
        <div className="card card-pad">
          <div
            className="text-2xl font-bold tracking-tight"
            style={{
              color: rep.overdue_next_actions > 0 ? "var(--danger)" : undefined,
            }}
          >
            {rep.overdue_next_actions}
          </div>
          <div className="t-meta mt-0.5">Follow-ups overdue</div>
        </div>
      </section>

      {week && (
        <section>
          <div className="section-head">
            <h2 className="t-section">This week, day by day</h2>
          </div>
          <div className="card card-pad">
            <div className="pva-row" style={{ cursor: "default" }}>
              <span>
                <span className="pva-name">{rep.rep_name}</span>
                <span className="pva-sub">{rep.territory_name ?? "—"}</span>
              </span>
              <span
                className="pva-track"
                role="img"
                aria-label={`${week.done} of ${week.total} planned visits done`}
              >
                {bar.map(([cls, n]) =>
                  n > 0 ? (
                    <span key={cls} className={`pva-seg ${cls}`} style={{ flex: n }} />
                  ) : null,
                )}
              </span>
              <span className="pva-fig">
                {week.done}/{week.total}
              </span>
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="card card-pad">
          <p className="t-meta uppercase tracking-wide">Their patch</p>
          <div className="mt-1">
            <Stat label="Accounts" value={patch.accounts} />
            <Stat label="With no captain" value={patch.noCaptain} warn={patch.noCaptain > 0} />
            <Stat label="Display walls up" value={patch.wallsUp} />
            <Stat label="Walls in trouble" value={patch.wallsBad} warn={patch.wallsBad > 0} />
          </div>
        </div>

        {/* The commercial half — what leadership means by "it is all about
            their sales". Everything here is money or the promise of it. */}
        <div className="card card-pad">
          <p className="t-meta uppercase tracking-wide">Commercially</p>
          <div className="mt-1">
            <Stat label="Open pipeline" value={formatMoney(rep.pipeline_value)} />
            <Stat label="Open deals" value={rep.open_opportunities} />
            <Stat
              label="Quotes outstanding"
              value={rep.quotes_outstanding}
              warn={rep.quotes_outstanding > 0}
            />
            <Stat label="Visits logged, 30 days" value={rep.activities_30d} />
          </div>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2 className="t-section">Their accounts</h2>
          <Link href={`/accounts?owner=${id}`} className="t-action">
            All {patch.accounts}
          </Link>
        </div>
        {accounts.length === 0 ? (
          <p className="t-sub px-1">No accounts on this patch.</p>
        ) : (
          <ul className="list">
            {accounts.slice(0, 6).map((a) => (
              <li key={a.id}>
                <Link href={`/accounts/${a.id}`} className="row">
                  <span className="row-body">
                    <span className="t-title block truncate">
                      {displayAccountName(a.name)}
                    </span>
                    <span className="t-sub block truncate">
                      {a.account_type.toLowerCase()}
                      {a.has_display_wall ? " · display wall" : ""}
                    </span>
                  </span>
                  <ChevronRightIcon
                    size={16}
                    style={{ color: "var(--ink-muted)", flexShrink: 0 }}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
