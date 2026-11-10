import { describe, expect, it } from "vitest";
import { MATRIX_RULES, suggestDeadline, suggestFallback } from "@/lib/domain/eisenhower";

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

describe("suggestFallback: an old PK is not offered a date long past", () => {
  const today = "2026-11-10";
  it("uses the item's own deadline when it has one", () => {
    // An October PK whose deadline was moved to Nov 20: not Oct 9.
    expect(suggestFallback("2026-11-20", null, "2026-10-02")).toBe("2026-11-20");
    expect(suggestDeadline({ urgent: false, said_date: null }, suggestFallback("2026-11-20", null, "2026-10-02"), today))
      .toBe("2026-11-20");
    expect(suggestDeadline({ urgent: true, said_date: null }, suggestFallback("2026-11-20", null, "2026-10-02"), today))
      .toBe("2026-11-12");
  });
  it("falls back to the PK date + 5 business days only without one", () => {
    expect(suggestFallback(undefined, null, "2026-10-02")).toBe("2026-10-09");
    expect(suggestFallback(null, null, "2026-11-10")).toBe("2026-11-17");
  });
});

describe("MATRIX_RULES", () => {
  it("carries the reason shape with real characters", () => {
    expect(MATRIX_RULES).toContain("Important: … · Due: …");
    expect(MATRIX_RULES).not.toContain("\uFFFD");
  });
});
