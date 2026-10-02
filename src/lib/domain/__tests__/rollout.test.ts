import { describe, expect, it } from "vitest";
import {
  countGates,
  displayRoster,
  gatesCleared,
  latestMaterialEvidence,
  materialRoster,
  pkRoster,
  type GateRow,
} from "../rollout";

function row(p: Partial<GateRow> & { account_id: string; name: string }): GateRow {
  return {
    org_id: "org",
    owner_id: "deon",
    pk_state: "NO",
    merchandiser_state: "NO",
    display_wall_state: "NO",
    material_state: "NO",
    pk_count: 0,
    ...p,
  };
}

describe("gatesCleared", () => {
  it("counts the three on screen and ignores the merchandiser", () => {
    // The merchandiser left the screen on 2026-08-28 and stayed in the data.
    // Counting it would report a branch as further along than it is.
    const b = row({
      account_id: "a",
      name: "A",
      pk_state: "OK",
      material_state: "OK",
      display_wall_state: "OK",
      merchandiser_state: "NO",
    });
    expect(gatesCleared(b)).toBe(3);
    expect(
      gatesCleared(row({ account_id: "b", name: "B", merchandiser_state: "OK" })),
    ).toBe(0);
  });

  it("reads PENDING as not cleared", () => {
    expect(
      gatesCleared(row({ account_id: "a", name: "A", display_wall_state: "PENDING" })),
    ).toBe(0);
  });
});

describe("countGates", () => {
  it("is null with no dealers rather than a book of zeros", () => {
    expect(countGates([])).toBeNull();
  });

  it("counts each gate against the same total, not as a funnel", () => {
    // A wall standing where nobody ever held the class — the very gap the
    // book exists to show. A funnel would hide it.
    const rows = [
      row({ account_id: "a", name: "A", pk_state: "OK", pk_count: 2 }),
      row({ account_id: "b", name: "B", display_wall_state: "OK" }),
      row({
        account_id: "c",
        name: "C",
        pk_state: "OK",
        pk_count: 1,
        material_state: "OK",
        display_wall_state: "OK",
      }),
    ];
    const c = countGates(rows)!;
    expect(c.branches).toBe(3);
    expect(c.pk_done).toBe(2);
    expect(c.display_wall_done).toBe(2);
    expect(c.material_done).toBe(1);
    expect(c.fully_through).toBe(1);
    expect(c.not_started).toBe(0); // B has its wall
  });

  it("keeps the amber: PENDING is counted apart, never as done", () => {
    const c = countGates([
      row({ account_id: "a", name: "A", display_wall_state: "PENDING" }),
      row({ account_id: "b", name: "B", material_state: "PENDING" }),
    ])!;
    expect(c.display_wall_done).toBe(0);
    expect(c.display_wall_pending).toBe(1);
    expect(c.material_pending).toBe(1);
    expect(c.not_started).toBe(2);
  });

  it("totals the classes taught, which can exceed the dealers taught", () => {
    const c = countGates([
      row({ account_id: "a", name: "A", pk_state: "OK", pk_count: 3 }),
      row({ account_id: "b", name: "B", pk_state: "OK", pk_count: 1 }),
    ])!;
    expect(c.pk_done).toBe(2);
    expect(c.pk_total).toBe(4);
  });
});

describe("the rosters behind the gates", () => {
  it("sorts the PK unfold by name, so the list is findable", () => {
    const out = pkRoster([
      row({ account_id: "b", name: "Zimmer Lumber", pk_count: 1 }),
      row({ account_id: "a", name: "Anawalt West Hollywood", pk_count: 0 }),
    ]);
    expect(out.map((r) => r.name)).toEqual([
      "Anawalt West Hollywood",
      "Zimmer Lumber",
    ]);
  });

  it("cites the LATEST month of proof, not every month on file", () => {
    const ev = latestMaterialEvidence([
      { account_id: "a", period: "2026-07", lf: 19_558 },
      { account_id: "a", period: "2026-08", lf: 4_200 },
      { account_id: "a", period: "2026-06", lf: 90_000 },
    ]);
    expect(ev.get("a")).toEqual({ period: "2026-08", lf: 4200 });
  });

  it("the proof never ticks the box — a sale last month is not stock today", () => {
    const ev = latestMaterialEvidence([
      { account_id: "a", period: "2026-08", lf: 4_200 },
    ]);
    const [m] = materialRoster([row({ account_id: "a", name: "A" })], ev);
    expect(m.on).toBe(false);
    expect(m.pending).toBe(false);
    expect(m.evidence).toEqual({ period: "2026-08", lf: 4200 });
  });

  it("a wall up but unverified is pending, and its date is the citation", () => {
    const walls = new Map([
      ["a", { display_last_verified_at: "2026-08-12T00:00:00Z" }],
      ["b", { display_last_verified_at: null }],
    ]);
    const out = displayRoster(
      [
        row({ account_id: "a", name: "A", display_wall_state: "OK" }),
        row({ account_id: "b", name: "B", display_wall_state: "PENDING" }),
      ],
      walls,
    );
    expect(out[0]).toMatchObject({ on: true, pending: false });
    expect(out[0].verifiedAt).toBe("2026-08-12T00:00:00Z");
    expect(out[1]).toMatchObject({ on: false, pending: true, verifiedAt: null });
  });
});
