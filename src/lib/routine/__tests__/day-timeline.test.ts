// The spine puts the day in time order. What these tests hold is the boundary
// between "behind you" and "ahead": a stop that passed with nothing logged owes
// a debrief and must sit ABOVE the now marker, because it is the one thing on
// the screen a rep can still fix today.

import { describe, expect, it } from "vitest";
import { buildDayTimeline } from "@/lib/routine/day-timeline";
import type { CachedAgendaItem } from "@/lib/offline";

const TODAY = "2026-08-12";
const HORIZON = "2026-08-19";

const item = (over: Partial<CachedAgendaItem> & { id: string }): CachedAgendaItem => ({
  action: "Visit",
  due_date: TODAY,
  completed_at: null,
  account_id: null,
  opportunity_id: null,
  objective: null,
  kind: "VISIT",
  created_at: `${TODAY}T08:00:00Z`,
  updated_at: `${TODAY}T08:00:00Z`,
  ...over,
});

describe("buildDayTimeline", () => {
  it("puts a stop that passed with nothing logged behind the now marker", () => {
    const t = buildDayTimeline(
      [item({ id: "missed", due_date: "2026-08-11" })],
      TODAY,
      HORIZON,
    );
    expect(t.before.map((s) => s.id)).toEqual(["missed"]);
    expect(t.before[0].state).toBe("flagged");
    expect(t.needsDebrief).toBe(1);
    expect(t.after).toHaveLength(0);
  });

  it("counts work logged today as done and behind you", () => {
    const t = buildDayTimeline(
      [item({ id: "logged", completed_at: `${TODAY}T09:00:00Z` })],
      TODAY,
      HORIZON,
    );
    expect(t.before[0].state).toBe("done");
    expect(t.done).toBe(1);
    expect(t.needsDebrief).toBe(0);
  });

  it("keeps a stop debriefed today on the spine, as done", () => {
    // Logging yesterday's missed visit is work done today. If it dropped out
    // of the timeline the moment a rep saved it, the save would look like a
    // failure — the row would simply disappear.
    const t = buildDayTimeline(
      [
        item({
          id: "caught-up",
          due_date: "2026-08-11",
          completed_at: `${TODAY}T07:30:00Z`,
        }),
      ],
      TODAY,
      HORIZON,
    );
    expect(t.before.map((s) => s.id)).toEqual(["caught-up"]);
    expect(t.before[0].state).toBe("done");
    expect(t.done).toBe(1);
    expect(t.needsDebrief).toBe(0);
  });

  it("does not let an earlier day's win count towards today", () => {
    // Otherwise a quiet day silently inherits yesterday's numbers.
    const t = buildDayTimeline(
      [item({ id: "yesterday", due_date: "2026-08-11", completed_at: "2026-08-11T09:00:00Z" })],
      TODAY,
      HORIZON,
    );
    expect(t.done).toBe(0);
    expect(t.before).toHaveLength(0);
  });

  it("treats a visit due today but not logged as still ahead", () => {
    // An agenda row carries a date, not a clock time, so "today and unlogged"
    // cannot be assumed to have already passed.
    const t = buildDayTimeline([item({ id: "later" })], TODAY, HORIZON);
    expect(t.after.map((s) => s.id)).toEqual(["later"]);
    expect(t.after[0].state).toBe("planned");
  });

  it("counts an unclassified row as a visit ahead, but never as a missed one", () => {
    // /visits treats a null kind as a visit, so coming-up must agree. But a
    // null kind is not evidence that a visit actually happened and was missed.
    const ahead = buildDayTimeline([item({ id: "unclassified", kind: null })], TODAY, HORIZON);
    expect(ahead.after.map((s) => s.id)).toEqual(["unclassified"]);

    const behind = buildDayTimeline(
      [item({ id: "old-unclassified", kind: null, due_date: "2026-08-10" })],
      TODAY,
      HORIZON,
    );
    expect(behind.needsDebrief).toBe(0);
    expect(behind.before).toHaveLength(0);
  });

  it("stops at the horizon", () => {
    const t = buildDayTimeline(
      [
        item({ id: "inside", due_date: HORIZON }),
        item({ id: "outside", due_date: "2026-08-20" }),
      ],
      TODAY,
      HORIZON,
    );
    expect(t.after.map((s) => s.id)).toEqual(["inside"]);
  });

  it("reads in time order on both sides of the marker", () => {
    const t = buildDayTimeline(
      [
        item({ id: "b", due_date: "2026-08-13" }),
        item({ id: "a", due_date: TODAY }),
        item({ id: "missed-late", due_date: "2026-08-11" }),
        item({ id: "missed-early", due_date: "2026-08-10" }),
      ],
      TODAY,
      HORIZON,
    );
    expect(t.before.map((s) => s.id)).toEqual(["missed-early", "missed-late"]);
    expect(t.after.map((s) => s.id)).toEqual(["a", "b"]);
    expect(t.stops).toBe(4);
  });
});
