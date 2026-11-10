// THE EISENHOWER MATRIX on a PK follow-up (Bianca, 2026-11-03: "tudo que eu
// vou fazer eu vou achar que é importante ou urgente" — so the system asks the
// two questions separately and the priority falls out of the answers):
//
//                 important      not important
//   urgent        Do now         Delegate
//   not urgent    Plan           Eliminate
//
// The AI answers both questions with a reason the person can read; the code,
// not the model, turns them into the priority. Eliminate is never saved on its
// own: it comes back as a suggestion the person has to keep or drop.

import { z } from "zod";
import type { Priority } from "@/lib/domain/pk-follow-up";
import { urgentCap } from "@/lib/domain/deadline";

/** The quadrant two answers land in; null while either is unknown. */
export function quadrantOf(
  urgent: boolean | null | undefined,
  important: boolean | null | undefined,
): Priority | null {
  if (urgent == null || important == null) return null;
  if (urgent) return important ? "DO_NOW" : "DELEGATE";
  return important ? "PLAN" : "ELIMINATE";
}

/** A voice-drafted item's quadrant. Guarded in code, not left to the prompt
 *  (it slipped 1 run in 2): what the dealer asked for, or GMX promised, has
 *  the dealer waiting on it, so it is urgent and never lands in Eliminate. */
export function draftedQuadrant(
  urgent: boolean | null | undefined,
  important: boolean | null | undefined,
  askedByDealer: boolean | null | undefined,
): Priority | null {
  return quadrantOf(urgent == null ? urgent : urgent || askedByDealer === true, important);
}

/** The deadline a suggestion proposes. A date said is used as said; urgent
 *  (said or implied) caps it at two business days. */
export function suggestDeadline(
  g: { urgent: boolean; said_date: string | null },
  fallback: string,
  today: string,
): string {
  return g.urgent ? urgentCap(g.said_date ?? fallback, today) : (g.said_date ?? fallback);
}

/** What "important" and the deadline mean at GMX — one text for the voice
 *  draft and for the board's Suggest, so they judge alike. */
export const MATRIX_RULES = `Judge each PK follow-up on one question and one date:
- IMPORTANT: it moves this dealer toward selling GMX (a stocking order, a
  display, a quote, training their staff, the relationship) AND needs the
  speaker's own knowledge or relationship. Everyday work anyone on the team
  could do (send a PDF, forward a price list, ship a sample book), or a nice-to-have,
  is not important.
- DEADLINE: a date that was said is used as said. If it was called "urgent", or
  the dealer is waiting on it (they asked for it, GMX promised it, a job or a
  delivery depends on it), answer urgent: true. Otherwise there is no date to
  give: said_date is null.
Do not mark everything important: most follow-ups are not.
Give a reason of at most 15 words, in English, shaped
"Important: … · Due: …" — the first half opens with "Important" or "Not
important", the second says why that date.`;

/** The board's Suggest answer (and the shape the voice draft uses). `urgent`
 *  means said or implied urgent; it no longer decides the quadrant directly. */
export const matrixGuessSchema = z.object({
  important: z.boolean(),
  urgent: z.boolean(),
  said_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .describe("a date said out loud, YYYY-MM-DD; null when none was said"),
  reason: z.string().describe('at most 15 words, "Important: … · Due: …"'),
});
export type MatrixGuess = z.infer<typeof matrixGuessSchema>;
