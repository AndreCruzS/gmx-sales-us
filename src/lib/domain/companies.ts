// Grouping a territory by company rather than by rep.
//
// A company is not a rep's property. A banner has branches in more than one
// patch and a distributor serves dealers across several, so a rep-centric list
// physically cannot show "this relationship has nobody holding it" — that is
// the fact this grouping exists to surface.
//
// Kept out of the page because the banner/shared rules are the kind of thing
// that looks obvious and is not: a banner heads its group instead of appearing
// inside it, and only its locations count towards who works it.

export interface GroupableAccount {
  id: string;
  name: string;
  parent_account_id: string | null;
  owner_id?: string | null;
}

export interface CompanyGroup<T> {
  /** The banner account's id, or null when the parent is outside this list. */
  id: string | null;
  name: string;
  branches: T[];
  /** Distinct owners of the locations — not of the banner. */
  owners: string[];
  /** More than one rep works the locations, so nobody holds the whole thing. */
  shared: boolean;
}

const FALLBACK_NAME = "Other accounts";

/**
 * Group accounts under their parent banner.
 *
 * @param rows      the accounts to group, already filtered/searched
 * @param display   how to render a name (the app strips banner prefixes)
 */
export function groupByCompany<T extends GroupableAccount>(
  rows: T[],
  display: (name: string) => string = (n) => n,
): CompanyGroup<T>[] {
  const byId = new Map(rows.map((a) => [a.id, a]));

  // An account that some other row points at is a banner: a heading, not one
  // of its own locations.
  const isBanner = new Set(
    rows.map((a) => a.parent_account_id).filter((id): id is string => !!id),
  );

  const groups = new Map<string, CompanyGroup<T> & { owners: string[] }>();

  for (const a of rows) {
    // A branch groups under its parent even when that parent is not visible
    // here; an account with no parent heads its own group.
    const key = a.parent_account_id ?? a.id;
    const head = a.parent_account_id ? byId.get(a.parent_account_id) : a;

    const group =
      groups.get(key) ??
      ({
        id: head?.id ?? a.parent_account_id ?? null,
        name: head ? display(head.name) : FALLBACK_NAME,
        branches: [],
        owners: [],
        shared: false,
      } as CompanyGroup<T> & { owners: string[] });

    if (!isBanner.has(a.id)) {
      group.branches.push(a);
      if (a.owner_id && !group.owners.includes(a.owner_id)) {
        group.owners.push(a.owner_id);
      }
    }
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((g) => g.branches.length > 0)
    .map((g) => ({ ...g, shared: g.owners.length > 1 }))
    .sort(
      (a, b) =>
        // Split relationships first — they are the ones that need a decision.
        Number(b.shared) - Number(a.shared) ||
        b.branches.length - a.branches.length ||
        a.name.localeCompare(b.name),
    );
}
