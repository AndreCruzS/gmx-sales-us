import { describe, expect, it } from "vitest";
import {
  countGates,
  pkDone,
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
      pk_count: 1,
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

  // THE BOOK AND ITS OWN LIST OF NAMES (Andre, 2026-10-02: "make them agree").
  // The headline read pk_state, the unfold read pk_count, and one row carrying
  // OK with a count of zero made the gate claim a class no name could show.
  it("takes the COUNT as the fact, so a bare OK is not a class", () => {
    const stray = row({ account_id: "a", name: "A", pk_state: "OK", pk_count: 0 });
    expect(pkDone(stray)).toBe(false);
    expect(gatesCleared(stray)).toBe(0);
  });

  it("counts a class that was taught whatever the state says", () => {
    const b = row({ account_id: "a", name: "A", pk_state: "NO", pk_count: 2 });
    expect(pkDone(b)).toBe(true);
    expect(gatesCleared(b)).toBe(1);
  });

  it("the headline can never exceed the names behind it", () => {
    // The exact shape that broke: the database held one bare OK among twenty
    // real ones and the gate read 21 of 136 over a list of 20.
    const rows = [
      row({ account_id: "a", name: "A", pk_state: "OK", pk_count: 1 }),
      row({ account_id: "b", name: "B", pk_state: "OK", pk_count: 0 }),
      row({ account_id: "c", name: "C", pk_count: 0 }),
    ];
    const headline = countGates(rows)!.pk_done;
    const named = pkRoster(rows).filter((a) => a.pk_count > 0).length;
    expect(headline).toBe(named);
    expect(headline).toBe(1);
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

  it("a class already taught is not also a class coming", () => {
    // A row left reading PENDING after the class happened would otherwise be
    // counted twice — once in the bar, once in the amber beside it.
    const c = countGates([
      row({ account_id: "a", name: "A", pk_state: "PENDING", pk_count: 1 }),
      row({ account_id: "b", name: "B", pk_state: "PENDING", pk_count: 0 }),
    ])!;
    expect(c.pk_done).toBe(1);
    expect(c.pk_pending).toBe(1);
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
