import { describe, expect, it } from "vitest";
import { viaLabel } from "@/lib/domain/via";

describe("viaLabel", () => {
  it("says nothing for app-made items", () => {
    expect(viaLabel(null)).toBeNull();
    expect(viaLabel(undefined)).toBeNull();
  });
  it("names the agent", () => {
    expect(viaLabel("claude")).toBe("via Claude");
    expect(viaLabel("muse")).toBe("via Muse");
  });
});
