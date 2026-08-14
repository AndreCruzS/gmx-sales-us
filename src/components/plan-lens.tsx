"use client";

// The week, read three ways: by rep, by distributor, by dealer.
//
// This is the thing leadership marked up hardest — the lens chips relabelled,
// the bars split by distributor, a SEE MORE drawn on every row — and it belongs
// on a manager's HOME rather than a page they have to go and find. So it lives
// here, as one component, used by the landing and by the report. There is only
// one of it: a lens that showed different numbers in two places would be worse
// than having no lens at all.
//
// The bar is four states, not two. Collapsing "never happened" into "still to
// come" is the mistake worth avoiding — mileage is reimbursed, so a visit that
// was planned and never made is a cost as well as a gap, while one still ahead
// is neither.

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  groupFor,
  latestStartedWeek,
  type ChannelRow,
  type Lens,
} from "@/lib/domain/channel";

// Plurals, not "By rep / By distributor / By dealer": three chips in a row all
// starting with the same word is three chances to read the wrong one, and the
// group already says what the "by" is.
const LENSES: readonly (readonly [Lens, string])[] = [
  ["rep", "Reps"],
  ["distributor", "Distributors"],
  ["dealer", "Dealers"],
];

const LENS_NOUN: Record<Lens, string> = {
  rep: "rep",
  distributor: "distributor",
  dealer: "dealer",
};

const MONTH_DAY = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

/** The Monday a week began, as a date a manager can put against a calendar. */
function weekOf(iso: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : MONTH_DAY.format(d);
}

/** Where a row goes when it is tapped. A rep opens their own week; a
 *  distributor or a dealer is an account, and the account page already answers
 *  "who is this and what is happening there". */
function rowHref(lens: Lens, id: string): string {
  if (lens === "rep") return `/dashboard/rep/${id}`;
  return id === "none" || id === "several" || id === "unassigned"
    ? "/accounts"
    : `/accounts/${id}`;
}

export function PlanLens({
  rows,
  repName,
  repPatch,
  unplannedByRep,
  nowMs,
  heading = "Did they do what they said",
}: {
  rows: readonly ChannelRow[];
  repName: ReadonlyMap<string, string>;
  repPatch: ReadonlyMap<string, string>;
  /** Walk-ins are a rep's own number and only ride on the rep lens. */
  unplannedByRep?: ReadonlyMap<string, number>;
  /** Stamped when the data loaded — never read from the clock during render. */
  nowMs: number | null;
  heading?: string;
}) {
  const [lens, setLens] = useState<Lens>("rep");

  // The week comes from the rows themselves so the bars and the caption can
  // never disagree, and a week nobody has lived yet accuses people of nothing.
  const week = useMemo(
    () => (nowMs === null ? null : latestStartedWeek(rows, nowMs)),
    [rows, nowMs],
  );

  const groups = useMemo(() => {
    if (!week) return [];
    return groupFor(lens, rows.filter((r) => r.week_start === week), repName);
  }, [rows, week, lens, repName]);

  if (groups.length === 0) return null;

  return (
    <section>
      <div className="section-head">
        <h2 className="t-section">{heading}</h2>
        {/* An absolute date, not formatDay: that one is relative ("in 5 days"),
            which is right on a due date and nonsense after "week of". */}
        <span className="t-meta">{week ? `week of ${weekOf(week)}` : ""}</span>
      </div>

      <div className="chip-row mb-3" role="group" aria-label="Look at the week by">
        {LENSES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={lens === key}
            onClick={() => setLens(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="t-sub mb-1 px-1">
        Every bar is one {LENS_NOUN[lens]}&rsquo;s week. Mileage is reimbursed, so
        a visit that was planned and never happened is a cost as well as a gap.
      </p>

      <ul className="card card-pad">
        {groups.map((g) => {
          const unplanned =
            lens === "rep" ? (unplannedByRep?.get(g.id) ?? 0) : 0;
          // done already contains owed: the solid teal is the part that was
          // written up, and the clay beside it is the part that was not.
          const bar: readonly (readonly [string, number])[] = [
            ["is-done", g.done - g.owed],
            ["is-owed", g.owed],
            ["is-missed", g.missed],
            ["is-left", g.left],
          ];
          const note = g.missed
            ? `${g.missed} never happened`
            : g.owed
              ? `${g.owed} owes a note`
              : g.left
                ? `${g.left} still to come`
                : "all logged";
          return (
            <li key={g.id}>
              <Link href={rowHref(lens, g.id)} className="pva-row">
                <span>
                  <span className="pva-name">{g.label}</span>
                  <span className="pva-sub">
                    {lens === "rep"
                      ? (repPatch.get(g.id) ?? "—")
                      : `${g.segments.length} ${g.segments.length === 1 ? "door" : "doors"}`}
                  </span>
                </span>
                <span
                  className="pva-track"
                  role="img"
                  aria-label={`${g.done} of ${g.total} planned visits done; ${note}`}
                >
                  {bar.map(([cls, n]) =>
                    n > 0 ? (
                      <span key={cls} className={`pva-seg ${cls}`} style={{ flex: n }} />
                    ) : null,
                  )}
                </span>
                <span className="pva-fig">
                  {g.done}/{g.total}
                  <small>
                    {note}
                    {unplanned > 0 ? ` · ${unplanned} unplanned` : ""}
                  </small>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="pva-legend">
        <span>
          <i className="pva-seg is-done" />
          done and logged
        </span>
        <span>
          <i className="pva-seg is-owed" />
          done, owes a note
        </span>
        <span>
          <i className="pva-seg is-missed" />
          never happened
        </span>
        <span>
          <i className="pva-seg is-left" />
          still to come
        </span>
      </p>
    </section>
  );
}
