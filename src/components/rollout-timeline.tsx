"use client";

// Bianca's rollout tracker, drawn as the journey it is.
//
// The spreadsheet is a row per branch and a column per gate: PK class,
// merchandiser, display wall, material in stock. Four things that have to be
// true before a dealer can actually sell, and the tracker exists because they
// usually are not.
//
// Drawn as a TIMELINE because that is how the business talks about it — a
// branch moves along it — but NOT as a funnel, and the difference matters. A
// funnel says each stage is a subset of the one before. This one is not: the
// real tracker has walls standing in branches with no merchandiser behind
// them, and material sitting in branches that never had the class. A funnel
// would report those branches as further along than they are and hide the very
// gap the book exists to show. So each gate carries its own count against the
// same total, and the rail says "next", not "therefore".

import { PIPELINE_GATES, type RolloutCounts } from "@/lib/domain/rollout";

export function RolloutTimeline({
  counts,
  heading = "Getting dealers selling",
}: {
  counts: RolloutCounts;
  heading?: string;
}) {
  const total = counts.branches ?? 0;
  if (total === 0) return null;

  const gates = PIPELINE_GATES.map((g) => ({
    ...g,
    done: counts[g.key] ?? 0,
  }));

  return (
    <section>
      <div className="section-head">
        <h2 className="t-section">{heading}</h2>
        <span className="t-meta">
          {total} {total === 1 ? "branch" : "branches"}
        </span>
      </div>

      <ol className="spine">
        {gates.map((g, i) => {
          const pct = total === 0 ? 0 : Math.round((100 * g.done) / total);
          // The RAIL is a connector, not a state. Colouring it by progress
          // would say each gate follows from the one above, and they do not —
          // that is the whole reason this is not a funnel. Clay in particular
          // means slipping in this language, and a gate at 1 of 7 is not
          // slipping, it is early.
          //
          // The NODE carries the state, because it belongs to the gate itself:
          // filled when every branch is through, hollow when none is, and a
          // ring while it is being worked.
          const nodeState = g.done >= total ? "is-done" : g.done === 0 ? "is-future" : "";
          return (
            <li key={g.key} className="spine-item">
              <div className="spine-rail" aria-hidden="true">
                <div className={`spine-seg ${i === 0 ? "is-off" : "is-future"}`} />
                <div className={`spine-node ${nodeState}`} />
                <div
                  className={`spine-seg ${i === gates.length - 1 ? "is-off" : "is-future"}`}
                />
              </div>
              <div className="spine-body">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="t-title">{g.label}</span>
                  <span className="t-meta tabular-nums">
                    {g.done}/{total}
                  </span>
                </div>
                <div
                  className="mt-1.5 flex h-2 overflow-hidden rounded"
                  style={{ background: "var(--rule)" }}
                  role="img"
                  aria-label={`${g.done} of ${total} branches: ${g.label}`}
                >
                  <span
                    style={{
                      width: `${pct}%`,
                      background: "var(--accent)",
                    }}
                  />
                </div>
                <p className="t-sub mt-1">{g.hint}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="t-sub px-1">
        <b style={{ color: "var(--ink-primary)" }}>{counts.fully_through ?? 0}</b>{" "}
        through all four
        {(counts.not_started ?? 0) > 0
          ? `, ${counts.not_started} not started`
          : ""}
        . A branch can clear a later gate with an earlier one still open — that
        gap is the queue.
      </p>
    </section>
  );
}
