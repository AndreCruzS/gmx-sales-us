"use client";

// THE WORK ON THE RECORD — the effort layer atop the Reps board (Bianca's
// spec, 2026-11-24). The board measures what the rep does at the dealer;
// the quote scoreboard under it is the result. Before anything is recorded
// the tiles say so in words, never with a row of zeros.

import Link from "next/link";
import { displayAccountName, formatDay } from "@/lib/format";
import {
  QUIET_MIN_TOUCHES,
  QUIET_WINDOW_DAYS,
  WORK_PERIODS,
  type Keeping,
  type QuietDealer,
  type WorkPeriod,
} from "@/lib/domain/rep-work";

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function RepWorkBoard({
  period,
  onPeriod,
  worked,
  dealerCount,
  keeping,
  quiet,
  quietNote,
  who,
  span,
}: {
  period: WorkPeriod;
  onPeriod: (p: WorkPeriod) => void;
  /** Metric 1: dealers with work on the record in the period. */
  worked: number;
  /** Dealers in the scope (the rep's patch, or the book). */
  dealerCount: number;
  /** Metric 3. */
  keeping: Keeping;
  /** The alert: worked, not selling. Null when no distributor return is on file. */
  quiet: QuietDealer[] | null;
  /** Why some dealers cannot be judged (a house sending no dealer detail), or the months read. */
  quietNote: string | null;
  who: string | null;
  span: string;
}) {
  const label = WORK_PERIODS.find(([p]) => p === period)?.[1].toLowerCase() ?? "";
  const k = keeping;

  return (
    <section className="adapt card qs-board rw-board" data-desk="work" data-span={span} key={`rw-${who ?? "all"}`}>
      <div className="quiet-head rw-head">
        <span className="t-title">The work at the dealers</span>
        <div className="chip-row" role="group" aria-label="Period">
          {WORK_PERIODS.map(([p, name]) => (
            <button key={p} type="button" className="chip" aria-pressed={p === period} onClick={() => onPeriod(p)}>
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="qs-tiles rw-tiles">
        <div className="qs-tile">
          <div className="t-meta uppercase tracking-wide">Accounts worked</div>
          <div className="fig fig-xl mt-1">{QTY.format(worked)}</div>
          <div className="t-hint mt-0.5">
            {worked === 0
              ? `no work on the record ${label} yet`
              : `of ${QTY.format(dealerCount)} dealers${who ? ` on ${who}’s patch` : ""} · a visit, call, PK, note, quote or kept follow-up, ${label}`}
          </div>
        </div>
        <div className="qs-tile">
          <div className="t-meta uppercase tracking-wide">Follow-ups kept</div>
          <div className="fig fig-xl mt-1">{k.rate !== null ? `${Math.round(k.rate * 100)}%` : "—"}</div>
          <div className="t-hint mt-0.5">
            {k.rate !== null
              ? `${QTY.format(k.onTime)} of ${QTY.format(k.due)} done by their date, ${label}`
              : `no follow-up came due ${label}`}
          </div>
        </div>
        <div className="qs-tile">
          <div className="t-meta uppercase tracking-wide">Late now</div>
          <div className="fig fig-xl mt-1">{QTY.format(k.lateNow)}</div>
          <div className="t-hint mt-0.5">
            {k.lateNow === 0 ? "every follow-up is on time" : "open follow-ups past their date"}
          </div>
        </div>
      </div>

      <div className="rw-quiet">
        <div className="t-meta uppercase tracking-wide">Working, not selling</div>
        <p className="t-hint mt-0.5" style={{ maxWidth: "70ch" }}>
          {`Dealers with ${QUIET_MIN_TOUCHES} or more touches in the last ${QUIET_WINDOW_DAYS} days and no LF from the distributor — not converting yet, or the order is not being passed on or reported.`}
          {quietNote ? ` ${quietNote}.` : ""}
        </p>
        {quiet === null ? (
          <p className="t-sub mt-2">No distributor return is on file yet, so there is nothing to hold the work against.</p>
        ) : quiet.length === 0 ? (
          <p className="t-sub mt-2">None right now{who ? ` on ${who}’s patch` : ""}.</p>
        ) : (
          <ul className="rw-list">
            {quiet.map((d) => (
              <li key={d.id} className="rw-row">
                <Link href={`/accounts/${d.id}`} className="t-title">
                  {displayAccountName(d.name)}
                </Link>
                <span className="t-hint">
                  {`${QTY.format(d.touches)} touches · last ${formatDay(d.last)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
