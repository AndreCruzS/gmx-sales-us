// THE QUOTE SCOREBOARD — what the platform's own quotes say about a rep's
// work (João, 2026-11-17: "montar com o uso da plataforma"). He showed the
// slides of another GMX department — closed revenue, active pipeline,
// conversion, leads worked, quotes sent, a revenue curve, the biggest wins and
// the formal quotes in progress — and asked for that reading here, built
// only from what the reps record.
//
// Every figure comes from one place: the opportunities, their stage events
// (the day a deal became a sale is the WON event, never a plan date — the
// rule dashboard_won_monthly set) and the work on the record. Nothing is
// typed in by hand, nothing is guessed: a figure with no data behind it is
// null and the page says why, instead of drawing a zero.

export interface SummaryOpp {
  id: string;
  name: string;
  stage: string;
  estimated_revenue: number | null;
  owner_id: string;
  created_at: string;
}

export interface SummaryEvent {
  opportunity_id: string;
  to_stage: string;
  occurred_at: string;
}

/** A priced quote: it reached QUOTE, or a stage only a priced deal reaches. */
const PRICED = new Set(["QUOTE", "DECISION", "WON"]);
const OPEN = new Set(["QUOTE", "DECISION"]);

export interface WeekPoint {
  /** Monday of the week, ISO date. */
  week: string;
  /** Won value up to and including this week. */
  total: number;
}

export interface Win {
  id: string;
  value: number;
  wonAt: string;
}

export interface QuoteSummary {
  /** Won value and how many deals made it. */
  closed: number;
  wonCount: number;
  /** Value with a price out and no answer back. */
  pipeline: number;
  openCount: number;
  /** won / (won + lost); null until one has been decided. */
  winRate: number | null;
  decided: number;
  /** Deals that ever had a price out. */
  quotesSent: number;
  /** closed / wonCount; null with no win. */
  avgTicket: number | null;
  /** Cumulative won value per week, from the first priced quote to today. */
  curve: WeekPoint[];
  /** The three biggest wins, biggest first. */
  topWins: Win[];
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Read the scoreboard for one rep (`owner`) or the whole team (`null`).
 * `todayIso` closes the curve, so a quiet week still shows as flat.
 */
export function quoteSummary(
  opps: readonly SummaryOpp[],
  events: readonly SummaryEvent[],
  owner: string | null,
  todayIso: string,
): QuoteSummary {
  const mine = owner ? opps.filter((o) => o.owner_id === owner) : opps;
  const ids = new Set(mine.map((o) => o.id));
  const mineEvents = events.filter((e) => ids.has(e.opportunity_id));

  // The last WON event dates the sale; a deal since lost does not count.
  const wonAt = new Map<string, string>();
  const pricedAt = new Map<string, string>();
  for (const e of mineEvents) {
    if (e.to_stage === "WON") {
      const prev = wonAt.get(e.opportunity_id);
      if (!prev || e.occurred_at > prev) wonAt.set(e.opportunity_id, e.occurred_at);
    }
    if (PRICED.has(e.to_stage)) {
      const prev = pricedAt.get(e.opportunity_id);
      if (!prev || e.occurred_at < prev) pricedAt.set(e.opportunity_id, e.occurred_at);
    }
  }

  const won = mine.filter((o) => o.stage === "WON");
  const lost = mine.filter((o) => o.stage === "LOST");
  const open = mine.filter((o) => OPEN.has(o.stage));
  const value = (o: SummaryOpp) => o.estimated_revenue ?? 0;

  const closed = won.reduce((s, o) => s + value(o), 0);
  const pipeline = open.reduce((s, o) => s + value(o), 0);
  const decided = won.length + lost.length;
  // A deal at a priced stage today counts even when its event predates the
  // event log (rows written before the trigger, or imported).
  const quotesSent = mine.filter(
    (o) => pricedAt.has(o.id) || PRICED.has(o.stage),
  ).length;

  const wins: Win[] = won.map((o) => ({
    id: o.id,
    value: value(o),
    wonAt: wonAt.get(o.id) ?? o.created_at,
  }));

  // The curve starts the week of the first price out (or first win) and runs
  // to this week, one point per week.
  const starts = [
    ...pricedAt.values(),
    ...wins.map((w) => w.wonAt),
  ].sort();
  const curve: WeekPoint[] = [];
  if (starts.length > 0 && todayIso) {
    const byWeek = new Map<string, number>();
    for (const w of wins) {
      const k = mondayOf(w.wonAt);
      byWeek.set(k, (byWeek.get(k) ?? 0) + w.value);
    }
    let total = 0;
    const last = mondayOf(todayIso);
    for (let wk = mondayOf(starts[0]); wk <= last; wk = addDays(wk, 7)) {
      total += byWeek.get(wk) ?? 0;
      curve.push({ week: wk, total });
    }
  }

  return {
    closed,
    wonCount: won.length,
    pipeline,
    openCount: open.length,
    winRate: decided > 0 ? won.length / decided : null,
    decided,
    quotesSent,
    avgTicket: won.length > 0 ? closed / won.length : null,
    curve,
    topWins: [...wins].sort((a, b) => b.value - a.value).slice(0, 3),
  };
}

/** A line of a quote's survey (quote_items), as far as naming it goes. */
export interface QuoteLine {
  description: string;
  species: string | null;
  nominal_size: string | null;
  lf: number;
}

/**
 * What a quote is FOR, in one line. Two writers fill it differently: the
 * app's quote flow keeps its products as survey lines (quote_items, priced by
 * SKU), the agent — which has no catalogue — writes the product and its LF on
 * the deal itself. The deal's own words win; else the lines speak.
 */
export function quoteProduct(
  deal: { product: string | null; estimated_quantity: number | null; quantity_unit: string | null },
  lines: readonly QuoteLine[],
): { product: string | null; quantity: number | null; unit: string | null } {
  if (deal.product) {
    return { product: deal.product, quantity: deal.estimated_quantity, unit: deal.quantity_unit };
  }
  if (lines.length === 0) {
    return { product: null, quantity: deal.estimated_quantity, unit: deal.estimated_quantity ? deal.quantity_unit : null };
  }
  const first = lines[0];
  const name = [first.species, first.nominal_size].filter(Boolean).join(" ") || first.description;
  const more = lines.length > 1 ? ` +${lines.length - 1}` : "";
  const lf = lines.reduce((n, l) => n + Number(l.lf || 0), 0);
  return { product: `${name}${more}`, quantity: lf > 0 ? lf : null, unit: lf > 0 ? "LF" : null };
}
