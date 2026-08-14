import { describe, expect, it } from "vitest";
import {
  ACTIVE_QUOTE_STAGES,
  isActiveQuote,
  isOverdue,
  quoteStageLabel,
  sortQuotes,
  totalValue,
  type QuoteLike,
} from "../quotes";

const q = (over: Partial<QuoteLike> = {}): QuoteLike => ({
  stage: "QUOTE",
  expected_close_date: null,
  estimated_revenue: null,
  ...over,
});

describe("isActiveQuote", () => {
  it("counts the two stages where a price is out", () => {
    expect(ACTIVE_QUOTE_STAGES).toEqual(["QUOTE", "DECISION"]);
    expect(isActiveQuote("QUOTE")).toBe(true);
    expect(isActiveQuote("DECISION")).toBe(true);
  });

  it("excludes stages with no price out and answers already given", () => {
    for (const s of ["IDENTIFIED", "QUALIFIED", "DEVELOPMENT"]) {
      expect(isActiveQuote(s)).toBe(false);
    }
    for (const s of ["WON", "LOST", "ON_HOLD"]) {
      expect(isActiveQuote(s)).toBe(false);
    }
  });
});

describe("quoteStageLabel", () => {
  it("speaks the rep's words, never the enum", () => {
    expect(quoteStageLabel("QUOTE")).toBe("Out for quote");
    expect(quoteStageLabel("DECISION")).toBe("Deciding");
  });

  it("falls back rather than printing a raw stage", () => {
    expect(quoteStageLabel("DEVELOPMENT")).toBe("Open");
  });
});

describe("isOverdue", () => {
  it("is true only once the close date is behind us", () => {
    expect(isOverdue(q({ expected_close_date: "2026-08-13" }), "2026-08-14")).toBe(true);
    expect(isOverdue(q({ expected_close_date: "2026-08-14" }), "2026-08-14")).toBe(false);
    expect(isOverdue(q({ expected_close_date: "2026-08-15" }), "2026-08-14")).toBe(false);
  });

  it("never calls an undated quote overdue", () => {
    expect(isOverdue(q(), "2026-08-14")).toBe(false);
  });
});

describe("sortQuotes", () => {
  it("puts overdue first, longest-overdue at the top", () => {
    const rows = [
      q({ expected_close_date: "2026-08-20" }),
      q({ expected_close_date: "2026-08-01" }),
      q({ expected_close_date: "2026-08-10" }),
    ];
    expect(sortQuotes(rows, "2026-08-14").map((r) => r.expected_close_date)).toEqual([
      "2026-08-01",
      "2026-08-10",
      "2026-08-20",
    ]);
  });

  it("sinks undated quotes below every dated one", () => {
    const rows = [
      q({ estimated_revenue: 900_000 }),
      q({ expected_close_date: "2026-09-30" }),
    ];
    expect(sortQuotes(rows, "2026-08-14")[0].expected_close_date).toBe("2026-09-30");
  });

  it("breaks a tie on value, so the bigger call comes first", () => {
    const rows = [
      q({ expected_close_date: "2026-08-20", estimated_revenue: 1_000 }),
      q({ expected_close_date: "2026-08-20", estimated_revenue: 180_000 }),
    ];
    expect(sortQuotes(rows, "2026-08-14")[0].estimated_revenue).toBe(180_000);
  });

  it("does not mutate the input", () => {
    const rows = [
      q({ expected_close_date: "2026-08-20" }),
      q({ expected_close_date: "2026-08-01" }),
    ];
    sortQuotes(rows, "2026-08-14");
    expect(rows[0].expected_close_date).toBe("2026-08-20");
  });
});

describe("totalValue", () => {
  it("adds what is priced and ignores what is not", () => {
    expect(
      totalValue([q({ estimated_revenue: 180_000 }), q(), q({ estimated_revenue: 20_000 })]),
    ).toBe(200_000);
  });

  it("is zero for an empty list", () => {
    expect(totalValue([])).toBe(0);
  });
});
