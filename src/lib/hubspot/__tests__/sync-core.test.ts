// Outbound planning rules, proven with fixtures before any HubSpot call exists.

import { describe, expect, it } from "vitest";
import type { OutboundCandidate, Snapshot } from "../sync-core";
import { planOutbound } from "../sync-core";

function candidate(over: Partial<OutboundCandidate>): OutboundCandidate {
  return {
    entityType: "account",
    entityId: "e-1",
    hubspotId: null,
    updatedAt: "2026-08-05T10:00:00Z",
    props: { name: "Ganahl" },
    ...over,
  };
}

function snapshot(over: Partial<Snapshot>): Snapshot {
  return {
    entityId: "e-1",
    hubspotId: "hs-1",
    props: { name: "Ganahl" },
    ...over,
  };
}

describe("planOutbound", () => {
  it("no hubspotId → creates", () => {
    const cand = candidate({ hubspotId: null });
    const plan = planOutbound([cand], new Map());
    expect(plan.creates).toEqual([cand]);
    expect(plan.patches).toHaveLength(0);
    expect(plan.echoes).toHaveLength(0);
  });

  it("hubspotId with props deep-equal to the snapshot → echo (skip, no patch)", () => {
    const cand = candidate({ hubspotId: "hs-1", props: { name: "Ganahl" } });
    const snapshots = new Map([["e-1", snapshot({ props: { name: "Ganahl" } })]]);
    const plan = planOutbound([cand], snapshots);
    expect(plan.echoes).toEqual(["e-1"]);
    expect(plan.creates).toHaveLength(0);
    expect(plan.patches).toHaveLength(0);
  });

  it("hubspotId with props differing from the snapshot → patch with only changed props", () => {
    const cand = candidate({
      hubspotId: "hs-1",
      props: { name: "Ganahl Lumber", city: "Anaheim" },
    });
    const snapshots = new Map([
      ["e-1", snapshot({ props: { name: "Ganahl", city: "Anaheim" } })],
    ]);
    const plan = planOutbound([cand], snapshots);
    expect(plan.patches).toEqual([
      { entityId: "e-1", hubspotId: "hs-1", props: { name: "Ganahl Lumber" } },
    ]);
    expect(plan.echoes).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
  });

  it("hubspotId but no snapshot (backfill-adopted record) → full-props patch", () => {
    const cand = candidate({
      hubspotId: "hs-1",
      props: { name: "Ganahl", city: "Anaheim" },
    });
    const plan = planOutbound([cand], new Map());
    expect(plan.patches).toEqual([
      { entityId: "e-1", hubspotId: "hs-1", props: { name: "Ganahl", city: "Anaheim" } },
    ]);
  });

  it("empty candidate list → empty plan", () => {
    const plan = planOutbound([], new Map());
    expect(plan).toEqual({ creates: [], patches: [], echoes: [] });
  });

  it("a key present only in the snapshot (e.g. owner dropped from the map) with no other diff → echo, not an empty-props patch", () => {
    const cand = candidate({ hubspotId: "hs-1", props: { name: "Ganahl" } });
    const snapshots = new Map([
      ["e-1", snapshot({ props: { name: "Ganahl", city: "Anaheim" } })],
    ]);
    const plan = planOutbound([cand], snapshots);
    expect(plan.echoes).toEqual(["e-1"]);
    expect(plan.patches).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
  });

  it("a candidate differing in exactly one prop patches only that prop", () => {
    const cand = candidate({
      hubspotId: "hs-1",
      props: { name: "Ganahl", city: "Anaheim", phone: "555-1111" },
    });
    const snapshots = new Map([
      [
        "e-1",
        snapshot({ props: { name: "Ganahl", city: "Anaheim", phone: "555-2222" } }),
      ],
    ]);
    const plan = planOutbound([cand], snapshots);
    expect(plan.patches).toEqual([
      { entityId: "e-1", hubspotId: "hs-1", props: { phone: "555-1111" } },
    ]);
  });
});
