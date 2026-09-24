"use client";

// THE DEALER MODULE (Bianca and João, 2026-09-18; prototype approved by Andre
// 2026-09-21). Tap any dealer's name, in any list, and everything we know about
// the relationship opens in one place, in the order the system should always
// read: an OVERVIEW of the facts, the INSIGHTS they suggest, and the next
// ACTION ("o dado só serve se eu conseguir interpretar ele e a partir da
// interpretação eu tenho que tomar uma ação" — João).
//
// It opens from a name, not an account: most dealers in the files have no
// account yet, and a module that only worked for accounts would open for eight
// dealers out of a hundred. A sheet on the phone, a side panel on the desk, so
// the list the reader came from stays where it was.
//
// Honest about what is missing: an empty contacts list is shown as "none
// recorded", because that absence is itself something to act on.

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { NewCompanyInline } from "@/components/new-company-inline";
import { WhereTags } from "@/components/where-tags";
import {
  dealerFacts,
  type DealerFacts,
  type DealerInsights,
} from "@/lib/domain/dealer-profile";
import { distributorColour, periodLabel, periodShort } from "@/lib/domain/sell-through";
import type { SellThroughRow } from "@/lib/domain/sell-through";
import { getOfflineLayer } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// ── Opening it from anywhere ────────────────────────────────────────────────

const DealerModuleContext = createContext<{
  open: (key: string) => void;
  /** The product line the page is filtered to, when it is not all of them —
   *  the module's figures are that line's, and must say so. */
  lineLabel?: string;
} | null>(null);

/** Null outside a provider, so a list can offer the module only where it exists. */
export function useDealerModule() {
  return useContext(DealerModuleContext);
}

export function DealerModuleProvider({
  rows,
  lineLabel,
  children,
}: {
  /** Every sell-through row on hand, year file and months alike — already
   *  narrowed to the product line the page is reading. */
  rows: readonly SellThroughRow[];
  lineLabel?: string;
  children: React.ReactNode;
}) {
  const [key, setKey] = useState<string | null>(null);
  const value = useMemo(() => ({ open: (k: string) => setKey(k), lineLabel }), [lineLabel]);
  return (
    <DealerModuleContext.Provider value={value}>
      {children}
      {key !== null && (
        <DealerModule
          key={key}
          dealerKey={key}
          rows={rows}
          lineLabel={lineLabel}
          onClose={() => setKey(null)}
        />
      )}
    </DealerModuleContext.Provider>
  );
}

/** A dealer's name as a way into its module — a button where the module
 *  exists, plain text where it does not. */
export function DealerName({
  dealerKey,
  children,
  className,
}: {
  dealerKey: string;
  children: React.ReactNode;
  className?: string;
}) {
  const mod = useDealerModule();
  if (!mod) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      className={`dmod-open ${className ?? ""}`}
      onClick={() => mod.open(dealerKey)}
    >
      {children}
    </button>
  );
}

// ── What we hold about the relationship ─────────────────────────────────────

interface Relationship {
  strategic: boolean;
  yards: { id: string; name: string }[];
  contacts: { count: number; names: string[] };
  visits: { count: number; last: string | null };
  notes: { count: number; last: string | null; lastBody: string | null };
  quotes: number;
  rollout: {
    total: number;
    pk: number;
    merch: number;
    stocked: number;
    notStocked: string[];
    pending: string[];
  } | null;
}

async function loadRelationship(accountId: string): Promise<Relationship> {
  const supabase = getSupabaseBrowserClient();
  const [acc, kids] = await Promise.all([
    supabase.from("accounts").select("id, strategic_importance").eq("id", accountId).maybeSingle(),
    supabase.from("accounts").select("id, name").eq("parent_account_id", accountId).order("name"),
  ]);
  const yards = ((kids.data as { id: string; name: string }[] | null) ?? []);
  const ids = [accountId, ...yards.map((y) => y.id)];
  const [ct, act, nt, opp, ro] = await Promise.all([
    supabase.from("contacts").select("name", { count: "exact" }).in("account_id", ids).limit(3),
    supabase
      .from("activities")
      .select("occurred_at", { count: "exact" })
      .in("primary_account_id", ids)
      .order("occurred_at", { ascending: false })
      .limit(1),
    supabase
      .from("account_notes")
      .select("created_at, body", { count: "exact" })
      .in("account_id", ids)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .in("primary_account_id", ids),
    supabase
      .from("account_rollout")
      .select("account_id, pk_state, merchandiser_state, material_state")
      .in("account_id", ids),
  ]);
  const nameOf = new Map(yards.map((y) => [y.id, y.name]));
  const gates = ((ro.data as
    | { account_id: string; pk_state: string | null; merchandiser_state: string | null; material_state: string | null }[]
    | null) ?? []).filter((g) => nameOf.has(g.account_id) || yards.length === 0);
  return {
    strategic: (acc.data as { strategic_importance: string | null } | null)?.strategic_importance === "STRATEGIC",
    yards,
    contacts: {
      count: ct.count ?? 0,
      names: ((ct.data as { name: string }[] | null) ?? []).map((c) => c.name),
    },
    visits: {
      count: act.count ?? 0,
      last: ((act.data as { occurred_at: string }[] | null) ?? [])[0]?.occurred_at ?? null,
    },
    notes: {
      count: nt.count ?? 0,
      last: ((nt.data as { created_at: string; body: string }[] | null) ?? [])[0]?.created_at ?? null,
      lastBody: ((nt.data as { created_at: string; body: string }[] | null) ?? [])[0]?.body ?? null,
    },
    quotes: opp.count ?? 0,
    rollout:
      gates.length === 0
        ? null
        : {
            total: gates.length,
            pk: gates.filter((g) => g.pk_state === "OK").length,
            merch: gates.filter((g) => g.merchandiser_state === "OK").length,
            stocked: gates.filter((g) => g.material_state === "OK").length,
            notStocked: gates
              .filter((g) => g.material_state === "NO")
              .map((g) => shortYard(nameOf.get(g.account_id) ?? "")),
            pending: gates
              .filter((g) => g.material_state === "PENDING")
              .map((g) => shortYard(nameOf.get(g.account_id) ?? "")),
          },
  };
}

/** "Ganahl Pasadena" under Ganahl reads "Pasadena". */
function shortYard(name: string) {
  const parts = name.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

// ── The overview, in one sentence, from the facts alone ─────────────────────

function overviewSentence(f: DealerFacts): string {
  const last = f.lastBought ? f.periods.find((p) => p.period === f.lastBought) : null;
  const yearFile = f.periods.find((p) => p.kind === "YTD");
  const firstTime = f.firstSeen === f.lastBought && !yearFile;
  if (!last) return "On file, but no purchase in any file on hand.";
  const lastWhen = last.kind === "YTD" ? `Jan–${periodShort(last.period)}` : periodLabel(last.period);
  if (f.silentIn) {
    return `${firstTime ? "Bought once" : "Last bought"} — ${QTY.format(last.lf)} LF in ${lastWhen}${
      firstTime ? ", its first time on any file" : ""
    }. Nothing in ${periodLabel(f.silentIn)}.`;
  }
  if (yearFile && f.yearFileLy > 0) {
    const pct = Math.round((100 * (yearFile.lf - f.yearFileLy)) / f.yearFileLy);
    return `${pct >= 0 ? "Up" : "Down"} ${Math.abs(pct)}% on last year for Jan–${periodShort(
      yearFile.period,
    )}, and ${QTY.format(last.lf)} LF in ${lastWhen}${f.houses.length > 1 ? ` across ${f.houses.length} houses` : ""}.`;
  }
  return `${QTY.format(last.lf)} LF in ${lastWhen}${f.houses.length > 1 ? `, through ${f.houses.length} houses` : ""}.`;
}

// ── The module ──────────────────────────────────────────────────────────────

function DealerModule({
  dealerKey,
  rows,
  lineLabel,
  onClose,
}: {
  dealerKey: string;
  rows: readonly SellThroughRow[];
  lineLabel?: string;
  onClose: () => void;
}) {
  const { profile } = useOffline();
  const isAdmin = profile?.role === "admin";
  const facts = useMemo(() => dealerFacts(new Set([dealerKey]), rows), [dealerKey, rows]);

  const [rel, setRel] = useState<Relationship | null>(null);
  const [relFailed, setRelFailed] = useState(false);
  useEffect(() => {
    if (!facts?.accountId) return;
    let stale = false;
    loadRelationship(facts.accountId)
      .then((r) => !stale && setRel(r))
      .catch(() => !stale && setRelFailed(true));
    return () => {
      stale = true;
    };
  }, [facts?.accountId]);

  // Who an e-mail goes to: the region's rep, or — where the region has none —
  // the admins, never the distributor (Andre, 2026-09-21).
  const [people, setPeople] = useState<{ reps: string[]; admins: string[] }>({ reps: [], admins: [] });
  useEffect(() => {
    if (!facts) return;
    let stale = false;
    const supabase = getSupabaseBrowserClient();
    void (async () => {
      const emails = (data: unknown) =>
        ((data as { users: { email: string | null } | null }[] | null) ?? [])
          .map((m) => m.users?.email)
          .filter((e): e is string => !!e);
      const [reps, admins] = await Promise.all([
        facts.repIds.length > 0
          ? supabase.from("memberships").select("users(email)").in("id", facts.repIds)
          : Promise.resolve({ data: [] }),
        supabase.from("memberships").select("users(email)").eq("role", "admin").eq("status", "active"),
      ]);
      if (!stale) setPeople({ reps: emails(reps.data), admins: emails(admins.data) });
    })();
    return () => {
      stale = true;
    };
  }, [facts]);

  // The insights: asked once per dealer and per newest file, kept for the
  // session so opening the same name twice does not ask twice.
  const cacheKey = facts
    ? `dealer-insights:${dealerKey}:${lineLabel ?? "all"}:${facts.filesOnHand.at(-1) ?? ""}`
    : null;
  const [insights, setInsights] = useState<
    { state: "loading" } | { state: "ready"; data: DealerInsights } | { state: "failed"; message: string }
  >(() => {
    try {
      const hit = cacheKey ? sessionStorage.getItem(cacheKey) : null;
      if (hit) return { state: "ready", data: JSON.parse(hit) as DealerInsights };
    } catch {
      // storage unavailable — just ask
    }
    return { state: "loading" };
  });
  const [askedOnce] = useState(() => insights.state === "ready");
  const relReady = !facts?.accountId || rel !== null || relFailed;
  useEffect(() => {
    if (!facts || !cacheKey || !relReady || askedOnce) return;
    let stale = false;
    const body = {
      productLineShown: lineLabel ?? "every line",
      dealer: {
        name: facts.name,
        labelsInFiles: facts.labels,
        hasAccount: facts.accountId !== null,
        regions: facts.regions,
        repsForTheRegion: facts.reps,
        houses: facts.houses,
      },
      // Whole feet, as the page shows them — the files carry fractions the
      // reader never sees, and the reading must quote the same figures.
      filesOnHand: facts.filesOnHand,
      periods: facts.periods.map((p) => ({
        ...p,
        lf: Math.round(p.lf),
        ly: Math.round(p.ly),
        byHouse: p.byHouse.map((h) => ({ ...h, lf: Math.round(h.lf) })),
      })),
      firstSeen: facts.firstSeen,
      lastBought: facts.lastBought,
      silentInNewestMonthFile: facts.silentIn,
      yearSoFarLf: Math.round(facts.yearSoFar),
      yearFileLastYearLf: Math.round(facts.yearFileLy),
      latestPurchaseSplit: facts.latestSplit.map((x) => ({
        ...x,
        lf: Math.round(x.lf),
        share: Math.round(x.share),
      })),
      products: facts.products.slice(0, 12).map((x) => ({
        ...x,
        lf: Math.round(x.lf),
        share: Math.round(x.share),
      })),
      relationship: rel ?? (facts.accountId ? "could not be read" : "no account, so nothing recorded"),
    };
    void fetch("/api/dealer-insights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        const json = await res.json();
        if (stale) return;
        if (!res.ok) {
          setInsights({ state: "failed", message: json.error ?? "Could not read this dealer." });
          return;
        }
        setInsights({ state: "ready", data: json as DealerInsights });
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(json));
        } catch {
          // fine — it is only a convenience
        }
      })
      .catch(() => !stale && setInsights({ state: "failed", message: "No connection for the reading." }));
    return () => {
      stale = true;
    };
  }, [facts, cacheKey, relReady, rel, askedOnce, lineLabel]);

  // Escape closes, like every sheet in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Creating the account from here: the short form, then the file's labels
  // tied to it so this month's file and every one after links by itself.
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: string; linked: boolean; note: string } | null>(null);
  const onCreated = useCallback(
    async (account: { id: string }) => {
      if (!facts || !profile) return;
      setCreating(false);
      const layer = getOfflineLayer();
      await layer.sync.drain();
      if (!isAdmin) {
        setCreated({
          id: account.id,
          linked: false,
          note: "Account created. An admin still has to tie the file's name to it.",
        });
        return;
      }
      const { error } = await getSupabaseBrowserClient()
        .from("dealer_aliases")
        .insert(
          facts.labels.map((label) => ({
            org_id: profile.orgId,
            label,
            dealer_id: account.id,
            created_by: profile.membershipId,
            note: "Linked from the dealer module when the account was created",
          })),
        );
      setCreated({
        id: account.id,
        linked: !error,
        note: error
          ? `Account created, but the file's name could not be tied to it yet (${error.message}). It will retry when the account has synced — open this again later.`
          : "Account created and the file's name tied to it — this file and every one after now land on it.",
      });
    },
    [facts, profile, isAdmin],
  );

  if (!facts) {
    return (
      <div className="dmod" role="dialog" aria-modal="true" aria-label="Dealer">
        <button type="button" className="dmod-backdrop" aria-label="Close" onClick={onClose} />
        <div className="dmod-panel card-pad">
          <p className="t-sub">Nothing on file for this dealer.</p>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const accountId = created?.id ?? facts.accountId;
  const yearFile = facts.periods.find((p) => p.kind === "YTD") ?? null;
  const ytdCut = facts.filesOnHand.find((p) => rows.some((r) => r.period === p && r.period_kind === "YTD")) ?? null;
  const monthFiles = facts.filesOnHand.filter((p) => !rows.some((r) => r.period === p && r.period_kind === "YTD"));
  const last = facts.lastBought ? facts.periods.find((p) => p.period === facts.lastBought) ?? null : null;
  const noRep = facts.reps.length === 0;

  // The columns: the year file as a monthly average (it cannot be split), then
  // every month file on hand — a zero where the dealer bought nothing.
  const cutMonths = ytdCut ? Number(ytdCut.slice(5, 7)) : 0;
  const cols = [
    ...(ytdCut
      ? [
          {
            key: ytdCut,
            label: `Jan–${periodShort(ytdCut)} avg`,
            lf: yearFile ? yearFile.lf / Math.max(cutMonths, 1) : 0,
            byHouse: yearFile ? yearFile.byHouse.map((h) => ({ ...h, lf: h.lf / Math.max(cutMonths, 1) })) : [],
            absent: !yearFile,
          },
        ]
      : []),
    ...monthFiles.map((m) => {
      const p = facts.periods.find((x) => x.period === m && x.kind === "MONTH");
      return {
        key: m,
        label: periodShort(m),
        lf: p?.lf ?? 0,
        byHouse: p?.byHouse ?? [],
        absent: false,
      };
    }),
  ];
  const maxCol = Math.max(...cols.map((c) => c.lf), 1);

  // The summary an e-mail carries — facts and readings, nothing else.
  const summary = [
    `${facts.name} (${facts.labels.join(" / ")})`,
    [facts.regions.join(", "), facts.houses.join(", ")].filter(Boolean).join(" · "),
    "",
    overviewSentence(facts),
    `Year so far: ${QTY.format(facts.yearSoFar)} LF, every file on hand.`,
    ...(insights.state === "ready"
      ? ["", ...insights.data.insights.map((i) => `• ${i.title} — ${i.body}`)]
      : []),
  ].join("\n");
  const mailto = (to: string[], subject: string) =>
    `mailto:${to.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(summary)}`;

  const suggested = insights.state === "ready" ? insights.data.action : null;
  const primaryKind =
    !accountId ? "create_account" : suggested && suggested.kind !== "none" ? suggested.kind : noRep ? "alert_admins" : "email_rep";

  const actionButton = (kind: string, primary: boolean) => {
    const cls = primary ? "btn-primary dmod-cta" : "btn-secondary dmod-act";
    switch (kind) {
      case "create_account":
        return accountId ? null : (
          <button key={kind} type="button" className={cls} onClick={() => setCreating(true)}>
            Create the account
          </button>
        );
      case "email_rep":
        return people.reps.length === 0 ? null : (
          <a key={kind} className={cls} href={mailto(people.reps, `${facts.name} — needs your attention`)}>
            {primary && suggested?.kind === "email_rep" ? suggested.label : `E-mail ${facts.reps[0] ?? "the rep"}`}
          </a>
        );
      case "alert_admins":
        return people.admins.length === 0 ? null : (
          <a key={kind} className={cls} href={mailto(people.admins, `${facts.name} — no rep for this region`)}>
            Alert the admins
          </a>
        );
      case "plan_visit":
        return accountId ? (
          <Link key={kind} className={cls} href={`/visits?plan=${accountId}`}>
            Plan a visit / PK
          </Link>
        ) : null;
      case "add_contact":
        return accountId ? (
          <Link key={kind} className={cls} href={`/accounts/${accountId}`}>
            Add a contact
          </Link>
        ) : null;
      default:
        return null;
    }
  };
  const secondary = ["create_account", "email_rep", "alert_admins", "plan_visit", "add_contact"]
    .filter((k) => k !== primaryKind)
    .filter((k) => !(k === "email_rep" && noRep))
    .filter((k) => !(k === "alert_admins" && !noRep))
    .map((k) => actionButton(k, false))
    .filter(Boolean)
    .slice(0, 2);

  return (
    <div className="dmod" role="dialog" aria-modal="true" aria-label={facts.name}>
      <button type="button" className="dmod-backdrop" aria-label="Close" onClick={onClose} />
      <div className="dmod-panel">
        <header className="dmod-head">
          <div className="dmod-head-top">
            <button type="button" className="dmod-back" onClick={onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back
            </button>
            {accountId && (
              <Link href={`/accounts/${accountId}`} className="dmod-link">
                Open account page
              </Link>
            )}
          </div>
          <h2 className="dmod-name">{facts.name}</h2>
          <p className="dmod-sub">
            {facts.accountId
              ? [
                  rel?.yards.length ? `Banner · ${rel.yards.length} yards` : null,
                  facts.reps.length ? `rep ${facts.reps.join(", ")}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Dealer"
              : `“${facts.labels[0]}”, as ${facts.houses[0] ?? "the file"} writes it`}
          </p>
          <div className="dmod-tags">
            <WhereTags houses={facts.houses} />
            {/* every figure below is this line's, so the header says which */}
            {lineLabel && <span className="dmod-tag dmod-tag-line">{lineLabel} only</span>}
            {rel?.strategic && <span className="dmod-tag dmod-tag-ink">Strategic</span>}
            {!accountId && <span className="dmod-tag dmod-tag-warn">No account yet</span>}
            {noRep && <span className="dmod-tag dmod-tag-warn">No rep for this region</span>}
          </div>
        </header>

        <div className="dmod-body">
          {/* ── 1 · OVERVIEW — facts only ─────────────────────────── */}
          <div className="dmod-col">
            <p className="dmod-eyebrow">1 · Overview</p>
            <p className="dmod-lede">{overviewSentence(facts)}</p>

            <div className="dmod-tiles">
              <div className="dmod-tile">
                <span className="dmod-tile-k">Last bought</span>
                <span className="dmod-tile-v">
                  {last ? (last.kind === "YTD" ? `Jan–${periodShort(last.period)}` : periodShort(last.period)) : "—"}
                </span>
                <span className={`dmod-tile-s${facts.silentIn ? " is-bad" : ""}`}>
                  {facts.silentIn ? `silent in ${periodShort(facts.silentIn)}` : "in the newest file"}
                </span>
              </div>
              <div className="dmod-tile">
                <span className="dmod-tile-k">Year so far</span>
                <span className="dmod-tile-v">{QTY.format(facts.yearSoFar)} LF</span>
                <span className="dmod-tile-s">every file on hand</span>
              </div>
              <div className="dmod-tile">
                <span className="dmod-tile-k">Last year</span>
                <span className="dmod-tile-v">
                  {facts.yearFileLy > 0 ? `${QTY.format(facts.yearFileLy)} LF` : "—"}
                </span>
                <span className={`dmod-tile-s${yearFile && facts.yearFileLy > 0 && yearFile.lf >= facts.yearFileLy ? " is-good" : ""}`}>
                  {facts.yearFileLy > 0 && yearFile
                    ? `Jan–${periodShort(yearFile.period)}, ${yearFile.lf >= facts.yearFileLy ? "+" : ""}${Math.round(
                        (100 * (yearFile.lf - facts.yearFileLy)) / facts.yearFileLy,
                      )}% now`
                    : "not on file"}
                </span>
              </div>
            </div>

            <section className="dmod-card">
              <div className="dmod-card-head">
                <span className="dmod-card-title">Month by month</span>
                <span className="t-hint">LF</span>
              </div>
              <div className="dmod-cols" aria-label="Linear feet by file">
                {cols.map((c) => (
                  <div key={c.key} className="dmod-colbar">
                    <span className={`dmod-colbar-n${c.lf === 0 && !c.absent ? " is-bad" : ""}`}>
                      {c.absent ? "not in file" : QTY.format(Math.round(c.lf))}
                    </span>
                    <span className="dmod-colbar-stack" style={{ height: `${Math.max((110 * c.lf) / maxCol, 2)}px` }}>
                      {c.byHouse.length === 0 ? (
                        <i style={{ flexGrow: 1, background: c.absent ? "var(--surface-sunken)" : "var(--danger)" }} />
                      ) : (
                        c.byHouse.map((h) => (
                          <i key={h.house} style={{ flexGrow: h.lf, background: distributorColour(h.house) }} />
                        ))
                      )}
                    </span>
                    <span className="dmod-colbar-label">{c.label}</span>
                  </div>
                ))}
              </div>
              {ytdCut && (
                <p className="t-hint">
                  The year file is one total for Jan–{periodShort(ytdCut)}, so those months cannot be told apart.
                </p>
              )}
            </section>

            {facts.products.length > 0 && (
              <section className="dmod-card">
                <span className="dmod-card-title">What they bought</span>
                {facts.products.slice(0, 5).map((p) => (
                  <div key={p.family} className="dmod-prod">
                    <div className="dmod-prod-line">
                      <span className="dmod-prod-name">{p.family}</span>
                      <span className="fig-sm">{QTY.format(p.lf)} LF</span>
                    </div>
                    <span className="sales-market-track" aria-hidden="true">
                      <span className="sales-market-fill" style={{ width: `${Math.max(p.share, 1)}%`, background: "var(--accent)" }} />
                    </span>
                    <span className="t-hint">
                      {Math.round(p.share)}%{p.lengths.length > 1 ? ` · ${p.lengths.length} lengths: ${p.lengths.join(" · ")}` : ""}
                    </span>
                  </div>
                ))}
                {facts.products.length > 5 && (
                  <span className="t-hint">and {facts.products.length - 5} more products</span>
                )}
              </section>
            )}

            {facts.latestSplit.length > 0 && last && (
              <section className="dmod-card">
                <span className="dmod-card-title">
                  Through whom, in {last.kind === "YTD" ? `Jan–${periodShort(last.period)}` : periodLabel(last.period)}
                </span>
                {facts.latestSplit.length > 1 && (
                  <span className="dmod-split" aria-hidden="true">
                    {facts.latestSplit.map((s) => (
                      <i key={`${s.house}-${s.branch}`} style={{ flexGrow: s.lf, background: distributorColour(s.house) }} />
                    ))}
                  </span>
                )}
                {facts.latestSplit.map((s) => (
                  <div key={`${s.house}-${s.branch}`} className="dmod-prod-line">
                    <span>
                      <b>{s.house}</b> · {s.branch}
                    </span>
                    <span className="fig-sm">
                      {QTY.format(s.lf)} LF · {Math.round(s.share)}%
                    </span>
                  </div>
                ))}
              </section>
            )}

            {rel?.rollout && (
              <section className="dmod-card">
                <div className="dmod-card-head">
                  <span className="dmod-card-title">Rollout across the {rel.rollout.total} yards</span>
                  <span className="t-hint">from the tracker</span>
                </div>
                <div className="dmod-gates">
                  {[
                    { k: "PK class", n: rel.rollout.pk },
                    { k: "Merchandiser", n: rel.rollout.merch },
                    { k: "Material in stock", n: rel.rollout.stocked },
                  ].map((g) => (
                    <div key={g.k} className="dmod-gate">
                      <span className="t-hint">{g.k}</span>
                      <span className={`dmod-gate-n${g.n < rel.rollout!.total / 2 ? " is-bad" : ""}`}>
                        {g.n} / {rel.rollout!.total}
                      </span>
                      <span className="sales-market-track" aria-hidden="true">
                        <span
                          className="sales-market-fill"
                          style={{
                            width: `${(100 * g.n) / rel.rollout!.total}%`,
                            background: g.n < rel.rollout!.total / 2 ? "var(--danger)" : "var(--accent)",
                          }}
                        />
                      </span>
                    </div>
                  ))}
                </div>
                {(rel.rollout.notStocked.length > 0 || rel.rollout.pending.length > 0) && (
                  <span className="t-hint">
                    {rel.rollout.notStocked.length > 0 && `Not stocked: ${rel.rollout.notStocked.join(", ")}`}
                    {rel.rollout.pending.length > 0 && ` · ${rel.rollout.pending.join(", ")} pending`}
                  </span>
                )}
              </section>
            )}
          </div>

          <div className="dmod-col">
            <section className="dmod-card">
              <span className="dmod-card-title">Our side of the relationship</span>
              <div className="dmod-rel">
                <div className="dmod-rel-cell">
                  <span className="t-hint">Rep</span>
                  <span className={noRep ? "is-warn" : undefined}>
                    {noRep ? `Nobody — ${facts.regions[0] ?? "this region"} has no Market Owner` : facts.reps.join(", ")}
                  </span>
                </div>
                <div className="dmod-rel-cell">
                  <span className="t-hint">Contacts</span>
                  <span className={rel && rel.contacts.count === 0 ? "is-warn" : undefined}>
                    {!accountId
                      ? "None recorded"
                      : rel
                        ? rel.contacts.count === 0
                          ? "None recorded"
                          : `${rel.contacts.count} · ${rel.contacts.names.join(", ")}`
                        : relFailed
                          ? "Could not be read"
                          : "…"}
                  </span>
                </div>
                <div className="dmod-rel-cell">
                  <span className="t-hint">Visits &amp; PK</span>
                  <span className={rel && rel.visits.count === 0 ? "is-warn" : undefined}>
                    {!accountId
                      ? "None recorded"
                      : rel
                        ? rel.visits.count === 0
                          ? "None recorded"
                          : `${rel.visits.count} · last ${new Date(rel.visits.last!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                        : "…"}
                  </span>
                </div>
                <div className="dmod-rel-cell">
                  <span className="t-hint">Quotes</span>
                  <span>{!accountId ? "None recorded" : rel ? (rel.quotes === 0 ? "None open" : `${rel.quotes}`) : "…"}</span>
                </div>
              </div>
              {rel && rel.notes.count > 0 && rel.notes.lastBody && (
                <p className="dmod-note">
                  <span className="t-hint">Latest note · </span>
                  {rel.notes.lastBody}
                </p>
              )}
            </section>

            {/* ── 2 · INSIGHTS — drafted from the facts ─────────────── */}
            <div className="dmod-eyebrow-row">
              <p className="dmod-eyebrow">2 · Insights</p>
              <span className="t-hint">drafted by AI from the facts</span>
            </div>
            {insights.state === "loading" && (
              <section className="dmod-card dmod-insight" aria-busy="true">
                <span className="t-hint">Reading this dealer’s files…</span>
              </section>
            )}
            {insights.state === "failed" && (
              <section className="dmod-card dmod-insight">
                <span className="t-hint">{insights.message} The facts on this page stand on their own.</span>
              </section>
            )}
            {insights.state === "ready" &&
              insights.data.insights.map((i) => (
                <section key={i.title} className="dmod-card dmod-insight">
                  <span className="dmod-insight-title">{i.title}</span>
                  <span className="dmod-insight-body">{i.body}</span>
                  <span className="t-hint">From: {i.from}</span>
                </section>
              ))}

            {/* ── 3 · NEXT ACTION ───────────────────────────────────── */}
            <p className="dmod-eyebrow">3 · Next action</p>
            {creating ? (
              <NewCompanyInline
                initialName={facts.name}
                submitLabel="Create and link it"
                onCancel={() => setCreating(false)}
                onCreated={(a) => void onCreated(a)}
              />
            ) : (
              <section className="dmod-card dmod-actions">
                {created && <p className="t-sub">{created.note}</p>}
                {suggested && <p className="t-sub">{suggested.why}</p>}
                {actionButton(primaryKind, true)}
                {primaryKind === "create_account" && (
                  <span className="t-hint dmod-cta-note">
                    Ties “{facts.labels[0]}” to it — this file and every one after
                  </span>
                )}
                {secondary.length > 0 && <div className="dmod-act-row">{secondary}</div>}
                {noRep && (
                  <span className="t-hint">
                    No rep here, so an alert goes to the admins only — never to the distributor.
                  </span>
                )}
                <span className="t-hint">E-mails open in your mail app, already written, for you to read before sending.</span>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
