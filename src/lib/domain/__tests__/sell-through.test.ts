import { describe, expect, it } from "vitest";
import {
  buildStep,
  entityAt,
  focusAccount,
  isUnmatched,
  latestPeriods,
  movement,
  movementLabel,
  periodLabel,
  rowMatchesPath,
  scopeVolume,
  shortBranchName,
  SELL_CHAIN,
  type BranchRef,
  type PathStep,
  type SellThroughRow,
} from "../sell-through";

// A small stand-in for the real book: two houses, three branches, four dealers,
// two reps, two months — enough for every walk to have somewhere to go.
const JUL = "2026-07-01";
const JUN = "2026-06-01";

function row(o: Partial<SellThroughRow>): SellThroughRow {
  return {
    period: JUL,
    rep_id: "deon",
    rep_name: "Deon Rep",
    distributor_id: "boise",
    distributor_name: "Boise Cascade",
    branch_id: "riverside",
    branch_name: "Boise Cascade - Riverside",
    branch_city: "Riverside",
    branch_state: "CA",
    dealer_id: "anaheim",
    dealer_name: "Ganahl Anaheim",
    dealer_label: "GANAHL LUMBER - ANAHEIM #4471",
    product: "Thermo-Ayous",
    quantity: 1000,
    unit: "LF",
    value: null,
    ...o,
  };
}

const BRANCHES: BranchRef[] = [
  { id: "riverside", distributor_id: "boise", name: "Riverside", city: "Riverside", state: "CA" },
  { id: "modesto", distributor_id: "boise", name: "Modesto", city: "Modesto", state: "CA" },
  { id: "phoenix", distributor_id: "boise", name: "Phoenix", city: "Phoenix", state: "AZ" },
  { id: "perris", distributor_id: "hardwoods", name: "Perris", city: "Perris", state: "CA" },
];

// July: Deon sells through two Boise branches and one Hardwoods branch; TJ has
// his own dealer. Ganahl Corona buys from both houses — the case that would
// double if the chain were read wrongly.
const JULY: SellThroughRow[] = [
  row({ quantity: 9800 }),
  row({ dealer_id: "corona", dealer_name: "Ganahl Corona", quantity: 6100 }),
  row({
    branch_id: "modesto",
    branch_name: "Boise Cascade - Modesto",
    branch_city: "Modesto",
    dealer_id: "costamesa",
    dealer_name: "Ganahl Costa Mesa",
    quantity: 400,
  }),
  row({
    distributor_id: "hardwoods",
    distributor_name: "Hardwoods Specialty",
    branch_id: "perris",
    branch_name: "Hardwoods - Perris",
    branch_city: "Perris",
    dealer_id: "corona",
    dealer_name: "Ganahl Corona",
    quantity: 1800,
  }),
  row({
    rep_id: "tj",
    rep_name: "TJ Rep",
    branch_id: "phoenix",
    branch_name: "Boise Cascade - Phoenix",
    branch_city: "Phoenix",
    branch_state: "AZ",
    dealer_id: "buffalo",
    dealer_name: "Buffalo Lumber Co",
    quantity: 2200,
  }),
];

const JUNE: SellThroughRow[] = [
  row({ period: JUN, quantity: 8000 }),
  row({ period: JUN, dealer_id: "corona", dealer_name: "Ganahl Corona", quantity: 6100 }),
];

describe("entityAt", () => {
  it("reads each link of the chain off one row", () => {
    const r = row({});
    expect(entityAt(r, "rep").name).toBe("Deon Rep");
    expect(entityAt(r, "distributor").name).toBe("Boise Cascade");
    // The house is already the row above it, so the branch says the place only.
    expect(entityAt(r, "branch").name).toBe("Riverside");
    expect(entityAt(r, "branch").sub).toBe("CA");
    expect(entityAt(r, "dealer").name).toBe("Ganahl Anaheim");
  });

  it("marks a distributor and a dealer as accounts and a branch as not one", () => {
    const r = row({});
    expect(entityAt(r, "distributor").accountId).toBe("boise");
    expect(entityAt(r, "dealer").accountId).toBe("anaheim");
    // A branch is a location in someone else's network — there is nothing of
    // ours to open, and the rest of the page must not try.
    expect(entityAt(r, "branch").accountId).toBeNull();
  });

  it("keeps an unmatched dealer as its own name rather than dropping it", () => {
    const e = entityAt(
      row({ dealer_id: null, dealer_name: null, dealer_label: "ORCO BLOCK & HARDSCAPE - STANTON" }),
      "dealer",
    );
    expect(isUnmatched(e)).toBe(true);
    expect(e.accountId).toBeNull();
    expect(e.name).toBe("Orco Block & Hardscape - Stanton");
    expect(e.sub).toBe("not matched to an account yet");
  });

  it("gives an unmatched row an owner nobody has to answer for", () => {
    const e = entityAt(row({ rep_id: null, rep_name: null }), "rep");
    expect(e.name).toBe("Nobody yet");
    expect(e.key).toBe("unowned");
  });
});

describe("shortBranchName", () => {
  it("drops the house the branch is already sitting under", () => {
    expect(shortBranchName("Boise Cascade - Riverside", "Boise Cascade")).toBe("Riverside");
    expect(shortBranchName("Hardwoods - Perris", "Hardwoods")).toBe("Perris");
  });

  it("copes with a house that spells its own name two ways", () => {
    // The branch list says "Hardwoods"; the account is "Hardwoods Specialty".
    // A distributor's file rarely agrees with itself, let alone with us.
    expect(shortBranchName("Hardwoods - Los Angeles", "Hardwoods Specialty")).toBe(
      "Los Angeles",
    );
    expect(shortBranchName("Boise Cascade Inc - Modesto", "Boise Cascade")).toBe("Modesto");
  });

  it("keeps a place name that happens to contain a dash", () => {
    expect(shortBranchName("Winston-Salem", "Boise Cascade")).toBe("Winston-Salem");
  });

  it("leaves a name that does not start with the house alone", () => {
    expect(shortBranchName("Inland Empire Yard", "Boise Cascade")).toBe("Inland Empire Yard");
  });

  it("would rather repeat the house than leave nothing", () => {
    expect(shortBranchName("Boise Cascade", "Boise Cascade")).toBe("Boise Cascade");
  });
});

describe("rowMatchesPath", () => {
  const path: PathStep[] = [
    { dim: "rep", key: "deon", name: "Deon Rep" },
    { dim: "distributor", key: "boise", name: "Boise Cascade" },
  ];

  it("keeps a row that agrees with every link chosen", () => {
    expect(rowMatchesPath(row({}), path)).toBe(true);
  });

  it("drops a row that disagrees with any of them", () => {
    expect(rowMatchesPath(row({ rep_id: "tj" }), path)).toBe(false);
    expect(rowMatchesPath(row({ distributor_id: "hardwoods" }), path)).toBe(false);
  });
});

describe("buildStep · the rep lens", () => {
  it("opens on reps, banded by the houses they sell through", () => {
    const step = buildStep(JULY, JUNE, "rep", [], BRANCHES);
    expect(step.rowDim).toBe("rep");
    expect(step.bandDim).toBe("distributor");
    expect(step.groups.map((g) => g.title)).toEqual(["Deon Rep", "TJ Rep"]);

    const deon = step.groups[0];
    expect(deon.total).toBe(18100);
    expect(deon.bands.map((b) => [b.name, b.qty])).toEqual([
      ["Boise Cascade", 16300],
      ["Hardwoods Specialty", 1800],
    ]);
    // Shares are of the row's own bar, so two rows of different size still read.
    expect(Math.round(deon.bands[0].share)).toBe(90);
  });

  it("carries the month before, so a figure can be read as moving", () => {
    const deon = buildStep(JULY, JUNE, "rep", [], BRANCHES).groups[0];
    expect(deon.prevTotal).toBe(14100);
    expect(deon.bands[0].prevQty).toBe(14100);
    // Hardwoods sold nothing in June: new, not "up infinitely".
    expect(deon.bands[1].prevQty).toBe(0);
    expect(movementLabel(deon.bands[1].qty, deon.bands[1].prevQty, JUN)).toBe("new this month");
  });

  it("walks rep → distributor → branch, and names the quiet branches", () => {
    const path: PathStep[] = [
      { dim: "rep", key: "deon", name: "Deon Rep" },
      { dim: "distributor", key: "boise", name: "Boise Cascade" },
    ];
    const step = buildStep(JULY, JUNE, "rep", path, BRANCHES);
    expect(step.rowDim).toBe("distributor");
    expect(step.bandDim).toBe("branch");
    expect(step.groups).toHaveLength(1);

    const boise = step.groups[0];
    expect(boise.title).toBe("Boise Cascade");
    expect(boise.bands.map((b) => b.name)).toEqual(["Riverside", "Modesto"]);
    // Phoenix sold TJ's dealer, not Deon's, so it is quiet in this patch — and
    // Modesto only just registers. The gaps are the point of the map.
    expect(boise.coverage).toEqual({ buying: 2, total: 3, quiet: ["Phoenix"] });
  });

  it("walks on to the dealers under that branch, and stops there", () => {
    const path: PathStep[] = [
      { dim: "rep", key: "deon", name: "Deon Rep" },
      { dim: "distributor", key: "boise", name: "Boise Cascade" },
      { dim: "branch", key: "riverside", name: "Riverside" },
    ];
    const step = buildStep(JULY, JUNE, "rep", path, BRANCHES);
    expect(step.rowDim).toBe("branch");
    expect(step.bandDim).toBe("dealer");
    expect(step.groups[0].bands.map((b) => [b.name, b.qty])).toEqual([
      ["Ganahl Anaheim", 9800],
      ["Ganahl Corona", 6100],
    ]);
    // The chain ends at the dealer: a dealer opens its own detail rather than
    // another bar.
    expect(step.groups[0].bands.every((b) => b.drillable)).toBe(false);
  });
});

describe("buildStep · the distribution lens", () => {
  it("shows every house with no rep filter, banded by branch", () => {
    const step = buildStep(JULY, JUNE, "distribution", [], BRANCHES);
    expect(step.rowDim).toBe("distributor");
    expect(step.bandDim).toBe("branch");
    // Phoenix is TJ's; under this lens it belongs to Boise all the same.
    const boise = step.groups.find((g) => g.title === "Boise Cascade")!;
    expect(boise.total).toBe(18500);
    expect(boise.coverage).toEqual({ buying: 3, total: 3, quiet: [] });
    expect(step.total).toBe(20300);
  });

  it("reaches the dealers in one more step", () => {
    const step = buildStep(
      JULY,
      JUNE,
      "distribution",
      [
        { dim: "distributor", key: "boise", name: "Boise Cascade" },
        { dim: "branch", key: "riverside", name: "Riverside" },
      ],
      BRANCHES,
    );
    expect(step.rowDim).toBe("branch");
    expect(step.bandDim).toBe("dealer");
    expect(step.groups[0].total).toBe(15900);
  });
});

describe("buildStep · the dealer lens", () => {
  it("opens on dealers, banded by whoever supplies them", () => {
    const step = buildStep(JULY, JUNE, "dealer", [], BRANCHES);
    expect(step.rowDim).toBe("dealer");
    expect(step.bandDim).toBe("distributor");

    // The dual-supply case: Corona's two houses are two bands of one bar, and
    // the bar is the dealer's whole intake.
    const corona = step.groups.find((g) => g.title === "Ganahl Corona")!;
    expect(corona.total).toBe(7900);
    expect(corona.bands.map((b) => [b.name, b.qty])).toEqual([
      ["Boise Cascade", 6100],
      ["Hardwoods Specialty", 1800],
    ]);
  });

  it("does not filter by rep — a dealer is a dealer whoever owns it", () => {
    const names = buildStep(JULY, JUNE, "dealer", [], BRANCHES).groups.map((g) => g.title);
    expect(names).toContain("Buffalo Lumber Co");
  });
});

describe("buildStep · the tail", () => {
  const many = Array.from({ length: 9 }, (_, i) =>
    row({ dealer_id: `d${i}`, dealer_name: `Dealer ${i}`, quantity: 900 - i * 100 }),
  );

  it("gathers the tail on the track but names every band in the legend", () => {
    const step = buildStep(
      many,
      [],
      "distribution",
      [
        { dim: "distributor", key: "boise", name: "Boise Cascade" },
        { dim: "branch", key: "riverside", name: "Riverside" },
      ],
      BRANCHES,
    );
    const g = step.groups[0];
    // Nine dealers: six colours, then one grey band standing for the rest…
    expect(g.segments).toHaveLength(7);
    expect(g.segments[6]).toMatchObject({ key: "rest", name: "3 more", count: 3 });
    // …while the legend still lists all nine, so none of them is unreachable.
    expect(g.bands).toHaveLength(9);
    expect(g.segments.reduce((n, s) => n + s.qty, 0)).toBe(g.total);
  });

  it("does not gather a tail that fits", () => {
    const step = buildStep(
      many.slice(0, 7),
      [],
      "distribution",
      [
        { dim: "distributor", key: "boise", name: "Boise Cascade" },
        { dim: "branch", key: "riverside", name: "Riverside" },
      ],
      BRANCHES,
    );
    expect(step.groups[0].segments).toHaveLength(7);
    expect(step.groups[0].segments.every((s) => s.band !== null)).toBe(true);
  });
});

describe("unmatched volume", () => {
  const withUnmatched = [
    ...JULY,
    row({
      rep_id: null,
      rep_name: null,
      dealer_id: null,
      dealer_name: null,
      dealer_label: "ORCO BLOCK & HARDSCAPE - STANTON",
      quantity: 2400,
    }),
  ];

  it("is shown rather than dropped, and is not a door to walk through", () => {
    const step = buildStep(
      withUnmatched,
      [],
      "distribution",
      [
        { dim: "distributor", key: "boise", name: "Boise Cascade" },
        { dim: "branch", key: "riverside", name: "Riverside" },
      ],
      BRANCHES,
    );
    const orco = step.groups[0].bands.find((b) => b.name.startsWith("Orco"))!;
    expect(orco.qty).toBe(2400);
    expect(orco.drillable).toBe(false);
  });
});

describe("scopeVolume", () => {
  // Boise sold 18,500 LF in July, but only 16,300 of it through Deon's dealers.
  // The figures at the top of the page have to be the second number when the
  // walk is Deon's, or the tile contradicts the bar underneath it.
  const boiseAlone: PathStep[] = [
    { dim: "distributor", key: "boise", name: "Boise Cascade", accountId: "boise", kind: "DISTRIBUTOR" },
  ];
  const boiseUnderDeon: PathStep[] = [
    { dim: "rep", key: "deon", name: "Deon Rep", accountId: null, kind: null },
    ...boiseAlone,
  ];

  it("measures the walk, not the account", () => {
    expect(scopeVolume(JULY, boiseAlone)).toBe(18500);
    expect(scopeVolume(JULY, boiseUnderDeon)).toBe(16300);
  });

  it("is the whole book when nothing has been chosen", () => {
    expect(scopeVolume(JULY, [])).toBe(20300);
  });
});

describe("focusAccount", () => {
  const deon: PathStep = { dim: "rep", key: "deon", name: "Deon Rep", accountId: null, kind: null };
  const boise: PathStep = {
    dim: "distributor",
    key: "boise",
    name: "Boise Cascade",
    accountId: "boise",
    kind: "DISTRIBUTOR",
  };
  const riverside: PathStep = {
    dim: "branch",
    key: "riverside",
    name: "Riverside",
    accountId: null,
    kind: null,
  };
  const corona: PathStep = {
    dim: "dealer",
    key: "corona",
    name: "Ganahl Corona",
    accountId: "corona",
    kind: "DEALER",
  };

  it("names the deepest link but keys on the deepest account", () => {
    // Standing on a branch: the crumbs say Riverside, so the bar says Riverside —
    // but a branch is not ours, so the rollout and the year answer for Boise.
    const f = focusAccount([deon, boise, riverside], null)!;
    expect(f.name).toBe("Riverside");
    expect(f.dim).toBe("branch");
    expect(f.accountId).toBe("boise");
    expect(f.accountName).toBe("Boise Cascade");
  });

  it("prefers a dealer over a distributor — one door beats a network", () => {
    // The dealer lens walks Corona → Boise, so the house is the deeper link. The
    // page should still answer for Corona.
    const f = focusAccount([corona, boise], null)!;
    expect(f.accountId).toBe("corona");
    expect(f.name).toBe("Boise Cascade");
  });

  it("has nothing to answer for when the walk holds no account of ours", () => {
    expect(focusAccount([deon], null)).toBeNull();
    expect(focusAccount([], null)).toBeNull();
  });
});

describe("periods", () => {
  it("takes the two newest months present, not this month and last", () => {
    // A distributor that skips a month must not make the comparison read
    // against nothing.
    const rows = [row({ period: JUL }), row({ period: "2026-04-01" })];
    expect(latestPeriods(rows)).toEqual({ latest: JUL, previous: "2026-04-01" });
  });

  it("copes with a single month, and with none", () => {
    expect(latestPeriods([row({})])).toEqual({ latest: JUL, previous: null });
    expect(latestPeriods([])).toEqual({ latest: null, previous: null });
  });

  it("labels a first-of-month without slipping a month westward", () => {
    expect(periodLabel(JUL)).toBe("July 2026");
    expect(periodLabel("2026-01-01")).toBe("January 2026");
    expect(periodLabel(null)).toBe("no month yet");
  });
});

describe("movement", () => {
  it("says nothing when there is nothing honest to say", () => {
    expect(movement(500, 0)).toBeNull();
    expect(movementLabel(500, 0, null)).toBeNull();
    expect(movementLabel(0, 0, JUN)).toBeNull();
  });

  it("reads coming from nothing as new, not as a percentage", () => {
    expect(movementLabel(500, 0, JUN)).toBe("new this month");
  });

  it("names the month it is comparing against", () => {
    expect(movementLabel(110, 100, JUN)).toBe("up 10% on Jun");
    expect(movementLabel(90, 100, JUN)).toBe("down 10% on Jun");
    expect(movementLabel(100, 100, JUN)).toBe("level with Jun");
  });
});

describe("SELL_CHAIN", () => {
  it("is the same walk down the chain from three different ends", () => {
    expect(SELL_CHAIN.rep).toEqual(["rep", "distributor", "branch", "dealer"]);
    expect(SELL_CHAIN.distribution).toEqual(["distributor", "branch", "dealer"]);
    expect(SELL_CHAIN.dealer).toEqual(["dealer", "distributor", "branch"]);
  });
});
