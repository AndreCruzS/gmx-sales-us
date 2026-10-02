"use client";

// THE PAGER, AND WHERE IT SITS (Andre, 2026-10-02).
//
// Every list inside a card on this app is read a page at a time rather than
// through a scrollbar — "essa barra tá bem grosseira" (2026-09-09): a scrolling
// box hides how many there are, and the eye never learns the size of the thing
// it is reading. A pager says it plainly: "1–8 of 14", previous, next.
//
// What was missing is WHERE the arrows sit. Left in the flow they ride up and
// down with the number of rows, so two lists side by side put their arrows at
// two different heights and the card looks broken when one chapter is shorter
// than the other. The arrows belong on the FLOOR of the widget: `margin-top:
// auto` inside a flex column, with the cells stretched to a common height.
//
// THIS IS THE RULE FOR EVERY LIST THAT FOLLOWS. A new list in a card gets this
// component, not its own arrows: same count on the left, same two buttons on
// the right, same floor. The page SIZE is the caller's business — a row three
// lines tall does not fit eight of itself on a phone — but the shape is not.

import { useEffect, useMemo, useState } from "react";

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * How many rows fit, by viewport. The 1280 break is the desk break the whole
 * app reads, so a screen is one thing or the other and never a mix.
 */
export function usePageSize(desk: number, phone: number): number {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide ? desk : phone;
}

/**
 * The slice of a list the reader is on, and the state to move it.
 *
 * `page` is clamped on read, never on write: a list that shrank under the
 * reader — they typed another letter, or the region filter changed — must not
 * leave the pager pointing past the end and the card empty.
 */
export function usePaged<T>(rows: readonly T[], size: number) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(page, pages - 1);
  const from = at * size;
  const slice = useMemo(() => rows.slice(from, from + size), [rows, from, size]);
  return { slice, page: at, pages, from, setPage, total: rows.length };
}

export function Pager({
  page,
  pages,
  from,
  shown,
  total,
  /** Overrides the "1–8 of 14" count, for a list that is being searched. */
  status,
  onPage,
  /** A caller's own trim — a rule above it, a tighter margin. The shape and
   *  the floor stay the component's business. */
  className,
}: {
  page: number;
  pages: number;
  from: number;
  /** How many rows are on this page. */
  shown: number;
  total: number;
  status?: string;
  onPage: (next: number) => void;
  className?: string;
}) {
  return (
    <div className={className ? `pager ${className}` : "pager"}>
      <span className="t-hint" aria-live="polite">
        {status ?? `${from + 1}–${QTY.format(from + shown)} of ${QTY.format(total)}`}
      </span>
      {pages > 1 && (
        <span className="pager-btns">
          <button
            type="button"
            className="pager-btn"
            onClick={() => onPage(Math.max(0, page - 1))}
            disabled={page === 0}
            aria-label="Previous page"
          >
            ‹
          </button>
          <button
            type="button"
            className="pager-btn"
            onClick={() => onPage(Math.min(pages - 1, page + 1))}
            disabled={page >= pages - 1}
            aria-label="Next page"
          >
            ›
          </button>
        </span>
      )}
    </div>
  );
}
