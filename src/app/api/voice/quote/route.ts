// The spoken quote: the rep says what the customer is after, and the system
// drafts the survey — searching the REAL catalog while it listens, and
// NARRATING ITS WORK as a stream of events the form shows live.
//
// The response is NDJSON, one event per line, because the work is genuinely
// staged and each stage is worth seeing: transcribing → the transcript →
// every catalog search with its hit count → the finished draft. The engine
// room on the client renders exactly what happened, which is both the honest
// loading state this flow was missing and the whole show.
//
// The transcriber and the agent both carry the CATALOG'S OWN VOCABULARY
// (species, profiles, trade shorthand, sampled live) — "ayous" spoken must
// not come back "AOS", and when it does anyway, the agent is told the ways a
// wood word gets mangled and searches through it.
//
// EVERY LINE IS VALIDATED against what the search tool actually returned: a
// SKU the search never surfaced does not exist, whatever the model believes.
// A draft, like every AI output in this app — the rep stays the gate.

import { NextRequest, NextResponse } from "next/server";
import {
  experimental_transcribe as transcribe,
  gateway,
  generateText,
  stepCountIs,
  tool,
} from "ai";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  catalogConfigured,
  catalogVocabulary,
  searchCatalog,
  type CatalogItem,
} from "@/lib/catalog/search";

export const maxDuration = 120;

const TRANSCRIBE_MODEL =
  process.env.VOICE_TRANSCRIBE_MODEL ?? "openai/gpt-4o-mini-transcribe";
const AUDIO_FALLBACK_MODEL =
  process.env.VOICE_AUDIO_FALLBACK_MODEL ?? "google/gemini-3.5-flash";
const AGENT_MODEL =
  process.env.VOICE_EXTRACT_MODEL ?? "anthropic/claude-sonnet-4.6";

const proposalSchema = z.object({
  status: z
    .string()
    .describe(
      "One or two short factual sentences for 'Where does this stand?', in the language the rep spoke.",
    ),
  lines: z
    .array(
      z.object({
        sku: z.string().describe("A sku that appeared in a search_catalog result."),
        quantity: z.number().positive(),
        uom: z
          .enum(["PC", "LF"])
          .describe("The unit the rep actually spoke: pieces or linear feet."),
      }),
    )
    .describe("The products the customer asked for. Empty if none were named."),
  unmatched: z
    .array(z.string())
    .describe(
      "Product requests the searches could not resolve, in the rep's own words.",
    ),
  next_action: z
    .object({
      text: z.string(),
      due: z.string().nullable().describe("YYYY-MM-DD when a day was said."),
    })
    .nullable(),
  expected_close: z.string().nullable().describe("YYYY-MM-DD if spoken."),
});

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const form = await req.formData();
  const accountName = String(form.get("account") ?? "").slice(0, 200);
  const typed = String(form.get("transcript") ?? "").trim();
  const file = form.get("audio");
  if (!typed && (!(file instanceof Blob) || file.size === 0)) {
    return NextResponse.json({ error: "no audio" }, { status: 400 });
  }
  if (file instanceof Blob && file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "audio too large" }, { status: 413 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const emit = (e: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));

      void (async () => {
        try {
          const vocabulary = await catalogVocabulary();

          let transcript = typed;
          if (!transcript) {
            emit({ type: "stage", stage: "transcribing" });
            const audio = new Uint8Array(await (file as Blob).arrayBuffer());
            const mediaType = (file as Blob).type || "audio/webm";
            // The vocabulary rides along as the transcriber's prompt — the
            // documented way to bias STT toward domain words. Capped: prompt
            // budgets are small and the exotic words matter most.
            const vocabPrompt = `GMX wood products vocabulary: ${vocabulary
              .slice(0, 60)
              .join(", ")}.`;
            try {
              const result = await transcribe({
                model: gateway.transcriptionModel(TRANSCRIBE_MODEL),
                audio,
                providerOptions: { openai: { prompt: vocabPrompt } },
              });
              transcript = result.text.trim();
              if (!transcript) throw new Error("empty");
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
                        text:
                          `Transcribe this voice memo verbatim, in its original language. ` +
                          `Expected domain vocabulary: ${vocabulary.slice(0, 60).join(", ")}. ` +
                          `Output only the transcript text.`,
                      },
                    ],
                  },
                ],
              });
              transcript = result.text.trim();
            }
          }
          if (!transcript) {
            emit({ type: "error", message: "nothing heard" });
            controller.close();
            return;
          }
          emit({ type: "transcript", text: transcript });

          const catalogOn = catalogConfigured();
          const seen = new Map<string, CatalogItem>();
          let proposal: z.infer<typeof proposalSchema> | null = null;
          const today = new Date().toISOString().slice(0, 10);

          emit({ type: "stage", stage: "reading" });
          await generateText({
            model: AGENT_MODEL,
            stopWhen: stepCountIs(10),
            system:
              `You draft a wood-products quote survey for a GMX sales rep. Today is ${today}. ` +
              `The quote is for the account "${accountName || "unknown"}". The rep spoke a note; ` +
              `your job is to fill the form from it.\n` +
              `The transcript may MISHEAR wood words. Known vocabulary: ${vocabulary
                .slice(0, 80)
                .join(", ")}. ` +
              `Read phonetically: "AOS"/"ayus"/"IUs" mean Ayous, "termo" means thermo, ` +
              `"a coya" means Accoya — map mangled words to this vocabulary before searching.\n` +
              (catalogOn
                ? `For EVERY product mentioned, call search_catalog (short queries: species and size, ` +
                  `e.g. "ayous 1x6"). Pick the sku whose length matches what was asked — ` +
                  `"ten footers" means the 10' item. WHEN NO LENGTH WAS SPOKEN, pick the ` +
                  `RANDOM LENGTH sku (is_random_length true) — RL is how this trade orders ` +
                  `by default, always in LF. Search again with different words before giving up; ` +
                  `whatever stays unfound goes in unmatched, in the rep's own words.\n`
                : `The catalog is offline: put every product request in unmatched, verbatim.\n`) +
              `Quantities keep the unit the rep spoke — pieces (PC) or linear feet (LF). ` +
              `Resolve relative days ("Friday", "next week") against today. ` +
              `expected_close is ONLY the day the customer is expected to DECIDE or buy — ` +
              `sending the quote out is not closing; leave it null unless a decision day was said. ` +
              `Finish by calling propose_quote exactly once. The status must be one or two ` +
              `short factual sentences in the language the rep spoke — never meta-commentary.`,
            prompt: `The rep's note:\n${transcript}`,
            tools: {
              search_catalog: tool({
                description:
                  "Search the live product catalog. Returns up to 25 products with sku, description, species, nominal size, LF per piece and availability.",
                inputSchema: z.object({
                  query: z
                    .string()
                    .describe("Short search, e.g. 'thermo 1x6' or 'ash decking'."),
                }),
                execute: async ({ query }) => {
                  emit({ type: "search", query });
                  if (!catalogOn) {
                    emit({ type: "found", query, count: 0 });
                    return { items: [] };
                  }
                  try {
                    const { items } = await searchCatalog(query);
                    for (const i of items) seen.set(i.sku, i);
                    emit({
                      type: "found",
                      query,
                      count: items.length,
                      top: items[0]?.description ?? null,
                    });
                    return {
                      items: items.map((i) => ({
                        sku: i.sku,
                        description: i.description,
                        species: i.species,
                        nominal_size: i.nominal_size,
                        lf_per_piece: i.lf_per_piece,
                        pieces_available: i.piecesAvailable,
                        is_random_length: i.randomLength,
                      })),
                    };
                  } catch {
                    emit({ type: "found", query, count: 0 });
                    return { items: [], error: "catalog unreachable" };
                  }
                },
              }),
              propose_quote: tool({
                description: "Deliver the finished draft. Call exactly once, last.",
                inputSchema: proposalSchema,
                execute: async (p) => {
                  proposal = p;
                  return { ok: true };
                },
              }),
            },
          });

          if (!proposal) {
            emit({ type: "error", message: "no proposal" });
            controller.close();
            return;
          }
          const p: z.infer<typeof proposalSchema> = proposal;

          // The catalog is the authority on every line: identity fields come
          // from the results the model actually saw, never from its memory.
          const lines = p.lines.flatMap((l) => {
            const item = seen.get(l.sku);
            if (!item) return [];
            return [
              {
                sku: item.sku,
                description: item.description,
                species: item.species,
                profile: item.profile,
                nominal_size: item.nominal_size,
                lf_per_piece: item.randomLength ? null : item.lf_per_piece,
                random_length: item.randomLength,
                quantity: l.quantity,
                // A random-length order speaks LF, whatever the model heard.
                uom: item.randomLength || !item.lf_per_piece ? "LF" : l.uom,
              },
            ];
          });
          const dropped = p.lines.filter((l) => !seen.has(l.sku)).map((l) => l.sku);

          emit({
            type: "draft",
            draft: {
              status: p.status,
              lines,
              unmatched: [...p.unmatched, ...dropped],
              nextAction: p.next_action,
              expectedClose: p.expected_close,
              transcript,
            },
          });
        } catch (err) {
          emit({
            type: "error",
            message: err instanceof Error ? err.message : "drafting failed",
          });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
