"use client";

// A list of dealers with their LF, read a page at a time.
//
// A scrolling box inside a card is a coarse thing (Andre, 2026-09-09: "essa
// barra tá bem grosseira") — the list keeps a fixed height, the names beyond
// it exist only behind a scrollbar, and the eye never knows how many there
// are. Paging says it plainly: "1–8 of 14", previous, next. The desk reads
// eight a page, the phone three — the same break the desk book uses, so a
// screen is one thing or the other, never a mix.

import Link from "next/link";
import { useEffect, useState } from "react";
import type { RecurrenceDealer } from "@/lib/domain/sell-through";

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function PagedNames({ dealers }: { dealers: readonly RecurrenceDealer[] }) {
  const [desk, setDesk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const on = () => setDesk(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const size = desk ? 8 : 3;
  const pages = Math.max(1, Math.ceil(dealers.length / size));
  const [page, setPage] = useState(0);
  // A list that shrank under the reader (the region pick changed) must not
  // leave the page pointing past its end.
  const at = Math.min(page, pages - 1);
  const from = at * size;
  const slice = dealers.slice(from, from + size);
  if (dealers.length === 0) return null;
  return (
    <>
      <ul className="recur-names">
        {slice.map((d) => (
          <li key={d.key} className="recur-name">
            {d.accountId ? (
              <Link href={`/accounts/${d.accountId}`} className="recur-name-link">
                {d.name}
              </Link>
            ) : (
              <span className="recur-name-text">{d.name}</span>
            )}
            <span className="fig-sm recur-name-lf">{QTY.format(Math.round(d.lf))}</span>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <div className="recur-pager">
          <span className="t-hint">
            {from + 1}–{Math.min(from + size, dealers.length)} of {dealers.length}
          </span>
          <span className="recur-pager-btns">
            <button
              type="button"
              className="recur-pager-btn"
              onClick={() => setPage(Math.max(0, at - 1))}
              disabled={at === 0}
              aria-label="Previous page"
            >
              ‹
            </button>
            <button
              type="button"
              className="recur-pager-btn"
              onClick={() => setPage(Math.min(pages - 1, at + 1))}
              disabled={at >= pages - 1}
              aria-label="Next page"
            >
              ›
            </button>
          </span>
        </div>
      )}
    </>
  );
}
