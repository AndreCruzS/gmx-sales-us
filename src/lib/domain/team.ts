// "The team & where they are" — the first thing on a manager's home.
//
// A manager opens the app to find out who needs them, not to read their own
// day: they haven't got one. So each rep gets a single line saying where they
// stand, and the line has to be honest about what the system can actually
// know. The demo shows chips like "travelling"; nothing in this database knows
// that a rep is on a motorway, and a state we cannot observe is a state that
// will be wrong in front of the person it describes.
//
// What IS observable: whether the day has stops on it, and what this week owes.

export interface RepStanding {
  /** Stops planned for today, kept or not. */
  todayStops: number;
  /** Visits done this week with nothing written against them. */
  owed: number;
  /** Planned days that came and went with nothing recorded. */
  missed: number;
}

export type RepStateKey = "behind" | "owes" | "out" | "desk";

export interface RepState {
  key: RepStateKey;
  label: string;
  /** Whether the row should read as a problem rather than a status. */
  alarm: boolean;
}

/**
 * One state per rep, worst first — a manager scanning the list is looking for
 * the person to ring, and a rep who is out today AND lost two days this week
 * needs to read as the second thing, not the first.
 */
export function repState(standing: RepStanding): RepState {
  if (standing.missed > 0) {
    return {
      key: "behind",
      label:
        standing.missed === 1 ? "1 never happened" : `${standing.missed} never happened`,
      alarm: true,
    };
  }
  if (standing.owed > 0) {
    return {
      key: "owes",
      label: standing.owed === 1 ? "Owes a debrief" : `Owes ${standing.owed} debriefs`,
      alarm: true,
    };
  }
  if (standing.todayStops > 0) {
    return {
      key: "out",
      label: standing.todayStops === 1 ? "1 stop today" : `${standing.todayStops} stops today`,
      alarm: false,
    };
  }
  return { key: "desk", label: "Desk day", alarm: false };
}

/** Sorted so the people who need a manager are at the top. */
const RANK: Record<RepStateKey, number> = { behind: 0, owes: 1, out: 2, desk: 3 };

export function compareByNeed(
  a: { state: RepState; name: string },
  b: { state: RepState; name: string },
): number {
  const byState = RANK[a.state.key] - RANK[b.state.key];
  return byState !== 0 ? byState : a.name.localeCompare(b.name);
}

/**
 * The sentence above the list. It is the week in the manager's own terms, and
 * it says nothing it cannot count — no "3 never happened" when the week is
 * still being lived and those days have not arrived.
 */
export function teamNarrative(rows: readonly { done: number; total: number; owed: number; missed: number }[]): string {
  const sum = (pick: (r: (typeof rows)[number]) => number) =>
    rows.reduce((n, r) => n + pick(r), 0);
  const total = sum((r) => r.total);
  if (total === 0) return "Nothing planned across the team this week.";

  const done = sum((r) => r.done);
  const missed = sum((r) => r.missed);
  const owed = sum((r) => r.owed);

  const tail: string[] = [];
  if (missed > 0) tail.push(`${missed} never happened`);
  if (owed > 0) tail.push(`${owed} ${owed === 1 ? "is" : "are"} waiting on a debrief`);

  const head = `${done} of ${total} planned visits done this week.`;
  return tail.length === 0 ? head : `${head} ${tail.join(", ")}.`;
}
