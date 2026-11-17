import { describe, expect, it } from "vitest";
import type { CatalogItem } from "@/lib/catalog/search";
import { buildQuoteLines } from "../tools/quotes";

const item = (sku: string, over: Partial<CatalogItem> = {}): CatalogItem => ({
  sku,
  randomLength: false,
  description: `Desc ${sku}`,
  species: "Ayous",
  profile: "S4S",
  nominal_size: "1x6",
  base_uom: "PC",
  lf_per_piece: 12,
  piecesAvailable: 10,
  lfAvailable: 120,
  branches: 1,
  thermo: false,
  ...over,
});

describe("buildQuoteLines", () => {
  const catalog = [item("TAYL16-12"), item("TAYL16-RL", { randomLength: true, lf_per_piece: null })];

  it("takes identity from the catalog and turns pieces into LF", () => {
    const r = buildQuoteLines(
      [
        { sku: "tayl16-12", quantity: 100, unit: "PC", price_per_lf: 2.5 },
        { sku: "TAYL16-RL", quantity: 800, unit: "LF" },
      ],
      catalog,
    );
    expect(r.unknown).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.lines[0]).toMatchObject({ sku: "TAYL16-12", description: "Desc TAYL16-12", qty_input: 100, input_uom: "PC", lf: 1200, lf_per_piece: 12, price_per_lf: 2.5 });
    expect(r.lines[1]).toMatchObject({ sku: "TAYL16-RL", lf: 800, lf_per_piece: null, price_per_lf: null });
  });

  it("names the skus the catalog does not have", () => {
    const r = buildQuoteLines([{ sku: "NOPE-1", quantity: 1, unit: "LF" }], catalog);
    expect(r.unknown).toEqual(["NOPE-1"]);
    expect(r.lines).toEqual([]);
  });

  it("refuses pieces of a random-length product", () => {
    const r = buildQuoteLines([{ sku: "TAYL16-RL", quantity: 5, unit: "PC" }], catalog);
    expect(r.problems[0]).toContain("linear foot");
  });
});
