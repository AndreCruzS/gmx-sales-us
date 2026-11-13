// PK FOLLOW-UP: the rules behind the PK board. A PK (a visit) is a band; its
// next_actions are the rows. Each row carries "Important?" and a deadline
// (due_date), the priority they give (deadline.ts), a progress status, and
// notes/subtasks.
//
// Pure: rows in, answers out. Dates are 'YYYY-MM-DD'; timestamps are ISO.
// A row is "closed" when `completed_at` is set (Eliminate closes it too).

import type { Database } from "@/lib/database.types";
import {
  addBusinessDays,
  derivePriority,
  keepsEliminated,
  storedPriority,
  urgentCap,
} from "@/lib/domain/deadline";

type Enums = Database["public"]["Enums"];

export const PRIORITIES = ["DO_NOW", "PLAN", "DELEGATE", "ELIMINATE"] as const;
export type Priority = (typeof PRIORITIES)[number];
// Compile-time check that the list matches the DB enum, both ways.
const _same: Priority extends Enums["next_action_priority"] ? (Enums["next_action_priority"] extends Priority ? true : never) : never = true;
void _same;
export type Progress = Enums["next_action_progress"];

/** Days from the PK date to the alert, per priority. Eliminate has none. */
export const DEFAULT_DAYS: Record<Priority, number | null> = {
  DO_NOW: 1,
  PLAN: 7,
  DELEGATE: 2,
  ELIMINATE: null,
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  DO_NOW: "Do now",
  PLAN: "Plan",
  DELEGATE: "Delegate",
  ELIMINATE: "Eliminate",
};

/** One status says where the item stands and whose move it is (2026-11-03:
 *  it replaced the Action required + Status pair, which said it twice). */
export const PROGRESS_LABEL: Record<Progress, string> = {
  NOT_STARTED: "To do",
  WORKING_ON_IT: "In progress",
  WAITING: "Waiting on dealer",
  STUCK: "Stuck",
  DONE: "Done",
};

/** Whose move it is: everything open is ours except what waits on the dealer. */
export function isOnUs(p: Progress): boolean {
  return p === "NOT_STARTED" || p === "WORKING_ON_IT" || p === "STUCK";
}

export interface PkItem {
  id: string;
  action: string;
  owner_id: string;
  due_date: string;
  completed_at: string | null;
  priority: Priority | null;
  priority_days: number | null;
  /** The one answer a person gives; null until they give it (legacy rows). */
  important: boolean | null;
  progress: Progress;
  last_changed_by: string | null;
  last_changed_at: string | null;
  updated_at: string;
  created_via?: "claude" | "muse" | null;
}

export interface PkNote {
  id: string;
  next_action_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  created_via?: "claude" | "muse" | null;
}

export interface PkSubtask {
  id: string;
  next_action_id: string;
  title: string;
  done_at: string | null;
  position: number;
}

/** The bar inside an In progress cell (Bianca and João, 2026-11-06: PK
 *  Control's status cell fills as its subtasks are done). Null for any other
 *  status, and for an item without subtasks. */
export function subtaskBar(
  progress: Progress,
  subtasks: Pick<PkSubtask, "done_at">[],
): { done: number; total: number; pct: number } | null {
  if (progress !== "WORKING_ON_IT" || subtasks.length === 0) return null;
  const done = subtasks.filter((s) => s.done_at !== null).length;
  return { done, total: subtasks.length, pct: Math.round((done / subtasks.length) * 100) };
}

export interface PkRead {
  membership_id: string;
  next_action_id: string;
  last_read_at: string;
}

/** One band on the board: a PK and its follow-ups, or (kind "dealer") a
 *  dealer's tasks that came from no PK (Andre, 2026-11-13: a task is a task,
 *  wherever it was born — they all live on Tasks). */
export interface PkBand {
  /** The PK's activity id, or `dealer:<account id>` for a dealer band. */
  activityId: string;
  /** "pk" when absent. A dealer band's pkDate is its oldest task's day. */
  kind?: "pk" | "dealer";
  accountId: string | null;
  dealer: string;
  pkDate: string;
  location: string | null;
  items: PkItem[];
  /** Who ran the PK (the visit's owner), when known. */
  ranBy?: string | null;
}

/**
 * May this reader move the item (status, priority, days, subtasks)? Its owner
 * may, and so may the desk (spec 2026-11-03 §2). A rep reading someone else's
 * item in his PK sees it read-only, but can still note on it. This mirrors the
 * update policy closely enough to offer the right controls; RLS still decides.
 */
export function canEditItem(ownerId: string, me: string, desk: boolean): boolean {
  return desk || ownerId === me;
}

/** "Joao Manager" → "Joao". */
export function firstNameOf(full: string | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] || "Someone";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar date of an ISO timestamp, 'YYYY-MM-DD'. */
export function pkDateOf(occurredAt: string): string {
  const d = new Date(occurredAt);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The calendar date, 'YYYY-MM-DD', an instant has in a given IANA zone. */
export function calendarDateIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** pkDate + days, on the calendar (no timezone shift). */
export function alertDate(pkDate: string, days: number): string {
  return addDays(pkDate, days);
}

/** The day an item's alert days count from (2026-11-06). An item keeps the
 *  base it got with its first priority (its alert minus its days). One getting
 *  its first priority now counts from today when its PK is already past, so
 *  classifying an old PK's items (the October import) does not make them late
 *  on arrival. */
export function alertBase(
  pkDate: string,
  item: { priority: Priority | null; priority_days: number | null; due_date: string },
  todayIso: string,
): string {
  if (item.priority !== null && item.priority !== "ELIMINATE" && item.priority_days !== null)
    return addDays(item.due_date, -item.priority_days);
  return todayIso > pkDate ? todayIso : pkDate;
}

/** Whole days from one calendar date to another. */
export function daysFrom(from: string, to: string): number {
  const t = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  return Math.round((t(to) - t(from)) / 86_400_000);
}

function hasAlert(i: PkItem): boolean {
  return i.completed_at === null && i.priority !== null && i.priority !== "ELIMINATE";
}

/** The deadline has passed: open, not ELIMINATE, priority set, due_date < today. */
export function isAlertPassed(i: PkItem, today: string): boolean {
  return hasAlert(i) && i.due_date < today;
}

function daysBetween(from: string, to: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(to) - t(from)) / 86_400_000);
}

/** Calendar days from today to the deadline: negative = passed. null for an
 *  item without a priority, Eliminate, or closed. */
export function daysToAlert(i: PkItem, today: string): number | null {
  return hasAlert(i) ? daysBetween(today, i.due_date) : null;
}

/**
 * Band %: 0..1, or null when nothing counts. Each live (non-Eliminate) item
 * counts its subtasks (done / total); an item without subtasks counts as one
 * unit, done when its progress is DONE.
 */
export function bandProgress(items: readonly PkItem[], subtasks: readonly PkSubtask[]): number | null {
  let done = 0;
  let total = 0;
  for (const i of items) {
    if (i.priority === "ELIMINATE") continue;
    const subs = subtasks.filter((s) => s.next_action_id === i.id);
    if (subs.length > 0) {
      total += subs.length;
      done += subs.filter((s) => s.done_at !== null).length;
    } else {
      total += 1;
      if (i.progress === "DONE") done += 1;
    }
  }
  return total === 0 ? null : done / total;
}

/** Something by someone else after my last read. */
export function isUnread(i: PkItem, notes: readonly PkNote[], myRead: PkRead | undefined, me: string): boolean {
  const since = myRead ? new Date(myRead.last_read_at).getTime() : -Infinity;
  const after = (iso: string) => new Date(iso).getTime() > since;
  if (i.last_changed_by !== null && i.last_changed_by !== me && i.last_changed_at !== null && after(i.last_changed_at)) {
    return true;
  }
  return notes.some((n) => n.next_action_id === i.id && n.author_id !== me && after(n.created_at));
}

export interface PkSummary {
  pksOpen: number;
  followUps: number;
  alertPassed: number;
  onUs: number;
  waiting: number;
  newForMe: number;
}

/** The strip atop the board. Closed items (completed_at set, Eliminate included) do not count. */
export function summarize(
  bands: readonly { items: readonly PkItem[] }[],
  unread: (i: PkItem) => boolean,
  today: string,
): PkSummary {
  const s: PkSummary = { pksOpen: 0, followUps: 0, alertPassed: 0, onUs: 0, waiting: 0, newForMe: 0 };
  for (const b of bands) {
    const open = b.items.filter((i) => i.completed_at === null);
    if (open.length > 0) s.pksOpen += 1;
    for (const i of open) {
      s.followUps += 1;
      if (isAlertPassed(i, today)) s.alertPassed += 1;
      if (isOnUs(i.progress)) s.onUs += 1;
      if (i.progress === "WAITING") s.waiting += 1;
      if (unread(i)) s.newForMe += 1;
    }
  }
  return s;
}

/**
 * The priority tag a row shows (2026-11-10). Once "Important?" is answered it
 * follows the deadline (derivePriority), so a row turns Do now as its date
 * comes close without anyone saving it; ELIMINATE here is a hint, not a close.
 * A legacy row (Important? unanswered) shows what is stored, and an Eliminate
 * the person confirmed stays Eliminate.
 */
export function shownPriority(
  i: Pick<PkItem, "important" | "priority" | "due_date">,
  today: string,
  ownerGivesWork: boolean,
): Priority | null {
  if (i.important === null || i.priority === "ELIMINATE") return i.priority;
  return derivePriority(i.important, i.due_date, today, ownerGivesWork);
}

/** The fields a PK item's drawer writes. */
export type PkItemPatch = Partial<
  Pick<PkItem, "priority" | "priority_days" | "due_date" | "important" | "progress" | "completed_at">
>;

/**
 * A priority picked in the drawer (2026-11-10: the PK Control structure stays —
 * Priority, Days, Alert — and the deadline rule runs under it). The pick
 * answers Important? (Do now and Plan yes, Delegate no) and sets the deadline
 * from its default days, counted from `base` (alertBase), so the priority the
 * deadline gives is the one picked:
 *   · Do now and Delegate are urgent: never later than today + 2 business days;
 *   · Plan is not: never sooner than today + 3 business days.
 * A rep owner has no Delegate; were it picked, the rule stores Plan.
 * Eliminate is written alone (it closes the item).
 */
export function pickPatch(
  pick: Priority,
  base: string,
  today: string,
  ownerGivesWork: boolean,
): PkItemPatch {
  if (pick === "ELIMINATE") return { priority: "ELIMINATE" };
  const important = pick !== "DELEGATE";
  let due = alertDate(base, DEFAULT_DAYS[pick] as number);
  if (pick === "PLAN") {
    const floor = addBusinessDays(today, 3);
    if (due < floor) due = floor;
  } else {
    due = urgentCap(due, today);
  }
  return {
    important,
    due_date: due,
    priority: storedPriority(important, due, today, ownerGivesWork),
    priority_days: Math.max(0, daysFrom(base, due)),
  };
}

/**
 * A new deadline from the drawer's Days or date box: the priority follows it
 * (prazo define a urgência) through planPatch.
 */
export function deadlinePatch(
  item: Pick<PkItem, "priority" | "important" | "due_date">,
  due: string,
  base: string,
  today: string,
  ownerGivesWork: boolean,
): PkItemPatch {
  const priority =
    item.important === null ? null : storedPriority(item.important, due, today, ownerGivesWork);
  return planPatch(item, { due_date: due, priority }, base);
}

/**
 * The write for a change of Important? and/or the deadline (drawer, Suggest).
 * The days follow from the deadline, counted from `base` (alertBase). While
 * Important? is unanswered a new deadline leaves a legacy priority be, and a
 * deadline moved on an eliminated item leaves it eliminated (closed).
 */
export function planPatch(
  item: Pick<PkItem, "priority" | "important" | "due_date">,
  change: { important?: boolean | null; due_date?: string; priority: Priority | null },
  base: string,
): PkItemPatch {
  if (change.priority === "ELIMINATE") return { priority: "ELIMINATE" };
  const patch: PkItemPatch = {};
  if (change.important !== undefined) patch.important = change.important;
  if (change.due_date !== undefined) patch.due_date = change.due_date;
  if (keepsEliminated(item.priority, change)) return patch;
  const important = change.important !== undefined ? change.important : item.important;
  const due = change.due_date ?? item.due_date;
  const priority = important === null ? item.priority : change.priority;
  if (important !== null) patch.priority = priority;
  patch.priority_days = priority === null ? null : Math.max(0, daysFrom(base, due));
  return patch;
}

/**
 * The item as the database will hold it after `patch` — what the trigger
 * private.sync_next_action_progress does, mirrored so the board moves at once
 * (Done and Eliminate close the item, Eliminate drops the days, leaving them
 * reopens it, and the change is stamped as mine). The server's row replaces
 * this as soon as the write lands.
 */
export function mirrorUpdate(old: PkItem, patch: PkItemPatch, me: string, now: string): PkItem {
  const n: PkItem = { ...old, ...patch };
  const prioChanged = n.priority !== old.priority;
  const progChanged = n.progress !== old.progress;
  const compChanged = n.completed_at !== old.completed_at;

  if (n.priority === "ELIMINATE") {
    n.priority_days = null;
    if (prioChanged) n.completed_at = n.completed_at ?? now;
  } else if (prioChanged && old.priority === "ELIMINATE" && n.progress !== "DONE" && !compChanged) {
    n.completed_at = null;
  }

  if (n.priority !== "ELIMINATE") {
    if (compChanged && n.completed_at !== null && n.progress !== "DONE") {
      n.progress = "DONE";
    } else if (progChanged) {
      if (n.progress === "DONE") n.completed_at = n.completed_at ?? now;
      else if (old.progress === "DONE") n.completed_at = null;
    } else if (compChanged && old.completed_at !== null && n.completed_at === null && n.progress === "DONE") {
      n.progress = "NOT_STARTED";
    }
  } else if (progChanged && n.progress === "DONE") {
    n.completed_at = n.completed_at ?? now;
  }

  if (
    n.priority !== old.priority ||
    n.priority_days !== old.priority_days ||
    n.progress !== old.progress
  ) {
    n.last_changed_by = me;
    n.last_changed_at = now;
  }
  return n;
}

/** Where Tab goes inside a modal of `count` focusable controls when focus is
 *  at `at` (-1 = outside it): null lets the browser move on its own. */
export function trapTarget(count: number, at: number, back: boolean): number | null {
  if (count === 0) return null;
  if (at === -1) return back ? count - 1 : 0;
  if (back && at === 0) return count - 1;
  if (!back && at === count - 1) return 0;
  return null;
}

/** Where a band's tasks came from, after the dealer's name: "PK Oct 20", or
 *  "No PK" for a dealer's own tasks. `date` formats the PK's day. */
export function bandOrigin(b: Pick<PkBand, "kind" | "pkDate">, date: (iso: string) => string): string {
  return b.kind === "dealer" ? "No PK" : `PK ${date(b.pkDate)}`;
}
