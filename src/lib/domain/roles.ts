// Who runs the desk rather than the day.
//
// RLS decides what a person may SEE and always will. This decides nothing about
// permission — it decides which screens are worth OFFERING. A rep has no reason
// to be shown "load a distributor's month", and a manager has no reason to be
// landed on a route they do not walk.
//
// It lives here rather than in either screen because two copies of a set like
// this drift, and the day one of them gains "director" and the other does not is
// the day somebody can see a menu item that 404s for them.

const MANAGES = new Set(["manager", "admin"]);

export function manages(role: string | null | undefined): boolean {
  return role !== null && role !== undefined && MANAGES.has(role);
}

/**
 * Strictly an admin, which is a NARROWER thing than `manages`.
 *
 * The two exist separately because the database draws the line in two places. A
 * manager may READ the org — that is what `manages` gates, and it decides which
 * home a person lands on. But every write policy on the sell-through tables is
 * `private.is_admin()`, so offering a manager the screen that loads a report
 * means offering them a form that fails on save.
 *
 * Gate on this wherever the database will gate on it too, or the UI promises
 * something RLS refuses.
 */
export function isAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}
