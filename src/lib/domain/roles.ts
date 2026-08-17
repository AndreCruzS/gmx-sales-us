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
