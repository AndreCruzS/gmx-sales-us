"use client";

// THE DEALER SHEET (meeting 2026-10-27, mockup v3 screen 2). A dealer opened
// from the Dealers board — a row of the market table or a to-do — reads, top
// to bottom, in the order Bianca asks about a dealer:
//   · who it is: tier, name, where, whose patch;
//   · the last visit, and what is still pending from it;
//   · the promises made to this dealer, and whether we make too many;
//   · every visit before that, one line each;
//   · the sales facts, which open the dealer module the other boards use.
//
// On the desk it sits beside the board (the list stays where the reader left
// it); on a phone it is a full-width sheet with a Back button.
//
// It reads its own rows when it opens — the board only carries open to-dos and
// visit dates, and the sheet needs the notes, the closed promises and which
// visit a to-do came from. Every read is paged and ordered (fetchAllPages).
//
// What it cannot know, it says: a dealer the files know only by its label has
// no account, so no visits; an account that is not a dealer has no tier; an
// account hidden from the reader shows nothing rather than a false "none".

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDealerModule } from "@/components/dealer-module";
import { DealerItemForm } from "@/components/dealer-item-form";
import type { DealerItem } from "@/components/dealers-todos";
import { AlertIcon } from "@/components/icons";
import type { OpenDealer } from "@/app/dealers/page";
import {
  ITEM_TYPE_LABEL,
  isLate,
  promiseStats,
  type ItemType,
} from "@/lib/domain/dealer-items";
import type { DealerTier, Tier } from "@/lib/domain/dealer-tiers";
import { displayAccountName, formatDay } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/page";

/** A visit is somebody standing in front of the account; a call is not. The
 *  board counts the same four. */
const VISIT_TYPES = ["DEALER_VISIT", "DISTRIBUTOR_VISIT", "JOBSITE_VISIT", "PK_TRAINING"];

/** Said beside a visit that was not a plain dealer visit. */
const VISIT_WORDS: Record<string, string> = {
  DISTRIBUTOR_VISIT: "distributor visit",
  JOBSITE_VISIT: "jobsite visit",
  PK_TRAINING: "PK training",
};

const TIER_WORDS: Record<Tier, string> = {
  T1: "Tier 1 · by volume",
  T2: "Tier 2 · bought in 3+ months",
  T3: "Tier 3 · small or now and then",
};

const ACCOUNT_KIND: Record<string, string> = {
  DISTRIBUTOR: "a distributor",
  CONTRACTOR: "a contractor",
  ARCHITECT: "an architect",
  BUILDER: "a builder",
};

/** How many visits the history shows before "Show all". */
const HISTORY_FIRST = 6;

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DATE_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

interface SheetAccount {
  id: string;
  name: string;
  account_type: string;
  city: string | null;
  state: string | null;
  owner_id: string;
  territories: { name: string } | null;
}

interface SheetVisit {
  id: string;
  activity_type: string;
  occurred_at: string;
  owner_id: string;
  what_happened: string | null;
}

interface SheetItem {
  id: string;
  action: string;
  due_date: string;
  completed_at: string | null;
  account_id: string | null;
  activity_id: string | null;
  item_type: ItemType;
}

type Loaded =
  | { state: "loading" }
  | { state: "failed" }
  | {
      state: "ready";
      account: SheetAccount | null;
      visits: SheetVisit[];
      items: SheetItem[];
      today: string;
    };

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Oct 22", or "Oct 22, 2025" when it is not this year. */
function visitDate(ts: string, today: string): string {
  const d = new Date(ts);
  return String(d.getFullYear()) === today.slice(0, 4) ? DATE.format(d) : DATE_YEAR.format(d);
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function firstLine(text: string | null): string | null {
  const line = text?.split(/\r?\n/).find((l) => l.trim() !== "")?.trim();
  return line ? line : null;
}

/** One decimal, the way the ⚠ line compares them. */
function oneDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

async function loadSheet(accountId: string): Promise<Omit<Extract<Loaded, { state: "ready" }>, "state">> {
  const supabase = getSupabaseBrowserClient();
  const [acc, visits, items] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, account_type, city, state, owner_id, territories(name)")
      .eq("id", accountId)
      .maybeSingle(),
    // Newest first, so the first one is the last visit.
    fetchAllPages<SheetVisit>((from, to) =>
      supabase
        .from("activities")
        .select("id, activity_type, occurred_at, owner_id, what_happened")
        .eq("primary_account_id", accountId)
        .in("activity_type", VISIT_TYPES)
        // A visit on the agenda has not happened yet: it is not the last one.
        .lte("occurred_at", new Date().toISOString())
        .order("occurred_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    // Every to-do on the account, closed ones too: a kept promise is closed.
    fetchAllPages<SheetItem>((from, to) =>
      supabase
        .from("next_actions")
        .select("id, action, due_date, completed_at, account_id, activity_id, item_type")
        .eq("account_id", accountId)
        .not("item_type", "is", null)
        .order("due_date")
        .order("id")
        .range(from, to)
        .then((r) => ({ data: r.data as unknown as SheetItem[] | null, error: r.error })),
    ),
  ]);
  if (acc.error) throw new Error(acc.error.message);
  return {
    account: (acc.data as unknown as SheetAccount | null) ?? null,
    visits,
    items,
    today: isoOf(new Date()),
  };
}

function ItemRow({ item, today }: { item: SheetItem; today: string }) {
  const late = isLate(item, today);
  return (
    <li className="dsh-item">
      {late ? (
        <span className="dl-pill" data-tone="late">
          {daysBetween(item.due_date, today)}d late
        </span>
      ) : (
        <span className="dl-pill">{formatDay(item.due_date)}</span>
      )}
      <span className="dsh-item-what">
        {item.action}
        <span className="t-hint"> · {ITEM_TYPE_LABEL[item.item_type].toLowerCase()}</span>
      </span>
    </li>
  );
}

export function DealerSheet({
  dealer,
  tier,
  showTier = true,
  onClose,
  teamPerVisit = null,
  names,
  onAdded,
}: {
  dealer: OpenDealer;
  tier: DealerTier | null;
  /** Admins only: a tier is worked out from every dealer's sales. */
  showTier?: boolean;
  onClose: () => void;
  /** Promises per visit across every dealer on the board, for the ⚠ line. */
  teamPerVisit?: number | null;
  /** Membership id → full name, the board's own map. */
  names?: ReadonlyMap<string, string>;
  /** A to-do was added here; the board lists it too. */
  onAdded?: (item: DealerItem) => void;
}) {
  const dealerModule = useDealerModule();
  const accountId = dealer.accountId;
  const [loaded, setLoaded] = useState<Loaded>(() =>
    accountId ? { state: "loading" } : { state: "ready", account: null, visits: [], items: [], today: isoOf(new Date()) },
  );
  const [attempt, setAttempt] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let stale = false;
    loadSheet(accountId)
      .then((r) => !stale && setLoaded({ state: "ready", ...r }))
      .catch(() => !stale && setLoaded({ state: "failed" }));
    return () => {
      stale = true;
    };
  }, [accountId, attempt]);

  // Escape closes it, and the reader's focus lands in it when it opens.
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // The dealer module opens over the sheet and takes the first Escape.
      if (e.key !== "Escape" || document.querySelector(".dmod")) return;
      // Escape inside the + Add form is the typist's, not the sheet's: closing
      // here would throw away what they were writing.
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ready = loaded.state === "ready" ? loaded : null;
  const account = ready?.account ?? null;
  const visits = useMemo(() => ready?.visits ?? [], [ready]);
  const items = useMemo(() => ready?.items ?? [], [ready]);
  const today = ready?.today ?? "";

  // An account that came back empty while one was asked for: the reader
  // cannot see it, so nothing below can be read as "none".
  const hidden = !!accountId && ready !== null && account === null;
  const notDealer = account !== null && account.account_type !== "DEALER";

  const name =
    (dealer.name && dealer.name.trim()) ||
    (account ? displayAccountName(account.name) : "") ||
    tier?.name ||
    "This account";
  const region = tier?.regionName ?? account?.territories?.name ?? null;
  const place = account ? [account.city, account.state].filter(Boolean).join(", ") : "";
  const rep = account ? (names?.get(account.owner_id) ?? null) : null;

  const last = visits[0] ?? null;
  const pendingFromLast = useMemo(
    () =>
      last
        ? items
            .filter((i) => i.completed_at === null && i.activity_id === last.id)
            .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id))
        : [],
    [items, last],
  );
  const otherOpen = useMemo(
    () =>
      items
        .filter((i) => i.completed_at === null && (!last || i.activity_id !== last.id))
        .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id)),
    [items, last],
  );
  const stats = useMemo(
    () => (today ? promiseStats(items, visits.length, today) : null),
    [items, visits.length, today],
  );
  const tooMany =
    stats?.perVisit != null &&
    teamPerVisit != null &&
    oneDecimal(stats.perVisit) > oneDecimal(teamPerVisit);

  // The sales facts are the files' — a dealer with no rows in the window has
  // none to open, and an account that is not a dealer is not in them at all.
  const canOpenFacts = tier !== null && dealerModule !== null;

  const history = showAll ? visits : visits.slice(0, HISTORY_FIRST);

  return (
    <aside className="dsh" aria-label={name}>
      <header className="dsh-head">
        <div className="dsh-head-top">
          <button ref={closeRef} type="button" className="dmod-back dsh-back" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span className="dsh-back-phone">Back</span>
            <span className="dsh-back-desk">Close</span>
          </button>
          {account && (
            <Link href={`/accounts/${account.id}`} className="dmod-link">
              Open account page
            </Link>
          )}
        </div>
        <div className="dmod-tags">
          {showTier && tier ? (
            <span className="dl-tier" data-tier={tier.tier}>
              {TIER_WORDS[tier.tier]}
            </span>
          ) : notDealer ? (
            <span className="dmod-tag dmod-tag-warn">
              {showTier ? "Not a tiered dealer" : "Not a dealer"}
            </span>
          ) : showTier ? (
            <span className="dl-tier">No history</span>
          ) : null}
          {!accountId && <span className="dmod-tag dmod-tag-warn">No account yet</span>}
        </div>
        <h2 className="dmod-name">{name}</h2>
        <p className="dmod-sub">
          {[place || null, region, rep ? `rep ${rep}` : null].filter(Boolean).join(" · ") ||
            (accountId ? " " : "Known only by its name in the sales files")}
        </p>
      </header>

      <div className="dsh-body">
        {notDealer && account && (
          <p className="t-sub dsh-note">
            This is {ACCOUNT_KIND[account.account_type] ?? "an account"}, not a dealer, so it has
            no tier and no sales facts. Its visits and to-dos are below.
          </p>
        )}

        {!accountId ? (
          <p className="t-sub dsh-note">No visits recorded: this dealer has no account yet.</p>
        ) : loaded.state === "loading" ? (
          <div aria-busy="true" className="dsh-skel">
            <span className="skel" style={{ width: "40%", height: 10 }} />
            <span className="skel" style={{ width: "90%", height: 14 }} />
            <span className="skel" style={{ width: "70%", height: 14 }} />
            <span className="skel" style={{ width: "40%", height: 10, marginTop: 12 }} />
            <span className="skel" style={{ width: "80%", height: 14 }} />
          </div>
        ) : loaded.state === "failed" ? (
          <div className="dsh-note">
            <p className="t-sub">
              This dealer&rsquo;s visits could not be read right now. Nothing is lost &mdash; try
              again.
            </p>
            <button
              type="button"
              className="btn-secondary mt-2"
              onClick={() => {
                setLoaded({ state: "loading" });
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : hidden ? (
          <p className="t-sub dsh-note">
            This account is not visible to you, so its visits and promises cannot be shown.
          </p>
        ) : (
          <>
            {/* ── ADD a to-do on this dealer ───────────────────────────── */}
            {adding ? (
              <DealerItemForm
                accountId={accountId ?? undefined}
                accountName={name}
                onDone={() => setAdding(false)}
                onSaved={(item) => {
                  onAdded?.(item);
                  // Show it in the sheet before the server has it.
                  setLoaded((l) =>
                    l.state === "ready" && item.account_id === accountId
                      ? {
                          ...l,
                          items: [
                            ...l.items,
                            {
                              id: item.id,
                              action: item.action,
                              due_date: item.due_date,
                              completed_at: null,
                              account_id: item.account_id,
                              activity_id: null,
                              item_type: item.item_type,
                            },
                          ],
                        }
                      : l,
                  );
                }}
              />
            ) : (
              <button type="button" className="t-action dsh-more" onClick={() => setAdding(true)}>
                + Add
              </button>
            )}

            {/* ── LAST VISIT, and what is still pending from it ─────────── */}
            <section className="dmod-card">
              {last ? (
                <>
                  <p className="dmod-eyebrow dsh-eyebrow">
                    Last visit · {visitDate(last.occurred_at, today)}
                  </p>
                  <p className="dsh-visit-who">
                    {[
                      names?.get(last.owner_id) ?? "Someone",
                      VISIT_WORDS[last.activity_type] ?? null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="dsh-visit-note">
                    {last.what_happened?.trim() || (
                      <span className="t-hint">No note was written for this visit.</span>
                    )}
                  </p>
                  <p className="dmod-eyebrow dsh-eyebrow">Still pending from it</p>
                  {pendingFromLast.length === 0 ? (
                    <p className="t-hint">Nothing left open from this visit.</p>
                  ) : (
                    <ul className="dsh-items">
                      {pendingFromLast.map((i) => (
                        <ItemRow key={i.id} item={i} today={today} />
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>
                  <p className="dmod-eyebrow dsh-eyebrow">Last visit</p>
                  <p className="t-sub">No visit recorded yet.</p>
                </>
              )}
              {otherOpen.length > 0 && (
                <>
                  <p className="dmod-eyebrow dsh-eyebrow">
                    {last ? "Also open on this account" : "Open on this account"}
                  </p>
                  <ul className="dsh-items">
                    {otherOpen.map((i) => (
                      <ItemRow key={i.id} item={i} today={today} />
                    ))}
                  </ul>
                </>
              )}
            </section>

            {/* ── PROMISES to this dealer ─────────────────────────────── */}
            {stats && (
              <section className="dmod-card">
                <p className="dmod-eyebrow dsh-eyebrow">Promises to this {notDealer ? "account" : "dealer"}</p>
                {stats.promises === 0 ? (
                  <p className="t-sub">
                    No promise recorded
                    {stats.visits > 0
                      ? ` in ${QTY.format(stats.visits)} ${stats.visits === 1 ? "visit" : "visits"}`
                      : ""}
                    .
                  </p>
                ) : (
                  <p className="dsh-stats">
                    <span className="fig">{QTY.format(stats.visits)}</span>{" "}
                    {stats.visits === 1 ? "visit" : "visits"} ·{" "}
                    <span className="fig">{QTY.format(stats.promises)}</span>{" "}
                    {stats.promises === 1 ? "promise" : "promises"} ·{" "}
                    <span className="fig">{QTY.format(stats.kept)}</span> kept ·{" "}
                    <span className={stats.late > 0 ? "fig dl-late-text" : "fig"}>
                      {QTY.format(stats.late)}
                    </span>{" "}
                    late · <span className="fig">{QTY.format(stats.open)}</span> open
                  </p>
                )}
                {tooMany && stats.perVisit !== null && teamPerVisit !== null && (
                  <p className="dsh-warn">
                    <AlertIcon size={15} />
                    <span>
                      {oneDecimal(stats.perVisit).toFixed(1)} promises per visit — above team
                      average ({oneDecimal(teamPerVisit).toFixed(1)})
                    </span>
                  </p>
                )}
              </section>
            )}

            {/* ── VISIT HISTORY ───────────────────────────────────────── */}
            {visits.length > 0 && (
              <section className="dmod-card">
                <p className="dmod-eyebrow dsh-eyebrow">
                  Visit history · {QTY.format(visits.length)}
                </p>
                <ol className="dsh-timeline">
                  {history.map((v) => (
                    <li key={v.id} className="dsh-tl">
                      <span className="dsh-tl-head">
                        <b>{visitDate(v.occurred_at, today)}</b>
                        {" · "}
                        {[names?.get(v.owner_id) ?? "Someone", VISIT_WORDS[v.activity_type] ?? null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span className="dsh-tl-note">
                        {firstLine(v.what_happened) ?? <span className="t-hint">no note</span>}
                      </span>
                    </li>
                  ))}
                </ol>
                {visits.length > HISTORY_FIRST && (
                  <button type="button" className="t-action dsh-more" onClick={() => setShowAll((s) => !s)}>
                    {showAll ? "Show fewer" : `Show all ${QTY.format(visits.length)} visits`}
                  </button>
                )}
              </section>
            )}
          </>
        )}

        {/* ── SALES FACTS — the dealer module the other boards open ───── */}
        {!notDealer && !hidden && (
          <section className="dmod-card">
            <p className="dmod-eyebrow dsh-eyebrow">Sales facts</p>
            {canOpenFacts ? (
              <button
                type="button"
                className="dsh-facts"
                onClick={() => dealerModule?.open(dealer.key)}
              >
                <span>
                  What {name} bought, month by month, and through which houses
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            ) : (
              <p className="t-sub">
                No sales on file for this dealer in the last twelve months, so there are no sales
                facts to open.
              </p>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
