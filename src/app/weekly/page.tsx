"use client";

// Weekly commercial review (spec §16). The rep does NOT write a report — the
// system already holds the information; the AI narrates what was captured, and
// the underlying rows stay visible beneath so the narrative can be checked
// against the record rather than trusted blindly.

import { useCallback, useEffect, useState } from "react";
import { useOffline } from "@/components/offline-provider";
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
        <hr key={i} className="my-3 border-black/10 dark:border-white/10" />
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Weekly review</h1>
        <button
          onClick={generate}
          disabled={busy}
          className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          {busy ? "Writing…" : narrative ? "Regenerate" : "Generate"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {note && <p className="text-sm opacity-60">{note}</p>}

      {narrative && (
        <section className="rounded-xl border border-black/10 p-4 dark:border-white/15">
          {renderNarrative(narrative)}
          <p className="mt-4 border-t border-black/5 pt-2 text-xs opacity-50 dark:border-white/10">
            Drafted from your recorded activity — check it against the detail
            below before sending it on.
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">
          Last 7 days ({activities.length})
        </h2>
        {activities.length === 0 ? (
          <p className="text-sm opacity-60">Nothing recorded in the last week.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activities.map((a, i) => (
              <li
                key={i}
                className="rounded-xl border border-black/10 px-4 py-3 text-sm dark:border-white/15"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{a.account_name}</span>
                  <span className="shrink-0 text-xs opacity-60">
                    {new Date(a.occurred_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-0.5 text-xs opacity-60">
                  {a.activity_type.replaceAll("_", " ")}
                  {a.was_planned ? " · planned" : " · unplanned"}
                </div>
                {a.what_happened && (
                  <p className="mt-1 opacity-80">{a.what_happened}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">
          Coming up ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm opacity-60">
            Nothing scheduled — next week needs planning by Friday.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((u) => (
              <li
                key={u.next_action_id}
                className="rounded-xl border border-black/10 px-4 py-3 text-sm dark:border-white/15"
              >
                <div className="font-medium">{u.action}</div>
                <div className="mt-0.5 flex flex-wrap gap-2 text-xs opacity-60">
                  {u.account_name && <span>{u.account_name}</span>}
                  <span>{u.due_date}</span>
                  {u.objective && (
                    <span className="rounded-full bg-amber-500/15 px-2 font-medium text-amber-700 dark:text-amber-400">
                      {u.objective.replaceAll("_", " ")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
