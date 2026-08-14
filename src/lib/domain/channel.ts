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
}

export interface Segment {
  id: string;
  label: string;
  total: number;
  done: number;
}

export interface ChannelGroup {
  id: string;
  label: string;
  total: number;
  done: number;
  /** What is left of the plan — still to come mid-week, never happened after. */
  outstanding: number;
  /** The split shown inside the bar, and the rows behind "see more". */
  segments: Segment[];
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

interface Bucket {
  id: string;
  label: string;
  total: number;
  done: number;
  segments: Map<string, Segment>;
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
      bucket = { id: g.id, label: g.label, total: 0, done: 0, segments: new Map() };
      buckets.set(g.id, bucket);
    }
    bucket.total += row.planned_total;
    bucket.done += row.planned_done;

    const s = segment(row);
    const seen = bucket.segments.get(s.id);
    if (seen) {
      seen.total += row.planned_total;
      seen.done += row.planned_done;
    } else {
      bucket.segments.set(s.id, {
        id: s.id,
        label: s.label,
        total: row.planned_total,
        done: row.planned_done,
      });
    }
  }

  return [...buckets.values()]
    .map((b) => ({
      id: b.id,
      label: b.label,
      total: b.total,
      done: b.done,
      outstanding: Math.max(0, b.total - b.done),
      // Biggest share first, so the bar's segments read left to right in the
      // order the legend lists them.
      segments: [...b.segments.values()].sort(
        (a, c) => c.total - a.total || a.label.localeCompare(c.label),
      ),
    }))
    // Whoever owes the most comes first — a manager opens this to find the gap,
    // not to read an alphabet.
    .sort((a, b) => b.outstanding - a.outstanding || a.label.localeCompare(b.label));
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
