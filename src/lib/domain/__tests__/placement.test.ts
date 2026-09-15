import { describe, expect, it } from "vitest";
import { placeAddress } from "../placement";

const states = [
  { state: "TX", territory_id: "texas" },
  { state: "NY", territory_id: "northeast" },
];
const cities = [
  { state: "CA", city: "ANAHEIM", territory_id: "socal" },
  { state: "CA", city: "SAN FRANCISCO", territory_id: "norcal" },
];

describe("placeAddress", () => {
  it("places an ordinary state by its state", () => {
    expect(placeAddress({ state: "TX", city: "Austin" }, states, cities)).toEqual({
      territoryId: "texas",
      how: "state",
    });
  });

  it("places California by city, whatever the case and spacing", () => {
    expect(placeAddress({ state: "ca", city: " anaheim " }, states, cities)).toEqual({
      territoryId: "socal",
      how: "city",
    });
    expect(placeAddress({ state: "CA", city: "San  Francisco" }, states, cities)).toEqual({
      territoryId: "norcal",
      how: "city",
    });
  });

  it("never files a California city it does not know under a guessed side", () => {
    // Van Nuys is Southern California to anyone who lives there, and still not
    // on the map: the line between the two California reps is not drawn.
    expect(placeAddress({ state: "CA", city: "Van Nuys" }, states, cities)).toEqual({
      territoryId: null,
      how: "city-not-on-map",
    });
  });

  it("says when a state has no region, and when there is no state at all", () => {
    expect(placeAddress({ state: "HI", city: "Honolulu" }, states, cities).how).toBe(
      "state-not-on-map",
    );
    expect(placeAddress({ state: null, city: "Anaheim" }, states, cities).how).toBe(
      "no-state",
    );
  });
});
