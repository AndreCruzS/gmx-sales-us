"use client";

// The desk's agenda IS a calendar (Andre, 2026-09-01). The phone answers
// "what's next?" — a list in the order the day asks. The desk answers
// "how does the month look?" — and that question has had one shape for a
// thousand years: a month of days on a wall.
//
// This component owns its own reading: the phone's list deliberately loads
// only OPEN visits a fortnight out, but a month on the wall wants the whole
// month — done visits included, greyed with their tick, because a manager
// reading the month wants to see work that happened, not only work that
// hasn't. RLS scopes the rows manager-down, so the desk sees the team's
// month, not their own.
//
// Clicking a day opens it under the grid with the same row idiom the list
// uses — account link, objective tag, Done riding the LWW-guarded outbox.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckIcon } from "@/components/icons";
import { humanize } from "@/lib/domain/enums";
import { getOfflineLayer } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface CalRow {
  id: string;
  action: string;
  due_date: string;
  completed_at: string | null;
  account_id: string | null;
  objective: string | null;
  owner_id: string | null;
  updated_at: string;
  accountName?: string;
}

// Eight categorical hues — the same palette the desk's map and bars speak.
// The hue is REINFORCEMENT, not the message: the initials carry the name
// (Andre, 2026-09-02 — "assim eu reconheço sem precisar decorar cores").
const REP_HUES = 8;

/** "Jason Benford" → "JB"; a single name keeps its first two letters. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length >= 2
    ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});
const DAY_LONG = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function AgendaCalendar({
  bump,
  onError,
}: {
  /** Increment to force a reload — the parent bumps it when a visit lands. */
  bump: number;
  onError: (message: string) => void;
}) {
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  });
  const [rows, setRows] = useState<CalRow[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  // The admin's wall is EVERYBODY's month (Andre, 2026-09-02): each visit
  // wears its rep's colour, and the rep rail above the grid filters by
  // FADING the rest — the chosen rep keeps full clarity, the others recede
  // but stay legible, because a manager filtering still reads the month.
  const [repNames, setRepNames] = useState<Map<string, string>>(new Map());
  const [repFilter, setRepFilter] = useState<string | null>(null);
  const today = iso(new Date());

  const monthStart = iso(anchor);
  const monthEnd = iso(
    new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)),
  );

  const load = useCallback(async () => {
    try {
      const supabase = getSupabaseBrowserClient();
      const [na, sc] = await Promise.all([
        supabase
          .from("next_actions")
          .select(
            "id, action, due_date, completed_at, account_id, objective, kind, owner_id, updated_at, accounts(name)",
          )
          .gte("due_date", monthStart)
          .lte("due_date", monthEnd)
          .or("kind.eq.VISIT,kind.is.null")
          .order("due_date"),
        // Who each row belongs to, by name — memberships rather than the rep
        // scorecard, because the wall is EVERYBODY's: an admin who plans a
        // visit is on it too, and the scorecard view doesn't know admins.
        supabase
          .from("memberships")
          .select("id, users(full_name)")
          .eq("status", "active"),
      ]);
      if (na.error) throw new Error(na.error.message);
      setRows(
        (
          na.data as unknown as (CalRow & {
            accounts: { name: string } | null;
          })[]
        ).map((r) => ({ ...r, accountName: r.accounts?.name })),
      );
      if (!sc.error && sc.data) {
        setRepNames(
          new Map(
            (
              sc.data as unknown as {
                id: string;
                users: { full_name: string | null } | null;
              }[]
            ).map((r) => [r.id, r.users?.full_name ?? "—"]),
          ),
        );
      }
    } catch {
      // offline: the desk calendar reads the server; the phone's list is the
      // offline answer, and it still works
    }
  }, [monthStart, monthEnd]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, bump]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalRow[]>();
    for (const r of rows) {
      const list = map.get(r.due_date);
      if (list) list.push(r);
      else map.set(r.due_date, [r]);
    }
    return map;
  }, [rows]);

  // The month's cells: leading and trailing paper so the weeks stay whole.
  const cells = useMemo(() => {
    const first = anchor.getUTCDay();
    const daysInMonth = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const out: { date: string | null; day: number | null }[] = [];
    for (let i = 0; i < first; i++) out.push({ date: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({
        date: iso(
          new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), d)),
        ),
        day: d,
      });
    }
    while (out.length % 7 !== 0) out.push({ date: null, day: null });
    return out;
  }, [anchor]);

  function move(months: number) {
    setPicked(null);
    setAnchor(
      (a) => new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + months, 1)),
    );
  }

  async function markDone(item: CalRow) {
    try {
      const layer = getOfflineLayer();
      await layer.sync.enqueue({
        clientId: item.id,
        entityType: "next_action",
        op: "update",
        payload: { id: item.id, completed_at: new Date().toISOString() },
        baseVersion: item.updated_at, // D61: stale completion → Review
        blobRef: null,
      });
      setRows((prev) =>
        prev.map((r) =>
          r.id === item.id
            ? { ...r, completed_at: new Date().toISOString() }
            : r,
        ),
      );
      void layer.sync.drain();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  const pickedRows = picked ? (byDay.get(picked) ?? []) : [];

  // The reps ON THIS MONTH's wall, in a stable name order so a rep keeps
  // their colour from month to month as long as the roster holds. Colour by
  // roster position (not month position): Deonn is --cat-2 in August AND in
  // September, whether or not Anthony planned anything.
  const reps = useMemo(() => {
    const roster = [...repNames.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const hueOf = new Map(
      roster.map((r, i) => [r.id, `var(--cat-${(i % REP_HUES) + 1})`]),
    );
    const present = new Set(rows.map((r) => r.owner_id));
    return {
      hueOf,
      // The rail lists only reps with something on this month's wall — a
      // filter for someone with nothing to show would fade everything.
      rail: roster.filter((r) => present.has(r.id)),
    };
  }, [repNames, rows]);

  const dimmed = (ownerId: string | null) =>
    repFilter !== null && ownerId !== repFilter;

  return (
    <div className="agcal">
      <div className="agcal-head">
        <h2 className="t-section">{MONTH.format(anchor)}</h2>
        <div className="agcal-nav">
          <button
            type="button"
            className="btn-quiet"
            aria-label="Previous month"
            onClick={() => move(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              setPicked(null);
              const now = new Date();
              setAnchor(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)));
            }}
          >
            Today
          </button>
          <button
            type="button"
            className="btn-quiet"
            aria-label="Next month"
            onClick={() => move(1)}
          >
            ›
          </button>
        </div>
      </div>

      {/* The rep rail: legend and filter in one. Clicking a rep fades
          everyone else's visits to a murmur — clicking again, or the rep
          with the floor, gives the room back. */}
      {reps.rail.length > 1 && (
        <div className="agcal-reps" role="group" aria-label="Filter by rep">
          {reps.rail.map((r) => (
            <button
              key={r.id}
              type="button"
              className="agcal-rep"
              aria-pressed={repFilter === r.id}
              data-dim={dimmed(r.id) || undefined}
              onClick={() =>
                setRepFilter((f) => (f === r.id ? null : r.id))
              }
            >
              <i
                className="agcal-ini"
                style={{ "--rep-hue": reps.hueOf.get(r.id) } as React.CSSProperties}
                aria-hidden="true"
              >
                {initialsOf(r.name)}
              </i>
              {r.name}
            </button>
          ))}
        </div>
      )}

      <div className="agcal-grid card">
        {WEEKDAYS.map((w) => (
          <span key={w} className="agcal-wd">
            {w}
          </span>
        ))}
        {cells.map((c, i) =>
          c.date === null ? (
            <span key={`pad-${i}`} className="agcal-cell agcal-pad" />
          ) : (
            <button
              key={c.date}
              type="button"
              className="agcal-cell"
              data-today={c.date === today || undefined}
              aria-pressed={picked === c.date}
              onClick={() =>
                setPicked((p) => (p === c.date ? null : c.date))
              }
            >
              <span className="agcal-day fig-sm">{c.day}</span>
              <span className="agcal-items">
                {(byDay.get(c.date) ?? []).slice(0, 3).map((r) => (
                  <span
                    key={r.id}
                    className="agcal-chip"
                    data-dim={dimmed(r.owner_id) || undefined}
                    data-state={
                      r.completed_at
                        ? "done"
                        : c.date! < today
                          ? "overdue"
                          : "open"
                    }
                  >
                    {r.owner_id && repNames.has(r.owner_id) && (
                      <i
                        className="agcal-ini"
                        style={
                          {
                            "--rep-hue": reps.hueOf.get(r.owner_id),
                          } as React.CSSProperties
                        }
                        title={repNames.get(r.owner_id)}
                      >
                        {initialsOf(repNames.get(r.owner_id)!)}
                      </i>
                    )}
                    {r.accountName ?? r.action}
                  </span>
                ))}
                {(byDay.get(c.date)?.length ?? 0) > 3 && (
                  <span className="agcal-more">
                    +{(byDay.get(c.date)?.length ?? 0) - 3}
                  </span>
                )}
              </span>
            </button>
          ),
        )}
      </div>

      {picked && (
        <section className="agcal-day-panel">
          <div className="section-head">
            <h3 className="t-section">
              {DAY_LONG.format(new Date(`${picked}T00:00:00`))}
            </h3>
            <span className="t-meta">{pickedRows.length}</span>
          </div>
          {pickedRows.length === 0 ? (
            <p className="t-sub">Nothing planned this day.</p>
          ) : (
            <ul className="list">
              {pickedRows.map((r) => (
                <li key={r.id} className="row" data-dim={dimmed(r.owner_id) || undefined}>
                  {r.account_id ? (
                    <Link
                      href={`/accounts/${r.account_id}`}
                      className="row-body min-w-0"
                    >
                      <span className="t-title block truncate">{r.action}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        {r.owner_id && repNames.has(r.owner_id) && (
                          <span className="flex items-center gap-1 t-sub">
                            <i
                              className="agcal-ini"
                              style={
                                {
                                  "--rep-hue": reps.hueOf.get(r.owner_id),
                                } as React.CSSProperties
                              }
                              aria-hidden="true"
                            >
                              {initialsOf(repNames.get(r.owner_id)!)}
                            </i>
                            {repNames.get(r.owner_id)}
                          </span>
                        )}
                        {r.accountName && (
                          <span className="t-sub">{r.accountName}</span>
                        )}
                        {r.objective && (
                          <span className="tag tag-accent">
                            {humanize(r.objective)}
                          </span>
                        )}
                      </span>
                    </Link>
                  ) : (
                    <span className="row-body min-w-0">
                      <span className="t-title block truncate">{r.action}</span>
                      {r.objective && (
                        <span className="tag tag-accent mt-1">
                          {humanize(r.objective)}
                        </span>
                      )}
                    </span>
                  )}
                  {r.completed_at ? (
                    <span className="tag tag-accent shrink-0">done</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void markDone(r)}
                      className="btn-quiet flex shrink-0 items-center gap-1.5"
                    >
                      <CheckIcon size={14} />
                      Done
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
