import { draftedQuadrant } from "@/lib/domain/eisenhower";
import { alertDate, calendarDateIn, DEFAULT_DAYS, daysFrom, type Priority, type Progress } from "@/lib/domain/pk-follow-up";

export interface PkFollowUpInput {
  action: string;
  urgent: boolean;
  important: boolean;
  reason: string;
  asked_by_dealer: boolean;
  due_date?: string;
  progress?: Progress;
  owner_id?: string;
  subtasks?: string[];
  note?: string;
}

export type PkRowPlan =
  | { save: true; priority: Exclude<Priority, "ELIMINATE">; priority_days: number; due_date: string; reason: string }
  | { save: false; reason: string };

/** The same rule as Say it's debrief sheet: the matrix picks the priority, a said date (or the default days) the alert. */
export function planPkFollowUp(pkDate: string, f: PkFollowUpInput): PkRowPlan {
  const q = draftedQuadrant(f.urgent, f.important, f.asked_by_dealer);
  if (q === null || q === "ELIMINATE") return { save: false, reason: f.reason };
  const days = f.due_date ? Math.max(0, daysFrom(pkDate, f.due_date)) : (DEFAULT_DAYS[q] as number);
  return { save: true, priority: q, priority_days: days, due_date: alertDate(pkDate, days), reason: f.reason };
}

const OFFSET = /[+-]\d{2}(:?\d{2})?$/;

function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(instant))
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant of an `occurred_at` and the PK's calendar date. With an explicit
 * offset the date is the one the person said; with Z or no offset the date is
 * the instant's date in the zone (a bare wall time is read in that zone).
 */
export function pkMoment(occurredAt: string, timeZone: string): { instant: string; pkDate: string } {
  if (/T/.test(occurredAt) && OFFSET.test(occurredAt)) {
    // "+05" (hours only) is valid ISO 8601 but not every parser reads it: make it "+05:00".
    const full = /[+-]\d{2}$/.test(occurredAt) ? `${occurredAt}:00` : occurredAt;
    return { instant: new Date(full).toISOString(), pkDate: occurredAt.slice(0, 10) };
  }
  if (/Z$/i.test(occurredAt)) {
    const instant = new Date(occurredAt).toISOString();
    return { instant, pkDate: calendarDateIn(instant, timeZone) };
  }
  const guess = Date.parse(`${occurredAt.length === 10 ? `${occurredAt}T00:00:00` : occurredAt}Z`);
  let t = guess - zoneOffsetMs(guess, timeZone);
  t = guess - zoneOffsetMs(t, timeZone);
  const instant = new Date(t).toISOString();
  return { instant, pkDate: calendarDateIn(instant, timeZone) };
}
