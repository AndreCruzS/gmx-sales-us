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

/** What "urgent" and "important" mean at GMX — one text for the voice draft
 *  and for the board's Suggest priority, so they judge alike. */
export const MATRIX_RULES = `Judge each PK follow-up on two separate questions (the Eisenhower matrix):
- URGENT: it has to happen within about two days of the PK — the dealer is
  waiting on it to quote, order or sell, a job or a delivery depends on it, or
  a near date was said. Something the dealer ASKED for, or that GMX promised
  them, counts as the dealer waiting on it: urgent. Otherwise not urgent.
- IMPORTANT: it moves this dealer toward selling GMX (a stocking order, a
  display, a quote, training their staff, the relationship) AND needs the
  speaker's own knowledge or relationship. Everyday work anyone on the team
  could do (send a PDF, forward a price list, ship a sample book), or a nice-to-have,
  is not important.
Do not mark everything urgent and important: most follow-ups are not both.
Give a reason of at most 15 words that names why for each answer, in English,
shaped "Urgent: … · Not important: …" — each half opens with the answer you
gave ("Urgent" or "Not urgent", "Important" or "Not important").`;

/** The board's Suggest priority answer (and the shape the voice draft uses). */
export const matrixGuessSchema = z.object({
  urgent: z.boolean(),
  important: z.boolean(),
  reason: z.string().describe('at most 15 words, "Urgent: … · Not important: …"'),
});
export type MatrixGuess = z.infer<typeof matrixGuessSchema>;
