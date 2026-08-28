import { describe, expect, it } from "vitest";
import {
  branchState,
  buildImport,
  EMPTY_MAPPING,
  guessMapping,
  inchesPerPiece,
  isSubtotal,
  mappingProblem,
  matchDealer,
  normaliseName,
  parseNumber,
  parseSheet,
  periodOf,
  rowsToSheet,
  toLinearFeet,
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

describe("rowsToSheet · the .xlsx door", () => {
  // A parsed workbook hands back real types where a paste hands back strings.
  // Both doors have to arrive at the same corridor: proven against the client's
  // real Boise file, which came out identical to the paste — 397 lines, 186 sales
  // rows, 142 subtotals, 10,700 of theirs, 83,153 LF.
  it("turns a workbook's own cell types into strings", () => {
    const sheet = rowsToSheet([
      ["Branch", "Item", "Qty", "UOM"],
      ["Riverside Branch", '1X6-94" AYOUS', 14, "PC"],
      ["Dallas Branch", "1X8-RL AYOUS", 600.5, "LF"],
    ]);
    expect(sheet.headers).toEqual(["Branch", "Item", "Qty", "UOM"]);
    expect(sheet.rows[0]).toEqual(["Riverside Branch", '1X6-94" AYOUS', "14", "PC"]);
    // Everything downstream reads strings and decides for itself what a figure
    // is, so a float must survive as written rather than being rounded here.
    expect(sheet.rows[1][2]).toBe("600.5");
  });

  it("reads null as an empty cell, not the word null", () => {
    // A pivot's branch-subtotal line has a null customer, and "null" as a name
    // would sail past every emptiness check downstream.
    const sheet = rowsToSheet([
      ["Branch", "Customer"],
      ["Atlanta Branch", null],
    ]);
    expect(sheet.rows[0]).toEqual(["Atlanta Branch", ""]);
  });

  it("skips blank rows above the header instead of using one as the header", () => {
    // An export very often has a row of nothing on top; taking it as the headers
    // makes every dropdown on the mapping step useless.
    const sheet = rowsToSheet([
      [null, null],
      ["", ""],
      ["Branch", "Qty"],
      ["Riverside Branch", 14],
    ]);
    expect(sheet.headers).toEqual(["Branch", "Qty"]);
    expect(sheet.rows).toEqual([["Riverside Branch", "14"]]);
  });

  it("pads a short row and drops a blank one", () => {
    const sheet = rowsToSheet([
      ["A", "B", "C"],
      ["1"],
      [null, null, null],
    ]);
    expect(sheet.rows).toEqual([["1", "", ""]]);
  });

  it("writes a date as a date, not as a locale sentence", () => {
    const sheet = rowsToSheet([
      ["Period", "Qty"],
      [new Date("2026-07-01T00:00:00Z"), 5],
    ]);
    expect(sheet.rows[0][0]).toBe("2026-07-01");
  });

  it("has nothing to say about an empty workbook", () => {
    expect(rowsToSheet([])).toEqual({ headers: [], rows: [] });
    expect(rowsToSheet([[null, null]])).toEqual({ headers: [], rows: [] });
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

  it("reads a state column instead of taking it for the branch", () => {
    // "Branch State" contains "branch", so without state being claimed first the
    // yard's location is silently read as the yard's name — and a branch with no
    // state never reaches the territory map.
    const g = guessMapping(["Branch", "Branch State", "Customer", "Qty"]);
    expect(g.branch).toBe(0);
    expect(g.state).toBe(1);
  });
});

describe("branchState · what puts a yard in a region", () => {
  it("takes the file's own column, however it was typed", () => {
    expect(branchState(" tx ", "Dallas Branch")).toBe("TX");
  });

  it("reads City, ST off the label when there is no column", () => {
    expect(branchState("", "Salt Lake City, UT")).toBe("UT");
    expect(branchState("", "Boise Cascade - Memphis, tn.")).toBe("TN");
  });

  it("refuses a trailing word that merely looks like a state", () => {
    // This is the whole reason the comma is required. Read loosely, a company
    // suffix becomes Colorado and a compass point becomes Nebraska — and a yard
    // filed in the WRONG region is worse than one filed in none, because the
    // volume lands on a rep who never sold it and nothing on screen says so.
    expect(branchState("", "ABC Lumber Co")).toBeNull();
    expect(branchState("", "Yard 3 NE")).toBeNull();
  });

  it("says nothing rather than guessing when nobody said", () => {
    expect(branchState("", "Fresno")).toBeNull();
    expect(branchState("XX", "Fresno")).toBeNull();
  });
});

describe("normaliseName", () => {
  it("matches two people typing the same yard", () => {
    expect(normaliseName("GANAHL LUMBER - ANAHEIM #4471")).toBe("ganahl lumber anaheim");
    expect(normaliseName("Ganahl Lumber (Anaheim)")).toBe("ganahl lumber anaheim");
  });

  it("drops OUR OWN annotations, not just theirs", () => {
    // The account is "Ganahl Lumber (Banner)" — "(Banner)" is a label we invented
    // to mark a banner-level account. The distributor has never heard of it, so
    // leaving it in meant every Ganahl row in a real file matched nothing.
    expect(normaliseName("Ganahl Lumber (Banner)")).toBe("ganahl lumber");
    expect(normaliseName("Builders FirstSource (Banner)")).toBe("builders firstsource");
  });

  it("keeps a bracket that holds a real place", () => {
    // A distributor writing "(Anaheim)" is putting the YARD in there. Stripping
    // every bracket to fix "(Banner)" would merge nine Ganahl yards into one —
    // only our own labels go.
    expect(normaliseName("Ganahl Lumber (Anaheim) #4471")).toBe("ganahl lumber anaheim");
    expect(normaliseName("Banner Lumber Co")).toBe("banner lumber");
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
    expect(plan.newBranches).toEqual([
      { name: "Fresno", code: "BC-FRE", state: null },
    ]);
    expect(plan.rows[3].branchId).toBeNull();
    expect(plan.rows[3].newBranchName).toBe("Fresno");
  });

  it("carries a new yard's state, from whichever row happened to say it", () => {
    // A monthly file names the same yard hundreds of times and often fills the
    // state on only some of them. Taking the first mention would throw the
    // answer away and leave the branch off the territory map — where its volume
    // is credited to whoever owns the dealer's banner rather than to the region
    // it shipped from.
    const s = parseSheet(
      [
        "Branch\tSt\tCustomer\tQty",
        "Fresno\t\tGANAHL LUMBER - CORONA\t1,000",
        "Fresno\tCA\tGANAHL LUMBER - CORONA\t2,000",
        "Reno, NV\t\tORCO BLOCK\t500",
      ].join("\n"),
    );
    const p = buildImport(s, mapping({ branch: 0, state: 1, dealer: 2, quantity: 3 }), {
      branches: BRANCHES,
      dealers: DEALERS,
    });
    expect(p.newBranches).toEqual([
      { name: "Fresno", code: null, state: "CA" },
      { name: "Reno, NV", code: null, state: "NV" },
    ]);
  });

  it("throws away the lines that were never data", () => {
    // The TOTAL row is caught as a SUBTOTAL, not merely skipped — its branch cell
    // says so, and it carries a real quantity that would otherwise be loaded as a
    // sale. The blank spacer never reaches here at all: parseSheet drops empty
    // lines.
    expect(plan.subtotals).toBe(1);
    expect(plan.skipped).toBe(0);
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

  it("matches a banner account against the banner the file names", () => {
    // The case that was silently returning nothing on the client's real data:
    // 186 rows, 83,153 LF, and not one of them attached to an account.
    const withBanner = [
      { id: "banner", norm: normaliseName("Ganahl Lumber (Banner)"),
        tokens: normaliseName("Ganahl Lumber (Banner)").split(" ") },
    ];
    expect(matchDealer("GANLUGG - GANAHL LUMBER", withBanner)).toBe("banner");
  });

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

describe("isSubtotal · the four-times bug", () => {
  // The first real report is a pivot with its subtotals left in. Each one carries
  // a real quantity in a real column, so loading the file as-is stored the month
  // FOUR TIMES OVER — 42,800 against a true 10,700.
  it("catches the shapes a pivot leaves behind", () => {
    expect(isSubtotal(["Total", "1X6-94\" AYOUS", "Riverside Branch"])).toBe(true);
    expect(isSubtotal(["", "Total", "Atlanta Branch"])).toBe(true);
    expect(isSubtotal(["", "", "Total"])).toBe(true);
    expect(isSubtotal([" grand total ", "", ""])).toBe(true);
  });

  it("matches the whole cell, never a substring", () => {
    // A rule that caught this would lose a real dealer's volume for good.
    expect(isSubtotal(["TOTAL BUILDING SUPPLY", "", "Dallas Branch"])).toBe(false);
    expect(isSubtotal(["Sumner Lumber", "", ""])).toBe(false);
  });
});

describe("inchesPerPiece", () => {
  it("reads the length out of a board's name", () => {
    expect(inchesPerPiece('083002608 1X6-94" THERMOWOOD S4S E4E AYOUS 7/BDL')).toBe(94);
    expect(inchesPerPiece('083002675 1X12-177" THERMOWOOD S4S E4E AYOUS')).toBe(177);
  });

  it("takes the LAST measurement, not the first", () => {
    // One real item reads 1X71"-71": the section carries a quote mark too, and
    // reading the first would take the width for the length.
    expect(inchesPerPiece('083000006 1X71"-71" THERMOWOOD DECK ASH 6/BDL')).toBe(71);
  });

  it("has no length for a random-length item", () => {
    // "RL" boards are sold by the foot precisely because there is no length to
    // multiply by.
    expect(inchesPerPiece('083002620 1X8-RL THERMOWOOD S4S E4E AYOUS')).toBeNull();
  });
});

describe("toLinearFeet", () => {
  const item = '083002608 1X6-94" THERMOWOOD S4S E4E AYOUS 7/BDL';

  it("converts a piece count through the board's length", () => {
    // 14 boards of 94 inches is 109.67 feet, not 14 of anything useful.
    expect(toLinearFeet(14, "PC", item)).toBeCloseTo(109.666, 2);
  });

  it("leaves feet alone, whatever the file calls them", () => {
    expect(toLinearFeet(600, "LF", "1X8-RL AYOUS")).toBe(600);
    expect(toLinearFeet(600, "", "1X8-RL AYOUS")).toBe(600);
  });

  it("says it cannot rather than guessing at nothing", () => {
    // A piece count with no length is an unanswered question, not zero feet.
    expect(toLinearFeet(100, "PC", "1X8-RL AYOUS")).toBeNull();
    expect(toLinearFeet(100, "M", item)).toBeNull();
  });
});

describe("buildImport · a real report's shape", () => {
  // Branch / Item / Customer Name / Qty / LY Qty / UOM, with subtotals in place —
  // the first file a distributor actually sent.
  const sheet = parseSheet(
    [
      "Branch	Item	Customer Name	Qty	LY Qty	UOM",
      'Riverside Branch	083002608 1X6-94" THERMOWOOD S4S E4E AYOUS	GANLUGG - GANAHL LUMBER	14	0	PC',
      'Riverside Branch	083002608 1X6-94" THERMOWOOD S4S E4E AYOUS	Total	14	0	PC',
      'Riverside Branch	083003200 1X6-RL THERMOWOOD CLAD AYOUS	GANLUGG - GANAHL LUMBER	600	0	LF',
      'Riverside Branch	083003200 1X6-RL THERMOWOOD CLAD AYOUS	Total	600	0	LF',
      'Riverside Branch	083000004 1X6-47" THERMOWOOD DECK ASH	HOMDEAT - HOME DEPOT	0	42	PC',
      'Riverside Branch	Total		614	42	PC',
      "Total			614	42	-",
    ].join("\n"),
  );
  const map = guessMapping(sheet.headers);
  const plan = buildImport(sheet, map, {
    branches: [{ id: "riv", name: "Riverside Branch", external_code: null }],
    dealers: [{ id: "ganahl", name: "Ganahl Lumber" }],
  });

  it("guesses this file's own headers", () => {
    expect(map.branch).toBe(0);
    expect(map.product).toBe(1);
    expect(map.dealer).toBe(2);
    expect(map.quantity).toBe(3);
    // "LY Qty" must not be taken by quantity on the strength of the word "qty".
    expect(map.last_year).toBe(4);
    expect(map.unit).toBe(5);
  });

  it("throws away every subtotal, which is the whole ball game", () => {
    expect(plan.subtotals).toBe(4);
    // Two sales rows, plus Home Depot's zero — kept as a row since the YTD
    // work, because "who stopped buying" needs a name and a figure to rank.
    expect(plan.rows).toHaveLength(3);
  });

  it("loads business lost as a zero row, and still counts it", () => {
    expect(plan.lostBusiness).toBe(1);
    const lost = plan.rows.find((r) => r.quantity === 0);
    expect(lost).toBeDefined();
    expect(lost!.dealerLabel).toContain("HOME DEPOT");
    // 42 pieces at 47 inches, in feet — the LY rides the same conversion.
    expect(Math.round(lost!.lastYear ?? 0)).toBe(165);
  });

  it("keeps last year beside this year on the rows that have both", () => {
    // The sales rows in this file say LY 0 — stored as null, not as a figure.
    expect(plan.rows[0].lastYear).toBeNull();
  });

  it("normalises the mixture to linear feet and keeps what it was told", () => {
    // 14 pieces at 94 inches = 109.67 LF, plus 600 LF that needed no conversion.
    expect(Math.round(plan.quantity)) .toBe(710);
    expect(plan.sourceQuantity).toBe(614);
    expect(plan.rows[0].sourceQuantity).toBe(14);
    expect(plan.rows[0].sourceUnit).toBe("PC");
    // Already feet: nothing was converted, so there is nothing to keep.
    expect(plan.rows[1].sourceQuantity).toBeNull();
  });

  it("matches the banner the file names, in feet", () => {
    const sales = plan.rows.filter((r) => r.quantity > 0);
    expect(sales.every((r) => r.dealerId === "ganahl")).toBe(true);
    expect(plan.matchedRows).toBe(2);
    // Home Depot is not one of ours: its zero row loads unmatched, at zero
    // volume, exactly like any other name an admin maps later.
    expect(plan.unmatched).toHaveLength(1);
    expect(plan.unmatched[0].label).toContain("HOME DEPOT");
    expect(plan.unmatched[0].quantity).toBe(0);
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
