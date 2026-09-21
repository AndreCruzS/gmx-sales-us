// The dealer module's INSIGHTS (Bianca and João, 2026-09-18: overview →
// insights → action; prototype approved 2026-09-21).
//
// The facts are computed on the page, from rows the caller's own session was
// allowed to read, and sent here only to be READ ALOUD: this route adds no data,
// stores nothing, and the model may use nothing but what it is handed. Each
// insight names the fact it came from, so the screen can show it — nobody has
// to trust a sentence they cannot trace.
//
// Two rules the model must keep, both the client's:
//   * the alert thresholds are not set yet (Bianca and João owe the numbers),
//     so a pause is never declared a loss — it is a question;
//   * an alert for a region with no rep goes to the admins, never to the
//     distributor.

import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const INSIGHT_MODEL =
  process.env.DEALER_INSIGHT_MODEL ?? "anthropic/claude-sonnet-4.6";

const insightSchema = z.object({
  insights: z
    .array(
      z.object({
        title: z.string().describe("One short line, a finding — not a heading. Max ~60 characters."),
        body: z.string().describe("One or two plain sentences explaining it from the facts."),
        from: z.string().describe("Which facts it rests on, in plain words for a person, e.g. 'July's file, Boise Memphis' — never field names or ISO dates."),
      }),
    )
    .min(1)
    .max(3),
  action: z.object({
    kind: z.enum(["create_account", "email_rep", "alert_admins", "plan_visit", "add_contact", "none"]),
    label: z.string().describe("The button's words, imperative, max ~40 characters."),
    why: z.string().describe("One sentence: why this is the next step."),
  }),
});

// Big enough for any one dealer's facts; small enough that nobody posts a
// book through it.
const MAX_BODY = 60_000;

export async function POST(req: Request) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) {
    return NextResponse.json({ error: "Too much to read for one dealer." }, { status: 413 });
  }
  let facts: unknown;
  try {
    facts = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Not JSON." }, { status: 400 });
  }

  try {
    const { object } = await generateObject({
      model: INSIGHT_MODEL,
      schema: insightSchema,
      system: `You read one dealer's file for the leadership of GMX, a manufacturer of
thermally modified wood (Thermowood) sold in two steps: GMX sells to a
distributor (Boise Cascade, Hardwoods Inc., Russin, Capital Lumber), the
distributor's branches sell to dealers (lumberyards), and GMX reps work the
dealers so the distributor's next order is worth placing.

You are handed FACTS as JSON — sell-through from the distributors' files, and
what GMX has recorded about the relationship. Write up to three insights and
one suggested next action.

Rules, all of them hard:
- Use ONLY the facts given. Never invent a number, a name, a date or a reason.
  If a figure is not in the facts, do not state it.
- Months: "periods" with kind YTD are ONE aggregate (January through that
  month) — never describe months inside it. A month file with no purchase is
  silence; a month with no file is unknown, never zero.
- No alert thresholds exist yet. Never call a pause a loss or say the dealer
  "stopped"; say what the pattern suggests and when it would become a question.
- A region with no rep: any alert goes to GMX admins, never to the distributor.
- Empty relationship facts (no contacts, no visits, no notes) are a finding,
  not a gap to apologise for.
- Plain English, no hype, no emoji, no markdown. Each "from" names the facts.
- Figures as the page shows them: whole numbers with thousands separators and
  the unit "LF" (e.g. "14,000 LF"), months as "July 2026" or "Jan–Jun".
- "from" is for a person: name the source in words ("Jan–Jun year file",
  "August files, Boise and Hardwoods", "rollout tracker"), never field names,
  keys or ISO dates.
- The action must be one the facts justify. No account yet → usually
  create_account. A rep exists and something needs doing → email_rep.`,
      prompt: JSON.stringify(facts, null, 2),
      providerOptions: {
        gateway: { user: user.id, tags: ["feature:dealer-insights"] },
      },
    });
    return NextResponse.json(object);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: /unauthenticated/i.test(message)
          ? "AI Gateway rejected the request — refresh credentials with `vercel env pull`."
          : `Could not read this dealer: ${message}`,
      },
      { status: 502 },
    );
  }
}
