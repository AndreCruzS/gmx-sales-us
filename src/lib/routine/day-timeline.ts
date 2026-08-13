// "Today & what's next" — the rep's day as one spine rather than three lists.
//
// The demo's insight is that a day reads in time order: what is behind you,
// where you are now, and what is still ahead. Splitting those into separate
// cards makes a rep assemble the order in their head every time they open the
// app. One ordered list does it for them.
//
// Three states, and the middle one is the point:
//   done     — logged, nothing owed
//   flagged  — the stop passed and nothing was logged, so it owes a debrief
//   planned  — still ahead
//
// `flagged` is the only one a rep can act on right now, which is why it sits
// above the NOW marker rather than being filed under "overdue" somewhere else.

import type { CachedAgendaItem } from "@/lib/offline";

export type StopState = "done" | "flagged" | "planned";

export interface TimelineStop {
  id: string;
  state: StopState;
  action: string;
  objective: string | null;
  accountId: string | null;
  dueDate: string;
  completedAt: string | null;
}

export interface DayTimeline {
  /** Behind the NOW marker: what happened, and what owes a debrief. */
  before: TimelineStop[];
  /** Ahead of it. */
  after: TimelineStop[];
  stops: number;
  done: number;
  needsDebrief: number;
}

// A null kind is an unclassified row cached before the DB trigger ran; /visits
// treats it as a visit, so this must too or the two screens disagree.
function isVisit(item: CachedAgendaItem): boolean {
  return item.kind === "VISIT" || item.kind === null;
}

function toStop(item: CachedAgendaItem, state: StopState): TimelineStop {
  return {
    id: item.id,
    state,
    action: item.action,
    objective: item.objective,
    accountId: item.account_id,
    dueDate: item.due_date,
    completedAt: item.completed_at,
  };
}

/**
 * @param agenda    the cached agenda (already scoped to this rep)
 * @param todayIso  yyyy-mm-dd in the rep's own timezone, not UTC
 * @param horizon   last date to show under "coming up", inclusive
 */
export function buildDayTimeline(
  agenda: CachedAgendaItem[],
  todayIso: string,
  horizon: string,
): DayTimeline {
  const byDate = (a: TimelineStop, b: TimelineStop) =>
    a.dueDate.localeCompare(b.dueDate) || a.action.localeCompare(b.action);

  // Logged today. Completed work from earlier days belongs to those days, not
  // to this one — a day that quietly grows yesterday's wins is a lie.
  const done = agenda
    .filter((i) => i.completed_at !== null && i.due_date === todayIso)
    .map((i) => toStop(i, "done"));

  // The stop passed with nothing logged. Strictly VISIT here: an unclassified
  // row is not evidence that a visit happened.
  const flagged = agenda
    .filter(
      (i) => i.kind === "VISIT" && i.due_date < todayIso && i.completed_at === null,
    )
    .map((i) => toStop(i, "flagged"));

  // Still ahead, including anything due today that has not been logged — with
  // no clock time on an agenda row, "today but not done" is ahead of you.
  const planned = agenda
    .filter(
      (i) =>
        i.completed_at === null &&
        isVisit(i) &&
        i.due_date >= todayIso &&
        i.due_date <= horizon,
    )
    .map((i) => toStop(i, "planned"));

  const before = [...done, ...flagged].sort(byDate);
  const after = planned.sort(byDate);

  return {
    before,
    after,
    stops: before.length + after.length,
    done: done.length,
    needsDebrief: flagged.length,
  };
}
