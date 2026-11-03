import { describe, expect, it } from "vitest";
import { draftedQuadrant, quadrantOf } from "@/lib/domain/eisenhower";

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
