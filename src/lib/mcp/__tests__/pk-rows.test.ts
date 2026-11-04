import { describe, expect, it } from "vitest";
import { alertDate } from "@/lib/domain/pk-follow-up";
import { planPkFollowUp, type PkFollowUpInput } from "../pk-rows";

const PK = "2026-11-03";
const f = (o: Partial<PkFollowUpInput>): PkFollowUpInput => ({
  action: "x",
  urgent: false,
  important: false,
  reason: "r",
  asked_by_dealer: false,
  ...o,
});

describe("planPkFollowUp (the Say it rule)", () => {
  it("urgent and important, no date: DO_NOW, 1 day", () => {
    expect(planPkFollowUp(PK, f({ urgent: true, important: true }))).toMatchObject({
      save: true, priority: "DO_NOW", priority_days: 1, due_date: alertDate(PK, 1),
    });
  });
  it("important only: PLAN, 7 days", () => {
    expect(planPkFollowUp(PK, f({ important: true }))).toMatchObject({ priority: "PLAN", priority_days: 7, due_date: alertDate(PK, 7) });
  });
  it("urgent only: DELEGATE, 2 days", () => {
    expect(planPkFollowUp(PK, f({ urgent: true }))).toMatchObject({ priority: "DELEGATE", priority_days: 2, due_date: alertDate(PK, 2) });
  });
  it("neither: not saved", () => {
    expect(planPkFollowUp(PK, f({}))).toEqual({ save: false, reason: "r" });
  });
  it("neither but the dealer asked: DELEGATE", () => {
    expect(planPkFollowUp(PK, f({ asked_by_dealer: true }))).toMatchObject({ save: true, priority: "DELEGATE" });
  });
  it("a said date sets the days", () => {
    expect(planPkFollowUp(PK, f({ important: true, due_date: "2026-11-10" }))).toMatchObject({ priority_days: 7, due_date: "2026-11-10" });
  });
  it("a said date before the PK is the PK day", () => {
    expect(planPkFollowUp(PK, f({ important: true, due_date: "2026-11-01" }))).toMatchObject({ priority_days: 0, due_date: PK });
  });
});
