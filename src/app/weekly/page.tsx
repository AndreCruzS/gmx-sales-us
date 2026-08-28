"use client";

// Weekly commercial review (spec §16). The rep does NOT write a report — the
// system already holds the information; the AI narrates what was captured, and
// the underlying rows stay visible beneath so the narrative can be checked
// against the record rather than trusted blindly.

import { useCallback, useEffect, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { humanize } from "@/lib/domain/enums";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ActivityRow {
  occurred_at: string;
  activity_type: string;
  account_name: string;
  what_happened: string | null;
  was_planned: boolean;
}
interface UpcomingRow {
  next_action_id: string;
  action: string;
  due_date: string;
  account_name: string | null;
  objective: string | null;
}

// Inline **bold** → <strong>; everything else stays literal text.
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

function renderNarrative(text: string) {
  // The prompt fixes the heading set, so a minimal renderer is enough here;
  // the Figma polish pass will style this properly.
  return text.split("\n").map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    if (/^-{3,}$/.test(trimmed)) {
      return (
        <hr key={i} className="my-3" style={{ borderColor: "var(--rule)" }} />
      );
    }
    if (trimmed.startsWith("## ")) {
      return (
        <h3
          key={i}
          className="mt-4 text-sm font-semibold uppercase tracking-wide opacity-70"
        >
          {trimmed.slice(3)}
        </h3>
      );
    }
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      return (
        <li key={i} className="ml-4 list-disc text-sm">
          {inline(trimmed.slice(2))}
        </li>
      );
    }
    return (
      <p key={i} className="mt-2 text-sm">
        {inline(trimmed)}
      </p>
    );
  });
}

export default function WeeklyReviewPage() {
  const { profile } = useOffline();
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingRow[]>([]);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const [a, u] = await Promise.all([
      supabase
        .from("weekly_review_recent_activity")
        .select("occurred_at, activity_type, account_name, what_happened, was_planned")
        .gte("occurred_at", since.toISOString())
        .order("occurred_at", { ascending: false }),
      supabase
        .from("weekly_review_upcoming")
        .select("next_action_id, action, due_date, account_name, objective")
        .order("due_date"),
    ]);
    setActivities((a.data as ActivityRow[]) ?? []);
    setUpcoming((u.data as UpcomingRow[]) ?? []);
  }, []);

  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [profile, load]);

  async function generate() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/weekly-review", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setNarrative(body.narrative);
      setNote(body.note ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack pt-2">
      <section>
        <button onClick={generate} disabled={busy} className="btn-primary">
          {busy
            ? "Writing your week up…"
            : narrative
              ? "Write it again"
              : "Write my week up"}
        </button>
        {!narrative && !busy && (
          <p className="t-hint mt-2 px-1">
            You don&apos;t write a report — the week is already recorded. The
            system drafts it; you check it against the detail below.
          </p>
        )}
      </section>

      {error && (
        <p className="t-sub px-1" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {note && <p className="t-sub px-1">{note}</p>}

      {narrative && (
        <section className="card card-pad">
          {renderNarrative(narrative)}
          <p
            className="t-hint mt-4 pt-2"
            style={{ borderTop: "1px solid var(--rule)" }}
          >
            Drafted from your recorded activity — check it against the detail
            below before sending it on.
          </p>
        </section>
      )}

      <section>
        <div className="section-head">
          <h2 className="t-section">Last 7 days</h2>
          <span className="t-meta">{activities.length}</span>
        </div>
        {activities.length === 0 ? (
          <p className="t-sub px-1">Nothing recorded in the last week.</p>
        ) : (
          <ul className="list">
            {activities.map((a, i) => (
              <li key={i} className="row">
                <span className="row-lead flex-col leading-none">
                  <span className="text-[15px] font-bold">
                    {new Date(a.occurred_at).getDate()}
                  </span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">
                    {new Date(a.occurred_at).toLocaleString("en-US", {
                      month: "short",
                    })}
                  </span>
                </span>
                <span className="row-body">
                  <span className="flex items-center justify-between gap-2">
                    <span className="t-title truncate">{a.account_name}</span>
                    {a.was_planned && (
                      <span className="tag tag-accent shrink-0">planned</span>
                    )}
                  </span>
                  <span className="t-sub block">
                    {humanize(a.activity_type)}
                  </span>
                  {a.what_happened && (
                    <span className="t-sub line-clamp-2 block">
                      {a.what_happened}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2 className="t-section">Coming up</h2>
          <span className="t-meta">{upcoming.length}</span>
        </div>
        {upcoming.length === 0 ? (
          <p className="t-sub px-1">
            Nothing planned — next week should be on the plan by Friday.
          </p>
        ) : (
          <ul className="list">
            {upcoming.map((u) => (
              <li key={u.next_action_id} className="row">
                <span className="row-lead flex-col leading-none">
                  <span className="text-[15px] font-bold">
                    {Number(u.due_date.slice(8, 10))}
                  </span>
                  <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">
                    {new Date(`${u.due_date}T00:00:00`).toLocaleString(
                      "en-US",
                      { month: "short" },
                    )}
                  </span>
                </span>
                <span className="row-body">
                  <span className="t-title block truncate">{u.action}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    {u.account_name && (
                      <span className="t-sub">{u.account_name}</span>
                    )}
                    {u.objective && (
                      <span className="tag tag-accent">
                        {humanize(u.objective)}
                      </span>
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
