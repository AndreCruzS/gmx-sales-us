"use client";

// The quote survey: WHAT and HOW MUCH, in the product's own terms.
//
// A quote here carries no price on purpose — pricing happens in Spruce, and
// the catalog view does not even have the column. What the rep produces on
// the counter is the SURVEY: products (thermo first), quantities, and the one
// figure the rest of this system speaks — linear feet. Typed in LF it goes
// straight in; typed in pieces it converts on the spot through the catalog's
// own lf_per_piece, and the line shows both so the conversion can be checked
// at a glance, the same source/converted honesty the sell-through loader keeps.
//
// The search talks to /api/catalog/search — the server-side door to the
// external catalog — and degrades honestly: "not connected yet" is a state,
// not an empty result.

import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "@/components/icons";

export interface QuoteLine {
  sku: string;
  /** Random length: ordered in LF, always — pieces make no sense here. */
  randomLength?: boolean;
  description: string;
  species: string | null;
  profile: string | null;
  nominal_size: string | null;
  lfPerPiece: number | null;
  /** As typed — the input is the fact, the LF is the derivation. */
  qtyInput: string;
  inputUom: "LF" | "PC";
}

interface SearchItem {
  sku: string;
  randomLength: boolean;
  description: string;
  species: string | null;
  profile: string | null;
  nominal_size: string | null;
  lf_per_piece: number | null;
  piecesAvailable: number;
  branches: number;
  thermo: boolean;
}

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const LF1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function lineLf(l: QuoteLine): number {
  const q = Number(l.qtyInput);
  if (!Number.isFinite(q) || q <= 0) return 0;
  if (l.inputUom === "LF") return q;
  return l.lfPerPiece ? q * l.lfPerPiece : 0;
}

export function QuoteItemsEditor({
  value,
  onChange,
}: {
  value: readonly QuoteLine[];
  onChange: (next: QuoteLine[]) => void;
}) {
  const [query, setQuery] = useState("");
  // The search is the ADD path. With no lines yet it stands open; once the
  // survey has lines it folds behind an explicit "add another product", so a
  // finished list reads as a list and not as a form still asking questions.
  const [adding, setAdding] = useState(false);
  const [results, setResults] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [connected, setConnected] = useState(true);
  const [stockStale, setStockStale] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A typeahead, debounced: the catalog answers in ~10ms, the wire does not.
  // Every setState lives INSIDE the timeout — a state write synchronous in
  // the effect body is a cascading render the compiler rightly refuses.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    timer.current = setTimeout(async () => {
      if (q.length < 2) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`);
        if (res.status === 503) {
          setConnected(false);
          setResults([]);
          return;
        }
        const body = (await res.json()) as {
          items: SearchItem[];
          stockStale?: boolean;
        };
        setConnected(true);
        setStockStale(Boolean(body.stockStale));
        setResults(body.items ?? []);
      } catch {
        // No signal: the survey can still be edited, only the search is mute.
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const add = (p: SearchItem) => {
    onChange([
      ...value,
      {
        sku: p.sku,
        description: p.description,
        species: p.species,
        profile: p.profile,
        nominal_size: p.nominal_size,
        lfPerPiece: p.randomLength ? null : p.lf_per_piece,
        randomLength: p.randomLength,
        qtyInput: "",
        // Pieces is how a counter talks when the product has a length; LF is
        // the fallback for anything the catalog cannot convert — and the ONLY
        // language of a random-length order.
        inputUom: !p.randomLength && p.lf_per_piece ? "PC" : "LF",
      },
    ]);
    setQuery("");
    setResults([]);
    setAdding(false);
  };

  const patch = (i: number, part: Partial<QuoteLine>) =>
    onChange(value.map((l, j) => (j === i ? { ...l, ...part } : l)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  const total = value.reduce((n, l) => n + lineLf(l), 0);

  return (
    <div className="flex flex-col gap-2">
      <span className="t-hint">
        Products — what they want, thermo first. The maths answers in LF.
      </span>

      {value.length > 0 && (
        <ul className="list">
          {value.map((l, i) => {
            const lf = lineLf(l);
            const pcWithoutLength = l.inputUom === "PC" && !l.lfPerPiece;
            return (
              <li key={`${l.sku}-${i}`} className="qline">
                <div className="qline-head">
                  <span className="qline-name">{l.description}</span>
                  <button
                    type="button"
                    className="qline-remove"
                    aria-label={`Remove ${l.description}`}
                    onClick={() => remove(i)}
                  >
                    &times;
                  </button>
                </div>
                <span className="t-hint">
                  {[
                    l.species,
                    l.nominal_size,
                    l.randomLength
                      ? "random length"
                      : l.lfPerPiece
                        ? `${LF1.format(l.lfPerPiece)} LF/pc`
                        : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <div className="qline-qty">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    className="field qline-input"
                    value={l.qtyInput}
                    placeholder="0"
                    aria-label={`Quantity of ${l.description}`}
                    onChange={(e) => patch(i, { qtyInput: e.target.value })}
                  />
                  <div className="chip-row" role="group" aria-label="Unit">
                    {(["PC", "LF"] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        className="chip chip-sm"
                        aria-pressed={l.inputUom === u}
                        disabled={u === "PC" && (!l.lfPerPiece || l.randomLength)}
                        onClick={() => patch(i, { inputUom: u })}
                      >
                        {u === "PC" ? "pieces" : "LF"}
                      </button>
                    ))}
                  </div>
                  {/* The answer, beside the question — 36 pc = 282 LF. */}
                  <span className="fig fig-md qline-lf">
                    {l.inputUom === "PC" ? `= ${QTY.format(lf)} LF` : `${QTY.format(lf)} LF`}
                  </span>
                </div>
                {pcWithoutLength && (
                  <span className="t-hint" style={{ color: "var(--warn-ink)" }}>
                    This item has no length in the catalog — enter it in LF.
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {value.length > 0 && (
        <p className="qtotal">
          <span className="t-hint">Quote total</span>
          <span className="fig fig-lg">{QTY.format(total)} LF</span>
        </p>
      )}

      {value.length > 0 && !adding && (
        <button
          type="button"
          className="btn-quiet qadd"
          onClick={() => setAdding(true)}
        >
          + Add another product
        </button>
      )}

      {(value.length === 0 || adding) && (
        <label className="search-field">
          <SearchIcon size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a product — e.g. thermo 1x6…"
            type="search"
            enterKeyHint="search"
            aria-label="Find a product"
            autoFocus={adding}
          />
        </label>
      )}

      {!connected && (
        <p className="t-hint" style={{ color: "var(--warn-ink)" }}>
          The product catalog isn&rsquo;t connected yet — the reader key is
          missing on the server. Lines can be added once it lands.
        </p>
      )}
      {searching && <p className="t-hint">Searching…</p>}
      {results.length > 0 && (
        <ul className="list">
          {results.map((p) => (
            <li key={p.sku}>
              <button type="button" className="row" onClick={() => add(p)}>
                <span className="row-body">
                  <span className="qresult-name">
                    {p.description}
                  </span>
                  <span className="t-hint">
                    {[
                      p.thermo ? "Thermo" : p.species,
                      p.nominal_size,
                      p.randomLength
                        ? "random length · quoted in LF"
                        : p.lf_per_piece
                          ? `${LF1.format(p.lf_per_piece)} LF/pc`
                          : null,
                      p.randomLength
                        ? null
                        : p.piecesAvailable > 0
                          ? `${QTY.format(p.piecesAvailable)} pc across ${p.branches} ${p.branches === 1 ? "branch" : "branches"}`
                          : "none available",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {stockStale && results.length > 0 && (
        <p className="t-hint">
          Availability may be out of date — the stock feed hasn&rsquo;t
          refreshed in over two hours.
        </p>
      )}
    </div>
  );
}
