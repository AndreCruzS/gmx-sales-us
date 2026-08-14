// Reading the week's plan through the channel rather than only through people.
//
// Leadership's markup of the manager view (13 Aug 2026) asked for two things
// at once: the compliance bars split by DISTRIBUTOR, and a lens that switches
// the whole list between rep, distributor and dealer. Both are the same data
// read three ways, so the grouping lives here rather than in the page — a
// manager who switches lens must never see three different totals for one week.
//
// Attribution itself is decided in SQL (dashboard_plan_by_channel), which is
// also where the ambiguity is kept honest: a dealer supplied by two houses has
// no distributor_id, and it is named as unresolved here rather than quietly
// filed under one of them.

export interface ChannelRow {
  owner_id: string;
  week_start: string;
  account_id: string | null;
  account_name: string | null;
  account_type: string | null;
  distributor_id: string | null;
  distributor_name: string | null;
  distributor_options: number;
  planned_total: number;
  planned_done: number;
  /** Done, but the activity carries no note. */
  planned_owed: number;
  /** The day is behind us and nothing was ever recorded. */
  planned_missed: number;
}

export interface Tally {
  total: number;
  done: number;
  owed: number;
  missed: number;
  /** Planned, and the day has not arrived — derived, never stored, so the four
   *  states can never add up to more than the plan. */
  left: number;
}

export interface Segment extends Tally {
  id: string;
  label: string;
}

export interface ChannelGroup extends Tally {
  id: string;
  label: string;
  /** The split shown inside the bar, and the rows behind "see more". */
  segments: Segment[];
}

function tally(total: number, done: number, owed: number, missed: number): Tally {
  return {
    total,
    done,
    owed,
    missed,
    left: Math.max(0, total - done - missed),
  };
}

export type Lens = "rep" | "distributor" | "dealer";

/** The two ways a visit can have no single distributor, kept apart on purpose:
 *  nobody has said who supplies this door, versus two houses do. The first is
 *  missing data a rep can fix; the second is a real trade fact. */
const NO_DISTRIBUTOR = { id: "none", label: "No distributor" };
const SEVERAL = { id: "several", label: "More than one" };

function distributorKey(row: ChannelRow): { id: string; label: string } {
  if (row.distributor_id && row.distributor_name) {
    return { id: row.distributor_id, label: row.distributor_name };
  }
  return row.distributor_options > 1 ? SEVERAL : NO_DISTRIBUTOR;
}

function accountKey(row: ChannelRow): { id: string; label: string } {
  if (row.account_id) {
    return { id: row.account_id, label: row.account_name ?? "Account" };
  }
  return { id: "unassigned", label: "No account" };
}

interface Raw {
  total: number;
  done: number;
  owed: number;
  missed: number;
}

interface Bucket extends Raw {
  id: string;
  label: string;
  segments: Map<string, Raw & { id: string; label: string }>;
}

function add(into: Raw, row: ChannelRow): void {
  into.total += row.planned_total;
  into.done += row.planned_done;
  into.owed += row.planned_owed;
  into.missed += row.planned_missed;
}

function collect(
  rows: readonly ChannelRow[],
  group: (row: ChannelRow) => { id: string; label: string },
  segment: (row: ChannelRow) => { id: string; label: string },
): ChannelGroup[] {
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const g = group(row);
    let bucket = buckets.get(g.id);
    if (!bucket) {
      bucket = {
        id: g.id,
        label: g.label,
        total: 0,
        done: 0,
        owed: 0,
        missed: 0,
        segments: new Map(),
      };
      buckets.set(g.id, bucket);
    }
    add(bucket, row);

    const s = segment(row);
    let seg = bucket.segments.get(s.id);
    if (!seg) {
      seg = { id: s.id, label: s.label, total: 0, done: 0, owed: 0, missed: 0 };
      bucket.segments.set(s.id, seg);
    }
    add(seg, row);
  }

  return [...buckets.values()]
    .map((b) => ({
      id: b.id,
      label: b.label,
      ...tally(b.total, b.done, b.owed, b.missed),
      // Biggest share first, so the bar's segments read left to right in the
      // order the legend lists them.
      segments: [...b.segments.values()]
        .map((s) => ({
          id: s.id,
          label: s.label,
          ...tally(s.total, s.done, s.owed, s.missed),
        }))
        .sort((a, c) => c.total - a.total || a.label.localeCompare(c.label)),
    }))
    // A visit that was planned and never happened is a cost as well as a gap —
    // mileage is reimbursed either way — so it outranks work merely still to
    // come. A manager opens this to find the gap, not to read an alphabet.
    .sort(
      (a, b) =>
        b.missed - a.missed ||
        b.left - a.left ||
        a.label.localeCompare(b.label),
    );
}

/** One bar per rep, split by the distributor each visit belongs to. */
export function groupByRep(
  rows: readonly ChannelRow[],
  repName: ReadonlyMap<string, string>,
): ChannelGroup[] {
  return collect(
    rows,
    (r) => ({ id: r.owner_id, label: repName.get(r.owner_id) ?? "—" }),
    distributorKey,
  );
}

/** One bar per distributor, split by the door the visit was to. */
export function groupByDistributor(rows: readonly ChannelRow[]): ChannelGroup[] {
  return collect(rows, distributorKey, accountKey);
}

/**
 * One bar per dealer, split by distributor. Only dealers: a contractor or an
 * architect is a visit worth making but it is not a door being sold through,
 * and mixing them in would answer a different question than the one asked.
 */
export function groupByDealer(rows: readonly ChannelRow[]): ChannelGroup[] {
  return collect(
    rows.filter((r) => r.account_type === "DEALER"),
    accountKey,
    distributorKey,
  );
}

export function groupFor(
  lens: Lens,
  rows: readonly ChannelRow[],
  repName: ReadonlyMap<string, string>,
): ChannelGroup[] {
  if (lens === "distributor") return groupByDistributor(rows);
  if (lens === "dealer") return groupByDealer(rows);
  return groupByRep(rows, repName);
}

/** The latest week the data actually covers that has already begun. */
export function latestStartedWeek(
  rows: readonly ChannelRow[],
  nowMs: number,
): string | null {
  const started = rows.filter((r) => Date.parse(r.week_start) <= nowMs);
  if (started.length === 0) return null;
  return started.reduce(
    (max, r) => (r.week_start > max ? r.week_start : max),
    started[0].week_start,
  );
}
