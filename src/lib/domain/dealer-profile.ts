// THE DEALER MODULE'S FACTS (Bianca and João, 2026-09-18; prototype approved
// by Andre 2026-09-21). Everything the sell-through files know about one
// dealer, read the way the module shows it: overview first, then month by
// month, what they bought, through whom.
//
// A dealer here is what every list keys it by — its account when the files
// were matched to one, its label straight off the file when not. Most names in
// the lists have no account (104 labels against 8 matched dealers when this
// was written), so the module has to work from a label alone.
//
// Pure: rows in, facts out. The relationship half (contacts, visits, notes,
// quotes, rollout) is ours, not the files', and is read separately.

import {
  branchesWithoutDetail,
  dealerDisplayName,
  dealerKey,
  isBranchLevel,
  UNDISCLOSED_PREFIX,
  type SellThroughRow,
} from "@/lib/domain/sell-through";

export interface DealerPeriod {
  /** The period key as stored: a month's first day, or the year file's cut. */
  period: string;
  /** A year file is one aggregate — January through its cut. */
  kind: "YTD" | "MONTH";
  lf: number;
  /** The same window a year back, where the file carried it. */
  ly: number;
  byHouse: { house: string; lf: number }[];
}

export interface DealerProduct {
  /** The product with its length taken out: one profile, many lengths. */
  family: string;
  lf: number;
  share: number;
  lengths: string[];
  lines: number;
}

export interface DealerFacts {
  key: string;
  name: string;
  /** Every spelling the files used for it. */
  labels: string[];
  accountId: string | null;
  regions: string[];
  reps: string[];
  /** The reps' membership ids, for reaching them. */
  repIds: string[];
  houses: string[];
  periods: DealerPeriod[];
  /** Every period the files cover — the dealer's or not — so silence can be
   *  told from a file that has not arrived. */
  filesOnHand: string[];
  firstSeen: string | null;
  lastBought: string | null;
  /** The newest month on file in which this dealer bought nothing. */
  silentIn: string | null;
  /** Branches of this dealer's houses that stopped naming their dealers,
   *  by house, and since when — purchases through them are no longer
   *  visible here (per branch since Riverside's own sheet, 2026-10-13). */
  detailEnded: { house: string; branches: string[]; since: string }[];
  yearSoFar: number;
  /** The year file's own last-year figure, when the dealer is in it. */
  yearFileLy: number;
  /** In the latest period that has this dealer, the split by house. */
  latestSplit: { house: string; branch: string; lf: number; share: number }[];
  products: DealerProduct[];
}

const num = (v: number | string | null | undefined) => {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const dealerKeyOf = (r: SellThroughRow) => dealerKey(r);

/**
 * "083003213 1X6-154\" THERMOWOOD CLAD V-GRV/NCKL GAP AYOUS" → the family
 * "1X6 THERMOWOOD CLAD V-GRV/NCKL GAP AYOUS" and the length 154".
 * The leading item code goes (it is per length), the length goes into its
 * own list, and what is left is the profile a person recognises.
 */
export function productFamily(raw: string): { family: string; length: string | null } {
  let s = raw.trim().replace(/^\d{6,}\s+/, "");
  let length: string | null = null;
  const m = s.match(/-(\d{2,3})"/);
  if (m) {
    length = `${m[1]}"`;
    s = s.replace(m[0], "");
  }
  return { family: s.replace(/\s+/g, " ").trim(), length };
}

export function dealerFacts(
  keys: ReadonlySet<string>,
  rows: readonly SellThroughRow[],
): DealerFacts | null {
  // A house's volume with no dealer named behind it is not a dealer: no
  // profile, no insight, no account to create (Boise, 2026-10-12).
  if ([...keys].some((k) => k.startsWith(UNDISCLOSED_PREFIX))) return null;
  const mine = rows.filter((r) => keys.has(dealerKeyOf(r)));
  if (mine.length === 0) return null;

  // A MONTH ONLY COUNTS IF ONE OF THIS DEALER'S BRANCHES NAMED ITS DEALERS
  // in it (Boise, 2026-10-12; per branch since Riverside's own sheet,
  // 2026-10-13). A blind Dallas says nothing about a yard that buys at
  // Dallas — neither a column nor silence — and nothing at all about one
  // that buys at Riverside, which is read as before.
  const myBranches = new Set(mine.map((r) => r.branch_id));
  // A month is a file for THIS dealer only when none of its own branches is
  // blind in it (review, 2026-10-13): with Dallas blind, a yard that buys at
  // Riverside AND Dallas cannot be called silent on Riverside's word alone.
  const blindIn = new Map<string, Set<string>>();
  const blindAt = (period: string) => {
    let b = blindIn.get(period);
    if (!b) {
      b = branchesWithoutDetail(rows, period);
      blindIn.set(period, b);
    }
    return b;
  };
  const clean = (period: string) => ![...myBranches].some((b) => blindAt(period).has(b));
  const detailed = rows.filter(
    (r) => myBranches.has(r.branch_id) && !isBranchLevel(r) && (r.period_kind === "YTD" || clean(r.period)),
  );
  const filesOnHand = [...new Set(detailed.map((r) => r.period))].sort();
  // A branch has "ended" only while its NEWEST month on file is blind; one
  // that came back to naming its dealers is read again, and says nothing.
  const lastDetailedAt = new Map<string, string>();
  const blindMonthsAt = new Map<string, string[]>();
  const branchMeta = new Map<string, { house: string; name: string }>();
  for (const r of rows) {
    if (!myBranches.has(r.branch_id) || r.period_kind === "YTD") continue;
    branchMeta.set(r.branch_id, { house: r.distributor_name, name: r.branch_name });
    if (isBranchLevel(r)) {
      const list = blindMonthsAt.get(r.branch_id) ?? [];
      if (!list.includes(r.period)) list.push(r.period);
      blindMonthsAt.set(r.branch_id, list);
    } else {
      const at = lastDetailedAt.get(r.branch_id);
      if (!at || r.period > at) lastDetailedAt.set(r.branch_id, r.period);
    }
  }
  const ended = new Map<string, { branches: Set<string>; since: string }>();
  for (const [branchId, months] of blindMonthsAt) {
    const last = lastDetailedAt.get(branchId) ?? "";
    const after = months.filter((m) => m > last).sort();
    if (after.length === 0) continue;
    const meta = branchMeta.get(branchId)!;
    const at = ended.get(meta.house) ?? { branches: new Set<string>(), since: after[0] };
    at.branches.add(meta.name);
    if (after[0] < at.since) at.since = after[0];
    ended.set(meta.house, at);
  }
  const detailEnded = [...ended.entries()]
    .map(([house, e]) => ({ house, branches: [...e.branches].sort((a, b) => a.localeCompare(b)), since: e.since }))
    .sort((a, b) => a.house.localeCompare(b.house));
  const first = mine[0];
  const accountId = mine.find((r) => r.dealer_id)?.dealer_id ?? null;
  // A label off the file leads with the distributor's customer code
  // ("THRBUSCO - MAXIMUS BUILDING SUPPLY"); the name a person says is after it.
  const name =
    mine.find((r) => r.dealer_name)?.dealer_name ?? dealerDisplayName(first);

  const uniq = (xs: (string | null | undefined)[]) =>
    [...new Set(xs.filter((x): x is string => !!x))].sort();

  // Period by period, split by house.
  const byPeriod = new Map<string, { kind: "YTD" | "MONTH"; lf: number; ly: number; houses: Map<string, number> }>();
  for (const r of mine) {
    const at =
      byPeriod.get(r.period) ??
      { kind: r.period_kind === "YTD" ? ("YTD" as const) : ("MONTH" as const), lf: 0, ly: 0, houses: new Map() };
    at.lf += num(r.quantity);
    at.ly += num(r.ly_quantity);
    at.houses.set(r.distributor_name, (at.houses.get(r.distributor_name) ?? 0) + num(r.quantity));
    byPeriod.set(r.period, at);
  }
  const periods: DealerPeriod[] = [...byPeriod.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, p]) => ({
      period,
      kind: p.kind,
      lf: p.lf,
      ly: p.ly,
      byHouse: [...p.houses.entries()]
        .map(([house, lf]) => ({ house, lf }))
        .sort((a, b) => b.lf - a.lf),
    }));

  const bought = periods.filter((p) => p.lf > 0);
  const yearFile = periods.find((p) => p.kind === "YTD") ?? null;
  const monthsAfter = periods.filter(
    (p) => p.kind === "MONTH" && (!yearFile || p.period > yearFile.period),
  );
  const yearSoFar = (yearFile?.lf ?? 0) + monthsAfter.reduce((n, p) => n + p.lf, 0);

  // Silence is only silence in a MONTH file that exists and is newer than the
  // last purchase; a missing file is unknown, never zero.
  const monthFiles = [
    ...new Set(detailed.filter((r) => r.period_kind !== "YTD").map((r) => r.period)),
  ].sort();
  const lastBought = bought.at(-1)?.period ?? null;
  const silentIn =
    lastBought !== null
      ? (monthFiles.filter((m) => m > lastBought).at(-1) ?? null)
      : null;

  // The latest period with volume, split by house and branch.
  const latestRows = lastBought ? mine.filter((r) => r.period === lastBought) : [];
  const latestTotal = latestRows.reduce((n, r) => n + num(r.quantity), 0);
  const splitMap = new Map<string, { house: string; branch: string; lf: number }>();
  for (const r of latestRows) {
    const k = `${r.distributor_name}::${r.branch_name}`;
    const at = splitMap.get(k) ?? { house: r.distributor_name, branch: r.branch_name, lf: 0 };
    at.lf += num(r.quantity);
    splitMap.set(k, at);
  }
  const latestSplit = [...splitMap.values()]
    .sort((a, b) => b.lf - a.lf)
    .map((s) => ({ ...s, share: latestTotal > 0 ? (100 * s.lf) / latestTotal : 0 }));

  // What they bought, over every file on hand, by product family.
  const fam = new Map<string, { lf: number; lengths: Set<string>; lines: number }>();
  let productTotal = 0;
  for (const r of mine) {
    if (!r.product) continue;
    const q = num(r.quantity);
    if (q <= 0) continue;
    const { family, length } = productFamily(r.product);
    const at = fam.get(family) ?? { lf: 0, lengths: new Set<string>(), lines: 0 };
    at.lf += q;
    at.lines += 1;
    if (length) at.lengths.add(length);
    fam.set(family, at);
    productTotal += q;
  }
  const products: DealerProduct[] = [...fam.entries()]
    .map(([family, p]) => ({
      family,
      lf: p.lf,
      share: productTotal > 0 ? (100 * p.lf) / productTotal : 0,
      lengths: [...p.lengths].sort((a, b) => parseInt(a) - parseInt(b)),
      lines: p.lines,
    }))
    .sort((a, b) => b.lf - a.lf);

  return {
    key: [...keys][0],
    name,
    labels: uniq(mine.map((r) => r.dealer_label)),
    accountId,
    regions: uniq(mine.map((r) => r.region_name)),
    reps: uniq(mine.map((r) => r.rep_name)),
    repIds: uniq(mine.map((r) => r.rep_id)),
    houses: uniq(mine.map((r) => r.distributor_name)),
    periods,
    filesOnHand,
    firstSeen: bought[0]?.period ?? null,
    lastBought,
    silentIn,
    detailEnded,
    yearSoFar,
    yearFileLy: yearFile?.ly ?? 0,
    latestSplit,
    products,
  };
}

/** What /api/dealer-insights answers: up to three findings, each naming the
 *  facts it rests on, and one suggested next action. */
export interface DealerInsights {
  insights: { title: string; body: string; from: string }[];
  action: {
    kind: "create_account" | "email_rep" | "alert_admins" | "plan_visit" | "add_contact" | "none";
    label: string;
    why: string;
  };
}
