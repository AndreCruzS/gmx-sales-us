import { defaultDeadline, derivePriority, storedPriority } from "@/lib/domain/deadline";
import { suggestDeadline } from "@/lib/domain/eisenhower";
import { calendarDateIn, daysFrom, type Priority, type Progress } from "@/lib/domain/pk-follow-up";

export interface PkFollowUpInput {
  action: string;
  important: boolean;
  /** The person said urgent, or the dealer is waiting. Never a priority by itself: it caps the deadline. */
  urgent?: boolean;
  reason: string;
  /** The dealer asked for it, or GMX promised it: the dealer is waiting, so it counts as urgent. */
  asked_by_dealer?: boolean;
  /** Only a date the person said. */
  due_date?: string;
  progress?: Progress;
  owner_id?: string;
  subtasks?: string[];
  note?: string;
}

/** What the deadline rule decides for one answer: the date, and the priority
 *  that may be STORED (never Eliminate on its own). */
export interface DeadlinePlan {
  due_date: string;
  /** Plan for a rep and Delegate for admin/support where the answers say Eliminate. */
  priority: Exclude<Priority, "ELIMINATE">;
  /** Both answers say no: suggest dropping it; it is saved only when the person asks to keep it. */
  suggestDrop: boolean;
}

/**
 * The one rule behind every tool that records importance: urgent (said, or the
 * dealer waiting) caps the date at two business days; the priority follows the
 * date and the OWNER's role. `today` is the server's Los Angeles date.
 */
export function planDeadline(a: {
  important: boolean;
  urgent?: boolean;
  said_date?: string | null;
  fallback: string;
  today: string;
  ownerGivesWork: boolean;
}): DeadlinePlan {
  const due_date = suggestDeadline({ urgent: a.urgent === true, said_date: a.said_date ?? null }, a.fallback, a.today);
  return {
    due_date,
    priority: storedPriority(a.important, due_date, a.today, a.ownerGivesWork) as DeadlinePlan["priority"],
    suggestDrop: derivePriority(a.important, due_date, a.today, a.ownerGivesWork) === "ELIMINATE",
  };
}

export type PkRowPlan = DeadlinePlan & {
  /** False when it is suggested to drop: create_pk then skips it unless kept. */
  save: boolean;
  important: boolean;
  priority_days: number;
  reason: string;
};

/** The same rule as Say it's debrief sheet, from the PK's own date: the default is 5 business days after the PK. */
export function planPkFollowUp(pkDate: string, f: PkFollowUpInput, today: string, ownerGivesWork: boolean): PkRowPlan {
  const p = planDeadline({
    important: f.important,
    urgent: f.urgent === true || f.asked_by_dealer === true,
    said_date: f.due_date,
    fallback: defaultDeadline(null, true, pkDate),
    today,
    ownerGivesWork,
  });
  return {
    ...p,
    save: !p.suggestDrop,
    important: f.important,
    priority_days: Math.max(0, daysFrom(pkDate, p.due_date)),
    reason: f.reason,
  };
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
