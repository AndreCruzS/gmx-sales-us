"use client";

// The sales dashboard: what is being sold, and to whom.
//
// The bar on a manager's home is SALES, not visits — leadership were explicit,
// and they are right: a week of kept promises is how a rep works, but volume
// through a door is what the business is. So one bar per row, in the linear
// feet the trade quotes in, banded by whoever is not the row.
//
// Three ways to read it, in the order they asked for: rep, distribution,
// dealer. The measure never changes — only who the rows are.
//
// Tapping a band does not leave the page. The band grows to own the bar while
// the rest fold away, and the WHOLE SCREEN re-answers for that customer: the
// figures above travel to their new values, the rollout narrows to that
// branch, the year narrows to their months. Nobody loses their place to read
// one number.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { displayAccountName, formatMoney } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface CustomerSalesRow {
  owner_id: string;
  customer_id: string;
  customer_name: string;
  /** DEALER or DISTRIBUTOR — GMX sells to both, and the band says which. */
  customer_type: string;
  unit: string;
  won_qty: number;
  out_qty: number;
  open_qty: number;
  won_value: number;
}

export interface Focus {
  id: string;
  name: string;
  kind: string | null;
  colour: string;
}

interface VisitRow {
  id: string;
  occurred_at: string;
  activity_type: string;
  what_happened: string | null;
}

type SalesLens = "rep" | "distribution" | "dealer";

// The order leadership listed them in.
const LENSES: readonly (readonly [SalesLens, string])[] = [
  ["rep", "Rep"],
  ["distribution", "Distribution"],
  ["dealer", "Dealer"],
];

// The pick is two movements, not one. First the bands in front of the chosen
// one fold away, which SLIDES it to the start of the track — ease-in, because
// a thing that is setting off should look like it is gathering speed. Only
// then does it stretch to fill, on a soft ease-out, the way something arriving
// settles rather than slams. Doing both at once reads as a bar being yanked;
// doing them in order reads as the chosen customer stepping forward.
const SLIDE_MS = 340;

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
  /** This band's share of its bar, as a percentage — the width it holds while
   *  it slides to the start. */
  share: number;
  colour: string;
  row: CustomerSalesRow | null;
  /** What the page should answer for when this band is chosen. Always a
   *  customer: under the rep lens that is the band itself; under the other two
   *  the row already IS the customer. */
  focus: Focus;
}

interface Group {
  id: string;
  title: string;
  sub: string;
  unit: string;
  total: number;
  bands: Band[];
}

export function TeamSales({
  rows,
  repMeta,
  focus,
  onFocus,
}: {
  rows: readonly CustomerSalesRow[];
  repMeta: ReadonlyMap<string, { name: string; patch: string }>;
  /** Owned by the page: picking a customer re-asks every question on it, so
   *  the selection cannot live inside one section. */
  focus: Focus | null;
  onFocus: (next: Focus | null) => void;
}) {
  const [lens, setLens] = useState<SalesLens>("rep");
  const [visits, setVisits] = useState<VisitRow[] | null>(null);
  // "slide" = travelling to the start, "fill" = stretching to own the bar.
  const [phase, setPhase] = useState<"idle" | "slide" | "fill">("idle");
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending stage must not outlive the component, or fire into a bar that is
  // no longer the one that was tapped.
  useEffect(
    () => () => {
      if (phaseTimer.current !== null) clearTimeout(phaseTimer.current);
    },
    [],
  );

  const groups = useMemo<Group[]>(() => {
    const sold = rows.filter((r) => Number(r.won_qty) > 0);
    const scoped =
      lens === "rep"
        ? sold
        : sold.filter(
            (r) =>
              r.customer_type ===
              (lens === "distribution" ? "DISTRIBUTOR" : "DEALER"),
          );

    const byGroup = new Map<string, CustomerSalesRow[]>();
    for (const r of scoped) {
      const key = lens === "rep" ? r.owner_id : r.customer_id;
      const list = byGroup.get(key) ?? [];
      list.push(r);
      byGroup.set(key, list);
    }

    return [...byGroup.entries()]
      .map(([key, list]) => {
        const sorted = [...list].sort(
          (a, b) => Number(b.won_qty) - Number(a.won_qty),
        );
        const head = sorted.slice(0, MAX_BANDS);
        const tail = sorted.slice(MAX_BANDS);

        const bandFor = (r: CustomerSalesRow, colour: string): Band => ({
          // Under rep the band is the customer; under the others the band is
          // the rep who sold it, and the row is the customer.
          id: lens === "rep" ? r.customer_id : r.owner_id,
          name:
            lens === "rep"
              ? displayAccountName(r.customer_name)
              : (repMeta.get(r.owner_id)?.name ?? "—"),
          qty: Number(r.won_qty),
          share: 0,
          colour,
          row: r,
          focus: {
            id: r.customer_id,
            name: displayAccountName(r.customer_name),
            kind: r.customer_type,
            colour,
          },
        });

        const bands: Band[] = head.map((r, i) => bandFor(r, BAND_COLOURS[i]));
        if (tail.length > 0 && lens === "rep") {
          bands.push({
            id: "rest",
            name: `${tail.length} more`,
            qty: tail.reduce((n, r) => n + Number(r.won_qty), 0),
            share: 0,
            colour: "var(--cat-rest)",
            row: null,
            focus: {
              id: "rest",
              name: `${tail.length} more`,
              kind: null,
              colour: "var(--cat-rest)",
            },
          });
        }

        const barTotal = bands.reduce((n, b) => n + b.qty, 0);
        for (const b of bands) {
          b.share = barTotal === 0 ? 0 : (100 * b.qty) / barTotal;
        }

        const first = sorted[0];
        return {
          id: key,
          title:
            lens === "rep"
              ? (repMeta.get(key)?.name ?? "—")
              : displayAccountName(first.customer_name),
          sub:
            lens === "rep"
              ? (repMeta.get(key)?.patch ?? "No patch")
              : first.customer_type === "DISTRIBUTOR"
                ? "distributor"
                : "dealer",
          unit: first.unit ?? "LF",
          total: bands.reduce((n, b) => n + b.qty, 0),
          bands,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [rows, repMeta, lens]);

  // The visits behind the number, fetched into the space the animation makes.
  const loadVisits = useCallback(async (customerId: string) => {
    try {
      const { data, error } = await getSupabaseBrowserClient()
        .from("activities")
        .select("id, occurred_at, activity_type, what_happened")
        .eq("primary_account_id", customerId)
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
  function toggle(band: Band) {
    setVisits(null);
    if (phaseTimer.current !== null) clearTimeout(phaseTimer.current);

    if (focus?.id === band.focus.id) {
      // Letting go: everything returns to its share of the bar together.
      setPhase("idle");
      onFocus(null);
      return;
    }

    onFocus(band.focus);
    setPhase("slide");
    phaseTimer.current = setTimeout(() => {
      phaseTimer.current = null;
      setPhase("fill");
    }, SLIDE_MS);
    if (band.focus.id !== "rest") void loadVisits(band.focus.id);
  }

  if (groups.length === 0) return null;

  return (
    <section>
      <div className="section-head">
        <h2 className="t-section">Sales dashboard</h2>
        <Link href="/quotes" className="t-action">
          Open quotes
        </Link>
      </div>

      <div className="chip-row mb-3" role="group" aria-label="Read the book by">
        {LENSES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={lens === key}
            onClick={() => {
              setLens(key);
              // A choice made under one lens is not a choice under the next.
              onFocus(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card card-pad">
        {groups.map((g) => {
          // A focused customer may sit on any row; every bar shows the choice,
          // because the page as a whole is answering for it.
          const open = g.bands.find((b) => b.focus.id === focus?.id) ?? null;
          return (
            <div key={g.id} className="sales-row">
              <div className="flex items-baseline justify-between gap-3">
                <span className="pva-name">{g.title}</span>
                <span className="pva-fig">
                  {QTY.format(g.total)} {g.unit}
                </span>
              </div>
              <span className="pva-sub">{g.sub}</span>

              <div className="sales-track" data-phase={open ? phase : "idle"}>
                {g.bands.map((b) => {
                  const chosen = open !== null;
                  const isOpen = open?.id === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className="sales-seg"
                      style={{
                        // Every band is sized by flex-BASIS, at rest as well
                        // as in motion, and that is the whole trick: a width
                        // can only travel from a value it already has. Sizing
                        // by flex-grow at rest left nothing to transition
                        // from, so the chosen band collapsed to nothing and
                        // grew back rather than sliding.
                        //
                        // Sliding: the chosen band HOLDS its share while the
                        // others fold to zero, which carries it to the start
                        // at the size it already was. Filling: it stretches to
                        // the whole bar. Doing both at once read as a lurch.
                        flexGrow: 0,
                        flexBasis: !chosen
                          ? `${b.share}%`
                          : isOpen
                            ? phase === "slide"
                              ? `${b.share}%`
                              : "100%"
                            : "0%",
                        background: b.colour,
                      }}
                      data-dimmed={chosen && !isOpen}
                      aria-pressed={isOpen}
                      aria-label={`${b.name}: ${QTY.format(b.qty)} ${g.unit}`}
                      onClick={() => toggle(b)}
                    />
                  );
                })}
              </div>

              {/* The legend is what carries identity — a colour can separate
                  bands, it cannot name them. It is also a second way in for a
                  thumb that would rather hit a word than a stripe. */}
              <p className="sales-legend">
                {g.bands.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={open?.id === b.id}
                    onClick={() => toggle(b)}
                  >
                    <i style={{ background: b.colour }} aria-hidden="true" />
                    {b.name} {QTY.format(b.qty)}
                  </button>
                ))}
              </p>

              {/* The detail waits for the bar to arrive; opening it mid-slide
                  would give the eye two things to follow at once. */}
              {open && phase !== "slide" && (
                <div className="sales-detail">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="t-title">
                      {open.focus.name}
                      {open.focus.kind ? (
                        <span className="t-meta ml-2">
                          {open.focus.kind === "DISTRIBUTOR" ? "distributor" : "dealer"}
                        </span>
                      ) : null}
                    </span>
                    <span className="t-meta tabular-nums">
                      {QTY.format(open.qty)} {g.unit} won
                    </span>
                  </div>
                  {open.row && (
                    <p className="t-sub mt-1">
                      {formatMoney(Number(open.row.won_value))}
                      {Number(open.row.out_qty) > 0
                        ? ` · ${QTY.format(Number(open.row.out_qty))} ${g.unit} out for quote`
                        : ""}
                      {Number(open.row.open_qty) > 0
                        ? ` · ${QTY.format(Number(open.row.open_qty))} ${g.unit} still open`
                        : ""}
                    </p>
                  )}

                  {open.focus.id !== "rest" && (
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
                        href={`/accounts/${open.focus.id}`}
                        className="t-action mt-2 inline-block underline underline-offset-2"
                      >
                        Open {open.focus.name}
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
