// Which region an address lands in.
//
// The client's Master Territory Map places every region by STATE, except
// California, which holds two markets in one state and is placed CITY by city
// (territory_cities). This is the same rule the sell-through map already reads
// for distributor branches; accounts now get it at the moment they are created,
// from the ZIP a person types, instead of arriving unplaced and waiting.
//
// It never guesses. The line between the two California reps is drawn at Santa
// Barbara, county by county (Bianca's map, 2026-10-15; see the migration
// california_split_by_county), and every California postal town is written into
// territory_cities with its side. A California name still missing — a typo, a
// neighbourhood no postal list carries — is not "probably Southern California":
// an account filed on the wrong side credits the wrong rep. It comes back
// unplaced, and says why.

export interface TerritoryStateRow {
  state: string;
  territory_id: string;
}

export interface TerritoryCityRow {
  state: string;
  city: string;
  territory_id: string;
}

export type Placement =
  | { territoryId: string; how: "state" | "city" }
  | { territoryId: null; how: "city-not-on-map" | "state-not-on-map" | "no-state" };

/** States placed by city rather than by state, because one state holds more
 *  than one market. */
const CITY_PLACED = new Set(["CA"]);

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");

export function placeAddress(
  address: { state: string | null; city: string | null },
  states: readonly TerritoryStateRow[],
  cities: readonly TerritoryCityRow[],
): Placement {
  const state = address.state ? norm(address.state) : "";
  if (!state) return { territoryId: null, how: "no-state" };

  if (CITY_PLACED.has(state)) {
    const city = address.city ? norm(address.city) : "";
    const hit = cities.find((c) => norm(c.state) === state && norm(c.city) === city);
    return hit
      ? { territoryId: hit.territory_id, how: "city" }
      : { territoryId: null, how: "city-not-on-map" };
  }

  const hit = states.find((s) => norm(s.state) === state);
  return hit
    ? { territoryId: hit.territory_id, how: "state" }
    : { territoryId: null, how: "state-not-on-map" };
}
