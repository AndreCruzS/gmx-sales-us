import { describe, expect, it } from "vitest";
import { MATRIX_RULES, suggestDeadline } from "@/lib/domain/eisenhower";

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
