// The chain view claims a direction only where the relationship type states
// one. These tests exist mainly to stop a future edit from "helpfully"
// inferring that a referral or an installer sits upstream — that would put a
// name on the wrong side of the channel, which is worse than not saying.

import { describe, expect, it } from "vitest";
import {
  CHAIN_ORDER,
  chainPosition,
  resolvePosition,
} from "@/lib/domain/chain";

describe("chainPosition", () => {
  it("reads SUPPLIES from whichever side this account is on", () => {
    // "A supplies B" — we are A, so B is who we sell to.
    expect(chainPosition("SUPPLIES", true)).toBe("downstream");
    // we are B, so A is who supplies us.
    expect(chainPosition("SUPPLIES", false)).toBe("upstream");
  });

  it("reads PURCHASES_FROM as the mirror of SUPPLIES", () => {
    expect(chainPosition("PURCHASES_FROM", true)).toBe("upstream");
    expect(chainPosition("PURCHASES_FROM", false)).toBe("downstream");
  });

  it("refuses to invent a direction for types that do not state one", () => {
    for (const t of [
      "WORKS_WITH",
      "REFERRED_BY",
      "REFERRED_TO",
      "SPECIFIES_THROUGH",
      "SUPPORTS",
      "PREFERRED_PARTNER",
      "INSTALLER_FOR",
      "ARCHITECT_FOR",
      "DEVELOPER_FOR",
    ]) {
      expect(chainPosition(t, true), t).toBe("alongside");
      expect(chainPosition(t, false), t).toBe("alongside");
    }
  });

  it("treats an unknown future type as alongside rather than guessing", () => {
    expect(chainPosition("SOME_NEW_LINK", true)).toBe("alongside");
  });
});

describe("resolvePosition", () => {
  it("lets a stated direction win over an unstated one", () => {
    // A dealer we supply who also works with us is still downstream.
    expect(resolvePosition(["alongside", "downstream"])).toBe("downstream");
  });

  it("keeps alongside when nothing states a direction", () => {
    expect(resolvePosition(["alongside", "alongside"])).toBe("alongside");
    expect(resolvePosition([])).toBe("alongside");
  });

  it("falls back to alongside when the directions contradict", () => {
    // Both buys from us and supplies us: real in this trade, and not a thing
    // to resolve by picking whichever row was stored first.
    expect(resolvePosition(["upstream", "downstream"])).toBe("alongside");
  });

  it("agrees with itself when several rows say the same thing", () => {
    expect(resolvePosition(["upstream", "upstream"])).toBe("upstream");
  });
});

describe("CHAIN_ORDER", () => {
  it("reads down the channel: supply, us, demand", () => {
    expect(CHAIN_ORDER).toEqual(["upstream", "alongside", "downstream"]);
  });
});
