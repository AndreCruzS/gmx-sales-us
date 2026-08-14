"use client";

// What each rep is selling, and to whom.
//
// The bar on a manager's home is SALES, not visits — leadership were explicit,
// and they are right: a week of kept promises is how a rep works, but volume
// through a door is what the business is. So one bar per rep, banded by
// customer, in the linear feet the trade quotes in.
//
// Tapping a band does not leave the page. The band grows to own the bar while
// the rest fold away, and that dealer's detail opens underneath — the numbers
// we already hold appear at once, and the visits behind them load into the
// space the animation just made. Nobody loses their place to read one number.

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { displayAccountName, formatMoney } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface DealerSalesRow {
  owner_id: string;
  dealer_id: string;
  dealer_name: string;
  unit: string;
  won_qty: number;
  out_qty: number;
  open_qty: number;
  won_value: number;
}

interface VisitRow {
  id: string;
  occurred_at: string;
  activity_type: string;
  what_happened: string | null;
}

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

// Six is the practical limit for bands a person can tell apart on a phone; the
// tail is gathered rather than given colours nobody can distinguish.
const BAND_COLOURS = [
  "var(--cat-1)",
  "var(--cat-2)",
  "var(--cat-3)",
  "var(--cat-4)",
  "var(--cat-5)",
  "var(--cat-6)",
];
const MAX_BANDS = 6;

interface Band {
  id: string;
  name: string;
  qty: number;
  colour: string;
  row: DealerSalesRow | null;
}

export function TeamSales({
  rows,
  repMeta,
}: {
  rows: readonly DealerSalesRow[];
  repMeta: ReadonlyMap<string, { name: string; patch: string }>;
}) {
  // One selection across the whole section: two reps' bars both blown open at
  // once would be two conversations on one screen.
  const [picked, setPicked] = useState<{ owner: string; dealer: string } | null>(
    null,
  );
  const [visits, setVisits] = useState<VisitRow[] | null>(null);

  const teams = useMemo(() => {
    const byOwner = new Map<string, DealerSalesRow[]>();
    for (const r of rows) {
      if (Number(r.won_qty) <= 0) continue;
      const list = byOwner.get(r.owner_id) ?? [];
      list.push(r);
      byOwner.set(r.owner_id, list);
    }
    return [...byOwner.entries()]
      .map(([owner, list]) => {
        const sorted = [...list].sort(
          (a, b) => Number(b.won_qty) - Number(a.won_qty),
        );
        const head = sorted.slice(0, MAX_BANDS);
        const tail = sorted.slice(MAX_BANDS);
        const bands: Band[] = head.map((r, i) => ({
          id: r.dealer_id,
          name: displayAccountName(r.dealer_name),
          qty: Number(r.won_qty),
          colour: BAND_COLOURS[i],
          row: r,
        }));
        if (tail.length > 0) {
          bands.push({
            id: "rest",
            name: `${tail.length} more`,
            qty: tail.reduce((n, r) => n + Number(r.won_qty), 0),
            colour: "var(--cat-rest)",
            row: null,
          });
        }
        return {
          owner,
          meta: repMeta.get(owner),
          bands,
          total: bands.reduce((n, b) => n + b.qty, 0),
          unit: sorted[0]?.unit ?? "LF",
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [rows, repMeta]);

  // The visits behind the number, fetched into the space the animation makes.
  const loadVisits = useCallback(async (dealerId: string) => {
    try {
      const { data, error } = await getSupabaseBrowserClient()
        .from("activities")
        .select("id, occurred_at, activity_type, what_happened")
        .eq("primary_account_id", dealerId)
        .order("occurred_at", { ascending: false })
        .limit(4);
      setVisits(error ? [] : ((data as VisitRow[]) ?? []));
    } catch {
      // no signal — the numbers above are already on screen and still true
      setVisits([]);
    }
  }, []);

  // Driven by the tap, not by an effect watching state: the fetch is caused by
  // the person, and a render is not the place to start one.
  function toggle(owner: string, dealer: string) {
    const closing =
      picked !== null && picked.owner === owner && picked.dealer === dealer;
    setVisits(null);
    if (closing) {
      setPicked(null);
      return;
    }
    setPicked({ owner, dealer });
    if (dealer !== "rest") void loadVisits(dealer);
  }

  if (teams.length === 0) return null;

  return (
    <section>
      <div className="section-head">
        <h2 className="t-section">
          What they&rsquo;re selling{" "}
          <span style={{ color: "var(--ink-muted)" }}>· by customer</span>
        </h2>
        <Link href="/quotes" className="t-action">
          Open quotes
        </Link>
      </div>

      <div className="card card-pad">
        {teams.map((t) => {
          const openHere = picked?.owner === t.owner ? picked.dealer : null;
          const band = t.bands.find((b) => b.id === openHere) ?? null;
          return (
            <div key={t.owner} className="sales-row">
              <div className="flex items-baseline justify-between gap-3">
                <span className="pva-name">{t.meta?.name ?? "—"}</span>
                <span className="pva-fig">
                  {QTY.format(t.total)} {t.unit}
                </span>
              </div>
              <span className="pva-sub">{t.meta?.patch ?? "No patch"}</span>

              <div className="sales-track">
                {t.bands.map((b) => {
                  const chosen = openHere !== null;
                  const isOpen = b.id === openHere;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className="sales-seg"
                      style={{
                        // flex-grow carries the animation: the chosen band
                        // takes the whole bar, the rest fold to nothing.
                        flexGrow: chosen ? (isOpen ? 1 : 0.0001) : b.qty,
                        flexBasis: 0,
                        background: b.colour,
                      }}
                      data-dimmed={chosen && !isOpen}
                      aria-pressed={isOpen}
                      aria-label={`${b.name}: ${QTY.format(b.qty)} ${t.unit}`}
                      onClick={() => toggle(t.owner, b.id)}
                    />
                  );
                })}
              </div>

              {/* The legend is what carries identity — a colour can separate
                  bands, it cannot name them. It is also a second way in for a
                  thumb that would rather hit a word than a stripe. */}
              <p className="sales-legend">
                {t.bands.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={b.id === openHere}
                    onClick={() => toggle(t.owner, b.id)}
                  >
                    <i style={{ background: b.colour }} aria-hidden="true" />
                    {b.name} {QTY.format(b.qty)}
                  </button>
                ))}
              </p>

              {band && (
                <div className="sales-detail">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="t-title">{band.name}</span>
                    <span className="t-meta tabular-nums">
                      {QTY.format(band.qty)} {t.unit} won
                    </span>
                  </div>
                  {band.row && (
                    <p className="t-sub mt-1">
                      {formatMoney(Number(band.row.won_value))}
                      {Number(band.row.out_qty) > 0
                        ? ` · ${QTY.format(Number(band.row.out_qty))} ${t.unit} out for quote`
                        : ""}
                      {Number(band.row.open_qty) > 0
                        ? ` · ${QTY.format(Number(band.row.open_qty))} ${t.unit} still open`
                        : ""}
                    </p>
                  )}

                  {band.id !== "rest" && (
                    <div className="mt-2.5">
                      <p className="t-meta uppercase tracking-wide">Last seen</p>
                      {visits === null ? (
                        <p className="t-sub mt-1">Loading…</p>
                      ) : visits.length === 0 ? (
                        <p className="t-sub mt-1">No visits recorded here yet.</p>
                      ) : (
                        <ul className="mt-1 flex flex-col gap-1">
                          {visits.map((v) => (
                            <li key={v.id} className="t-sub">
                              <span className="t-meta">
                                {DAY.format(new Date(v.occurred_at))}
                              </span>{" "}
                              {v.what_happened?.trim() || "No note written"}
                            </li>
                          ))}
                        </ul>
                      )}
                      <Link
                        href={`/accounts/${band.id}`}
                        className="t-action mt-2 inline-block underline underline-offset-2"
                      >
                        Open {band.name}
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="t-sub px-1">
        Each band is a customer, not a status. GMX&rsquo;s own book — the
        distributors&rsquo; report isn&rsquo;t connected yet.
      </p>
    </section>
  );
}
