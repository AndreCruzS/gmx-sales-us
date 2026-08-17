"use client";

// The sales dashboard: what the dealers actually bought, and from whom.
//
// The bar on a manager's home is SALES, not visits — leadership were explicit,
// and they are right. But it is not OUR book either. GMX sells to a distributor;
// the distributor's branches sell on to the dealers; a rep owns an area and
// builds the dealer relationships that make the distributor's next order worth
// placing. So the figure that says whether a rep is working is the distributor's
// sell-through in his patch, which arrives as a file from Boise and Hardwoods
// and is ALWAYS A MONTH BEHIND. Every figure here names its month for that
// reason.
//
// Three ways to read it, in the order they asked for: rep, distribution,
// dealer. They are the same walk down the chain started from different ends, so
// one bar serves all three — the ROWS are one link and the BANDS are the next
// link down. See src/lib/domain/sell-through.ts for the walk itself.
//
// Tapping a band does not leave the page, and this is the part leadership liked:
// the band slides to the start of the track, stretches to own the whole bar —
// and THAT FILLED BAR IS THE NEXT LEVEL. It splits into what is inside it. So
// "which Boise branches have sales" and "who that branch sold to" are not two
// screens, they are one bar one link apart. At the end of the chain there is
// nothing left to split into, so the detail unfolds underneath instead.
//
// Meanwhile the WHOLE SCREEN re-answers for whatever was picked: the figures
// above travel to their new values, the rollout narrows to that branch, the year
// narrows to their months. Nobody loses their place to read one number.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  buildStep,
  focusAccount,
  movementLabel,
  moveDir,
  scopeVolume,
  periodLabel,
  SELL_LENSES,
  stepFor,
  type BranchRef,
  type PathStep,
  type SellBand,
  type SellGroup,
  type SellLens,
  type SellThroughRow,
} from "@/lib/domain/sell-through";

/** What the page narrows to. See focusAccount: the NAME is the deepest link of
 *  the walk so the bar agrees with the crumbs, while accountId is the deepest
 *  link that is one of ours, for the sections that can only be keyed on one. */
export interface Focus {
  id: string;
  name: string;
  kind: string | null;
  dim: string;
  colour: string;
  accountId: string;
  accountName: string;
  /** The volume inside this walk, and the same a month earlier. The figures at
   *  the top of the page are these — not the account's whole book — so they add
   *  up to the bar underneath them. */
  qty: number;
  prevQty: number;
}

interface VisitRow {
  id: string;
  occurred_at: string;
  activity_type: string;
  what_happened: string | null;
}

// The pick is two movements, not one. First the bands in front of the chosen one
// fold away, which SLIDES it to the start of the track. Only then does it stretch
// to fill. Doing both at once reads as a bar being yanked; doing them in order
// reads as the chosen customer stepping forward.
//
// Both beats ease out — see the note on .sales-seg. FILL_MS matches the fill
// transition, so the walk to the next level begins at the moment the band has
// actually taken the bar, not while it is still travelling.
const SLIDE_MS = 420;
const FILL_MS = 460;

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** What the first crumb offers to go back to, per lens. */
const ROOT_CRUMB: Record<SellLens, string> = {
  rep: "All reps",
  distribution: "All houses",
  dealer: "All dealers",
};

const DIM_NOUN: Record<string, string> = {
  rep: "rep",
  distributor: "distributor",
  branch: "branch",
  dealer: "dealer",
};

/** A selection is only the selection for the level it was made on. */
interface Selection {
  pathKey: string;
  group: string;
  band: string;
}

const keyOf = (path: readonly PathStep[]) => path.map((s) => s.key).join(">");

export function TeamSales({
  rows,
  branches,
  latest,
  previous,
  path,
  onPath,
  onFocus,
}: {
  /** Sell-through, at least for the two most recent months. */
  rows: readonly SellThroughRow[];
  /** Every known branch, including the ones that bought nothing. */
  branches: readonly BranchRef[];
  /** The month the book is good to, and the one before it. */
  latest: string | null;
  previous: string | null;
  /** Both the walk and the focus are owned by the PAGE, not by this section:
   *  picking a customer re-asks every question on the screen, and "Show all" up
   *  in the focus bar has to be able to undo the walk as well as the focus. */
  path: readonly PathStep[];
  onPath: (next: PathStep[]) => void;
  onFocus: (next: Focus | null) => void;
}) {
  const [lens, setLens] = useState<SellLens>("rep");
  const [selected, setSelected] = useState<Selection | null>(null);
  // "slide" = travelling to the start, "fill" = stretching to own the bar.
  const [phase, setPhase] = useState<"idle" | "slide" | "fill">("idle");
  const [visits, setVisits] = useState<VisitRow[] | null>(null);
  // Which coverage gaps have been opened out into rows. Keyed by walk AND row,
  // so opening Boise's quiet branches does not open Hardwoods'.
  const [quietOpen, setQuietOpen] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  // A pending stage must not outlive the component, or fire into a bar that is
  // no longer the one that was tapped.
  useEffect(() => clearTimers, [clearTimers]);

  const pathKey = keyOf(path);

  const { current, prior } = useMemo(() => {
    const c: SellThroughRow[] = [];
    const p: SellThroughRow[] = [];
    for (const r of rows) {
      if (latest && r.period === latest) c.push(r);
      else if (previous && r.period === previous) p.push(r);
    }
    return { current: c, prior: p };
  }, [rows, latest, previous]);

  const step = useMemo(
    () => buildStep(current, prior, lens, path, branches),
    [current, prior, lens, path, branches],
  );

  // The visits behind the number, fetched into the space the animation makes.
  const loadVisits = useCallback(async (accountId: string) => {
    try {
      const { data, error } = await getSupabaseBrowserClient()
        .from("activities")
        .select("id, occurred_at, activity_type, what_happened")
        .eq("primary_account_id", accountId)
        .order("occurred_at", { ascending: false })
        .limit(4);
      setVisits(error ? [] : ((data as VisitRow[]) ?? []));
    } catch {
      // no signal — the numbers above are already on screen and still true
      setVisits([]);
    }
  }, []);

  // The walk a tap lands on. At depth 0 the row has not been chosen yet, so it
  // is recorded alongside the band; deeper in, the row is already the last step.
  // The same shape is what the drill appends, which is why the tiles and the bar
  // can never end up scoped differently.
  const scopeOf = useCallback(
    (p: readonly PathStep[], group: SellGroup | null, band: SellBand | null): PathStep[] => {
      const withRow = p.length === 0 && group ? [...p, stepFor(group.entity)] : [...p];
      return band ? [...withRow, stepFor(band.entity, band.colour)] : withRow;
    },
    [],
  );

  const toFocus = useCallback(
    (
      p: readonly PathStep[],
      group: SellGroup | null,
      band: SellBand | null,
    ): Focus | null => {
      const f = focusAccount(scopeOf(p, group, band), null);
      if (f === null) return null;
      const scope = scopeOf(p, group, band);
      return {
        id: f.key,
        name: f.name,
        kind: f.kind,
        dim: f.dim,
        colour: f.colour,
        accountId: f.accountId,
        accountName: f.accountName,
        qty: scopeVolume(current, scope),
        prevQty: scopeVolume(prior, scope),
      };
    },
    [scopeOf, current, prior],
  );

  const goTo = useCallback(
    (next: PathStep[]) => {
      clearTimers();
      setSelected(null);
      setPhase("idle");
      setVisits(null);
      onPath(next);
      onFocus(toFocus(next, null, null));
    },
    [clearTimers, onPath, onFocus, toFocus],
  );

  const toggleQuiet = useCallback((key: string) => {
    setQuietOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Driven by the tap, not by an effect watching state: the walk is caused by
  // the person, and a render is not the place to start one.
  function tap(group: SellGroup, band: SellBand) {
    clearTimers();
    setVisits(null);

    if (
      selected?.pathKey === pathKey &&
      selected.group === group.key &&
      selected.band === band.key
    ) {
      // Letting go: everything returns to its share of the bar together.
      setSelected(null);
      setPhase("idle");
      onFocus(toFocus(path, null, null));
      return;
    }

    setSelected({ pathKey, group: group.key, band: band.key });
    setPhase("slide");
    onFocus(toFocus(path, group, band));
    timers.current.push(setTimeout(() => setPhase("fill"), SLIDE_MS));

    if (band.drillable) {
      // The fill IS the transition. Once the band owns the bar, that bar becomes
      // the next level and splits into what is inside it.
      timers.current.push(
        setTimeout(() => {
          setSelected(null);
          setPhase("idle");
          onPath(scopeOf(path, group, band));
        }, SLIDE_MS + FILL_MS),
      );
      return;
    }

    if (band.entity.accountId) void loadVisits(band.entity.accountId);
  }

  const month = periodLabel(latest);

  if (rows.length === 0) {
    return (
      <section>
        <div className="section-head">
          <h2 className="t-section">Sales dashboard</h2>
        </div>
        <div className="card card-pad">
          <p className="t-sub">
            No distributor report loaded yet. Boise and Hardwoods send a
            spreadsheet a month behind; once one is uploaded, the sell-through for
            that month appears here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="section-head">
        <h2 className="t-section">Sales dashboard</h2>
        <Link href="/quotes" className="t-action">
          Open quotes
        </Link>
      </div>

      <div className="chip-row mb-3" role="group" aria-label="Read the book by">
        {SELL_LENSES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={lens === key}
            onClick={() => {
              if (lens === key) return;
              setLens(key);
              // A walk taken under one lens is not a walk under the next.
              goTo([]);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Where the walk has got to, and the way back out of it. Three links deep
          with no way back is a trap, however good the animation is. */}
      <nav className="sales-crumbs" aria-label="Where you are">
        <button
          type="button"
          onClick={() => goTo([])}
          aria-current={path.length === 0 ? "step" : undefined}
        >
          {ROOT_CRUMB[lens]}
        </button>
        {path.map((s, i) => (
          <button
            key={`${s.dim}-${s.key}`}
            type="button"
            onClick={() => goTo(path.slice(0, i + 1))}
            aria-current={i === path.length - 1 ? "step" : undefined}
          >
            {s.name}
          </button>
        ))}
      </nav>

      {/* Keyed on the walk, so each level enters rather than swapping in place —
          the same remount trick the page sections use. */}
      <div className="sales-step" key={`${lens}-${pathKey}`}>
        <p className="sales-month">
          {QTY.format(step.total)} {step.unit} · {month}
        </p>

        <div className="card card-pad">
          {step.groups.map((g) => {
            const open =
              selected?.pathKey === pathKey && selected.group === g.key
                ? (g.bands.find((b) => b.key === selected.band) ?? null)
                : null;
            const moved = movementLabel(g.total, g.prevTotal, previous);
            const openMoved = open
              ? movementLabel(open.qty, open.prevQty, previous)
              : null;
            return (
              <div key={g.key} className="sales-row">
                <div className="sales-head">
                  <span className="sales-head-body">
                    <span className="sales-head-name">{g.title}</span>
                    {/* No dim noun here: under the Rep lens the rows are
                        obviously reps, and "rep" under a rep's name is a word
                        that costs a line and says nothing. */}
                    <span className="sales-head-sub">
                      {[
                        g.sub,
                        g.value !== null ? formatMoney(Math.round(g.value)) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="sales-head-fig">
                    <span className="sales-head-qty">
                      {QTY.format(g.total)} {g.unit}
                    </span>
                    <span className="sales-move" data-dir={moveDir(g.total, g.prevTotal, previous)}>
                      {moved ?? "no earlier file"}
                    </span>
                  </span>
                </div>

                <div className="sales-track" data-phase={open ? phase : "idle"}>
                  {g.segments.map((s) => {
                    const chosen = open !== null;
                    const isOpen = open?.key === s.key;
                    const band = s.band;
                    return (
                      <button
                        key={s.key}
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
                            ? `${s.share}%`
                            : isOpen
                              ? phase === "slide"
                                ? `${s.share}%`
                                : "100%"
                              : "0%",
                          background: s.colour,
                        }}
                        data-dimmed={chosen && !isOpen}
                        aria-pressed={isOpen}
                        aria-label={`${s.name}: ${QTY.format(s.qty)} ${g.unit}${
                          band?.drillable ? ", opens its own breakdown" : ""
                        }`}
                        disabled={band === null}
                        onClick={() => band && tap(g, band)}
                      />
                    );
                  })}
                </div>

                {/* The bar says the SHAPE; this says the detail. A colour can
                    separate bands, it cannot name them, and a name crammed into
                    ten-point mono next to a bare number is not something anybody
                    reads — it is something they skip. So every band gets a real
                    row: who, what they bought, how much, and which way it moved.

                    Every band, including the ones gathered into the grey tail on
                    the track, so a small dealer is never unreachable. It is also
                    the honest tap target — a thumb would rather hit a row than a
                    26-pixel stripe. */}
                <ul className="sales-list">
                  {g.bands.map((b) => {
                    const bandMoved = movementLabel(b.qty, b.prevQty, previous);
                    return (
                      <li key={b.key}>
                        <button
                          type="button"
                          className="sales-item"
                          aria-pressed={open?.key === b.key}
                          onClick={() => tap(g, b)}
                        >
                          <span
                            className="sales-item-rail"
                            style={{ background: b.colour }}
                            aria-hidden="true"
                          />
                          <span className="sales-item-body">
                            <span className="sales-item-name">{b.name}</span>
                            {/* Only what this row does not already say. Every
                                band at one level is the same kind of thing, so
                                "distributor" on each of them is three words of
                                repetition — but a branch's state and an
                                unmatched name's warning are worth the line. And
                                one product is worth naming where five are just
                                a count. */}
                            <span className="sales-item-sub">
                              {[
                                b.entity.sub === DIM_NOUN[b.entity.dim]
                                  ? null
                                  : b.entity.sub,
                                b.products.length === 1
                                  ? b.products[0]
                                  : b.products.length > 1
                                    ? `${b.products.length} products`
                                    : null,
                                g.bands.length > 1 ? `${Math.round(b.share)}%` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                          <span className="sales-item-fig">
                            <span className="sales-item-qty">
                              {QTY.format(b.qty)} {g.unit}
                            </span>
                            <span
                              className="sales-move"
                              data-dir={moveDir(b.qty, b.prevQty, previous)}
                            >
                              {bandMoved ?? "—"}
                            </span>
                          </span>
                          <span className="sales-item-go" aria-hidden="true">
                            {b.drillable ? "›" : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {/* Coverage: the branches of this house that bought NOTHING this
                    month. A map of who is buying is only useful if it also says
                    who is not — so under Distribution the gaps get rows of their
                    own, with a dash where the figure would be. Seven names in a
                    grey sentence is a footnote; seven rows is a list of calls.

                    The DENOMINATOR only belongs under Distribution. Boise has
                    branches in Denver and Spokane; counting them against Deon's
                    patch would read as a rep failing to sell in states that are
                    not his, which is worse than saying nothing. */}
                {g.coverage &&
                  (lens === "distribution" ? (
                    g.coverage.quiet.length > 0 && (
                      <ul className="sales-list sales-list-quiet">
                        <li>
                          <button
                            type="button"
                            className="sales-item"
                            aria-expanded={quietOpen.has(`${pathKey}|${g.key}`)}
                            onClick={() => toggleQuiet(`${pathKey}|${g.key}`)}
                          >
                            <span
                              className="sales-item-rail"
                              style={{ background: "var(--cat-rest)", opacity: 0.4 }}
                              aria-hidden="true"
                            />
                            <span className="sales-item-body">
                              <span className="sales-item-name">
                                {g.coverage.quiet.length} not buying
                              </span>
                              <span className="sales-item-sub">
                                {g.coverage.buying} of {g.coverage.total} branches
                                bought in {month}
                              </span>
                            </span>
                            <span className="sales-item-fig">
                              <span className="sales-item-qty">0 {g.unit}</span>
                            </span>
                            <span className="sales-item-go" aria-hidden="true">
                              {quietOpen.has(`${pathKey}|${g.key}`) ? "–" : "+"}
                            </span>
                          </button>
                        </li>
                        {quietOpen.has(`${pathKey}|${g.key}`) &&
                          g.coverage.quiet.map((name) => (
                            <li key={name}>
                              <span className="sales-item sales-item-still">
                                <span
                                  className="sales-item-rail"
                                  style={{ background: "var(--cat-rest)", opacity: 0.28 }}
                                  aria-hidden="true"
                                />
                                <span className="sales-item-body">
                                  <span className="sales-item-name">{name}</span>
                                  <span className="sales-item-sub">
                                    nothing in {month}
                                  </span>
                                </span>
                                <span className="sales-item-fig">
                                  <span className="sales-item-qty">&mdash;</span>
                                </span>
                                <span className="sales-item-go" aria-hidden="true" />
                              </span>
                            </li>
                          ))}
                      </ul>
                    )
                  ) : (
                    <p className="sales-quiet">
                      {g.coverage.buying}{" "}
                      {g.coverage.buying === 1 ? "branch" : "branches"}{" "}
                      {lens === "dealer" ? "supplying them" : "selling in this patch"}
                      {" · "}
                      {g.title} has {g.coverage.total} in all
                    </p>
                  ))}

                {/* The detail waits for the bar to arrive; opening it mid-slide
                    would give the eye two things to follow at once. */}
                {open && phase !== "slide" && (
                  <div className="sales-detail">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="t-title">
                        {open.name}
                        {open.entity.sub ? (
                          <>
                            {" "}
                            <span className="t-meta">{open.entity.sub}</span>
                          </>
                        ) : null}
                      </span>
                      <span className="t-meta tabular-nums">
                        {QTY.format(open.qty)} {g.unit}
                      </span>
                    </div>
                    <p className="t-sub mt-1">
                      Through {g.title} in {month}
                      {openMoved ? ` · ${openMoved}` : ""}
                    </p>

                    {open.entity.accountId === null ? (
                      // An unmatched dealer name. Its volume is real and its
                      // owner is unknown, which is a job for an admin rather
                      // than a number anybody should be held to.
                      <p className="t-sub mt-2">
                        This name came off the distributor&rsquo;s file and
                        hasn&rsquo;t been matched to an account yet, so it counts
                        towards nobody&rsquo;s patch.
                      </p>
                    ) : (
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
                          href={`/accounts/${open.entity.accountId}`}
                          className="t-action mt-2 inline-block underline underline-offset-2"
                        >
                          Open {open.name}
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="t-sub px-1">
        The distributors&rsquo; own report for {month} — it arrives a month
        behind, so this is what the dealers bought, not what we have quoted.
        {previous ? ` Movement is against ${periodLabel(previous)}.` : ""}
      </p>
    </section>
  );
}
