// Every fixture here is a REAL line from the synced order book (2026-09-02),
// so the parser is tested against the spellings people actually type into
// POs, not against tidy inventions.

import { describe, expect, it } from "vitest";
import { itemLinearFeet, orderVolume } from "../order-volume";

describe("itemLinearFeet", () => {
  it("passes native linear feet through, whatever the spelling", () => {
    expect(
      itemLinearFeet({ uom: "LF", quantity: 1200, description: "1 X 6 X RL Ipe Decking" }),
    ).toEqual({ lf: 1200, method: "native" });
    expect(itemLinearFeet({ uom: "lf", quantity: 500 })?.lf).toBe(500);
    expect(itemLinearFeet({ uom: "LFT", quantity: 30500 })?.lf).toBe(30500);
  });

  it("converts board feet through the nominal section", () => {
    // ATMFLTG0106 — 01X06 AYOUS THERM MOD FINE LINE VGROOVE T&G, 12,500 BFT
    // 1×6 → 12/(1×6) = 2 LF per BFT
    expect(
      itemLinearFeet({
        uom: "BFT",
        quantity: 12500,
        sku: "ATMFLTG0106",
        description: "01X06 AYOUS THERM MOD FINE LINE VGROOVE T&G",
      }),
    ).toEqual({ lf: 25000, method: "board-feet" });
    // 02X04 → 12/8 = 1.5
    expect(
      itemLinearFeet({
        uom: "bf",
        quantity: 100,
        description: "02X04 AYOUS THERM MOD S4S E4E",
      })?.lf,
    ).toBe(150);
  });

  it("reads fractional and mixed-number sections", () => {
    // 5/4 × 6 → 12/(1.25×6) = 1.6
    expect(
      itemLinearFeet({ uom: "BF", quantity: 1000, description: "5/4X6 IPE DECKING" })?.lf,
    ).toBeCloseTo(1600);
    // 1-1/2 × 3-1/2 → 12/5.25
    expect(
      itemLinearFeet({
        uom: "bf",
        quantity: 525,
        description: '1-1/2" X 3-1/2" X RL Cumaru S4S E4E',
      })?.lf,
    ).toBeCloseTo((525 * 12) / 5.25);
  });

  it("converts pieces through the catalogue's inch lengths", () => {
    // 083003215 1X6-177" — the same code family the sell-through speaks
    expect(
      itemLinearFeet({
        uom: "PC",
        quantity: 49,
        sku: "083003215",
        description: '1X6-177" THERMOWOOD CLAD V-GRV/NCKL GAP AYOUS',
      }),
    ).toEqual({ lf: (49 * 177) / 12, method: "pieces" });
  });

  it("converts pieces through a foot length in the description", () => {
    // TA5468SSEM — Maximo ThermoWood Ash 5/4x6x8' … (Net 0.98 x 5.51 x 95")
    // the 8' is the piece; the net 95" must not confuse it
    expect(
      itemLinearFeet({
        uom: "EACH",
        quantity: 49,
        sku: "TA5468SSEM",
        description:
          "Maximo ThermoWood Ash 5/4x6x8'\r\nS4S E4E - END MATCH (Net 0.98 x\r\n5.51 x 95\")",
      }),
    ).toEqual({ lf: 392, method: "pieces" });
  });

  it("reads the catalogue family spoken in bare nominal feet", () => {
    // The order system writes "1X6-13" where the sell-through writes
    // "1X6-154\"" — same SKU, nominal feet with no unit mark.
    expect(
      itemLinearFeet({
        uom: "PC",
        quantity: 735,
        sku: "083003213",
        description: "1X6-13 THERMOWOOD CLAD V-GRV/NCKL GAP AYOUS",
      }),
    ).toEqual({ lf: 9555, method: "pieces" });
    // …while three digits stay inches even without the mark's help
    expect(
      itemLinearFeet({
        uom: "PC",
        quantity: 12,
        sku: "083003215",
        description: '1X6-177" THERMOWOOD CLAD V-GRV/NCKL GAP AYOUS',
      })?.lf,
    ).toBeCloseTo((12 * 177) / 12);
  });

  it("reads the length as a bare third dimension", () => {
    // 1844 — 5/4X6X12 IPE PREM: twelve nominal feet, no mark
    expect(
      itemLinearFeet({
        uom: "PC",
        quantity: 336,
        sku: "1844",
        description: "5/4X6X12 IPE PREM",
      }),
    ).toEqual({ lf: 4032, method: "pieces" });
  });

  it("reads the Ipe decking family's length out of its own SKU", () => {
    // IPEKD54610S — 5/4x6, ten feet, confirmed by the line that spells it
    // out ("IPEKD54620S Ipe Maximo 5/4x6x20")
    expect(
      itemLinearFeet({
        uom: "PC",
        quantity: 495,
        sku: "IPEKD54610S",
        description: "5/4X6 IPE DECKING S4S E4E KD",
      }),
    ).toEqual({ lf: 4950, method: "pieces" });
    expect(
      itemLinearFeet({
        uom: "PC",
        quantity: 224,
        sku: "IPEKD1612S",
        description: "1X6 IPE DECKING S4S E4E KD",
      })?.lf,
    ).toBe(2688);
  });

  it("refuses what it cannot prove", () => {
    // a deck tile is not linear product
    expect(
      itemLinearFeet({
        uom: "EACH",
        quantity: 525,
        sku: "CR2424",
        description: '24"x24" Cumaru Wood Deck Tile - Smooth 8 Plank',
      }),
    ).toBeNull();
    // hardware
    expect(
      itemLinearFeet({
        uom: "BOX",
        quantity: 10,
        description: '#8X3-1/8" US4 SS305 TRIM-HEAD 350CT',
      }),
    ).toBeNull();
    // pieces of a random-length run — no single length to multiply by
    expect(
      itemLinearFeet({
        uom: "EACH",
        quantity: 100,
        description: "0.39\" X 3.54\" X 4' TO 16'",
      }),
    ).toBeNull();
    // board feet with no readable section
    expect(itemLinearFeet({ uom: "BFT", quantity: 100, description: "AYOUS" })).toBeNull();
    expect(itemLinearFeet({ uom: "LF", quantity: 0 })).toBeNull();
    expect(itemLinearFeet({ uom: null, quantity: 10 })).toBeNull();
  });
});

describe("orderVolume", () => {
  it("sums the proven feet and reports coverage honestly", () => {
    const reading = orderVolume([
      { uom: "LF", quantity: 1000, total_amount: 2000 },
      { uom: "BFT", quantity: 100, description: "01X06 AYOUS", total_amount: 300 },
      { uom: "BOX", quantity: 10, total_amount: 50 }, // unconvertible
    ]);
    expect(reading.lf).toBe(1200);
    expect(reading.convertedLines).toBe(2);
    expect(reading.totalLines).toBe(3);
    expect(reading.convertedValue).toBe(2300);
    expect(reading.totalValue).toBe(2350);
  });
});
