// DEADLINES DECIDE URGENCY. One rule for business days, the urgent cap, default
// deadlines and the derived priority; the database mirrors it and the UI, the
// voice drafts and the agent tools all read it from here.
//
// Urgent = the deadline is no more than 2 business days away (Mon-Fri, no
// holidays), or already past. Dates are plain "YYYY-MM-DD" strings; the math
// runs at UTC noon so DST never shifts a day.

import type { Priority } from "@/lib/domain/pk-follow-up";

const URGENT_BUSINESS_DAYS = 2;
const DAY_MS = 86_400_000;

/** Business days to allow per kind of task, counted from when it is created
 *  (the PK date for a PK follow-up). */
export const DEFAULT_DEADLINE_DAYS = {
  QUOTE_FOLLOW_UP: 2,
  SAMPLE_FOLLOW_UP: 3,
  DISPLAY_CHECK: 10,
  PK: 5,
  OTHER: 5,
} as const satisfies Record<string, number>;

function toMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isWeekend(ms: number): boolean {
  const day = new Date(ms).getUTCDay();
  return day === 0 || day === 6;
}

/** The device's local calendar date, never the UTC one. */
export function localIsoDate(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** The calendar date right now in an IANA zone: what the server uses for
 *  "today" (the agent's tools, the suggest route) where there is no device. */
export function todayIn(timeZone: string = "America/Los_Angeles", now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** n business days after iso. From a weekend, Monday is the first one. */
export function addBusinessDays(iso: string, n: number): string {
  let ms = toMs(iso);
  if (n <= 0) {
    while (isWeekend(ms)) ms += DAY_MS;
    return fromMs(ms);
  }
  let left = n;
  while (left > 0) {
    ms += DAY_MS;
    if (!isWeekend(ms)) left -= 1;
  }
  return fromMs(ms);
}

/** Business days from today to due; negative when late. Weekend days do not count. */
export function businessDaysUntil(today: string, due: string): number {
  const a = toMs(today);
  const b = toMs(due);
  if (a === b) return 0;
  const [from, to] = a < b ? [a, b] : [b, a];
  let count = 0;
  for (let ms = from + DAY_MS; ms <= to; ms += DAY_MS) {
    if (!isWeekend(ms)) count += 1;
  }
  return a < b ? count : -count;
}

export function isUrgent(due: string, today: string): boolean {
  return businessDaysUntil(today, due) <= URGENT_BUSINESS_DAYS;
}

/** Marking something urgent: the deadline becomes min(given, today + 2 business days). */
export function urgentCap(given: string | null, today: string): string {
  const cap = addBusinessDays(today, URGENT_BUSINESS_DAYS);
  return given != null && given < cap ? given : cap;
}

/** The deadline a new item gets: the PK value for a PK, else its kind's, else OTHER. */
export function defaultDeadline(kind: string | null, isPk: boolean, from: string): string {
  const days = isPk
    ? DEFAULT_DEADLINE_DAYS.PK
    : kind != null && Object.hasOwn(DEFAULT_DEADLINE_DAYS, kind)
      ? DEFAULT_DEADLINE_DAYS[kind as keyof typeof DEFAULT_DEADLINE_DAYS]
      : DEFAULT_DEADLINE_DAYS.OTHER;
  return addBusinessDays(from, days);
}

/** The priority the two answers give. ELIMINATE is for display or suggestion
 *  only; store it with storedPriority(). Urgent but not important is Plan for
 *  a rep and Delegate when the owner gives work to others (admin/support).
 *  null while "important" is unknown. */
export function derivePriority(
  important: boolean | null,
  due: string,
  today: string,
  ownerGivesWork: boolean,
): Priority | null {
  if (important == null) return null;
  const urgent = isUrgent(due, today);
  if (important) return urgent ? "DO_NOW" : "PLAN";
  if (urgent) return ownerGivesWork ? "DELEGATE" : "PLAN";
  return "ELIMINATE";
}

/** What may be saved on its own: derivePriority, but ELIMINATE never is. It
 *  becomes Plan for a rep and Delegate for an admin/support owner; ELIMINATE
 *  is written only when the person confirms it. */
export function storedPriority(
  important: boolean | null,
  due: string,
  today: string,
  ownerGivesWork: boolean,
): Priority | null {
  const p = derivePriority(important, due, today, ownerGivesWork);
  if (p === "ELIMINATE") return ownerGivesWork ? "DELEGATE" : "PLAN";
  return p;
}

/** "due today", "due in 3d", "2d late". Calendar days in the text. */
export function deadlineLabel(due: string, today: string): { text: string; late: boolean } {
  const days = Math.round((toMs(due) - toMs(today)) / DAY_MS);
  if (days === 0) return { text: "due today", late: false };
  if (days > 0) return { text: `due in ${days}d`, late: false };
  return { text: `${-days}d late`, late: true };
}

/** A task has a deadline and a priority; visits, calls and meetings have a time instead. */
export function isTask(kind: string | null): boolean {
  return kind !== "VISIT" && kind !== "CALL" && kind !== "MEETING";
}
