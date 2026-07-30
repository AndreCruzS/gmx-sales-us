"use client";

// Home — the launcher: glance, then go. Everything on this screen answers
// "what does today need from me" in the order a rep asks it: the day ahead,
// the to-do list, what's flagged, what's waiting on a decision, then the
// four fastest ways in (scan, talk, browse, add). Counts come from the
// cache first (D56) so the screen is honest with no signal; the sync
// engine's background pull fills in behind — Home never fetches its own
// copy of the working set, it only reads what's already local.
//
// The one exception is "Needs attention": that number is server truth
// (danger-tier exceptions), so it's fetched here directly and its count is
// mirrored into meta `attention_count` for the next cold start offline —
// the same D56 pattern the old Today page used, scoped to the danger tier
// only (hygiene warnings stay on /visits, not this screen).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import {
  BuildingIcon,
  FileIcon,
  MicrophoneIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "@/components/icons";
import { syncStatusLabel } from "@/components/sync-badge";
import { humanize } from "@/lib/domain/enums";
import { displayAccountName } from "@/lib/format";
import {
  getOfflineLayer,
  type CachedAccount,
  type CachedActivity,
  type CachedAgendaItem,
  type CachedContact,
} from "@/lib/offline";
import {
  buildRoutineItems,
  debriefWaiting,
  groupRoutine,
  type RoutineItem,
  type RoutineSettings,
} from "@/lib/routine/items";
import { useReviewCount } from "@/lib/review/count";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Same two alarm tiers as /visits: a broken promise or money on the table is
// danger, hygiene the system noticed is attention. Home surfaces the danger
// tier only — that's the number worth a glance on the way out the door.
const DANGER_EXCEPTION_TYPES = [
  "OVERDUE_FOLLOW_UP",
  "QUOTE_NO_FOLLOW_UP",
  "OPPORTUNITY_NO_NEXT_ACTION",
  "STRATEGIC_ACCOUNT_QUIET",
];

// "Visit" activities are the *_VISIT-suffixed types (DEALER_VISIT,
// DISTRIBUTOR_VISIT, JOBSITE_VISIT) — phone calls, emails and follow-ups
// aren't a visit even when they're about one.
const VISIT_ACTIVITY_SUFFIX = "_VISIT";

interface ExceptionRow {
  exception_type: string;
  title: string | null;
  detail: string | null;
}

const DEFAULT_SETTINGS: RoutineSettings = {
  display_routine_months: 4,
  display_verify_months: 6,
  overdue_follow_up_days: 7,
};

const VISIT_HORIZON_DAYS = 14;

const ROUTINE_KIND_LABEL: Record<RoutineItem["kind"], [string, string]> = {
  SAMPLE_FOLLOW_UP: ["sample", "samples"],
  QUOTE_FOLLOW_UP: ["quote", "quotes"],
  DISPLAY_CHECK: ["display", "displays"],
  OTHER: ["other", "other"],
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

// Monday-anchored calendar week containing `todayIso` — matches the rep
// language elsewhere in the app ("brief the manager Monday morning").
function weekBounds(todayIso: string): { start: string; end: string } {
  const anchor = new Date(`${todayIso}T00:00:00Z`);
  const day = anchor.getUTCDay(); // 0 = Sunday
  const sinceMonday = day === 0 ? 6 : day - 1;
  const start = addDays(todayIso, -sinceMonday);
  const end = addDays(start, 6);
  return { start, end };
}

function weekdayShort(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

function formatFullDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// The cache only ever holds an email, never a display name — the greeting
// reads the local part the way a rep would introduce themselves ("marcus" →
// "Marcus", "m.reyes" → "M").
function firstNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const first = local.split(/[._+-]/)[0] || local;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

function parseSettings(raw: string | null): RoutineSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<RoutineSettings>;
    return {
      display_routine_months:
        typeof parsed.display_routine_months === "number"
          ? parsed.display_routine_months
          : DEFAULT_SETTINGS.display_routine_months,
      display_verify_months:
        typeof parsed.display_verify_months === "number"
          ? parsed.display_verify_months
          : DEFAULT_SETTINGS.display_verify_months,
      // org_settings (D-routine cache) never carries this key today — the
      // grace period on the overdue boundary isn't configurable client-side
      // (see items.ts's comment on why the builder doesn't read it either).
      overdue_follow_up_days: DEFAULT_SETTINGS.overdue_follow_up_days,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function HomeClient() {
  const { profile, status } = useOffline();
  const reviewCount = useReviewCount();

  const [todayIso, setTodayIso] = useState("");
  const [hour, setHour] = useState<number | null>(null);
  const [agenda, setAgenda] = useState<CachedAgendaItem[]>([]);
  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [contacts, setContacts] = useState<CachedContact[]>([]);
  const [activities, setActivities] = useState<CachedActivity[]>([]);
  const [settings, setSettings] = useState<RoutineSettings>(DEFAULT_SETTINGS);
  const [attention, setAttention] = useState<number | null>(null);
  const [attentionDetail, setAttentionDetail] = useState<ExceptionRow | null>(
    null,
  );
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const layer = getOfflineLayer();
    const [a, accts, cts, acts, settingsRaw] = await Promise.all([
      layer.local.getAgenda(),
      layer.local.getAccounts(),
      layer.local.getContacts(),
      layer.local.getRecentActivities(),
      layer.local.getMeta("org_settings"),
    ]);
    setAgenda(a);
    setAccounts(accts);
    setContacts(cts);
    setActivities(acts);
    setSettings(parseSettings(settingsRaw));
    setTodayIso(isoDate(new Date()));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, status.pending, status.lastPulledAt]);

  // The greeting's local hour doesn't depend on the cache — a separate
  // effect keeps `new Date()` out of the render body (React-compiler lint).
  // Deferred via setTimeout (mirrors `load` above): a bare synchronous
  // setState in an effect body trips the "avoid cascading renders" rule.
  useEffect(() => {
    const t = setTimeout(() => setHour(new Date().getHours()), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    const layer = getOfflineLayer();

    async function loadAttention() {
      try {
        // Management by exception (spec §3/§14): RLS scopes to the caller.
        // Two queries, not one filter-after-fetch: a `limit` + client-side
        // filter undercounts once there are more than `limit` total
        // exceptions (danger + attention tiers mixed together). `count:
        // "exact", head: true` with the tier filter server-side gets the
        // real number with zero rows transferred; a second, small query
        // gets just enough detail for the subline.
        const supabase = getSupabaseBrowserClient();
        const [{ count, error: countError }, { data, error: detailError }] =
          await Promise.all([
            supabase
              .from("exceptions")
              .select("*", { count: "exact", head: true })
              .in("exception_type", DANGER_EXCEPTION_TYPES),
            supabase
              .from("exceptions")
              .select("exception_type, title, detail")
              .in("exception_type", DANGER_EXCEPTION_TYPES)
              .order("since", { ascending: true })
              .limit(1),
          ]);
        if (countError) throw new Error(countError.message);
        if (detailError) throw new Error(detailError.message);
        if (cancelled) return;
        const exact = count ?? 0;
        setAttention(exact);
        setAttentionDetail((data as ExceptionRow[])?.[0] ?? null);
        void layer.local.setMeta("attention_count", String(exact));
      } catch {
        // No signal — the last count this device saw is still honest enough
        // for a glance; the detail line is not cached, so it stays generic.
        const cached = await layer.local.getMeta("attention_count");
        if (!cancelled) setAttention(cached !== null ? Number(cached) : null);
      }
    }

    void loadAttention();
    return () => {
      cancelled = true;
    };
  }, [profile, status.lastPulledAt]);

  const routineItems = useMemo(
    () =>
      todayIso ? buildRoutineItems(agenda, accounts, settings, todayIso) : [],
    [agenda, accounts, settings, todayIso],
  );
  const routineGroups = useMemo(() => groupRoutine(routineItems), [routineItems]);

  const waiting = useMemo(
    () => (todayIso ? debriefWaiting(agenda, todayIso) : []),
    [agenda, todayIso],
  );

  const accountsById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  const upcomingVisits = useMemo(() => {
    if (!todayIso) return [];
    const horizon = addDays(todayIso, VISIT_HORIZON_DAYS);
    return agenda
      .filter(
        (i) =>
          i.completed_at === null &&
          // null kind = unclassified (pre-trigger cached row) — /visits
          // treats it as a visit too (visits/page.tsx); tiles must agree
          // with the page they open.
          (i.kind === "VISIT" || i.kind === null) &&
          i.due_date >= todayIso &&
          i.due_date <= horizon,
      )
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [agenda, todayIso]);

  const nextVisit = upcomingVisits[0] ?? null;
  const moreThisWeek = useMemo(() => {
    if (!nextVisit || !todayIso) return 0;
    const { end } = weekBounds(todayIso);
    return upcomingVisits.filter(
      (v) => v.id !== nextVisit.id && v.due_date <= end,
    ).length;
  }, [upcomingVisits, nextVisit, todayIso]);

  const weekStats = useMemo(() => {
    if (!todayIso) return { completed: 0, planned: 0 };
    const { start, end } = weekBounds(todayIso);
    const planned = agenda.filter(
      (i) =>
        (i.kind === "VISIT" || i.kind === null) &&
        i.due_date >= start &&
        i.due_date <= end,
    );
    const debriefedPlannedIds = new Set(
      planned.filter((i) => i.completed_at !== null).map((i) => i.id),
    );
    // The brief's formula is "agenda + activities": a planned visit debriefed
    // this week is already counted above via completed_at; a walk-in — a
    // visit-type activity recorded with no plan behind it — only shows up
    // here. Dedupe on planned_action_id so a debriefed planned visit's own
    // activity row isn't counted twice, and so two activities that
    // (unusually) share a planned_action_id only add one.
    const seenPlannedIds = new Set<string>();
    const walkIns = activities.filter((a) => {
      const day = a.occurred_at.slice(0, 10);
      if (day < start || day > end) return false;
      if (!a.activity_type.endsWith(VISIT_ACTIVITY_SUFFIX)) return false;
      if (a.planned_action_id) {
        if (debriefedPlannedIds.has(a.planned_action_id)) return false;
        if (seenPlannedIds.has(a.planned_action_id)) return false;
        seenPlannedIds.add(a.planned_action_id);
      }
      return true;
    }).length;
    return {
      completed: debriefedPlannedIds.size + walkIns,
      planned: planned.length,
    };
  }, [agenda, activities, todayIso]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { accounts: [] as CachedAccount[], contacts: [] as CachedContact[] };
    return {
      accounts: accounts
        .filter((a) => `${a.name} ${a.city ?? ""}`.toLowerCase().includes(q))
        .slice(0, 5),
      contacts: contacts
        .filter((c) => c.name.toLowerCase().includes(q))
        .slice(0, 5),
    };
  }, [accounts, contacts, query]);

  const greetingWord =
    hour === null ? "Hello" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = profile ? firstNameFromEmail(profile.email) : "";

  // The exact string SyncBadge renders (D58) — both live on this same
  // screen (NavBar wraps Home), so they must never tell two different
  // stories about the same outbox.
  const syncLine = syncStatusLabel(status);

  const attentionColor = attention && attention > 0 ? "var(--danger)" : "var(--accent-ink)";
  const searching = query.trim().length > 0;

  return (
    <div className="stack pt-2">
      <section>
        <p className="text-[17px] font-extrabold leading-tight" style={{ color: "var(--ink-primary)" }}>
          {greetingWord}
          {firstName ? `, ${firstName}` : ""}
        </p>
        <p className="t-meta mt-0.5">
          {todayIso ? formatFullDate(todayIso) : " "} · {syncLine}
        </p>
      </section>

      <section>
        <label className="search-field">
          <SearchIcon size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts and contacts"
            type="search"
            enterKeyHint="search"
            aria-label="Search accounts and contacts"
          />
          {searching && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="shrink-0"
            >
              <XIcon size={16} style={{ color: "var(--ink-muted)" }} />
            </button>
          )}
        </label>
      </section>

      {searching ? (
        <section>
          <div className="section-head">
            <h2 className="t-section">Matches</h2>
            <span className="t-meta">
              {searchResults.accounts.length + searchResults.contacts.length}
            </span>
          </div>
          {searchResults.accounts.length === 0 && searchResults.contacts.length === 0 ? (
            <p className="t-sub px-1">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
          ) : (
            <ul className="list">
              {searchResults.accounts.map((a) => (
                <li key={`a-${a.id}`}>
                  <Link href={`/accounts/${a.id}`} className="row">
                    <span className="row-lead">
                      <BuildingIcon size={16} />
                    </span>
                    <span className="row-body">
                      <span className="t-title block truncate">
                        {displayAccountName(a.name)}
                      </span>
                      {a.city && <span className="t-sub block truncate">{a.city}</span>}
                    </span>
                  </Link>
                </li>
              ))}
              {searchResults.contacts.map((c) => (
                <li key={`c-${c.id}`}>
                  <Link href={`/accounts/${c.account_id}`} className="row">
                    <span className="row-lead">
                      <BuildingIcon size={16} />
                    </span>
                    <span className="row-body">
                      <span className="t-title block truncate">{c.name}</span>
                      <span className="t-sub block truncate">
                        {accountsById.get(c.account_id)?.name
                          ? displayAccountName(accountsById.get(c.account_id)!.name)
                          : "Contact"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <section>
            <Link href="/visits" className="card card-pad flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span
                  className="block text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: "var(--ink-muted)" }}
                >
                  Visits coming
                </span>
                {nextVisit ? (
                  <>
                    <span className="t-title mt-0.5 block truncate">
                      {weekdayShort(nextVisit.due_date)} ·{" "}
                      {nextVisit.account_id
                        ? displayAccountName(
                            accountsById.get(nextVisit.account_id)?.name ?? "",
                          )
                        : "No account"}
                    </span>
                    <span className="t-sub mt-0.5 block truncate">
                      {nextVisit.objective ? humanize(nextVisit.objective) : "Visit"}
                      {moreThisWeek > 0
                        ? ` · ${moreThisWeek} more this week`
                        : ""}
                    </span>
                  </>
                ) : (
                  <span className="t-sub mt-0.5 block">
                    Nothing planned in the next two weeks
                  </span>
                )}
              </span>
              <span
                className="shrink-0 text-[26px] font-extrabold leading-none"
                style={{ color: "var(--accent-ink)" }}
              >
                {upcomingVisits.length}
              </span>
            </Link>
          </section>

          <section>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/routine" className="card card-pad flex flex-col gap-0.5">
                <span className="text-[26px] font-extrabold leading-none" style={{ color: "var(--accent-ink)" }}>
                  {routineItems.length}
                </span>
                <span className="text-[11px] font-semibold" style={{ color: "var(--ink-secondary)" }}>
                  Routine
                </span>
                <span className="t-meta block">
                  {routineGroups.length === 0
                    ? "Nothing due"
                    : routineGroups
                        .map((g) => {
                          const [singular, plural] = ROUTINE_KIND_LABEL[g.kind];
                          return `${g.items.length} ${g.items.length === 1 ? singular : plural}`;
                        })
                        .join(" · ")}
                </span>
              </Link>

              <Link href="/visits" className="card card-pad flex flex-col gap-0.5">
                <span className="text-[26px] font-extrabold leading-none" style={{ color: attentionColor }}>
                  {attention ?? "–"}
                </span>
                <span className="text-[11px] font-semibold" style={{ color: "var(--ink-secondary)" }}>
                  Needs attention
                </span>
                <span className="t-meta block truncate">
                  {attentionDetail
                    ? displayAccountName(attentionDetail.title ?? "") ||
                      humanize(attentionDetail.exception_type)
                    : attention === null
                      ? "No signal yet"
                      : attention > 0
                        ? "Take a look when you can"
                        : "Nothing flagged"}
                </span>
              </Link>

              <Link href="/review" className="card card-pad flex flex-col gap-0.5">
                <span className="text-[26px] font-extrabold leading-none" style={{ color: "var(--accent-ink)" }}>
                  {reviewCount}
                </span>
                <span className="text-[11px] font-semibold" style={{ color: "var(--ink-secondary)" }}>
                  Waiting your OK
                </span>
                <span className="t-meta block">
                  {reviewCount > 0 ? "Drafts and new contacts to confirm" : "Nothing waiting"}
                </span>
              </Link>

              <Link href="/dashboard" className="card card-pad flex flex-col gap-0.5">
                <span className="text-[26px] font-extrabold leading-none" style={{ color: "var(--accent-ink)" }}>
                  {weekStats.completed}
                  <span className="text-sm font-semibold" style={{ color: "var(--ink-muted)" }}>
                    /{weekStats.planned}
                  </span>
                </span>
                <span className="text-[11px] font-semibold" style={{ color: "var(--ink-secondary)" }}>
                  Visits this week
                </span>
                <span className="t-meta block">
                  {weekStats.planned === 0
                    ? "Nothing planned this week"
                    : weekStats.completed >= weekStats.planned
                      ? "All done for the week"
                      : `${weekStats.planned - weekStats.completed} still open`}
                </span>
              </Link>
            </div>
          </section>

          <section>
            <div className="grid grid-cols-4 gap-2">
              <Link href="/record?mode=card" className="card flex flex-col items-center justify-center gap-1.5 py-3">
                <FileIcon size={18} style={{ color: "var(--accent-ink)" }} />
                <span className="text-center text-[10px] font-semibold" style={{ color: "var(--ink-primary)" }}>
                  Scan card
                </span>
              </Link>
              <Link href="/record" className="card flex flex-col items-center justify-center gap-1.5 py-3">
                <MicrophoneIcon size={18} style={{ color: "var(--accent-ink)" }} />
                <span className="text-center text-[10px] font-semibold" style={{ color: "var(--ink-primary)" }}>
                  Voice note
                </span>
              </Link>
              <Link href="/accounts" className="card flex flex-col items-center justify-center gap-1.5 py-3">
                <BuildingIcon size={18} style={{ color: "var(--accent-ink)" }} />
                <span className="text-center text-[10px] font-semibold" style={{ color: "var(--ink-primary)" }}>
                  Accounts
                </span>
              </Link>
              <Link href="/accounts/new" className="card flex flex-col items-center justify-center gap-1.5 py-3">
                <PlusIcon size={18} style={{ color: "var(--accent-ink)" }} />
                <span className="text-center text-[10px] font-semibold" style={{ color: "var(--ink-primary)" }}>
                  Add account
                </span>
              </Link>
            </div>
          </section>

          {waiting.length > 0 && (
            <section>
              <div className="card card-pad" style={{ background: "var(--surface-accent)" }}>
                <span
                  className="block text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: "var(--ink-muted)" }}
                >
                  Debrief waiting
                </span>
                <ul className="mt-1.5 flex flex-col">
                  {waiting.slice(0, 3).map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/record?visit=${item.id}`}
                        className="flex items-center justify-between gap-2 py-1.5"
                      >
                        <span className="t-title truncate" style={{ fontSize: 13 }}>
                          {weekdayShort(item.due_date)} ·{" "}
                          {item.account_id
                            ? displayAccountName(
                                accountsById.get(item.account_id)?.name ?? "",
                              )
                            : "Visit"}
                        </span>
                        <span className="tag tag-solid shrink-0">How did it go?</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {waiting.length > 3 && (
                  <p className="t-meta mt-1">and {waiting.length - 3} more</p>
                )}
              </div>
            </section>
          )}

        </>
      )}
    </div>
  );
}
