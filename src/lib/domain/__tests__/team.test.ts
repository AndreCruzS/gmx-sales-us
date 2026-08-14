import { describe, expect, it } from "vitest";
import { compareByNeed, repState, teamNarrative } from "../team";

const standing = (over: Partial<Parameters<typeof repState>[0]> = {}) => ({
  todayStops: 0,
  owed: 0,
  missed: 0,
  ...over,
});

describe("repState", () => {
  it("puts a lost day above everything else", () => {
    const s = repState(standing({ missed: 2, owed: 1, todayStops: 3 }));
    expect(s.key).toBe("behind");
    expect(s.label).toBe("2 never happened");
    expect(s.alarm).toBe(true);
  });

  it("reads an unwritten visit as owed, not as a quiet day", () => {
    const s = repState(standing({ owed: 1, todayStops: 2 }));
    expect(s.key).toBe("owes");
    expect(s.label).toBe("Owes a debrief");
    expect(s.alarm).toBe(true);
  });

  it("counts the day when there is nothing owed", () => {
    expect(repState(standing({ todayStops: 3 })).label).toBe("3 stops today");
    expect(repState(standing({ todayStops: 1 })).label).toBe("1 stop today");
  });

  it("calls an empty day a desk day rather than a failure", () => {
    const s = repState(standing());
    expect(s.key).toBe("desk");
    expect(s.alarm).toBe(false);
  });
});

describe("compareByNeed", () => {
  it("sorts the people who need a manager to the top", () => {
    const rows = [
      { name: "Zoe", state: repState(standing()) },
      { name: "Ade", state: repState(standing({ todayStops: 2 })) },
      { name: "Ben", state: repState(standing({ missed: 1 })) },
      { name: "Cal", state: repState(standing({ owed: 1 })) },
    ];
    expect([...rows].sort(compareByNeed).map((r) => r.name)).toEqual([
      "Ben",
      "Cal",
      "Ade",
      "Zoe",
    ]);
  });

  it("breaks a tie on the name so the order does not wander", () => {
    const rows = [
      { name: "Zoe", state: repState(standing({ todayStops: 1 })) },
      { name: "Ade", state: repState(standing({ todayStops: 9 })) },
    ];
    expect([...rows].sort(compareByNeed).map((r) => r.name)).toEqual(["Ade", "Zoe"]);
  });
});

describe("teamNarrative", () => {
  const row = (o: Partial<{ done: number; total: number; owed: number; missed: number }>) => ({
    done: 0,
    total: 0,
    owed: 0,
    missed: 0,
    ...o,
  });

  it("says the week plainly when nothing is wrong", () => {
    expect(teamNarrative([row({ done: 4, total: 4 }), row({ done: 6, total: 6 })])).toBe(
      "10 of 10 planned visits done this week.",
    );
  });

  it("names what is wrong, in the order a manager acts on it", () => {
    expect(
      teamNarrative([row({ done: 10, total: 16, missed: 3, owed: 2 })]),
    ).toBe("10 of 16 planned visits done this week. 3 never happened, 2 are waiting on a debrief.");
  });

  it("uses the singular for one", () => {
    expect(teamNarrative([row({ done: 1, total: 2, owed: 1 })])).toBe(
      "1 of 2 planned visits done this week. 1 is waiting on a debrief.",
    );
  });

  it("does not pretend there is a week when nobody planned one", () => {
    expect(teamNarrative([])).toBe("Nothing planned across the team this week.");
    expect(teamNarrative([row({})])).toBe("Nothing planned across the team this week.");
  });
});
