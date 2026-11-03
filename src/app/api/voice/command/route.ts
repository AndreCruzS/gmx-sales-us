// Say it (lib/voice/command.ts): one spoken sentence → up to three commands,
// each to be confirmed on a card. Nothing is written here; the card writes
// through the outbox like every other form, so the person is the gate.
//
// Same transcribe path as the other voice legs (D63). Accounts are read with
// the CALLER's session, so the model is only ever shown doors RLS lets them
// see; a desk role also gets the reps, to book "for Jason".

import { NextRequest, NextResponse } from "next/server";
import { experimental_transcribe as transcribe, gateway, generateObject, generateText } from "ai";
import { TRANSCRIBE_MODEL, teamNames, transcribePrompt } from "@/lib/voice/models";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { orgIdFromJwt } from "@/lib/supabase/jwt";
import {
  candidateAccounts,
  commandPrompt,
  commandSchema,
  sanitizeCommands,
  type CommandAccount,
  type CommandRep,
  type CommandTeammate,
} from "@/lib/voice/command";

export const maxDuration = 60;

const AUDIO_FALLBACK_MODEL =
  process.env.VOICE_AUDIO_FALLBACK_MODEL ?? "google/gemini-3.5-flash";
const EXTRACT_MODEL =
  process.env.VOICE_EXTRACT_MODEL ?? "anthropic/claude-sonnet-4.6";

/** The field's day: GMX sells on Pacific time. */
function todayPacific(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

async function heard(file: Blob, prompt: string): Promise<string> {
  const audio = new Uint8Array(await file.arrayBuffer());
  try {
    const r = await transcribe({
      model: gateway.transcriptionModel(TRANSCRIBE_MODEL),
      audio,
      providerOptions: { openai: { prompt } },
    });
    if (r.text.trim()) return r.text.trim();
  } catch {
    // fall through to the audio model
  }
  const r = await generateText({
    model: AUDIO_FALLBACK_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: audio, mediaType: file.type || "audio/webm" },
          {
            type: "text",
            text: "Transcribe this voice memo verbatim, in its original language. Output only the transcript text.",
          },
        ],
      },
    ],
  });
  return r.text.trim();
}

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const orgId = orgIdFromJwt(session.access_token);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 403 });

  const form = await req.formData();
  const typed = String(form.get("text") ?? "").trim().slice(0, 2000);
  const file = form.get("audio");
  let transcript = typed;
  if (!transcript) {
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: "no audio" }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "audio too large" }, { status: 413 });
    }
    transcript = await heard(file, transcribePrompt(await teamNames(supabase)));
  }
  if (!transcript) return NextResponse.json({ error: "nothing heard" }, { status: 422 });

  const { data: me } = await supabase
    .from("memberships")
    .select("id, role")
    .eq("user_id", session.user.id)
    .eq("org_id", orgId)
    .eq("status", "active")
    .maybeSingle();
  if (!me) return NextResponse.json({ error: "no membership" }, { status: 403 });

  const { data: rows } = await supabase
    .from("accounts")
    .select("id, name, city")
    .eq("org_id", orgId)
    .order("name")
    .limit(1000);
  const shown = candidateAccounts(transcript, (rows ?? []) as CommandAccount[]);

  // GMX's own people: who a follow-up can be WITH ("call Bia"). Through
  // pk_member_names, because a rep reads no colleague's membership row — read
  // straight, a rep's list held only himself, and "meet Bia" found nobody
  // (2026-11-04).
  const { data: people } = await supabase.rpc("pk_member_names");
  const team: CommandTeammate[] = ((people ?? []) as { id: string; full_name: string | null; role: string; status: string }[])
    .filter((r) => r.status === "active" && r.full_name)
    .map((r) => ({
      membershipId: r.id,
      name: r.full_name as string,
      // The speaker is on the list too, so "Bia" is never read as a business.
      role: r.id === me.id ? `${r.role}, the speaker` : r.role,
    }));
  // Who a desk role may book FOR: only the members RLS lets them write for.
  const { data: mine } = await supabase
    .from("memberships")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "active");
  const writable = new Set(((mine ?? []) as { id: string }[]).map((r) => r.id));
  const reps: CommandRep[] =
    me.role === "rep"
      ? []
      : team
          .filter((t) => t.membershipId !== me.id && writable.has(t.membershipId))
          .map((t) => ({ membershipId: t.membershipId, name: t.name }));

  try {
    const { object } = await generateObject({
      model: EXTRACT_MODEL,
      schema: commandSchema,
      system: commandPrompt(todayPacific(), shown, reps, team),
      prompt: transcript,
    });
    return NextResponse.json({
      transcript,
      commands: sanitizeCommands(object, shown, reps, team, me.id),
      accounts: shown,
      reps,
      team,
    });
  } catch (err) {
    return NextResponse.json(
      { transcript, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
