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
  // Review round 1 fixed the overflow-vs-clamp bug in addMonths. Review
  // round 2 (live-Postgres-confirmed) found the builder was clamping on the
  // wrong anchor: the view's membership predicates are `verified <
  // now() - interval` / `verified >= now() - interval` — subtraction
  // anchored on TODAY — not `verified + interval < today` — addition
  // anchored on VERIFIED. Both formulations look algebraically equivalent,
  // but Postgres clamps day-of-month overflow using the day of whichever
  // value the interval is applied TO, so they diverge whenever today's
  // day-of-month lands in a shorter target month than verified's would.
  // Fixed by adding subMonths(dateIso, n) (mirrors `date - interval`,
  // UTC-anchored and clamped the same way as addMonths) and rewriting both
  // membership predicates as `verified < subMonths(todayIso, n)` /
  // `verified >= subMonths(todayIso, n)` — the view's own formulation,
  // verbatim. `dueDate` is untouched: the view computes it as
  // `verified + interval` (migration ~line 93), so it correctly keeps using
  // addMonths(verified, n).
  //
  // The five tests below were re-derived under the corrected
  // subMonths-based formulation and were unchanged by the round-2 fix (all
  // five gave the same boolean before and after — confirmed by hand and
  // against live Postgres by the reviewer), so their expectations are
  // untouched; only the comments below now explain them in terms of
  // subMonths(todayIso, n) rather than addMonths(verified, n).
  describe("month-end clamping at the display-check boundaries", () => {
    const VERIFIED = "2025-10-31"; // month-end anchor that exposes the bug

    it("excludes a display check exactly at the clamped 4-month routine boundary (strict <)", () => {
      const accounts = [
        acct({ id: "a1", has_display_wall: true, display_last_verified_at: VERIFIED }),
      ];
      // subMonths("2026-02-28", 4) = "2025-10-28" (Feb's day 28 fits in
      // October, no clamp needed here). VERIFIED ("2025-10-31") is not
      // strictly before that, so excluded.
      expect(buildRoutineItems([], accounts, SETTINGS, "2026-02-28")).toEqual([]);
    });

    it("includes a display check the day after the clamped 4-month routine boundary", () => {
      const accounts = [
        acct({ id: "a1", has_display_wall: true, display_last_verified_at: VERIFIED }),
      ];
      // subMonths("2026-03-01", 4) = "2025-11-01"; VERIFIED < that -> included.
      const items = buildRoutineItems([], accounts, SETTINGS, "2026-03-01");
      expect(items).toHaveLength(1);
    });

    it("includes a display check at the date the old overflow bug wrongly excluded (2026-03-03)", () => {
      const accounts = [
        acct({ id: "a1", has_display_wall: true, display_last_verified_at: VERIFIED }),
      ];
      // subMonths("2026-03-03", 4) = "2025-11-03"; VERIFIED < that -> included.
      const items = buildRoutineItems([], accounts, SETTINGS, "2026-03-03");
      expect(items).toHaveLength(1);
    });

    it("includes a display check exactly at the clamped 6-month verify boundary (inclusive >=)", () => {
      const accounts = [
        acct({ id: "a1", has_display_wall: true, display_last_verified_at: VERIFIED }),
      ];
      // subMonths("2026-04-30", 6) = "2025-10-30"; VERIFIED >= that -> included
      // (the verify condition is inclusive, so exactly-on-boundary still qualifies).
      const items = buildRoutineItems([], accounts, SETTINGS, "2026-04-30");
      expect(items).toHaveLength(1);
    });

    it("excludes a display check the day after the clamped 6-month verify boundary (escalated)", () => {
      const accounts = [
        acct({ id: "a1", has_display_wall: true, display_last_verified_at: VERIFIED }),
      ];
      // subMonths("2026-05-01", 6) = "2025-11-01"; VERIFIED >= that is false -> excluded.
      expect(buildRoutineItems([], accounts, SETTINGS, "2026-05-01")).toEqual([]);
    });

    // Round 2 regression: the confirmed counterexample from live Postgres.
    // `DATE '2026-02-28' < (DATE '2026-06-29' - make_interval(months => 4))`
    // = false (excluded) on the real routine_items view. The pre-fix
    // addition-anchored builder computed addMonths("2026-02-28", 4) =
    // "2026-06-28" (Feb's day 28 fits fine in June, no clamp) and then
    // "2026-06-28" < "2026-06-29" = true — wrongly included.
    it("subtracts from today (not verified) — confirmed counterexample against live Postgres", () => {
      const accounts = [
        acct({ id: "a1", has_display_wall: true, display_last_verified_at: "2026-02-28" }),
      ];
      expect(buildRoutineItems([], accounts, SETTINGS, "2026-06-29")).toEqual([]);
    });

    // Two more varied-day-of-month anchors on the TODAY side, each chosen
    // so today - N months lands in a shorter target month than verified's
    // own day-of-month would clamp to — i.e. cases where the old
    // addition-anchored formula and the correct subtraction-anchored one
    // give opposite answers. Each uses a dedicated settings object with a
    // very large display_verify_months so only the routine-boundary
    // predicate under test can determine membership.
    it("today's 31st clamps against a 30-day target month, not verified's day-of-month", () => {
      const s: RoutineSettings = {
        display_routine_months: 1,
        display_verify_months: 24,
        overdue_follow_up_days: 7,
      };
      // subMonths("2026-05-31", 1): May's day 31 doesn't fit April (30
      // days) -> clamps to "2026-04-30". VERIFIED sits exactly on that
      // boundary, so strict `<` excludes it.
      //   (For contrast, the old formula would get this wrong: addMonths(
      //   "2026-04-30", 1) = "2026-05-30" (April's day 30 fits fine in May,
      //   no clamp), and "2026-05-30" < "2026-05-31" is true -> wrongly
      //   included.)
      const accounts = [
        acct({ id: "a1", has_display_wall: true, display_last_verified_at: "2026-04-30" }),
      ];
      expect(buildRoutineItems([], accounts, s, "2026-05-31")).toEqual([]);
    });

    it("today's 30th clamps against February, not verified's day-of-month", () => {
      const s: RoutineSettings = {
        display_routine_months: 2,
        display_verify_months: 24,
        overdue_follow_up_days: 7,
      };
      // subMonths("2026-04-30", 2): April's day 30 doesn't fit February
      // 2026 (28 days, not a leap year) -> clamps to "2026-02-28". VERIFIED
      // sits exactly on that boundary, so strict `<` excludes it.
      //   (Old formula: addMonths("2026-02-28", 2) = "2026-04-28" (Feb's
      //   day 28 fits fine in April, no clamp), and "2026-04-28" <
      //   "2026-04-30" is true -> wrongly included.)
      const accounts = [
        acct({ id: "a1", has_display_wall: true, display_last_verified_at: "2026-02-28" }),
      ];
      expect(buildRoutineItems([], accounts, s, "2026-04-30")).toEqual([]);
    });
  });

  it("sources contextDate from created_at, not updated_at (date-only)", () => {
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
    // created_at is normalized to date-only at the builder boundary (finding 1):
    // real cached rows carry full timestamps, and passing them straight through
    // into a rendered "sample sent <contextDate>" line prints the raw offset
    // instead of a relative date.
    expect(items[0].contextDate).toBe("2026-06-01");
  });

  // Regression guard (final review, CRITICAL finding 1): `accounts.
  // display_last_verified_at` is timestamptz in the real DB — the cache holds
  // full timestamps like "2026-02-28T10:23:45.123+00:00", not bare dates.
  // addMonths/subMonths build `new Date(`${dateIso}T00:00:00Z`)`; feeding them
  // an already-full timestamp produces "...123+00:00T00:00:00Z", an Invalid
  // Date, and `.toISOString()` throws a RangeError. Any rep whose display wall
  // was verified 4-6 months ago (still inside the routine window) white-screens
  // Home and /routine. The builder must slice to date-only before doing any
  // date math.
  it("does not crash on timestamptz-format display_last_verified_at (real cached-data shape)", () => {
    const accounts = [
      acct({
        id: "a1",
        has_display_wall: true,
        display_last_verified_at: "2026-02-28T10:23:45.123+00:00",
      }),
    ];
    expect(() =>
      buildRoutineItems([], accounts, SETTINGS, TODAY),
    ).not.toThrow();
    const items = buildRoutineItems([], accounts, SETTINGS, TODAY);
    expect(items).toHaveLength(1);
    expect(items[0].contextDate).toBe("2026-02-28");
    expect(items[0].dueDate).toBe("2026-08-28");
  });

  // Same crash, reached through created_at instead: a legacy/real cached
  // next_action's created_at is also a full timestamptz string.
  it("does not crash on timestamptz-format created_at on a chore", () => {
    const agenda = [
      na({
        id: "s1",
        kind: "SAMPLE_FOLLOW_UP",
        due_date: "2026-08-01",
        created_at: "2026-06-01T14:32:07.500+00:00",
      }),
    ];
    expect(() =>
      buildRoutineItems(agenda, [], SETTINGS, TODAY),
    ).not.toThrow();
    const items = buildRoutineItems(agenda, [], SETTINGS, TODAY);
    expect(items[0].contextDate).toBe("2026-06-01");
  });

  // Legacy IndexedDB rows may predate the created_at field entirely. The
  // builder must not crash on `undefined.slice(...)` — it falls back to the
  // chore's own due_date (a real, meaningful date already on the row) rather
  // than an empty string, so a legacy chore's context line still shows a date.
  it("falls back to due_date when created_at is missing on a legacy cached row", () => {
    const agenda = [
      na({
        id: "s1",
        kind: "SAMPLE_FOLLOW_UP",
        due_date: "2026-08-01",
      }),
    ];
    delete (agenda[0] as { created_at?: string }).created_at;
    const items = buildRoutineItems(agenda, [], SETTINGS, TODAY);
    expect(items[0].contextDate).toBe("2026-08-01");
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
