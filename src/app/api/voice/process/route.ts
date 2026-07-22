// Voice debrief processing (spec §5 steps 4-5): transcribe + extract, via the
// AI Gateway (D63). Produces a DRAFT only — the review gate (D9) is the sole
// path from draft to records, and it lives in the client against the outbox.
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
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { debriefDraftSchema, extractionPrompt } from "@/lib/voice/draft";

export const maxDuration = 120;

const TRANSCRIBE_MODEL =
  process.env.VOICE_TRANSCRIBE_MODEL ?? "openai/gpt-4o-mini-transcribe";
const AUDIO_FALLBACK_MODEL =
  process.env.VOICE_AUDIO_FALLBACK_MODEL ?? "google/gemini-3.5-flash";
const EXTRACT_MODEL =
  process.env.VOICE_EXTRACT_MODEL ?? "anthropic/claude-sonnet-4.6";

const BATCH_LIMIT = 5;

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
): Promise<string> {
  try {
    const result = await transcribe({
      model: gateway.transcriptionModel(TRANSCRIBE_MODEL),
      audio,
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

export async function POST() {
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

  // Only the caller's own captures, only ones ready to process.
  const { data: captures, error } = await service
    .from("voice_captures")
    .select("id, audio_path, transcript, language, created_at")
    .eq("org_id", orgId)
    .eq("owner_id", membership.id)
    .eq("status", "UPLOADED")
    .order("created_at")
    .limit(BATCH_LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let processed = 0;
  let failed = 0;

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
        );
      }
      if (!transcript?.trim()) throw new Error("nothing to transcribe");

      const { object: draft } = await generateObject({
        model: EXTRACT_MODEL,
        schema: debriefDraftSchema,
        system: extractionPrompt(capture.created_at, language),
        prompt: transcript,
        providerOptions: {
          gateway: {
            user: membership.id, // per-rep attribution (D63)
            tags: ["feature:voice-debrief"],
          },
        },
      });

      await service
        .from("voice_captures")
        .update({ transcript, ai_draft: draft, status: "DRAFTED" })
        .eq("id", capture.id);
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

  return NextResponse.json({ processed, failed });
}
