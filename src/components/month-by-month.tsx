"use client";

// "Análise de todo tipo de dado — Month by Month, Year to date", from the
// sticky note on the manager mockup. One component, used by the manager's home
// and by the report, so the two can never disagree about a year.
//
// Columns rather than a line: a month is a bucket you either filled or did
// not, and twelve of them fit a phone if each is a bar whose height you can
// read. Every month is drawn whether or not anything was won in it — a month
// with no sale is the point of the chart, and dropping it would draw a smooth
// line over a hole.

import { useMemo } from "react";

export interface WonMonthRow {
  /** Present so a page can narrow the year to one customer. */
  customer_id?: string;
  month: string;
  unit: string;
  won_qty: number;
  won_value: number;
}

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const MONEY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", { month: "short" });

export function MonthByMonth({
  rows,
  /** Stamped when the data loaded — the clock is never read during a render. */
  nowMs,
}: {
  rows: readonly WonMonthRow[];
  nowMs: number | null;
}) {
  const months = useMemo(() => {
    if (nowMs === null || rows.length === 0) return null;

    const byMonth = new Map<string, { qty: number; value: number }>();
    for (const r of rows) {
      const key = r.month.slice(0, 7);
      const cur = byMonth.get(key) ?? { qty: 0, value: 0 };
      cur.qty += Number(r.won_qty);
      cur.value += Number(r.won_value);
      byMonth.set(key, cur);
    }

    const now = new Date(nowMs);
    const series: { month: string; label: string; qty: number }[] = [];
    for (let back = 11; back >= 0; back -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      series.push({
        month: key,
        label: MONTH_SHORT.format(d),
        qty: byMonth.get(key)?.qty ?? 0,
      });
    }

    const year = String(now.getFullYear());
    let ytdQty = 0;
    let ytdValue = 0;
    for (const [key, v] of byMonth) {
      if (key.startsWith(year)) {
        ytdQty += v.qty;
        ytdValue += v.value;
      }
    }

    const best = series.reduce<{ label: string; qty: number } | null>(
      (top, m) => (m.qty > (top?.qty ?? 0) ? { label: m.label, qty: m.qty } : top),
      null,
    );

    return {
      series,
      peak: series.reduce((n, m) => Math.max(n, m.qty), 0),
      ytdQty,
      ytdValue,
      // One unit across the book; the trade quotes in linear feet.
      unit: rows[0]?.unit ?? "LF",
      best,
    };
  }, [rows, nowMs]);

  if (!months) return null;

  return (
    <section>
      <div className="section-head">
        <h2 className="t-section">
          Month by month <span style={{ color: "var(--ink-muted)" }}>· won volume</span>
        </h2>
        <span className="t-meta">
          {QTY.format(months.ytdQty)} {months.unit} this year
        </span>
      </div>
      <div className="card card-pad">
        {/* The column needs a track of its own to grow inside: a percentage
            height resolves against the parent's height, and a list item sized
            by its own content has none to give. */}
        <ul className="flex gap-1.5" style={{ height: 132 }}>
          {months.series.map((m) => (
            <li key={m.month} className="flex h-full flex-1 flex-col gap-1.5">
              <span className="flex flex-1 items-end">
                <span
                  className="w-full rounded-t"
                  style={{
                    height: `${months.peak === 0 ? 0 : Math.max(2, (100 * m.qty) / months.peak)}%`,
                    background: m.qty === 0 ? "var(--surface-sunken)" : "var(--accent)",
                  }}
                  role="img"
                  aria-label={`${m.label}: ${QTY.format(m.qty)} ${months.unit} won`}
                />
              </span>
              <span className="t-meta text-center" style={{ fontSize: 9.5 }}>
                {m.label}
              </span>
            </li>
          ))}
        </ul>
        <p className="t-sub mt-3">
          {QTY.format(months.ytdQty)} {months.unit} and{" "}
          {MONEY.format(months.ytdValue)} won since January
          {months.best
            ? ` · best month ${months.best.label}, ${QTY.format(months.best.qty)} ${months.unit}`
            : ""}
          .
        </p>
      </div>
    </section>
  );
}
