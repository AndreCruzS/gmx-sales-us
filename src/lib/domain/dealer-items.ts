// DEALER ITEMS: the to-do lists on the Dealers page. A next_action carries a
// type (ACTION, COORDINATE, FOLLOW_UP, PROMISE, DEADLINE); the page groups
// those into three buckets and reads promises as a measure of the rep's word.
//
// Pure: rows in, answers out. Dates are 'YYYY-MM-DD'; `completed_at` is an
// ISO timestamp, so only its date part is compared to the due date.

export const ITEM_TYPES = ["ACTION", "COORDINATE", "FOLLOW_UP", "PROMISE", "DEADLINE"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export type Bucket = "action" | "coordinate" | "follow_up";

export const BUCKET_LABEL: Record<Bucket, string> = {
  action: "Action items",
  coordinate: "To coordinate",
  follow_up: "Follow-ups",
};

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  ACTION: "Action",
  COORDINATE: "To coordinate",
  FOLLOW_UP: "Follow-up",
  PROMISE: "Promise",
  DEADLINE: "Deadline",
};

/** A promise and a deadline are things to DO, so they sit with the actions. */
export function bucketOf(t: ItemType): Bucket {
  if (t === "COORDINATE") return "coordinate";
  if (t === "FOLLOW_UP") return "follow_up";
  return "action";
}

export interface ItemLike {
  item_type: ItemType | null;
  due_date: string;
  completed_at: string | null;
  account_id: string | null;
}

/** Open and past its due date. Due today is not late yet. */
export function isLate(i: ItemLike, today: string): boolean {
  return i.completed_at === null && i.due_date < today;
}

/** A promise closed on or before its due date (date part of the timestamp). */
export function isKeptPromise(i: ItemLike): boolean {
  if (i.item_type !== "PROMISE" || i.completed_at === null) return false;
  return i.completed_at.slice(0, 10) <= i.due_date;
}

export interface PromiseStats {
  visits: number;
  promises: number;
  kept: number;
  late: number;
  open: number;
  perVisit: number | null;
}

export function promiseStats(
  items: readonly ItemLike[],
  visitCount: number,
  today: string,
): PromiseStats {
  const promises = items.filter((i) => i.item_type === "PROMISE");
  return {
    visits: visitCount,
    promises: promises.length,
    kept: promises.filter(isKeptPromise).length,
    late: promises.filter((i) => isLate(i, today)).length,
    open: promises.filter((i) => i.completed_at === null).length,
    perVisit: visitCount > 0 ? promises.length / visitCount : null,
  };
}
