// Linear feet out of an order's item lines (Andre, 2026-09-02): "o LF vai
// ser o marco de comparativo mais comum". The return (sell-through) speaks
// only LF; the orders speak LF, board feet and pieces, in whatever spelling
// the person typing the PO used. The stock-position read needs one unit, so
// this module converts what it can PROVE and refuses the rest — an estimate
// that quietly guessed tile counts into feet would poison the subtraction.
//
// Three methods, in order of trust:
//   native      the line is already linear feet (lf / LF / LFT)
//   board-feet  bf × 12 / (thickness × width), both read from the nominal
//               dimension the description leads with ("01X06", "5/4X6")
//   pieces      pieces × the piece's own length ("1X6-189\"" → 189 inches;
//               "…x8'" → 8 feet)
//
// Anything else — hardware, tiles, a random-length run sold by the piece —
// comes back null and is COUNTED as unconverted, so every reading built on
// this can say how much of the book it actually covers.

/** The order book's CONSISTENT ERA (Andre, 2026-09-04): the system was
 *  adopted in May 2026 and "junho, julho e agosto são meses consistentes" —
 *  ~40–48 orders a month from June on. What sits before that is sparse
 *  retroactive backfill (a 2025 PO typed in later), and no window or ledger
 *  should anchor on it. Compare against `(order_date_po ?? created_at)`'s
 *  YYYY-MM prefix. */
export const ORDERS_CONSISTENT_FROM = "2026-06";

// ── Where the order went ────────────────────────────────────────────────────
// The ship-to state, normalized to the USPS code the Master Territory Map is
// written in. The order system's paper is typed by people: "CA" and "NEW
// YORK" both occur. Anything that is neither a code nor a full state name
// comes back null — an order with an unreadable destination belongs to no
// region, and only the nationwide read sees it.

const STATE_CODE: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR",
  CALIFORNIA: "CA", COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE",
  "DISTRICT OF COLUMBIA": "DC", FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI",
  IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS",
  KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD",
  MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS",
  MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM",
  "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH",
  OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX",
  UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA",
  "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY",
};
const STATE_CODES = new Set(Object.values(STATE_CODE).concat("DC"));

export function shipToState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (STATE_CODES.has(s)) return s;
  return STATE_CODE[s] ?? null;
}

export interface OrderItemLike {
  sku?: string | null;
  description?: string | null;
  uom?: string | null;
  quantity?: number | null;
  total_amount?: number | null;
}

export interface LinearRead {
  lf: number;
  method: "native" | "board-feet" | "pieces";
}

// "01X06", "1X12", "02X04", "5/4X6", '1-1/2" X 3-1/2"' — the nominal section
// a lumber line leads with. Fractions and mixed numbers are real ("5/4",
// "1-1/2"), and an inch mark may sit between the number and the X.
const SECTION =
  /(\d+(?:-\d+\/\d+|\/\d+|\.\d+)?)\s*["”]?\s*[xX]\s*(\d+(?:-\d+\/\d+|\/\d+|\.\d+)?)/;

// "1X6-189\"" — the piece length in inches that the 083… catalogue speaks.
const INCH_LENGTH = /\dx\d+-(\d{2,3})\s*(?:"|”|in\b)/i;

// "…x8'" / "X 8'" — a piece length in feet. Refused when the text goes on to
// say "TO" (a random-length range has no single piece length).
const FOOT_LENGTH = /[xX]\s*(\d{1,2})\s*'/;

// "1X6-13" — the SAME catalogue family spoken in NOMINAL FEET, bare: the
// order system writes "1X6-13" where the sell-through writes "1X6-154\""
// (154 in ≈ 12.8 ft, nominal 13 — the pairs line up one to one across the
// 083… range). The trade's convention disambiguates: one or two bare digits
// after the section are feet; three digits, or an inch mark, are inches.
const BARE_FEET = /\dx\d+-(\d{1,2})(?![\d'"”])/i;

// "5/4X6X12 IPE PREM" — the length as a bare THIRD dimension. Same
// convention: one or two bare digits are feet. A tile's "24\"x24\"" cannot
// reach here — its inch marks break the digit-x-digit chain.
const THIRD_DIM_FEET = /\d\s*[xX]\s*\d{1,2}\s*[xX]\s*(\d{1,2})(?![\d'"”])/;

// IPEKD54610S / IPEKD1612S — the Ipe decking family carries its length
// INSIDE the SKU: section code (546 = 5/4x6, 16 = 1x6), then the feet, then
// S. The grammar is confirmed by the one line that spells it out —
// "IPEKD54620S Ipe Maximo 5/4x6x20". Scoped to the family; never a general
// guess about SKUs.
const IPEKD_SKU = /^IPEKD(?:546|16)(\d{1,2})S$/i;

function parseNumberish(raw: string): number | null {
  // "5/4" → 1.25 · "1-1/2" → 1.5 · "1.65" → 1.65 · "06" → 6
  const mixed = raw.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = raw.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function itemLinearFeet(item: OrderItemLike): LinearRead | null {
  const qty = Number(item.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const uom = (item.uom ?? "").trim().toLowerCase();
  const text = `${item.sku ?? ""} ${item.description ?? ""}`;

  if (uom === "lf" || uom === "lft") {
    return { lf: qty, method: "native" };
  }

  if (uom === "bf" || uom === "bft") {
    const m = text.match(SECTION);
    if (!m) return null;
    const t = parseNumberish(m[1]);
    const w = parseNumberish(m[2]);
    if (!t || !w) return null;
    return { lf: (qty * 12) / (t * w), method: "board-feet" };
  }

  if (uom === "each" || uom === "pc" || uom === "ea" || uom === "unit") {
    const inches = text.match(INCH_LENGTH);
    if (inches) {
      return { lf: (qty * Number(inches[1])) / 12, method: "pieces" };
    }
    // A range ("4' TO 16'") has no single piece length to multiply by.
    if (!/'\s*TO\s/i.test(text)) {
      const feet = text.match(FOOT_LENGTH);
      if (feet) return { lf: qty * Number(feet[1]), method: "pieces" };
      const third = text.match(THIRD_DIM_FEET);
      if (third) return { lf: qty * Number(third[1]), method: "pieces" };
      const bare = text.match(BARE_FEET);
      if (bare) return { lf: qty * Number(bare[1]), method: "pieces" };
      const sku = (item.sku ?? "").trim().match(IPEKD_SKU);
      if (sku) return { lf: qty * Number(sku[1]), method: "pieces" };
    }
    return null;
  }

  return null;
}

export interface VolumeReading {
  /** Proven linear feet across the convertible lines. */
  lf: number;
  convertedLines: number;
  totalLines: number;
  /** Dollar value on converted vs. all lines (where lines carry amounts) —
   *  the honest "this LF figure covers N% of the money". */
  convertedValue: number;
  totalValue: number;
}

export function orderVolume(items: readonly OrderItemLike[]): VolumeReading {
  let lf = 0;
  let convertedLines = 0;
  let convertedValue = 0;
  let totalValue = 0;
  for (const item of items) {
    const value = Number(item.total_amount) || 0;
    totalValue += value;
    const read = itemLinearFeet(item);
    if (read) {
      lf += read.lf;
      convertedLines += 1;
      convertedValue += value;
    }
  }
  return {
    lf,
    convertedLines,
    totalLines: items.length,
    convertedValue,
    totalValue,
  };
}
