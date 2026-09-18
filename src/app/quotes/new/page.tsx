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
//
// AND A COMPANY THAT IS NOT THERE YET IS BORN HERE (João, 2026-09-16): the
// last row of every search offers it as a new company, the short form opens in
// place, and the quote carries on with the account it just made — one step,
// not "go create the dealer, then come back and quote it".

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "@/components/icons";
import { NewCompanyInline } from "@/components/new-company-inline";
import { humanize } from "@/lib/domain/enums";
import { displayAccountName } from "@/lib/format";
import { getOfflineLayer, type CachedAccount } from "@/lib/offline";

export default function NewQuotePage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [query, setQuery] = useState("");
  // The name the new-company form opened with; null while it is closed.
  const [creating, setCreating] = useState<string | null>(null);

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

  // Offered under every search, not only an empty one: "Wellborn" can match a
  // different Wellborn and still not be the company in front of the rep.
  const newCompanyRow = (
    <button
      type="button"
      className="newco-offer"
      onClick={() => setCreating(query.trim())}
    >
      <span aria-hidden="true">+</span> New company
      {query.trim() ? <>: &ldquo;{query.trim()}&rdquo;</> : null}
    </button>
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

        {creating !== null ? (
          <NewCompanyInline
            initialName={creating}
            submitLabel="Continue to the quote"
            onCancel={() => setCreating(null)}
            onCreated={(a) => router.push(`/accounts/${a.id}/new-deal?stage=QUOTE`)}
          />
        ) : accounts.length === 0 ? (
          <>
            <p className="t-sub px-1">No accounts on this device yet.</p>
            {newCompanyRow}
          </>
        ) : q ? (
          <>
            {searched.length === 0 ? (
              <p className="t-sub px-1">No account matches that.</p>
            ) : (
              <ul className="list">{searched.map(row)}</ul>
            )}
            {newCompanyRow}
          </>
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
            {newCompanyRow}
          </>
        )}
      </section>
    </div>
  );
}
