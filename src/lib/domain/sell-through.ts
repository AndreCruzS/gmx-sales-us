// The distributors' sell-through, read three ways.
//
// This is the number that says whether a rep is working, and it is not ours:
// GMX sells to a distributor, the distributor's branches sell on to dealers, and
// a rep owns an area where he builds the dealer relationships that make the
// distributor's next order worth placing. The file arrives from Boise and
// Hardwoods and is ALWAYS A MONTH BEHIND, so nothing built on it may be shown
// without naming its month.
//
// THE DRILL. Leadership described three ways in, and they are the same walk
// down the chain started from different ends:
//
//   Rep          rep → distributor → branch → dealer
//   Distribution distributor → branch → dealer          (no rep filter)
//   Dealer       dealer → distributor → branch          (whoever supplies them)
//
// One rule drives all three, which is why one bar can serve them: the ROWS are
// one link of the chain and the BANDS are the next link down. Tapping a band
// walks one link: the thing you tapped becomes the row, and its own children
// become the bands. So "which Boise branches have sales" and "who that branch
// sold to" are not two screens — they are the same screen, one link apart.
//
// A path records where the walk has got to. path[i] is an entity of chain[i], so
// the rows at depth d are the children of path[d - 1] and the bands are
// chain[d]. Depth 0 is the only step with many rows, because nothing has been
// chosen to narrow it yet.

import { displayAccountName } from "@/lib/format";

export interface SellThroughRow {
  period: string;
  rep_id: string | null;
  rep_name: string | null;
  /** The region the BRANCH sits in, from the client's Master Territory Map, and
   *  the Market Owner of it. Null region means we hold no region covering that
   *  state; null owner means the region exists and their map still reads TBD —
   *  two different gaps, and a screen that showed them as one showed neither. */
  region_id: string | null;
  region_name: string | null;
  market_owner_name: string | null;
  distributor_id: string;
  distributor_name: string;
  branch_id: string;
  branch_name: string;
  branch_city: string | null;
  branch_state: string | null;
  dealer_id: string | null;
  dealer_name: string | null;
  dealer_label: string;
  product: string | null;
  quantity: number | string;
  unit: string | null;
  value: number | string | null;
}

/** A branch of a distributor, including the ones that bought nothing — which is
 *  the whole point of a coverage map. `sell_through_rows` only carries branches
 *  with sales, so the quiet ones have to come from the branch list itself. */
export interface BranchRef {
  id: string;
  distributor_id: string;
  name: string;
  city: string | null;
  state: string | null;
}

export type SellDim = "region" | "rep" | "distributor" | "branch" | "dealer";
export type SellLens = "region" | "rep" | "distribution" | "dealer";

/** The order leadership listed them in. */
export const SELL_LENSES: readonly (readonly [SellLens, string])[] = [
  ["region", "Region"],
  ["rep", "Rep"],
  ["distribution", "Distribution"],
  ["dealer", "Dealer"],
];

/** What "all of it" is called, per lens. Shared by the crumb trail and by the
 *  summary row, so the two can never disagree about what the top of the walk is. */
export const SELL_ROOT_LABEL: Record<SellLens, string> = {
  region: "All regions",
  rep: "All reps",
  distribution: "All houses",
  dealer: "All dealers",
};

/** The plural of a row, for the summary's second line. */
const DIM_PLURAL: Record<SellDim, string> = {
  region: "regions",
  rep: "reps",
  distributor: "distributors",
  branch: "branches",
  dealer: "dealers",
};

export const SELL_CHAIN: Record<SellLens, readonly SellDim[]> = {
  // THE TOP OF THE WALK IS THE REGION, not the rep, and that is the client's own
  // hierarchy: Region → Market Owner (Rep) → Distributor → Branch → Dealer. It
  // also fixes the least useful row on the screen. Grouping by rep put Texas,
  // the Southeast, the Mountain region and the Midwest into one "Nobody yet" row
  // worth 36,718 LF — a number nobody could act on, because it did not say WHERE
  // the gap was. Four named regions with no Market Owner is four decisions
  // waiting to be made.
  region: ["region", "distributor", "branch", "dealer"],
  // THE REP LENS IS NOT THE REGION LENS WITH DIFFERENT LABELS, and dropping it
  // when the region arrived was a mistake. A rep can hold more than one region,
  // in which case the region lens splits their number in two and only this one
  // adds it back up. And the two answer different questions: "who is performing
  // better" is about people and is what leadership asked for, "which ground is
  // covered" is about the map. Same walk, both valid.
  rep: ["rep", "distributor", "branch", "dealer"],
  distribution: ["distributor", "branch", "dealer"],
  dealer: ["dealer", "distributor", "branch"],
};

/** What one link of the chain is, at one row of the file. */
export interface SellEntity {
  /** Unique within the drill. Not always an account id — see accountId. */
  key: string;
  name: string;
  dim: SellDim;
  /** The account this entity IS, when it is one. A branch is not an account and
   *  neither is an unmatched dealer name, so the rest of the page has to be told
   *  when it cannot look one up. */
  accountId: string | null;
  /** DISTRIBUTOR or DEALER for accounts; null for a branch or an unmatched row. */
  kind: string | null;
  /** The quiet second line: a branch's town, or why a dealer has no account. */
  sub: string | null;
}

const UNMATCHED_PREFIX = "unmatched:";

/** True when this entity is a dealer name the upload could not match to one of
 *  our accounts. Its volume is real; its owner is unknown. */
export function isUnmatched(e: SellEntity): boolean {
  return e.dim === "dealer" && e.accountId === null;
}

export function entityAt(row: SellThroughRow, dim: SellDim): SellEntity {
  switch (dim) {
    case "region":
      // TWO DIFFERENT ABSENCES, and they must never share a row. No region means
      // the goods shipped from a state the client's map does not cover, which is
      // a question for whoever maintains the map. A region with no Market Owner
      // is a place the map DOES cover and nobody has been given yet — the volume
      // is real, it is located, and it is unclaimed.
      return {
        key: row.region_id ?? "unmapped",
        name: row.region_name ?? "Region not on the map",
        dim,
        accountId: null,
        kind: null,
        sub: row.region_id
          ? (row.market_owner_name ?? "no Market Owner yet")
          : `${row.branch_state ?? "nowhere"} is not covered yet`,
      };
    case "rep":
      // "Nobody yet" is honest and hiding the volume would not be — but WHY
      // nobody changed when the territory map landed, and the old reason is now
      // simply false. It used to be that an unmatched dealer left a row with no
      // owner. Attribution follows the REGION now, so an ownerless row is either
      // ground the client has not given to anybody or ground their map does not
      // reach. Both are answerable; "no dealer matched" was not.
      //
      // This row is also the reason the Region lens exists: under this lens every
      // unowned region collapses into one "Nobody yet", so the subtitle points at
      // where the detail is instead of pretending there is none.
      return {
        key: row.rep_id ?? "unowned",
        name: row.rep_name ?? "Nobody yet",
        dim,
        accountId: null,
        kind: null,
        sub: row.rep_id
          ? null
          : row.region_id
            ? `${row.region_name} has no Market Owner yet`
            : `${row.branch_state ?? "somewhere"} is not on the territory map`,
      };
    case "distributor":
      return {
        key: row.distributor_id,
        name: row.distributor_name,
        dim,
        accountId: row.distributor_id,
        kind: "DISTRIBUTOR",
        sub: "distributor",
      };
    case "branch": {
      // A branch is only ever read underneath its own house — as a band on the
      // distributor's bar, or with the distributor in the crumb above it. So
      // "Boise Cascade - Riverside" inside a row titled "Boise Cascade" says
      // the house twice and the place once.
      const name = shortBranchName(row.branch_name, row.distributor_name);
      return {
        key: row.branch_id,
        name,
        dim,
        accountId: null,
        kind: null,
        sub: branchPlace(name, row.branch_city, row.branch_state),
      };
    }
    case "dealer":
      return row.dealer_id
        ? {
            key: row.dealer_id,
            name: row.dealer_name ?? row.dealer_label,
            dim,
            accountId: row.dealer_id,
            kind: "DEALER",
            sub: "dealer",
          }
        : {
            // Keyed on the label because that is all we know it by. Two files
            // spelling the same yard two ways stay two rows until somebody maps
            // them, which is the truth rather than a guess.
            key: `${UNMATCHED_PREFIX}${row.dealer_label}`,
            // A distributor's system shouts; the label is kept verbatim in the
            // database and only softened for reading.
            name: displayAccountName(row.dealer_label),
            dim,
            accountId: null,
            kind: null,
            sub: "not matched to an account yet",
          };
  }
}

/**
 * "Boise Cascade - Riverside" under Boise Cascade is just "Riverside".
 *
 * Only a leading match is stripped, and only when something is left over: a
 * branch a distributor happens to have named after itself keeps its name rather
 * than being reduced to nothing.
 */
export function shortBranchName(
  branchName: string,
  distributorName: string,
): string {
  const house = distributorName.toLowerCase();

  // The separated form first — "Hardwoods - Los Angeles" under "Hardwoods
  // Specialty". A distributor's file rarely spells its own name the same way
  // twice, so matching the part BEFORE the dash against the start of the house
  // catches the short form as well as the full one.
  const split = branchName.match(/^(.+?)\s+[—–-]\s+(.+)$/);
  if (split) {
    const head = split[1].toLowerCase();
    if (house.startsWith(head) || head.startsWith(house)) return split[2];
  }

  const lower = branchName.toLowerCase();
  if (!lower.startsWith(house)) return branchName;
  const rest = branchName.slice(distributorName.length).replace(/^[\s—–-]+/, "");
  return rest.length > 0 ? rest : branchName;
}

/** The town, minus whatever the name already said. "Riverside" needs "CA", not
 *  "Riverside, CA" — but a branch called "North Yard" needs the town. */
function branchPlace(
  name: string,
  city: string | null,
  state: string | null,
): string | null {
  const said = city !== null && name.toLowerCase().includes(city.toLowerCase());
  const parts = (said ? [state] : [city, state]).filter(
    (p): p is string => !!p && p.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export interface PathStep {
  dim: SellDim;
  key: string;
  name: string;
  /** Carried for the page above, not used by the walk itself: the rest of the
   *  screen narrows to an ACCOUNT, and a branch is not one. */
  accountId?: string | null;
  kind?: string | null;
  colour?: string;
}

export function stepFor(entity: SellEntity, colour?: string): PathStep {
  return {
    dim: entity.dim,
    key: entity.key,
    name: entity.name,
    accountId: entity.accountId,
    kind: entity.kind,
    colour,
  };
}

/**
 * Where "back" goes from here, or null when there is nowhere to go.
 *
 * Depth 0 is the only step with many rows, so the first tap records TWO links —
 * the row it was on and the band itself. Coming back out has to drop both, or
 * back would land on a step that was never shown: one rep, banded by nothing.
 */
export function backFrom(path: readonly PathStep[]): PathStep[] | null {
  if (path.length === 0) return null;
  return path.length <= 2 ? [] : path.slice(0, -1);
}

export interface SellFocus {
  /** The deepest thing on the walk, account or not — what the page is reading. */
  key: string;
  name: string;
  kind: string | null;
  dim: SellDim;
  colour: string;
  /** The deepest ACCOUNT on the walk. A branch is a location in someone else's
   *  network, so it has no rollout to narrow and no page to open; the sections
   *  that need an account fall back to the house the branch belongs to. */
  accountId: string;
  accountName: string;
}

/**
 * What the rest of the page should answer for, given where the walk has got to.
 *
 * Two different questions, which is why this returns both. The NAME is the
 * deepest link, so the bar at the top of the page agrees with the crumbs. The
 * ACCOUNT is the deepest link that is one of ours, because that is all the
 * rollout and the year can be keyed on.
 *
 * Of the accounts on the walk the DEALER wins: it is a single door, where a
 * distributor is a network. That is what makes the dealer lens ("Ganahl Corona,
 * through Boise") answer for Corona rather than for Boise.
 */
export function focusAccount(
  path: readonly PathStep[],
  band: { entity: SellEntity; colour: string } | null,
): SellFocus | null {
  const walk: { key: string; name: string; kind: string | null; dim: SellDim; accountId: string | null; colour: string }[] =
    path.map((s) => ({
      key: s.key,
      name: s.name,
      kind: s.kind ?? null,
      dim: s.dim,
      accountId: s.accountId ?? null,
      colour: s.colour ?? REST_COLOUR,
    }));
  if (band) {
    walk.push({
      key: band.entity.key,
      name: band.entity.name,
      kind: band.entity.kind,
      dim: band.entity.dim,
      accountId: band.entity.accountId,
      colour: band.colour,
    });
  }
  if (walk.length === 0) return null;

  const accounts = walk.filter((w) => w.accountId !== null);
  if (accounts.length === 0) return null;
  const dealers = accounts.filter((a) => a.kind === "DEALER");
  const account = (dealers.length > 0 ? dealers : accounts).at(-1)!;
  const deepest = walk.at(-1)!;

  return {
    key: deepest.key,
    name: deepest.name,
    kind: deepest.kind,
    dim: deepest.dim,
    colour: deepest.colour,
    accountId: account.accountId!,
    accountName: account.name,
  };
}

/**
 * The volume inside one walk — every row that agrees with every link chosen.
 *
 * This, and not "everything belonging to that account", is what the figures at
 * the top of the page have to add up to. Boise sold 38,400 LF in July but only
 * 36,000 of it through Deon's dealers; a tile showing the first while the bar
 * below it shows the second reads as a bug, and one of the two numbers is
 * answering a question nobody asked.
 */
export function scopeVolume(
  rows: readonly SellThroughRow[],
  path: readonly PathStep[],
): number {
  let total = 0;
  for (const r of rows) {
    if (rowMatchesPath(r, path)) total += num(r.quantity);
  }
  return total;
}

/** A row belongs to this walk only if it agrees with every link chosen so far. */
export function rowMatchesPath(
  row: SellThroughRow,
  path: readonly PathStep[],
): boolean {
  return path.every((step) => entityAt(row, step.dim).key === step.key);
}

// ── Bands and rows ──────────────────────────────────────────────────────────

/** Six is the practical limit for bands a person can tell apart on a phone. */
export const MAX_BANDS = 6;

/** The summary row's key. Not a real entity, so it cannot collide with one. */
export const ALL_ROWS = "__all__";

const BAND_COLOURS = [
  "var(--cat-1)",
  "var(--cat-2)",
  "var(--cat-3)",
  "var(--cat-4)",
  "var(--cat-5)",
  "var(--cat-6)",
];
export const REST_COLOUR = "var(--cat-rest)";

/**
 * A row's bands as shades of the row's own colour.
 *
 * The rule Andre picked, and it is a rule about what a colour is FOR. A row now
 * owns a tone: the thin stripe beside its name, the long bar under it, and every
 * band inside that bar are all one hue. Nothing on a row can be mistaken for
 * belonging to a different row, and the eye reads down the card by colour
 * instead of decoding two schemes stacked on top of each other.
 *
 * The price is real and worth stating: THE SAME HOUSE CHANGES COLOUR BETWEEN
 * ROWS. Boise is the dark teal on Deon's row and the dark amber on TJ's. The
 * colour answers "how much of this row" and no longer answers "which company",
 * which is why the band rows underneath carry the names — the bar was never the
 * legend, and pretending it was is what made this confusing in the first place.
 *
 * Step 0 IS the base, exactly, because it has to equal the thin stripe to the
 * pixel; a "nearly" there would read as a mistake rather than as a shade.
 *
 * Mixed toward the card and never toward the track. The track is --surface-sunken
 * and the palest step has to stay off it — mixing toward the track would make the
 * smallest band dissolve into the empty part of the bar, which is precisely the
 * band whose size is hardest to see already. The 2px gutters between segments
 * carry the separation the tints cannot at the pale end.
 */
const SHADE_MIX = [100, 80, 64, 51, 41, 33];
/** Everything past the sixth, gathered. One step paler than the sixth so the
 *  gathered segment cannot be mistaken for another band. */
const REST_MIX = 24;

function shadeOf(base: string, mix: number): string {
  if (mix >= 100) return base;
  return `color-mix(in srgb, ${base} ${mix}%, var(--surface-card))`;
}

/** The tone a row's gathered tail wears. Its own function because two places
 *  need to agree on it exactly: the band that gets the colour, and the segment
 *  builder that decides which bands to gather. */
function restShade(hue: string): string {
  return shadeOf(hue, REST_MIX);
}

export interface SellBand {
  key: string;
  name: string;
  qty: number;
  /** Same month last time we have a file for, so a figure can be read as moving
   *  rather than as a fact with no history. 0 when there is nothing to compare. */
  prevQty: number;
  /** Share of its bar, as a percentage — the width it holds while it slides. */
  share: number;
  colour: string;
  entity: SellEntity;
  /** Whether tapping it walks another link, or ends at its own detail. */
  drillable: boolean;
  /** What they actually bought. A band is a name and a number until it says
   *  which product moved; two dealers on the same volume of decking and cladding
   *  are not the same conversation. */
  products: readonly string[];
  /** Null, not zero, when the file carried no price — some houses share it and
   *  some do not, and 0 would read as "given away". */
  value: number | null;
}

/** What the track draws: the leaders, plus one grey band for the gathered tail.
 *  The legend still names every band, so a dealer is never unreachable just
 *  because it is small. */
export interface SellSegment {
  key: string;
  name: string;
  qty: number;
  share: number;
  colour: string;
  /** Null for the gathered tail — there is no single thing to walk into. */
  band: SellBand | null;
  count: number;
}

/** Branches of a distributor that sold nothing this month. The gaps are the
 *  point of a coverage map, so they are carried, not filtered out. */
export interface SellCoverage {
  buying: number;
  total: number;
  quiet: readonly string[];
}

export interface SellGroup {
  key: string;
  title: string;
  sub: string | null;
  unit: string;
  total: number;
  prevTotal: number;
  /** Null when the file carried no price for any of it. */
  value: number | null;
  entity: SellEntity;
  /**
   * The row's OWN colour — the one it wears as a band in the total bar above it.
   *
   * A row already carries its children's colours, in its bar and down its list.
   * It carried nothing of its own, so the total bar split into six colours and
   * then the rows underneath named six things in black: the reader had to count
   * segments left to right and count rows top to bottom and trust that the two
   * orders agreed. Now the row wears its segment's colour and the total is
   * legible by looking, not by counting.
   *
   * Null when there is no colour to be consistent WITH: a step with a single
   * row draws no total bar, so a colour on it would be decoration.
   */
  colour: string | null;
  bands: readonly SellBand[];
  segments: readonly SellSegment[];
  coverage: SellCoverage | null;
}

/**
 * The whole step's composition as one stacked stripe, for the counter's rail.
 *
 * With a band chosen the rail is that band's single colour. With nothing chosen
 * there is no single colour to show, so it becomes a miniature of the bar — and
 * picking a band collapses it to one colour, which is the counter's half of the
 * fill.
 *
 * Aggregated across every row of the step, because at depth 0 the same band
 * (Boise, say) appears on more than one row and the counter is answering for all
 * of them. Taking the first colour seen for a key is exact rather than a pick:
 * a band's colour belongs to the band, so every row that shows Boise shows the
 * same teal and there is nothing to choose between.
 */
export function compositionRail(groups: readonly SellGroup[]): string {
  const acc = new Map<string, { qty: number; colour: string }>();
  for (const g of groups) {
    for (const b of g.bands) {
      const seen = acc.get(b.key);
      if (seen) seen.qty += b.qty;
      else acc.set(b.key, { qty: b.qty, colour: b.colour });
    }
  }
  const parts = [...acc.values()].sort((a, b) => b.qty - a.qty);
  const total = parts.reduce((n, x) => n + x.qty, 0);
  if (total === 0) return REST_COLOUR;
  if (parts.length === 1) return parts[0].colour;

  const stops: string[] = [];
  let at = 0;
  for (const part of parts) {
    const from = (100 * at) / total;
    at += part.qty;
    const to = (100 * at) / total;
    stops.push(`${part.colour} ${from.toFixed(2)}% ${to.toFixed(2)}%`);
  }
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

export interface SellStep {
  depth: number;
  rowDim: SellDim;
  bandDim: SellDim | null;
  groups: readonly SellGroup[];
  /**
   * The whole step as one row: the same header, the same bar — the FIRST bar on
   * the card, because a total with no bar beside a column of bars reads as the
   * one number left out of the picture.
   *
   * ITS BANDS ARE THE ROWS. Under the Rep lens the rows are reps, so the total is
   * banded by rep: one bar that answers "who is carrying this month", which is
   * the question a manager opens the screen with. Banding it by the NEXT link
   * down — houses, under the Rep lens — answered a question the rows below
   * already answer twice over, and never answered that one at all.
   *
   * Null when there is only one row, because then that row already IS the total
   * and a summary above it would be the same bar drawn twice.
   */
  summary: SellGroup | null;
  /** Total across every row on this step. */
  total: number;
  unit: string;
}

function num(v: number | string | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * One step of the walk.
 *
 * @param rows      the month being shown
 * @param prevRows  the month before it, for the movement
 * @param branches  every known branch, so the quiet ones can be named
 */
export function buildStep(
  rows: readonly SellThroughRow[],
  prevRows: readonly SellThroughRow[],
  lens: SellLens,
  path: readonly PathStep[],
  branches: readonly BranchRef[] = [],
): SellStep {
  const chain = SELL_CHAIN[lens];
  const depth = path.length;

  // Depth 0 is the only step with many rows. After that the row is whatever was
  // tapped, and the bands are its children.
  const rowDim = depth === 0 ? chain[0] : chain[depth - 1];
  const bandDim = depth === 0 ? (chain[1] ?? null) : (chain[depth] ?? null);

  const scoped = rows.filter((r) => rowMatchesPath(r, path));
  const scopedPrev = prevRows.filter((r) => rowMatchesPath(r, path));

  const unit = scoped.find((r) => r.unit)?.unit ?? "LF";

  // Previous month, keyed the same way, so a band can find its own history.
  const prevByRowBand = new Map<string, number>();
  const prevByRow = new Map<string, number>();
  for (const r of scopedPrev) {
    const rowKey = entityAt(r, rowDim).key;
    prevByRow.set(rowKey, (prevByRow.get(rowKey) ?? 0) + num(r.quantity));
    if (bandDim) {
      const bandKey = entityAt(r, bandDim).key;
      const k = `${rowKey}::${bandKey}`;
      prevByRowBand.set(k, (prevByRowBand.get(k) ?? 0) + num(r.quantity));
    }
  }

  // ── Each row's own tone, decided once ─────────────────────────────────────
  //
  // Everything coloured on this step reads from this one map: the segments of
  // the total bar at the top, the thin stripe beside each row's name, and the
  // shades of every band inside that row's bar. One source, so the three can
  // never disagree — which they did, visibly, when each worked it out for itself.
  //
  // Ranked by the row's volume, ties broken on name so the legend does not
  // reshuffle between renders. Past the sixth, rows share the neutral: that is
  // the same set the total bar gathers into its grey tail, so a grey stripe and
  // a grey bar are saying the identical thing about that row.
  const rowColour = new Map<string, string>();
  {
    const totals = new Map<string, { name: string; qty: number }>();
    for (const r of scoped) {
      const e = entityAt(r, rowDim);
      const seen = totals.get(e.key);
      if (seen) seen.qty += num(r.quantity);
      else totals.set(e.key, { name: e.name, qty: num(r.quantity) });
    }
    [...totals.entries()]
      .sort((a, b) => b[1].qty - a[1].qty || a[1].name.localeCompare(b[1].name))
      .forEach(([key], i) => {
        rowColour.set(key, i < MAX_BANDS ? BAND_COLOURS[i] : REST_COLOUR);
      });
  }

  // One row and no total bar above it, so there is nothing to be consistent
  // WITH — but the bar still needs a hue to shade. Below depth 0 that hue is the
  // colour of the band that was tapped to get here, which is what makes the walk
  // read as one continuous thing: tap the teal band and the level it opens is
  // teal all the way down.
  const soloHue = path[path.length - 1]?.colour ?? BAND_COLOURS[0];

  const byRow = new Map<string, SellThroughRow[]>();
  for (const r of scoped) {
    const key = entityAt(r, rowDim).key;
    const list = byRow.get(key);
    if (list) list.push(r);
    else byRow.set(key, [r]);
  }

  const groups: SellGroup[] = [...byRow.entries()].map(([rowKey, list]) => {
    const entity = entityAt(list[0], rowDim);
    // byRow.size, not groups.length: the groups are what this expression is
    // building, and a solo row is the case where the hue comes from the walk.
    const hue = byRow.size > 1 ? (rowColour.get(rowKey) ?? REST_COLOUR) : soloHue;
    const bands = bandDim
      ? buildBands(list, bandDim, rowKey, prevByRowBand, chain, depth, (i) =>
          shadeOf(hue, SHADE_MIX[i] ?? REST_MIX),
        )
      : [];
    const total = bandDim
      ? bands.reduce((n, b) => n + b.qty, 0)
      : list.reduce((n, r) => n + num(r.quantity), 0);
    const priced = list.filter((r) => r.value !== null && r.value !== undefined);
    const value = priced.length === 0 ? null : priced.reduce((n, r) => n + num(r.value), 0);

    return {
      key: rowKey,
      title: entity.name,
      sub: groupSub(list, rowDim),
      unit,
      total,
      prevTotal: prevByRow.get(rowKey) ?? 0,
      value,
      entity,
      colour: hue,
      bands,
      segments: buildSegments(bands, total, restShade(hue)),
      coverage:
        bandDim === "branch" && entity.dim === "distributor"
          ? coverageFor(entity, bands, branches)
          : null,
    };
  });

  groups.sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));

  const total = groups.reduce((n, g) => n + g.total, 0);

  // The summary row: the total, banded by the rows themselves.
  //
  // Its bands are NOT doors. Each one already has a row of its own directly
  // below, with its own bar and its own way in, so a second door to the same
  // place would be two ways in that behave differently. They select and open
  // their own detail — what every terminal band here does, which is what the
  // missing chevron already says.
  let summary: SellGroup | null = null;
  if (groups.length > 1) {
    // Banded by the ROW dimension, and the month before keyed the same way — so
    // the summary's Deon band and Deon's own row agree to the linear foot.
    const prevBySummaryBand = new Map<string, number>();
    for (const [rowKey, qty] of prevByRow) {
      prevBySummaryBand.set(`${ALL_ROWS}::${rowKey}`, qty);
    }
    const bands = buildBands(
      scoped,
      rowDim,
      ALL_ROWS,
      prevBySummaryBand,
      chain,
      depth,
      // The SAME map the rows read, so a segment of the total bar and the stripe
      // beside the row it stands for are one decision rather than two that agree.
      (_, key) => rowColour.get(key) ?? REST_COLOUR,
    ).map((b) => ({ ...b, drillable: false }));
    const summaryTotal = bands.reduce((n, b) => n + b.qty, 0);
    const priced = scoped.filter((r) => r.value !== null && r.value !== undefined);
    summary = {
      key: ALL_ROWS,
      title: SELL_ROOT_LABEL[lens],
      sub: `${groups.length} ${DIM_PLURAL[rowDim]}`,
      unit,
      total: summaryTotal,
      prevTotal: scopedPrev.reduce((n, r) => n + num(r.quantity), 0),
      value: priced.length === 0 ? null : priced.reduce((n, r) => n + num(r.value), 0),
      entity: {
        key: ALL_ROWS,
        name: SELL_ROOT_LABEL[lens],
        dim: rowDim,
        accountId: null,
        kind: null,
        sub: null,
      },
      // The total is every colour at once, so it has none of its own.
      colour: null,
      bands,
      segments: buildSegments(bands, summaryTotal, REST_COLOUR),
      // A denominator across two networks is not a coverage figure, it is two
      // coverage figures added together. The per-house rows carry it instead.
      coverage: null,
    };
  }

  return {
    depth,
    rowDim,
    bandDim,
    groups,
    summary,
    total,
    unit,
  };
}

/**
 * A row's second line, taken from the WHOLE row rather than from its first entry.
 *
 * Every group used to borrow the subtitle of list[0], which is right whenever a
 * group's rows agree about what they are — a dealer group is one dealer, a branch
 * group is one branch. Exactly one row breaks that, and it is the important one:
 * "Nobody yet" under the rep lens gathers every region the client has not given
 * to anybody, so it read "Texas has no Market Owner yet" while holding Texas AND
 * the Midwest. Naming one of several is worse than naming none, because it looks
 * like an answer.
 *
 * So the shared subtitle is used when it IS shared, the regions are named when
 * there are few enough to read, and counted when there are not. For any other
 * dimension a disagreement cannot happen — and if it ever does, no subtitle beats
 * a wrong one.
 */
function groupSub(
  list: readonly SellThroughRow[],
  rowDim: SellDim,
): string | null {
  const subs = new Set<string>();
  for (const r of list) {
    const sub = entityAt(r, rowDim).sub;
    if (sub) subs.add(sub);
  }
  if (subs.size <= 1) return entityAt(list[0], rowDim).sub;
  if (rowDim !== "rep") return null;

  const regions = [...new Set(list.map((r) => r.region_name ?? "off the map"))].sort();
  return regions.length <= 2
    ? `${regions.join(" and ")} have no Market Owner yet`
    : `${regions.length} regions have no Market Owner yet`;
}

function buildBands(
  list: readonly SellThroughRow[],
  bandDim: SellDim,
  rowKey: string,
  prevByRowBand: ReadonlyMap<string, number>,
  chain: readonly SellDim[],
  depth: number,
  /** What colour the band at rank `i` wears. A row shades its own hue by rank;
   *  the total bar looks each row up by key. Passed in rather than decided here
   *  because those are two different questions and this function asks neither. */
  colourAt: (i: number, key: string) => string,
): SellBand[] {
  const acc = new Map<
    string,
    { entity: SellEntity; qty: number; products: Set<string>; value: number | null }
  >();
  for (const r of list) {
    const e = entityAt(r, bandDim);
    const seen = acc.get(e.key);
    const target =
      seen ??
      (() => {
        const fresh = { entity: e, qty: 0, products: new Set<string>(), value: null as number | null };
        acc.set(e.key, fresh);
        return fresh;
      })();
    target.qty += num(r.quantity);
    if (r.product) target.products.add(r.product);
    // Null stays null until a priced row turns up: a band of unpriced rows has
    // no value, where a band of one priced and one unpriced row has a partial
    // one, and the second is worth showing.
    if (r.value !== null && r.value !== undefined) {
      target.value = (target.value ?? 0) + num(r.value);
    }
  }

  // A band walks another link only if the chain has one left AND the entity is
  // a single identifiable thing. An unmatched dealer name is a data-quality
  // item, not a door to walk through.
  const nextDim = depth === 0 ? chain[2] : chain[depth + 1];
  const canWalk = nextDim !== undefined;

  const sorted = [...acc.values()].sort(
    (a, b) => b.qty - a.qty || a.entity.name.localeCompare(b.entity.name),
  );
  const barTotal = sorted.reduce((n, x) => n + x.qty, 0);

  return sorted.map((x, i) => ({
    key: x.entity.key,
    name: x.entity.name,
    qty: x.qty,
    prevQty: prevByRowBand.get(`${rowKey}::${x.entity.key}`) ?? 0,
    share: barTotal === 0 ? 0 : (100 * x.qty) / barTotal,
    colour: colourAt(i, x.entity.key),
    entity: x.entity,
    drillable: canWalk && !isUnmatched(x.entity),
    products: [...x.products].sort((a, b) => a.localeCompare(b)),
    value: x.value,
  }));
}

function buildSegments(
  bands: readonly SellBand[],
  total: number,
  /** The tone this bar's gathered tail wears — the row's palest shade, or the
   *  neutral for the total bar. */
  restColour: string,
): SellSegment[] {
  const seg = (b: SellBand) => ({
    key: b.key,
    name: b.name,
    qty: b.qty,
    share: b.share,
    colour: b.colour,
    band: b,
    count: 1,
  });

  // WHICH BANDS GET GATHERED IS DECIDED BY THE COLOUR, not by the position.
  //
  // It used to be "everything past the sixth", which was the same set only
  // because colour was also handed out by position. Now that a band is coloured
  // by who it is, the two can disagree — and if they did, a band would be drawn
  // as its own grey stripe right next to the gathered grey one, which reads as
  // a single stripe that has been cut in half for no reason.
  //
  // Keyed off REST_COLOUR keeps them one decision: grey MEANS gathered. The
  // outcome is unchanged wherever it used to hold, because the greys were the
  // tail of a list sorted by size and they still are.
  const tail = bands.filter((b) => b.colour === restColour);
  // One straggler stays itself. Collapsing a single band into "1 more" hides a
  // name to save nothing.
  if (tail.length <= 1) return bands.map(seg);

  const tailQty = tail.reduce((n, b) => n + b.qty, 0);
  return [
    ...bands.filter((b) => b.colour !== restColour).map(seg),
    {
      key: "rest",
      name: `${tail.length} more`,
      qty: tailQty,
      share: total === 0 ? 0 : (100 * tailQty) / total,
      colour: restColour,
      band: null,
      count: tail.length,
    },
  ];
}

function coverageFor(
  distributor: SellEntity,
  bands: readonly SellBand[],
  branches: readonly BranchRef[],
): SellCoverage | null {
  const known = branches.filter((b) => b.distributor_id === distributor.key);
  if (known.length === 0) return null;
  const buying = new Set(bands.filter((b) => b.qty > 0).map((b) => b.key));
  return {
    buying: buying.size,
    total: known.length,
    quiet: known
      .filter((b) => !buying.has(b.id))
      .map((b) => shortBranchName(b.name, distributor.name))
      .sort((a, b) => a.localeCompare(b)),
  };
}

// ── Periods ─────────────────────────────────────────────────────────────────

/**
 * The two most recent months present, newest first. Not "this month and last" —
 * a distributor that skips a month must not silently make the comparison read
 * against nothing.
 */
export function latestPeriods(
  rows: readonly SellThroughRow[],
): { latest: string | null; previous: string | null } {
  const seen = [...new Set(rows.map((r) => r.period))].sort().reverse();
  return { latest: seen[0] ?? null, previous: seen[1] ?? null };
}

/**
 * Houses that have reported before but not for the month being shown.
 *
 * The screens draw ONE month, because a figure that mixes months is not a figure.
 * But the files do not arrive together: the day Boise's August lands, the latest
 * month becomes August, and Hardwoods — whose newest file is July — drops out of
 * every total on the page. Nothing is wrong with the data and nothing is wrong
 * with the maths; the screen simply halves, and a manager has no way to know why.
 *
 * So the gap is named. This is the difference between a dashboard that quietly
 * understates the channel and one that says which house it is waiting on.
 */
export function housesMissing(
  rows: readonly SellThroughRow[],
  latest: string | null,
): readonly string[] {
  if (!latest) return [];
  const reported = new Set<string>();
  const names = new Map<string, string>();
  const everReported = new Map<string, string>();
  for (const r of rows) {
    names.set(r.distributor_id, r.distributor_name);
    if (r.period === latest) reported.add(r.distributor_id);
    else everReported.set(r.distributor_id, r.distributor_name);
  }
  return [...everReported.keys()]
    .filter((id) => !reported.has(id))
    .map((id) => names.get(id) ?? id)
    .sort((a, b) => a.localeCompare(b));
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

/** "July 2026". UTC, because the period is a first-of-month label and not a
 *  moment — read locally, a first of the month goes backwards west of London. */
export function periodLabel(period: string | null): string {
  if (!period) return "no month yet";
  const d = new Date(`${period.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? period : MONTH_YEAR.format(d);
}

/** "Jun" — for the short comparison against the month before. */
export function periodShort(period: string | null): string {
  if (!period) return "";
  const d = new Date(`${period.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? period : MONTH_SHORT.format(d);
}

/**
 * How a figure moved, as a percentage of where it was.
 *
 * Null when there is nothing honest to say: no previous month, or a previous
 * month of zero — coming from nothing is not "up 100%", it is new.
 */
export function movement(now: number, before: number): number | null {
  if (before <= 0) return null;
  return (100 * (now - before)) / before;
}

/** Which way to colour a movement. "new this month" is neither up nor down —
 *  coming from nothing has no direction, and colouring it would claim one. */
export type MoveDir = "up" | "down" | "level" | "none";

export function moveDir(
  now: number,
  before: number,
  previous: string | null,
): MoveDir {
  if (!previous || before <= 0) return "none";
  const pct = movement(now, before);
  if (pct === null) return "none";
  const rounded = Math.round(pct);
  return rounded === 0 ? "level" : rounded > 0 ? "up" : "down";
}

/** "up 9% on Jun" · "down 4% on Jun" · "level with Jun" · "new this month". */
export function movementLabel(
  now: number,
  before: number,
  previous: string | null,
): string | null {
  if (!previous) return null;
  const on = periodShort(previous);
  if (before <= 0) return now > 0 ? "new this month" : null;
  const pct = movement(now, before);
  if (pct === null) return null;
  const rounded = Math.round(pct);
  if (rounded === 0) return `level with ${on}`;
  return `${rounded > 0 ? "up" : "down"} ${Math.abs(rounded)}% on ${on}`;
}
