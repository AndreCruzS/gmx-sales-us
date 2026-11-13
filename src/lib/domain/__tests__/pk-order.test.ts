// The board's order (Andre, 2026-11-13): by priority, a dealer rising with its
// most urgent task; unprioritised tasks oldest first; and Days open.

import { describe, expect, it } from "vitest";
import { bandOrder, daysOpen, taskOrder, type PkBand, type PkItem } from "@/lib/domain/pk-follow-up";

function item(over: Partial<PkItem> & { id: string }): PkItem {
  return {
    action: over.id,
    owner_id: "m1",
    due_date: "2026-11-20",
    completed_at: null,
    priority: null,
    priority_days: null,
    important: null,
    progress: "NOT_STARTED",
    last_changed_by: null,
    last_changed_at: null,
    updated_at: "2026-11-01T00:00:00Z",
    created_at: "2026-11-01T18:00:00Z",
    ...over,
  };
}

function band(id: string, pkDate: string, items: PkItem[]): PkBand {
  return { activityId: id, accountId: null, dealer: id, pkDate, location: null, items };
}

describe("taskOrder", () => {
  it("puts Do now first by nearest deadline, then Plan, Delegate, unprioritised oldest first, Eliminate, done", () => {
    const rows = [
      item({ id: "done", priority: "DO_NOW", due_date: "2026-11-01", completed_at: "2026-11-02T00:00:00Z" }),
      item({ id: "elim", priority: "ELIMINATE" }),
      item({ id: "none-new", created_at: "2026-11-10T18:00:00Z" }),
      item({ id: "none-old", created_at: "2026-10-01T18:00:00Z" }),
      item({ id: "delegate", priority: "DELEGATE", due_date: "2026-11-14" }),
      item({ id: "plan", priority: "PLAN", due_date: "2026-11-25" }),
      item({ id: "do-later", priority: "DO_NOW", due_date: "2026-11-16" }),
      item({ id: "do-late", priority: "DO_NOW", due_date: "2026-11-11" }),
    ];
    expect([...rows].sort(taskOrder).map((r) => r.id)).toEqual([
      "do-late",
      "do-later",
      "plan",
      "delegate",
      "none-old",
      "none-new",
      "elim",
      "done",
    ]);
  });
});

describe("bandOrder", () => {
  it("lifts an older dealer whose Do now is nearer than a newer PK's", () => {
    const newerPk = band("newer", "2026-11-12", [item({ id: "a", priority: "DO_NOW", due_date: "2026-11-17" })]);
    const olderDealer = band("older", "2026-10-01", [
      item({ id: "b", priority: "PLAN", due_date: "2026-12-01" }),
      item({ id: "c", priority: "DO_NOW", due_date: "2026-11-13" }),
    ]);
    const quiet = band("quiet", "2026-11-13", [item({ id: "d" })]);
    const empty = band("empty", "2026-11-13", []);
    expect([quiet, empty, newerPk, olderDealer].sort(bandOrder).map((b) => b.activityId)).toEqual([
      "older",
      "newer",
      "quiet",
      "empty",
    ]);
  });
});

describe("daysOpen", () => {
  it("counts to today while open and stops on the day it was done", () => {
    expect(daysOpen(item({ id: "x", created_at: "2026-11-03T18:00:00Z" }), "2026-11-13")).toBe(10);
    expect(
      daysOpen(item({ id: "y", created_at: "2026-11-03T18:00:00Z", completed_at: "2026-11-05T18:00:00Z" }), "2026-11-13"),
    ).toBe(2);
    expect(daysOpen(item({ id: "z", created_at: undefined }), "2026-11-13")).toBeNull();
  });
});
