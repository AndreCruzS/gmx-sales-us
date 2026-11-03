"use client";

// DEALERS — the desk's action board for Bianca and João (meeting 2026-10-27,
// approved mockup v3, screen 1). The bar reads Sales · Dealers · Reps ·
// Accounts (Andre, 2026-10-30).
//
// Overview → insight → act, top to bottom:
//   · the tiers, as four figures — T1 is the dealers that make up 80% of the
//     last twelve months' LF, T2 the rest who bought in 3+ of those months,
//     T3 everyone else, and "No history" the dealer accounts the files have
//     never put a tier on;
//   · the map by market, and one card per market with its tier split and how
//     many of its to-dos are late — picking a market (on the map or its card)
//     narrows the dealer table under it;
//   · the market's dealers: tier, last visit, what is open, whose patch;
//   · what we owe dealers, by urgency, the PK follow-ups as one line that
//     leads to their own board.
//
// The tier is a fact of the files (dealer-tiers.ts), not a label somebody
// types, so the page never asks anyone to set one.
//
// A row — or a to-do — opens the dealer sheet (dealer-sheet.tsx): beside the
// board on the desk, so the list stays where the reader left it; a full-width
// sheet on a phone. Its "Sales facts" open the dealer module, so the board
// sits inside a DealerModuleProvider with the rows it already holds.

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { DealerModuleProvider } from "@/components/dealer-module";
import { DealerSheet } from "@/components/dealer-sheet";
import { DealersTabs } from "@/components/dealers-tabs";
import { DealerTable, TierTile, type DealerLine } from "@/components/dealers-table";
import { DealersTodos, type DealerItem } from "@/components/dealers-todos";
import { useOffline } from "@/components/offline-provider";
import { SalesMap } from "@/components/sales-map";
import { packDesk, spanner } from "@/lib/desk-pack";
import { isLate } from "@/lib/domain/dealer-items";
import {
  tierCounts,
  tierDealers,
  untieredTargets,
  type DealerTier,
  type Tier,
} from "@/lib/domain/dealer-tiers";
import { isAdmin, seesDealersBoard } from "@/lib/domain/roles";
import { isBranchLevel, type BranchRef, type SellThroughRow } from "@/lib/domain/sell-through";
import { displayAccountName } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/page";

// The /reps select list, verbatim, so both boards read the same row.
const SELL_COLS =
  "period, rep_id, rep_name, region_id, region_name, market_owner_name, distributor_id, distributor_name, branch_id, branch_name, branch_city, branch_state, dealer_id, dealer_name, dealer_label, product, quantity, unit, value, ly_quantity, period_kind, is_house_account, detail";

const ITEM_COLS =
  "id, action, due_date, owner_id, account_id, item_type, source, entered_by, completed_at, priority, account:accounts!next_actions_account_id_fkey(name), activity:activities!next_actions_activity_id_fkey(activity_type)";

/** A visit is somebody standing in front of the account; a call is not. */
const VISIT_TYPES = ["DEALER_VISIT", "DISTRIBUTOR_VISIT", "JOBSITE_VISIT", "PK_TRAINING"];

/** The market key the map uses for a row with no market. */
const NO_MARKET = "unmapped";

const TIER_ORDER: Record<Tier, number> = { T1: 0, T2: 1, T3: 2 };

interface DealerAccount {
  id: string;
  name: string;
  owner_id: string;
  territory_id: string | null;
}

interface MemberName {
  id: string;
  users: { full_name: string | null } | null;
}

/** A promise on an account, open or closed — for the team's promises per visit. */
interface PromiseRow {
  id: string;
  account_id: string | null;
}

interface VisitRow {
  primary_account_id: string;
  occurred_at: string;
}

/** What opening a dealer hands the dealer sheet (Task 7). A dealer known only
 *  by its label in the files has no account yet, so accountId can be null. */
export interface OpenDealer {
  key: string;
  accountId: string | null;
  name: string;
}

interface Market {
  key: string;
  name: string;
  t1: number;
  t2: number;
  t3: number;
  untiered: number;
  late: number;
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "2026-11-01" shifted by `by` months. */
function shiftMonth(period: string, by: number): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7)) - 1 + by;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

export default function DealersPage() {
  const { profile } = useOffline();
  const desk = seesDealersBoard(profile?.role);
  // Tiers are worked out from EVERY dealer's sales. Only an admin reads every
  // row (the sell_through policy hands the rest only the dealers they can see),
  // so only an admin is shown a tier.
  const showTiers = isAdmin(profile?.role);

  const [rows, setRows] = useState<SellThroughRow[]>([]);
  const [accounts, setAccounts] = useState<DealerAccount[]>([]);
  const [items, setItems] = useState<DealerItem[]>([]);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [promises, setPromises] = useState<PromiseRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [marketNames, setMarketNames] = useState<Map<string, string>>(new Map());
  const [branches, setBranches] = useState<BranchRef[]>([]);
  // Stamped when the data lands, never read from the clock during a render.
  const [asOf, setAsOf] = useState("");
  const [todayIso, setTodayIso] = useState("");
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [picked, setPicked] = useState<string | null>(null);
  // Which dealer the sheet shows; it also marks the row in the table.
  const [selected, setSelected] = useState<OpenDealer | null>(null);
  const onOpenDealer = useCallback((d: OpenDealer) => setSelected(d), []);
  const onCloseDealer = useCallback(() => setSelected(null), []);
  // A to-do added from the board is shown at once (and counted in the dealer's
  // open/late figures); the outbox sends it, the next load confirms it.
  const onAdded = useCallback(
    (item: DealerItem) => setItems((list) => [...list, item]),
    [],
  );

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const now = new Date();
    const first = isoOf(new Date(now.getFullYear(), now.getMonth(), 1));
    // The tiers read the twelve months before this one (the files are a month
    // behind), so that is all the page fetches — paged, because PostgREST
    // caps every answer at 1,000 rows without saying so.
    const start = shiftMonth(first, -12);
    const [st, ac, na, vs, ms, tr, br, pr] = await Promise.all([
      fetchAllPages<SellThroughRow>((from, to) =>
        supabase
          .from("sell_through_rows")
          .select(SELL_COLS)
          .gte("period", start)
          .lt("period", first)
          .order("period")
          .order("row_id")
          .range(from, to),
      ),
      fetchAllPages<DealerAccount>((from, to) =>
        supabase
          .from("accounts")
          .select("id, name, owner_id, territory_id")
          .eq("account_type", "DEALER")
          .order("id")
          .range(from, to),
      ),
      // Open to-dos only; a visit (no item_type) is on the agenda, not here.
      fetchAllPages<DealerItem>((from, to) =>
        supabase
          .from("next_actions")
          .select(ITEM_COLS)
          .is("completed_at", null)
          .not("item_type", "is", null)
          .order("due_date")
          .order("id")
          .range(from, to)
          .then((r) => ({ data: r.data as unknown as DealerItem[] | null, error: r.error })),
      ),
      // Newest first, so the first one seen per account is its last visit.
      fetchAllPages<VisitRow>((from, to) =>
        supabase
          .from("activities")
          .select("primary_account_id, occurred_at")
          .in("activity_type", VISIT_TYPES)
          // A visit on the agenda has not happened yet: it is not the last one.
          .lte("occurred_at", new Date().toISOString())
          .order("occurred_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      // Names for owners and for whoever typed a to-do — memberships, not the
      // rep scorecard, because an admin who enters one is not a rep.
      fetchAllPages<MemberName>((from, to) =>
        supabase
          .from("memberships")
          .select("id, users(full_name)")
          .order("id")
          .range(from, to)
          .then((r) => ({ data: r.data as unknown as MemberName[] | null, error: r.error })),
      ),
      fetchAllPages<{ id: string; name: string }>((from, to) =>
        supabase.from("territories").select("id, name").order("id").range(from, to),
      ),
      // Every yard, the quiet ones too — the map pins them hollow.
      fetchAllPages<BranchRef>((from, to) =>
        supabase
          .from("distributor_branches")
          .select("id, distributor_id, name, city, state")
          .order("id")
          .range(from, to),
      ),
      // Every promise ever made, kept ones too — the team's promises per
      // visit, which the dealer sheet weighs one dealer against.
      fetchAllPages<PromiseRow>((from, to) =>
        supabase
          .from("next_actions")
          .select("id, account_id")
          .eq("item_type", "PROMISE")
          .order("id")
          .range(from, to),
      ),
    ]);
    setRows(st);
    setAccounts(ac);
    setItems(na);
    setVisits(vs);
    setPromises(pr);
    setNames(new Map(ms.map((m) => [m.id, m.users?.full_name ?? "Someone"] as const)));
    setMarketNames(new Map(tr.map((t) => [t.id, t.name])));
    setBranches(br);
    setAsOf(first);
    setTodayIso(isoOf(now));
    setLoadedAt(Date.now());
  }, []);

  const attempt = useCallback(async () => {
    setLoadFailed(false);
    try {
      await load();
    } catch {
      setLoadFailed(true);
    }
  }, [load]);

  useEffect(() => {
    if (!profile || !seesDealersBoard(profile.role)) return;
    const timer = setTimeout(() => void attempt(), 0);
    return () => clearTimeout(timer);
  }, [profile, attempt]);

  // ── THE TIERS ────────────────────────────────────────────────────────────
  const tiers = useMemo(() => (asOf ? tierDealers(rows, asOf) : []), [rows, asOf]);
  const counts = useMemo(() => tierCounts(tiers), [tiers]);
  const t1Share = useMemo(
    () => tiers.filter((t) => t.tier === "T1").reduce((n, t) => n + t.share, 0),
    [tiers],
  );
  const untiered = useMemo(() => untieredTargets(accounts, tiers), [accounts, tiers]);
  const tierByAccount = useMemo(() => {
    const m = new Map<string, DealerTier>();
    for (const t of tiers) if (t.accountId) m.set(t.accountId, t);
    return m;
  }, [tiers]);
  const tierOf = useCallback(
    (id: string | null) => (showTiers && id ? (tierByAccount.get(id)?.tier ?? null) : null),
    [tierByAccount, showTiers],
  );

  // ── THE MAP: monthly LF rows only — a year file overlaps the months it
  // sums, and the map would count them twice. ──────────────────────────────
  const mapRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.period_kind !== "YTD" &&
          (r.unit === null || r.unit.toUpperCase() === "LF"),
      ),
    [rows],
  );
  // Each market wears the colour of its rank by LF, the order the Sales
  // board's map gives it.
  const regionHue = useMemo(() => {
    const lf = new Map<string, number>();
    for (const r of mapRows) {
      const k = r.region_id ?? NO_MARKET;
      lf.set(k, (lf.get(k) ?? 0) + (Number(r.quantity) || 0));
    }
    const ranked = [...lf.entries()].sort((a, b) => b[1] - a[1]);
    return new Map(
      ranked.map(([k], i) => [k, i < 8 ? `var(--cat-${i + 1})` : "var(--cat-rest)"] as const),
    );
  }, [mapRows]);
  const windowLabel = useMemo(() => {
    if (!asOf) return "";
    const fmt = (p: string) =>
      new Date(`${p}T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    return `${fmt(shiftMonth(asOf, -12))} – ${fmt(shiftMonth(asOf, -1))}`;
  }, [asOf]);

  // ── EVERY DEALER, ONE LINE EACH ─────────────────────────────────────────
  const lastVisit = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of visits) {
      if (!m.has(v.primary_account_id)) m.set(v.primary_account_id, v.occurred_at.slice(0, 10));
    }
    return m;
  }, [visits]);
  const openBy = useMemo(() => {
    const m = new Map<string, { open: number; late: number }>();
    for (const i of items) {
      if (!i.account_id) continue;
      const c = m.get(i.account_id) ?? { open: 0, late: 0 };
      c.open += 1;
      if (todayIso && isLate(i, todayIso)) c.late += 1;
      m.set(i.account_id, c);
    }
    return m;
  }, [items, todayIso]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  // The team's promises per visit, over dealer accounts only — the yardstick
  // the sheet's warning line reads one dealer against.
  const teamPerVisit = useMemo(() => {
    const v = visits.filter((x) => accountById.has(x.primary_account_id)).length;
    const p = promises.filter((x) => x.account_id && accountById.has(x.account_id)).length;
    return v > 0 ? p / v : null;
  }, [visits, promises, accountById]);
  const tierByKey = useMemo(() => new Map(tiers.map((t) => [t.key, t] as const)), [tiers]);

  const lines = useMemo<DealerLine[]>(() => {
    const out: DealerLine[] = [];
    for (const t of tiers) {
      const acc = t.accountId ? accountById.get(t.accountId) : undefined;
      const o = t.accountId ? openBy.get(t.accountId) : undefined;
      out.push({
        key: t.key,
        accountId: t.accountId,
        name: acc ? displayAccountName(acc.name) : t.name,
        tier: t.tier,
        lf: t.lf,
        market: t.regionId ?? NO_MARKET,
        ownerId: acc?.owner_id ?? null,
        lastVisit: t.accountId ? (lastVisit.get(t.accountId) ?? null) : null,
        open: o?.open ?? 0,
        late: o?.late ?? 0,
      });
    }
    for (const a of untiered) {
      const o = openBy.get(a.id);
      out.push({
        key: a.id,
        accountId: a.id,
        name: displayAccountName(a.name),
        tier: null,
        lf: 0,
        market: a.territory_id ?? NO_MARKET,
        ownerId: a.owner_id,
        lastVisit: lastVisit.get(a.id) ?? null,
        open: o?.open ?? 0,
        late: o?.late ?? 0,
      });
    }
    // Tier order and LF order both give the tiers away; without them, by name.
    return out.sort((a, b) =>
      showTiers
        ? (a.tier ? TIER_ORDER[a.tier] : 3) - (b.tier ? TIER_ORDER[b.tier] : 3) ||
          b.lf - a.lf ||
          a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name),
    );
  }, [tiers, untiered, accountById, openBy, lastVisit, showTiers]);

  // ── THE MARKETS ──────────────────────────────────────────────────────────
  const marketName = useCallback(
    (key: string) =>
      key === NO_MARKET
        ? "No market"
        : (marketNames.get(key) ??
          rows.find((r) => r.region_id === key)?.region_name ??
          "Market"),
    [marketNames, rows],
  );
  const markets = useMemo<Market[]>(() => {
    const m = new Map<string, Market>();
    for (const l of lines) {
      const mk =
        m.get(l.market) ??
        { key: l.market, name: marketName(l.market), t1: 0, t2: 0, t3: 0, untiered: 0, late: 0 };
      if (l.tier === "T1") mk.t1 += 1;
      else if (l.tier === "T2") mk.t2 += 1;
      else if (l.tier === "T3") mk.t3 += 1;
      else mk.untiered += 1;
      mk.late += l.late;
      m.set(l.market, mk);
    }
    // Most Tier 1 first — the order of where the volume is.
    return [...m.values()].sort((a, b) =>
      showTiers
        ? b.t1 - a.t1 || b.t2 - a.t2 || b.t3 - a.t3 || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name),
    );
  }, [lines, marketName, showTiers]);

  const shown = useMemo(
    () => (picked ? lines.filter((l) => l.market === picked) : lines),
    [lines, picked],
  );
  const pick = useCallback((key: string | null) => setPicked(key), []);

  const span = useMemo(
    () =>
      spanner(
        packDesk([
          { k: "map", w: "full" },
          { k: "todos", w: "full" },
          { k: "table", w: "full" },
        ]),
      ),
    [],
  );

  // ── WHO MAY READ IT ──────────────────────────────────────────────────────
  if (profile && !desk) {
    return (
      <div className="stack pt-2">
        <section>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">Dealers</h1>
          <DealersTabs current="overview" />
          <p className="t-sub mt-1">This page is for the sales desk and the assistants who work with it.</p>
        </section>
      </div>
    );
  }

  // SHAPE WITHOUT VALUES — blocks where the figures will be, never a zero.
  if (loadedAt === null && !loadFailed) {
    return (
      <div className="stack pt-2" aria-busy="true">
        <section>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">Dealers</h1>
          <DealersTabs current="overview" />
          <span className="skel mt-2" style={{ width: "60%", height: 13 }} />
        </section>
        <section>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="card card-pad block">
                <span className="skel" style={{ width: "40%", height: 10 }} />
                <span className="skel mt-2" style={{ width: "30%", height: 28 }} />
                <span className="skel mt-2" style={{ width: "60%", height: 11 }} />
              </span>
            ))}
          </div>
        </section>
        <section>
          <span className="skel" style={{ width: "100%", height: 260 }} />
        </section>
      </div>
    );
  }

  if (loadedAt === null) {
    return (
      <div className="stack pt-2">
        <section>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">Dealers</h1>
          <DealersTabs current="overview" />
          <p className="t-sub mt-1" style={{ maxWidth: "52ch" }}>
            The dealers live on the server and this device can&rsquo;t reach it right now.
            Nothing is lost &mdash; try again when you&rsquo;re back online.
          </p>
        </section>
        <button type="button" onClick={() => void attempt()} className="btn-secondary w-full">
          Try again
        </button>
      </div>
    );
  }

  const pickedMarket = picked ? markets.find((m) => m.key === picked) : undefined;
  const hasBlindRows = mapRows.some(isBranchLevel);

  return (
    <DealerModuleProvider rows={rows}>
    <div className="dl-layout" data-open={selected ? "" : undefined}>
    <div className="stack pt-2 mgr-home dealers-board">
      <section data-desk="hero" data-span="full">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">Dealers</h1>
        <DealersTabs current="overview" />
        <p className="t-sub mt-2" style={{ maxWidth: "62ch" }}>
          Every dealer by what they bought over the last twelve months ({windowLabel}), where
          they are, and what the team still owes them. Pick a market to read its dealers.
        </p>
      </section>

      {/* THE FOUR FIGURES — the tiers, and the dealers with no sales on file.
          Admins only: a tier is worked out from every dealer's sales. */}
      {showTiers ? (
      <section className="adapt" data-desk="tiles" data-span="full">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TierTile
            tier="T1"
            label="Tier 1"
            count={counts.T1}
            note={
              tiers.length > 0
                ? `the biggest buyers · ${Math.round(t1Share * 100)}% of the LF`
                : "no sales on file in the window"
            }
          />
          <TierTile tier="T2" label="Tier 2" count={counts.T2} note="steady · bought in 3+ months" />
          <TierTile tier="T3" label="Tier 3" count={counts.T3} note="occasional · under 3 months" />
          <TierTile
            tier={null}
            label="No history"
            count={untiered.length}
            note="dealer accounts with no sales on file"
          />
        </div>
        {/* THE LEGEND (Andre, 2026-11-03): what a tier means, in one place,
            so a T1 chip anywhere on the page can be read. */}
        <dl className="dl-legend">
          <dt>
            <span className="dl-tier" data-tier="T1">T1</span>
          </dt>
          <dd>The dealers who together bought 80% of all LF{windowLabel ? ` in ${windowLabel}` : " in the last twelve months"}, biggest first.</dd>
          <dt>
            <span className="dl-tier" data-tier="T2">T2</span>
          </dt>
          <dd>Everyone else who bought in at least 3 of those 12 months.</dd>
          <dt>
            <span className="dl-tier" data-tier="T3">T3</span>
          </dt>
          <dd>Bought in fewer than 3 of the 12 months.</dd>
          <dt className="dl-legend-none">—</dt>
          <dd>No history: a dealer account the distributors&rsquo; files have never named.</dd>
        </dl>
        <p className="t-hint dl-legend-foot">
          Tiers come from the distributors&rsquo; sales files and move on their own as new months load; nobody sets one by hand.
        </p>
      </section>
      ) : (
        <section data-desk="tiles" data-span="full">
          <p className="t-hint">
            Tiers are shown to admins: they are worked out from every dealer&rsquo;s sales.
          </p>
        </section>
      )}

      {/* THE MAP, then one card per market. Picking either narrows the table. */}
      <section className="adapt card card-pad dl-map" data-desk="map" data-span={span("map")}>
        <p className="sales-eyebrow dl-eyebrow">{showTiers ? "Tier map · by market" : "Map · by market"}</p>
        <SalesMap
          rows={mapRows}
          branches={branches}
          unit="LF"
          month={windowLabel}
          regionHue={regionHue}
          picked={picked}
          onPick={pick}
        />
        {hasBlindRows && (
          <p className="t-hint">
            Some yards send their totals without naming dealers; that volume is on the map but
            in no dealer&rsquo;s tier.
          </p>
        )}
        <ul className="dl-markets" aria-label="Markets">
          {markets.map((m) => (
            <li key={m.key}>
              <button
                type="button"
                className="dl-market"
                aria-pressed={picked === m.key}
                style={{ "--mk": regionHue.get(m.key) ?? "var(--cat-rest)" } as CSSProperties}
                onClick={() => pick(picked === m.key ? null : m.key)}
              >
                <span className="dl-market-name">{m.name}</span>
                {showTiers && (
                  <span className="dl-market-tiers">
                    T1 {m.t1} · T2 {m.t2} · T3 {m.t3}
                  </span>
                )}
                <span className="t-hint">
                  {!showTiers
                    ? `${m.t1 + m.t2 + m.t3 + m.untiered} ${m.t1 + m.t2 + m.t3 + m.untiered === 1 ? "dealer" : "dealers"}`
                    : m.untiered > 0
                      ? `${m.untiered} with no history`
                      : "every dealer has history"}
                  {m.late > 0 && (
                    <>
                      {" · "}
                      <span className="dl-late-text">{m.late} late</span>
                    </>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <DealersTodos
        items={items}
        todayIso={todayIso}
        myId={profile?.membershipId ?? null}
        names={names}
        tierOf={tierOf}
        onOpen={(accountId, name) =>
          onOpenDealer({
            key: tierByAccount.get(accountId)?.key ?? accountId,
            accountId,
            name,
          })
        }
        onAdded={onAdded}
        span={span("todos")}
      />

      <DealerTable
        title={pickedMarket ? pickedMarket.name : "All markets"}
        lines={shown}
        names={names}
        todayIso={todayIso}
        selectedKey={selected?.key ?? null}
        showTiers={showTiers}
        onOpen={(l) => onOpenDealer({ key: l.key, accountId: l.accountId, name: l.name })}
        onClear={picked ? () => pick(null) : null}
        span={span("table")}
      />
    </div>
    {selected && (
      <DealerSheet
        key={selected.key}
        dealer={selected}
        tier={tierByKey.get(selected.key) ?? null}
        showTier={showTiers}
        onClose={onCloseDealer}
        teamPerVisit={teamPerVisit}
        names={names}
        onAdded={onAdded}
      />
    )}
    </div>
    </DealerModuleProvider>
  );
}
