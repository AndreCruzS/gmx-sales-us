import { describe, expect, it } from "vitest";
import {
  backFrom,
  buildStep,
  compositionRail,
  entityAt,
  focusAccount,
  housesMissing,
  isUnmatched,
  latestPeriods,
  movement,
  movementLabel,
  moveDir,
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
  // Corona takes decking off Boise and cladding off Hardwoods, so a band can be
  // asked which product actually moved.
  row({
    dealer_id: "corona",
    dealer_name: "Ganahl Corona",
    product: "Thermo-Ash Decking",
    quantity: 6100,
  }),
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

describe("what a band row needs to be readable", () => {
  it("names the products, so a band is a business and not just a number", () => {
    const step = buildStep(JULY, JUNE, "rep", [], BRANCHES);
    const boise = step.groups[0].bands[0];
    // Deon's Boise volume is decking AND cladding; the leaf rows below carry one
    // each, which is where naming the product actually decides a conversation.
    expect(boise.products).toEqual(["Thermo-Ash Decking", "Thermo-Ayous"]);

    const leaf = buildStep(
      JULY,
      JUNE,
      "rep",
      [
        { dim: "rep", key: "deon", name: "Deon Rep" },
        { dim: "distributor", key: "boise", name: "Boise Cascade" },
        { dim: "branch", key: "riverside", name: "Riverside" },
      ],
      BRANCHES,
    ).groups[0];
    expect(leaf.bands.find((b) => b.name === "Ganahl Corona")!.products).toEqual([
      "Thermo-Ash Decking",
    ]);
  });

  it("keeps value null rather than zero when the file carried no price", () => {
    // Some houses share price and some do not. Zero would read as "given away".
    const unpriced = buildStep([row({ value: null })], [], "dealer", [], BRANCHES);
    expect(unpriced.groups[0].value).toBeNull();
    expect(unpriced.groups[0].bands[0].value).toBeNull();

    const priced = buildStep([row({ value: 3000 })], [], "dealer", [], BRANCHES);
    expect(priced.groups[0].value).toBe(3000);
  });

  it("adds up the priced part when only some rows carry a price", () => {
    const mixed = buildStep(
      [row({ value: 3000 }), row({ dealer_id: "corona", dealer_name: "Ganahl Corona", value: null })],
      [],
      "distribution",
      [
        { dim: "distributor", key: "boise", name: "Boise Cascade" },
        { dim: "branch", key: "riverside", name: "Riverside" },
      ],
      BRANCHES,
    );
    expect(mixed.groups[0].value).toBe(3000);
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

describe("the summary row", () => {
  it("is the whole step as one row, aggregated across all of them", () => {
    const step = buildStep(JULY, JUNE, "rep", [], BRANCHES);
    const summary = step.summary!;
    expect(summary.title).toBe("All reps");
    expect(summary.sub).toBe("2 reps");
    expect(summary.total).toBe(step.total);
    expect(summary.total).toBe(20300);
    // Banded by the ROWS, not by the next link down. Under the Rep lens that
    // makes the total answer "who is carrying this month" — the question a
    // manager opens the screen with — rather than repeating the house split the
    // rows below already give twice over.
    expect(step.bandDim).toBe("distributor");
    expect(summary.bands.map((b) => [b.name, b.qty])).toEqual([
      ["Deon Rep", 18100],
      ["TJ Rep", 2200],
    ]);
    // And the shares are what a comparison is read off.
    expect(Math.round(summary.bands[0].share)).toBe(89);
  });

  it("bands the houses under Distribution and the dealers under Dealer", () => {
    expect(
      buildStep(JULY, JUNE, "distribution", [], BRANCHES).summary!.bands.map((b) => b.name),
    ).toEqual(["Boise Cascade", "Hardwoods Specialty"]);
    expect(
      buildStep(JULY, JUNE, "dealer", [], BRANCHES).summary!.bands[0].name,
    ).toBe("Ganahl Anaheim");
  });

  it("agrees with the row it stands for, to the linear foot", () => {
    const step = buildStep(JULY, JUNE, "rep", [], BRANCHES);
    const deonRow = step.groups.find((g) => g.title === "Deon Rep")!;
    const deonBand = step.summary!.bands.find((b) => b.name === "Deon Rep")!;
    expect(deonBand.qty).toBe(deonRow.total);
    expect(deonBand.prevQty).toBe(deonRow.prevTotal);
    expect(step.summary!.prevTotal).toBe(14100);
  });

  it("has no doors: every band already has a row of its own below it", () => {
    // Two ways into the same place that behaved differently would be worse than
    // one. They select and open their own detail.
    const summary = buildStep(JULY, JUNE, "rep", [], BRANCHES).summary!;
    expect(summary.bands.every((b) => b.drillable)).toBe(false);
  });

  it("is absent when there is only one row, because that row is already the total", () => {
    const deep = buildStep(
      JULY,
      JUNE,
      "rep",
      [
        { dim: "rep", key: "deon", name: "Deon Rep" },
        { dim: "distributor", key: "boise", name: "Boise Cascade" },
      ],
      BRANCHES,
    );
    expect(deep.groups).toHaveLength(1);
    expect(deep.summary).toBeNull();
  });

  it("does not add two networks' coverage together and call it one figure", () => {
    const summary = buildStep(JULY, JUNE, "distribution", [], BRANCHES).summary!;
    expect(summary.coverage).toBeNull();
  });
});

describe("compositionRail", () => {
  it("stacks the whole step, aggregated across every row", () => {
    // Boise appears on both Deon's row and TJ's; the counter answers for both,
    // so its rail has to as well.
    const rail = compositionRail(buildStep(JULY, JUNE, "rep", [], BRANCHES).groups);
    expect(rail).toMatch(/^linear-gradient\(to bottom, /);
    // Boise 18,500 of 20,300 — the first stop runs from 0 to ~91%.
    expect(rail).toContain("var(--cat-1) 0.00% 91.13%");
    expect(rail).toContain("91.13% 100.00%");
  });

  it("is one flat colour when there is only one thing in it", () => {
    // No gradient for a single band: a four-pixel stripe of one colour with a
    // hard stop at 100% is the same picture with more CSS.
    const one = compositionRail(
      buildStep([row({})], [], "rep", [], BRANCHES).groups,
    );
    expect(one).toBe("var(--cat-1)");
  });

  it("falls back to grey rather than dividing by zero", () => {
    expect(compositionRail([])).toBe("var(--cat-rest)");
  });
});

describe("backFrom", () => {
  const deon: PathStep = { dim: "rep", key: "deon", name: "Deon Rep" };
  const boise: PathStep = { dim: "distributor", key: "boise", name: "Boise Cascade" };
  const riverside: PathStep = { dim: "branch", key: "riverside", name: "Riverside" };

  it("has nowhere to go from the top", () => {
    expect(backFrom([])).toBeNull();
  });

  it("drops BOTH links of the first tap, because it recorded two", () => {
    // Going back to [Deon Rep] alone would land on a step nobody was ever
    // shown: one rep, banded by nothing.
    expect(backFrom([deon, boise])).toEqual([]);
  });

  it("drops one link at a time after that", () => {
    expect(backFrom([deon, boise, riverside])).toEqual([deon, boise]);
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

describe("housesMissing", () => {
  // The day Boise's August lands, the screen moves to August — and Hardwoods,
  // whose newest file is July, drops out of every total on the page.
  const AUG = "2026-08-01";
  const mixed = [
    ...JULY,
    row({ period: AUG, quantity: 11200 }),
  ];

  it("names the house whose file has not arrived", () => {
    expect(housesMissing(mixed, AUG)).toEqual(["Hardwoods Specialty"]);
  });

  it("says nothing when everybody reported the month being shown", () => {
    expect(housesMissing(JULY, JUL)).toEqual([]);
  });

  it("does not accuse a house that has never reported at all", () => {
    // Silence from a distributor we have no history with is not a late file.
    expect(housesMissing([row({ period: AUG })], AUG)).toEqual([]);
  });

  it("has nothing to say with no month to say it about", () => {
    expect(housesMissing(mixed, null)).toEqual([]);
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

  it("gives a direction only where there is one to give", () => {
    expect(moveDir(110, 100, JUN)).toBe("up");
    expect(moveDir(90, 100, JUN)).toBe("down");
    expect(moveDir(100, 100, JUN)).toBe("level");
    // Coming from nothing has no direction, so nothing gets coloured. A dealer
    // that appeared this month is not "up", it is new.
    expect(moveDir(500, 0, JUN)).toBe("none");
    expect(moveDir(500, 400, null)).toBe("none");
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

describe("a row's own colour", () => {
  it("is the colour it wears in the total bar above it", () => {
    // The bug this locks down: the total bar split into colours, and the rows
    // underneath it named the same things in black. Matching a segment to a row
    // meant counting segments left to right and rows top to bottom.
    const step = buildStep(JULY, JUNE, "rep", []);
    expect(step.summary).not.toBeNull();

    for (const g of step.groups) {
      const band = step.summary!.bands.find((b) => b.key === g.key);
      expect(band).toBeDefined();
      expect(g.colour).toBe(band!.colour);
    }
    // And they are actually different colours, or none of this says anything.
    expect(new Set(step.groups.map((g) => g.colour)).size).toBe(step.groups.length);
  });

  it("holds under every lens, not just the one it was noticed on", () => {
    for (const lens of ["rep", "distribution", "dealer"] as const) {
      const step = buildStep(JULY, JUNE, lens, []);
      if (!step.summary) continue;
      for (const g of step.groups) {
        expect(g.colour).toBe(step.summary.bands.find((b) => b.key === g.key)!.colour);
      }
    }
  });

  it("pairs by key, so a tie cannot swap two people's colours", () => {
    // Two reps with exactly equal volume. Paired by position this passes or
    // fails on sort stability; paired by key it simply holds.
    const tied = [
      row({ rep_id: "deon", rep_name: "Deon Rep", quantity: 5000 }),
      row({ rep_id: "tj", rep_name: "TJ Rep", dealer_id: "buffalo", quantity: 5000 }),
    ];
    const step = buildStep(tied, [], "rep", []);
    for (const g of step.groups) {
      expect(g.colour).toBe(step.summary!.bands.find((b) => b.key === g.key)!.colour);
    }
  });

  it("keeps the colour of the band that was tapped, one level in", () => {
    // The band slides across, fills the bar, and becomes the row at the top of
    // the next step. It should still be recognisably the same thing.
    const top = buildStep(JULY, JUNE, "rep", []);
    const deon = top.groups.find((g) => g.key === "deon")!;
    const boise = deon.bands.find((b) => b.key === "boise")!;

    const inside = buildStep(JULY, JUNE, "rep", [
      { key: "deon", dim: "rep", name: "Deon Rep", colour: deon.colour! },
      { key: "boise", dim: "distributor", name: "Boise Cascade", colour: boise.colour },
    ] as PathStep[]);
    expect(inside.groups).toHaveLength(1);
    expect(inside.groups[0].colour).toBe(boise.colour);
  });

  it("is null when there is no bar to be consistent with", () => {
    // One rep, so no total bar is drawn. A colour there would be decoration.
    const step = buildStep([row({ quantity: 1000 })], [], "rep", []);
    expect(step.summary).toBeNull();
    expect(step.groups[0].colour).toBeNull();
  });
});

describe("one colour per company, for the whole step", () => {
  it("gives the same band the same colour on every row it appears on", () => {
    // The bug: colour was rank-within-a-row, so the biggest band on every line
    // was teal — and teal meant Boise on one row and Russin on the next.
    const step = buildStep(JULY, JUNE, "dealer", []);
    const byKey = new Map<string, Set<string>>();
    for (const g of step.groups) {
      for (const b of g.bands) {
        const seen = byKey.get(b.key) ?? new Set<string>();
        seen.add(b.colour);
        byKey.set(b.key, seen);
      }
    }
    expect(byKey.size).toBeGreaterThan(1);
    for (const [key, colours] of byKey) {
      expect(colours, `${key} wears more than one colour`).toHaveLength(1);
    }
  });

  it("gives two different companies two different colours, alone on their rows", () => {
    // Every dealer here buys from exactly one house, so every bar is solid. The
    // question is whether a solid bar still says WHICH house.
    const single = [
      row({ dealer_id: "a", dealer_name: "Buys Boise", quantity: 900 }),
      row({
        dealer_id: "b",
        dealer_name: "Buys Hardwoods",
        distributor_id: "hardwoods",
        distributor_name: "Hardwoods Specialty",
        branch_id: "perris",
        quantity: 800,
      }),
    ];
    const step = buildStep(single, [], "dealer", []);
    expect(step.groups.every((g) => g.bands.length === 1)).toBe(true);
    const colours = step.groups.map((g) => g.bands[0].colour);
    expect(colours[0]).not.toBe(colours[1]);
  });

  it("ranks by the whole step, not by the row it happens to be on", () => {
    // Hardwoods is the bigger house overall, but on this one row it is the
    // smaller band. Rank-within-row would make it teal here; identity keeps it
    // the colour it has everywhere else.
    const rows = [
      row({ dealer_id: "x", quantity: 100 }),
      row({
        dealer_id: "x",
        distributor_id: "hardwoods",
        distributor_name: "Hardwoods Specialty",
        branch_id: "perris",
        quantity: 90,
      }),
      row({
        dealer_id: "y",
        distributor_id: "hardwoods",
        distributor_name: "Hardwoods Specialty",
        branch_id: "perris",
        quantity: 5000,
      }),
    ];
    const step = buildStep(rows, [], "dealer", []);
    const x = step.groups.find((g) => g.key === "x")!;
    const boise = x.bands.find((b) => b.key === "boise")!;
    const hardwoods = x.bands.find((b) => b.key === "hardwoods")!;
    // Boise leads this row on volume...
    expect(boise.qty).toBeGreaterThan(hardwoods.qty);
    // ...and still does not get the first colour, because Hardwoods is bigger
    // across the step.
    const y = step.groups.find((g) => g.key === "y")!;
    expect(hardwoods.colour).toBe(y.bands[0].colour);
    expect(boise.colour).not.toBe(hardwoods.colour);
  });

  it("gathers exactly the bands it greys out, and never strands one", () => {
    // Nine dealers off one branch, so the bands are dealers: six keep a colour
    // and the remaining three become one grey segment.
    const many = Array.from({ length: 9 }, (_, i) =>
      row({ dealer_id: `d${i}`, dealer_name: `Dealer ${i}`, quantity: 1000 - i * 10 }),
    );
    const step = buildStep(many, [], "distribution", [
      { key: "boise", dim: "distributor", name: "Boise Cascade", colour: "x" },
      { key: "riverside", dim: "branch", name: "Riverside", colour: "y" },
    ] as PathStep[]);
    const g = step.groups[0];
    const greys = g.bands.filter((b) => b.colour === "var(--cat-rest)");
    const rest = g.segments.find((s) => s.key === "rest");
    expect(greys).toHaveLength(3);
    expect(rest?.count).toBe(3);
    // No band is drawn as its own grey stripe beside the gathered one.
    expect(g.segments.filter((s) => s.colour === "var(--cat-rest)")).toHaveLength(1);
    // And the gathered segment is worth exactly what it gathered.
    expect(rest?.qty).toBe(greys.reduce((n, b) => n + b.qty, 0));
    // Every band still has a row of its own, gathered or not.
    expect(g.bands).toHaveLength(9);
  });
});
