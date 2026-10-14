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
// unplaced person is still found under "All regions" and by name.

import { displayAccountName } from "@/lib/format";

export type ContactKind = "all" | "distributor" | "dealer";

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
  kind: ContactKind;
  /** "" means every region. */
  regionId: string;
  /** The distributor account's id; "" means every house. */
  houseId: string;
  query: string;
}

export const NO_CONTACT_SCOPE: ContactScope = {
  kind: "all",
  regionId: "",
  houseId: "",
  query: "",
};

export function contactRegion(r: ContactListRow): string | null {
  if (r.branchName !== null) return r.branchTerritoryId;
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
  if (scope.kind === "all" && !scope.regionId && !scope.houseId && !q) return rows;
  return rows.filter((r) => {
    if (scope.kind !== "all" && contactKind(r) !== scope.kind) return false;
    if (scope.regionId && contactRegion(r) !== scope.regionId) return false;
    if (scope.houseId && r.account_id !== scope.houseId) return false;
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
