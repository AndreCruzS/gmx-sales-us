// Loading a distributor's monthly sell-through, whatever shape it arrives in.
//
// This is the other half of the sell-through model: the figures are not ours, so
// somebody has to put them in. Bianca or João get a spreadsheet from Boise and
// from Hardwoods, and the two files do not agree with each other about anything —
// not the column names, not the order, not how a dealer is spelled, not whether
// there is a price at all.
//
// So this does NOT know any vendor's format. The admin pastes the sheet, says
// which column is which once, and everything after that is derived. Pasting is
// deliberate rather than lazy: selecting a range in Excel and pasting it is what
// the job actually looks like, it needs no file parser to go wrong on the
// eighteenth variant of xlsx, and it works the same on a laptop and on a phone.
//
// WHAT IT REFUSES TO GUESS. A dealer it cannot match is loaded anyway with the
// name kept verbatim, because the volume is real and the schema is built for it.
// A BRANCH it cannot match is different: sell_through.branch_id is not null, so
// the row has nowhere to go. Those are surfaced by name and the admin decides —
// add the branch, or leave the row out. Quietly inventing a branch from a typo
// would put a yard on the coverage map that does not exist.

/** A branch we already know about, for matching against the file. */
export interface KnownBranch {
  id: string;
  name: string;
  external_code: string | null;
}

/** An account the file's dealer names might mean. */
export interface KnownDealer {
  id: string;
  name: string;
}

export type ImportField =
  | "branch"
  | "branch_code"
  | "state"
  | "dealer"
  | "product"
  | "quantity"
  | "unit"
  | "value"
  | "last_year";

/** Which column of the pasted sheet holds which field. -1 means "not present". */
export type Mapping = Record<ImportField, number>;

export const EMPTY_MAPPING: Mapping = {
  branch: -1,
  branch_code: -1,
  state: -1,
  dealer: -1,
  product: -1,
  quantity: -1,
  unit: -1,
  value: -1,
  last_year: -1,
};

export interface Sheet {
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

/**
 * Split a pasted sheet into a header row and body rows.
 *
 * Tab first, because that is what a spreadsheet puts on the clipboard; comma
 * only as a fallback, and only when there are no tabs at all. Sniffing per-line
 * would tear a file whose dealer names contain commas.
 */
export function parseSheet(text: string): Sheet {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const delimiter = lines.some((l) => l.includes("\t")) ? "\t" : ",";
  const split = (line: string) =>
    delimiter === "\t" ? line.split("\t").map(cell) : splitCsv(line);

  const [head, ...body] = lines;
  const headers = split(head);
  // Ragged rows are normal — a trailing empty column is dropped by the
  // clipboard, and a short row should read as blank cells rather than as a
  // reason to reject the file.
  const width = headers.length;
  const rows = body.map((line) => {
    const cells = split(line);
    return Array.from({ length: width }, (_, i) => cells[i] ?? "");
  });
  return { headers, rows };
}

/**
 * A spreadsheet's own cells, as the Sheet the rest of this module expects.
 *
 * A parsed .xlsx hands back real types — numbers, dates, booleans, nulls — where
 * a paste hands back strings. Everything downstream reads strings and decides for
 * itself what a figure is (parseNumber already copes with "$1,234.50" and
 * "(500)"), so this is the one place the two doors become the same corridor.
 *
 * Leading blank rows are skipped rather than treated as the header: an exported
 * sheet very often has a row or two of nothing above the column names, and taking
 * one of those as the headers makes every dropdown on the mapping step useless.
 */
export function rowsToSheet(rows: readonly (readonly unknown[])[]): Sheet {
  const text = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return String(v).trim();
  };
  const filled = rows
    .map((r) => r.map(text))
    .filter((r) => r.some((c) => c.length > 0));
  if (filled.length === 0) return { headers: [], rows: [] };

  const [headers, ...body] = filled;
  const width = headers.length;
  return {
    headers,
    // Ragged is normal in an export; a short row means blank cells, not a broken
    // file. Same rule parseSheet follows for a paste.
    rows: body.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")),
  };
}

function cell(raw: string): string {
  return raw.trim().replace(/^"(.*)"$/s, "$1").trim();
}

/** Quote-aware comma split, so "GANAHL LUMBER, ANAHEIM" stays one cell. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        buf += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  out.push(buf.trim());
  return out;
}

// ── Guessing the mapping ────────────────────────────────────────────────────
//
// The admin confirms it either way, so a wrong guess costs a tap. A guess that
// is usually right costs them the whole job on the second file onwards.

const HINTS: Record<ImportField, readonly string[]> = {
  branch: ["branch", "location", "warehouse", "ship from", "shipping branch", "yard", "dc"],
  branch_code: ["branch code", "branch #", "branch no", "loc code", "location code", "whse"],
  // Where the yard IS, which is what decides whose region it belongs to. Kept
  // narrow on purpose: a bare "st" would be claimed by "customer".
  state: ["state", "branch state", "loc state", "province"],
  dealer: ["customer", "dealer", "sold to", "account", "ship to", "buyer"],
  product: ["product", "item", "sku", "description", "material"],
  quantity: ["qty", "quantity", "lf", "linear", "volume", "feet", "units"],
  unit: ["uom", "unit of measure", "u/m", "measure"],
  value: ["value", "sales", "amount", "revenue", "extended", "$", "net"],
  // Real reports compare against the same period LAST YEAR rather than against
  // last month. It is not stored — there is nowhere for it to go — but a line
  // that bought something last year and nothing now is the most actionable row
  // in the file, and it would otherwise be dropped in silence.
  last_year: ["ly ", " ly", "last year", "ly qty", "prior year", "py "],
};

export function guessMapping(headers: readonly string[]): Mapping {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const taken = new Set<number>();
  const guess = { ...EMPTY_MAPPING };

  // Most specific first: "branch code" must not be eaten by "branch", and
  // "customer" must not be eaten by a column merely containing "code".
  // Most specific first. "LY Qty" must be claimed by last_year before
  // "quantity" takes it on the strength of the word "qty".
  const order: ImportField[] = [
    "branch_code",
    // Before "branch", or a column headed "Branch State" is taken for the branch
    // itself and the state is never read at all.
    "state",
    "last_year",
    "unit",
    "quantity",
    "value",
    "dealer",
    "branch",
    "product",
  ];
  for (const field of order) {
    const hit = lower.findIndex(
      (h, i) => !taken.has(i) && HINTS[field].some((k) => h.includes(k)),
    );
    if (hit !== -1) {
      guess[field] = hit;
      taken.add(hit);
    }
  }
  return guess;
}

// ── Where a yard is ─────────────────────────────────────────────────────────
//
// A branch that arrives without a state never reaches the territory map, and a
// branch off the map hands its volume to whoever owns the dealer's banner —
// which is the misattribution the whole region model was built to end. So a new
// yard has to arrive with a state or with somebody being asked for one.

/** The codes the client's Master Territory Map is written in. */
const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
  "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
  "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
  "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
]);

/**
 * The state a yard sits in: the file's own column when it has one, the branch
 * label when it does not.
 *
 * THE LABEL RULE IS DELIBERATELY NARROW — only "City, ST", with the comma. Read
 * loosely, "ABC Lumber Co" ends in Colorado and "Yard 3 NE" in Nebraska, and a
 * branch filed under the WRONG region is far worse than one filed under none: the
 * volume lands on a rep who never sold it and no screen ever says so. A missing
 * state is a question an admin answers in one field before saving. A wrong one is
 * invisible for a quarter.
 */
export function branchState(column: string, label: string): string | null {
  const direct = column.trim().toUpperCase();
  if (US_STATES.has(direct)) return direct;
  const tail = /,\s*([A-Za-z]{2})\s*\.?$/.exec(label.trim());
  const guess = tail ? tail[1].toUpperCase() : null;
  return guess !== null && US_STATES.has(guess) ? guess : null;
}

// ── Matching ────────────────────────────────────────────────────────────────

/**
 * Names are compared with the noise taken out, because a distributor's file and
 * our account list are two different people typing the same yard. Case,
 * punctuation, spacing, a trailing store number, and the words a trade name
 * carries for legal rather than identifying reasons all go.
 */
export function normaliseName(raw: string): string {
  return raw
    .toLowerCase()
    // OUR OWN annotations, and only ours. An account called
    // "Ganahl Lumber (Banner)" has to match a file that says
    // "GANLUGG - GANAHL LUMBER" — before this it matched nothing at all, because
    // "banner" is a word no distributor has ever heard of.
    //
    // Deliberately NOT every bracket. A distributor writing
    // "Ganahl Lumber (Anaheim)" is putting the YARD in there, and throwing that
    // away would merge nine yards into one. Only the labels this codebase itself
    // writes are removed, and a dealer genuinely called Banner Lumber survives
    // because the word is only stripped when it is the whole bracket.
    .replace(/\(\s*(banner|hq|head office|group)\s*\)/g, " ")
    // "#4471", "(4471)" and "- 4471" are store numbers, not part of the name.
    .replace(/[#(]\s*\d+\s*\)?/g, " ")
    .replace(/\b(inc|llc|ltd|co|company|corp|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * "1,234.50" · "$1,234" · "(500)" · "1 234" → a number.
 *
 * Parentheses are accounting for negative, and a credit note is a real thing in
 * a monthly file — reading it as positive would overstate the month.
 */
export function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith("-");
  const digits = trimmed.replace(/[^0-9.]/g, "");
  if (digits.length === 0) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Which of our accounts a name off the file means, or null.
 *
 * Exact match after normalising is the easy half. The hard half is that a
 * distributor writes the banner AND the yard — "GANAHL LUMBER - ANAHEIM #4471" —
 * where we hold the yard as "Ganahl Anaheim". So a name also matches when every
 * word of OUR name appears in THEIRS: {ganahl, anaheim} is inside {ganahl,
 * lumber, anaheim}, and is not inside {ganahl, lumber, corona}.
 *
 * When two accounts both fit, the longer name wins — "Ganahl Anaheim" over a
 * banner-level "Ganahl Lumber" — and a genuine tie stays UNMATCHED. Picking one
 * of two candidates by coin toss would put a yard's volume against the wrong
 * dealer and the wrong rep, which is worse in every direction than leaving it for
 * an admin to say.
 *
 * What it will never do is see through an abbreviation: "BFS Santa Clarita" and
 * "BUILDERS FIRSTSOURCE SANTA CLARITA" share only the town. That is what
 * dealer_label is for.
 */
export function matchDealer(
  label: string,
  dealers: readonly { id: string; tokens: readonly string[]; norm: string }[],
): string | null {
  const norm = normaliseName(label);
  if (norm.length === 0) return null;

  const exact = dealers.find((d) => d.norm === norm);
  if (exact) return exact.id;

  const words = new Set(norm.split(" "));
  const fits = dealers.filter(
    (d) => d.tokens.length > 0 && d.tokens.every((t) => words.has(t)),
  );
  if (fits.length === 0) return null;
  if (fits.length === 1) return fits[0].id;

  const best = fits.reduce((a, b) => (b.norm.length > a.norm.length ? b : a));
  const tied = fits.filter((d) => d.norm.length === best.norm.length).length > 1;
  return tied ? null : best.id;
}

/**
 * A row that is not a sale.
 *
 * The first real report is a pivot with the subtotals left in: every item gets a
 * line whose customer is literally "Total", every branch gets one whose item is,
 * and the sheet ends with a grand total. Each of them carries a real quantity in
 * a real column, so loading the file as-is stored the month FOUR TIMES OVER —
 * 42,800 against a true 10,700.
 *
 * Matched on the whole cell, never on a substring: "Total Building Supply" is a
 * dealer, and a rule that caught it would lose their volume for good.
 */
const TOTAL_WORDS = new Set([
  "total",
  "totals",
  "grand total",
  "subtotal",
  "sub total",
  "sum",
  "all",
]);

export function isSubtotal(cells: readonly (string | undefined)[]): boolean {
  return cells.some(
    (c) => c !== undefined && TOTAL_WORDS.has(c.trim().toLowerCase()),
  );
}

/**
 * Inches per piece, read out of the item description.
 *
 * The trade names a board by its section and its length — 1X6-94" is a six-inch
 * board ninety-four inches long — so a piece count converts to feet exactly.
 * "RL" means random length, and those rows arrive in LF already because there is
 * no fixed length to multiply by.
 *
 * The LAST measurement wins. One item in the first real file reads
 * `1X71"-71"`, where the section carries a quote mark too; taking the first
 * would be reading the width as the length.
 */
export function inchesPerPiece(item: string): number | null {
  const all = [...item.matchAll(/(\d+)\s*"/g)];
  if (all.length === 0) return null;
  const n = Number(all[all.length - 1][1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A quantity in whatever unit the file used, as linear feet.
 *
 * Null when it cannot be known rather than a guess: a piece count with no length
 * to multiply by is not zero feet, it is an unanswered question, and the row has
 * to be surfaced instead of quietly rounded to nothing.
 */
export function toLinearFeet(
  quantity: number,
  unit: string,
  item: string,
): number | null {
  const u = unit.trim().toUpperCase();
  if (u === "" || u === "LF" || u === "FT" || u === "LNFT") return quantity;
  if (u === "PC" || u === "PCS" || u === "PIECE" || u === "PIECES" || u === "EA") {
    const inches = inchesPerPiece(item);
    return inches === null ? null : (quantity * inches) / 12;
  }
  // An inch or metre column would need its own arithmetic; saying so beats
  // pretending the number was already feet.
  return null;
}

export interface PlannedRow {
  /** Which branch of ours this row belongs to, once one exists. */
  branchId: string | null;
  /** Set when the branch is not one we hold yet — the admin decides. */
  newBranchName: string | null;
  branchCode: string | null;
  /** Null is not a failure: the volume loads and an admin maps it later. */
  dealerId: string | null;
  dealerLabel: string;
  product: string | null;
  /** Linear feet, always — converted if the file used something else. */
  quantity: number;
  /** What the file said, kept so the conversion can be checked later. Null when
   *  the file was already in LF and nothing was converted. */
  sourceQuantity: number | null;
  sourceUnit: string | null;
  value: number | null;
}

export interface ImportPlan {
  rows: readonly PlannedRow[];
  /** Lines with no usable quantity: blank spacers, a repeated header halfway
   *  down, a line that was never data. */
  skipped: number;
  /** Subtotal lines thrown away, counted separately because they are the
   *  difference between a right answer and one four times too big — and a person
   *  checking a load needs to see that they were found. */
  subtotals: number;
  /** Lines that bought something in the comparison period and nothing now. They
   *  cannot be stored (a zero is not a sale) but they are the most actionable
   *  thing in the file, so they are counted rather than dropped in silence. */
  lostBusiness: number;
  /** Rows whose unit could not be turned into linear feet. Their volume is
   *  unknown, not zero, so they are named rather than loaded as nothing. */
  unconvertible: readonly { label: string; quantity: number; unit: string }[];
  /** What the file's own quantity column added up to, in its own mixed units —
   *  the figure an admin can check against the bottom of their spreadsheet. */
  sourceQuantity: number;
  /** Branch names in the file that we hold no branch for, once each. The state
   *  is what lets the new yard find its region; null means nobody said, which is
   *  a question for the admin rather than a reason to guess. */
  newBranches: readonly {
    name: string;
    code: string | null;
    state: string | null;
  }[];
  /** Dealer names we could not match, once each, with what they add up to. */
  unmatched: readonly { label: string; quantity: number }[];
  quantity: number;
  value: number | null;
  matchedRows: number;
}

/**
 * Turn the pasted rows into what would be written, without writing anything.
 *
 * Everything a person needs to decide before committing a month comes out of
 * here: how much volume, how much of it lands on a dealer we know, which yards
 * we have never heard of, and how many lines were not data at all.
 */
export function buildImport(
  sheet: Sheet,
  mapping: Mapping,
  known: { branches: readonly KnownBranch[]; dealers: readonly KnownDealer[] },
): ImportPlan {
  const byCode = new Map<string, string>();
  const byBranchName = new Map<string, string>();
  for (const b of known.branches) {
    if (b.external_code) byCode.set(b.external_code.toLowerCase().trim(), b.id);
    byBranchName.set(normaliseName(b.name), b.id);
  }
  // Tokenised once, not once per row: a monthly file is thousands of lines and
  // a patch is hundreds of dealers.
  const dealerIndex = known.dealers.map((d) => {
    const norm = normaliseName(d.name);
    return { id: d.id, norm, tokens: norm.length > 0 ? norm.split(" ") : [] };
  });

  const at = (row: readonly string[], field: ImportField): string =>
    mapping[field] >= 0 ? (row[mapping[field]] ?? "") : "";

  const rows: PlannedRow[] = [];
  const newBranches = new Map<
    string,
    { name: string; code: string | null; state: string | null }
  >();
  const unmatched = new Map<string, { label: string; quantity: number }>();
  const unconvertible: { label: string; quantity: number; unit: string }[] = [];
  let skipped = 0;
  let subtotals = 0;
  let lostBusiness = 0;
  let quantity = 0;
  let sourceQuantity = 0;
  let value: number | null = null;
  let matchedRows = 0;

  for (const row of sheet.rows) {
    const dealerLabel = at(row, "dealer");
    const itemText = at(row, "product");

    // Subtotals FIRST, before anything is counted. They carry a real quantity in
    // a real column, so every test that follows would happily let them through.
    if (isSubtotal([dealerLabel, itemText, at(row, "branch")])) {
      subtotals += 1;
      continue;
    }

    const qty = parseNumber(at(row, "quantity"));
    if (qty === null || dealerLabel.length === 0) {
      skipped += 1;
      continue;
    }
    // Nothing this period. If the file also says what they took last time, this
    // is business lost rather than a line that was never data.
    if (qty === 0) {
      const before = parseNumber(at(row, "last_year"));
      if (before !== null && before > 0) lostBusiness += 1;
      else skipped += 1;
      continue;
    }

    const code = at(row, "branch_code");
    const branchName = at(row, "branch");
    const branchId =
      (code ? byCode.get(code.toLowerCase()) : undefined) ??
      (branchName ? byBranchName.get(normaliseName(branchName)) : undefined) ??
      null;

    if (branchId === null) {
      const label = branchName || code;
      if (label.length === 0) {
        // Nowhere to put it and nothing to call it: this is not a sales line.
        skipped += 1;
        continue;
      }
      const key = normaliseName(label);
      const found = newBranches.get(key);
      const state = branchState(at(row, "state"), label);
      if (!found) {
        newBranches.set(key, { name: label, code: code || null, state });
      } else if (found.state === null && state !== null) {
        // The same yard can appear a hundred times and be spelled with its state
        // only once. Taking the first mention would throw that away.
        found.state = state;
      }
    }

    const dealerId = matchDealer(dealerLabel, dealerIndex);

    // Into linear feet, which is the only unit anything downstream understands.
    const unit = at(row, "unit");
    const feet = toLinearFeet(qty, unit, itemText);
    if (feet === null) {
      unconvertible.push({ label: dealerLabel, quantity: qty, unit: unit || "?" });
      continue;
    }

    const rowValue = parseNumber(at(row, "value"));
    if (rowValue !== null) value = (value ?? 0) + rowValue;
    quantity += feet;
    sourceQuantity += qty;

    if (dealerId !== null) matchedRows += 1;
    else {
      const key = normaliseName(dealerLabel);
      const seen = unmatched.get(key);
      if (seen) seen.quantity += feet;
      else unmatched.set(key, { label: dealerLabel, quantity: feet });
    }

    const converted = feet !== qty;
    rows.push({
      branchId,
      newBranchName: branchId === null ? branchName || code : null,
      branchCode: code || null,
      dealerId,
      dealerLabel,
      product: itemText.length > 0 ? itemText : null,
      quantity: feet,
      sourceQuantity: converted ? qty : null,
      sourceUnit: converted ? unit || null : null,
      value: rowValue,
    });
  }

  return {
    rows,
    skipped,
    subtotals,
    lostBusiness,
    unconvertible,
    sourceQuantity,
    newBranches: [...newBranches.values()],
    unmatched: [...unmatched.values()].sort((a, b) => b.quantity - a.quantity),
    quantity,
    value,
    matchedRows,
  };
}

/** Nothing can be written until the file says, at minimum, who bought how much. */
export function mappingProblem(mapping: Mapping): string | null {
  if (mapping.quantity < 0) return "Say which column holds the quantity.";
  if (mapping.dealer < 0) return "Say which column holds the dealer.";
  if (mapping.branch < 0 && mapping.branch_code < 0) {
    return "Say which column holds the branch, or its code.";
  }
  return null;
}

/** First of the month, which is the only day a period is ever stored as. */
export function periodOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
