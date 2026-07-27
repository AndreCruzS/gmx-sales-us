// Weekly commercial review narrative (spec §16): "The sales representative
// should not need to write a separate report. The system already contains the
// underlying information."
//
// Pure derivation + AI narration: this route reads the derived views AS THE
// CALLER (their own session client, so RLS decides what feeds the narrative)
// and returns the narrative without storing it — Phase 5 writes no new state.

import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 120;

const NARRATIVE_MODEL =
  process.env.WEEKLY_REVIEW_MODEL ?? "anthropic/claude-sonnet-4.6";

export async function POST() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const since = weekStart.toISOString().slice(0, 10);

  // Every query below is RLS-scoped to the caller: a rep narrates their own
  // week, a manager their team's, an admin the org's.
  const [activity, upcoming, newObjects, pipeline, planned, exceptions] =
    await Promise.all([
      supabase
        .from("weekly_review_recent_activity")
        .select(
          "occurred_at, activity_type, account_name, what_happened, key_information, commercial_potential, outcomes, was_planned",
        )
        .gte("occurred_at", weekStart.toISOString())
        .order("occurred_at"),
      supabase
        .from("weekly_review_upcoming")
        .select("action, due_date, account_name, objective, opportunity_name")
        .order("due_date"),
      supabase
        .from("weekly_review_new_objects")
        .select("object_type, name, created_at")
        .gte("created_at", weekStart.toISOString()),
      supabase
        .from("dashboard_pipeline")
        .select("stage, opportunity_count, total_value, weighted_value"),
      supabase
        .from("dashboard_planned_vs_actual")
        .select("week_start, planned_total, planned_done, unplanned")
        .gte("week_start", since),
      supabase
        .from("exceptions")
        .select("exception_type, title, detail")
        .limit(25),
    ]);

  const firstError = [activity, upcoming, newObjects, pipeline, planned, exceptions]
    .map((r) => r.error)
    .find(Boolean);
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  const payload = {
    activities: activity.data ?? [],
    upcoming: upcoming.data ?? [],
    new_objects: newObjects.data ?? [],
    pipeline: pipeline.data ?? [],
    planned_vs_actual: planned.data ?? [],
    exceptions: exceptions.data ?? [],
  };

  if (payload.activities.length === 0 && payload.upcoming.length === 0) {
    return NextResponse.json({
      narrative: null,
      payload,
      note: "Nothing recorded in this window yet — capture some activity first.",
    });
  }

  let text: string;
  try {
    ({ text } = await generateText({
      model: NARRATIVE_MODEL,
      system: `You write the weekly commercial review for a building-materials
distributor's sales team (two-step distribution: manufacturer → distributor →
dealer → contractor/architect).

Write it the way a good rep would brief their manager on Monday morning: plain,
specific, and short. Use ONLY the supplied data — never invent accounts,
numbers, or commitments. If a section has nothing, say so in one line rather
than padding it.

Structure with these markdown headings exactly:
## Last week
## Issues and blockers
## Next week

Under "Last week": what was actually done, which accounts mattered, what was
learned, what advanced. Name accounts explicitly. Mention planned-vs-actual only
if the data shows a gap worth noting.
Under "Issues and blockers": what needs management support, drawn from the
exceptions and any blockers voiced in the activity notes.
Under "Next week": the planned visits and priority follow-ups, with dates.

No preamble, no sign-off, no invented enthusiasm.`,
      prompt: JSON.stringify(payload, null, 2),
      providerOptions: {
        gateway: {
          user: user.id,
          tags: ["feature:weekly-review"],
        },
      },
    }));
  } catch (err) {
    // Never let a gateway failure escape as an empty 500 — the caller needs a
    // readable reason (expired OIDC token is the common one in local dev).
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: /unauthenticated/i.test(message)
          ? "AI Gateway rejected the request — refresh credentials with `vercel env pull`."
          : `Narrative generation failed: ${message}`,
        payload,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ narrative: text, payload });
}
