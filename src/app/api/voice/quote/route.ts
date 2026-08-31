// The spoken quote: the rep says what the customer is after, and the system
// drafts the survey — searching the REAL catalog while it listens.
//
// Same gateway path as the debrief leg (transcribe, with a multimodal
// fallback), then an agent pass: the model reads the transcript holding one
// tool, search_catalog — the exact fold the picker uses — and finishes by
// proposing a draft: status line, product lines, next action, expected close.
// EVERY LINE IS VALIDATED against what the tool actually returned: a SKU the
// search never surfaced does not exist, whatever the model believes. What a
// search could not find comes back as words, for the person to resolve.
//
// A draft, like every AI output in this app — it lands in the form fields,
// editable, and the review gate stays where it has always been: the rep.

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

  let transcript = typed;
  if (!transcript) {
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: "no audio" }, { status: 400 });
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "audio too large" }, { status: 413 });
    }
    const audio = new Uint8Array(await file.arrayBuffer());
    const mediaType = file.type || "audio/webm";
    try {
      const result = await transcribe({
        model: gateway.transcriptionModel(TRANSCRIBE_MODEL),
        audio,
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
                text: "Transcribe this voice memo verbatim, in its original language. Output only the transcript text.",
              },
            ],
          },
        ],
      });
      transcript = result.text.trim();
    }
  }
  if (!transcript) {
    return NextResponse.json({ error: "nothing heard" }, { status: 422 });
  }

  const catalogOn = catalogConfigured();
  // Everything a search surfaced, by sku — the ONLY skus a proposal may use.
  const seen = new Map<string, CatalogItem>();
  let proposal: z.infer<typeof proposalSchema> | null = null;

  const today = new Date().toISOString().slice(0, 10);
  await generateText({
    model: AGENT_MODEL,
    stopWhen: stepCountIs(10),
    system:
      `You draft a wood-products quote survey for a GMX sales rep. Today is ${today}. ` +
      `The quote is for the account "${accountName || "unknown"}". The rep spoke a note; ` +
      `your job is to fill the form from it.\n` +
      (catalogOn
        ? `For EVERY product mentioned, call search_catalog (short queries: species and size, ` +
          `e.g. "ironthermo 1x6"). Pick the sku whose length matches what was asked — ` +
          `"ten footers" means the 10' item. Search again with different words before giving up; ` +
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
          query: z.string().describe("Short search, e.g. 'thermo 1x6' or 'ash decking'."),
        }),
        execute: async ({ query }) => {
          if (!catalogOn) return { items: [] };
          try {
            const { items } = await searchCatalog(query);
            for (const i of items) seen.set(i.sku, i);
            return {
              items: items.map((i) => ({
                sku: i.sku,
                description: i.description,
                species: i.species,
                nominal_size: i.nominal_size,
                lf_per_piece: i.lf_per_piece,
                pieces_available: i.piecesAvailable,
              })),
            };
          } catch {
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
    return NextResponse.json({ error: "no proposal" }, { status: 422 });
  }
  const p: z.infer<typeof proposalSchema> = proposal;

  // The catalog is the authority on every line: identity fields come from the
  // search results the model actually saw, never from its memory of them.
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
        lf_per_piece: item.lf_per_piece,
        quantity: l.quantity,
        uom: item.lf_per_piece ? l.uom : "LF",
      },
    ];
  });
  const dropped = p.lines.filter((l) => !seen.has(l.sku)).map((l) => l.sku);

  return NextResponse.json({
    status: p.status,
    lines,
    unmatched: [...p.unmatched, ...dropped],
    nextAction: p.next_action,
    expectedClose: p.expected_close,
    transcript,
  });
}
