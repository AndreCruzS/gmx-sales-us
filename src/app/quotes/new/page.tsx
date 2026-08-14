"use client";

// "Add new" on the Quotes tile.
//
// A quote belongs to an account, and the deal form already knows how to create
// one properly — stage, value, close date, lead source and the required first
// next action, all through the one outbox op that create_opportunity_with_action
// replays in a single transaction. So this screen does the only thing that
// form cannot: name the account first. Then it hands over, with the stage
// pre-set to QUOTE, rather than growing a second form that would drift.

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

  // Quick-find over the cached working set, the same idiom as the referral
  // pickers — this is "which of my doors", not a search of the whole org.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? accounts.filter((a) =>
          `${a.name} ${a.city ?? ""}`.toLowerCase().includes(q),
        )
      : accounts;
    return [...base]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 20);
  }, [accounts, query]);

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

        {filtered.length === 0 ? (
          <p className="t-sub px-1">
            {accounts.length === 0
              ? "No accounts on this device yet."
              : "No account matches that."}
          </p>
        ) : (
          <ul className="list">
            {filtered.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="row"
                  onClick={() =>
                    router.push(`/accounts/${a.id}/new-deal?stage=QUOTE`)
                  }
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
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
