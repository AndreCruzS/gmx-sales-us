"use client";

// Search across the rep's own world.
//
// It reads the OFFLINE working set first (D56) — accounts on the agenda, their
// context, the rep's recent activity — so a rep standing at a dealer counter
// with no signal can still pull up the account in front of them. That is the
// whole reason the working set exists. When there is signal it also queries the
// server for accounts beyond the cached set, and merges without duplicates.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import {
  BuildingIcon,
  CalendarIcon,
  ChevronRightIcon,
  SearchIcon,
} from "@/components/icons";
import { humanize } from "@/lib/domain/enums";
import {
  getOfflineLayer,
  type CachedAccount,
  type CachedActivity,
  type CachedAgendaItem,
} from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Cache {
  accounts: CachedAccount[];
  agenda: CachedAgendaItem[];
  activities: CachedActivity[];
}

export default function SearchPage() {
  const { profile } = useOffline();
  const [query, setQuery] = useState("");
  const [cache, setCache] = useState<Cache>({
    accounts: [],
    agenda: [],
    activities: [],
  });
  // Server results are stored WITH the term they belong to. Without that, a
  // failed lookup (offline) leaves the previous query's rows on screen, and
  // they get shown — mislabelled "online" — under a term they don't match.
  const [remote, setRemote] = useState<{ term: string; rows: CachedAccount[] }>({
    term: "",
    rows: [],
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => {
      const layer = getOfflineLayer();
      void Promise.all([
        layer.local.getAccounts(),
        layer.local.getAgenda(),
        layer.local.getRecentActivities(),
      ]).then(([accounts, agenda, activities]) =>
        setCache({ accounts, agenda, activities }),
      );
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [profile]);

  // Server lookup for accounts outside the cached working set. Debounced, and
  // entirely optional — the offline results above are already on screen.
  const lookupRemote = useCallback(async (raw: string) => {
    const term = raw.trim();
    if (term.length < 2) {
      setRemote({ term: "", rows: [] });
      return;
    }
    try {
      const { data, error } = await getSupabaseBrowserClient()
        .from("accounts")
        .select(
          "id, name, account_type, city, territory_id, has_display_wall, display_last_verified_at, parent_account_id, updated_at",
        )
        .ilike("name", `%${term}%`)
        .limit(20);
      // Offline surfaces as an error, not a throw — treat both as "no server
      // results for this term", never as "keep the last ones".
      setRemote({ term, rows: error ? [] : ((data as CachedAccount[]) ?? []) });
    } catch {
      setRemote({ term, rows: [] });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void lookupRemote(query), 250);
    return () => clearTimeout(timer);
  }, [query, lookupRemote]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;

    const cachedAccounts = cache.accounts.filter((a) =>
      `${a.name} ${a.city ?? ""}`.toLowerCase().includes(q),
    );
    const seen = new Set(cachedAccounts.map((a) => a.id));
    // only merge server rows that belong to the term on screen right now
    const remoteRows =
      remote.term === query.trim() ? remote.rows.filter((a) => !seen.has(a.id)) : [];
    const accounts = [...cachedAccounts, ...remoteRows];

    return {
      accounts,
      cachedCount: cachedAccounts.length,
      agenda: cache.agenda.filter((i) =>
        i.action.toLowerCase().includes(q),
      ),
      activities: cache.activities.filter((a) =>
        `${a.what_happened ?? ""} ${a.activity_type}`.toLowerCase().includes(q),
      ),
    };
  }, [query, cache, remote]);

  const empty =
    results &&
    results.accounts.length === 0 &&
    results.agenda.length === 0 &&
    results.activities.length === 0;

  return (
    <div className="flex flex-col gap-5 pt-1">
      <label className="search-field">
        <SearchIcon size={18} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Accounts, visits, notes…"
          type="search"
          enterKeyHint="search"
          aria-label="Search"
        />
      </label>

      {!results && (
        <p className="t-sub px-1">
          Search your accounts, agenda and recent visits. Cached results work
          with no signal.
        </p>
      )}

      {empty && (
        <p className="t-sub px-1">
          Nothing matches “{query.trim()}” in your cached records.
        </p>
      )}

      {results && results.accounts.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Accounts</h2>
            <span className="t-meta">{results.accounts.length}</span>
          </div>
          <ul className="list">
            {results.accounts.map((a, i) => (
              <li key={a.id}>
                <Link href={`/accounts/${a.id}`} className="row">
                  <span className="row-lead">
                    <BuildingIcon size={18} />
                  </span>
                  <span className="row-body">
                    <span className="t-title block truncate">{a.name}</span>
                    <span className="t-sub block truncate">
                      {humanize(a.account_type)}
                      {a.city ? ` · ${a.city}` : ""}
                      {a.has_display_wall ? " · display wall" : ""}
                    </span>
                  </span>
                  {i >= results.cachedCount && <span className="tag">online</span>}
                  <ChevronRightIcon
                    size={14}
                    style={{ color: "var(--ink-muted)" }}
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results && results.agenda.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Agenda</h2>
            <Link href="/agenda" className="t-action">
              Open agenda
            </Link>
          </div>
          <ul className="list">
            {results.agenda.map((i) => (
              <li key={i.id} className="row">
                <span className="row-lead">
                  <CalendarIcon size={18} />
                </span>
                <span className="row-body">
                  <span className="t-title block truncate">{i.action}</span>
                  <span className="t-sub block">{i.due_date}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {results && results.activities.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Recent visits</h2>
            <span className="t-meta">{results.activities.length}</span>
          </div>
          <ul className="list">
            {results.activities.map((a) => (
              <li key={a.id} className="row">
                <span className="row-lead flex-col leading-none">
                  <span className="text-[15px] font-bold">
                    {new Date(a.occurred_at).getDate()}
                  </span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">
                    {new Date(a.occurred_at).toLocaleString("en-US", {
                      month: "short",
                    })}
                  </span>
                </span>
                <span className="row-body">
                  <span className="t-title block truncate">
                    {humanize(a.activity_type)}
                  </span>
                  {a.what_happened && (
                    <span className="t-sub line-clamp-2 block">
                      {a.what_happened}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
