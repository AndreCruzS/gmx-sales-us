import { describe, expect, it } from "vitest";
import { calendarDateIn } from "@/lib/domain/pk-follow-up";
import { pkMoment, planDeadline, planPkFollowUp, type PkFollowUpInput } from "../pk-rows";

const PK = "2026-11-10";
const TODAY = "2026-11-10"; // a Tuesday: two business days on is Thursday the 12th
const f = (o: Partial<PkFollowUpInput>): PkFollowUpInput => ({
  action: "x",
  important: false,
  reason: "r",
  ...o,
});
const plan = (o: Partial<PkFollowUpInput>, gives = false, pk = PK) => planPkFollowUp(pk, f(o), TODAY, gives);

describe("planPkFollowUp (deadlines decide urgency)", () => {
  it("urgent and not important: Plan for a rep, due in two business days", () => {
    expect(plan({ urgent: true, important: false })).toMatchObject({ save: true, priority: "PLAN", due_date: "2026-11-12" });
  });
  it("the same for an admin owner is Delegate", () => {
    expect(plan({ urgent: true, important: false }, true)).toMatchObject({ save: true, priority: "DELEGATE", due_date: "2026-11-12" });
  });
  it("important and urgent: Do now, days counted from the PK date", () => {
    expect(plan({ urgent: true, important: true })).toMatchObject({ priority: "DO_NOW", due_date: "2026-11-12", priority_days: 2 });
  });
  it("important, no date: Plan, 5 business days after the PK", () => {
    expect(plan({ important: true })).toMatchObject({ priority: "PLAN", due_date: "2026-11-17", priority_days: 7 });
  });
  it("neither: suggested to drop, and the stored value is never Eliminate", () => {
    expect(plan({})).toMatchObject({ save: false, suggestDrop: true, priority: "PLAN", reason: "r" });
    expect(plan({}, true)).toMatchObject({ save: false, priority: "DELEGATE" });
  });
  it("the dealer asking counts as urgent: saved, never dropped", () => {
    expect(plan({ asked_by_dealer: true })).toMatchObject({ save: true, priority: "PLAN", due_date: "2026-11-12" });
  });
  it("a said date is used as said when not urgent", () => {
    expect(plan({ important: true, due_date: "2026-11-30" })).toMatchObject({ priority: "PLAN", due_date: "2026-11-30" });
  });
  it("a said date inside two business days makes it Do now", () => {
    expect(plan({ important: true, due_date: "2026-11-11" })).toMatchObject({ priority: "DO_NOW", due_date: "2026-11-11" });
  });
  it("urgent caps a said date that is too far", () => {
    expect(plan({ important: true, urgent: true, due_date: "2026-11-30" })).toMatchObject({ priority: "DO_NOW", due_date: "2026-11-12" });
  });
  it("a said date before the PK has 0 days", () => {
    expect(plan({ important: true, due_date: "2026-11-01" })).toMatchObject({ priority_days: 0, due_date: "2026-11-01" });
  });
});

describe("planDeadline", () => {
  const base = { today: TODAY, fallback: "2026-12-01", ownerGivesWork: false };
  it("is not urgent without the flag: the fallback stands", () => {
    expect(planDeadline({ ...base, important: true })).toEqual({ due_date: "2026-12-01", priority: "PLAN", suggestDrop: false });
  });
  it("urgent caps the fallback", () => {
    expect(planDeadline({ ...base, important: false, urgent: true })).toEqual({ due_date: "2026-11-12", priority: "PLAN", suggestDrop: false });
  });
});

describe("zone-aware PK dates", () => {
  it("calendarDateIn reads the date in the zone", () => {
    expect(calendarDateIn("2026-11-05T02:30:00Z", "America/Los_Angeles")).toBe("2026-11-04");
  });
  it("an explicit offset keeps the date the person said", () => {
    expect(pkMoment("2026-11-04T18:30:00-08:00", "UTC")).toEqual({ instant: "2026-11-05T02:30:00.000Z", pkDate: "2026-11-04" });
  });
  it("Z uses the person's zone", () => {
    expect(pkMoment("2026-11-05T02:30:00Z", "America/Los_Angeles").pkDate).toBe("2026-11-04");
  });
  it("no offset is wall time in the zone", () => {
    expect(pkMoment("2026-11-04T18:30:00", "America/Los_Angeles")).toEqual({ instant: "2026-11-05T02:30:00.000Z", pkDate: "2026-11-04" });
  });
  it("an hours-only offset (+05) is read as +05:00", () => {
    expect(pkMoment("2026-11-04T18:30:00+05", "UTC")).toEqual({ instant: "2026-11-04T13:30:00.000Z", pkDate: "2026-11-04" });
  });
  it("a nonsense date throws a RangeError (the tool wrapper turns it into plain English)", () => {
    expect(() => pkMoment("2026-13-45T99:00:00Z", "UTC")).toThrow(RangeError);
  });
});
