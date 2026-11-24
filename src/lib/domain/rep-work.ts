// THE WORK ON THE RECORD — the Reps board's effort layer (Bianca's spec,
// "Painel de Reps GMX – Especificação de Métricas", 2026-11-24).
//
// The board measures what a rep does at the dealer, not the paperwork that
// goes through the distributor. Three readings live here:
//
//   1. Accounts worked — distinct dealers with something the rep did on the
//      record in the period: a visit, call, meeting or PK (activities), a
//      note, a quote, a PK class, or a follow-up KEPT. A follow-up merely
//      planned is not work at the dealer yet, so open ones do not count.
//   3. Follow-ups kept — of the follow-ups due in the period whose date has
//      come, how many were done by their date; and how many are late now.
//   *  Working, not selling — a dealer with 3 or more touches in 90 days and
//      no LF in the months on file: either it is not converting, or the
//      distributor is not passing on (or not reporting) the order.
//
// Pure functions over rows the page already reads; the page decides scope.

import { isTask, todayIn } from "./deadline";
import { isBranchLevel, type SellThroughRow } from "./sell-through";

export type WorkPeriod = "month" | "quarter" | "year";

export const WORK_PERIODS: readonly (readonly [WorkPeriod, string])[] = [
  ["month", "This month"],
  ["quarter", "This quarter"],
  ["year", "This year"],
];

/** The first day of the period that holds `today` (YYYY-MM-DD). */
export function periodStart(period: WorkPeriod, today: string): string {
  const y = today.slice(0, 4);
  const m = Number(today.slice(5, 7));
  if (period === "year") return `${y}-01-01`;
  if (period === "month") return `${y}-${today.slice(5, 7)}-01`;
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(q).padStart(2, "0")}-01`;
}

/** A timestamp's calendar day in Los Angeles — "today" everywhere in the app. */
export function laDay(ts: string): string {
  return todayIn("America/Los_Angeles", new Date(ts));
}

/** A row of rep_effort. PLANNED rows are read from next_actions instead (see below). */
export interface EffortTrace {
  account_id: string | null;
  membership_id: string | null;
  happened_at: string | null;
  kind?: string | null;
}

/** A follow-up, open or done, as next_actions holds it. */
export interface FollowUpRow {
  account_id: string | null;
  owner_id: string;
  due_date: string;
  completed_at: string | null;
  kind: string | null;
}

/** One touch on a dealer: who, which dealer, which day. */
interface Touch {
  account: string;
  who: string | null;
  day: string;
  key: string;
}

/**
 * Every touch on the record. rep_effort's PLANNED rows are dropped — a plan
 * is not yet work, and the view cannot tell a kept one from an open one — and
 * the KEPT follow-ups are read from next_actions, on the day they were done.
 * The view lists an activity once per account it names and again for its
 * primary account; the key folds those back into one.
 */
export function touches(traces: readonly EffortTrace[], followUps: readonly FollowUpRow[]): Touch[] {
  const out = new Map<string, Touch>();
  for (const t of traces) {
    if (!t.account_id || !t.happened_at || t.kind === "PLANNED") continue;
    const key = `${t.kind ?? "?"}|${t.account_id}|${t.membership_id ?? ""}|${t.happened_at}`;
    out.set(key, { account: t.account_id, who: t.membership_id, day: laDay(t.happened_at), key });
  }
  for (const f of followUps) {
    if (!f.account_id || !f.completed_at) continue;
    const key = `KEPT|${f.account_id}|${f.owner_id}|${f.completed_at}`;
    out.set(key, { account: f.account_id, who: f.owner_id, day: laDay(f.completed_at), key });
  }
  return [...out.values()];
}

/** Metric 1: distinct dealers with a touch by `owner` (or anyone) in [from, to]. */
export function accountsWorkedIn(
  all: readonly Touch[],
  dealers: ReadonlySet<string>,
  owner: string | null,
  from: string,
  to: string,
): number {
  const set = new Set<string>();
  for (const t of all) {
    if (!dealers.has(t.account)) continue;
    if (owner && t.who !== owner) continue;
    if (t.day < from || t.day > to) continue;
    set.add(t.account);
  }
  return set.size;
}

export interface Keeping {
  /** Follow-ups due in the period whose date has come (or that were done). */
  due: number;
  /** Of those, done on or before their date. */
  onTime: number;
  /** onTime / due, or null when nothing was due. */
  rate: number | null;
  /** Open now and past their date, whatever the period. */
  lateNow: number;
}

/**
 * Metric 3. A visit, call or meeting on the agenda is an appointment, not a
 * promise, and has no priority — only task follow-ups (PK ones included) are
 * read. A follow-up due later this period that is still open has not been
 * missed yet, so it is not in the count; one done early is.
 */
export function followUpKeeping(
  rows: readonly FollowUpRow[],
  owner: string | null,
  from: string,
  today: string,
): Keeping {
  let due = 0;
  let onTime = 0;
  let lateNow = 0;
  for (const r of rows) {
    if (!isTask(r.kind)) continue;
    if (owner && r.owner_id !== owner) continue;
    const done = r.completed_at ? laDay(r.completed_at) : null;
    if (!done && r.due_date < today) lateNow++;
    let counts: boolean;
    if (r.due_date < from) counts = false; // an earlier period's promise
    else if (r.due_date <= today) counts = done !== null || r.due_date < today; // open and due today: not missed yet
    else counts = done !== null && done >= from; // not due yet: counts once kept (early)
    if (!counts) continue;
    due++;
    if (done !== null && done <= r.due_date) onTime++;
  }
  return { due, onTime, rate: due > 0 ? onTime / due : null, lateNow };
}

export interface QuietDealer {
  id: string;
  name: string;
  touches: number;
  last: string;
}

/** The threshold of the alert, as the spec writes it. */
export const QUIET_MIN_TOUCHES = 3;
export const QUIET_WINDOW_DAYS = 90;

/**
 * The alert: dealers with QUIET_MIN_TOUCHES or more touches in the last
 * QUIET_WINDOW_DAYS and no LF in any of `months` (the newest monthly returns
 * on file). A dealer buying through a branch that sends no dealer detail
 * cannot be told apart from one not buying — the caller names those houses
 * beside the list rather than pretending to know.
 */
export function workingNotSelling(
  all: readonly Touch[],
  dealers: ReadonlyMap<string, string>,
  rows: readonly SellThroughRow[],
  months: readonly string[],
  owner: string | null,
  today: string,
): QuietDealer[] {
  if (months.length === 0) return [];
  const since = shiftDays(today, -QUIET_WINDOW_DAYS);
  const sold = new Set<string>();
  for (const r of rows) {
    if (r.period_kind === "YTD" || !months.includes(r.period) || isBranchLevel(r)) continue;
    if (!r.dealer_id || (r.unit && r.unit.toUpperCase() !== "LF")) continue;
    if (Number(r.quantity) > 0) sold.add(r.dealer_id);
  }
  const by = new Map<string, { n: number; last: string }>();
  for (const t of all) {
    if (!dealers.has(t.account) || sold.has(t.account)) continue;
    if (owner && t.who !== owner) continue;
    if (t.day < since || t.day > today) continue;
    const cur = by.get(t.account) ?? { n: 0, last: t.day };
    cur.n++;
    if (t.day > cur.last) cur.last = t.day;
    by.set(t.account, cur);
  }
  return [...by.entries()]
    .filter(([, v]) => v.n >= QUIET_MIN_TOUCHES)
    .map(([id, v]) => ({ id, name: dealers.get(id) ?? "Dealer", touches: v.n, last: v.last }))
    .sort((a, b) => b.touches - a.touches || b.last.localeCompare(a.last) || a.name.localeCompare(b.name));
}

function shiftDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
