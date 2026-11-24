import { describe, expect, it } from "vitest";
import type { SellThroughRow } from "../sell-through";
import {
  accountsWorkedIn,
  followUpKeeping,
  periodStart,
  touches,
  workingNotSelling,
  type EffortTrace,
  type FollowUpRow,
} from "../rep-work";

// Noon UTC is the same calendar day in Los Angeles.
const at = (day: string) => `${day}T19:00:00Z`;

describe("periodStart", () => {
  it("month, quarter and year", () => {
    expect(periodStart("month", "2026-11-24")).toBe("2026-11-01");
    expect(periodStart("quarter", "2026-11-24")).toBe("2026-10-01");
    expect(periodStart("quarter", "2026-03-31")).toBe("2026-01-01");
    expect(periodStart("year", "2026-11-24")).toBe("2026-01-01");
  });
});

describe("touches + accountsWorkedIn (metric 1)", () => {
  const traces: EffortTrace[] = [
    { account_id: "d1", membership_id: "r1", happened_at: at("2026-11-05"), kind: "VISIT" },
    // the same visit, listed again for the primary account
    { account_id: "d1", membership_id: "r1", happened_at: at("2026-11-05"), kind: "VISIT" },
    { account_id: "d2", membership_id: "r1", happened_at: at("2026-11-06"), kind: "PLANNED" },
    { account_id: "d3", membership_id: "r2", happened_at: at("2026-11-07"), kind: "NOTE" },
    { account_id: "dist", membership_id: "r1", happened_at: at("2026-11-07"), kind: "VISIT" },
    { account_id: "d4", membership_id: "r1", happened_at: at("2026-10-20"), kind: "QUOTE" },
  ];
  const fu: FollowUpRow[] = [
    { account_id: "d2", owner_id: "r1", due_date: "2026-11-10", completed_at: at("2026-11-09"), kind: "OTHER" },
    { account_id: "d5", owner_id: "r1", due_date: "2026-11-10", completed_at: null, kind: "OTHER" },
  ];
  const all = touches(traces, fu);
  const dealers = new Set(["d1", "d2", "d3", "d4", "d5"]);

  it("a planned follow-up is not work; a kept one is; a distributor is not a dealer", () => {
    expect(accountsWorkedIn(all, dealers, "r1", "2026-11-01", "2026-11-24")).toBe(2); // d1 visit, d2 kept
  });
  it("the team, and a wider period", () => {
    expect(accountsWorkedIn(all, dealers, null, "2026-11-01", "2026-11-24")).toBe(3);
    expect(accountsWorkedIn(all, dealers, "r1", "2026-10-01", "2026-11-24")).toBe(3); // + d4's quote
  });
});

describe("followUpKeeping (metric 3)", () => {
  const today = "2026-11-24";
  const row = (due: string, done: string | null, kind: string | null = "OTHER", owner = "r1"): FollowUpRow => ({
    account_id: "d1",
    owner_id: owner,
    due_date: due,
    completed_at: done ? at(done) : null,
    kind,
  });
  it("counts what came due, kept on time or not, and the late ones now", () => {
    const k = followUpKeeping(
      [
        row("2026-11-10", "2026-11-09"), // on time
        row("2026-11-12", "2026-11-15"), // done late
        row("2026-11-14", null), // missed, late now
        row("2026-11-24", null), // due today, open: not missed yet
        row("2026-11-30", "2026-11-20"), // early: counts, on time
        row("2026-12-05", null), // not due: out
        row("2026-10-20", null), // earlier period, still late now
        row("2026-11-10", null, "VISIT"), // an appointment, not a promise
        row("2026-11-10", null, "OTHER", "r2"), // someone else's
      ],
      "r1",
      "2026-11-01",
      today,
    );
    expect(k).toEqual({ due: 4, onTime: 2, rate: 0.5, lateNow: 2 });
  });
  it("nothing due reads as no rate", () => {
    expect(followUpKeeping([], null, "2026-11-01", today).rate).toBeNull();
  });
});

describe("workingNotSelling (the alert)", () => {
  const sale = (dealer: string | null, period: string, qty: number, detail: "dealer" | "branch" = "dealer"): SellThroughRow =>
    ({
      period,
      dealer_id: dealer,
      quantity: qty,
      unit: "LF",
      detail,
      distributor_id: "h",
      distributor_name: "House",
      branch_id: "b",
      branch_name: "B",
      period_kind: "MONTH",
    }) as unknown as SellThroughRow;
  const traces: EffortTrace[] = [
    { account_id: "quiet", membership_id: "r1", happened_at: at("2026-11-01"), kind: "VISIT" },
    { account_id: "quiet", membership_id: "r1", happened_at: at("2026-10-01"), kind: "NOTE" },
    { account_id: "quiet", membership_id: "r1", happened_at: at("2026-09-15"), kind: "QUOTE" },
    { account_id: "buys", membership_id: "r1", happened_at: at("2026-11-01"), kind: "VISIT" },
    { account_id: "buys", membership_id: "r1", happened_at: at("2026-11-02"), kind: "NOTE" },
    { account_id: "buys", membership_id: "r1", happened_at: at("2026-11-03"), kind: "QUOTE" },
    { account_id: "thin", membership_id: "r1", happened_at: at("2026-11-01"), kind: "VISIT" },
    { account_id: "thin", membership_id: "r1", happened_at: at("2026-11-02"), kind: "NOTE" },
    // too old to count
    { account_id: "thin", membership_id: "r1", happened_at: at("2026-07-01"), kind: "NOTE" },
  ];
  const dealers = new Map([
    ["quiet", "Quiet Lumber"],
    ["buys", "Buying Lumber"],
    ["thin", "Thin Lumber"],
  ]);
  const months = ["2026-10-01", "2026-09-01", "2026-08-01"];
  const rows = [sale("buys", "2026-09-01", 500), sale(null, "2026-10-01", 900, "branch")];

  it("three touches in 90 days and no LF", () => {
    const out = workingNotSelling(touches(traces, []), dealers, rows, months, null, "2026-11-24");
    expect(out.map((d) => d.id)).toEqual(["quiet"]);
    expect(out[0]).toMatchObject({ name: "Quiet Lumber", touches: 3, last: "2026-11-01" });
  });
  it("scoped to a rep, and silent with no month on file", () => {
    expect(workingNotSelling(touches(traces, []), dealers, rows, months, "r2", "2026-11-24")).toEqual([]);
    expect(workingNotSelling(touches(traces, []), dealers, rows, [], null, "2026-11-24")).toEqual([]);
  });
});
