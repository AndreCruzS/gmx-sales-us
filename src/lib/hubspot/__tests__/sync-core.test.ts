// Outbound planning rules, proven with fixtures before any HubSpot call exists.

import { describe, expect, it } from "vitest";
import type { HsRecord } from "../port";
import type { LocalLink, OutboundCandidate, Snapshot } from "../sync-core";
import { planInbound, planOutbound } from "../sync-core";

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

// Inbound planning rules — stage-authoritative LWW conflicts, merge/unlinked
// routing, echo suppression.

function hsRecord(over: Partial<HsRecord>): HsRecord {
  return {
    id: "hs-1",
    props: { name: "Ganahl" },
    lastModifiedAt: "1754384400000", // 2025-08-05T09:00:00.000Z
    ...over,
  };
}

function localLink(over: Partial<LocalLink>): LocalLink {
  return {
    entityId: "e-1",
    updatedAt: "2025-08-05T09:00:00.000Z",
    props: { name: "Ganahl" },
    ...over,
  };
}

describe("planInbound", () => {
  it("rule 1: record's props equal the snapshot's → echo", () => {
    const records = [hsRecord({ id: "hs-1", props: { name: "Ganahl" } })];
    const links = new Map([["hs-1", localLink({ props: { name: "Ganahl" } })]]);
    const snapshots = new Map([["e-1", snapshot({ props: { name: "Ganahl" } })]]);

    const plan = planInbound(records, links, snapshots, { stagePropName: null });

    expect(plan).toEqual([{ kind: "echo", hubspotId: "hs-1" }]);
  });

  it("rule 2: HS changed vs snapshot, local unchanged → apply with only the changed props; stageChanged true when dealstage is among them", () => {
    const records = [
      hsRecord({
        id: "hs-1",
        props: { dealstage: "closed_won", amount: "1000" },
      }),
    ];
    const links = new Map([
      ["hs-1", localLink({ props: { dealstage: "qualified", amount: "1000" } })],
    ]);
    const snapshots = new Map([
      ["e-1", snapshot({ props: { dealstage: "qualified", amount: "1000" } })],
    ]);

    const plan = planInbound(records, links, snapshots, { stagePropName: "dealstage" });

    expect(plan).toEqual([
      {
        kind: "apply",
        entityId: "e-1",
        patch: { dealstage: "closed_won" },
        stageChanged: true,
      },
    ]);
  });

  it("rule 3: true conflict, HS newer → apply with patch diffed against the local link's current props", () => {
    const records = [
      hsRecord({
        id: "hs-1",
        props: { name: "Ganahl Lumber", city: "Anaheim" },
        lastModifiedAt: "1754388000000", // 2025-08-05T10:00:00.000Z — later
      }),
    ];
    const links = new Map([
      [
        "hs-1",
        localLink({
          props: { name: "Ganahl", city: "Placentia" }, // local changed city
          updatedAt: "2025-08-05T09:00:00.000Z", // earlier
        }),
      ],
    ]);
    const snapshots = new Map([
      ["e-1", snapshot({ props: { name: "Ganahl", city: "Anaheim" } })],
    ]);

    const plan = planInbound(records, links, snapshots, { stagePropName: null });

    expect(plan).toEqual([
      {
        kind: "apply",
        entityId: "e-1",
        patch: { name: "Ganahl Lumber", city: "Anaheim" },
        stageChanged: false,
      },
    ]);
  });

  it("rule 4: no links entry → unlinked", () => {
    const records = [hsRecord({ id: "hs-9", props: { name: "New Co" } })];
    const links = new Map<string, LocalLink>();
    const snapshots = new Map<string, Snapshot>();

    const plan = planInbound(records, links, snapshots, { stagePropName: null });

    expect(plan).toEqual([{ kind: "unlinked", hubspotId: "hs-9" }]);
  });

  it("rule 5: record with a link but no snapshot (backfill-adopted) → treat local as unchanged, apply the diff vs the local link", () => {
    const records = [
      hsRecord({ id: "hs-1", props: { name: "Ganahl Lumber", city: "Anaheim" } }),
    ];
    const links = new Map([
      ["hs-1", localLink({ props: { name: "Ganahl", city: "Anaheim" } })],
    ]);
    const snapshots = new Map<string, Snapshot>(); // no entry for e-1

    const plan = planInbound(records, links, snapshots, { stagePropName: null });

    expect(plan).toEqual([
      {
        kind: "apply",
        entityId: "e-1",
        patch: { name: "Ganahl Lumber" },
        stageChanged: false,
      },
    ]);
  });

  it("stage-only conflict: local newer, only the stage differs → local-wins with stagePatch (HubSpot stays stage-authoritative)", () => {
    const records = [
      hsRecord({
        id: "hs-1",
        props: { dealstage: "closed_won", amount: "1000" },
        lastModifiedAt: "1754384400000", // 2025-08-05T09:00:00.000Z — earlier
      }),
    ];
    const links = new Map([
      [
        "hs-1",
        localLink({
          props: { dealstage: "qualified", amount: "2000" }, // local changed amount
          updatedAt: "2025-08-05T10:00:00.000Z", // later
        }),
      ],
    ]);
    const snapshots = new Map([
      ["e-1", snapshot({ props: { dealstage: "qualified", amount: "1000" } })],
    ]);

    const plan = planInbound(records, links, snapshots, { stagePropName: "dealstage" });

    expect(plan).toEqual([
      {
        kind: "local-wins",
        entityId: "e-1",
        stagePatch: { dealstage: "closed_won" },
      },
    ]);
  });

  it("dropped-key case: baseline has a key HubSpot no longer returns, nothing else differs → echo, not an empty-props apply", () => {
    const records = [hsRecord({ id: "hs-1", props: { name: "Ganahl" } })]; // owner dropped
    const links = new Map([
      ["hs-1", localLink({ props: { name: "Ganahl", owner: "rep-1" } })], // unchanged vs snapshot
    ]);
    const snapshots = new Map([
      ["e-1", snapshot({ props: { name: "Ganahl", owner: "rep-1" } })],
    ]);

    const plan = planInbound(records, links, snapshots, { stagePropName: null });

    expect(plan).toEqual([{ kind: "echo", hubspotId: "hs-1" }]);
  });

  it("converged-value case: true conflict, HS newer, but HubSpot's newer value equals what local already has → echo, not an empty-props apply", () => {
    const records = [
      hsRecord({
        id: "hs-1",
        props: { name: "Ganahl Lumber", city: "Anaheim" }, // HS changed name...
        lastModifiedAt: "1754388000000", // 2025-08-05T10:00:00.000Z — later
      }),
    ];
    const links = new Map([
      [
        "hs-1",
        localLink({
          props: { name: "Ganahl Lumber", city: "Anaheim" }, // ...to the same value local already has
          updatedAt: "2025-08-05T09:00:00.000Z", // earlier
        }),
      ],
    ]);
    const snapshots = new Map([
      ["e-1", snapshot({ props: { name: "Ganahl", city: "Anaheim" } })],
    ]);

    const plan = planInbound(records, links, snapshots, { stagePropName: null });

    expect(plan).toEqual([{ kind: "echo", hubspotId: "hs-1" }]);
  });
});
