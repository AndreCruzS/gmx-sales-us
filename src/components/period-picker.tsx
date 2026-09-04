"use client";

// The period, picked the way a booking site picks dates (Andre, 2026-09-04)
// — but in MONTHS, never days: a year header with ‹ › arrows over a twelve-
// month grid. One click reads a single month; a second click on another
// month stretches the two into a RANGE, booking-style. A dot marks the
// months whose sell-through return is on file, so the missing paper is
// visible right here. The footer holds the two windows that are not months:
// the year to date, and "Before Jun 2026" — the sparse backfill era, kept
// out of the grid on purpose.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { ORDERS_CONSISTENT_FROM } from "@/lib/domain/order-volume";

/** A window over the books. `ym` strings are "YYYY-MM". */
export type SalesPeriod =
  | { kind: "month"; ym: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "year" }
  | { kind: "before" };

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function ymOf(year: number, monthIdx: number): string {
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
}

export function shortMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS_SHORT[Number(m) - 1]} ${y}`;
}

export function periodChipLabel(period: SalesPeriod | null, fallback: string): string {
  if (!period || period.kind === "month")
    return period ? shortMonthLabel(period.ym) : fallback;
  if (period.kind === "range") {
    const [fy] = period.from.split("-");
    const [ty] = period.to.split("-");
    const from =
      fy === ty ? MONTHS_SHORT[Number(period.from.split("-")[1]) - 1] : shortMonthLabel(period.from);
    return `${from} – ${shortMonthLabel(period.to)}`;
  }
  if (period.kind === "year") return "Year to date";
  return `Before ${shortMonthLabel(ORDERS_CONSISTENT_FROM)}`;
}

export function PeriodPicker({
  period,
  defaultYm,
  monthsWithReturn,
  hasYear,
  onChange,
}: {
  /** null means "the newest month with a return" — the page's default. */
  period: SalesPeriod | null;
  /** The ym that null resolves to, for showing the selection in the grid. */
  defaultYm: string | null;
  monthsWithReturn: ReadonlySet<string>;
  hasYear: boolean;
  onChange: (period: SalesPeriod) => void;
}) {
  const [open, setOpen] = useState(false);
  const nowYm = ymOf(new Date().getFullYear(), new Date().getMonth());
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  // Booking-style: the first click holds the start; a second click on a
  // LATER month completes the range, any other click starts over.
  const [pending, setPending] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPending(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const minYear = Number(ORDERS_CONSISTENT_FROM.slice(0, 4));
  const maxYear = new Date().getFullYear();

  const selected = period ?? (defaultYm ? { kind: "month" as const, ym: defaultYm } : null);
  const inSelection = (ym: string): "end" | "mid" | null => {
    if (pending) return ym === pending ? "end" : null;
    if (!selected) return null;
    if (selected.kind === "month") return ym === selected.ym ? "end" : null;
    if (selected.kind === "range") {
      if (ym === selected.from || ym === selected.to) return "end";
      return ym > selected.from && ym < selected.to ? "mid" : null;
    }
    return null;
  };

  const pickMonth = (ym: string) => {
    if (pending && ym > pending) {
      onChange({ kind: "range", from: pending, to: ym });
      close();
      return;
    }
    // First click (or a click at/before the pending start): a single month,
    // applied at once — and held as the start of a possible range.
    onChange({ kind: "month", ym });
    setPending(ym);
  };

  return (
    <div className="ppick" ref={rootRef}>
      <button
        type="button"
        className="chip"
        aria-pressed="true"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {periodChipLabel(period, defaultYm ? shortMonthLabel(defaultYm) : "Period")}
        <ChevronDownIcon size={11} aria-hidden="true" />
      </button>

      {open && (
        <div className="ppick-panel" role="dialog" aria-label="Pick a period">
          <div className="ppick-head">
            <button
              type="button"
              className="btn-quiet"
              aria-label="Previous year"
              disabled={viewYear <= minYear}
              onClick={() => setViewYear((y) => Math.max(minYear, y - 1))}
            >
              ‹
            </button>
            <span className="ppick-year fig-sm">{viewYear}</span>
            <button
              type="button"
              className="btn-quiet"
              aria-label="Next year"
              disabled={viewYear >= maxYear}
              onClick={() => setViewYear((y) => Math.min(maxYear, y + 1))}
            >
              ›
            </button>
          </div>

          <div className="ppick-grid">
            {MONTHS_SHORT.map((name, i) => {
              const ym = ymOf(viewYear, i);
              const disabled = ym < ORDERS_CONSISTENT_FROM || ym > nowYm;
              const sel = inSelection(ym);
              return (
                <button
                  key={ym}
                  type="button"
                  className="ppick-month"
                  disabled={disabled}
                  data-sel={sel ?? undefined}
                  onClick={() => pickMonth(ym)}
                >
                  {name}
                  {monthsWithReturn.has(ym) && (
                    <i className="ppick-dot" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>

          <p className="ppick-hint t-hint">
            One click reads a month; a second stretches it into a period.
            A <i className="ppick-dot" aria-hidden="true" /> marks a return
            on file.
          </p>

          {/* "Before Jun 2026" retired from here (Andre, 2026-09-04) — the
              sparse backfill era earns no chip for now; the `before` kind
              stays in the type should it come back. */}
          {hasYear && (
            <div className="ppick-foot">
              <button
                type="button"
                className="chip"
                aria-pressed={period?.kind === "year"}
                onClick={() => {
                  onChange({ kind: "year" });
                  close();
                }}
              >
                Year to date
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
