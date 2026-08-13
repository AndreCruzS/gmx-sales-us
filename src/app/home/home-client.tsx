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
import { buildDayTimeline, type TimelineStop } from "@/lib/routine/day-timeline";
import { useReviewCount } from "@/lib/review/count";
import { DaySpine } from "./day-spine";
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

// A visit's activity type follows the kind of place it was. The account types
// that have no visit form of their own (BUILDER, OTHER) log as OTHER rather
// than being filed as a dealer call they were not.
const VISIT_TYPE_BY_ACCOUNT: Record<string, string> = {
  DEALER: "DEALER_VISIT",
  DISTRIBUTOR: "DISTRIBUTOR_VISIT",
  CONTRACTOR: "CONTRACTOR_MEETING",
  ARCHITECT: "ARCHITECT_MEETING",
};
function visitTypeFor(accountType: string | undefined): string {
  return (accountType && VISIT_TYPE_BY_ACCOUNT[accountType]) || "OTHER";
}

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

  // Stops logged from the spine this session. Held until the pull catches up,
  // so a logged stop cannot reappear as still owing a debrief.
  const [justLogged, setJustLogged] = useState<Set<string>>(new Set());

  // The day in time order, from the same agenda the tiles read. The
  // coming-up filter that used to live here now sits in buildDayTimeline,
  // where it is tested alongside the rest of the day's shape.
  const timeline = useMemo(() => {
    if (!todayIso) return { before: [], after: [], stops: 0, done: 0, needsDebrief: 0 };
    // Derived from todayIso rather than read from the clock: buildDayTimeline
    // only looks at the date part, and reading the clock during render is the
    // impurity that makes a label flip on an unrelated re-render.
    const loggedToday = `${todayIso}T12:00:00.000Z`;
    const withOptimism =
      justLogged.size === 0
        ? agenda
        : agenda.map((i) =>
            justLogged.has(i.id) && i.completed_at === null
              ? { ...i, completed_at: loggedToday }
              : i,
          );
    return buildDayTimeline(
      withOptimism,
      todayIso,
      addDays(todayIso, VISIT_HORIZON_DAYS),
    );
  }, [agenda, todayIso, justLogged]);

  // "Today", "Tomorrow", "Thu" — a stop's own day, not a relative phrase like
  // "in 5 days", which reads wrong beside a time.
  const spineDay = useCallback(
    (iso: string) =>
      iso === todayIso
        ? "Today"
        : todayIso && iso === addDays(todayIso, 1)
          ? "Tomorrow"
          : weekdayShort(iso),
    [todayIso],
  );

  // Logging a debrief from the spine. Two writes, both through the same
  // LWW-guarded outbox /visits uses, so this works with no signal and a stale
  // completion lands in Review rather than overwriting someone:
  //   1. the activity — what actually happened
  //   2. the next_action closed off, so the stop stops asking
  const logDebrief = useCallback(
    async (stop: TimelineStop, note: string) => {
      if (!profile || !stop.accountId) {
        throw new Error("This stop has no account against it — open it to log.");
      }
      const layer = getOfflineLayer();
      const account = accountsById.get(stop.accountId);
      const activityId = crypto.randomUUID();

      await layer.sync.enqueue({
        clientId: activityId,
        entityType: "activity",
        op: "create",
        payload: {
          id: activityId,
          org_id: profile.orgId,
          activity_type: visitTypeFor(account?.account_type),
          primary_account_id: stop.accountId,
          owner_id: profile.membershipId,
          occurred_at: new Date().toISOString(),
          was_planned: true,
          planned_action_id: stop.id,
          objective: stop.objective,
          what_happened: note,
          outcomes: [],
          follow_up_required: false,
        },
        baseVersion: null,
        blobRef: null,
      });

      await layer.sync.enqueue({
        clientId: stop.id,
        entityType: "next_action",
        op: "update",
        payload: { id: stop.id, completed_at: new Date().toISOString() },
        baseVersion: stop.updatedAt, // D61
        blobRef: null,
      });

      // The line also goes to the model, as a typed capture (audio_path null,
      // transcript set — the shape voiceCaptureCreateSchema documents). It
      // carries activity_id, which tells Review this visit is ALREADY logged:
      // the extraction runs only to find the extras a rep should not have to
      // type — the commitments and dates buried in "chase the quote Friday" —
      // and Send links those to this activity instead of filing a second one.
      const captureId = crypto.randomUUID();
      await layer.sync.enqueue({
        clientId: captureId,
        entityType: "voice_capture",
        op: "create",
        payload: {
          id: captureId,
          org_id: profile.orgId,
          owner_id: profile.membershipId,
          audio_path: null,
          transcript: note,
          status: "UPLOADED",
          account_id: stop.accountId,
          planned_action_id: stop.id,
          activity_id: activityId,
        },
        baseVersion: null,
        blobRef: null,
      });

      // Take it off the spine immediately; the drain and the next pull will
      // confirm it. A rep should never watch a spinner to know they logged.
      //
      // This is held in its own set rather than by patching `agenda`, because
      // the drain below triggers a pull, and the pull overwrites agenda from
      // the cache — where the row is still open until the server round-trips.
      // Patching agenda alone let the debrief form come BACK and be submitted
      // again, which filed the same visit twice.
      setJustLogged((prev) => new Set(prev).add(stop.id));
      void layer.sync.drain();
    },
    [profile, accountsById],
  );

  // Stamped when the clock is read, never during render.
  const nowLabel = useMemo(() => {
    if (hour === null) return "today";
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${h12}${hour < 12 ? "AM" : "PM"}`;
  }, [hour]);


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

  // One sentence about the state of the day, assembled from the same numbers
  // the tiles below show — so the sentence and the tiles cannot tell two
  // stories. Clauses that would read "0 things" are dropped rather than
  // padded, and if nothing is outstanding it says so plainly.
  const dayNarrative = useMemo(() => {
    const left = Math.max(0, weekStats.planned - weekStats.completed);
    const parts: string[] = [];
    if (reviewCount > 0) {
      parts.push(
        `${reviewCount} ${reviewCount === 1 ? "capture is" : "captures are"} waiting for your OK`,
      );
    }
    if (attention && attention > 0) {
      parts.push(`${attention} ${attention === 1 ? "account needs" : "accounts need"} attention`);
    }
    if (left > 0) {
      parts.push(`${left} ${left === 1 ? "visit" : "visits"} left this week`);
    }
    if (parts.length === 0) {
      return weekStats.planned > 0
        ? "Everything you planned this week is done and logged."
        : "Nothing outstanding.";
    }
    const sentence = parts.join(", ").replace(/,([^,]*)$/, " and$1");
    return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
  }, [weekStats, reviewCount, attention]);

  const attentionColor = attention && attention > 0 ? "var(--danger)" : "var(--accent-ink)";
  const searching = query.trim().length > 0;

  return (
    <div className="stack pt-2">
      <section>
        <h1
          className="text-[28px] font-extrabold leading-[1.1] tracking-[-0.02em]"
          style={{ color: "var(--ink-primary)" }}
        >
          {greetingWord}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        {/* The demo opens on the state of the day, not the date — a rep
            glancing at this on the way out already knows what day it is. */}
        <p
          className="mt-1.5 text-[14px] leading-[1.45]"
          style={{ color: "var(--ink-secondary)" }}
        >
          {dayNarrative}
        </p>
        <p className="t-meta mt-1.5">
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
          {/* The day as one spine. It replaces the "visits coming" card: that
              one answered "what is next" but never "what did I leave behind",
              which is the half a rep can still do something about. */}
          {timeline.stops > 0 ? (
            <DaySpine
              timeline={timeline}
              accountsById={accountsById}
              formatDay={spineDay}
              nowLabel={nowLabel}
              onDebrief={logDebrief}
            />
          ) : (
            <section>
              <Link href="/visits" className="card card-pad flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span
                    className="block text-[10px] font-bold uppercase tracking-wide"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    Today &amp; what&rsquo;s next
                  </span>
                  <span className="t-sub mt-0.5 block">
                    Nothing planned in the next two weeks
                  </span>
                </span>
              </Link>
            </section>
          )}

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

          {/* The demo's four actions: a 2x2 of real tiles, each with the one
              line that says why you would tap it. Four 10px labels in a row
              read as a toolbar; these read as offers. */}
          <section>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                {
                  href: "/record",
                  Icon: MicrophoneIcon,
                  title: "Talk it through",
                  sub: "Log a visit in 20 seconds",
                },
                {
                  href: "/record?mode=card",
                  Icon: FileIcon,
                  title: "Scan a card",
                  sub: "Add a contact from a card",
                },
                {
                  href: "/accounts",
                  Icon: BuildingIcon,
                  title: "Your accounts",
                  sub:
                    attention && attention > 0
                      ? `${attention} ${attention === 1 ? "needs" : "need"} a visit`
                      : "Browse the territory",
                  warn: !!attention && attention > 0,
                },
                {
                  href: "/accounts/new",
                  Icon: PlusIcon,
                  title: "Add an account",
                  sub: "A new door in the patch",
                },
              ].map(({ href, Icon, title, sub, warn }) => (
                <Link key={href} href={href} className="card card-pad flex flex-col gap-2">
                  <span
                    className="grid h-9 w-9 place-items-center rounded-[10px]"
                    style={{ background: "var(--surface-sunken)" }}
                  >
                    <Icon size={18} style={{ color: "var(--ink-secondary)" }} />
                  </span>
                  <span className="t-title">{title}</span>
                  <span
                    className="text-[12px] leading-[16px]"
                    style={{ color: warn ? "var(--warn-ink)" : "var(--ink-muted)" }}
                  >
                    {sub}
                  </span>
                </Link>
              ))}
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
