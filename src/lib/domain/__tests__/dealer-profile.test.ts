import { describe, expect, it } from "vitest";
import { dealerFacts, productFamily } from "../dealer-profile";
import type { SellThroughRow } from "../sell-through";

function row(o: Partial<SellThroughRow>): SellThroughRow {
  return {
    period: "2026-07-01",
    rep_id: null,
    rep_name: null,
    region_id: "se",
    region_name: "Southeast",
    market_owner_name: null,
    distributor_id: "boise",
    distributor_name: "Boise Cascade",
    branch_id: "mem",
    branch_name: "Memphis Branch",
    branch_city: "Memphis",
    branch_state: "TN",
    dealer_id: null,
    dealer_name: null,
    dealer_label: "THRBUSCO - MAXIMUS BUILDING SUPPLY",
    product: '083003213 1X6-154" THERMOWOOD CLAD V-GRV/NCKL GAP AYOUS',
    quantity: 3144,
    unit: "LF",
    value: null,
    period_kind: "MONTH",
    ...o,
  };
}

// Maximus as the files have it: one July, nothing in August, not in Jan–Jun.
const ROWS: SellThroughRow[] = [
  row({}),
  row({ product: '083003211 1X6-130" THERMOWOOD CLAD V-GRV/NCKL GAP AYOUS', quantity: 2654 }),
  row({ product: "083002570 1X4-RL THERMOWOOD S4S E4E AYOUS 14/BDL", quantity: 735 }),
  // somebody else, so the files on hand include August and the year file
  row({ period: "2026-08-01", dealer_label: "OTHER", quantity: 10 }),
  row({ period: "2026-06-01", period_kind: "YTD", dealer_label: "OTHER", quantity: 99 }),
];

const KEY = new Set(["THRBUSCO - MAXIMUS BUILDING SUPPLY"]);

describe("productFamily", () => {
  it("takes the item code and the length out, and keeps the length", () => {
    expect(productFamily('083003213 1X6-154" THERMOWOOD CLAD V-GRV/NCKL GAP AYOUS')).toEqual({
      family: "1X6 THERMOWOOD CLAD V-GRV/NCKL GAP AYOUS",
      length: '154"',
    });
    expect(productFamily("083002570 1X4-RL THERMOWOOD S4S E4E AYOUS 14/BDL").length).toBeNull();
  });
});

describe("dealerFacts", () => {
  const f = dealerFacts(KEY, ROWS)!;

  it("reads a dealer with no account from its label", () => {
    expect(f.accountId).toBeNull();
    expect(f.name).toBe("Maximus Building Supply");
    expect(f.regions).toEqual(["Southeast"]);
    expect(f.reps).toEqual([]);
  });

  it("knows when it last bought, and that a newer month file heard nothing", () => {
    expect(f.firstSeen).toBe("2026-07-01");
    expect(f.lastBought).toBe("2026-07-01");
    expect(f.silentIn).toBe("2026-08-01");
    expect(f.yearSoFar).toBe(3144 + 2654 + 735);
  });

  it("groups one profile's lengths into one family", () => {
    const clad = f.products[0];
    expect(clad.family).toBe("1X6 THERMOWOOD CLAD V-GRV/NCKL GAP AYOUS");
    expect(clad.lengths).toEqual(['130"', '154"']);
    expect(clad.lf).toBe(5798);
    expect(Math.round(f.products.reduce((n, p) => n + p.share, 0))).toBe(100);
  });

  it("splits the latest purchase by house and branch", () => {
    expect(f.latestSplit).toEqual([
      { house: "Boise Cascade", branch: "Memphis Branch", lf: 6533, share: 100 },
    ]);
  });

  it("is not silent when no newer month file exists — a missing file is unknown", () => {
    const g = dealerFacts(KEY, ROWS.filter((r) => r.period !== "2026-08-01"))!;
    expect(g.silentIn).toBeNull();
  });

  it("answers null for a key no file names", () => {
    expect(dealerFacts(new Set(["nobody"]), ROWS)).toBeNull();
  });
});
