// "Where does this stand?", spoken.
//
// The rep holds the mic, talks the way they would brief a colleague, and this
// turns it into the one-or-two-line status the field wants — the same
// transcribe-through-the-gateway path the debrief leg uses (D63), with a
// summarising pass instead of the extraction schema. Nothing is stored here:
// the summary goes back to the form and the form decides, exactly like every
// other draft in this app.

import { NextRequest, NextResponse } from "next/server";
import { experimental_transcribe as transcribe, gateway, generateText } from "ai";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const TRANSCRIBE_MODEL =
  process.env.VOICE_TRANSCRIBE_MODEL ?? "openai/gpt-4o-mini-transcribe";
const AUDIO_FALLBACK_MODEL =
  process.env.VOICE_AUDIO_FALLBACK_MODEL ?? "google/gemini-3.5-flash";
const SUMMARY_MODEL =
  process.env.VOICE_EXTRACT_MODEL ?? "anthropic/claude-sonnet-4.6";

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "no audio" }, { status: 400 });
  }
  if (file.size > 15 * 1024 * 1024) {
    return NextResponse.json({ error: "audio too large" }, { status: 413 });
  }
  const audio = new Uint8Array(await file.arrayBuffer());
  const mediaType = file.type || "audio/webm";

  let transcript = "";
  try {
    const result = await transcribe({
      model: gateway.transcriptionModel(TRANSCRIBE_MODEL),
      audio,
    });
    transcript = result.text.trim();
    if (!transcript) throw new Error("empty transcript");
  } catch {
    const result = await generateText({
      model: AUDIO_FALLBACK_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "file", data: audio, mediaType },
            {
              type: "text",
              text: "Transcribe this voice memo verbatim, in its original language. Output only the transcript text.",
            },
          ],
        },
      ],
    });
    transcript = result.text.trim();
  }
  if (!transcript) {
    return NextResponse.json({ error: "nothing heard" }, { status: 422 });
  }

  const { text } = await generateText({
    model: SUMMARY_MODEL,
    prompt:
      `A wood-products sales rep spoke a quick note about where a quote stands. ` +
      `Condense it into one or two short factual sentences for the form field ` +
      `"Where does this stand?" — keep names, quantities and dates; drop filler; ` +
      `write in the language the rep spoke. Output only the summary, no quotes. ` +
      `If the note carries no actual information about the quote, output ` +
      `exactly NOTHING_HEARD.\n\n` +
      `Note:\n${transcript}`,
  });

  const status = text.trim();
  if (!status || status === "NOTHING_HEARD") {
    // A cough, a beep, a pocket dial: the field stays empty and the client
    // says "couldn't hear that" instead of printing model commentary.
    return NextResponse.json({ error: "nothing heard" }, { status: 422 });
  }
  return NextResponse.json({ status, transcript });
}
