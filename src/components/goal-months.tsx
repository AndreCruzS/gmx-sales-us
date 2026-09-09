"use client";

// Month against goal — the trend, drawn only from what is on file.
//
// One column per month from the first return to the last; the goal is a line
// across all of them. A month with no file is a HOLE with the words "no file"
// where a bar would be — a missing return is unknown, not zero, and a chart
// that dipped to nothing would say the market died. Over the bar tops runs
// a line, so the eye reads rising or falling without comparing heights
// (Andre, 2026-09-09) — it BREAKS at a hole rather than bridging it, because
// a bridge would draw a month nobody reported.
//
// Two rows, one scale: the bar area holds the bars, the goal line and the
// trend, so a percent means the same height for all three; the feet below
// carry month and LF and share the columns' sizing so they line up without
// measuring anything. The area is a grid of equal columns, which is what
// lets the trend's x coordinates be computed rather than measured.

import { goalPct, periodShort, type GoalMonth } from "@/lib/domain/sell-through";

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function GoalMonths({
  months,
  goal,
  unit,
  /** The month the page is reading — drawn stronger than the rest. */
  picked,
  /** "default" whispered beside the goal when nobody has set one. */
  goalIsDefault,
}: {
  months: readonly GoalMonth[];
  goal: number;
  unit: string;
  picked: string | null;
  goalIsDefault: boolean;
}) {
  if (months.length === 0 || goal <= 0) return null;
  // The tallest thing on the chart sets the scale — the goal, or a month that
  // beat it — with a quarter of headroom so the goal's label has a place to
  // sit and a bar over the goal still shows its percent.
  const top = Math.max(goal, ...months.map((m) => m.lf ?? 0)) * 1.25;
  const goalY = (100 * goal) / top;
  const n = months.length;
  // The trend: one point per month with a file, at the bar's centre and top,
  // in a 100×100 space stretched over the area. Runs of consecutive files
  // become separate polylines, so a hole is a gap in the line.
  const runs: string[][] = [];
  months.forEach((m, i) => {
    if (m.lf === null) {
      if (runs.length === 0 || runs[runs.length - 1].length > 0) runs.push([]);
      return;
    }
    if (runs.length === 0) runs.push([]);
    runs[runs.length - 1].push(`${((i + 0.5) * 100) / n},${100 - (100 * m.lf) / top}`);
  });
  const points = months
    .map((m, i) =>
      m.lf === null ? null : { x: ((i + 0.5) * 100) / n, y: 100 - (100 * m.lf) / top },
    )
    .filter((p): p is { x: number; y: number } => p !== null);
  return (
    <div
      className="gm"
      role="img"
      aria-label={`${unit} by month against the ${QTY.format(goal)} ${unit} goal`}
    >
      <div className="gm-area" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        <span className="gm-goal" style={{ bottom: `${goalY}%` }} aria-hidden="true">
          <span className="gm-goal-label">
            goal {QTY.format(goal)} {unit}
            {goalIsDefault ? " (default)" : ""}
          </span>
        </span>
        {months.map((m) => {
          const h = m.lf === null ? 0 : (100 * m.lf) / top;
          const met = m.lf !== null && m.lf >= goal;
          return (
            <div
              key={m.period}
              className="gm-col"
              data-picked={picked === m.period ? true : undefined}
              data-hole={m.lf === null ? true : undefined}
            >
              <span className="gm-val">
                {m.lf === null ? "no file" : `${goalPct(m.lf, goal)}%`}
              </span>
              <span
                className={`gm-bar${met ? " is-met" : ""}`}
                style={{ height: `${Math.max(h, m.lf === null ? 0 : 1)}%` }}
              />
            </div>
          );
        })}
        {points.length >= 2 && (
          <svg
            className="gm-trend"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {runs
              .filter((r) => r.length >= 2)
              .map((r, i) => (
                <polyline key={i} points={r.join(" ")} />
              ))}
          </svg>
        )}
        {points.length >= 2 &&
          points.map((p, i) => (
            <span
              key={i}
              className="gm-dot"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              aria-hidden="true"
            />
          ))}
      </div>
      <div className="gm-feet" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {months.map((m) => (
          <div
            key={m.period}
            className="gm-foot"
            data-picked={picked === m.period ? true : undefined}
          >
            <span className="gm-month">{periodShort(m.period)}</span>
            <span className="gm-lf">
              {m.lf === null ? "—" : `${QTY.format(Math.round(m.lf))} ${unit}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
