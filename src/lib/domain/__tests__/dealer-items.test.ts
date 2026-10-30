import { describe, expect, it } from "vitest";
import {
  BUCKET_LABEL,
  ITEM_TYPES,
  ITEM_TYPE_LABEL,
  bucketOf,
  isKeptPromise,
  isLate,
  promiseStats,
  type ItemLike,
} from "@/lib/domain/dealer-items";

const item = (over: Partial<ItemLike> = {}): ItemLike => ({
  item_type: "ACTION",
  due_date: "2026-10-20",
  completed_at: null,
  account_id: "a1",
  ...over,
});

describe("labels and buckets", () => {
  it("labels every bucket and item type", () => {
    expect(BUCKET_LABEL).toEqual({
      action: "Action items",
      coordinate: "To coordinate",
      follow_up: "Follow-ups",
    });
    expect(ITEM_TYPE_LABEL).toEqual({
      ACTION: "Action",
      COORDINATE: "To coordinate",
      FOLLOW_UP: "Follow-up",
      PROMISE: "Promise",
      DEADLINE: "Deadline",
    });
    expect([...ITEM_TYPES]).toEqual(Object.keys(ITEM_TYPE_LABEL));
  });

  it("puts action, promise and deadline under action items", () => {
    expect(bucketOf("ACTION")).toBe("action");
    expect(bucketOf("PROMISE")).toBe("action");
    expect(bucketOf("DEADLINE")).toBe("action");
    expect(bucketOf("COORDINATE")).toBe("coordinate");
    expect(bucketOf("FOLLOW_UP")).toBe("follow_up");
  });
});

describe("isLate", () => {
  it("is late when open and due before today", () => {
    expect(isLate(item({ due_date: "2026-10-29" }), "2026-10-30")).toBe(true);
  });
  it("is not late when due today or later", () => {
    expect(isLate(item({ due_date: "2026-10-30" }), "2026-10-30")).toBe(false);
    expect(isLate(item({ due_date: "2026-11-01" }), "2026-10-30")).toBe(false);
  });
  it("is not late once completed", () => {
    expect(
      isLate(item({ due_date: "2026-10-01", completed_at: "2026-10-02T10:00:00Z" }), "2026-10-30"),
    ).toBe(false);
  });
});

describe("isKeptPromise", () => {
  const p = (over: Partial<ItemLike>) => item({ item_type: "PROMISE", ...over });
  it("keeps a promise completed on its due date", () => {
    expect(isKeptPromise(p({ completed_at: "2026-10-20T23:00:00Z" }))).toBe(true);
  });
  it("keeps a promise completed early", () => {
    expect(isKeptPromise(p({ completed_at: "2026-10-18T09:00:00Z" }))).toBe(true);
  });
  it("a promise completed a day after its due date is not kept", () => {
    expect(isKeptPromise(p({ completed_at: "2026-10-21T00:00:00Z" }))).toBe(false);
  });
  it("an open promise is not kept", () => {
    expect(isKeptPromise(p({}))).toBe(false);
  });
  it("only promises can be kept", () => {
    expect(isKeptPromise(item({ completed_at: "2026-10-18T09:00:00Z" }))).toBe(false);
  });
});

describe("promiseStats", () => {
  const today = "2026-10-30";
  const items: ItemLike[] = [
    item({ item_type: "PROMISE", completed_at: "2026-10-19T10:00:00Z" }), // kept
    item({ item_type: "PROMISE", completed_at: "2026-10-25T10:00:00Z" }), // done late
    item({ item_type: "PROMISE", due_date: "2026-10-01" }), // open and late
    item({ item_type: "PROMISE", due_date: "2026-11-05" }), // open, not late
    item({ item_type: "ACTION", due_date: "2026-10-01" }), // ignored
  ];

  it("counts only promises", () => {
    expect(promiseStats(items, 2, today)).toEqual({
      visits: 2,
      promises: 4,
      kept: 1,
      late: 1,
      open: 2,
      perVisit: 2,
    });
  });

  it("perVisit is null with no visits", () => {
    expect(promiseStats(items, 0, today).perVisit).toBeNull();
  });
});
