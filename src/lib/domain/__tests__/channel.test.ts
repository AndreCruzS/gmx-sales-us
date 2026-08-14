import { describe, expect, it } from "vitest";
import {
  groupByDealer,
  groupByDistributor,
  groupByRep,
  groupFor,
  latestStartedWeek,
  type ChannelRow,
} from "../channel";

const row = (over: Partial<ChannelRow> = {}): ChannelRow => ({
  owner_id: "deon",
  week_start: "2026-08-10",
  account_id: "anaheim",
  account_name: "Ganahl Anaheim",
  account_type: "DEALER",
  distributor_id: "boise",
  distributor_name: "Boise Cascade",
  distributor_options: 1,
  planned_total: 1,
  planned_done: 1,
  planned_owed: 0,
  planned_missed: 0,
  ...over,
});

const NAMES = new Map([
  ["deon", "Deon"],
  ["tj", "TJ"],
]);

describe("groupByRep", () => {
  it("splits one rep's week by distributor", () => {
    const groups = groupByRep(
      [
        row({ planned_total: 3, planned_done: 2 }),
        row({
          account_id: "orange",
          account_name: "Ganahl Orange",
          distributor_id: "hardwoods",
          distributor_name: "Hardwoods Specialty",
          planned_total: 2,
          planned_done: 1,
        }),
      ],
      NAMES,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Deon");
    expect(groups[0].total).toBe(5);
    expect(groups[0].done).toBe(3);
    expect(groups[0].left).toBe(2);
    expect(groups[0].segments.map((s) => [s.label, s.total, s.done])).toEqual([
      ["Boise Cascade", 3, 2],
      ["Hardwoods Specialty", 2, 1],
    ]);
  });

  it("splits the plan four ways and never over-counts it", () => {
    const groups = groupByRep(
      [row({ planned_total: 5, planned_done: 3, planned_owed: 1, planned_missed: 1 })],
      NAMES,
    );
    const g = groups[0];
    expect([g.done, g.owed, g.missed, g.left]).toEqual([3, 1, 1, 1]);
    // done already contains owed — the bar draws (done - owed) alongside owed,
    // so done + missed + left is the whole plan and not a row more.
    expect(g.done + g.missed + g.left).toBe(g.total);
  });

  it("never lets the derived remainder go negative on messy data", () => {
    const groups = groupByRep(
      [row({ planned_total: 1, planned_done: 1, planned_missed: 1 })],
      NAMES,
    );
    expect(groups[0].left).toBe(0);
  });

  it("adds two visits to the same distributor into one segment", () => {
    const groups = groupByRep([row(), row({ account_id: "other" })], NAMES);
    expect(groups[0].segments).toHaveLength(1);
    expect(groups[0].segments[0].total).toBe(2);
  });

  it("puts the biggest gap at the top", () => {
    const groups = groupByRep(
      [
        row({ owner_id: "deon", planned_total: 5, planned_done: 5 }),
        row({ owner_id: "tj", planned_total: 5, planned_done: 1, planned_missed: 4 }),
      ],
      NAMES,
    );
    expect(groups.map((g) => g.label)).toEqual(["TJ", "Deon"]);
  });

  it("ranks a week that never happened above one still to come", () => {
    const groups = groupByRep(
      [
        // four visits still ahead of them — not yet a failure
        row({ owner_id: "deon", planned_total: 5, planned_done: 1 }),
        // one visit the day has already passed on — a cost, not just a gap
        row({ owner_id: "tj", planned_total: 5, planned_done: 4, planned_missed: 1 }),
      ],
      NAMES,
    );
    expect(groups.map((g) => g.label)).toEqual(["TJ", "Deon"]);
  });

  it("names a rep it has no name for rather than dropping the row", () => {
    const groups = groupByRep([row({ owner_id: "ghost" })], NAMES);
    expect(groups[0].label).toBe("—");
    expect(groups[0].total).toBe(1);
  });
});

describe("unresolved distributors", () => {
  it("keeps 'nobody said' apart from 'more than one'", () => {
    const groups = groupByRep(
      [
        row({ distributor_id: null, distributor_name: null, distributor_options: 0 }),
        row({
          account_id: "two-houses",
          distributor_id: null,
          distributor_name: null,
          distributor_options: 2,
        }),
      ],
      NAMES,
    );
    expect(groups[0].segments.map((s) => s.label).sort()).toEqual([
      "More than one",
      "No distributor",
    ]);
  });

  it("never invents a distributor when the id is missing", () => {
    const groups = groupByDistributor([
      row({ distributor_id: null, distributor_name: "Boise Cascade", distributor_options: 2 }),
    ]);
    expect(groups[0].label).toBe("More than one");
  });
});

describe("groupByDistributor", () => {
  it("turns the same rows inside out — distributor first, door as the split", () => {
    const groups = groupByDistributor([
      row({ planned_total: 2, planned_done: 1 }),
      row({ account_id: "orange", account_name: "Ganahl Orange", planned_total: 1, planned_done: 0 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Boise Cascade");
    expect(groups[0].total).toBe(3);
    expect(groups[0].segments.map((s) => s.label)).toEqual([
      "Ganahl Anaheim",
      "Ganahl Orange",
    ]);
  });
});

describe("groupByDealer", () => {
  it("counts dealers only — a contractor is a visit, not a door being sold through", () => {
    const groups = groupByDealer([
      row(),
      row({ account_id: "abc", account_name: "ABC Construction", account_type: "CONTRACTOR" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Ganahl Anaheim"]);
  });

  it("is empty rather than wrong when no dealer was planned", () => {
    expect(groupByDealer([row({ account_type: "ARCHITECT" })])).toEqual([]);
  });
});

describe("groupFor", () => {
  it("gives every lens the same week total", () => {
    const rows = [
      row({ planned_total: 2, planned_done: 1 }),
      row({
        account_id: "orange",
        account_name: "Ganahl Orange",
        distributor_id: "hardwoods",
        distributor_name: "Hardwoods Specialty",
        planned_total: 3,
        planned_done: 3,
      }),
    ];
    const sum = (l: "rep" | "distributor" | "dealer") =>
      groupFor(l, rows, NAMES).reduce((n, g) => n + g.total, 0);
    expect(sum("rep")).toBe(5);
    expect(sum("distributor")).toBe(5);
    expect(sum("dealer")).toBe(5);
  });
});

describe("latestStartedWeek", () => {
  const ms = (iso: string) => Date.parse(iso);

  it("ignores a week nobody has lived yet", () => {
    const rows = [row({ week_start: "2026-08-10" }), row({ week_start: "2026-08-17" })];
    expect(latestStartedWeek(rows, ms("2026-08-14"))).toBe("2026-08-10");
  });

  it("takes the newest week once it has begun", () => {
    const rows = [row({ week_start: "2026-08-10" }), row({ week_start: "2026-08-17" })];
    expect(latestStartedWeek(rows, ms("2026-08-18"))).toBe("2026-08-17");
  });

  it("is null when everything is still ahead", () => {
    expect(latestStartedWeek([row({ week_start: "2026-09-01" })], ms("2026-08-14"))).toBeNull();
  });

  it("is null for no rows at all", () => {
    expect(latestStartedWeek([], ms("2026-08-14"))).toBeNull();
  });
});
