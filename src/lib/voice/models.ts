// THE VOICE MODELS, in one place (D63: every voice leg goes through the AI
// Gateway). Each can still be overridden per environment without a deploy.
//
// Transcription moved off openai/gpt-4o-mini-transcribe on 2026-11-03: OpenAI
// shuts it down on 2027-02-26 and names gpt-transcribe as its replacement.
// The Gateway does not swap a retired model for us; a call to one just fails
// and every note would fall through to the Gemini audio fallback unnoticed.

import type { SupabaseClient } from "@supabase/supabase-js";

export const TRANSCRIBE_MODEL = process.env.VOICE_TRANSCRIBE_MODEL ?? "openai/gpt-transcribe";

/** Words a GMX note is full of and a transcriber does not know. */
const GMX_TERMS = [
  "GMX",
  "Maximo",
  "PK (product knowledge training)",
  "ipe",
  "LF",
  "Boise Cascade",
  "Builders FirstSource",
  "BFS",
];

/**
 * The transcriber's prompt: the team's first names and the GMX words
 * (2026-11-03). Measured on gpt-transcribe the day it came in, three runs
 * each on the same note: no prompt heard "João" as "Joe" 3/3; full names
 * ("João Manager, João, …") still "Joe" 3/3; first names only "Joao" 3/3.
 * A PK note decides whose work a follow-up is by the name said, so the
 * prompt carries first names — that is how people are spoken of.
 */
export function transcribePrompt(names: readonly string[]): string {
  const first = new Set<string>();
  for (const n of names) {
    const f = n.trim().split(/\s+/)[0];
    if (f) first.add(f);
  }
  const list = [...first].slice(0, 40);
  return `GMX sales voice note.${list.length ? ` Names: ${list.join(", ")}.` : ""} Terms: ${GMX_TERMS.join(", ")}.`;
}

/**
 * The org's member names, for the prompt. Best effort: a failed read gives an
 * empty list and the note is transcribed with the GMX words alone.
 */
export async function teamNames(client: SupabaseClient, orgId?: string | null): Promise<string[]> {
  try {
    let q = client.from("memberships").select("users(full_name)").eq("status", "active").limit(200);
    if (orgId) q = q.eq("org_id", orgId);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as unknown as { users: { full_name: string | null } | null }[])
      .map((r) => r.users?.full_name ?? "")
      .filter(Boolean);
  } catch {
    return [];
  }
}
