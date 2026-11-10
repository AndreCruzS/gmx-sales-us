// SUGGEST PRIORITY on the PK board (Bianca, 2026-11-03: the Eisenhower
// matrix). The AI answers the matrix's two questions about one follow-up and
// the code turns them into the priority (lib/domain/eisenhower.ts). Nothing is
// written here: the person applies the suggestion with the usual priority
// write, through the outbox, so they stay the gate.

import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { MATRIX_RULES, matrixGuessSchema, suggestDeadline } from "@/lib/domain/eisenhower";
import { defaultDeadline, derivePriority, storedPriority, todayIn } from "@/lib/domain/deadline";

export const maxDuration = 30;

const EXTRACT_MODEL =
  process.env.VOICE_EXTRACT_MODEL ?? "anthropic/claude-sonnet-4.6";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bodySchema = z.object({
  action: z.string().trim().min(1).max(500),
  dealer: z.string().max(200).default(""),
  pkDate: day,
  // The device's local date; absent, the server falls back to Los Angeles.
  today: day.optional(),
  kind: z.string().max(60).nullable().default(null),
  ownerGivesWork: z.boolean().default(false),
  notes: z.array(z.string().max(2000)).max(20).default([]),
  subtasks: z.array(z.string().max(300)).max(30).default([]),
});

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const b = parsed.data;
  const today = b.today ?? todayIn();

  const facts = [
    `Follow-up: ${b.action}`,
    b.dealer ? `Dealer: ${b.dealer}` : null,
    `PK date: ${b.pkDate}. Today: ${today}.`,
    b.subtasks.length ? `Its checklist: ${b.subtasks.join("; ")}` : null,
    b.notes.length ? `Notes on it, oldest first:\n- ${b.notes.join("\n- ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { object } = await generateObject({
      model: EXTRACT_MODEL,
      schema: matrixGuessSchema,
      prompt: `A follow-up from a product-knowledge training (PK) GMX gave a dealer's staff. GMX sells decking and building materials through distributors to dealers.

${MATRIX_RULES}

${facts}`,
    });
    const due = suggestDeadline(object, defaultDeadline(b.kind, true, b.pkDate), today);
    return NextResponse.json({
      important: object.important,
      due_date: due,
      reason: object.reason,
      // Shown to the person; ELIMINATE may appear here and is never saved on its own.
      priority: derivePriority(object.important, due, today, b.ownerGivesWork),
      // What a caller that applies the suggestion stores (never ELIMINATE).
      stored_priority: storedPriority(object.important, due, today, b.ownerGivesWork),
    });
  } catch {
    return NextResponse.json({ error: "could not suggest" }, { status: 502 });
  }
}
