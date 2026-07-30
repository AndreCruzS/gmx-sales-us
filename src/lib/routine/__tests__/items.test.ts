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
