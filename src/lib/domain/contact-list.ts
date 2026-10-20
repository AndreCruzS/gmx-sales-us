// THE DIRECTORY, READ THE WAY THE SALES BOARD IS READ (Andre, 2026-10-14:
// "the contacts page is a mess, we need pagination, and filters for groups of
// Region, Distributors and dealers as the sales page does").
//
// Sixty-five people in one alphabetical list, champions first, was fine at
// eight. With the distributor directories loaded (2026-10-12) it is Boise's
// twenty-eight interleaved with everyone else's, and the one question a rep
// has — "who do I call at Riverside" — takes a scroll and a squint. So the
// list is NARROWED the way the dealer lens narrows: by kind, by region, by
// house; SORTED by company and branch so a house's people read as blocks; and
// PAGED, with a head printed wherever the block changes.
//
// WHERE A PERSON SITS. A branch's person takes the branch's region — Boise is
// filed under Southern California, but its Dallas people are Texas. Everyone
// else takes the account's region. A branch nobody has placed yet yields NO
// region rather than the house's: a wrong region credits a wrong rep, and an
// unplaced person is still found under "All regions" and by name. A house's
// head-office person, in no branch, has no region either (2026-10-20): the
// house's own filing is an accident of where it was entered, and the database
// shows that person to every region.
//
// THE WALK (Andre, 2026-10-14, same day: "a sort of breadcrumb when
// distributors or dealers are selected with first stage as collapsed ... so
// the filter makes sense"). Kind, house and branch are not three independent
// filters; they are one path, the Sales board's drill. So the narrowing is a
// PATH of steps — Everyone › Distributors › Boise Cascade › Riverside — and
// each step collapses into a crumb while the next stage's choices become
// chips. Region stays the one sideways narrowing at every step.

import { displayAccountName } from "@/lib/format";

export type ContactKind = "all" | "distributor" | "dealer";

export type ContactDim = "kind" | "house" | "branch" | "dealer";

export interface ContactStep {
  dim: ContactDim;
  /** kind → "distributor" | "dealer"; house/dealer → account id; branch → branch name. */
  key: string;
  name: string;
}

export interface ContactListRow {
  id: string;
  name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  is_champion: boolean;
  account_id: string;
  accountName: string | null;
  accountType: string | null;
  accountTerritoryId: string | null;
  branchName: string | null;
  branchTerritoryId: string | null;
}

export interface ContactScope {
  path: readonly ContactStep[];
  /** "" means every region. */
  regionId: string;
  query: string;
}

export const NO_CONTACT_SCOPE: ContactScope = {
  path: [],
  regionId: "",
  query: "",
};

function onPath(r: ContactListRow, path: readonly ContactStep[]): boolean {
  for (const s of path) {
    if (s.dim === "kind" && contactKind(r) !== s.key) return false;
    if ((s.dim === "house" || s.dim === "dealer") && r.account_id !== s.key) return false;
    if (s.dim === "branch" && r.branchName !== s.key) return false;
  }
  return true;
}

export function contactRegion(r: ContactListRow): string | null {
  if (r.branchName !== null) return r.branchTerritoryId;
  if (r.accountType === "DISTRIBUTOR") return null;
  return r.accountTerritoryId;
}

export function contactKind(r: ContactListRow): "distributor" | "dealer" | "other" {
  if (r.accountType === "DISTRIBUTOR") return "distributor";
  if (r.accountType === "DEALER") return "dealer";
  return "other";
}

/** Narrows the directory; hands back the SAME array when nothing narrows. */
export function narrowContacts<T extends ContactListRow>(
  rows: readonly T[],
  scope: ContactScope,
): readonly T[] {
  const q = scope.query.trim().toLowerCase();
  if (scope.path.length === 0 && !scope.regionId && !q) return rows;
  return rows.filter((r) => {
    if (!onPath(r, scope.path)) return false;
    if (scope.regionId && contactRegion(r) !== scope.regionId) return false;
    if (q) {
      const hay = [r.name, r.accountName, r.branchName, r.email, r.job_title]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const companyOf = (r: ContactListRow) =>
  r.accountName ? displayAccountName(r.accountName) : null;

/** Company, then branch, then the champion, then the name. People with no
 *  company come last. Returns a new array. */
export function sortContacts<T extends ContactListRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ca = companyOf(a);
    const cb = companyOf(b);
    if (ca === null && cb !== null) return 1;
    if (ca !== null && cb === null) return -1;
    if (ca !== null && cb !== null && ca !== cb) return ca.localeCompare(cb);
    const ba = a.branchName ?? "";
    const bb = b.branchName ?? "";
    if (ba !== bb) return ba.localeCompare(bb);
    if (a.is_champion !== b.is_champion) return a.is_champion ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** The block a person belongs to: the company, and the branch when there is one. */
export function contactGroup(r: ContactListRow): string {
  const company = companyOf(r);
  if (company === null) return "No company";
  return r.branchName ? `${company} · ${r.branchName}` : company;
}

/**
 * A page of rows with a head wherever the group changes — including on the
 * first row, because a page that starts halfway through Boise still has to
 * say it is Boise.
 */
export function withGroupHeads<T>(
  page: readonly T[],
  groupOf: (row: T) => string,
): { row: T; head: string | null }[] {
  let last: string | null = null;
  return page.map((row) => {
    const g = groupOf(row);
    const head = g === last ? null : g;
    last = g;
    return { row, head };
  });
}

/** How many rows fall under each key; rows with no key are not counted. */
export function countBy<T>(
  rows: readonly T[],
  keyOf: (row: T) => string | null,
): Map<string, number> {
  const n = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  return n;
}

export interface StageOption {
  key: string;
  name: string;
  count: number;
}

export interface Stage {
  dim: ContactDim;
  options: StageOption[];
}

const KIND_NAMES: Record<string, string> = {
  distributor: "Distributors",
  dealer: "Dealers",
};

/**
 * The choices one step below the path, each counted. Null at the end of the
 * walk: a branch, a dealer, or a house with no branches among its people.
 * `rows` should already be narrowed by region and search, so the counts say
 * what a tap will actually show.
 */
export function nextStage(
  rows: readonly ContactListRow[],
  path: readonly ContactStep[],
): Stage | null {
  const under = rows.filter((r) => onPath(r, path));
  const last = path[path.length - 1] ?? null;
  const dim: ContactDim | null =
    last === null
      ? "kind"
      : last.dim === "kind"
        ? last.key === "distributor"
          ? "house"
          : "dealer"
        : last.dim === "house"
          ? "branch"
          : null;
  if (dim === null) return null;

  if (dim === "kind") {
    const n = countBy(under, (r) => {
      const k = contactKind(r);
      return k === "other" ? null : k;
    });
    return {
      dim,
      options: (["distributor", "dealer"] as const).map((key) => ({
        key,
        name: KIND_NAMES[key],
        count: n.get(key) ?? 0,
      })),
    };
  }

  if (dim === "branch") {
    const n = countBy(under, (r) => r.branchName);
    if (n.size === 0) return null;
    return {
      dim,
      options: [...n.entries()]
        .map(([key, count]) => ({ key, name: key, count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  // Houses or dealers: the accounts with people, most people first.
  const n = countBy(under, (r) => r.account_id);
  const names = new Map<string, string>();
  for (const r of under) {
    if (r.accountName && !names.has(r.account_id)) {
      names.set(r.account_id, displayAccountName(r.accountName));
    }
  }
  const options = [...n.entries()]
    .map(([key, count]) => ({ key, name: names.get(key) ?? "No company", count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return options.length === 0 ? null : { dim, options };
}

/** Where you are, as parts of a sentence: the deepest step first, its parent
 *  when the step alone would not say enough (a branch), then the count. */
export function contextSentence(path: readonly ContactStep[], count: number): string[] {
  const last = path[path.length - 1] ?? null;
  const parts: string[] = [last ? last.name : "Everyone"];
  if (last?.dim === "branch") {
    const house = path.find((s) => s.dim === "house");
    if (house) parts.push(house.name);
  }
  parts.push(count === 0 ? "nobody" : count === 1 ? "1 person" : `${count} people`);
  return parts;
}
