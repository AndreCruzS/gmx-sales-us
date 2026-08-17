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
  | "dealer"
  | "product"
  | "quantity"
  | "value";

/** Which column of the pasted sheet holds which field. -1 means "not present". */
export type Mapping = Record<ImportField, number>;

export const EMPTY_MAPPING: Mapping = {
  branch: -1,
  branch_code: -1,
  dealer: -1,
  product: -1,
  quantity: -1,
  value: -1,
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
  dealer: ["customer", "dealer", "sold to", "account", "ship to", "buyer"],
  product: ["product", "item", "sku", "description", "material"],
  quantity: ["qty", "quantity", "lf", "linear", "volume", "feet", "units"],
  value: ["value", "sales", "amount", "revenue", "extended", "$", "net"],
};

export function guessMapping(headers: readonly string[]): Mapping {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const taken = new Set<number>();
  const guess = { ...EMPTY_MAPPING };

  // Most specific first: "branch code" must not be eaten by "branch", and
  // "customer" must not be eaten by a column merely containing "code".
  const order: ImportField[] = [
    "branch_code",
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
    // "#4471", "- 4471" and "(4471)" are store numbers, not part of the name.
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
  quantity: number;
  value: number | null;
}

export interface ImportPlan {
  rows: readonly PlannedRow[];
  /** Rows the file had that carry no usable quantity, and are therefore noise:
   *  subtotal lines, blank spacers, a repeated header halfway down. */
  skipped: number;
  /** Branch names in the file that we hold no branch for, once each. */
  newBranches: readonly { name: string; code: string | null }[];
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
  const newBranches = new Map<string, { name: string; code: string | null }>();
  const unmatched = new Map<string, { label: string; quantity: number }>();
  let skipped = 0;
  let quantity = 0;
  let value: number | null = null;
  let matchedRows = 0;

  for (const row of sheet.rows) {
    const qty = parseNumber(at(row, "quantity"));
    const dealerLabel = at(row, "dealer");
    // No quantity, or no name to hang it on, and it is not a sales line. A
    // spreadsheet is full of these and none of them belong in the book.
    if (qty === null || qty === 0 || dealerLabel.length === 0) {
      skipped += 1;
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
      if (!newBranches.has(key)) {
        newBranches.set(key, { name: label, code: code || null });
      }
    }

    const dealerId = matchDealer(dealerLabel, dealerIndex);
    if (dealerId !== null) matchedRows += 1;
    else {
      const key = normaliseName(dealerLabel);
      const seen = unmatched.get(key);
      if (seen) seen.quantity += qty;
      else unmatched.set(key, { label: dealerLabel, quantity: qty });
    }

    const rowValue = parseNumber(at(row, "value"));
    if (rowValue !== null) value = (value ?? 0) + rowValue;
    quantity += qty;

    const product = at(row, "product");
    rows.push({
      branchId,
      newBranchName: branchId === null ? branchName || code : null,
      branchCode: code || null,
      dealerId,
      dealerLabel,
      product: product.length > 0 ? product : null,
      quantity: qty,
      value: rowValue,
    });
  }

  return {
    rows,
    skipped,
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
