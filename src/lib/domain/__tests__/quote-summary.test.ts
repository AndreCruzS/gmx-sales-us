import { describe, expect, it } from "vitest";
import { accountsWorked, quoteSummary, type SummaryEvent, type SummaryOpp } from "../quote-summary";

const opp = (id: string, stage: string, v: number | null, owner = "r1"): SummaryOpp => ({
  id,
  name: id,
  stage,
  estimated_revenue: v,
  owner_id: owner,
  created_at: "2026-11-02T10:00:00Z",
});
const ev = (id: string, to: string, at: string): SummaryEvent => ({
  opportunity_id: id,
  to_stage: to,
  occurred_at: at,
});

describe("quoteSummary", () => {
  const opps = [
    opp("a", "WON", 100),
    opp("b", "WON", 300, "r2"),
    opp("c", "QUOTE", 50),
    opp("d", "DECISION", 70),
    opp("e", "LOST", 40),
    opp("f", "IDENTIFIED", 999),
  ];
  const events = [
    ev("a", "QUOTE", "2026-11-03T10:00:00Z"),
    ev("a", "WON", "2026-11-10T10:00:00Z"),
    ev("b", "WON", "2026-11-04T10:00:00Z"),
    ev("c", "QUOTE", "2026-11-12T10:00:00Z"),
    ev("d", "DECISION", "2026-11-12T10:00:00Z"),
    ev("e", "QUOTE", "2026-11-05T10:00:00Z"),
    ev("e", "LOST", "2026-11-06T10:00:00Z"),
  ];

  it("reads the team", () => {
    const s = quoteSummary(opps, events, null, "2026-11-17");
    expect(s.closed).toBe(400);
    expect(s.wonCount).toBe(2);
    expect(s.pipeline).toBe(120);
    expect(s.openCount).toBe(2);
    expect(s.winRate).toBeCloseTo(2 / 3);
    expect(s.quotesSent).toBe(5); // a b c d e — not the IDENTIFIED one
    expect(s.avgTicket).toBe(200);
    expect(s.topWins.map((w) => w.id)).toEqual(["b", "a"]);
  });

  it("cumulates the won value week by week to today", () => {
    const s = quoteSummary(opps, events, null, "2026-11-17");
    expect(s.curve).toEqual([
      { week: "2026-11-02", total: 300 },
      { week: "2026-11-09", total: 400 },
      { week: "2026-11-16", total: 400 },
    ]);
  });

  it("narrows to one rep", () => {
    const s = quoteSummary(opps, events, "r2", "2026-11-17");
    expect(s.closed).toBe(300);
    expect(s.pipeline).toBe(0);
    expect(s.winRate).toBe(1);
  });

  it("says nothing rather than zero when no quote exists", () => {
    const s = quoteSummary([opp("f", "IDENTIFIED", 10)], [], null, "2026-11-17");
    expect(s.winRate).toBeNull();
    expect(s.avgTicket).toBeNull();
    expect(s.curve).toEqual([]);
    expect(s.quotesSent).toBe(0);
  });
});

describe("accountsWorked", () => {
  it("counts distinct accounts per rep since a date", () => {
    const effort = [
      { account_id: "x", membership_id: "r1", happened_at: "2026-11-10" },
      { account_id: "x", membership_id: "r1", happened_at: "2026-11-11" },
      { account_id: "y", membership_id: "r2", happened_at: "2026-11-11" },
      { account_id: "z", membership_id: "r1", happened_at: "2026-01-01" },
    ];
    expect(accountsWorked(effort, null, "2026-11-01")).toBe(2);
    expect(accountsWorked(effort, "r1", "2026-11-01")).toBe(1);
    expect(accountsWorked(effort, "r1", null)).toBe(2);
  });
});
