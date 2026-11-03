// Voice debrief processing (spec §5 steps 4-5): transcribe + extract, via the
// AI Gateway (D63). Produces a DRAFT only — the review gate (D9) is the sole
// path from draft to records, and it lives in the client against the outbox.
//
// ONE MICROPHONE (spec 2026-11-04): every Say it utterance is a capture too,
// and this reads it once for both halves — what happened (the visit and its
// follow-ups) and what to book (lib/voice/say.ts). Say it posts
// { captureId } and waits for that one capture; Review posts nothing and
// writes up whatever is waiting, as before.
//
// Auth model: the caller's session identifies the rep; the service role is
// used ONLY to read/write that rep's own captures and download their audio.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  experimental_transcribe as transcribe,
  gateway,
  generateObject,
  generateText,
} from "ai";
import { TRANSCRIBE_MODEL, teamNames, transcribePrompt } from "@/lib/voice/models";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { type RoutineContextItem } from "@/lib/voice/draft";
import {
  candidateAccounts,
  type CommandAccount,
  type CommandRep,
  type CommandTeammate,
} from "@/lib/voice/command";
import { sanitizeSayDraft, sayDraftSchema, sayPrompt, type SayStoredDraft } from "@/lib/voice/say";

export const maxDuration = 120;

const AUDIO_FALLBACK_MODEL =
  process.env.VOICE_AUDIO_FALLBACK_MODEL ?? "google/gemini-3.5-flash";
const EXTRACT_MODEL =
  process.env.VOICE_EXTRACT_MODEL ?? "anthropic/claude-sonnet-4.6";

const BATCH_LIMIT = 5;
// How many of the rep's accounts the model is shown when it has to work out which
// one a note is about. Enough that the answer is nearly always in the list, small
// enough that the list stays readable to the model — and the failure mode past it
// is a null, which costs the rep one dropdown, not a wrong record.
const ACCOUNT_CONTEXT_LIMIT = 120;

/** The capture's day on GMX's clock (Pacific): "Thursday" is read against when it was said. */
function dayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(iso));
}

function mimeFromPath(path: string): string {
  if (path.endsWith(".mp4") || path.endsWith(".m4a")) return "audio/mp4";
  if (path.endsWith(".webm")) return "audio/webm";
  if (path.endsWith(".wav")) return "audio/wav";
  return "audio/mpeg";
}

function orgIdFromJwt(token: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    return payload.org_id ?? null;
  } catch {
    return null;
  }
}

async function transcribeAudio(
  audio: Uint8Array,
  mediaType: string,
  language: string,
  prompt: string,
): Promise<string> {
  try {
    const result = await transcribe({
      model: gateway.transcriptionModel(TRANSCRIBE_MODEL),
      audio,
      providerOptions: { openai: { prompt } },
    });
    if (result.text.trim()) return result.text;
    throw new Error("empty transcript");
  } catch {
    // Fallback: audio-input multimodal model, still through the gateway.
    const result = await generateText({
      model: AUDIO_FALLBACK_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "file", data: audio, mediaType },
            {
              type: "text",
              text: `Transcribe this voice memo verbatim (spoken language: ${language}). Output only the transcript text.`,
            },
          ],
        },
      ],
    });
    return result.text;
  }
}

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const orgId = orgIdFromJwt(session.access_token);
  if (!orgId) {
    return NextResponse.json({ error: "no active org" }, { status: 403 });
  }

  const service = createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: membership } = await service
    .from("memberships")
    .select("id, debrief_language")
    .eq("user_id", session.user.id)
    .eq("org_id", orgId)
    .eq("status", "active")
    .single();
  if (!membership) {
    return NextResponse.json({ error: "no membership" }, { status: 403 });
  }

  // Say it asks for its one capture; Review asks for whatever is waiting.
  let captureId: string | null = null;
  try {
    const body = (await request.json()) as { captureId?: unknown };
    if (typeof body.captureId === "string") captureId = body.captureId;
  } catch {
    // No body: the Review batch.
  }

  // The team's names, for the transcriber (lib/voice/models.ts). Read once
  // per call, through the service role, so a rep's note can name the desk.
  const sttPrompt = transcribePrompt(await teamNames(service, orgId));

  // GMX's own people, for the bookings, as Say it reads them: names through
  // pk_member_names (a rep reads no colleague's membership row), and who the
  // caller may book FOR limited to the members RLS lets them write for.
  const { data: people } = await supabase.rpc("pk_member_names");
  const team: CommandTeammate[] = (
    (people ?? []) as { id: string; full_name: string | null; role: string; status: string }[]
  )
    .filter((r) => r.status === "active" && r.full_name)
    .map((r) => ({
      membershipId: r.id,
      name: r.full_name as string,
      role: r.id === membership.id ? `${r.role}, the speaker` : r.role,
    }));
  const { data: me } = await supabase
    .from("memberships")
    .select("role")
    .eq("id", membership.id)
    .maybeSingle();
  const { data: mine } = await supabase.from("memberships").select("id").eq("org_id", orgId).eq("status", "active");
  const writable = new Set(((mine ?? []) as { id: string }[]).map((r) => r.id));
  const reps: CommandRep[] =
    me?.role === "rep"
      ? []
      : team
          .filter((t) => t.membershipId !== membership.id && writable.has(t.membershipId))
          .map((t) => ({ membershipId: t.membershipId, name: t.name }));

  // Every account the caller can see, for matching what was said to a door
  // (bookings can be about any of them, as on Say it).
  const { data: visible } = await supabase
    .from("accounts")
    .select("id, name, city")
    .eq("org_id", orgId)
    .order("name")
    .limit(1000);

  // Only the caller's own captures, only ones ready to process.
  let query = service
    .from("voice_captures")
    .select("id, audio_path, transcript, language, created_at, account_id")
    .eq("org_id", orgId)
    .eq("owner_id", membership.id)
    .eq("status", "UPLOADED");
  if (captureId) query = query.eq("id", captureId);
  const { data: captures, error } = await query.order("created_at").limit(BATCH_LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let processed = 0;
  let failed = 0;
  const drafts: Record<string, SayStoredDraft> = {};

  for (const capture of captures ?? []) {
    const language = capture.language ?? membership.debrief_language ?? "en";
    try {
      let transcript = capture.transcript as string | null;

      if (!transcript && capture.audio_path) {
        const { data: blob, error: dlError } = await service.storage
          .from("voice")
          .download(capture.audio_path);
        if (dlError || !blob) {
          throw new Error(`audio download failed: ${dlError?.message}`);
        }
        transcript = await transcribeAudio(
          new Uint8Array(await blob.arrayBuffer()),
          mimeFromPath(capture.audio_path),
          language,
          sttPrompt,
        );
      }
      if (!transcript?.trim()) throw new Error("nothing to transcribe");

      // Routine context (D-routine, Task 10): a capture pre-linked to an
      // account (D46) offers the model that account's open chores so it can
      // propose a disposition instead of inventing one. Scoped to this
      // capture's own owner + account — routine_items itself already narrows
      // to open, unescalated items (migration 20260729000100_routine.sql).
      let routineContext: RoutineContextItem[] | undefined;
      let openItemIds: string[] = [];
      if (capture.account_id) {
        const { data: routineRows, error: routineError } = await service
          .from("routine_items")
          .select("item_id, kind, action")
          .eq("account_id", capture.account_id)
          .eq("owner_membership_id", membership.id);
        if (routineError) {
          // Don't fail the whole capture over context that's a nice-to-have —
          // but a real failure (view rename, permissions, 5xx) must be
          // observable, not indistinguishable from "no open routine items".
          console.error(
            `routine_items lookup failed for capture ${capture.id}:`,
            routineError.message,
          );
        } else if (routineRows && routineRows.length > 0) {
          routineContext = routineRows as RoutineContextItem[];
          openItemIds = routineRows.map((r) => r.item_id as string);
        }
      }

      // ── Which business is this about ─────────────────────────────────────
      //
      // The one field the rep could not be spared. Every other part of the
      // debrief was already drafted, so recording without picking an account
      // produced a finished write-up with one empty dropdown in front of Save —
      // the model had read the note and had never been asked.
      //
      // Skipped entirely when the capture already carries an account: it was
      // picked at capture time or came in on a deep link from the agenda, and a
      // guess cannot improve on the rep having said so.
      //
      // Only THIS rep's accounts, so the model cannot propose a company that is
      // not theirs to visit. Capped, and the cap is honest about its cost: the
      // most recently touched accounts are the ones a debrief is likely about,
      // and a note about the 121st would come back null rather than wrong.
      let own: CommandAccount[] = [];
      if (!capture.account_id) {
        const { data: accountRows, error: accountError } = await service
          .from("accounts")
          .select("id, name, city")
          .eq("org_id", orgId)
          .eq("owner_id", membership.id)
          .order("updated_at", { ascending: false })
          .limit(ACCOUNT_CONTEXT_LIMIT);
        if (accountError) {
          // Context, not the job. A failure here means the rep picks the account
          // by hand exactly as they did before — but it must be visible, or it is
          // indistinguishable from a rep with no accounts.
          console.error(
            `accounts lookup failed for capture ${capture.id}:`,
            accountError.message,
          );
        } else if (accountRows && accountRows.length > 0) {
          own = accountRows as CommandAccount[];
        }
      }
      // The doors the sentence names, from everything the caller can see, then
      // the rep's own recent ones: one list for the visit and the bookings.
      const shown: CommandAccount[] = [];
      const seen = new Set<string>();
      for (const a of [...candidateAccounts(transcript, (visible ?? []) as CommandAccount[]), ...own]) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        shown.push(a);
      }

      const { object: rawDraft } = await generateObject({
        model: EXTRACT_MODEL,
        schema: sayDraftSchema,
        system: sayPrompt({
          capturedAtIso: capture.created_at,
          language,
          today: dayOf(capture.created_at),
          routineContext,
          accounts: shown,
          reps,
          team,
        }),
        prompt: transcript,
        providerOptions: {
          gateway: {
            user: membership.id, // per-rep attribution (D63)
            tags: ["feature:voice-debrief"],
          },
        },
      });
      // Hallucination guard (Task 9): never trust the model to keep to the
      // item ids it was offered — drop anything it invented before storing.
      const draft = sanitizeSayDraft(rawDraft, {
        openItemIds,
        accounts: shown,
        reps,
        team,
        speakerId: membership.id,
      });

      await service
        .from("voice_captures")
        .update({ transcript, ai_draft: draft, status: "DRAFTED" })
        .eq("id", capture.id);
      drafts[capture.id] = draft;
      processed += 1;
    } catch (err) {
      await service
        .from("voice_captures")
        .update({
          status: "FAILED",
          ai_draft: {
            error: err instanceof Error ? err.message : "processing failed",
          },
        })
        .eq("id", capture.id);
      failed += 1;
    }
  }

  // A Say it capture not found here has not landed yet (still in the outbox)
  // or was written up already; the page says so and lets Review take it.
  return NextResponse.json({ processed, failed, drafts });
}
