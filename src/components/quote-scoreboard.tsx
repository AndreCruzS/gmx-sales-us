"use client";

// THE QUOTE SCOREBOARD — the Reps board's executive summary (João,
// 2026-11-17). He showed the slides of another GMX department and asked for
// that reading built from the platform's own use: what closed, what is out,
// how often a price turns into a sale, how much work stands behind it, the
// curve, the biggest wins. The open quotes themselves are the "Out for quote"
// list further down the page, so they are not drawn twice.
//
// Every figure is read off the quotes the reps record. Before the first one
// is priced the tiles say so in words, never with a row of zeros.

import Link from "next/link";
import { useState } from "react";
import type { QuoteSummary, WeekPoint } from "@/lib/domain/quote-summary";
import { displayAccountName, formatMoney } from "@/lib/format";

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export interface WinDetail {
  name: string;
  account: string | null;
  product: string | null;
  quantity: number | null;
  unit: string | null;
  rep: string | null;
}

function compactMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return formatMoney(Math.round(v));
}

export function QuoteScoreboard({
  summary,
  details,
  who,
  span,
}: {
  summary: QuoteSummary;
  details: ReadonlyMap<string, WinDetail>;
  /** The rep being read, or null for the team. */
  who: string | null;
  span: string;
}) {
  const s = summary;
  const none = s.quotesSent === 0;
  const since = s.curve[0]?.week;

  const tiles: { label: string; value: string; hint: string }[] = [
    {
      label: "Closed revenue",
      value: s.wonCount > 0 ? compactMoney(s.closed) : "—",
      hint:
        s.wonCount > 0
          ? `${QTY.format(s.wonCount)} ${s.wonCount === 1 ? "sale" : "sales"} won`
          : "no quote won yet",
    },
    {
      label: "Active pipeline",
      value: s.openCount > 0 ? compactMoney(s.pipeline) : "—",
      hint:
        s.openCount > 0
          ? `${QTY.format(s.openCount)} ${s.openCount === 1 ? "quote" : "quotes"} waiting on an answer`
          : "no price waiting on an answer",
    },
    {
      label: "Win rate",
      value: s.winRate !== null ? `${Math.round(s.winRate * 100)}%` : "—",
      hint:
        s.winRate !== null
          ? `${QTY.format(s.wonCount)} won of ${QTY.format(s.decided)} decided`
          : "no quote has been won or lost yet",
    },
    // "Accounts worked" moved to the effort layer above (Bianca's spec,
    // 2026-11-24): it is work at the dealer, counted by period, not a figure
    // that waits for the first quote.
    {
      label: "Quotes sent",
      value: none ? "—" : QTY.format(s.quotesSent),
      hint: none ? "nothing priced yet" : "deals that reached a price",
    },
    {
      label: "Average ticket",
      value: s.avgTicket !== null ? compactMoney(s.avgTicket) : "—",
      hint: s.avgTicket !== null ? "closed revenue per sale" : "needs a won quote",
    },
  ];

  return (
    <section
      className="adapt card qs-board"
      data-desk="scoreboard"
      data-span={span}
      key={`qs-${who ?? "all"}`}
    >
      <div className="quiet-head">
        <span className="t-title">Quotes on the platform</span>
        <span className="t-hint">
          {none
            ? "read from the quotes the reps record"
            : `since ${since ? SHORT.format(new Date(`${since}T00:00:00Z`)) : "the first quote"}${who ? ` · ${who}` : " · the team"}`}
        </span>
      </div>

      <div className="qs-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="qs-tile">
            <div className="t-meta uppercase tracking-wide">{t.label}</div>
            <div className="fig fig-xl mt-1">{t.value}</div>
            <div className="t-hint mt-0.5">{t.hint}</div>
          </div>
        ))}
      </div>

      {none ? (
        <p className="t-sub mt-3" style={{ maxWidth: "70ch" }}>
          No quote has been priced on the platform yet{who ? ` by ${who}` : ""}.
          Every figure here comes from the quotes the reps record: open an
          account and start a deal, and the curve and the biggest wins appear
          the moment it is priced.{" "}
          <Link href="/quotes" className="t-action">
            Quotes
          </Link>
        </p>
      ) : (
        <div className="qs-lower">
          <div className="qs-curve-wrap">
            <div className="t-meta uppercase tracking-wide">Revenue curve</div>
            <RevenueCurve points={s.curve} />
          </div>
          <div className="qs-wins">
            <div className="t-meta uppercase tracking-wide">Biggest wins</div>
            {s.topWins.length === 0 ? (
              <p className="t-sub mt-2">No quote won yet.</p>
            ) : (
              <ol className="qs-win-list">
                {s.topWins.map((w) => {
                  const d = details.get(w.id);
                  const qty =
                    d?.quantity && d.quantity > 0
                      ? `${QTY.format(d.quantity)} ${d.unit ?? ""}`.trim()
                      : null;
                  return (
                    <li key={w.id} className="qs-win">
                      <span className="fig fig-lg">{compactMoney(w.value)}</span>
                      <span className="t-title">
                        {d?.account ? displayAccountName(d.account) : (d?.name ?? "Deal")}
                      </span>
                      <span className="t-hint">
                        {[d?.product, qty].filter(Boolean).join(" · ") || d?.name}
                        {who === null && d?.rep ? ` · ${d.rep}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── The curve: won value, cumulative, one point a week ───────────────────────
// One series, so no legend — the heading names it. A recessive grid, a 2px
// line over a soft fill, and a hover column per week that names the week and
// the total so far.
function RevenueCurve({ points }: { points: readonly WeekPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.total), 1);
  const top = niceTop(max);
  const n = points.length;
  const x = (i: number) => (n === 1 ? 50 : (i * 100) / (n - 1));
  const y = (v: number) => 100 - (v * 100) / top;
  const line = points.map((p, i) => `${x(i)},${y(p.total)}`).join(" ");
  const area = `0,100 ${line} ${x(n - 1)},100`;
  const ticks = [0, 0.5, 1].map((f) => top * f);
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const h = hover !== null ? points[hover] : null;

  return (
    <div className="qs-curve">
      <div className="qs-yaxis" aria-hidden="true">
        {[...ticks].reverse().map((t) => (
          <span key={t}>{compactMoney(t)}</span>
        ))}
      </div>
      <div className="qs-plot">
        {ticks.map((t) => (
          <span key={t} className="qs-grid" style={{ top: `${y(t)}%` }} />
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="qs-svg" aria-hidden="true">
          <polygon points={area} className="qs-area" />
          <polyline points={line} className="qs-line" vectorEffect="non-scaling-stroke" />
        </svg>
        {h && hover !== null && (
          <>
            <span className="qs-cross" style={{ left: `${x(hover)}%` }} />
            <span
              className="qs-dot"
              style={{ left: `${x(hover)}%`, top: `${y(h.total)}%` }}
            />
            <span
              className="qs-tip"
              style={{
                left: `${x(hover)}%`,
                transform: `translateX(${x(hover) > 70 ? "-100%" : x(hover) < 30 ? "0" : "-50%"})`,
              }}
            >
              <span className="t-hint">Week of {SHORT.format(new Date(`${h.week}T00:00:00Z`))}</span>
              <span className="fig fig-md">{formatMoney(Math.round(h.total))}</span>
            </span>
          </>
        )}
        <div className="qs-hits" onMouseLeave={() => setHover(null)}>
          {points.map((p, i) => (
            <span
              key={p.week}
              className="qs-hit"
              onMouseEnter={() => setHover(i)}
              onClick={() => setHover(i)}
            />
          ))}
        </div>
      </div>
      <div className="qs-xaxis" aria-hidden="true">
        {/* Every `labelEvery` weeks plus the last; a regular label too close
            to the last one gives way, and every other one is "minor" — the
            phone hides those so the dates never touch. */}
        {points.map((p, i) =>
          i === n - 1 || (i % labelEvery === 0 && n - 1 - i >= labelEvery) ? (
            <span
              key={p.week}
              className={i !== n - 1 && i !== 0 && (i / labelEvery) % 2 === 1 ? "qs-minor" : undefined}
              style={{
                left: `${x(i)}%`,
                transform: `translateX(${i === 0 && n > 1 ? "0" : i === n - 1 && n > 1 ? "-100%" : "-50%"})`,
              }}
            >
              {SHORT.format(new Date(`${p.week}T00:00:00Z`))}
            </span>
          ) : null,
        )}
      </div>
      {/* The table view: the same numbers, for a screen reader. */}
      <table className="sr-only">
        <caption>Closed revenue, cumulative, by week</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.week}>
              <th scope="row">{p.week}</th>
              <td>{formatMoney(Math.round(p.total))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function niceTop(v: number): number {
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= v) return m * mag;
  return 10 * mag;
}
