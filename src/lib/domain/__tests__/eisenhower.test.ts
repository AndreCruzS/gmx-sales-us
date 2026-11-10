import { describe, expect, it } from "vitest";
import { MATRIX_RULES, draftedQuadrant, quadrantOf, suggestDeadline } from "@/lib/domain/eisenhower";

describe("the Eisenhower matrix (Bianca, 2026-11-03)", () => {
  it("puts each pair of answers in its quadrant", () => {
    expect(quadrantOf(true, true)).toBe("DO_NOW");
    expect(quadrantOf(false, true)).toBe("PLAN");
    expect(quadrantOf(true, false)).toBe("DELEGATE");
    expect(quadrantOf(false, false)).toBe("ELIMINATE");
  });
  it("never eliminates what the dealer asked for: it is urgent, so Delegate at least", () => {
    expect(draftedQuadrant(false, false, true)).toBe("DELEGATE");
    expect(draftedQuadrant(false, true, true)).toBe("DO_NOW");
    expect(draftedQuadrant(false, false, false)).toBe("ELIMINATE");
    expect(draftedQuadrant(null, false, true)).toBeNull();
  });
  it("gives no priority while either answer is unknown", () => {
    expect(quadrantOf(null, true)).toBeNull();
    expect(quadrantOf(true, undefined)).toBeNull();
    expect(quadrantOf(null, null)).toBeNull();
  });
});

describe("suggestDeadline", () => {
  const fallback = "2026-11-17";
  const today = "2026-11-10";
  it("caps an urgent item with no date at two business days", () => {
    expect(suggestDeadline({ urgent: true, said_date: null }, fallback, today)).toBe("2026-11-12");
  });
  it("keeps a said date that is already inside the cap", () => {
    expect(suggestDeadline({ urgent: true, said_date: "2026-11-11" }, fallback, today)).toBe("2026-11-11");
  });
  it("uses a said date as said when not urgent, else the fallback", () => {
    expect(suggestDeadline({ urgent: false, said_date: "2026-11-20" }, fallback, today)).toBe("2026-11-20");
    expect(suggestDeadline({ urgent: false, said_date: null }, fallback, today)).toBe(fallback);
  });
});

describe("MATRIX_RULES", () => {
  it("carries the reason shape with real characters", () => {
    expect(MATRIX_RULES).toContain("Important: … · Due: …");
    expect(MATRIX_RULES).not.toContain("\uFFFD");
  });
});
