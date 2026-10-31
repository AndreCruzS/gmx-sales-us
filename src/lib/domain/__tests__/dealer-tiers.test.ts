import { describe, expect, it } from "vitest";
import { tierCounts, tierDealers, untieredTargets } from "../dealer-tiers";
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
    dealer_label: "DEALER A",
    product: null,
    quantity: 100,
    unit: "LF",
    value: null,
    period_kind: "MONTH",
    ...o,
  };
}

const AS_OF = "2026-09-01";
const byName = (label: string) => (t: { name: string }) => t.name.toLowerCase().includes(label.toLowerCase());

describe("tierDealers", () => {
  it("the dealers that make up 80% of LF are T1, including the one that crosses it", () => {
    const rows = [
      row({ dealer_label: "AAA", quantity: 50 }),
      row({ dealer_label: "BBB", quantity: 30 }),
      row({ dealer_label: "CCC", quantity: 10 }),
      row({ dealer_label: "DDD", quantity: 10 }),
    ];
    const t = tierDealers(rows, AS_OF);
    expect(t.map((d) => d.tier)).toEqual(["T1", "T1", "T3", "T3"]);
    expect(t[0].share).toBeCloseTo(0.5);
  });

  it("fewer than 3 purchase months is T3", () => {
    const rows = [
      row({ dealer_label: "BIG", quantity: 1000 }),
      row({ dealer_label: "SMALL", period: "2026-07-01", quantity: 5 }),
      row({ dealer_label: "SMALL", period: "2026-06-01", quantity: 5 }),
    ];
    const small = tierDealers(rows, AS_OF).find(byName("small"))!;
    expect(small.purchaseMonths).toBe(2);
    expect(small.tier).toBe("T3");
  });

  it("3 or more is T2", () => {
    const rows = [
      row({ dealer_label: "BIG", quantity: 1000 }),
      ...["2026-07-01", "2026-06-01", "2026-05-01"].map((p) =>
        row({ dealer_label: "SMALL", period: p, quantity: 5 }),
      ),
    ];
    const small = tierDealers(rows, AS_OF).find(byName("small"))!;
    expect(small.purchaseMonths).toBe(3);
    expect(small.tier).toBe("T2");
  });

  it("branch-level rows and non-LF rows count for nobody", () => {
    const rows = [
      row({ dealer_label: "AAA", quantity: 10 }),
      row({ dealer_label: null, detail: "branch", quantity: 999 }),
      row({ dealer_label: "BBB", unit: "EA", quantity: 999 }),
    ];
    const t = tierDealers(rows, AS_OF);
    expect(t).toHaveLength(1);
    expect(t[0].lf).toBe(10);
    expect(t[0].share).toBe(1);
  });

  it("house accounts count for nobody", () => {
    const rows = [
      row({ dealer_label: "AAA", quantity: 10 }),
      row({ dealer_label: "COUNTER", is_house_account: true, quantity: 500 }),
    ];
    const t = tierDealers(rows, AS_OF);
    expect(t.map((d) => d.name)).toHaveLength(1);
    expect(t[0].lf).toBe(10);
    expect(t[0].share).toBe(1);
  });

  it("a dealer with months from one distributor and YTD from another counts both", () => {
    const rows = [
      row({ dealer_label: "MIXED", distributor_id: "boise", period: "2026-07-01", quantity: 100 }),
      row({ dealer_label: "MIXED", distributor_id: "other", period: "2026-08-01", period_kind: "YTD", quantity: 400 }),
    ];
    const d = tierDealers(rows, AS_OF)[0];
    expect(d.lf).toBe(500);
    expect(d.purchaseMonths).toBe(2);
  });

  it("YTD from two distributors counts two purchase months", () => {
    const rows = [
      row({ dealer_label: "TWOYTD", distributor_id: "boise", period: "2026-08-01", period_kind: "YTD", quantity: 300 }),
      row({ dealer_label: "TWOYTD", distributor_id: "other", period: "2026-08-01", period_kind: "YTD", quantity: 200 }),
    ];
    const d = tierDealers(rows, AS_OF)[0];
    expect(d.lf).toBe(500);
    expect(d.purchaseMonths).toBe(2);
  });

  it("a dealer at exactly 80% cumulative ahead of it is not T1", () => {
    const rows = [
      row({ dealer_label: "AAA", quantity: 60 }),
      row({ dealer_label: "BBB", quantity: 20 }),
      row({ dealer_label: "CCC", quantity: 20 }),
    ];
    expect(tierDealers(rows, AS_OF).map((d) => d.tier)).toEqual(["T1", "T1", "T3"]);
  });

  it("rows outside the 12-month window are ignored", () => {
    const rows = [
      row({ dealer_label: "AAA", period: "2025-10-01", quantity: 40 }),
      row({ dealer_label: "AAA", period: "2026-09-01", quantity: 40 }),
      row({ dealer_label: "AAA", period: "2026-08-01", quantity: 10 }),
    ];
    // 2026-11-01 reads Nov 2025..Oct 2026: the October 2025 row falls out.
    expect(tierDealers(rows, "2026-11-01")[0].lf).toBe(50);
    // 2026-09-01 reads Sep 2025..Aug 2026: the September 2026 row is not yet history.
    expect(tierDealers(rows, "2026-09-01")[0].lf).toBe(50);
  });

  it("a YTD row counts as one purchase month", () => {
    const rows = [
      row({ dealer_label: "YTDER", period: "2026-08-01", period_kind: "YTD", quantity: 300 }),
      row({ dealer_label: "YTDER", period: "2026-06-01", period_kind: "YTD", quantity: 200 }),
    ];
    const d = tierDealers(rows, AS_OF)[0];
    expect(d.purchaseMonths).toBe(1);
    expect(d.lf).toBe(300);
  });

  it("a dealer with both MONTH and YTD rows is counted from MONTH rows only", () => {
    const rows = [
      row({ dealer_label: "BOTH", period: "2026-07-01", quantity: 100 }),
      row({ dealer_label: "BOTH", period: "2026-08-01", period_kind: "YTD", quantity: 700 }),
    ];
    const d = tierDealers(rows, AS_OF)[0];
    expect(d.lf).toBe(100);
    expect(d.purchaseMonths).toBe(1);
  });

  it("ties in LF break by name", () => {
    const rows = [
      row({ dealer_label: "ZED", quantity: 10 }),
      row({ dealer_label: "ALPHA", quantity: 10 }),
    ];
    expect(tierDealers(rows, AS_OF).map((d) => d.name)).toEqual(["Alpha", "Zed"]);
  });

  it("takes the account id from dealer_id and the region with most LF", () => {
    const rows = [
      row({ dealer_id: "d1", dealer_name: "Acme", quantity: 10, region_id: "se", region_name: "Southeast" }),
      row({ dealer_id: "d1", dealer_name: "Acme", quantity: 30, region_id: "tx", region_name: "Texas" }),
    ];
    const d = tierDealers(rows, AS_OF)[0];
    expect(d.accountId).toBe("d1");
    expect(d.regionId).toBe("tx");
    expect(d.regionName).toBe("Texas");
  });
});

describe("tierCounts and untieredTargets", () => {
  it("counts per tier", () => {
    const rows = [
      row({ dealer_label: "AAA", quantity: 90 }),
      row({ dealer_label: "BBB", quantity: 10 }),
    ];
    expect(tierCounts(tierDealers(rows, AS_OF))).toEqual({ T1: 1, T2: 0, T3: 1 });
  });

  it("untieredTargets returns dealer accounts with no tier", () => {
    const tiers = tierDealers([row({ dealer_id: "d1", dealer_name: "Acme" })], AS_OF);
    const out = untieredTargets([{ id: "d1" }, { id: "d2" }], tiers);
    expect(out).toEqual([{ id: "d2" }]);
  });
});
