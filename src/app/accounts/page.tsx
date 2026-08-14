"use client";

// The territory. The account is the object a rep thinks in, so it gets a tab —
// browsable, not only findable. The cached working set renders instantly and
// works with no signal (D56); with signal the full territory loads behind it
// and search reaches accounts beyond the cache.
//
// The same list serves a manager. `?owner=<membership_id>` scopes it to one
// rep, which is how the dashboard scorecard goes from a count to the doors it
// is counting. RLS already decides what is visible either way, so there is no
// second list and no second set of rules.
//
// `?type=DEALER` scopes it to one kind of door, which is how Home's Dealer
// tile reaches "update an existing one". A dealer is not a separate object
// from an account — it is an account_type — so it does not get a separate
// screen either.
//
// Attention comes from the `exceptions` view rather than being recomputed here:
// the rules for quiet, no captain and an unverified wall are defined once in
// SQL and tested there. This screen only decides how to show them.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { ChevronRightIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { ACCOUNT_TYPES, humanize, type AccountType } from "@/lib/domain/enums";
import { groupByCompany } from "@/lib/domain/companies";
import {
  ACCOUNT_EXCEPTION_TYPES,
  exceptionShort,
} from "@/lib/domain/exceptions";
import { displayAccountName } from "@/lib/format";
import { getOfflineLayer, type CachedAccount } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface AccountFlag {
  type: string;
  detail: string | null;
  since: string | null;
}

// Only the account-shaped exceptions belong on an account list; the rest of the
// union is about opportunities, quotes and agendas.
const ACCOUNT_FLAGS: ReadonlySet<string> = new Set(ACCOUNT_EXCEPTION_TYPES);

const FILTERS = [
  { key: "all", label: "All", type: null },
  { key: "quiet", label: exceptionShort("STRATEGIC_ACCOUNT_QUIET"), type: "STRATEGIC_ACCOUNT_QUIET" },
  { key: "captain", label: exceptionShort("NO_CHAMPION"), type: "NO_CHAMPION" },
  { key: "wall", label: exceptionShort("DISPLAY_NOT_VERIFIED"), type: "DISPLAY_NOT_VERIFIED" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

// owner_id rides along so the company lens can say who works a banner. It is
// not part of CachedAccount because the device cache is one rep's own working
// set, where the answer is always "me".
const COLUMNS =
  "id, name, account_type, city, territory_id, has_display_wall, display_last_verified_at, parent_account_id, updated_at, owner_id";

type AccountRow = CachedAccount & { owner_id?: string | null };

export default function AccountsPage() {
  // useSearchParams needs a boundary; the list is the fallback-free part.
  return (
    <Suspense fallback={<div className="stack pt-2" aria-busy="true" />}>
      <AccountsView />
    </Suspense>
  );
}

function AccountsView() {
  const { profile, status } = useOffline();
  const params = useSearchParams();
  const owner = params.get("owner");
  // Guarded against the enum, so a hand-typed ?type= can only ever narrow the
  // list to something that exists rather than emptying it silently.
  const typeParam = params.get("type");
  const accountType = (ACCOUNT_TYPES as readonly string[]).includes(
    typeParam ?? "",
  )
    ? (typeParam as AccountType)
    : null;

  const [cached, setCached] = useState<CachedAccount[]>([]);
  const [territory, setTerritory] = useState<{
    fresh: boolean;
    rows: CachedAccount[];
  }>({ fresh: false, rows: [] });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [lens, setLens] = useState<"account" | "company">("account");
  const [flags, setFlags] = useState<Map<string, AccountFlag[]>>(new Map());
  const [ownerName, setOwnerName] = useState<{ id: string; name: string } | null>(
    null,
  );
  // Server search results are stored WITH their term — otherwise a failed
  // lookup leaves the previous term's rows on screen under the wrong query.
  const [remote, setRemote] = useState<{ term: string; rows: CachedAccount[] }>(
    { term: "", rows: [] },
  );

  useEffect(() => {
    if (!profile) return;
    void getOfflineLayer().local.getAccounts().then(setCached);
  }, [profile, status.lastPulledAt]);

  // The full territory (RLS already scopes it to what this person may see).
  useEffect(() => {
    if (!profile) return;
    let stale = false;
    void (async () => {
      try {
        let q = getSupabaseBrowserClient()
          .from("accounts")
          .select(COLUMNS)
          .order("name")
          .limit(200);
        if (owner) q = q.eq("owner_id", owner);
        if (accountType) q = q.eq("account_type", accountType);
        const { data, error } = await q;
        if (!stale && !error && data) {
          setTerritory({ fresh: true, rows: data as CachedAccount[] });
        }
      } catch {
        // no signal — the cached working set below is the view
      }
    })();
    return () => {
      stale = true;
    };
  }, [profile, status.lastPulledAt, owner, accountType]);

  // What needs a visit. One query, one place the rules live.
  useEffect(() => {
    if (!profile) return;
    let stale = false;
    void (async () => {
      try {
        let q = getSupabaseBrowserClient()
          .from("exceptions")
          .select("exception_type, subject_id, owner_membership_id, detail, since")
          .eq("subject_type", "account")
          .limit(500);
        if (owner) q = q.eq("owner_membership_id", owner);
        const { data, error } = await q;
        if (stale || error || !data) return;
        const next = new Map<string, AccountFlag[]>();
        for (const row of data) {
          if (!row.subject_id || !row.exception_type) continue;
          if (!ACCOUNT_FLAGS.has(row.exception_type)) continue;
          const list = next.get(row.subject_id) ?? [];
          list.push({
            type: row.exception_type,
            detail: row.detail,
            since: row.since,
          });
          next.set(row.subject_id, list);
        }
        setFlags(next);
      } catch {
        // offline — the list still browses, just without the flags
      }
    })();
    return () => {
      stale = true;
    };
  }, [profile, status.lastPulledAt, owner]);

  // Whose list this is, when a manager arrived from the scorecard. The id is
  // stored beside the name so a name from a previous owner can never caption
  // this one's list.
  useEffect(() => {
    if (!profile || !owner) return;
    let stale = false;
    void (async () => {
      try {
        const { data } = await getSupabaseBrowserClient()
          .from("dashboard_rep_scorecard")
          .select("rep_name")
          .eq("membership_id", owner)
          .maybeSingle();
        if (!stale && data?.rep_name) {
          setOwnerName({ id: owner, name: data.rep_name });
        }
      } catch {
        // the heading falls back to a neutral label
      }
    })();
    return () => {
      stale = true;
    };
  }, [profile, owner]);

  const lookupRemote = useCallback(
    async (raw: string) => {
      const term = raw.trim();
      if (term.length < 2) {
        setRemote({ term: "", rows: [] });
        return;
      }
      try {
        let q = getSupabaseBrowserClient()
          .from("accounts")
          .select(COLUMNS)
          .ilike("name", `%${term}%`)
          .limit(20);
        if (owner) q = q.eq("owner_id", owner);
        if (accountType) q = q.eq("account_type", accountType);
        const { data, error } = await q;
        setRemote({
          term,
          rows: error ? [] : ((data as CachedAccount[]) ?? []),
        });
      } catch {
        setRemote({ term, rows: [] });
      }
    },
    [owner, accountType],
  );

  useEffect(() => {
    const timer = setTimeout(() => void lookupRemote(query), 250);
    return () => clearTimeout(timer);
  }, [query, lookupRemote]);

  // Scoping to one rep is an online act — the device cache is this rep's own
  // working set, so falling back to it would quietly show the wrong person's.
  const offlineOnly = !territory.fresh && !owner;

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const list of flags.values()) {
      for (const f of list) c[f.type] = (c[f.type] ?? 0) + 1;
    }
    return c;
  }, [flags]);

  const rows = useMemo(() => {
    let base = territory.fresh ? territory.rows : owner ? [] : cached;
    // The cached working set carries account_type, so the scope survives with
    // no signal — a rep looking for a dealer in a yard gets dealers.
    if (accountType) base = base.filter((a) => a.account_type === accountType);
    const q = query.trim().toLowerCase();

    let list = base;
    if (q) {
      const local = base.filter((a) =>
        `${a.name} ${a.city ?? ""}`.toLowerCase().includes(q),
      );
      const seen = new Set(local.map((a) => a.id));
      const extra =
        remote.term === query.trim()
          ? remote.rows.filter((a) => !seen.has(a.id))
          : [];
      list = [...local, ...extra];
    }

    const wanted = FILTERS.find((f) => f.key === filter)?.type ?? null;
    if (wanted) {
      list = list.filter((a) =>
        (flags.get(a.id) ?? []).some((f) => f.type === wanted),
      );
    }

    // Flagged first, longest-standing at the top — the same order the account
    // list took in the demo, because it answers "who has been left alone".
    const oldest = (a: CachedAccount) => {
      const fs = flags.get(a.id);
      if (!fs || fs.length === 0) return null;
      const times = fs
        .map((f) => (f.since ? Date.parse(f.since) : NaN))
        .filter((n) => !Number.isNaN(n));
      return times.length ? Math.min(...times) : 0;
    };

    return [...list].sort((a, b) => {
      const oa = oldest(a);
      const ob = oldest(b);
      if (oa !== null && ob === null) return -1;
      if (oa === null && ob !== null) return 1;
      if (oa !== null && ob !== null && oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
  }, [territory, cached, query, remote, filter, flags, owner, accountType]);

  const flaggedTotal = useMemo(
    () => rows.filter((a) => (flags.get(a.id) ?? []).length > 0).length,
    [rows, flags],
  );

  // A company is not a rep's property: a banner has branches in more than one
  // patch, and rep-centric lists cannot see that. Grouping by the parent
  // account is what makes "nobody actually holds this one" visible.
  const companies = useMemo(() => {
    if (lens !== "company") return [];
    return groupByCompany(rows as AccountRow[], displayAccountName).map((g) => ({
      ...g,
      flagged: g.branches.filter((b) => (flags.get(b.id) ?? []).length > 0)
        .length,
    }));
  }, [rows, lens, flags]);

  const sharedCount = useMemo(
    () => companies.filter((c) => c.shared).length,
    [companies],
  );

  return (
    <div className="stack pt-2">
      {(owner || accountType) && (
        <div className="flex items-center justify-between gap-2">
          <p className="t-meta">
            {accountType
              ? `${humanize(accountType)}s`
              : ownerName?.id === owner
                ? `${ownerName.name}’s accounts`
                : "One rep’s accounts"}
          </p>
          <Link href="/accounts" className="t-meta underline underline-offset-2">
            Show all
          </Link>
        </div>
      )}

      <div className="flex gap-2">
        <label className="search-field flex-1">
          <SearchIcon size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an account…"
            type="search"
            enterKeyHint="search"
            aria-label="Find an account"
          />
        </label>
        <Link
          href="/accounts/new"
          className="btn-secondary shrink-0"
          aria-label="Add account"
        >
          <PlusIcon size={18} style={{ color: "var(--ink-secondary)" }} />
        </Link>
      </div>

      {offlineOnly && (
        <p className="tag tag-accent">
          No signal — showing accounts saved on this device
        </p>
      )}

      {/* Two ways to read the same territory. "By company" answers the question
          a rep-shaped list cannot: which banners are worked by more than one
          person with nobody holding the relationship itself. */}
      <div className="chip-row" role="group" aria-label="Group accounts by">
        {(["account", "company"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className="chip"
            aria-pressed={lens === k}
            onClick={() => setLens(k)}
          >
            {k === "account" ? "By account" : "By company"}
          </button>
        ))}
      </div>

      {/* Filters only appear once there is something to filter to. */}
      {flags.size > 0 && (
        <div className="chip-row" role="group" aria-label="Filter accounts">
          {FILTERS.map((f) => {
            const n = f.type ? (counts[f.type] ?? 0) : rows.length;
            if (f.type && n === 0) return null;
            return (
              <button
                key={f.key}
                type="button"
                className="chip"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <span className="chip-count">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {lens === "company" ? (
        <section>
          <div className="section-head">
            <h2 className="t-section">By company</h2>
            <span className="t-meta">{companies.length}</span>
          </div>
          {sharedCount > 0 && (
            <p className="t-sub px-1">
              {sharedCount} worked by more than one rep — that is where a
              relationship falls between people.
            </p>
          )}
          {companies.length === 0 ? (
            <p className="t-sub px-1">Nothing to group yet.</p>
          ) : (
            <ul className="stack-sm">
              {companies.map((c) => (
                <li key={c.id ?? c.name}>
                  <div className="flex items-baseline justify-between gap-3 pt-2">
                    {c.id ? (
                      <Link href={`/accounts/${c.id}`} className="t-title">
                        {c.name}
                      </Link>
                    ) : (
                      <span className="t-title">{c.name}</span>
                    )}
                    <span className="t-meta tabular-nums">
                      {c.branches.length}
                      {c.branches.length === 1 ? " location" : " locations"}
                      {c.shared ? ` · ${c.owners.length} reps` : ""}
                    </span>
                  </div>
                  {(c.shared || c.flagged > 0) && (
                    <p className="t-sub px-1">
                      {c.shared ? "No single owner" : ""}
                      {c.shared && c.flagged > 0 ? " · " : ""}
                      {c.flagged > 0
                        ? `${c.flagged} ${c.flagged === 1 ? "needs" : "need"} a visit`
                        : ""}
                    </p>
                  )}
                  <ul className="list">
                    {c.branches.map((b) => {
                      const fs = flags.get(b.id) ?? [];
                      return (
                        <li key={b.id}>
                          <Link href={`/accounts/${b.id}`} className="row">
                            <span className="row-body">
                              <span className="t-title block truncate">
                                {displayAccountName(b.name)}
                              </span>
                              <span className="t-sub block truncate">
                                {fs.length > 0
                                  ? fs.map((f) => exceptionShort(f.type)).join(" · ")
                                  : `${humanize(b.account_type)}${b.city ? ` · ${b.city}` : ""}`}
                              </span>
                            </span>
                            <ChevronRightIcon
                              size={14}
                              style={{ color: "var(--ink-muted)" }}
                            />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section>
        <div className="section-head">
          <h2 className="t-section">
            {query.trim()
              ? "Matches"
              : filter === "all"
                ? "Your accounts"
                : (FILTERS.find((f) => f.key === filter)?.label ?? "Accounts")}
          </h2>
          <span className="t-meta">{rows.length}</span>
        </div>

        {rows.length > 0 && filter === "all" && flaggedTotal > 0 && (
          <p className="t-sub px-1">
            {flaggedTotal === 1
              ? "1 needs a visit — it is at the top."
              : `${flaggedTotal} need a visit — they are at the top.`}
          </p>
        )}

        {rows.length === 0 ? (
          <p className="t-sub px-1">
            {query.trim()
              ? `Nothing matches “${query.trim()}”.`
              : filter !== "all"
                ? "Nothing in this list — which is the good outcome."
                : owner
                  ? "No accounts against this rep yet."
                  : "No accounts yet. They appear here as soon as your territory syncs."}
          </p>
        ) : (
          <ul className="list">
            {rows.map((a) => {
              const fs = flags.get(a.id) ?? [];
              return (
                <li key={a.id}>
                  <Link href={`/accounts/${a.id}`} className="row">
                    {/* initials differentiate rows the way one repeated glyph
                        can't — the lead slot has to earn its 56px */}
                    <span className="row-lead">
                      {displayAccountName(a.name)
                        .split(" ")
                        .slice(0, 2)
                        .map((w) => w[0])
                        .join("")
                        .toUpperCase()}
                    </span>
                    <span className="row-body">
                      <span className="t-title block truncate">
                        {displayAccountName(a.name)}
                      </span>
                      <span className="t-sub block truncate">
                        {fs.length > 0
                          ? fs
                              .map((f) => exceptionShort(f.type))
                              .join(" · ")
                          : `${humanize(a.account_type)}${a.city ? ` · ${a.city}` : ""}${
                              a.has_display_wall ? " · display wall" : ""
                            }`}
                      </span>
                    </span>
                    <ChevronRightIcon
                      size={14}
                      style={{ color: "var(--ink-muted)" }}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        </section>
      )}
    </div>
  );
}
