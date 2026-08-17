import { describe, expect, it } from "vitest";
import {
  buildImport,
  EMPTY_MAPPING,
  guessMapping,
  mappingProblem,
  matchDealer,
  normaliseName,
  parseNumber,
  parseSheet,
  periodOf,
  type KnownBranch,
  type KnownDealer,
  type Mapping,
} from "../sell-through-import";

const BRANCHES: KnownBranch[] = [
  { id: "riv", name: "Boise Cascade - Riverside", external_code: "BC-RIV" },
  { id: "mod", name: "Boise Cascade - Modesto", external_code: "BC-MOD" },
];
const DEALERS: KnownDealer[] = [
  { id: "anaheim", name: "Ganahl Anaheim" },
  { id: "corona", name: "Ganahl Corona" },
];

function mapping(over: Partial<Mapping>): Mapping {
  return { ...EMPTY_MAPPING, ...over };
}

describe("parseSheet", () => {
  it("takes what a spreadsheet actually puts on the clipboard", () => {
    const sheet = parseSheet(
      "Branch\tCustomer\tQty\nRiverside\tGANAHL ANAHEIM\t9,800\nModesto\tGANAHL CORONA\t400\n",
    );
    expect(sheet.headers).toEqual(["Branch", "Customer", "Qty"]);
    expect(sheet.rows).toEqual([
      ["Riverside", "GANAHL ANAHEIM", "9,800"],
      ["Modesto", "GANAHL CORONA", "400"],
    ]);
  });

  it("falls back to commas, and keeps a comma inside quotes", () => {
    const sheet = parseSheet('Branch,Customer\nRiverside,"GANAHL LUMBER, ANAHEIM"');
    expect(sheet.rows[0]).toEqual(["Riverside", "GANAHL LUMBER, ANAHEIM"]);
  });

  it("does not sniff the delimiter per line", () => {
    // One tab anywhere means the whole paste is tab-separated. Deciding line by
    // line would tear a file whose dealer names contain commas.
    const sheet = parseSheet("Branch\tCustomer\nRiverside\tSMITH, JONES & CO");
    expect(sheet.rows[0]).toEqual(["Riverside", "SMITH, JONES & CO"]);
  });

  it("pads a short row rather than rejecting the file", () => {
    // The clipboard drops trailing empty columns; that is not a broken file.
    const sheet = parseSheet("Branch\tCustomer\tValue\nRiverside\tGANAHL ANAHEIM");
    expect(sheet.rows[0]).toEqual(["Riverside", "GANAHL ANAHEIM", ""]);
  });

  it("survives blank lines and CRLF", () => {
    const sheet = parseSheet("A\tB\r\n\r\n1\t2\r\n");
    expect(sheet.rows).toEqual([["1", "2"]]);
  });

  it("has nothing to say about nothing", () => {
    expect(parseSheet("   ")).toEqual({ headers: [], rows: [] });
  });
});

describe("guessMapping", () => {
  it("reads the headers a distributor is likely to send", () => {
    const g = guessMapping(["Ship From Branch", "Sold To", "Item", "Qty Shipped", "Net Sales"]);
    expect(g.branch).toBe(0);
    expect(g.dealer).toBe(1);
    expect(g.product).toBe(2);
    expect(g.quantity).toBe(3);
    expect(g.value).toBe(4);
  });

  it("does not let a broad hint eat a narrow one", () => {
    // "Branch Code" must not be claimed by "branch", and each column is used
    // once — otherwise quantity and value fight over "Sales Qty".
    const g = guessMapping(["Branch Code", "Branch Name", "Customer", "Sales Qty"]);
    expect(g.branch_code).toBe(0);
    expect(g.branch).toBe(1);
    expect(g.quantity).toBe(3);
  });

  it("leaves what it cannot see alone", () => {
    const g = guessMapping(["Col1", "Col2"]);
    expect(g).toEqual(EMPTY_MAPPING);
  });
});

describe("normaliseName", () => {
  it("matches two people typing the same yard", () => {
    expect(normaliseName("GANAHL LUMBER - ANAHEIM #4471")).toBe("ganahl lumber anaheim");
    expect(normaliseName("Ganahl Lumber (Anaheim)")).toBe("ganahl lumber anaheim");
  });

  it("drops the words a trade name carries for legal reasons", () => {
    expect(normaliseName("Buffalo Lumber Co.")).toBe("buffalo lumber");
    expect(normaliseName("BUFFALO LUMBER, INC")).toBe("buffalo lumber");
  });
});

describe("parseNumber", () => {
  it("reads what a spreadsheet cell looks like", () => {
    expect(parseNumber("9,800")).toBe(9800);
    expect(parseNumber("$1,234.50")).toBe(1234.5);
    expect(parseNumber(" 400 ")).toBe(400);
  });

  it("reads accounting brackets as negative, because a credit note is real", () => {
    expect(parseNumber("(500)")).toBe(-500);
    expect(parseNumber("-500")).toBe(-500);
  });

  it("says nothing rather than zero when there is no number", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("n/a")).toBeNull();
  });
});

describe("buildImport", () => {
  const sheet = parseSheet(
    [
      "Branch\tCode\tCustomer\tItem\tQty\tValue",
      "Riverside\tBC-RIV\tGANAHL LUMBER - ANAHEIM #4471\tThermo-Ayous\t9,800\t30,870",
      "Riverside\tBC-RIV\tGANAHL LUMBER - CORONA\tThermo-Ash Decking\t6,100\t20,740",
      "Riverside\tBC-RIV\tORCO BLOCK & HARDSCAPE\tThermo-Ayous\t2,400\t7,560",
      "Fresno\tBC-FRE\tGANAHL LUMBER - ANAHEIM #4471\tThermo-Ayous\t1,000\t3,150",
      "\t\t\t\t\t",
      "TOTAL\t\t\t\t19,300\t62,320",
    ].join("\n"),
  );
  const map = mapping({ branch: 0, branch_code: 1, dealer: 2, product: 3, quantity: 4, value: 5 });
  const plan = buildImport(sheet, map, { branches: BRANCHES, dealers: DEALERS });

  it("matches the branch on its code, and the dealer through the noise", () => {
    expect(plan.rows[0].branchId).toBe("riv");
    expect(plan.rows[0].dealerId).toBe("anaheim");
    expect(plan.rows[1].dealerId).toBe("corona");
    expect(plan.rows[0].product).toBe("Thermo-Ayous");
  });

  it("keeps a dealer it cannot place, with the file's own spelling", () => {
    const orco = plan.rows[2];
    expect(orco.dealerId).toBeNull();
    expect(orco.dealerLabel).toBe("ORCO BLOCK & HARDSCAPE");
    expect(plan.unmatched).toEqual([{ label: "ORCO BLOCK & HARDSCAPE", quantity: 2400 }]);
  });

  it("surfaces a branch it has never heard of instead of inventing one", () => {
    // sell_through.branch_id is not null, so this row has nowhere to go until
    // somebody says the yard exists. Guessing would put a branch on the coverage
    // map that does not.
    expect(plan.newBranches).toEqual([{ name: "Fresno", code: "BC-FRE" }]);
    expect(plan.rows[3].branchId).toBeNull();
    expect(plan.rows[3].newBranchName).toBe("Fresno");
  });

  it("throws away the lines that were never data", () => {
    // The TOTAL row: a quantity with no customer against it. The blank spacer
    // never even reaches here — parseSheet drops empty lines — which is why this
    // is 1 and not 2.
    expect(plan.skipped).toBe(1);
    expect(plan.rows).toHaveLength(4);
  });

  it("adds up what would be written, so the month can be checked before it lands", () => {
    expect(plan.quantity).toBe(19300);
    expect(plan.value).toBe(62320);
    expect(plan.matchedRows).toBe(3);
  });

  it("leaves value null when the house does not share price", () => {
    const priceless = buildImport(
      parseSheet("Branch\tCustomer\tQty\nRiverside\tGANAHL ANAHEIM\t500"),
      mapping({ branch: 0, dealer: 1, quantity: 2 }),
      { branches: BRANCHES, dealers: DEALERS },
    );
    expect(priceless.value).toBeNull();
    expect(priceless.rows[0].value).toBeNull();
  });
});

describe("matchDealer", () => {
  const index = [
    { id: "anaheim", norm: "ganahl anaheim", tokens: ["ganahl", "anaheim"] },
    { id: "corona", norm: "ganahl corona", tokens: ["ganahl", "corona"] },
    { id: "banner", norm: "ganahl lumber", tokens: ["ganahl", "lumber"] },
  ];

  it("sees our yard inside the distributor's banner-plus-yard", () => {
    expect(matchDealer("GANAHL LUMBER - ANAHEIM #4471", index)).toBe("anaheim");
    expect(matchDealer("HARDWOODS/GANAHL CORONA", index)).toBe("corona");
  });

  it("prefers the more specific of two that fit", () => {
    // Both "Ganahl Anaheim" and the banner "Ganahl Lumber" fit this label; the
    // yard is the answer, not the banner.
    expect(matchDealer("GANAHL LUMBER ANAHEIM", index)).toBe("anaheim");
  });

  it("leaves a genuine tie unmatched rather than tossing a coin", () => {
    // Two accounts of equal specificity both fit. Guessing would put a yard's
    // volume against the wrong dealer AND the wrong rep.
    const tie = [
      { id: "a", norm: "north yard", tokens: ["north", "yard"] },
      { id: "b", norm: "south yard", tokens: ["south", "yard"] },
    ];
    expect(matchDealer("NORTH SOUTH YARD", tie)).toBeNull();
  });

  it("does not confuse two yards of the same banner", () => {
    expect(matchDealer("GANAHL LUMBER - ESCONDIDO", index)).toBe("banner");
    expect(matchDealer("SOMEBODY ELSE ENTIRELY", index)).toBeNull();
  });

  it("cannot see through an abbreviation, and does not pretend to", () => {
    const bfs = [{ id: "sc", norm: "bfs santa clarita", tokens: ["bfs", "santa", "clarita"] }];
    expect(matchDealer("BUILDERS FIRSTSOURCE SANTA CLARITA", bfs)).toBeNull();
  });
});

describe("mappingProblem", () => {
  it("will not let a month be written on a guess", () => {
    expect(mappingProblem(EMPTY_MAPPING)).toMatch(/quantity/);
    expect(mappingProblem(mapping({ quantity: 1 }))).toMatch(/dealer/);
    expect(mappingProblem(mapping({ quantity: 1, dealer: 2 }))).toMatch(/branch/);
  });

  it("takes the branch code in place of the branch name", () => {
    expect(mappingProblem(mapping({ quantity: 1, dealer: 2, branch_code: 3 }))).toBeNull();
    expect(mappingProblem(mapping({ quantity: 1, dealer: 2, branch: 0 }))).toBeNull();
  });
});

describe("periodOf", () => {
  it("is always the first of the month", () => {
    expect(periodOf(2026, 7)).toBe("2026-07-01");
    expect(periodOf(2026, 12)).toBe("2026-12-01");
  });
});
