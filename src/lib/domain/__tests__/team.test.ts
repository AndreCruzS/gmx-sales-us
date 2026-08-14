import { describe, expect, it } from "vitest";
import { teamNarrative } from "../team";

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
