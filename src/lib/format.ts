// Human formatting for values the database stores in machine shape. A rep
// reads "due today" and taps a phone number; nobody reads "2026-07-27" or
// dials "+17145550101" by eye.

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function dayDiff(iso: string): number | null {
  // date-only strings compare in local time; timestamps in their own zone
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  return Math.round((a - b) / 86_400_000);
}

/** "today" · "tomorrow" · "yesterday" · "3 days ago" · "in 5 days" · "Aug 3". */
export function formatDay(iso: string): string {
  const diff = dayDiff(iso);
  if (diff === null) return iso;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff < 0 && diff >= -6) return `${-diff} days ago`;
  if (diff > 0 && diff <= 6) return `in ${diff} days`;
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.getFullYear() === new Date().getFullYear()
    ? MONTH_DAY.format(d)
    : MONTH_DAY_YEAR.format(d);
}

/** Rewrites ISO dates inside server-built sentences ("due 2026-07-27"). */
export function relativizeDates(text: string): string {
  return text.replace(/\d{4}-\d{2}-\d{2}/g, (m) => formatDay(m));
}

/** +17145550101 / 17145550101 / 7145550101 → (714) 555-0101; others verbatim. */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const ten =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** tel: target — digits and leading + only. */
export function telHref(raw: string): string {
  return `tel:${raw.replace(/[^\d+]/g, "")}`;
}

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * $180,000 — whole dollars, because a quote list is read down a column and
 * cents are noise at that distance. Null is "—", never "$0": a deal with no
 * number on it yet is not a deal worth nothing.
 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return MONEY.format(value);
}

/** SHOUTED names (straight off a business card) read as data, not identity. */
export function displayAccountName(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 4 || name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * A DEALER'S NAME AS A PERSON SAYS IT (Bianca, matching sheet 2026-09-28: the
 * names should read plainly and the codes belong to the machine).
 *
 * A distributor's file writes its own customer number into the name —
 * "LEEROJDA - LEE ROY JORDAN REDWOOD LUMBER", "CASJOLLO - CASSITY JONES LBR &
 * BLDG MTLS" — and shouts the rest in capitals with the trade's abbreviations.
 * On screen that is noise: nobody calls a yard by the distributor's code for
 * it. So the code comes off, the abbreviations are spelled out, and the name is
 * cased like a name.
 *
 * The raw label is NOT thrown away: it stays on the row, it is what an alias
 * matches on, and it is shown where it is the point — the dealer module's "as
 * Boise writes it" line and the upload screen.
 *
 * Only a leading CODE followed by " - " is removed. "INTERSTATE & LAKELAND
 * LUMBER - NEWTOWN" keeps its yard, because that part is the name.
 */
const TRADE_WORDS: Record<string, string> = {
  lbr: "Lumber",
  lmbr: "Lumber",
  bldg: "Building",
  bldgs: "Buildings",
  mtls: "Materials",
  mtl: "Material",
  hdw: "Hardware",
  hdwe: "Hardware",
  sply: "Supply",
  sup: "Supply",
  mfg: "Manufacturing",
  bldrs: "Builders",
  whse: "Warehouse",
  dist: "Distribution",
  prods: "Products",
  prod: "Products",
};
/**
 * Words that are said as letters, so they stay in capitals. The company ones
 * are here because the vowel test below cannot reach them: "ABC" and "JBI"
 * carry a vowel and would come back as "Abc Supply" and "Jbi LLC", which is
 * how nobody says either.
 */
const SPOKEN_AS_LETTERS = new Set([
  "llc",
  "lp",
  "usa",
  "us",
  "inc",
  "co",
  "ltd",
  "abc",
  "jbi",
]);
/** Small words a name does not shout: "Integro Windows and Doors". */
const JOINERS = new Set(["and", "of", "the", "for"]);

export function displayDealerLabel(label: string): string {
  // A CODE, not a name: Boise and Hardwoods write their customer number first
  // ("LUMMEWA - LUMBERMENS MERCHANDISING", "DGL8844 - DG LUMBER GROUP"), while
  // Russin writes "COMPANY - YARD" ("TAGUE - PHILADELPHIA", "LIBERTY CEDAR -
  // W. KINGSTON"). So a first token is only a code when it carries a digit, or
  // when what follows is a name of two words or more — otherwise "Tague" would
  // be thrown away and the yard left standing alone.
  const parts = label.match(/^\s*([A-Z0-9][A-Z0-9.]*)\s+-\s+(.+)$/);
  const looksLikeCode =
    parts !== null &&
    (/\d/.test(parts[1]) || parts[2].trim().split(/\s+/).length >= 2);
  // A column that ran out of room leaves the name hanging on its conjunction:
  // "CAS3100 - CASTLE ROCK DOORS MOULDINGS &". The tail is the file's problem,
  // not a part of the name.
  const withoutCode = (looksLikeCode ? parts![2] : label).trim().replace(/[\s,&-]+$/, "");
  // A file that SHOUTS gets cased like a name; one that does not is left as it
  // is — somebody wrote it that way on purpose.
  const shouting = withoutCode === withoutCode.toUpperCase();
  const words = withoutCode.split(/\s+/).map((raw, i) => {
    const bare = raw.replace(/[^a-zA-Z]/g, "").toLowerCase();
    const tail = raw.replace(/[a-zA-Z]/g, "");
    if (TRADE_WORDS[bare]) return TRADE_WORDS[bare] + tail;
    if (SPOKEN_AS_LETTERS.has(bare)) {
      // "Inc", "Co" and "Ltd" read as words; "LLC", "LP" and "USA" do not.
      const asWord = bare === "inc" || bare === "co" || bare === "ltd";
      return (asWord ? bare[0].toUpperCase() + bare.slice(1) : bare.toUpperCase()) + tail;
    }
    if (!shouting || bare.length === 0) return raw;
    // Initials, each with its own dot: "C.A. NIECE CO INC" is C.A. Niece, not
    // "C.a.". The letters are the name.
    if (/^([A-Za-z]\.)+$/.test(raw)) return raw.toUpperCase();
    // A short word with no vowel is an initialism ("LKL", "CJ", "BMC"), and
    // lower-casing it would read as a typo.
    if (bare.length <= 4 && !/[aeiouy]/.test(bare)) return raw.toUpperCase();
    // A joining word stays small — but not when it opens the name.
    if (i > 0 && JOINERS.has(bare)) return bare + tail;
    // Each side of a hyphen or a slash is its own name: "OWEN-ADAMS" is
    // Owen-Adams, "CONCORD/LITTLETON" is Concord/Littleton.
    return raw
      .toLowerCase()
      .split(/([-/])/)
      .map((part) =>
        /^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part,
      )
      .join("");
  });
  return words.join(" ");
}

/**
 * The single letter that stands for a person in their own avatar.
 *
 * It used to take the first two CHARACTERS of the name, which is not the same
 * thing as initials and looked it: "Bianca Admin" came out as "BI", a word
 * fragment rather than a monogram. Two letters earn their place in a LIST, where
 * they tell one row from the next — an accounts list of Ganahl yards would be all
 * "G" and useless. An avatar in a header has nothing to differentiate from: there
 * is one person on that screen and they already know who they are.
 *
 * Iterated as code points, not indexed as UTF-16. name[0] on a name beginning
 * with an astral character returns half a surrogate pair and renders as a
 * replacement glyph — rare, and a person's own name is the worst place for it.
 */
export function avatarLetter(name: string): string {
  for (const ch of name.trim()) {
    // Skip anything that is not a letter, so a quoted or bracketed name gives the
    // letter a reader would expect rather than the punctuation in front of it.
    if (/\p{L}|\p{N}/u.test(ch)) return ch.toLocaleUpperCase();
  }
  return "?";
}
