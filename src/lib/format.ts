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
