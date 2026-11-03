import { describe, expect, it } from "vitest";
import { yourPksLine } from "@/components/your-pks-card";

const zero = { pksOpen: 0, followUps: 0, alertPassed: 0, onUs: 0, waiting: 0, newForMe: 0 };

describe("Your PKs card line", () => {
  it("is hidden when nothing is open", () => {
    expect(yourPksLine(zero)).toBeNull();
  });

  it("reads PKs and follow-ups, and adds late and new only when there are some", () => {
    expect(yourPksLine({ ...zero, pksOpen: 1, followUps: 1 })).toBe("1 PK open · 1 follow-up");
    expect(yourPksLine({ ...zero, pksOpen: 3, followUps: 7, alertPassed: 1, newForMe: 2 })).toBe(
      "3 PKs open · 7 follow-ups · 1 alert passed · 2 new",
    );
  });
});
