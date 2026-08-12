// Where a counterpart sits relative to this account in the trade.
//
// A one-parent CRM cannot hold this: a contractor buys from several dealers and
// two branches of one banner run through different distributors. The account
// page already lists who is connected; this says which side they are on, which
// is what turns a list of names into a channel.
//
// Direction is only claimed where the relationship type states it. SUPPLIES and
// PURCHASES_FROM name a flow; WORKS_WITH, REFERRED_BY and the professional
// roles do not, and inverting them would be guessing at semantics the data does
// not carry. Everything unclaimed is "alongside" rather than silently sorted
// into a side it may not belong on.

export type ChainPosition = "upstream" | "downstream" | "alongside";

export const CHAIN_HEADING: Record<ChainPosition, string> = {
  upstream: "Where the product comes from",
  downstream: "Where the demand is",
  alongside: "Alongside",
};

// Reading order down the channel, so a rep sees supply, then themselves, then
// demand — the shape of the trade rather than alphabetical names.
export const CHAIN_ORDER: ChainPosition[] = [
  "upstream",
  "alongside",
  "downstream",
];

/**
 * @param type    the stored relationship_type, read as "A <type> B"
 * @param selfIsA whether this account is the A side of the stored row
 */
export function chainPosition(type: string, selfIsA: boolean): ChainPosition {
  switch (type) {
    // "A supplies B": if we are A, they are who we sell to.
    case "SUPPLIES":
      return selfIsA ? "downstream" : "upstream";
    // "A purchases from B": if we are A, they are who we buy from.
    case "PURCHASES_FROM":
      return selfIsA ? "upstream" : "downstream";
    default:
      return "alongside";
  }
}

/**
 * One counterpart can hold several relationships at once. A stated direction
 * beats an unstated one; genuinely contradictory directions fall back to
 * alongside rather than picking a winner the data does not justify.
 */
export function resolvePosition(positions: ChainPosition[]): ChainPosition {
  const directed = positions.filter((p) => p !== "alongside");
  if (directed.length === 0) return "alongside";
  const first = directed[0];
  return directed.every((p) => p === first) ? first : "alongside";
}
