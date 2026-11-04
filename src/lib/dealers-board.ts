// The Dealers board's own arithmetic, lifted out of app/dealers/page.tsx so the
// agent connector reads the same figures the page shows. A pure move: the page
// calls these and behaves exactly as before.

import { isLate } from "@/lib/domain/dealer-items";
import type { DealerTier, Tier } from "@/lib/domain/dealer-tiers";
import { displayAccountName } from "@/lib/format";

/** The market key the map uses for a row with no market. */
export const NO_MARKET = "unmapped";

export const TIER_ORDER: Record<Tier, number> = { T1: 0, T2: 1, T3: 2 };

export interface DealerLine {
  key: string;
  accountId: string | null;
  name: string;
  tier: Tier | null;
  lf: number;
  market: string;
  ownerId: string | null;
  lastVisit: string | null;
  open: number;
  late: number;
}

export interface DealerAccountRef {
  id: string;
  name: string;
  owner_id: string;
  territory_id: string | null;
}

/** Newest first in, so the first one seen per account is its last visit. */
export function lastVisitByAccount(
  visits: readonly { primary_account_id: string; occurred_at: string }[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const v of visits) {
    if (!m.has(v.primary_account_id)) m.set(v.primary_account_id, v.occurred_at.slice(0, 10));
  }
  return m;
}

export function openByAccount(
  items: readonly { account_id: string | null; completed_at: string | null; due_date: string }[],
  todayIso: string,
): Map<string, { open: number; late: number }> {
  const m = new Map<string, { open: number; late: number }>();
  for (const i of items) {
    if (!i.account_id) continue;
    const c = m.get(i.account_id) ?? { open: 0, late: 0 };
    c.open += 1;
    if (todayIso && isLate(i as never, todayIso)) c.late += 1;
    m.set(i.account_id, c);
  }
  return m;
}

/** Every dealer, one line each: the tiered ones, then the accounts no file has tiered. */
export function buildDealerLines(a: {
  tiers: readonly DealerTier[];
  untiered: readonly DealerAccountRef[];
  accountById: ReadonlyMap<string, DealerAccountRef>;
  openBy: ReadonlyMap<string, { open: number; late: number }>;
  lastVisit: ReadonlyMap<string, string>;
  showTiers: boolean;
}): DealerLine[] {
  const out: DealerLine[] = [];
  for (const t of a.tiers) {
    const acc = t.accountId ? a.accountById.get(t.accountId) : undefined;
    const o = t.accountId ? a.openBy.get(t.accountId) : undefined;
    out.push({
      key: t.key,
      accountId: t.accountId,
      name: acc ? displayAccountName(acc.name) : t.name,
      tier: t.tier,
      lf: t.lf,
      market: t.regionId ?? NO_MARKET,
      ownerId: acc?.owner_id ?? null,
      lastVisit: t.accountId ? (a.lastVisit.get(t.accountId) ?? null) : null,
      open: o?.open ?? 0,
      late: o?.late ?? 0,
    });
  }
  for (const u of a.untiered) {
    const o = a.openBy.get(u.id);
    out.push({
      key: u.id,
      accountId: u.id,
      name: displayAccountName(u.name),
      tier: null,
      lf: 0,
      market: u.territory_id ?? NO_MARKET,
      ownerId: u.owner_id,
      lastVisit: a.lastVisit.get(u.id) ?? null,
      open: o?.open ?? 0,
      late: o?.late ?? 0,
    });
  }
  // Tier order and LF order both give the tiers away; without them, by name.
  return out.sort((x, y) =>
    a.showTiers
      ? (x.tier ? TIER_ORDER[x.tier] : 3) - (y.tier ? TIER_ORDER[y.tier] : 3) ||
        y.lf - x.lf ||
        x.name.localeCompare(y.name)
      : x.name.localeCompare(y.name),
  );
}
