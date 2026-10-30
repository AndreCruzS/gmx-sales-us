// DEALER TIERS (Bianca and João, meeting 2026-10-27): the Dealers page reads
// dealers as Tier 1, 2 or 3, and the tier is a fact of the files, not a label
// somebody types.
//
//   T1  the dealers that make up the first 80% of LF over the last 12 months,
//       biggest first — the one that crosses the line is inside it. T1 is
//       decided BEFORE T3, so a small-month dealer inside the 80% is still T1.
//   T2  everyone else who bought in 3 or more of those months.
//   T3  everyone else.
//
// Pure: rows in, tiers out. The window is the 12 months ending the month
// BEFORE `asOf`, because the files are always a month behind and the current
// month is never complete.

import {
  dealerDisplayName,
  dealerKey,
  isBranchLevel,
  UNDISCLOSED_PREFIX,
  type SellThroughRow,
} from "@/lib/domain/sell-through";

export type Tier = "T1" | "T2" | "T3";

export interface DealerTier {
  key: string;
  name: string;
  /** The row's dealer_id; null for a dealer we only know by its label. */
  accountId: string | null;
  lf: number;
  purchaseMonths: number;
  /** Share of the total LF of every tiered dealer, 0..1. */
  share: number;
  tier: Tier;
  /** The region where this dealer bought the most LF. */
  regionId: string | null;
  regionName: string | null;
}

const WINDOW_MONTHS = 12;
const T1_SHARE = 0.8;
const T2_MIN_MONTHS = 3;

function num(v: number | string | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** "2026-11-01" shifted by `by` months, as YYYY-MM-01. Pure string maths: a
 *  period is a label, not a moment. */
function shiftMonth(period: string, by: number): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7)) - 1 + by;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

interface Acc {
  rows: SellThroughRow[];
}

export function tierDealers(rows: readonly SellThroughRow[], asOf: string): DealerTier[] {
  const end = asOf.slice(0, 10); // exclusive: the month before it is the last one read
  const start = shiftMonth(end, -WINDOW_MONTHS);

  const byDealer = new Map<string, Acc>();
  for (const r of rows) {
    // Branch-level volume has no buyer, a house account is the distributor's
    // own counter, and LF is the only measure there is.
    if (isBranchLevel(r) || r.is_house_account) continue;
    if (r.unit !== null && r.unit.toUpperCase() !== "LF") continue;
    const period = r.period.slice(0, 10);
    if (period < start || period >= end) continue;
    const key = dealerKey(r);
    if (key.startsWith(UNDISCLOSED_PREFIX)) continue;
    const acc = byDealer.get(key) ?? { rows: [] };
    acc.rows.push(r);
    byDealer.set(key, acc);
  }

  interface Measured {
    key: string;
    name: string;
    accountId: string | null;
    lf: number;
    purchaseMonths: number;
    regionId: string | null;
    regionName: string | null;
  }
  const measured: Measured[] = [];
  for (const [key, acc] of byDealer) {
    // YTD rows overlap the monthly ones, so the rule is per (dealer,
    // distributor): where that dealer has MONTH rows from a distributor in the
    // window they are read; otherwise that distributor's LATEST year file
    // stands in for it, as one purchase month.
    const monthRows = new Map<string, SellThroughRow[]>();
    const ytdRows = new Map<string, SellThroughRow[]>();
    for (const r of acc.rows) {
      const into = r.period_kind === "YTD" ? ytdRows : monthRows;
      const list = into.get(r.distributor_id);
      if (list) list.push(r);
      else into.set(r.distributor_id, [r]);
    }
    const counted: SellThroughRow[] = [];
    const months = new Set<string>();
    for (const list of monthRows.values()) {
      for (const r of list) {
        counted.push(r);
        months.add(r.period.slice(0, 10));
      }
    }
    let purchaseMonths = months.size;
    for (const [distributor, list] of ytdRows) {
      if (monthRows.has(distributor)) continue;
      let latest = "";
      for (const r of list) {
        const p = r.period.slice(0, 10);
        if (p > latest) latest = p;
      }
      for (const r of list) if (r.period.slice(0, 10) === latest) counted.push(r);
      purchaseMonths += 1;
    }

    let lf = 0;
    const byRegion = new Map<string, { id: string | null; name: string | null; lf: number }>();
    for (const r of counted) {
      const q = num(r.quantity);
      lf += q;
      const rk = r.region_id ?? "";
      const seen = byRegion.get(rk);
      if (seen) seen.lf += q;
      else byRegion.set(rk, { id: r.region_id, name: r.region_name, lf: q });
    }
    if (lf <= 0) continue;
    const region = [...byRegion.values()].sort(
      (a, b) => b.lf - a.lf || (a.name ?? "").localeCompare(b.name ?? ""),
    )[0];

    const first = counted[0];
    measured.push({
      key,
      name: dealerDisplayName(first),
      accountId: counted.find((r) => r.dealer_id)?.dealer_id ?? null,
      lf,
      purchaseMonths,
      regionId: region?.id ?? null,
      regionName: region?.name ?? null,
    });
  }

  measured.sort((a, b) => b.lf - a.lf || a.name.localeCompare(b.name));
  const total = measured.reduce((n, d) => n + d.lf, 0);

  // A dealer is T1 while the dealers strictly ahead of it have not yet reached
  // 80%. The epsilon keeps 80 of 100 from tipping on float noise.
  let ahead = 0;
  return measured.map((d) => {
    const inside = ahead < T1_SHARE * total - 1e-9;
    ahead += d.lf;
    const tier: Tier = inside ? "T1" : d.purchaseMonths >= T2_MIN_MONTHS ? "T2" : "T3";
    return { ...d, share: d.lf / total, tier };
  });
}

export function tierCounts(tiers: readonly DealerTier[]): Record<Tier, number> {
  const out: Record<Tier, number> = { T1: 0, T2: 0, T3: 0 };
  for (const t of tiers) out[t.tier] += 1;
  return out;
}

/** Dealer accounts the files have never put a tier on: no LF in the window. */
export function untieredTargets<T extends { id: string }>(
  dealerAccounts: readonly T[],
  tiers: readonly DealerTier[],
): T[] {
  const tiered = new Set(tiers.map((t) => t.accountId).filter((id): id is string => id !== null));
  return dealerAccounts.filter((a) => !tiered.has(a.id));
}
