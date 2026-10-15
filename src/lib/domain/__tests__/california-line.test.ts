import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// THE SANTA BARBARA LINE (Bianca's map, 2026-10-15): "NorCal — everything
// north of Santa Barbara. SoCal — Santa Barbara and everything south of it."
// The line lives in a migration, as data; this reads it back and holds it to
// the map, so an edit that moves a county or a town says so here.

const SOCAL = "b0000000-0000-0000-0000-000000000002";
const NORCAL = "b0000000-0000-0000-0000-000000000011";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261015190000_california_split_by_county.sql"),
  "utf8",
);

function block(head: string): [string, string][] {
  const start = sql.indexOf(head);
  expect(start).toBeGreaterThan(-1);
  const body = sql.slice(start, sql.indexOf(";", start));
  return [...body.matchAll(/\('((?:[^']|'')+)', '((?:[^']|'')+)'\)/g)].map((m) => [
    m[1].replace(/''/g, "'"),
    m[2].replace(/''/g, "'"),
  ]);
}

const line = new Map(block("insert into ca_county_line"));
const places = new Map(block("insert into ca_places"));
const side = (city: string) => line.get(places.get(city) ?? "");

describe("California split at Santa Barbara", () => {
  it("covers all 58 counties, eight of them south", () => {
    expect(line.size).toBe(58);
    expect([...line.values()].filter((t) => t === SOCAL)).toHaveLength(8);
    expect([...line.values()].every((t) => t === SOCAL || t === NORCAL)).toBe(true);
  });

  it("puts Santa Barbara and the map's southern towns in SoCal", () => {
    for (const city of ["SANTA BARBARA", "GOLETA", "LOS ANGELES", "SAN DIEGO", "PALM SPRINGS", "RIVERSIDE", "VENTURA"]) {
      expect(side(city), city).toBe(SOCAL);
    }
  });

  it("puts the map's northern towns in NorCal, San Luis Obispo included", () => {
    for (const city of ["SAN LUIS OBISPO", "MONTEREY", "SAN JOSE", "SAN FRANCISCO", "SACRAMENTO", "REDDING"]) {
      expect(side(city), city).toBe(NORCAL);
    }
  });

  it("keeps a county whole rather than cutting it on the latitude of Santa Barbara", () => {
    // Lancaster and Palmdale sit north of that latitude but are Los Angeles
    // County; Bakersfield is Kern, north of the line.
    expect(side("LANCASTER")).toBe(SOCAL);
    expect(side("PALMDALE")).toBe(SOCAL);
    expect(side("BAKERSFIELD")).toBe(NORCAL);
  });

  it("files every town under a county the line knows", () => {
    expect(places.size).toBeGreaterThan(1200);
    for (const [city, county] of places) expect(line.has(county), `${city} → ${county}`).toBe(true);
  });
});
