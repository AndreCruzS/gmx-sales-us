// Task 3 (D-routine): pure, offline-capable routine builder. Mirrors the
// `routine_items` DB view (supabase/migrations/20260729000100_routine.sql)
// exactly, so a rep sees the same chore list whether it was pulled live or
// assembled from the cached working set.
//
// Two things the landed migration settles that earlier planning text got
// wrong — match the migration, not old plan copy:
//   1. No grace period on the overdue boundary. An open chore stays in
//      routine while due_date >= today and escalates to exceptions the
//      instant due_date < today (exception_overdue_follow_up has no
//      configurable window either — see the migration's own comment).
//      `overdue_follow_up_days` is kept on RoutineSettings for interface
//      stability but is not read by this comparison.
//   2. Display checks are included when display_last_verified_at is
//      strictly older than display_routine_months AND not older than
//      display_verify_months; null is excluded (that account belongs to
//      the exception engine, not routine).
//
// Date math is plain string comparison on ISO dates (works because ISO
// dates sort lexicographically) plus Date.setUTCMonth on T00:00:00Z anchors
// for month arithmetic, clamped to match Postgres's end-of-month behavior
// (see addMonths below) and computed in UTC so results don't depend on the
// runtime's local timezone. new Date() in render paths is banned by the
// React-compiler lint; this is lib code, not a component.

import type { CachedAccount, CachedAgendaItem } from "@/lib/offline";

export interface RoutineItem {
  kind: "SAMPLE_FOLLOW_UP" | "QUOTE_FOLLOW_UP" | "DISPLAY_CHECK" | "OTHER";
  itemId: string; // next_action id, or account id for display checks
  accountId: string | null;
  accountName: string;
  action: string;
  contextDate: string; // ISO date the chore was born / last verified
  dueDate: string;
}

export interface RoutineSettings {
  display_routine_months: number;
  display_verify_months: number;
  overdue_follow_up_days: number;
}

const GROUP_ORDER: { kind: RoutineItem["kind"]; label: string }[] = [
  { kind: "SAMPLE_FOLLOW_UP", label: "Samples to follow up" },
  { kind: "QUOTE_FOLLOW_UP", label: "Quotes to chase" },
  { kind: "DISPLAY_CHECK", label: "Display walls to check" },
  { kind: "OTHER", label: "Also on your list" },
];

// The next_action kinds the routine list surfaces as chores. VISIT lives in
// the agenda proper (and feeds debriefWaiting below), never here.
const CHORE_KINDS = new Set<string>(["SAMPLE_FOLLOW_UP", "QUOTE_FOLLOW_UP", "OTHER"]);

/** ISO date (YYYY-MM-DD) `months` after `dateIso`, anchored at UTC midnight.
 *  Mirrors Postgres's `date + make_interval(months => n)` (used by the view
 *  both for the display-check filter boundaries and the returned due_date):
 *  when the target month is shorter than the anchor's day-of-month, Postgres
 *  CLAMPS to the target month's last day. Plain `Date.setMonth` does not
 *  clamp — it OVERFLOWS into the following month instead (e.g.
 *  "2025-10-31" + 4 months would roll to "2026-03-03" instead of the
 *  Postgres-correct "2026-02-28"), which silently disagrees with the live
 *  `routine_items` view right around month-end anchors. Detect the overflow
 *  (result day-of-month < anchor day-of-month) and roll back to day 0 of
 *  the now-current month, i.e. the last day of the intended target month.
 *
 *  Anchored in UTC (not local time) deliberately: `dateIso` is a plain ISO
 *  date with no time-of-day, so treating it as local midnight and then
 *  slicing `toISOString()` (UTC) silently shifts the result back a day in
 *  any timezone ahead of UTC — a real bug caught while verifying this fix
 *  (this machine's Europe/Lisbon zone turned "2025-10-31" + 6 months into
 *  "2026-04-29" instead of the correct "2026-04-30"). UTC-anchored
 *  get/setUTC* math is timezone-independent, so callers get the same answer
 *  in CI as on a dev machine in any zone. */
function addMonths(dateIso: string, months: number): string {
  const anchor = new Date(`${dateIso}T00:00:00Z`);
  const anchorDay = anchor.getUTCDate();
  const result = new Date(anchor);
  result.setUTCMonth(result.getUTCMonth() + months);
  if (result.getUTCDate() < anchorDay) {
    result.setUTCDate(0);
  }
  return result.toISOString().slice(0, 10);
}

export function buildRoutineItems(
  agenda: CachedAgendaItem[],
  accounts: CachedAccount[],
  settings: RoutineSettings,
  todayIso: string,
): RoutineItem[] {
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  // Chores from next_actions, minus escalated ones — mirrors the view's
  // first select.
  const chores: RoutineItem[] = agenda
    .filter(
      (item) =>
        item.completed_at === null &&
        item.kind !== null &&
        CHORE_KINDS.has(item.kind) &&
        item.due_date >= todayIso,
    )
    .map((item) => {
      const account = item.account_id ? accountsById.get(item.account_id) : undefined;
      return {
        kind: item.kind as RoutineItem["kind"],
        itemId: item.id,
        accountId: item.account_id,
        accountName: account?.name ?? "",
        action: item.action,
        contextDate: item.created_at,
        dueDate: item.due_date,
      };
    });

  // Display checks: inside the routine window, before the exception
  // threshold — mirrors the view's second select (union all).
  const displayChecks: RoutineItem[] = accounts
    .filter((a) => a.has_display_wall && a.display_last_verified_at !== null)
    .filter((a) => {
      const verified = a.display_last_verified_at as string;
      const routineBoundary = addMonths(verified, settings.display_routine_months);
      const verifyBoundary = addMonths(verified, settings.display_verify_months);
      return routineBoundary < todayIso && verifyBoundary >= todayIso;
    })
    .map((a) => {
      const verified = a.display_last_verified_at as string;
      return {
        kind: "DISPLAY_CHECK" as const,
        itemId: a.id,
        accountId: a.id,
        accountName: a.name,
        action: "Check the display wall",
        contextDate: verified,
        dueDate: addMonths(verified, settings.display_verify_months),
      };
    });

  return [...chores, ...displayChecks];
}

export function groupRoutine(
  items: RoutineItem[],
): { kind: RoutineItem["kind"]; label: string; items: RoutineItem[] }[] {
  return GROUP_ORDER.map(({ kind, label }) => ({
    kind,
    label,
    items: items.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0);
}

export function debriefWaiting(
  agenda: CachedAgendaItem[],
  todayIso: string,
): CachedAgendaItem[] {
  return agenda.filter(
    (item) =>
      item.kind === "VISIT" && item.due_date < todayIso && item.completed_at === null,
  );
}
