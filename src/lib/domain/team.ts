// The sentence at the top of a manager's home.
//
// They open the app to find out who needs them, not to read their own day —
// they haven't got one. The rows themselves are the shared lens's job (see
// components/plan-lens.tsx); this is only the line above them, and it says
// nothing it cannot count.

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
