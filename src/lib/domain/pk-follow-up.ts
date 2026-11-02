// PK FOLLOW-UP: the rules behind the PK board. A PK (a visit) is a band; its
// next_actions are the rows. Each row carries a priority (which sets the alert
// date), what is required of whom, a progress status, and notes/subtasks.
//
// Pure: rows in, answers out. Dates are 'YYYY-MM-DD'; timestamps are ISO.
// A row is "closed" when `completed_at` is set (Eliminate closes it too).

import type { Database } from "@/lib/database.types";

type Enums = Database["public"]["Enums"];

export const PRIORITIES = ["DO_NOW", "PLAN", "DELEGATE", "ELIMINATE"] as const;
export type Priority = (typeof PRIORITIES)[number];
// Compile-time check that the list matches the DB enum, both ways.
const _same: Priority extends Enums["next_action_priority"] ? (Enums["next_action_priority"] extends Priority ? true : never) : never = true;
void _same;
export type Required = Enums["next_action_required"];
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

export const REQUIRED_LABEL: Record<Required, string> = {
  PENDING_ACTION: "Pending action",
  AWAITING_RESPONSE: "Awaiting response",
  NONE: "—",
};

export const PROGRESS_LABEL: Record<Progress, string> = {
  NOT_STARTED: "Not started",
  WORKING_ON_IT: "Working on it",
  STUCK: "Stuck",
  DONE: "Done",
};

export interface PkItem {
  id: string;
  action: string;
  owner_id: string;
  due_date: string;
  completed_at: string | null;
  priority: Priority | null;
  priority_days: number | null;
  action_required: Required;
  progress: Progress;
  last_changed_by: string | null;
  last_changed_at: string | null;
  updated_at: string;
}

export interface PkNote {
  id: string;
  next_action_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
}

export interface PkSubtask {
  id: string;
  next_action_id: string;
  title: string;
  done_at: string | null;
  position: number;
}

export interface PkRead {
  membership_id: string;
  next_action_id: string;
  last_read_at: string;
}

/** One PK on the board: the visit and its follow-up rows. */
export interface PkBand {
  activityId: string;
  accountId: string | null;
  dealer: string;
  pkDate: string;
  location: string | null;
  items: PkItem[];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar date of an ISO timestamp, 'YYYY-MM-DD'. */
export function pkDateOf(occurredAt: string): string {
  const d = new Date(occurredAt);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** pkDate + days, on the calendar (no timezone shift). */
export function alertDate(pkDate: string, days: number): string {
  return addDays(pkDate, days);
}

/** The patch a priority pick writes: priority, priority_days (default), due_date (alert). Eliminate leaves the due date alone. */
export function priorityPatch(
  pkDate: string,
  priority: Priority,
  days?: number,
): { priority: Priority; priority_days: number | null; due_date?: string } {
  const d = days ?? DEFAULT_DAYS[priority];
  if (priority === "ELIMINATE" || d === null) return { priority, priority_days: null };
  return { priority, priority_days: d, due_date: alertDate(pkDate, d) };
}

function hasAlert(i: PkItem): boolean {
  return i.completed_at === null && i.priority !== null && i.priority !== "ELIMINATE";
}

/** Open, not ELIMINATE, priority set, due_date < today. */
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

/** Days from today to the alert: negative = passed. null when no alert. */
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
      if (i.action_required === "PENDING_ACTION") s.onUs += 1;
      if (i.action_required === "AWAITING_RESPONSE") s.waiting += 1;
      if (unread(i)) s.newForMe += 1;
    }
  }
  return s;
}
