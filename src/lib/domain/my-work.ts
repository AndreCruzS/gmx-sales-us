// MY WORK (2026-11-10): everything open a rep owns, in four boxes. The Home's
// "Your action items" counts them; the My work page lists them. One reading
// of an item for both, so a box and its chip never disagree.
//
// Do now · Plan · No priority come from the Eisenhower matrix, worked out
// against today every time (deadline.ts): a Plan item whose deadline comes
// within 2 business days is Do now the next morning with no edit. A rep has no
// Delegate, so anything that is not Do now lands in Plan. Visits, calls and
// meetings have a date instead of a priority: they are Scheduled, and one
// past its date was never closed.

import type { CachedAgendaItem } from "@/lib/offline/types";
import { businessDaysUntil, derivePriority, isTask } from "@/lib/domain/deadline";

export type Box = "DO_NOW" | "PLAN" | "NONE" | "SCHEDULED";
export const BOXES: readonly Box[] = ["DO_NOW", "PLAN", "NONE", "SCHEDULED"];

export const BOX_LABEL: Record<Box, string> = {
  DO_NOW: "Do now",
  PLAN: "Plan",
  NONE: "No priority",
  SCHEDULED: "Scheduled",
};

/** The query-string value of each filter: /my-work?f=do-now. */
export const BOX_PARAM: Record<Box, string> = {
  DO_NOW: "do-now",
  PLAN: "plan",
  NONE: "none",
  SCHEDULED: "scheduled",
};

export type PageFilter = Box | "ALL" | "NEW";

export function filterFromParam(raw: string | null): PageFilter {
  if (raw === "new") return "NEW";
  const hit = BOXES.find((b) => BOX_PARAM[b] === raw);
  return hit ?? "ALL";
}

export interface BoxCount {
  n: number;
  /** Deadline (or booked date) passed. */
  late: number;
  /** Not late, due within 2 business days. */
  soon: number;
  /** The earliest date not yet passed. */
  next: string | null;
}

const SOON_BUSINESS_DAYS = 2;
const NEW_WINDOW_MS = 7 * 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 'YYYY-MM-DD' → "Nov 17". */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** `important`, or (for a row cached before it was pulled) what the stored
 *  priority says, by the same rule the backfill used. */
function importantOf(i: CachedAgendaItem): boolean | null {
  if (i.important != null) return i.important;
  if (i.priority === "DO_NOW" || i.priority === "PLAN") return true;
  if (i.priority === "DELEGATE") return false;
  return null;
}

/** Which box an item counts in; null when it counts nowhere (closed, or Eliminate confirmed). */
export function boxOf(i: CachedAgendaItem, today: string, ownerGivesWork: boolean): Box | null {
  if (i.completed_at != null || i.priority === "ELIMINATE") return null;
  if (!isTask(i.kind)) return "SCHEDULED";
  const p = derivePriority(importantOf(i), i.due_date, today, ownerGivesWork);
  if (p == null) return "NONE";
  // Delegate, and Eliminate (a suggestion, never stored on its own), are still
  // open work on the owner's list: they wait in Plan.
  return p === "DO_NOW" ? "DO_NOW" : "PLAN";
}

function mine(items: CachedAgendaItem[], me: string): CachedAgendaItem[] {
  return items.filter((i) => i.owner_id === me);
}

export function countBoxes(
  items: CachedAgendaItem[],
  me: string,
  today: string,
  gives: boolean,
): Record<Box, BoxCount> {
  const out = Object.fromEntries(
    BOXES.map((b) => [b, { n: 0, late: 0, soon: 0, next: null }]),
  ) as Record<Box, BoxCount>;
  for (const i of mine(items, me)) {
    const box = boxOf(i, today, gives);
    if (!box) continue;
    const c = out[box];
    c.n += 1;
    if (i.due_date < today) {
      c.late += 1;
      continue;
    }
    if (businessDaysUntil(today, i.due_date) <= SOON_BUSINESS_DAYS) c.soon += 1;
    if (c.next == null || i.due_date < c.next) c.next = i.due_date;
  }
  return out;
}

/** "Bianca Silva" → "Bianca". */
function firstName(full: string | null | undefined): string {
  return full?.trim().split(/\s+/)[0] || "Someone";
}

/** Open own items someone else gave since the page was last seen (the last 7
 *  days before the first visit). An import (entered_by null) never counts. */
function isNewFromOthers(i: CachedAgendaItem, me: string, cutoff: string): boolean {
  return (
    i.owner_id === me &&
    i.completed_at == null &&
    i.priority !== "ELIMINATE" &&
    i.entered_by != null &&
    i.entered_by !== me &&
    new Date(i.created_at).getTime() > new Date(cutoff).getTime()
  );
}

function cutoffOf(seenAt: string | null, now: string): string {
  return seenAt ?? new Date(new Date(now).getTime() - NEW_WINDOW_MS).toISOString();
}

/** Who gave the rep work, most items first, and how many items in all. */
export function givers(
  items: CachedAgendaItem[],
  me: string,
  seenAt: string | null,
  now: string,
): { names: string[]; n: number } {
  const cutoff = cutoffOf(seenAt, now);
  const byGiver = new Map<string, { name: string; n: number }>();
  let n = 0;
  for (const i of items) {
    if (!isNewFromOthers(i, me, cutoff)) continue;
    n += 1;
    const g = byGiver.get(i.entered_by!) ?? { name: firstName(i.entered_by_name), n: 0 };
    g.n += 1;
    byGiver.set(i.entered_by!, g);
  }
  const names = [...byGiver.values()].sort((a, b) => b.n - a.n).map((g) => g.name);
  return { names, n };
}

export type GroupKey = "LATE" | "TODAY" | "SOON" | "LATER";
const GROUPS: readonly GroupKey[] = ["LATE", "TODAY", "SOON", "LATER"];

/** The heading of a group; past-date scheduled items were never closed, so they read Overdue. */
export function groupLabel(key: GroupKey, filter: PageFilter): string {
  if (key === "LATE") return filter === "SCHEDULED" ? "Overdue" : "Late";
  if (key === "TODAY") return "Today";
  if (key === "SOON") return "Next 2 business days";
  return "Later";
}

function groupOf(due: string, today: string): GroupKey {
  if (due < today) return "LATE";
  if (due === today) return "TODAY";
  return businessDaysUntil(today, due) <= SOON_BUSINESS_DAYS ? "SOON" : "LATER";
}

export interface PageContext {
  me: string;
  today: string;
  gives: boolean;
  seenAt: string | null;
  now: string;
}

/** The page's list: the filter's items by date group, by date then time inside one; empty groups dropped. */
export function groupForPage(
  items: CachedAgendaItem[],
  filter: PageFilter,
  ctx: PageContext,
): { key: GroupKey; items: CachedAgendaItem[] }[] {
  const cutoff = cutoffOf(ctx.seenAt, ctx.now);
  const shown = mine(items, ctx.me).filter((i) => {
    const box = boxOf(i, ctx.today, ctx.gives);
    if (!box) return false;
    if (filter === "ALL") return true;
    if (filter === "NEW") return isNewFromOthers(i, ctx.me, cutoff);
    return box === filter;
  });
  const sorted = [...shown].sort(
    (a, b) =>
      a.due_date.localeCompare(b.due_date) ||
      (a.due_time ?? "99").localeCompare(b.due_time ?? "99"),
  );
  return GROUPS.map((key) => ({
    key,
    items: sorted.filter((i) => groupOf(i.due_date, ctx.today) === key),
  })).filter((g) => g.items.length > 0);
}

/** The newer of two updated_at stamps (D61): what the device last read back
 *  after its own write, or the row as the cache holds it now — a later
 *  refresh may have brought a newer one in. */
export function newerStamp(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}
