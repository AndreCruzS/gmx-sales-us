"use client";

// "Add new" on the Quotes tile.
//
// A quote belongs to an account, and the deal form already knows how to create
// one properly — so this screen does the only thing that form cannot: name the
// account first. Then it hands over with the stage pre-set to QUOTE.
//
// THE DISTRIBUTORS LEAD, UNFOLDED. Quotes here are for the distribution houses
// in their absolute majority (Andre, 2026-08-31) — a handful of names that
// deserve to be one tap away, not alphabetically interleaved with every dealer
// in the patch. The dealers wait folded underneath, one tap to open; typing in
// the search flattens everything, because a person typing a name has already
// chosen it.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/components/icons";
import { humanize } from "@/lib/domain/enums";
import { displayAccountName } from "@/lib/format";
import { getOfflineLayer, type CachedAccount } from "@/lib/offline";

export default function NewQuotePage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void getOfflineLayer().local.getAccounts().then(setAccounts);
  }, []);

  const byName = (a: CachedAccount, b: CachedAccount) =>
    a.name.localeCompare(b.name);

  // Quick-find over the cached working set — "which of my doors", not a
  // search of the whole org. A live query flattens the groups.
  const q = query.trim().toLowerCase();
  const searched = useMemo(
    () =>
      q
        ? accounts
            .filter((a) => `${a.name} ${a.city ?? ""}`.toLowerCase().includes(q))
            .sort(byName)
            .slice(0, 20)
        : [],
    [accounts, q],
  );

  const groups = useMemo(() => {
    const distributors = accounts
      .filter((a) => a.account_type === "DISTRIBUTOR")
      .sort(byName);
    const dealers = accounts
      .filter((a) => a.account_type === "DEALER")
      .sort(byName);
    const rest = accounts
      .filter(
        (a) => a.account_type !== "DISTRIBUTOR" && a.account_type !== "DEALER",
      )
      .sort(byName);
    return { distributors, dealers, rest };
  }, [accounts]);

  const row = (a: CachedAccount) => (
    <li key={a.id}>
      <button
        type="button"
        className="row"
        onClick={() => router.push(`/accounts/${a.id}/new-deal?stage=QUOTE`)}
      >
        <span className="row-body">
          <span className="t-title block truncate">
            {displayAccountName(a.name)}
          </span>
          <span className="t-sub block truncate">
            {humanize(a.account_type)}
            {a.city ? ` · ${a.city}` : ""}
          </span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="stack pt-2">
      <section className="flex flex-col gap-3">
        <p className="t-sub px-1">Who is this quote for?</p>

        <label className="search-field">
          <SearchIcon size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find the account…"
            type="search"
            enterKeyHint="search"
            aria-label="Find the account"
            autoFocus
          />
        </label>

        {accounts.length === 0 ? (
          <p className="t-sub px-1">No accounts on this device yet.</p>
        ) : q ? (
          searched.length === 0 ? (
            <p className="t-sub px-1">No account matches that.</p>
          ) : (
            <ul className="list">{searched.map(row)}</ul>
          )
        ) : (
          <>
            {groups.distributors.length > 0 && (
              <div>
                <p className="sales-eyebrow">Distribution</p>
                <ul className="list">{groups.distributors.map(row)}</ul>
              </div>
            )}

            {groups.dealers.length > 0 && (
              <details className="pk-unfold">
                <summary className="t-hint">
                  Dealers — {groups.dealers.length}
                </summary>
                <ul className="list">{groups.dealers.map(row)}</ul>
              </details>
            )}

            {groups.rest.length > 0 && (
              <details className="pk-unfold">
                <summary className="t-hint">
                  Everyone else — {groups.rest.length}
                </summary>
                <ul className="list">{groups.rest.map(row)}</ul>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}
