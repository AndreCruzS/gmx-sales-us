// Task 3 (D-routine): pure builder that mirrors the `routine_items` DB view
// (supabase/migrations/20260729000100_routine.sql) for offline use. No
// grace period on the overdue boundary — an open chore is in routine while
// due_date >= today and escalates to exceptions the instant due_date < today.

import { describe, expect, it } from "vitest";
import type { CachedAccount, CachedAgendaItem } from "@/lib/offline";
import {
  buildRoutineItems,
  debriefWaiting,
  groupRoutine,
  type RoutineSettings,
} from "../items";

const TODAY = "2026-07-29";

const SETTINGS: RoutineSettings = {
  display_routine_months: 4,
  display_verify_months: 6,
  overdue_follow_up_days: 7,
};

function na(
  overrides: Partial<CachedAgendaItem> & Pick<CachedAgendaItem, "id">,
): CachedAgendaItem {
  return {
    action: "Follow up",
    due_date: TODAY,
    completed_at: null,
    account_id: null,
    opportunity_id: null,
    objective: null,
    kind: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

function acct(
  overrides: Partial<CachedAccount> & Pick<CachedAccount, "id">,
): CachedAccount {
  return {
    name: "Acme Co",
    account_type: "DEALER",
    city: null,
    territory_id: "t1",
    has_display_wall: false,
    display_last_verified_at: null,
    parent_account_id: null,
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildRoutineItems", () => {
  it("groups samples and quotes as chores due today or later", () => {
    const agenda = [
      na({
        id: "s1",
        kind: "SAMPLE_FOLLOW_UP",
        action: "Follow up on samples",
        due_date: "2026-08-01",
      }),
      na({
        id: "q1",
        kind: "QUOTE_FOLLOW_UP",
        action: "Chase the quote",
        due_date: "2026-07-29",
      }),
    ];
    const items = buildRoutineItems(agenda, [], SETTINGS, TODAY);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.kind).sort()).toEqual([
      "QUOTE_FOLLOW_UP",
      "SAMPLE_FOLLOW_UP",
    ]);
  });

  it("excludes VISIT kind next actions", () => {
    const agenda = [
      na({
        id: "v1",
        kind: "VISIT",
        objective: "Discovery",
        due_date: "2026-08-01",
      }),
    ];
    expect(buildRoutineItems(agenda, [], SETTINGS, TODAY)).toEqual([]);
  });

  it("excludes completed next actions", () => {
    const agenda = [
      na({
        id: "c1",
        kind: "OTHER",
        due_date: "2026-08-01",
        completed_at: "2026-07-20T00:00:00.000Z",
      }),
    ];
    expect(buildRoutineItems(agenda, [], SETTINGS, TODAY)).toEqual([]);
  });

  it("escalated chores leave routine", () => {
    const s = {
      display_routine_months: 4,
      display_verify_months: 6,
      overdue_follow_up_days: 7,
    };
    const agenda = [
      na({ id: "old", kind: "QUOTE_FOLLOW_UP", due_date: "2026-07-10" }),
    ];
    expect(buildRoutineItems(agenda, [], s, "2026-07-29")).toEqual([]);
  });

  it("includes a display check at 5 months unverified", () => {
    const accounts = [
      acct({
        id: "a1",
        has_display_wall: true,
        display_last_verified_at: "2026-02-28",
      }),
    ];
    const items = buildRoutineItems([], accounts, SETTINGS, TODAY);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("DISPLAY_CHECK");
  });

  it("excludes a display check at 7 months unverified (already escalated)", () => {
    const accounts = [
      acct({
        id: "a1",
        has_display_wall: true,
        display_last_verified_at: "2025-12-29",
      }),
    ];
    expect(buildRoutineItems([], accounts, SETTINGS, TODAY)).toEqual([]);
  });

  it("excludes display checks with no verification date on record", () => {
    const accounts = [
      acct({
        id: "a1",
        has_display_wall: true,
        display_last_verified_at: null,
      }),
    ];
    expect(buildRoutineItems([], accounts, SETTINGS, TODAY)).toEqual([]);
  });

  // Regression guard (review round 1, Important finding): addMonths used to
  // use plain Date.setMonth, which OVERFLOWS past a short month instead of
  // clamping the way Postgres's `date + make_interval(months => n)` does.
  // "2025-10-31" + 4 months rolled to "2026-03-03" (JS overflow) instead of
  // the Postgres-correct "2026-02-28" (clamped to Feb's last day). Fixed by
  // detecting the overflow and rolling back to day 0 of the target month.
  //
  // Expected values below are derived directly from the migration's own
  // WHERE-clause predicates (supabase/migrations/20260729000100_routine.sql
  // lines 89-98), not from this file's addMonths — i.e. by independently
  // emulating what `now() - make_interval(months => n)` computes in
  // Postgres (subtract n from today's month, clamping the day to today's
  // day-of-month against the *target* month's length), for
  // display_last_verified_at = "2025-10-31":
  //
  //   routine boundary (4mo, condition uses strict `<`):
  //     today=2026-02-27 -> now-4mo=2025-10-27 -> 2025-10-31 <  that? false
  //     today=2026-02-28 -> now-4mo=2025-10-28 -> 2025-10-31 <  that? false  (exactly 4 clamped
  //                                                                            months old is NOT yet
  //                                                                            "strictly older" -> excluded)
  //     today=2026-03-01 -> now-4mo=2025-11-01 -> 2025-10-31 <  that? true   (first included day)
  //     today=2026-03-03 -> now-4mo=2025-11-03 -> 2025-10-31 <  that? true   (included — this is the
  //                                                                            exact date the JS-overflow
  //                                                                            bug got wrong, since the
  //                                                                            unclamped boundary was
  //                                                                            itself "2026-03-03",
  //                                                                            making the old `<` compare
  //                                                                            self < self -> excluded)
  //
  //   verify boundary (6mo, condition uses inclusive `>=`):
  //     today=2026-04-30 -> now-6mo=2025-10-30 -> 2025-10-31 >= that? true   (still inside window)
  //     today=2026-05-01 -> now-6mo=2025-11-01 -> 2025-10-31 >= that? false  (escalated, first excluded day)
  //
  // These agree exactly with this module's own addMonths-based comparison
  // once addMonths clamps correctly: addMonths("2025-10-31", 4) ==
  // "2026-02-28" (routineBoundary < today), addMonths("2025-10-31", 6) ==
  // "2026-04-30" (today <= verifyBoundary).
  describe("month-end clamping at the display-check boundaries", () => {
    const VERIFIED = "2025-10-31"; // month-end anchor that exposes the bug

    it("excludes a display check exactly at the clamped 4-month routine boundary (strict <)", () => {
      const accounts = [
        acct({ id: "a1", has_display_wall: true, display_last_verified_at: VERIFIED }),
      ];
      // addMonths(VERIFIED, 4) clamps to "2026-02-28"; the routine condition
      // is strict `<`, so being exactly on the boundary does not qualify yet.
      expect(buildRoutineItems([], accounts, SETTINGS, "2026-02-28")).toEqual([]);
    });

    it("includes a display check the day after the clamped 4-month routine boundary", () => {
      const accounts = [
        acct({ id: "a1", has_display_wall: true, display_last_verified_at: VERIFIED }),
      ];
      const items = buildRoutineItems([], accounts, SETTINGS, "2026-03-01");
      expect(items).toHaveLength(1);
    });

    it("includes a display check at the date the old overflow bug wrongly excluded (2026-03-03)", () => {
      const accounts = [
        acct({ id: "a1", has_display_wall: true, display_last_verified_at: VERIFIED }),
      ];
      // Pre-fix, addMonths("2025-10-31", 4) overflowed to "2026-03-03" (its
      // own todayIso), so `boundary < today` compared self-to-self and was
      // always false here. Postgres's clamped boundary is "2026-02-28", well
      // before this date, so the correct answer is included.
      const items = buildRoutineItems([], accounts, SETTINGS, "2026-03-03");
      expect(items).toHaveLength(1);
    });

    it("includes a display check exactly at the clamped 6-month verify boundary (inclusive >=)", () => {
      const accounts = [
        acct({ id: "a1", has_display_wall: true, display_last_verified_at: VERIFIED }),
      ];
      // addMonths(VERIFIED, 6) clamps to "2026-04-30"; the verify condition
      // is `>=`, so exactly on the boundary still qualifies (last included day).
      const items = buildRoutineItems([], accounts, SETTINGS, "2026-04-30");
      expect(items).toHaveLength(1);
    });

    it("excludes a display check the day after the clamped 6-month verify boundary (escalated)", () => {
      const accounts = [
        acct({ id: "a1", has_display_wall: true, display_last_verified_at: VERIFIED }),
      ];
      expect(buildRoutineItems([], accounts, SETTINGS, "2026-05-01")).toEqual([]);
    });
  });

  it("sources contextDate from created_at, not updated_at", () => {
    const agenda = [
      na({
        id: "s1",
        kind: "SAMPLE_FOLLOW_UP",
        due_date: "2026-08-01",
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-07-20T00:00:00.000Z",
      }),
    ];
    const items = buildRoutineItems(agenda, [], SETTINGS, TODAY);
    expect(items[0].contextDate).toBe("2026-06-01T00:00:00.000Z");
  });

  it("falls back to an empty account name when accountId is null", () => {
    const agenda = [
      na({ id: "o1", kind: "OTHER", account_id: null, due_date: "2026-08-01" }),
    ];
    const items = buildRoutineItems(agenda, [], SETTINGS, TODAY);
    expect(items[0].accountName).toBe("");
  });
});

describe("groupRoutine", () => {
  it("orders groups fixed, omits empty ones, uses exact labels", () => {
    const agenda = [
      na({ id: "s1", kind: "SAMPLE_FOLLOW_UP", due_date: "2026-08-01" }),
      na({ id: "o1", kind: "OTHER", due_date: "2026-08-01" }),
    ];
    const items = buildRoutineItems(agenda, [], SETTINGS, TODAY);
    const groups = groupRoutine(items);
    expect(groups.map((g) => g.label)).toEqual([
      "Samples to follow up",
      "Also on your list",
    ]);
  });

  it("uses the exact label set for all four kinds and skips empty groups", () => {
    const accounts = [
      acct({
        id: "a1",
        has_display_wall: true,
        display_last_verified_at: "2026-02-28",
      }),
    ];
    const agenda = [
      na({ id: "s1", kind: "SAMPLE_FOLLOW_UP", due_date: "2026-08-01" }),
      na({ id: "q1", kind: "QUOTE_FOLLOW_UP", due_date: "2026-08-01" }),
      na({ id: "o1", kind: "OTHER", due_date: "2026-08-01" }),
    ];
    const items = buildRoutineItems(agenda, accounts, SETTINGS, TODAY);
    const groups = groupRoutine(items);
    expect(groups.map((g) => g.label)).toEqual([
      "Samples to follow up",
      "Quotes to chase",
      "Display walls to check",
      "Also on your list",
    ]);
  });
});

describe("debriefWaiting", () => {
  it("returns yesterday's unvisited visit, not today's", () => {
    const agenda = [
      na({
        id: "yesterday",
        kind: "VISIT",
        objective: "Discovery",
        due_date: "2026-07-28",
      }),
      na({
        id: "today",
        kind: "VISIT",
        objective: "Discovery",
        due_date: "2026-07-29",
      }),
    ];
    const result = debriefWaiting(agenda, TODAY);
    expect(result.map((i) => i.id)).toEqual(["yesterday"]);
  });

  it("excludes visits already debriefed", () => {
    const agenda = [
      na({
        id: "done",
        kind: "VISIT",
        objective: "Discovery",
        due_date: "2026-07-28",
        completed_at: "2026-07-28T10:00:00.000Z",
      }),
    ];
    expect(debriefWaiting(agenda, TODAY)).toEqual([]);
  });
});
