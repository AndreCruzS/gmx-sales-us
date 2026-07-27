"use client";

// The territory. The account is the object a rep thinks in, so it gets a tab —
// browsable, not only findable. The cached working set renders instantly and
// works with no signal (D56); with signal the full territory loads behind it
// and search reaches accounts beyond the cache.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { BuildingIcon, ChevronRightIcon, SearchIcon } from "@/components/icons";
import { humanize } from "@/lib/domain/enums";
import { getOfflineLayer, type CachedAccount } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AccountsPage() {
  const { profile, status } = useOffline();
  const [cached, setCached] = useState<CachedAccount[]>([]);
  const [territory, setTerritory] = useState<{
    fresh: boolean;
    rows: CachedAccount[];
  }>({ fresh: false, rows: [] });
  const [query, setQuery] = useState("");
  // Server search results are stored WITH their term — otherwise a failed
  // lookup leaves the previous term's rows on screen under the wrong query.
  const [remote, setRemote] = useState<{ term: string; rows: CachedAccount[] }>(
    { term: "", rows: [] },
  );

  useEffect(() => {
    if (!profile) return;
    void getOfflineLayer().local.getAccounts().then(setCached);
  }, [profile, status.lastPulledAt]);

  // The full territory (RLS already scopes it to this rep's visibility).
  useEffect(() => {
    if (!profile) return;
    let stale = false;
    void (async () => {
      try {
        const { data, error } = await getSupabaseBrowserClient()
          .from("accounts")
          .select(
            "id, name, account_type, city, territory_id, has_display_wall, display_last_verified_at, parent_account_id, updated_at",
          )
          .order("name")
          .limit(200);
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
  }, [profile, status.lastPulledAt]);

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
      setRemote({ term, rows: error ? [] : ((data as CachedAccount[]) ?? []) });
    } catch {
      setRemote({ term, rows: [] });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void lookupRemote(query), 250);
    return () => clearTimeout(timer);
  }, [query, lookupRemote]);

  const offlineOnly = !territory.fresh;

  const rows = useMemo(() => {
    // Base list: full territory when it loaded, cached working set otherwise.
    const base = territory.fresh ? territory.rows : cached;
    const q = query.trim().toLowerCase();
    if (!q) return [...base].sort((a, b) => a.name.localeCompare(b.name));

    const local = base.filter((a) =>
      `${a.name} ${a.city ?? ""}`.toLowerCase().includes(q),
    );
    const seen = new Set(local.map((a) => a.id));
    const extra =
      remote.term === query.trim()
        ? remote.rows.filter((a) => !seen.has(a.id))
        : [];
    return [...local, ...extra].sort((a, b) => a.name.localeCompare(b.name));
  }, [territory, cached, query, remote]);

  return (
    <div className="stack pt-2">
      <label className="search-field">
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

      {offlineOnly && (
        <p className="tag tag-accent">
          No signal — showing accounts saved on this device
        </p>
      )}

      <section>
        <div className="section-head">
          <h2 className="t-section">
            {query.trim() ? "Matches" : "Your accounts"}
          </h2>
          <span className="t-meta">{rows.length}</span>
        </div>
        {rows.length === 0 ? (
          <p className="t-sub px-1">
            {query.trim()
              ? `Nothing matches “${query.trim()}”.`
              : "No accounts yet. They appear here as soon as your territory syncs."}
          </p>
        ) : (
          <ul className="list">
            {rows.map((a) => (
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
                  <ChevronRightIcon
                    size={14}
                    style={{ color: "var(--ink-muted)" }}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
