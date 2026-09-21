// Through whom a dealer buys — small labels under its name (Bianca,
// 2026-09-18, of the gone-quiet list: "e quem que é o distribuidor aí?"). A
// name alone cannot be acted on: the call goes to the house that supplies it.
//
// Houses only (João, 2026-09-21: the region pills were polluting the lists).
// The region still shows where it is the point — the card's own sentence, the
// dealer module's "No rep for this region".
//
// The house wears its own colour — the one it has on the chart — as a dot,
// never as the whole pill: the name is the label, the dot only ties it to the
// chart.

import { distributorColour } from "@/lib/domain/sell-through";

export function WhereTags({ houses }: { houses: readonly string[] }) {
  if (houses.length === 0) return null;
  return (
    <span className="where-tags">
      {houses.map((h) => (
        <span key={h} className="where-tag">
          <i style={{ background: distributorColour(h) }} aria-hidden="true" />
          {h}
        </span>
      ))}
    </span>
  );
}
