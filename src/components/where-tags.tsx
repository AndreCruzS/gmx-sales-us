// Where a dealer buys, and through whom — two small labels under its name
// (Bianca, 2026-09-18, of the gone-quiet list: "e quem que é o distribuidor
// aí?"). A name alone cannot be acted on: the call goes to the rep of that
// region, or to the house that supplies it.
//
// A label the screen is already filtered to says nothing, so the list that is
// narrowed to one region drops the region label (Andre, same day). The house
// wears its own colour — the one it has on the chart — as a dot, never as the
// whole pill: the name is the label, the dot only ties it to the chart.

import { distributorColour } from "@/lib/domain/sell-through";

export function WhereTags({
  regions,
  houses,
  hideRegion = false,
  hideHouse = false,
}: {
  regions: readonly string[];
  houses: readonly string[];
  hideRegion?: boolean;
  hideHouse?: boolean;
}) {
  const showRegions = hideRegion ? [] : regions;
  const showHouses = hideHouse ? [] : houses;
  if (showRegions.length === 0 && showHouses.length === 0) return null;
  return (
    <span className="where-tags">
      {showRegions.map((r) => (
        <span key={`r-${r}`} className="where-tag">
          {r}
        </span>
      ))}
      {showHouses.map((h) => (
        <span key={`h-${h}`} className="where-tag">
          <i style={{ background: distributorColour(h) }} aria-hidden="true" />
          {h}
        </span>
      ))}
    </span>
  );
}
