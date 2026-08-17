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

export type SellDim = "rep" | "distributor" | "branch" | "dealer";
export type SellLens = "rep" | "distribution" | "dealer";

/** The order leadership listed them in. */
export const SELL_LENSES: readonly (readonly [SellLens, string])[] = [
  ["rep", "Rep"],
  ["distribution", "Distribution"],
  ["dealer", "Dealer"],
];

export const SELL_CHAIN: Record<SellLens, readonly SellDim[]> = {
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
    case "rep":
      // An unmatched row has no dealer, so it has no owner either. Grouping it
      // under "Nobody yet" is honest; hiding it would lose the volume.
      return {
        key: row.rep_id ?? "unowned",
        name: row.rep_name ?? "Nobody yet",
        dim,
        accountId: null,
        kind: null,
        sub: row.rep_id ? null : "no dealer matched, so no owner",
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

const BAND_COLOURS = [
  "var(--cat-1)",
  "var(--cat-2)",
  "var(--cat-3)",
  "var(--cat-4)",
  "var(--cat-5)",
  "var(--cat-6)",
];
export const REST_COLOUR = "var(--cat-rest)";

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
  entity: SellEntity;
  bands: readonly SellBand[];
  segments: readonly SellSegment[];
  coverage: SellCoverage | null;
}

export interface SellStep {
  depth: number;
  rowDim: SellDim;
  bandDim: SellDim | null;
  groups: readonly SellGroup[];
  /** Total across every row on this step, for the line above the card. */
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
      const k = `${rowKey} ${entityAt(r, bandDim).key}`;
      prevByRowBand.set(k, (prevByRowBand.get(k) ?? 0) + num(r.quantity));
    }
  }

  const byRow = new Map<string, SellThroughRow[]>();
  for (const r of scoped) {
    const key = entityAt(r, rowDim).key;
    const list = byRow.get(key);
    if (list) list.push(r);
    else byRow.set(key, [r]);
  }

  const groups: SellGroup[] = [...byRow.entries()].map(([rowKey, list]) => {
    const entity = entityAt(list[0], rowDim);
    const bands = bandDim ? buildBands(list, bandDim, rowKey, prevByRowBand, chain, depth) : [];
    const total = bandDim
      ? bands.reduce((n, b) => n + b.qty, 0)
      : list.reduce((n, r) => n + num(r.quantity), 0);

    return {
      key: rowKey,
      title: entity.name,
      sub: entity.sub,
      unit,
      total,
      prevTotal: prevByRow.get(rowKey) ?? 0,
      entity,
      bands,
      segments: buildSegments(bands, total),
      coverage:
        bandDim === "branch" && entity.dim === "distributor"
          ? coverageFor(entity, bands, branches)
          : null,
    };
  });

  groups.sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));

  return {
    depth,
    rowDim,
    bandDim,
    groups,
    total: groups.reduce((n, g) => n + g.total, 0),
    unit,
  };
}

function buildBands(
  list: readonly SellThroughRow[],
  bandDim: SellDim,
  rowKey: string,
  prevByRowBand: ReadonlyMap<string, number>,
  chain: readonly SellDim[],
  depth: number,
): SellBand[] {
  const acc = new Map<string, { entity: SellEntity; qty: number }>();
  for (const r of list) {
    const e = entityAt(r, bandDim);
    const seen = acc.get(e.key);
    if (seen) seen.qty += num(r.quantity);
    else acc.set(e.key, { entity: e, qty: num(r.quantity) });
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
    prevQty: prevByRowBand.get(`${rowKey} ${x.entity.key}`) ?? 0,
    share: barTotal === 0 ? 0 : (100 * x.qty) / barTotal,
    colour: i < MAX_BANDS ? BAND_COLOURS[i] : REST_COLOUR,
    entity: x.entity,
    drillable: canWalk && !isUnmatched(x.entity),
  }));
}

function buildSegments(
  bands: readonly SellBand[],
  total: number,
): SellSegment[] {
  if (bands.length <= MAX_BANDS + 1) {
    return bands.map((b) => ({
      key: b.key,
      name: b.name,
      qty: b.qty,
      share: b.share,
      colour: b.colour,
      band: b,
      count: 1,
    }));
  }
  const head = bands.slice(0, MAX_BANDS);
  const tail = bands.slice(MAX_BANDS);
  const tailQty = tail.reduce((n, b) => n + b.qty, 0);
  return [
    ...head.map((b) => ({
      key: b.key,
      name: b.name,
      qty: b.qty,
      share: b.share,
      colour: b.colour,
      band: b,
      count: 1,
    })),
    {
      key: "rest",
      name: `${tail.length} more`,
      qty: tailQty,
      share: total === 0 ? 0 : (100 * tailQty) / total,
      colour: REST_COLOUR,
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
