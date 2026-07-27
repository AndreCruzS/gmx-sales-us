// Business card extraction contract (D41): photo → vision model → per-field
// confidence. Low-confidence fields are FLAGGED for the rep, never silently
// accepted — the UI renders anything under CONFIDENCE_OK as "check this".
//
// Shared by the API route (writes `extracted`) and the Review sheet (reads it).

import { z } from "zod";

export const CONFIDENCE_OK = 0.7;

const field = z.object({
  value: z.string().nullable(),
  // 0–1; the model's own honesty about each read. Smudged ink, stylized
  // fonts and handwritten corrections are why this exists.
  confidence: z.number().min(0).max(1),
});

export const cardExtractionSchema = z.object({
  name: field,
  job_title: field,
  company: field,
  email: field,
  phone: field,
  address: field,
  // Handwriting on cards is usually the most valuable part — a direct cell,
  // "call after 3", a job name. Never dropped.
  handwritten_notes: z.string().nullable(),
});
export type CardExtraction = z.infer<typeof cardExtractionSchema>;

// What lands in contact_candidates.extracted (jsonb).
export interface ExtractedCard {
  fields?: CardExtraction;
  // D44 contextual inference: PK training in the last 48h → PK_CLASS.
  suggested_source?: string | null;
  // D43 company matching: card company → existing account, when one matches.
  company_match?: { id: string; name: string } | null;
  // D40 dedupe, rung 1: exact normalized email → same person. The card
  // scanned Tuesday and the email received Thursday must not become two
  // contacts.
  contact_match?: { id: string; name: string; account_id: string } | null;
  error?: string;
}

export function cardPrompt(): string {
  return [
    "Read this business card photo and extract the fields.",
    "Rules:",
    "- Report each field with a confidence between 0 and 1. If a field is not on the card, use value null and confidence 1 (you are sure it's absent).",
    "- Do not guess. A smudged or partially visible value gets a LOW confidence, not a cleaned-up invention.",
    "- email and phone: transcribe exactly as printed; keep formatting characters out of email; keep the phone's digits and leading + only.",
    "- company is the business name as printed, not the tagline.",
    "- Anything handwritten on the card goes to handwritten_notes verbatim.",
  ].join("\n");
}
