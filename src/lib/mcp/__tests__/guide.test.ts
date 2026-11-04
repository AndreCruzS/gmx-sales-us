import { describe, expect, it } from "vitest";
import { MATRIX_RULES } from "@/lib/domain/eisenhower";
import { PLATFORM_GUIDE, SERVER_INSTRUCTIONS } from "../guide";

describe("agent guide", () => {
  it("carries the matrix rules verbatim", () => {
    expect(PLATFORM_GUIDE).toContain(MATRIX_RULES);
  });
  it("states the default alert days", () => {
    for (const s of ["Do now 1", "Plan 7", "Delegate 2"]) expect(PLATFORM_GUIDE).toContain(s);
  });
  it("covers call/meeting fields, phase 2 and naming", () => {
    expect(PLATFORM_GUIDE).toContain("not available through the agent yet — use the app");
    expect(PLATFORM_GUIDE).toContain("time, a time zone and a duration");
    expect(PLATFORM_GUIDE).toContain("<Company> <City>");
  });
  it("stays short", () => {
    expect(PLATFORM_GUIDE.split(/\s+/).length).toBeLessThan(1500);
  });
  it("server instructions point at the guide and the correction prompt", () => {
    expect(SERVER_INSTRUCTIONS).toContain("platform_guide");
    expect(SERVER_INSTRUCTIONS).toContain("Anything to correct?");
  });
});
