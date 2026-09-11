"use client";

// A list of dealers with their LF, searched by name and read a page at a time.
//
// A scrolling box inside a card is a coarse thing (Andre, 2026-09-09: "essa
// barra tá bem grosseira") — the list keeps a fixed height, the names beyond
// it exist only behind a scrollbar, and the eye never knows how many there
// are. Paging says it plainly: "1–8 of 14", previous, next. The desk reads
// eight a page, the phone three — the same break the desk book uses, so a
// screen is one thing or the other, never a mix.
//
// PAGING ALONE STOPPED BEING ENOUGH (Andre, 2026-09-10). August carries 86
// names in one month and only three of them are accounts of ours — the rest
// are labels straight off the distributors' files, waiting for somebody to say
// who they are. Eighty-six names at eight a page is eleven turns of the arrow
// to answer "did Ganahl come back", and it grows with every month loaded. So
// the list is searched: type three letters and it narrows.
//
// It narrows IN PLACE rather than dropping a menu over the card. A popover
// inside these cells would be clipped by the card that holds them — the trap
// this codebase has already been bitten by — and a filtered list answers the
// real question better anyway, because it keeps each name's LF beside it. What
// you type is matched against the name with its punctuation folded away, so
// "cj redwood" finds "C. J. REDWOOD, INC." and "84 lumber" finds
// "84L8820 - 84 LUMBER COMPANY", which is how these names actually arrive.
//
// The field only appears once the list runs past a single page. A search box
// over four names is furniture.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { foldForSearch, searchDealers } from "@/lib/domain/sell-through";
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

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const needle = foldForSearch(query);
  // searchDealers hands back the SAME array for an empty term, so this settles
  // to the untouched list without a copy while nobody is typing.
  const shown = useMemo(() => searchDealers(dealers, query), [dealers, query]);

  const pages = Math.max(1, Math.ceil(shown.length / size));
  // A list that shrank under the reader — the region pick changed, or they
  // typed another letter — must not leave the page pointing past its end.
  const at = Math.min(page, pages - 1);
  const from = at * size;
  const slice = shown.slice(from, from + size);

  // Nothing to show and nothing to search: the cell says its count and stops.
  if (dealers.length === 0) return null;

  // Only worth a field once the arrows would be doing real work.
  const searchable = dealers.length > size;

  return (
    <>
      {searchable && (
        <label className="search-field recur-search">
          <input
            type="search"
            placeholder="Find a dealer"
            value={query}
            enterKeyHint="search"
            autoComplete="off"
            aria-label="Find a dealer in this list"
            onChange={(e) => {
              setQuery(e.target.value);
              // A new term starts at its own first page, never halfway down
              // the last one.
              setPage(0);
            }}
          />
        </label>
      )}

      {slice.length === 0 ? (
        // A search that found nobody says so. An empty list under a filled
        // field reads as a loading bug.
        <p className="recur-empty t-hint" aria-live="polite">
          No name here matches “{query.trim()}”
        </p>
      ) : (
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
      )}

      {(pages > 1 || needle.length > 0) && (
        <div className="recur-pager">
          {/* While searching, the count is the answer — "3 of 86 names" —
              rather than a position in a list nobody is walking through. */}
          <span className="t-hint" aria-live="polite">
            {needle.length > 0
              ? `${QTY.format(shown.length)} of ${QTY.format(dealers.length)}`
              : `${from + 1}–${Math.min(from + size, shown.length)} of ${shown.length}`}
          </span>
          {pages > 1 && (
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
          )}
        </div>
      )}
    </>
  );
}
