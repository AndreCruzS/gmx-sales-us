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
// Four ways to read it — region, rep, distribution, dealer — and they are the
// same walk down the chain started from different ends, so one bar serves them
// all: the ROWS are one link and the BANDS are the next link down. See
// src/lib/domain/sell-through.ts for the walk itself.
//
// REGION AND REP ARE NOT THE SAME LENS. A rep can hold more than one region, so
// the region lens splits a number the rep lens adds up, and they answer different
// questions: which ground is covered against who is performing. Region leads
// because it is the top of the client's own hierarchy and because it is the only
// place the unclaimed volume has a NAME — grouped by rep, four uncovered regions
// collapse into one "Nobody yet" that nobody can act on.
//
// Tapping a band does not leave the page, and this is the part leadership liked:
// the level underneath simply BECOMES what was tapped, on the tap. So "which
// Boise branches have sales" and "who that branch sold to" are not two screens,
// they are one bar one link apart, and no transition is performed in between —
// the new level entering is all the movement the walk needs. At the end of the
// chain there is nothing left to walk into, so the detail unfolds underneath
// instead.
//
// Meanwhile the WHOLE SCREEN re-answers for whatever was WALKED INTO: the
// figures above travel to their new values, the rollout narrows to that branch,
// the year narrows to their months. Nobody loses their place to read one number.
//
// Walked into, and not merely looked at. Narrowing the total bar to one stripe
// leaves the page alone, because that is a way of reading the card rather than a
// choice about what the page is for. The page follows the walk.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SalesMap } from "@/components/sales-map";
import { ChevronDownIcon } from "@/components/icons";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { useTween } from "@/lib/ui/use-tween";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  backFrom,
  buildStep,
  compositionRail,
  housesMissing,
  ALL_ROWS,
  SELL_ROOT_LABEL,
  focusAccount,
  movementLabel,
  moveDir,
  scopeVolume,
  periodLabel,
  rowMatchesPath,
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

// TWO MOVEMENTS, FOR THE TAPS THAT ARE ANSWERS IN THEMSELVES.
//
// The slide folds the bands in front of the chosen one away, carrying it to the
// start of the track; the fill stretches it to own the bar. In order they read
// as a customer stepping forward, where at once they read as a bar being yanked.
//
// Only the taps that END on the bar get them: isolating a row of the total bar,
// and opening a band with nowhere left to walk. There the movement is the whole
// answer, so it is worth watching. A band that WALKS gets neither — the level
// changes on the tap itself, because anything between the choice and the level
// is time spent performing what the level says by arriving. That is the third
// cut Andre made to this transition, and the lesson of all three: motion earns
// its keep by being the reading, never by being the journey.
//
// Both beats ease out; see the note on .sales-seg.
const SLIDE_MS = 420;
// Letting go is one beat, not two — the bands returning to their own shares IS
// the slide run backwards, so there is nothing to sequence. It matches the idle
// flex-basis transition on .sales-seg, because the rows coming back and the bar
// giving the track back have to be one movement or the rows arrive first and
// stand there waiting for it.
const RELEASE_MS = 500;

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const DIM_NOUN: Record<string, string> = {
  region: "region",
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
  ytdRows,
  branches,
  latest: latestMonth,
  previous: previousMonth,
  months,
  onPickMonth,
  path,
  onPath,
  onFocus,
  onLens,
  onMode,
}: {
  /** Sell-through, at least for the two most recent months. MONTH rows only —
   *  a year-to-date aggregate in here would double the book. */
  rows: readonly SellThroughRow[];
  /** Year-to-date uploads, when any exist. Their presence is what makes the
   *  "This month / Year so far" toggle appear; their LY column is the only
   *  comparison the YTD reading makes. */
  ytdRows?: readonly SellThroughRow[];
  /** Every known branch, including the ones that bought nothing. */
  branches: readonly BranchRef[];
  /** The month the book is good to, and the one before it. */
  latest: string | null;
  previous: string | null;
  /** Every month the book holds, newest first. More than one is what turns
   *  the masthead's "· July 2026" into a picker — with a single file the
   *  label stays a label, because a menu of one is a lie about choice. */
  months?: readonly string[];
  onPickMonth?: (period: string) => void;
  /** Both the walk and the focus are owned by the PAGE, not by this section:
   *  picking a customer re-asks every question on the screen, and "Show all" up
   *  in the focus bar has to be able to undo the walk as well as the focus. */
  path: readonly PathStep[];
  onPath: (next: PathStep[]) => void;
  onFocus: (next: Focus | null) => void;
  /** The page listens because sections below answer per-lens — the rollout
   *  book only makes sense while the card is being read by rep. */
  onLens?: (lens: SellLens) => void;
  /** And per-window: the footnote and the quiet ranking follow the same
   *  month-or-year reading the card is giving. */
  onMode?: (mode: "month" | "ytd") => void;
}) {
  const [lens, setLens] = useState<SellLens>("region");
  // THE DESK READS AS AN OPEN BOOK (>=1280px): markets on the left page, the
  // picked market's chain on the right, both visible at once. Behaviour, not
  // just layout, so a media query in CSS is not enough — the component has to
  // know which reading it is giving. The phone keeps the walk untouched.
  const [desk, setDesk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const on = () => setDesk(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // Which WINDOW the card is read through. "month" is the book as it has
  // always been; "ytd" is the year-so-far aggregate compared against its own
  // last-year column. The pair of periods below follows this, so everything
  // downstream — the walk, the movement, the counter — works unchanged.
  const [mode, setMode] = useState<"month" | "ytd">("month");
  const [selected, setSelected] = useState<Selection | null>(null);
  // "slide" = travelling to the start, "fill" = stretching to own the bar.
  const [phase, setPhase] = useState<"idle" | "slide" | "fill">("idle");
  const [visits, setVisits] = useState<VisitRow[] | null>(null);
  // The row that was just let go of, held for exactly as long as the bar takes
  // to unfold. It is a BEAT, not a second opinion about what is selected —
  // nothing reads it to decide what is open, only to decide what is arriving.
  const [releasing, setReleasing] = useState<string | null>(null);
  // The same beat one level down: the terminal band whose panel was just
  // closed, held while its siblings come back to full weight. Its own state
  // rather than a scope flag on `releasing`, because the two never fire
  // together — rows shrink only at depth 0, where every band walks, and panels
  // only open at the end of the chain, where there is a single row.
  const [bandReleasing, setBandReleasing] = useState<string | null>(null);
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

  // The YTD window, shaped to look exactly like a pair of months: the file's
  // LY column becomes the "previous period", so buildStep, the movement labels
  // and the counter all work untouched. A pseudo period key, never a date —
  // nothing formats it, the labels are overridden wherever it would show.
  const LY_PERIOD = "last-year";
  const ytd = useMemo(() => {
    if (!ytdRows || ytdRows.length === 0) return null;
    const seen = [...new Set(ytdRows.map((r) => r.period))].sort().reverse();
    const yLatest = seen[0] ?? null;
    if (!yLatest) return null;
    const cur = ytdRows.filter((r) => r.period === yLatest);
    const prior = cur
      .filter((r) => Number(r.ly_quantity ?? 0) > 0)
      .map((r) => ({ ...r, period: LY_PERIOD, quantity: Number(r.ly_quantity) }));
    return {
      current: cur,
      prior,
      latest: yLatest,
      previous: prior.length > 0 ? LY_PERIOD : null,
    };
  }, [ytdRows]);
  const ytdOn = mode === "ytd" && ytd !== null;

  const latest = ytdOn ? ytd!.latest : latestMonth;
  const previous = ytdOn ? ytd!.previous : previousMonth;
  // "on last year", not "on Jun" — the YTD comparison is the same window a
  // year back, and a month name there would be a lie with a date on it.
  const mv = ytdOn ? { on: "last year", fresh: "new this year" } : undefined;

  const monthPair = useMemo(() => {
    const c: SellThroughRow[] = [];
    const p: SellThroughRow[] = [];
    for (const r of rows) {
      if (latestMonth && r.period === latestMonth) c.push(r);
      else if (previousMonth && r.period === previousMonth) p.push(r);
    }
    return { current: c, prior: p };
  }, [rows, latestMonth, previousMonth]);
  const current = ytdOn && ytd ? ytd.current : monthPair.current;
  const prior = ytdOn && ytd ? ytd.prior : monthPair.prior;

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
      // The summary row is not a link in the walk — it stands for ALL the rows,
      // so recording it would narrow the scope to an entity that matches nothing
      // and every figure keyed on it would come back zero.
      const withRow =
        p.length === 0 && group !== null && group.key !== ALL_ROWS
          ? [...p, stepFor(group.entity)]
          : [...p];
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
      // A level change replaces the card outright — sales-step is keyed on the
      // walk — so there is nothing left for a release to return to.
      setReleasing(null);
      setBandReleasing(null);
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
  // THE TOTAL BAR NARROWS. EVERY BAR BELOW IT WALKS.
  //
  // One rule, split by height, and it is Andre's: the primary bar is where you
  // look around — a stripe isolates its row and a second tap on it lets go, all
  // inside the card. Every other bar is already INSIDE something, so its stripes
  // mean the same as the rows listed under them: the next link of the chain.
  // Tapping Boise's colour and tapping Boise's row both go to Boise, because two
  // controls a centimetre apart that both name Boise had better agree on what
  // Boise means.
  function tap(group: SellGroup, band: SellBand) {
    const narrow = group.key === ALL_ROWS;
    clearTimers();
    setVisits(null);
    // clearTimers has just killed whatever was going to end the last release, so
    // this has to be said out loud: a new tap supersedes the one before it.
    setReleasing(null);
    setBandReleasing(null);

    // A BAND THAT WALKS DOES IT NOW. There used to be a transition — the band
    // filling the bar while the counter counted toward its figure — and Andre
    // cut it for the plainest reason there is: it spent half a second before
    // every walk performing what the next level says by arriving. The level's
    // own entrance is the movement. The choice is loaded, not narrated.
    if (!narrow && band.drillable) {
      setSelected(null);
      setPhase("idle");
      onFocus(toFocus(path, group, band));
      onPath(scopeOf(path, group, band));
      return;
    }

    if (
      selected?.pathKey === pathKey &&
      selected.group === group.key &&
      selected.band === band.key
    ) {
      // Letting go: everything returns to its share of the bar together.
      //
      // "Together" was a lie for the rows. The bar takes half a second to give
      // the track back to all its stripes; the rows underneath came back on the
      // very next frame, so fourteen of them appeared fully formed in front of a
      // bar that was still folded — which reads as debris left over from the
      // animation rather than as the month returning. They now come back ON the
      // bar, over the same half second. Held by a beat rather than by the
      // selection, because by this point nothing IS selected.
      const wasNarrowing = group.key === ALL_ROWS && phase !== "slide";
      // And the same for a terminal band's panel: its siblings were set back
      // while it was open, so they come forward on the bar's own beat.
      const wasHolding = group.key !== ALL_ROWS && phase !== "slide";
      setSelected(null);
      setPhase("idle");
      onFocus(toFocus(path, null, null));
      if (wasNarrowing) {
        setReleasing(band.key);
        timers.current.push(setTimeout(() => setReleasing(null), RELEASE_MS));
      }
      if (wasHolding) {
        setBandReleasing(band.key);
        timers.current.push(setTimeout(() => setBandReleasing(null), RELEASE_MS));
      }
      return;
    }

    // STEPPING SIDEWAYS: another stripe of the TOTAL bar while one already owns
    // it. There is nothing to slide out of — the bar is a single colour and the
    // rows below have already shrunk around the old choice — so taking the slide
    // would swing the whole card open for four hundred milliseconds and shut it
    // again on the next region. Two readings one tap apart, with the entire
    // month flashing in between.
    //
    // Straight to the fill instead: the new stripe takes the bar as the old one
    // gives it up, which wipes from one colour to the next, and the rows below
    // simply change which of them is the open one.
    // And for the same reason it holds one level down: stepping from one open
    // dealer to the next while the bar is already a single colour.
    const sideways =
      selected !== null &&
      selected.pathKey === pathKey &&
      selected.group === group.key;

    setSelected({ pathKey, group: group.key, band: band.key });
    setPhase(sideways ? "fill" : "slide");
    // A STRIPE OF THE TOTAL BAR DOES NOT MOVE THE PAGE.
    //
    // It used to, and the movement was enormous: the focus bar arriving and four
    // sections below — the tiles, the gates, the months, the slipping list —
    // unmounting and entering again with their figures travelling to new values.
    // All of it starting on the tap, while the card itself did not move until the
    // slide finished four hundred milliseconds later. The page answered before
    // the thing that had been touched did.
    //
    // That movement was written when A TAP WAS A CHOICE. It is not one any more:
    // the first tap narrows the bar and the second walks the level, so the first
    // is a way of LOOKING. Spending the largest movement on the page on a glance
    // is what made this feel like it did too much for what was asked of it.
    //
    // The card still answers in full — the bar, the rows, the counter above it
    // all follow the stripe — and every one of those is inside the card, which is
    // the scope the stripe actually belongs to.
    if (!narrow) onFocus(toFocus(path, group, band));
    if (!sideways) {
      timers.current.push(setTimeout(() => setPhase("fill"), SLIDE_MS));
    }

    // Only a row's own band has a panel to fill. A stripe of the TOTAL bar
    // narrows the card and opens nothing, so asking for its visits is a question
    // whose answer has nowhere to be printed.
    if (!narrow && band.entity.accountId) {
      void loadVisits(band.entity.accountId);
    }
  }

  // The chosen band, lifted out of the render loop: the counter above the card
  // has to answer for it as well as the row it sits in. Two array lookups over a
  // handful of items, so plain — memoising it buys nothing and the compiler
  // cannot preserve a memo whose value is assembled from two chained finds.
  // The summary is a row like any other for selection purposes, but it does not
  // live in step.groups — so it has to be looked for by name, or a tap on the
  // total bar sets the page focus and then nothing else happens.
  const chosenGroup =
    selected === null || selected.pathKey !== pathKey
      ? null
      : selected.group === ALL_ROWS
        ? step.summary
        : (step.groups.find((g) => g.key === selected.group) ?? null);
  const chosenBand =
    chosenGroup === null || selected === null
      ? null
      : (chosenGroup.bands.find((b) => b.key === selected.band) ?? null);

  const summaryOpen =
    step.summary !== null && chosenGroup?.key === ALL_ROWS ? chosenBand : null;

  // ISOLATION. Picking a stripe of the total bar narrows the rows underneath to
  // the one it stands for — the others shrink to a colour, a name and a number.
  //
  // They SHRINK rather than leave, and that is load-bearing. The total bar
  // gathers every band past the sixth colour into a single grey stripe that is
  // deliberately not tappable (see buildSegments: `band: null`), so under the
  // region lens nine of fifteen regions have no way in from the bar at all.
  // Their shrunk row is the only door, which also makes the list a way to step
  // sideways from one region to the next without going back through the whole.
  //
  // It happens on the FILL, not on the tap — the same beat the counter travels
  // on. During the slide the bar is still carrying the band at its own share and
  // every row below it is still true; the moment the band stretches to own the
  // track is the moment the rest of the card stops being the answer.
  //
  // A summary band's key IS the row's key: both are the row dimension's entity,
  // built from the same map, which is what lets the stripe and the row agree.
  //
  // Nothing else can hold an isolation open: a tap anywhere below the total bar
  // either walks the level on the spot or opens a terminal band's panel at a
  // depth where there is no summary to isolate. One writer, one reader.
  const isolatedKey =
    summaryOpen !== null && phase !== "slide" ? summaryOpen.key : null;

  // THE COUNTER, which is the whole point of the fill.
  //
  // The animation says "this fraction is now the entire bar". The figure above
  // it has to say the same thing or the two are telling different stories: the
  // band takes the whole track while the number it belongs to sits there
  // unchanged, still totalling everything the band just displaced.
  //
  // It travels on the FILL, not on the tap. During the slide the band is still
  // holding its own share and the total above it is still true; the moment the
  // band starts stretching to own the bar is the moment its number becomes the
  // answer. Counting earlier would anticipate a claim the bar has not made yet.
  //
  // And it never counts on a WALK: a walking tap changes the level immediately,
  // so this figure only ever travels between readings of the bar it sits on —
  // to an isolated row, to a terminal band, and back.
  const counterTarget =
    chosenBand !== null && phase !== "slide" ? chosenBand.qty : step.total;
  const counterQty = useTween(counterTarget);

  // And it carries the colour, so the figure and the stripe are visibly the
  // same thing. Deeper in the walk that colour is the one the walk came in on,
  // which is what keeps the rail from reverting to a stack the instant a drill
  // completes.
  const counterColour =
    (chosenBand !== null && phase !== "slide" ? chosenBand.colour : null) ??
    path[path.length - 1]?.colour ??
    null;

  // With nothing chosen there is no single colour to show, so the rail becomes a
  // miniature of the bar itself: the whole step's composition, stacked. Picking a
  // band collapses it to one colour — the same move the bar makes, in 4 pixels.
  const counterRail =
    counterColour ??
    compositionRail(step.summary !== null ? [step.summary] : step.groups);

  const month = ytdOn ? `${latest?.slice(0, 4)} so far` : periodLabel(latest);
  const waiting = housesMissing(ytdOn ? (ytdRows ?? []) : rows, latest);

  // The movement beside the counter follows whatever the counter is showing. A
  // figure that has travelled to one band's total with the whole step's movement
  // still printed next to it is two different months in one line.
  const stepPrevTotal = step.groups.reduce((n, g) => n + g.prevTotal, 0);
  const counterPrev =
    chosenBand !== null && phase !== "slide" ? chosenBand.prevQty : stepPrevTotal;
  const stepMoved = movementLabel(counterTarget, counterPrev, previous, mv);



  // The counter earns its figure only when the figure says something the card
  // does not already say. With a total bar it is the total, and no row below is
  // the total. Without one — deeper in the walk, where there is a single row —
  // the row's own header IS the total, so printing it again two lines above
  // would be the same number twice. There it appears only once a band has been
  // chosen, which is the case where it differs: "9,800 of this branch's 36,000".
  const showCounterFigure = step.summary !== null || chosenBand !== null;

  // BIANCA'S FIRST VIEW (2026-08-28). The top of the region walk is a COUNTRY
  // read over its MARKETS: the total bar wears the name "USA Nationwide" and the
  // regions under it show only their name and their share of it — no owner, no
  // figures, no distributor stripes. The figures are one gesture away in either
  // direction: isolating a stripe of the total bar still opens the full row, and
  // tapping a market walks into it. Only the FIRST view is clean — every level
  // below it still needs its numbers, because down there the reader has already
  // said which market they are asking about.
  const cleanTop = lens === "region" && path.length === 0;

  const backPath = backFrom(path);
  const backLabel =
    backPath === null
      ? null
      : backPath.length === 0
        ? SELL_ROOT_LABEL[lens]
        : backPath[backPath.length - 1].name;

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

      <div className="sales-filters">
      <div className="chip-row mb-3" role="group" aria-label="Read the book by">
        {SELL_LENSES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={lens === key}
            onClick={() => {
              // Tapping the lens you are already in is how you get back to the
              // start of it. Three links deep, the chip is the thing a thumb
              // reaches for first — it should not be the one control on the
              // screen that does nothing.
              if (lens !== key) {
                setLens(key);
                onLens?.(key);
              }
              // And a walk taken under one lens is not a walk under the next.
              goTo([]);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* The window, only once there is more than one to read: a YTD upload is
          what makes "Year so far" a real question. Flipping it abandons the
          walk for the same reason a lens change does — a walk taken through
          one window is not a walk through the next. */}
      {ytd !== null && (
        <div className="chip-row mb-3" role="group" aria-label="Read the book over">
          {(
            [
              ["month", "This month"],
              ["ytd", "Year so far"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="chip"
              aria-pressed={mode === key}
              onClick={() => {
                if (mode !== key) {
                  setMode(key);
                  onMode?.(key);
                }
                goTo([]);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      </div>

      {/* Where the walk has got to, and TWO ways back out of it.

          The trail alone was not enough. Going in is a thumb landing on a row;
          coming out was an eleven-point word in a line of other words, and the
          shape of that is a screen you can enter and not leave. So the way out
          is a control — ink, pill, thumb-sized, and it names where it goes —
          with the trail beside it for jumping more than one link at a time. */}
      {/* Only once there is somewhere to come back FROM. At the top of the walk
          the trail is one inert button naming the level the card already names —
          "USA Nationwide" printed twice a centimetre apart (Andre, 2026-08-28). */}
      {path.length > 0 && (
      <nav className="sales-crumbs" aria-label="Where you are">
        {backPath !== null && (
          <button type="button" className="sales-back" onClick={() => goTo(backPath)}>
            <span className="sales-back-arrow" aria-hidden="true">
              &#8249;
            </span>
            {backLabel}
          </button>
        )}
        <span className="sales-trail">
          <button
            type="button"
            onClick={() => goTo([])}
            aria-current={path.length === 0 ? "step" : undefined}
          >
            {SELL_ROOT_LABEL[lens]}
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
        </span>
      </nav>
      )}

      {/* Keyed on the walk, so each level enters rather than swapping in place —
          the same remount trick the page sections use. */}
      {desk && path.length === 0 ? (
        <SalesBook
          key={`book-${lens}-${mode}`}
          step={step}
          current={current}
          prior={prior}
          lens={lens}
          branches={branches}
          previous={previous}
          mv={mv}
          month={month}
          months={mode === "ytd" ? undefined : months}
          pickedMonth={latest}
          onPickMonth={onPickMonth}
        />
      ) : (
      <div className="sales-step" key={`${lens}-${mode}-${pathKey}`}>
        <div className="card card-pad">
          {/* THE FIRST BAR IS THE TOTAL.
              A grand total with no bar, sitting above a column of bars, reads as
              the one number that was left out of the picture. The mix of the
              month is worth seeing before whose mix it is.

              It is deliberately UNTITLED. Calling it "All reps" would make it lie
              the moment the counter travels to a chosen band — "All reps ·
              28,400 LF" is a false sentence. The rail and the number are its
              identity: this is the figure you are currently reading, and this is
              what it is made of.

              The bar is skipped when there is only one row, because that row's
              own bar is already the same picture. */}
          <div className="sales-row">
            {/* The name disappears the moment the counter travels to a chosen
                stripe — "USA Nationwide · 46,436 LF" narrowed to one market is
                exactly the false sentence the untitled bar was avoiding. */}
            {cleanTop && summaryOpen === null && (
              <p className="sales-title">USA Nationwide</p>
            )}
            <p className="sales-count">
              {showCounterFigure && (
                <>
                  {/* At the clean top the rail is furniture: the title above
                      says whose figure this is and the bar below says its
                      composition. It returns the moment a market is isolated —
                      then the colour IS the answer to "whose number is this". */}
                  {!(cleanTop && summaryOpen === null) && (
                    <span
                      className="sales-count-rail"
                      style={{ background: counterRail }}
                      aria-hidden="true"
                    />
                  )}
                  {/* aria-hidden on the travelling figure and the true one
                      announced once: a screen reader being read sixty
                      intermediate numbers is not being told anything. */}
                  <span
                    className={
                      cleanTop ? "sales-count-qty sales-count-hero" : "sales-count-qty"
                    }
                    aria-hidden="true"
                  >
                    {QTY.format(Math.round(counterQty))} {step.unit}
                  </span>
                  <span className="sr-only">
                    {QTY.format(counterTarget)} {step.unit}
                  </span>
                </>
              )}
              {/* No "total" next to it — the figure travels when a stripe is
                  isolated, and a word that has to come and go with the reading
                  is better left off (Andre tried it, 2026-08-28). */}
              <span className="sales-count-when">
                {showCounterFigure ? `· ${month}` : month}
              </span>
              {showCounterFigure && stepMoved && (
                <span
                  className="sales-move sales-count-move"
                  data-dir={moveDir(counterTarget, counterPrev, previous)}
                >
                  {stepMoved}
                </span>
              )}
            </p>

            {step.summary && (
              <>
                {/* Taller than every bar below it. The stripes up here isolate
                    and the stripes down there walk, and nothing on the screen
                    said so — two bars a centimetre apart, painted the same,
                    answering a tap differently. The height is the tell: the
                    month itself stands above the shares of it. */}
                <div
                  className="sales-track sales-track-total"
                  data-phase={summaryOpen ? phase : "idle"}
                >
                  {step.summary.segments.map((seg) => {
                    const chosenHere = summaryOpen !== null;
                    const isOpen = summaryOpen?.key === seg.key;
                    const band = seg.band;
                    return (
                      <button
                        key={seg.key}
                        type="button"
                        className="sales-seg"
                        style={{
                          flexGrow: 0,
                          flexBasis: !chosenHere
                            ? `${seg.share}%`
                            : isOpen
                              ? phase === "slide"
                                ? `${seg.share}%`
                                : "100%"
                              : "0%",
                          background: seg.colour,
                        }}
                        data-dimmed={chosenHere && !isOpen}
                        aria-pressed={isOpen}
                        aria-label={
                          // The two taps do different things, so the label has
                          // to change between them or the second one is a door
                          // nobody was told about.
                          `${seg.name}: ${QTY.format(seg.qty)} ${step.unit} of the total` +
                          (isOpen
                            ? ", press again to show them all"
                            : ", shows only this one")
                        }
                        disabled={band === null}
                        onClick={() => band && tap(step.summary!, band)}
                      />
                    );
                  })}
                </div>

                {/* NOTHING UNFOLDS HERE, and that is the point.

                    A panel used to open under this bar naming the chosen stripe,
                    its quantity and its share. Two of those three were already on
                    the screen — the counter above had travelled to that quantity
                    and put on that colour, and the bar itself had gone all one
                    colour — while the rows below carried on as if nothing had
                    been picked. So the reader chose a region and got a worse copy
                    of the row that was already sitting underneath, and the rest
                    of the card ignored them.

                    What the tap does instead is ISOLATE: see the rows below. */}
              </>
            )}
          </div>

          {cleanTop && <p className="sales-eyebrow">Markets</p>}

          {step.groups.map((g) => {
            const open = chosenGroup?.key === g.key ? chosenBand : null;
            const moved = movementLabel(g.total, g.prevTotal, previous, mv);
            const openMoved = open
              ? movementLabel(open.qty, open.prevQty, previous, mv)
              : null;
            const isolated = isolatedKey !== null && g.key === isolatedKey;
            // The isolated row's stripe on the total bar, looked up by key
            // rather than read off the selection — the selection may be three
            // taps away on a distributor by now, and this row's share of the
            // month and its way out must not vanish because of that.
            const rowSummaryBand =
              isolated && step.summary !== null
                ? (step.summary.bands.find((b) => b.key === g.key) ?? null)
                : null;
            const shrunk = isolatedKey !== null && !isolated;
            // Coming back from a release: whole again, but brightening up as the
            // bar unfolds instead of landing in front of it. The row that was
            // let go of is not one of these — it never went anywhere.
            const returning =
              isolatedKey === null && releasing !== null && g.key !== releasing;

            // Shrunk, this row is a way back into the bar rather than a reading
            // of the month: the colour so it can be matched to the stripe it
            // owns, the name, and the figure. No Market Owner, no bar of its
            // own, no bands, no coverage — every one of those is an answer to a
            // question the reader has just said they are not asking.
            if (shrunk) {
              const band = step.summary?.bands.find((b) => b.key === g.key) ?? null;
              return (
                <div
                  key={g.key}
                  className="sales-row sales-row-shrunk"
                >
                  <button
                    type="button"
                    className="sales-head sales-head-shrunk"
                    disabled={band === null}
                    aria-label={`${g.title}: ${QTY.format(g.total)} ${g.unit}. Show only this ${DIM_NOUN[step.rowDim] ?? "row"}.`}
                    onClick={() => band && step.summary && tap(step.summary, band)}
                  >
                    {g.colour && (
                      <span
                        className="sales-item-rail"
                        style={{ background: g.colour }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="sales-head-body">
                      <span className="sales-head-name">{g.title}</span>
                    </span>
                    <span className="sales-head-fig">
                      <span className="sales-head-qty">
                        {QTY.format(g.total)} {g.unit}
                      </span>
                    </span>
                  </button>
                </div>
              );
            }

            // THE CLEAN MARKET ROW. A name and its share of the country, and
            // nothing else — the width IS the figure, read against the total
            // bar above the same way its stripe is. Tapping it does NOT leave:
            // it isolates, the same reading its stripe on the total bar gives —
            // the full row opens IN PLACE and the others shrink around it. The
            // level below is a second, deliberate step, behind the chevron the
            // isolated row wears (Andre, 2026-08-28: first a little detail here,
            // THEN the screen with much more). No chevron here — in this card a
            // chevron means a LEVEL, and a peek is not one.
            if (cleanTop && !isolated) {
              const share = step.summary
                ? (step.summary.bands.find((b) => b.key === g.key)?.share ?? 0)
                : 100;
              const band = step.summary?.bands.find((b) => b.key === g.key) ?? null;
              return (
                <div
                  key={g.key}
                  className={returning ? "sales-row sales-row-return" : "sales-row"}
                >
                  <button
                    type="button"
                    className="sales-market"
                    aria-label={`${g.title}: ${QTY.format(g.total)} ${g.unit} in ${month}. Shows its details here.`}
                    onClick={() => {
                      if (band && step.summary) tap(step.summary, band);
                      else goTo([stepFor(g.entity, g.colour ?? undefined)]);
                    }}
                  >
                    <span className="sales-market-head">
                      <span className="sales-head-name">{g.title}</span>
                    </span>
                    {/* The figure rides in front of the bar in a fixed mono
                        column, so every track still starts at the same x and
                        the widths stay comparable down the list. */}
                    <span className="sales-market-meter">
                      <span className="fig-sm sales-market-qty">
                        {QTY.format(g.total)} {g.unit}
                      </span>
                      <span className="sales-market-track">
                        <span
                          className="sales-market-fill"
                          style={{
                            width: `${share}%`,
                            background: g.colour ?? "var(--surface-sunken)",
                          }}
                        />
                      </span>
                    </span>
                  </button>
                </div>
              );
            }

            return (
              <div
                key={g.key}
                className={returning ? "sales-row sales-row-return" : "sales-row"}
              >
                {(() => {
                  const body = (
                    <>
                      {/* The row's own colour, the one it has in the total bar
                          above. Same 4px stripe the band rows wear, because it
                          is the same idea one level up: this stripe is that
                          slice. Without it the total split into six colours and
                          the rows named six things in black, and matching them
                          up meant counting segments. */}
                      {g.colour && (
                        <span
                          className="sales-item-rail sales-head-rail"
                          style={{ background: g.colour }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="sales-head-body">
                        <span className="sales-head-name">{g.title}</span>
                        {/* Under the Region lens this second line is the Market
                            Owner — the one place on the screen where "Texas ·
                            no Market Owner yet" can be read, which is the whole
                            reason the region is the top of the walk. */}
                        {/* The money keeps the mono, so a figure inside a
                            sentence still reads as a figure and not as a word. */}
                        <span className="sales-head-sub">
                          {g.sub}
                          {/* The share, and ONLY while this row is the one the
                              total bar was narrowed to. It is the single fact
                              the panel that used to open above was telling the
                              reader that the row itself does not: not what this
                              region bought, but how much of the month was
                              theirs. It rides in the sub-line because the right
                              of the row already belongs to the quantity and the
                              movement, and pushing a third figure in there
                              would unalign all fifteen rows to say one thing
                              about one of them. */}
                          {rowSummaryBand !== null && (
                            <>
                              {g.sub ? " · " : ""}
                              <span className="fig-sm">
                                {Math.round(rowSummaryBand.share)}%
                              </span>
                              {` of ${month}`}
                            </>
                          )}
                          {(g.sub || isolated) && g.value !== null ? " · " : ""}
                          {g.value !== null && (
                            <span className="fig-sm">
                              {formatMoney(Math.round(g.value))}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="sales-head-fig">
                        <span className="sales-head-qty">
                          {QTY.format(g.total)} {g.unit}
                        </span>
                        <span
                          className="sales-move"
                          data-dir={moveDir(g.total, g.prevTotal, previous)}
                        >
                          {moved ?? "no earlier file"}
                        </span>
                      </span>
                    </>
                  );

                  // Below depth 0 there is exactly one row, and it is the thing
                  // that was tapped to get here — so it is also the way out. The
                  // gesture mirrors itself: a row with a chevron on the RIGHT
                  // goes in, the row you are standing in wears one on the LEFT
                  // and comes back out. Nobody has to be taught that.
                  if (backPath !== null) {
                    return (
                      <button
                        type="button"
                        className="sales-head sales-head-back"
                        onClick={() => goTo(backPath)}
                        aria-label={`Back to ${backLabel}`}
                      >
                        <span className="sales-head-up" aria-hidden="true">
                          &#8249;
                        </span>
                        {body}
                      </button>
                    );
                  }

                  // The isolated row is a toggle AND a doorway. Pressing the row
                  // lets go, exactly as pressing its stripe again does. The
                  // chevron beside it is the second, deliberate step Andre asked
                  // for: first the details in place, and only through this does
                  // the walk actually leave for the market's own level. Chevron
                  // = level still holds — this one IS a level.
                  if (isolated && rowSummaryBand !== null && step.summary !== null) {
                    return (
                      <div className="sales-head-gorow">
                        <button
                          type="button"
                          className="sales-head sales-head-open"
                          aria-pressed={true}
                          aria-label={`${g.title}. Show every ${DIM_NOUN[step.rowDim] ?? "row"} again.`}
                          onClick={() => tap(step.summary!, rowSummaryBand)}
                        >
                          {body}
                        </button>
                        <button
                          type="button"
                          className="sales-head-go"
                          aria-label={`Open ${g.title}`}
                          onClick={() => goTo([stepFor(g.entity, g.colour ?? undefined)])}
                        >
                          <span aria-hidden="true">&#8250;</span>
                        </button>
                      </div>
                    );
                  }

                  return <div className="sales-head">{body}</div>;
                })()}

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
                {(() => {
                  // THE SAME ISOLATION, AT THE END OF THE CHAIN. A terminal
                  // band's panel answers for one dealer, and fourteen sibling
                  // rows at full weight underneath it made the answer hard to
                  // find on the screen that was showing it — Andre's words:
                  // the chart marks who it is but hides nobody. So while a
                  // panel is open its siblings set back to a colour, a name
                  // and a figure, exactly what the shrunk rows keep at depth
                  // 0. On the fill, like every narrowing on this card.
                  const held =
                    open !== null && !open.drillable && phase !== "slide"
                      ? open
                      : null;
                  return (
                <ul className="sales-list">
                  {g.bands.map((b) => {
                    if (held !== null && b.key !== held.key) {
                      return (
                        <li key={b.key}>
                          <button
                            type="button"
                            className="sales-item sales-item-set-back"
                            onClick={() => tap(g, b)}
                          >
                            <span
                              className="sales-item-rail"
                              style={{ background: b.colour }}
                              aria-hidden="true"
                            />
                            <span className="sales-item-body">
                              <span className="sales-item-name">{b.name}</span>
                            </span>
                            <span className="sales-item-fig">
                              <span className="sales-item-qty">
                                {QTY.format(b.qty)} {g.unit}
                              </span>
                            </span>
                            <span className="sales-item-go" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    }

                    const bandMoved = movementLabel(b.qty, b.prevQty, previous, mv);
                    const bandReturning =
                      held === null &&
                      bandReleasing !== null &&
                      b.key !== bandReleasing;
                    return (
                      <li key={b.key}>
                        <button
                          type="button"
                          className={
                            bandReturning
                              ? "sales-item sales-item-return"
                              : "sales-item"
                          }
                          aria-pressed={open?.key === b.key}
                          onClick={() => tap(g, b)}
                        >
                          {/* The rail only where the meter is not there to
                              carry the colour — same rule as depth 0: a clean
                              row wears its colour as the bar, a set-back row
                              keeps the rail as its one remaining colour. */}
                          {g.bands.length <= 1 && (
                            <span
                              className="sales-item-rail"
                              style={{ background: b.colour }}
                              aria-hidden="true"
                            />
                          )}
                          {/* The line, then the same reading the markets get:
                              the band's share of THIS level as a width, on the
                              same track (Andre, 2026-08-28 — the ruler at the
                              top runs the whole way down the chain). A column
                              wrapper so the meter spans name and figure alike
                              and every row's track starts at the same x. */}
                          <span className="sales-item-main">
                            <span className="sales-item-line">
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
                            </span>
                            {g.bands.length > 1 && (
                              <span
                                className="sales-market-track sales-item-track"
                                aria-hidden="true"
                              >
                                <span
                                  className="sales-market-fill"
                                  style={{
                                    width: `${b.share}%`,
                                    background: b.colour,
                                  }}
                                />
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                  );
                })()}

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
                    would give the eye two things to follow at once.

                    AND NEVER FOR A BAND THAT IS ON ITS WAY DOWN A LEVEL. For a
                    drillable band the fill IS the transition — four hundred and
                    sixty milliseconds later the card is replaced by the next
                    level. Opening the panel in that window built "Last seen ·
                    Loading…" on every single drill, held it just long enough to
                    be read as a mistake, and threw it away unanswered. The panel
                    belongs to the bands with nowhere left to go, which is what
                    it was written for. */}
                {open && phase !== "slide" && !open.drillable && (
                  <div className="sales-detail">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="t-title">
                        {open.name}
                        {open.entity.sub ? (
                          <>
                            {" "}
                            <span className="t-hint">{open.entity.sub}</span>
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
      )}

      {/* The monthly footnote is gone by request (Andre, 2026-09-01) — the
          card explains itself now. The YTD reading keeps its one line: an
          aggregate that cannot be split into months is a real limitation the
          reader cannot guess. */}
      {ytdOn && (
        <p className="t-sub px-1">
          The distributors&rsquo; own year-to-date report, January through{" "}
          {periodLabel(latest)} — one aggregate, so the months inside it
          cannot be told apart. Movement is against the same window last year.
        </p>
      )}

      {/* The files do not arrive together. When one house's month lands before
          another's, the screen moves to the newer month and the slower house
          drops out of every total on it — nothing is wrong with the maths, and
          the page simply halves. Saying whose file is missing is the difference
          between a dashboard that understates the channel and one that explains
          itself. */}
      {waiting.length > 0 && (
        <p className="sales-waiting px-1">
          {`${waiting.join(" and ")} ${
            waiting.length === 1 ? "has" : "have"
          } not sent ${month} yet, so none of their volume is in these figures.`}
        </p>
      )}
    </section>
  );
}

// ── The open book — the desk's reading of the sales card ─────────────────────
//
// Two pages, both always visible: MARKETS on the left, the picked market's
// chain on the right — distributor, branch, dealer, each level one click
// deeper inside the same pane. Its own component so the pane's walk is its
// own state, born again whenever the lens or the window flips (the parent
// keys it), and so none of the phone's walk/isolation machinery is touched:
// the book is a READER over the same built steps, not a second writer.
function SalesBook({
  step,
  current,
  prior,
  lens,
  branches,
  previous,
  mv,
  month,
  months,
  pickedMonth,
  onPickMonth,
}: {
  step: ReturnType<typeof buildStep>;
  current: readonly SellThroughRow[];
  prior: readonly SellThroughRow[];
  lens: SellLens;
  branches: readonly BranchRef[];
  previous: string | null;
  mv?: { on?: string; fresh?: string };
  month: string;
  /** Undefined under the YTD window — a year has no month to pick. */
  months?: readonly string[];
  pickedMonth?: string | null;
  onPickMonth?: (period: string) => void;
}) {
  const colourOf = (key: string) =>
    step.summary?.bands.find((b) => b.key === key)?.colour ?? "var(--ink-muted)";

  // The pane's own walk, born on the biggest row — the book opens on the
  // page most worth reading, and picking never narrows the page around it.
  const [panePath, setPanePath] = useState<PathStep[]>(() =>
    lens !== "region" && step.groups[0]
      ? [stepFor(step.groups[0].entity, colourOf(step.groups[0].key))]
      : [],
  );
  const paneStep = useMemo(
    () => buildStep(current, prior, lens, panePath, branches),
    [current, prior, lens, panePath, branches],
  );
  // Below the top there is exactly one row: the thing the pane walked into.
  const g = paneStep.groups[0] ?? null;
  const gMoved = g ? movementLabel(g.total, g.prevTotal, previous, mv) : null;

  // What each region card shows besides its number: the branches that make
  // up its bar and the dealers behind it — read straight off the rows, so a
  // region with one distributor still has texture.
  const cardExtras = useMemo(() => {
    const map = new Map<
      string,
      {
        branchSegs: { key: string; name: string; qty: number }[];
        dealers: { name: string; qty: number }[];
        dealerCount: number;
      }
    >();
    if (lens !== "region") return map;
    const byRegion = new Map<string, SellThroughRow[]>();
    for (const r of current) {
      const k = r.region_id ?? "unmapped";
      const list = byRegion.get(k);
      if (list) list.push(r);
      else byRegion.set(k, [r]);
    }
    for (const [k, list] of byRegion) {
      const br = new Map<string, { key: string; name: string; qty: number }>();
      const dl = new Map<string, { name: string; qty: number }>();
      for (const r of list) {
        const q = Number(r.quantity) || 0;
        const b = br.get(r.branch_id);
        if (b) b.qty += q;
        else br.set(r.branch_id, { key: r.branch_id, name: r.branch_name, qty: q });
        const d = dl.get(r.dealer_label);
        if (d) d.qty += q;
        else dl.set(r.dealer_label, { name: r.dealer_name ?? r.dealer_label, qty: q });
      }
      const dealers = [...dl.values()].sort((a, b) => b.qty - a.qty);
      map.set(k, {
        branchSegs: [...br.values()].sort((a, b) => b.qty - a.qty),
        dealers: dealers.slice(0, 4),
        dealerCount: dealers.length,
      });
    }
    return map;
  }, [current, lens]);

  // ONE PANE, TWO LAYOUTS: the book's right page and the region view's
  // unfold beneath the cards are the same reader.
  const paneView = (
    <>
          {/* THE RIGHT PAGE: the picked market's chain. The trail walks deeper
              inside the pane — distributor, branch, dealer — and back. */}
          <div className="sales-book-pane">
            {panePath.length > 1 && (
              <nav className="sales-trail bkp-trail" aria-label="Reading">
                {panePath.map((s, i) => (
                  <button
                    key={`${s.dim}-${s.key}`}
                    type="button"
                    onClick={() => setPanePath(panePath.slice(0, i + 1))}
                    aria-current={i === panePath.length - 1 ? "step" : undefined}
                  >
                    {s.name}
                  </button>
                ))}
              </nav>
            )}

            {g === null ? (
              <p className="t-sub">Nothing sold here in {month}.</p>
            ) : (
              <>
                <div className="bkp-head">
                  <span className="min-w-0">
                    <span className="sales-head-name">{g.title}</span>
                    {(g.sub || g.value !== null) && (
                      <span className="sales-head-sub">
                        {g.sub}
                        {g.sub && g.value !== null ? " · " : ""}
                        {g.value !== null && (
                          <span className="fig-sm">
                            {formatMoney(Math.round(g.value))}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="sales-head-fig">
                    <span className="sales-head-qty">
                      {QTY.format(g.total)} {g.unit}
                    </span>
                    <span
                      className="sales-move"
                      data-dir={moveDir(g.total, g.prevTotal, previous)}
                    >
                      {gMoved ?? "no earlier file"}
                    </span>
                  </span>
                </div>

                {g.segments.length > 1 && (
                  <div className="sales-track bkp-track" aria-hidden="true">
                    {g.segments.map((seg) => (
                      <span
                        key={seg.key}
                        className="sales-seg"
                        style={{
                          flexGrow: 0,
                          flexBasis: `${seg.share}%`,
                          background: seg.colour,
                        }}
                      />
                    ))}
                  </div>
                )}

                <ul className="sales-list">
                  {g.bands.map((b) => {
                    const bandMoved = movementLabel(b.qty, b.prevQty, previous, mv);
                    const inner = (
                      <span className="sales-item-main">
                        <span className="sales-item-line">
                          <span className="sales-item-body">
                            <span className="sales-item-name">{b.name}</span>
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
                                g.bands.length > 1
                                  ? `${Math.round(b.share)}%`
                                  : null,
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
                        </span>
                        {g.bands.length > 1 && (
                          <span
                            className="sales-market-track sales-item-track"
                            aria-hidden="true"
                          >
                            <span
                              className="sales-market-fill"
                              style={{
                                width: `${b.share}%`,
                                background: b.colour,
                              }}
                            />
                          </span>
                        )}
                      </span>
                    );
                    return (
                      <li key={b.key}>
                        {b.drillable ? (
                          <button
                            type="button"
                            className="sales-item"
                            onClick={() =>
                              setPanePath([
                                ...panePath,
                                stepFor(b.entity, b.colour),
                              ])
                            }
                          >
                            {inner}
                          </button>
                        ) : (
                          <div className="sales-item">{inner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
    </>
  );

  // WHAT they are buying, as shares — the product mix of whatever the pane
  // is open on, so it follows the walk: a region's mix, then one
  // distributor's, then one branch's, then one dealer's. Products are not a
  // link of the chain, so the walk alone can never answer "how much of this
  // is decking" — this can.
  const productMix = useMemo(() => {
    if (lens !== "region" || panePath.length === 0) return [];
    const byProduct = new Map<string, number>();
    let total = 0;
    for (const r of current) {
      if (!rowMatchesPath(r, panePath)) continue;
      const q = Number(r.quantity) || 0;
      const name = r.product?.trim() || "unspecified";
      byProduct.set(name, (byProduct.get(name) ?? 0) + q);
      total += q;
    }
    if (total <= 0) return [];
    return [...byProduct.entries()]
      .map(([name, qty]) => ({ name, qty, share: (100 * qty) / total }))
      .sort((a, b) => b.qty - a.qty);
  }, [lens, panePath, current]);

  // The region view's one selection: nothing at first — the country —
  // then whatever ground was clicked, on the map, the bar's key, or a card.
  const picked = lens === "region" ? (panePath[0]?.key ?? null) : null;
  const pickRegion = (key: string | null) => {
    if (key === null || key === picked) {
      setPanePath([]);
      return;
    }
    const m = step.groups.find((g) => g.key === key);
    if (m) setPanePath([stepFor(m.entity, colourOf(m.key))]);
  };

  return (
    <div className="sales-step">
      <div className="card card-pad">
        {/* The masthead FOLLOWS THE PICK (Andre, 2026-09-02): at rest it is
            the country; click a market's ground — a stripe of the total bar,
            its state, its card — and the name and the figure become that
            market's, sliding in. The key remounts the row so the slide plays
            on every change of subject, and the same click on the picked
            ground brings the country back the same way. */}
        {(() => {
          const pickedGroup =
            lens === "region" && picked
              ? (step.groups.find((g) => g.key === picked) ?? null)
              : null;
          const mastTitle = pickedGroup ? pickedGroup.title : SELL_ROOT_LABEL[lens];
          const mastTotal = pickedGroup ? pickedGroup.total : step.total;
          const mastPrev = pickedGroup
            ? pickedGroup.prevTotal
            : step.groups.reduce((n, x) => n + x.prevTotal, 0);
          const m = movementLabel(mastTotal, mastPrev, previous, mv);
          return (
            <div
              key={pickedGroup ? pickedGroup.key : "country"}
              className="sales-row sales-masthead"
            >
              <p className="sales-title">{mastTitle}</p>
              <p className="sales-count">
                <span className="sales-count-qty sales-count-hero">
                  {QTY.format(Math.round(mastTotal))} {step.unit}
                </span>
                {/* The WHEN is a picker once the book holds more than one
                    month (the YTD window passes no months — a year has no
                    month to pick). The native select sits invisible over the
                    label — the menu is the browser's, the label stays the
                    masthead's. */}
                {onPickMonth && months && months.length > 1 ? (
                  <span className="sales-count-when sales-when-pick">
                    · {month}
                    <ChevronDownIcon size={11} aria-hidden="true" />
                    <select
                      value={pickedMonth ?? ""}
                      aria-label="Which month to read"
                      onChange={(e) => onPickMonth(e.target.value)}
                    >
                      {months.map((p) => (
                        <option key={p} value={p}>
                          {periodLabel(p)}
                        </option>
                      ))}
                    </select>
                  </span>
                ) : (
                  <span className="sales-count-when">· {month}</span>
                )}
                {m ? (
                  <span
                    className="sales-move sales-count-move"
                    data-dir={moveDir(mastTotal, mastPrev, previous)}
                  >
                    {m}
                  </span>
                ) : null}
              </p>
            </div>
          );
        })()}

        {lens === "region" ? (
          /* THE REGION VIEW IS THE COUNTRY: the map first — coverage and
             sales in one look — then every market as its own card with its
             bar, its branches and its dealers, then the picked market's
             chain, full width, underneath. */
          <>
            {/* THE TOTAL BAR, back over the whole spread — the same segmented
                read the phone opens on, and the key the map inherits. Each
                stripe is the same clickable ground as its states and its card:
                click the blue and the masthead becomes Southern California;
                click it again and the country returns. */}
            {step.summary && (
              <div className="sales-track sales-track-total">
                {step.summary.segments.map((seg) => {
                  const g = step.groups.find((x) => x.key === seg.key);
                  return (
                    <button
                      key={seg.key}
                      type="button"
                      className="sales-seg sales-seg-click"
                      aria-label={
                        g
                          ? `${g.title} — ${QTY.format(g.total)} ${g.unit}`
                          : undefined
                      }
                      aria-pressed={picked === seg.key}
                      onClick={() => pickRegion(seg.key)}
                      style={{
                        flexGrow: 0,
                        flexBasis: `${seg.share}%`,
                        background: seg.colour,
                        opacity: picked === null || seg.key === picked ? 1 : 0.22,
                      }}
                    />
                  );
                })}
              </div>
            )}
            <div
              className="sales-country"
              data-picked={picked ? "true" : undefined}
            >
              <SalesMap
                rows={current}
                branches={branches}
                unit={step.unit}
                month={month}
                regionHue={
                  new Map(step.groups.map((m) => [m.key, colourOf(m.key)]))
                }
                picked={picked}
                onPick={pickRegion}
              />
              {picked ? (
                <div className="sales-region-module">
                  <button
                    type="button"
                    className="sales-module-back"
                    onClick={() => setPanePath([])}
                  >
                    ‹ USA Nationwide
                  </button>
                  {paneView}
                  {productMix.length > 0 && (
                    <div className="pmix">
                      <p className="sales-eyebrow">
                        What they&rsquo;re buying
                        {panePath.length > 1
                          ? ` — ${panePath[panePath.length - 1].name}`
                          : ""}
                      </p>
                      {/* every product, in a window that scrolls — a
                          "+ 41 more" is a door; a scroll is the room */}
                      <ul className="pmix-list pmix-scroll">
                        {productMix.map((prod) => (
                          <li key={prod.name} className="pmix-row">
                            <span className="pmix-name">{prod.name}</span>
                            <span className="fig-sm pmix-share">
                              {prod.share >= 1
                                ? Math.round(prod.share)
                                : "<1"}
                              %
                            </span>
                            <span className="fig-sm pmix-qty">
                              {QTY.format(prod.qty)} {step.unit}
                            </span>
                            <span
                              className="sales-market-track"
                              aria-hidden="true"
                            >
                              <span
                                className="sales-market-fill"
                                style={{
                                  width: `${Math.max(prod.share, 1)}%`,
                                  background: colourOf(picked ?? ""),
                                }}
                              />
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                /* AT REST the right page is the markets themselves — name,
                   figure and share bar, the whole country in one glance.
                   Clicking one is the same gesture as clicking its ground. */
                <div className="sales-country-list">
                  <p className="sales-eyebrow">Markets</p>
                  <ul className="list">
                    {step.groups.map((m) => {
                      const share = step.summary
                        ? (step.summary.bands.find((b) => b.key === m.key)
                            ?.share ?? 0)
                        : 100;
                      return (
                        <li key={m.key}>
                          <button
                            type="button"
                            className="bkm-row"
                            onClick={() => pickRegion(m.key)}
                          >
                            <span className="bkm-head">
                              <span className="bkm-name">{m.title}</span>
                              <span className="fig-sm bkm-qty">
                                {QTY.format(m.total)} {m.unit}
                              </span>
                            </span>
                            <span
                              className="sales-market-track"
                              aria-hidden="true"
                            >
                              <span
                                className="sales-market-fill"
                                style={{
                                  width: `${share}%`,
                                  background: colourOf(m.key),
                                }}
                              />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
            <div
              className="sales-region-cards"
              style={{
                gridTemplateColumns: `repeat(${Math.max(step.groups.length, 1)}, minmax(0, 1fr))`,
              }}
            >
              {step.groups.map((m) => {
                const isPicked = picked === m.key;
                const ex = cardExtras.get(m.key);
                const hue = colourOf(m.key);
                const moved = movementLabel(m.total, m.prevTotal, previous, mv);
                const topDealer = ex?.dealers[0]?.qty ?? 1;
                return (
                  <button
                    key={m.key}
                    type="button"
                    className="rcard"
                    aria-pressed={isPicked}
                    data-dim={picked !== null && !isPicked ? true : undefined}
                    onClick={() => pickRegion(m.key)}
                  >
                    <span className="rcard-name">{m.title}</span>
                    {/* the movement gets its own line — sharing the name's
                        line truncated both, and the name loses that fight */}
                    {moved && (
                      <span
                        className="sales-move rcard-move"
                        data-dir={moveDir(m.total, m.prevTotal, previous)}
                      >
                        {moved}
                      </span>
                    )}
                    <span className="sales-count-qty rcard-qty">
                      {QTY.format(m.total)} {m.unit}
                    </span>
                    {/* the market's own total bar — one shade per branch */}
                    <span className="sales-track rcard-track" aria-hidden="true">
                      {(ex?.branchSegs ?? []).map((b, i) => (
                        <span
                          key={b.key}
                          className="sales-seg"
                          style={{
                            flexGrow: 0,
                            flexBasis: `${(100 * b.qty) / Math.max(m.total, 1)}%`,
                            background: `color-mix(in srgb, ${hue} ${Math.max(92 - i * 18, 28)}%, var(--map-ground))`,
                          }}
                        />
                      ))}
                    </span>
                    {ex && ex.branchSegs.length > 1 && (
                      <span className="rcard-branches t-hint">
                        {ex.branchSegs.map((b) => b.name).join(" · ")}
                      </span>
                    )}
                    <span className="rcard-dealers">
                      {(ex?.dealers ?? []).map((d) => (
                        <span key={d.name} className="rcard-dealer">
                          <span className="rcard-dealer-line">
                            <span className="rcard-dealer-name">{d.name}</span>
                            <span className="fig-sm rcard-dealer-qty">
                              {QTY.format(d.qty)}
                            </span>
                          </span>
                          <span
                            className="sales-market-track"
                            aria-hidden="true"
                          >
                            <span
                              className="sales-market-fill"
                              style={{
                                width: `${(100 * d.qty) / topDealer}%`,
                                background: hue,
                              }}
                            />
                          </span>
                        </span>
                      ))}
                      {ex && ex.dealerCount > 4 && (
                        <span className="t-hint">
                          + {ex.dealerCount - 4} more dealers
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
        {/* The chart: all markets, all distributors, one glance — and a
            click on any column turns the book. Columns only work for a
            handful of categories; a long roster (the dealer lens) falls
            back to the flat share bar. */}
        {step.groups.length > 8 && step.summary && (
          <div className="sales-track sales-track-total" aria-hidden="true">
            {step.summary.segments.map((seg) => (
              <span
                key={seg.key}
                className="sales-seg"
                style={{
                  flexGrow: 0,
                  flexBasis: `${seg.share}%`,
                  background: seg.colour,
                }}
              />
            ))}
          </div>
        )}
        {step.groups.length > 0 && step.groups.length <= 8 && (
          <SalesColumns
            groups={step.groups}
            unit={step.unit}
            onPick={(key) => {
              const m = step.groups.find((x) => x.key === key);
              if (m) setPanePath([stepFor(m.entity, colourOf(m.key))]);
            }}
          />
        )}
            <div className="sales-book">
          {/* THE LEFT PAGE: every market, its share as a width, the picked one
              marked. Clicking turns the right page — nothing else moves. */}
          <div className="sales-book-markets">
            <p className="sales-eyebrow">
              {lens === "rep"
                ? "Reps"
                : lens === "distribution"
                  ? "Distributors"
                  : "Dealers"}
            </p>
            <ul className="list">
              {step.groups.map((m) => {
                const picked = panePath[0]?.key === m.key;
                const share = step.summary
                  ? (step.summary.bands.find((b) => b.key === m.key)?.share ?? 0)
                  : 100;
                return (
                  <li key={m.key}>
                    <button
                      type="button"
                      className="bkm-row"
                      aria-pressed={picked}
                      onClick={() =>
                        setPanePath([stepFor(m.entity, colourOf(m.key))])
                      }
                    >
                      <span className="bkm-head">
                        <span className="bkm-name">{m.title}</span>
                        <span className="fig-sm bkm-qty">
                          {QTY.format(m.total)} {m.unit}
                        </span>
                      </span>
                      <span className="sales-market-track" aria-hidden="true">
                        <span
                          className="sales-market-fill"
                          style={{
                            width: `${share}%`,
                            background: colourOf(m.key),
                          }}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

              {paneView}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── The columns — every market, every distributor, one glance ────────────────
//
// The book's masthead grows a real chart on the desk: one column per market,
// stacked by DISTRIBUTOR, and — the part the horizontal bar could never say —
// the colour follows the distributor ACROSS columns. Boise is the same blue
// in every market, so "where is Boise" is answered by the eye alone. Hues
// come from the app's fixed categorical ramp (assigned by total, never
// cycled; anything past the ramp folds into the grey rest), and the two
// low-contrast steps are covered the way the palette validator demands:
// totals labelled in ink, a legend, and a per-segment tooltip.
function SalesColumns({
  groups,
  unit,
  onPick,
}: {
  groups: ReturnType<typeof buildStep>["groups"];
  unit: string;
  /** Clicking a column turns the book to that market. */
  onPick: (key: string) => void;
}) {
  const [hover, setHover] = useState<{
    market: string;
    band: string;
    qty: number;
    share: number;
    x: number;
    y: number;
  } | null>(null);

  // The distributor palette: fixed order by total across ALL markets — a
  // filter or a re-pick must never repaint the survivors.
  const byDist = new Map<string, { name: string; total: number }>();
  for (const g of groups) {
    for (const b of g.bands) {
      const seen = byDist.get(b.entity.key);
      if (seen) seen.total += b.qty;
      else byDist.set(b.entity.key, { name: b.name, total: b.qty });
    }
  }
  const ramp = [
    "var(--cat-1)",
    "var(--cat-2)",
    "var(--cat-3)",
    "var(--cat-4)",
    "var(--cat-5)",
    "var(--cat-6)",
    "var(--cat-7)",
    "var(--cat-8)",
  ];
  const distOrder = [...byDist.entries()].sort((a, b) => b[1].total - a[1].total);
  const distColour = new Map<string, string>();
  distOrder.forEach(([key], i) => {
    distColour.set(key, i < ramp.length ? ramp[i] : "var(--cat-rest)");
  });

  const maxTotal = Math.max(...groups.map((g) => g.total), 1);

  return (
    <div className="cols-wrap">
      <div className="cols" role="img" aria-label="Volume by market, stacked by distributor">
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            className="col"
            onClick={() => onPick(g.key)}
            aria-label={`${g.title}: ${QTY.format(g.total)} ${unit}. Open in the book.`}
          >
            <span className="fig-sm col-total">
              {QTY.format(g.total)}
            </span>
            <span
              className="col-stack"
              style={{ height: `${Math.max((180 * g.total) / maxTotal, 4)}px` }}
            >
              {[...g.bands]
                .slice()
                .sort(
                  (a, b) =>
                    (distOrder.findIndex(([k]) => k === a.entity.key)) -
                    (distOrder.findIndex(([k]) => k === b.entity.key)),
                )
                .map((b) => (
                  <span
                    key={b.key}
                    className="col-seg"
                    style={{
                      flexGrow: b.qty,
                      background: distColour.get(b.entity.key),
                    }}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget.closest(".cols-wrap") as HTMLElement).getBoundingClientRect();
                      setHover({
                        market: g.title,
                        band: b.name,
                        qty: b.qty,
                        share: g.total > 0 ? (100 * b.qty) / g.total : 0,
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                      });
                    }}
                    onMouseLeave={() => setHover(null)}
                  />
                ))}
            </span>
            <span className="col-name">{g.title}</span>
          </button>
        ))}
      </div>

      {/* Identity is never colour alone: the legend names every distributor
          in the same fixed order the columns stack. A single distributor
          needs no legend — the pane already names it. */}
      {distOrder.length >= 2 && (
      <p className="cols-legend">
        {distOrder.map(([key, d]) => (
          <span key={key}>
            <i style={{ background: distColour.get(key) }} aria-hidden="true" />
            {d.name}
          </span>
        ))}
      </p>
      )}

      {hover && (
        <div
          className="cols-tip"
          style={{ left: hover.x, top: hover.y }}
          role="status"
        >
          <span className="cols-tip-name">{hover.band}</span>
          <span className="cols-tip-sub">
            {hover.market} · <b>{QTY.format(hover.qty)} {unit}</b> ·{" "}
            {Math.round(hover.share)}%
          </span>
        </div>
      )}
    </div>
  );
}
