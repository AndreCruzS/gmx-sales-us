"use client";

// "YOUR ACTION ITEMS" on the rep's Home (spec 2026-11-10, option B): four
// boxes — Do now · Plan · No priority · Scheduled — counting everything open
// the rep owns, red where something is late, and one line when someone else
// gave the rep work since My work was last opened. Each box opens My work on
// its chip. Read from the device cache like the rest of the Home, so the
// numbers are there with no signal. A box at 0 stays, greyed and tappable:
// the block keeps its shape.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { getOfflineLayer, type CachedAgendaItem } from "@/lib/offline";
import { givesWorkToOthers } from "@/lib/domain/roles";
import {
  BOXES,
  BOX_LABEL,
  BOX_PARAM,
  countBoxes,
  givers,
  shortDate,
  type Box,
  type BoxCount,
} from "@/lib/domain/my-work";

/** Where My work keeps the moment it was last opened (per device). */
export const SEEN_AT_KEY = "action_items_seen_at";

const BOX_CLASS: Record<Box, string> = {
  DO_NOW: "do",
  PLAN: "plan",
  NONE: "none",
  SCHEDULED: "sched",
};

function SubLine({ box, c }: { box: Box; c: BoxCount }) {
  if (c.n === 0) return null;
  if (box !== "NONE" && c.late > 0) {
    return (
      <span className="ai-late">
        <span className="ai-fig">{c.late}</span> {box === "SCHEDULED" ? "overdue" : "late"}
      </span>
    );
  }
  if (box === "NONE") return <>classify them</>;
  if (box === "DO_NOW" && c.soon > 0) return (
      <>
        <span className="ai-fig">{c.soon}</span> due <span className="ai-fig">≤ 2d</span>
      </>
    );
  return c.next ? <>next <span className="ai-fig">{shortDate(c.next)}</span></> : null;
}

/** "**Bianca** gave you 2 items" / "**Bianca** and 1 other gave you 3 items". */
export function GaveYou({ names, n }: { names: string[]; n: number }) {
  const others = names.length - 1;
  return (
    <>
      <b>{names[0]}</b>
      {others > 0 ? ` and ${others} ${others === 1 ? "other" : "others"}` : ""} gave you{" "}
      <span className="ai-fig">{n}</span> {n === 1 ? "item" : "items"}
    </>
  );
}

export function YourActionItems({
  agenda,
  today,
}: {
  agenda: CachedAgendaItem[];
  /** The device's local date (localIsoDate). */
  today: string;
}) {
  const { profile } = useOffline();
  const me = profile?.membershipId ?? "";
  const gives = givesWorkToOthers(profile?.role);
  // The moment My work was last opened, and the clock, read once on mount —
  // never during render.
  const [seen, setSeen] = useState<{ at: string | null; now: string } | null>(null);

  useEffect(() => {
    let stale = false;
    void getOfflineLayer()
      .local.getMeta(SEEN_AT_KEY)
      .then((at) => {
        if (!stale) setSeen({ at, now: new Date().toISOString() });
      });
    return () => {
      stale = true;
    };
  }, []);

  const counts = useMemo(
    () => (me && today ? countBoxes(agenda, me, today, gives) : null),
    [agenda, me, today, gives],
  );
  const gave = useMemo(
    () => (me && seen ? givers(agenda, me, seen.at, seen.now) : null),
    [agenda, me, seen],
  );

  if (!counts) return null;

  return (
    <section className="card ai-block" aria-label="Your action items">
      <div className="ai-head">
        <h2 className="t-section">Your action items</h2>
        <Link href="/my-work" className="t-action">
          See all →
        </Link>
      </div>
      {gave && gave.n > 0 && (
        <Link href="/my-work?f=new" className="ai-from">
          <span>
            <GaveYou names={gave.names} n={gave.n} />
          </span>
          <span aria-hidden="true">›</span>
        </Link>
      )}
      <div className="ai-grid">
        {BOXES.map((box) => {
          const c = counts[box];
          return (
            <Link
              key={box}
              href={`/my-work?f=${BOX_PARAM[box]}`}
              className="ai-box"
              data-box={BOX_CLASS[box]}
              data-empty={c.n === 0 || undefined}
            >
              <span className="ai-lbl">{BOX_LABEL[box]}</span>
              <span className="ai-n">{c.n}</span>
              <span className="ai-sub">
                <SubLine box={box} c={c} />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
