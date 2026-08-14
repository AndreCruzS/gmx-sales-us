// What "an active quote" means.
//
// GMX's other system (the Order Management Platform) has an "active quotes"
// list, and that is the list leadership asked for here. This app has no quote
// object of its own — a quote is an opportunity that has reached the stage
// where a price is out. So rather than inventing a second entity that would
// immediately disagree with the pipeline, "active" is defined once, here, as
// the two stages where a number is in the customer's hands and the answer has
// not come back:
//
//   QUOTE     — priced and sent, nobody has said yes or no
//   DECISION  — they are deciding; the quote is still the thing on the table
//
// IDENTIFIED/QUALIFIED/DEVELOPMENT have no price out yet, and WON/LOST/ON_HOLD
// are answers. None of those are a quote a rep still has to chase.

import type { OpportunityStage } from "./enums";

export const ACTIVE_QUOTE_STAGES = ["QUOTE", "DECISION"] as const;

export type ActiveQuoteStage = (typeof ACTIVE_QUOTE_STAGES)[number];

export function isActiveQuote(stage: OpportunityStage | string): boolean {
  return (ACTIVE_QUOTE_STAGES as readonly string[]).includes(stage);
}

/** How the two live stages read on a row, in the rep's words. */
export const QUOTE_STAGE_LABEL: Record<ActiveQuoteStage, string> = {
  QUOTE: "Out for quote",
  DECISION: "Deciding",
};

export function quoteStageLabel(stage: OpportunityStage | string): string {
  return QUOTE_STAGE_LABEL[stage as ActiveQuoteStage] ?? "Open";
}

export interface QuoteLike {
  stage: string;
  expected_close_date: string | null;
  estimated_revenue: number | null;
  updated_at?: string | null;
}

/**
 * A quote is chasing if the day it was meant to close is behind us and no
 * answer has been recorded. That is the one state on this list a rep can do
 * something about today, so it is the one the list sorts to the top.
 */
export function isOverdue(quote: QuoteLike, todayIso: string): boolean {
  if (!quote.expected_close_date) return false;
  return quote.expected_close_date < todayIso;
}

/**
 * List order: overdue first (oldest close date first — the one left longest),
 * then everything with a date in date order, then the undated. A quote with no
 * close date is not urgent, it is unmanaged, and it belongs at the bottom
 * rather than pretending to be due today.
 */
export function sortQuotes<T extends QuoteLike>(
  quotes: readonly T[],
  todayIso: string,
): T[] {
  return [...quotes].sort((a, b) => {
    const ao = isOverdue(a, todayIso);
    const bo = isOverdue(b, todayIso);
    if (ao !== bo) return ao ? -1 : 1;
    const ad = a.expected_close_date;
    const bd = b.expected_close_date;
    if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    // Same day, or both undated: the bigger number is the one worth the call.
    return (b.estimated_revenue ?? 0) - (a.estimated_revenue ?? 0);
  });
}

/** Total value with a price out — the number a rep is actually carrying. */
export function totalValue(quotes: readonly QuoteLike[]): number {
  return quotes.reduce((sum, q) => sum + (q.estimated_revenue ?? 0), 0);
}
