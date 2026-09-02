"use client";

// The order book (Andre, 2026-09-02): GMX's own sales, synced every five
// minutes from the order-system project into orders_mirror. This is the
// SELL-IN half of the funnel — the POs the distributors place on GMX —
// beside the sell-through's SELL-OUT half.
//
// The page is a reading, not a workstation: the order system remains where
// orders are worked. Here a manager asks "what has Hardwoods bought from us,
// what's still open, what was on that PO?" — so every order unfolds into its
// item list in place.
//
// ?account=<id> narrows to one account's orders via order_customer_links —
// the door the account page opens.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { SearchIcon } from "@/components/icons";
import { orderVolume, type OrderItemLike } from "@/lib/domain/order-volume";
import { periodLabel } from "@/lib/domain/sell-through";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface OrderItem {
  sku?: string;
  description?: string;
  quantity?: number;
  uom?: string;
  unit_price?: number;
  total_amount?: number;
}

interface OrderRow {
  id: string;
  order_number: string;
  customer_id: string | null;
  customer_name: string;
  status: string;
  items: OrderItem[] | null;
  total_value: number | null;
  po_number: string | null;
  order_date_po: string | null;
  estimated_delivery: string | null;
  delivered_at: string | null;
  created_at: string | null;
  archived_at: string | null;
  synced_at: string;
}

interface LinkRow {
  customer_id: string;
  account_id: string;
  accounts: { name: string } | null;
}

interface HousePeriodRow {
  distributor_id: string | null;
  period: string;
  period_kind: "MONTH" | "YTD" | null;
  quantity: number;
}

const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// The order system's stages, read as the two questions a desk asks.
const DONE_STATUSES = new Set(["Completed"]);

function statusLabel(s: string): string {
  return s.replaceAll("_", " ");
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="stack pt-2" aria-busy="true" />}>
      <OrdersView />
    </Suspense>
  );
}

function OrdersView() {
  const { profile } = useOffline();
  const params = useSearchParams();
  const accountFilter = params.get("account");

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [housePeriods, setHousePeriods] = useState<HousePeriodRow[]>([]);
  const [query, setQuery] = useState("");
  const [window_, setWindow] = useState<"open" | "all">("open");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!profile) return;
    let stale = false;
    void (async () => {
      const supabase = getSupabaseBrowserClient();
      const [o, l, hp] = await Promise.all([
        supabase
          .from("orders_mirror")
          .select(
            "id, order_number, customer_id, customer_name, status, items, total_value, po_number, order_date_po, estimated_delivery, delivered_at, created_at, archived_at, synced_at",
          )
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("order_customer_links")
          .select("customer_id, account_id, accounts(name)"),
        // The return, by house and period — the sell-out side of the ledger.
        supabase
          .from("sell_through_house_periods")
          .select("distributor_id, period, period_kind, quantity")
          .limit(2000),
      ]);
      if (stale) return;
      if (!o.error && o.data) setOrders(o.data as unknown as OrderRow[]);
      if (!l.error && l.data) setLinks(l.data as unknown as LinkRow[]);
      if (!hp.error && hp.data)
        setHousePeriods(hp.data as unknown as HousePeriodRow[]);
      setLoaded(true);
    })();
    return () => {
      stale = true;
    };
  }, [profile]);

  const accountOf = useMemo(
    () =>
      new Map(
        links.map((l) => [
          l.customer_id,
          { id: l.account_id, name: l.accounts?.name ?? null },
        ]),
      ),
    [links],
  );

  const shown = useMemo(() => {
    let base = orders.filter((o) => !o.archived_at);
    if (accountFilter) {
      base = base.filter(
        (o) =>
          o.customer_id && accountOf.get(o.customer_id)?.id === accountFilter,
      );
    }
    if (window_ === "open") {
      base = base.filter((o) => !DONE_STATUSES.has(o.status));
    }
    const q = query.trim().toLowerCase();
    if (q) {
      base = base.filter(
        (o) =>
          o.order_number.toLowerCase().includes(q) ||
          o.customer_name.toLowerCase().includes(q) ||
          (o.po_number ?? "").toLowerCase().includes(q) ||
          (o.customer_id
            ? (accountOf.get(o.customer_id)?.name ?? "")
                .toLowerCase()
                .includes(q)
            : false),
      );
    }
    return base;
  }, [orders, accountFilter, window_, query, accountOf]);

  const totals = useMemo(() => {
    const value = shown.reduce((n, o) => n + (Number(o.total_value) || 0), 0);
    return { count: shown.length, value };
  }, [shown]);

  // ── The stock ledger, per house ───────────────────────────────────────────
  // What GMX shipped them (our sell-out, converted to LF where provable)
  // minus what their return says they sold through = what is estimated to be
  // ON THEIR FLOOR. Since a mark, not since the beginning of time: opening
  // stock is unknown, and the card says which window it is reading.
  const stock = useMemo(() => {
    const byAccount = new Map<
      string,
      {
        id: string;
        name: string;
        inLF: number;
        inValue: number;
        convertedValue: number;
        totalValue: number;
        orders: number;
        firstOrder: string | null;
      }
    >();
    for (const o of orders) {
      // Archived orders STAY in the ledger: filed-away paperwork still fed
      // the floor. Only the working list below hides them.
      if (!o.customer_id) continue;
      const acct = accountOf.get(o.customer_id);
      if (!acct?.name) continue;
      const entry = byAccount.get(acct.id) ?? {
        id: acct.id,
        name: acct.name,
        inLF: 0,
        inValue: 0,
        convertedValue: 0,
        totalValue: 0,
        orders: 0,
        firstOrder: null,
      };
      const vol = orderVolume((o.items ?? []) as OrderItemLike[]);
      entry.inLF += vol.lf;
      entry.inValue += Number(o.total_value) || 0;
      entry.convertedValue += vol.convertedValue;
      entry.totalValue += vol.totalValue;
      entry.orders += 1;
      const day = o.order_date_po ?? o.created_at?.slice(0, 10) ?? null;
      if (day && (!entry.firstOrder || day < entry.firstOrder))
        entry.firstOrder = day;
      byAccount.set(acct.id, entry);
    }
    return [...byAccount.values()]
      .map((h) => {
        // BOTH SIDES OF THE SUBTRACTION MUST READ THE SAME WINDOW. The
        // ledger starts at the house's first order on file (opening stock
        // before that is unknowable), so only monthly returns FROM THAT
        // MONTH ON count against it. A YTD file reaches back before the
        // mark and cannot be split, so it never enters this read — a July
        // return against June-onward orders is comparable; a Jan–Jun
        // aggregate is not.
        const mark = h.firstOrder ? `${h.firstOrder.slice(0, 7)}-01` : null;
        const mine = housePeriods.filter(
          (r) =>
            r.distributor_id === h.id &&
            r.period_kind !== "YTD" &&
            (!mark || r.period >= mark),
        );
        const outLF = mine.reduce((n, r) => n + Number(r.quantity), 0);
        const lastThrough =
          mine
            .map((r) => r.period)
            .sort()
            .reverse()[0] ?? null;
        return { ...h, outLF, lastThrough, position: h.inLF - outLF };
      })
      .sort((a, b) => b.inValue - a.inValue);
  }, [orders, accountOf, housePeriods]);

  const shownStock = accountFilter
    ? stock.filter((h) => h.id === accountFilter)
    : stock;

  const filterName = accountFilter
    ? (links.find((l) => l.account_id === accountFilter)?.accounts?.name ??
      "one account")
    : null;

  const syncedAt = orders[0]?.synced_at ?? null;

  return (
    <div className="stack pt-2">
      <section>
        {filterName && (
          <p className="t-sub mb-2">
            Orders from <strong>{filterName}</strong> ·{" "}
            <Link href="/orders" className="t-action">
              show every account
            </Link>
          </p>
        )}
        <div className="flex items-center gap-2">
          <label className="field flex min-w-0 flex-1 items-center gap-2">
            <SearchIcon size={16} style={{ color: "var(--ink-muted)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Order number, customer, PO"
              className="min-w-0 flex-1 bg-transparent outline-none"
              aria-label="Search orders"
            />
          </label>
          <div className="chip-row shrink-0" role="group" aria-label="Which orders">
            {(
              [
                ["open", "Open"],
                ["all", "Everything"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="chip"
                aria-pressed={window_ === key}
                onClick={() => setWindow(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="t-meta mt-2 px-1">
          {QTY.format(totals.count)} {totals.count === 1 ? "order" : "orders"} ·{" "}
          {MONEY.format(totals.value)}
          {syncedAt
            ? ` · synced ${new Date(syncedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
            : ""}
        </p>
      </section>

      {/* The stock ledger: our sell-out feeds their floor, their return
          drains it. Everything the subtraction cannot prove, the card says
          out loud — the window it reads, and how much of the money the LF
          conversion actually covers. */}
      {shownStock.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">On their floor — estimated</h2>
          </div>
          <div className="stock-cards">
            {shownStock.map((h) => {
              const coverage =
                h.totalValue > 0
                  ? Math.round((100 * h.convertedValue) / h.totalValue)
                  : null;
              return (
                <div key={h.id} className="card card-pad stock-card">
                  <Link href={`/accounts/${h.id}`} className="t-title block truncate">
                    {h.name}
                  </Link>
                  <div className="stock-figures">
                    <div>
                      <span className="t-hint block">We shipped</span>
                      <span className="fig-sm block">
                        {QTY.format(Math.round(h.inLF))} LF
                      </span>
                      <span className="t-meta">{MONEY.format(h.inValue)}</span>
                    </div>
                    <div>
                      <span className="t-hint block">They sold through</span>
                      <span className="fig-sm block">
                        {h.lastThrough
                          ? `${QTY.format(Math.round(h.outLF))} LF`
                          : "—"}
                      </span>
                      <span className="t-meta">
                        {h.lastThrough
                          ? `through ${periodLabel(h.lastThrough)}`
                          : "no return for this window yet"}
                      </span>
                    </div>
                    <div>
                      <span className="t-hint block">Still on their floor</span>
                      <span className="fig-sm block">
                        {h.lastThrough
                          ? `≈ ${QTY.format(Math.round(h.position))} LF`
                          : "—"}
                      </span>
                      <span className="t-meta">
                        {h.lastThrough ? "estimated" : "needs their return"}
                      </span>
                    </div>
                  </div>
                  <p className="t-meta mt-2">
                    {h.orders} {h.orders === 1 ? "order" : "orders"}
                    {h.firstOrder ? ` since ${h.firstOrder}` : ""}
                    {coverage !== null && coverage < 100
                      ? ` · LF read covers ${coverage}% of the order value`
                      : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {loaded && shown.length === 0 ? (
        <p className="t-sub px-1">
          {orders.length === 0
            ? "No orders have synced yet — the bridge runs every five minutes."
            : "Nothing matches that."}
        </p>
      ) : (
        <section>
          <ul className="list">
            {shown.map((o) => {
              const acct = o.customer_id ? accountOf.get(o.customer_id) : null;
              const items = Array.isArray(o.items) ? o.items : [];
              const open = expanded === o.id;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    className="row w-full text-left"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : o.id)}
                  >
                    <span className="row-body min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="t-title">{o.order_number}</span>
                        <span
                          className={
                            DONE_STATUSES.has(o.status)
                              ? "tag"
                              : "tag tag-accent"
                          }
                        >
                          {statusLabel(o.status)}
                        </span>
                      </span>
                      <span className="t-sub mt-0.5 block truncate">
                        {acct?.name ? (
                          <Link
                            href={`/accounts/${acct.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="underline-offset-2 hover:underline"
                          >
                            {acct.name}
                          </Link>
                        ) : (
                          o.customer_name
                        )}
                        {o.po_number ? ` · PO ${o.po_number}` : ""}
                        {" · "}
                        {items.length} {items.length === 1 ? "item" : "items"}
                        {o.order_date_po
                          ? ` · ${o.order_date_po}`
                          : o.created_at
                            ? ` · ${o.created_at.slice(0, 10)}`
                            : ""}
                      </span>
                    </span>
                    <span className="fig-sm shrink-0">
                      {o.total_value && Number(o.total_value) > 0
                        ? MONEY.format(Number(o.total_value))
                        : "—"}
                    </span>
                  </button>
                  {open && items.length > 0 && (
                    <div className="order-items card card-pad">
                      <table className="order-items-table">
                        <thead>
                          <tr>
                            <th>SKU</th>
                            <th>Description</th>
                            <th className="num">Qty</th>
                            <th>UoM</th>
                            <th className="num">Unit</th>
                            <th className="num">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it, i) => (
                            <tr key={`${it.sku}-${i}`}>
                              <td className="fig-sm">{it.sku ?? "—"}</td>
                              <td>{(it.description ?? "").split(/\r?\n/)[0]}</td>
                              <td className="num fig-sm">
                                {it.quantity != null
                                  ? QTY.format(it.quantity)
                                  : "—"}
                              </td>
                              <td>{it.uom ?? ""}</td>
                              <td className="num fig-sm">
                                {it.unit_price != null
                                  ? `$${it.unit_price}`
                                  : "—"}
                              </td>
                              <td className="num fig-sm">
                                {it.total_amount != null
                                  ? MONEY.format(it.total_amount)
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {open && items.length === 0 && (
                    <p className="t-sub px-4 py-2">
                      The file carries no item lines for this order.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
