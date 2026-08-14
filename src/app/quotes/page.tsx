"use client";

// Active quotes.
//
// Leadership asked for "uma lista tipo a lista de ordens do outro sistema —
// active quotes": the same shape as the Order Management Platform's order
// list, for the quotes a rep still has out. So this is a list, not a chart —
// one row per quote, the number on the right, and the ones that have gone past
// their close date at the top, because those are the calls to make today.
//
// A quote is not a new object here. It is an opportunity that reached a stage
// where a price is out (src/lib/domain/quotes.ts). Inventing a second entity
// would give the pipeline and this screen two different answers to the same
// question, which is exactly the problem the app exists to end.
//
// No signal: opportunities are not part of the device's cached working set —
// the cache carries the doors a rep walks into, not the money — so with no
// signal this screen says so rather than showing a stale total.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { ChevronRightIcon, PlusIcon, SearchIcon } from "@/components/icons";
import {
  ACTIVE_QUOTE_STAGES,
  isOverdue,
  quoteStageLabel,
  sortQuotes,
  totalValue,
} from "@/lib/domain/quotes";
import { displayAccountName, formatDay, formatMoney } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface QuoteRow {
  id: string;
  name: string;
  stage: string;
  estimated_revenue: number | null;
  expected_close_date: string | null;
  current_status: string | null;
  updated_at: string | null;
  primary_account_id: string;
  // PostgREST needs the constraint name: opportunities reaches accounts by
  // half a dozen columns (dealer, distributor, architect…), so an unqualified
  // embed is ambiguous.
  account: { name: string } | null;
}

const COLUMNS =
  "id, name, stage, estimated_revenue, expected_close_date, current_status, updated_at, primary_account_id, account:accounts!opportunities_primary_account_id_fkey(name)";

const FILTERS = [
  { key: "all", label: "All active", stage: null },
  { key: "quote", label: "Out for quote", stage: "QUOTE" },
  { key: "decision", label: "Deciding", stage: "DECISION" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default function QuotesPage() {
  const { profile, status } = useOffline();

  const [rows, setRows] = useState<QuoteRow[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  // Stamped when the data lands, never read during a render — `Date.now()` in
  // render is impure and the lint rule is right to refuse it.
  const [todayIso, setTodayIso] = useState("");

  const load = useCallback(async () => {
    if (!profile) return;
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`;
    try {
      const { data, error } = await getSupabaseBrowserClient()
        .from("opportunities")
        .select(COLUMNS)
        .in("stage", ACTIVE_QUOTE_STAGES as unknown as string[])
        .limit(200);
      if (error) {
        setOffline(true);
        setRows([]);
      } else {
        setOffline(false);
        setRows((data ?? []) as unknown as QuoteRow[]);
      }
    } catch {
      // fetch rejected — no signal, and there is no cached answer to fall to
      setOffline(true);
      setRows([]);
    }
    setTodayIso(iso);
  }, [profile]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, status.lastPulledAt]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows ?? []) c[r.stage] = (c[r.stage] ?? 0) + 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    let list = rows ?? [];
    const wanted = FILTERS.find((f) => f.key === filter)?.stage ?? null;
    if (wanted) list = list.filter((r) => r.stage === wanted);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        `${r.name} ${r.account?.name ?? ""} ${r.current_status ?? ""}`
          .toLowerCase()
          .includes(q),
      );
    }
    return sortQuotes(list, todayIso);
  }, [rows, filter, query, todayIso]);

  const chasing = useMemo(
    () => (rows ?? []).filter((r) => isOverdue(r, todayIso)).length,
    [rows, todayIso],
  );

  return (
    <div className="stack pt-2">
      <div className="flex gap-2">
        <label className="search-field flex-1">
          <SearchIcon size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a quote…"
            type="search"
            enterKeyHint="search"
            aria-label="Find a quote"
          />
        </label>
        <Link href="/quotes/new" className="btn-secondary shrink-0" aria-label="Add a quote">
          <PlusIcon size={18} style={{ color: "var(--ink-secondary)" }} />
        </Link>
      </div>

      {offline && (
        <p className="tag tag-accent">
          No signal — quotes aren&rsquo;t saved on this device
        </p>
      )}

      {/* The two numbers a rep carries: how many are out, and what they add to. */}
      <section>
        <div className="card card-pad flex items-baseline justify-between gap-3">
          <span>
            <span
              className="block text-[26px] font-extrabold leading-none"
              style={{ color: "var(--accent-ink)" }}
            >
              {rows === null ? "–" : rows.length}
            </span>
            <span className="t-meta mt-1 block">
              {rows === null
                ? "Loading"
                : rows.length === 1
                  ? "quote out"
                  : "quotes out"}
              {chasing > 0 && (
                <>
                  {" · "}
                  <span style={{ color: "var(--danger)", fontWeight: 700 }}>
                    {chasing} past its date
                  </span>
                </>
              )}
            </span>
          </span>
          <span className="text-right">
            <span
              className="block text-[19px] font-bold"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {formatMoney(totalValue(rows ?? []))}
            </span>
            <span className="t-meta">on the table</span>
          </span>
        </div>
      </section>

      {(rows?.length ?? 0) > 0 && (
        <div className="chip-row" role="group" aria-label="Filter quotes">
          {FILTERS.map((f) => {
            const n = f.stage ? (counts[f.stage] ?? 0) : (rows?.length ?? 0);
            if (f.stage && n === 0) return null;
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

      <section>
        {rows === null ? (
          <p className="t-sub px-1">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="t-sub px-1">
            {rows.length === 0
              ? "Nothing out for quote. When a deal reaches a price, it lands here."
              : "No quote matches that."}
          </p>
        ) : (
          <ul className="list">
            {visible.map((r) => {
              const late = isOverdue(r, todayIso);
              return (
                <li key={r.id}>
                  {/* The account is where the work happens — the quote is a
                      reason to open it, not a place to sit. */}
                  <Link href={`/accounts/${r.primary_account_id}`} className="row">
                    <span className="row-body">
                      <span className="t-title block truncate">{r.name}</span>
                      <span className="t-sub block truncate">
                        {r.account ? displayAccountName(r.account.name) : "Account"}
                        {r.current_status ? ` · ${r.current_status}` : ""}
                      </span>
                      <span className="t-meta mt-0.5 block">
                        {quoteStageLabel(r.stage)}
                        {r.expected_close_date ? (
                          <>
                            {" · "}
                            <span
                              style={
                                late
                                  ? { color: "var(--danger)", fontWeight: 700 }
                                  : undefined
                              }
                            >
                              {late ? "was due " : "closes "}
                              {formatDay(r.expected_close_date)}
                            </span>
                          </>
                        ) : (
                          " · no close date"
                        )}
                      </span>
                    </span>
                    <span
                      className="shrink-0 text-right text-[15px] font-bold"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {formatMoney(r.estimated_revenue)}
                    </span>
                    <ChevronRightIcon
                      size={16}
                      style={{ color: "var(--ink-muted)", flexShrink: 0 }}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Pricing is the half of this the app cannot do yet, and saying so is
          better than a number nobody can trust. */}
      <p className="t-meta px-1">
        Prices are typed in for now — the distributor price list isn&rsquo;t
        wired up yet.
      </p>
    </div>
  );
}
