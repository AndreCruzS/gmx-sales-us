import { describe, expect, it } from "vitest";
import { MATRIX_RULES } from "@/lib/domain/eisenhower";
import { PLATFORM_GUIDE, SERVER_INSTRUCTIONS } from "../guide";

describe("agent guide", () => {
  it("carries the matrix rules verbatim", () => {
    expect(PLATFORM_GUIDE).toContain(MATRIX_RULES);
  });
  it("states the urgent cap, the defaults and that the receipt shows the deadline", () => {
    expect(PLATFORM_GUIDE).toContain("FOLLOW-UPS: IMPORTANCE AND DEADLINES");
    expect(PLATFORM_GUIDE).toContain("no more than 2 business days away");
    expect(PLATFORM_GUIDE).toContain("caps the deadline at 2 business days from today");
    expect(PLATFORM_GUIDE).toContain("quote follow-up 2, sample follow-up 3, display check 10, a PK follow-up 5 from the PK date, anything else 5");
    expect(PLATFORM_GUIDE).toContain("Show the deadline in the receipt");
    expect(PLATFORM_GUIDE).not.toContain("HOW TO PRIORITISE");
  });
  it("covers call/meeting fields, phase 2 and naming", () => {
    expect(PLATFORM_GUIDE).toContain("not available through the agent yet — use the app");
    expect(PLATFORM_GUIDE).toContain("time, a time zone and a duration");
    expect(PLATFORM_GUIDE).toContain("<Company> <City>");
  });
  it("turns promises into follow-ups, names yards, and fixes lead source up front (Bianca, 2026-11-05)", () => {
    expect(PLATFORM_GUIDE).toContain("becomes a follow-up");
    expect(PLATFORM_GUIDE).toContain("Dykes Lumber Brooklyn");
    expect(PLATFORM_GUIDE).toContain("cannot be changed after the account is created");
    expect(PLATFORM_GUIDE).toContain("link");
  });
  it("stays short", () => {
    expect(PLATFORM_GUIDE.split(/\s+/).length).toBeLessThan(1500);
  });
  it("server instructions point at the guide and the correction prompt", () => {
    expect(SERVER_INSTRUCTIONS).toContain("platform_guide");
    expect(SERVER_INSTRUCTIONS).toContain("Anything to correct?");
  });
});
