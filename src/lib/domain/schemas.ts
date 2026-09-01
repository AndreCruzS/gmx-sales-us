// Zod at the outbox boundary (build brief §4): every payload the SyncEngine
// replays against Supabase is validated here first. Server ids are client-
// minted UUIDs (D57) — `id` is the idempotency key.

import { z } from "zod";
import {
  ACCOUNT_TYPES,
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  LEAD_SOURCES_ALL,
  OPPORTUNITY_STAGES,
  REFERRAL_LEAD_SOURCES,
  RELATIONSHIP_TYPES,
  VISIT_OBJECTIVES,
} from "./enums";

// Postgres accepts any 8-4-4-4-12 hex uuid (our seed fixtures use stylized
// ones); Zod's z.uuid() enforces RFC version/variant nibbles — too strict.
const uuid = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "invalid uuid",
  );
const isoTimestamp = z.string().datetime({ offset: true });

export const activityCreateSchema = z.object({
  id: uuid,
  org_id: uuid,
  activity_type: z.enum(ACTIVITY_TYPES),
  primary_account_id: uuid,
  owner_id: uuid,
  occurred_at: isoTimestamp,
  location: z.string().nullish(),
  purpose: z.string().nullish(),
  was_planned: z.boolean().default(false),
  planned_action_id: uuid.nullish(),
  objective: z.enum(VISIT_OBJECTIVES).nullish(),
  objective_detail: z.string().nullish(),
  // D45 minimal capture: the one note + the follow-up flag.
  what_happened: z.string().nullish(),
  key_information: z.string().nullish(),
  commercial_potential: z.string().nullish(),
  outcomes: z.array(z.enum(ACTIVITY_OUTCOMES)).default([]),
  follow_up_required: z.boolean().default(false),
  opportunity_id: uuid.nullish(),
});
export type ActivityCreate = z.infer<typeof activityCreateSchema>;

/**
 * Enriching an activity that already exists.
 *
 * A rep who logs a stop from the day spine writes the note there and then, so
 * the activity is created before the model has read it. When the draft comes
 * back, everything the model added — what it heard worth keeping, the
 * commercial read, the outcome tags — has nowhere to go without this op, and
 * it was being silently dropped on the floor.
 *
 * Only the fields a draft can legitimately improve are here. The account, the
 * type, the time and the D46 link are the rep's own facts and are not the
 * model's to revise.
 */
export const activityUpdateSchema = z.object({
  id: uuid,
  what_happened: z.string().nullish(),
  key_information: z.string().nullish(),
  commercial_potential: z.string().nullish(),
  outcomes: z.array(z.enum(ACTIVITY_OUTCOMES)).optional(),
  follow_up_required: z.boolean().optional(),
});
export type ActivityUpdate = z.infer<typeof activityUpdateSchema>;

export const nextActionCreateSchema = z.object({
  id: uuid,
  org_id: uuid,
  action: z.string().min(1),
  owner_id: uuid,
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  account_id: uuid.nullish(),
  project_id: uuid.nullish(),
  opportunity_id: uuid.nullish(),
  activity_id: uuid.nullish(),
  objective: z.enum(VISIT_OBJECTIVES).nullish(),
  objective_detail: z.string().nullish(),
  // Task 10 (D-routine): debrief commitments carry the same typed kind the
  // routine list groups by. Mirrors debriefDraftSchema's next_actions.kind
  // (src/lib/voice/draft.ts) — DISPLAY_CHECK is deliberately excluded, since
  // that kind is only ever derived from an account, never created directly.
  kind: z.enum(["SAMPLE_FOLLOW_UP", "QUOTE_FOLLOW_UP", "VISIT", "OTHER"]).nullish(),
});
export type NextActionCreate = z.infer<typeof nextActionCreateSchema>;

// Scalar edits (D61): the patch plus the base_version LWW guard on the record.
export const nextActionUpdateSchema = z.object({
  id: uuid,
  completed_at: isoTimestamp.nullish(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  action: z.string().min(1).optional(),
});
export type NextActionUpdate = z.infer<typeof nextActionUpdateSchema>;

// Voice debrief (D9/D10): the capture row lands with status UPLOADED because
// the blob upload precedes the row upsert in the same drain pass (D59).
export const voiceCaptureCreateSchema = z.object({
  id: uuid,
  org_id: uuid,
  owner_id: uuid,
  audio_path: z.string().nullish(), // null = typed debrief (no audio)
  duration_seconds: z.number().int().nonnegative().nullish(),
  transcript: z.string().nullish(), // set directly on the typed path
  status: z.enum(["PENDING", "UPLOADED"]),
  language: z.string().nullish(),
  // D46 pre-links (task 5): set when Record is opened via ?visit=<id> or
  // ?account=<id>&item=<id> so the debrief carries its context through the
  // outbox even though the AI draft still needs the rep's OK.
  account_id: uuid.nullish(),
  planned_action_id: uuid.nullish(),
  // Set when the visit was ALREADY logged and this capture exists only so the
  // model can find the extras (the spine's inline debrief). Review reads it to
  // enrich that activity instead of filing the same visit twice.
  activity_id: uuid.nullish(),
});
export type VoiceCaptureCreate = z.infer<typeof voiceCaptureCreateSchema>;

// Review outcomes (the D9 gate) travel as LWW-guarded updates.
export const voiceCaptureUpdateSchema = z.object({
  id: uuid,
  status: z.enum(["REVIEWED", "SENT", "DISCARDED"]).optional(),
  reviewed_at: isoTimestamp.nullish(),
  sent_at: isoTimestamp.nullish(),
  activity_id: uuid.nullish(),
});
export type VoiceCaptureUpdate = z.infer<typeof voiceCaptureUpdateSchema>;

// Unified contact intake (D39): a card snap creates a candidate row; the
// extraction fills `extracted` server-side; the rep's confirmation becomes the
// contact (and sometimes the account) through this same outbox.
export const contactCandidateCreateSchema = z.object({
  id: uuid,
  org_id: uuid,
  created_by: uuid,
  source: z.enum(["MANUAL", "BUSINESS_CARD"]), // voice/email arrive server-side
  raw_ref: z.string().nullish(),
  status: z.literal("PENDING"),
});
export type ContactCandidateCreate = z.infer<
  typeof contactCandidateCreateSchema
>;

export const contactCandidateUpdateSchema = z.object({
  id: uuid,
  status: z.enum(["CONFIRMED", "MERGED", "DISCARDED"]),
  matched_contact_id: uuid.nullish(),
  matched_account_id: uuid.nullish(),
  resolved_at: isoTimestamp.nullish(),
});
export type ContactCandidateUpdate = z.infer<
  typeof contactCandidateUpdateSchema
>;

export const contactCreateSchema = z.object({
  id: uuid,
  org_id: uuid,
  account_id: uuid,
  name: z.string().min(1),
  job_title: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  // D50: the elected "capitão" — undefined/null leaves the DB's own
  // default (false) in place, so every existing caller is unaffected.
  is_champion: z.boolean().nullish(),
});
export type ContactCreate = z.infer<typeof contactCreateSchema>;

// Quick-create from a card (D43): forces lead-source attribution at first
// contact. Mirrors the DB checks so a bad payload fails at capture, not replay:
// OTHER needs source_detail (D8); referral sources need the referring account (D7).
export const accountCreateSchema = z
  .object({
    id: uuid,
    org_id: uuid,
    name: z.string().min(1),
    account_type: z.enum(ACCOUNT_TYPES),
    city: z.string().nullish(),
    territory_id: uuid,
    owner_id: uuid,
    lead_source: z.enum(LEAD_SOURCES_ALL),
    source_detail: z.string().nullish(),
    referring_account_id: uuid.nullish(),
  })
  .refine((a) => a.lead_source !== "OTHER" || Boolean(a.source_detail), {
    message: "OTHER lead source needs a word on where it came from (D8)",
  })
  .refine(
    (a) =>
      !(REFERRAL_LEAD_SOURCES as readonly string[]).includes(a.lead_source) ||
      Boolean(a.referring_account_id),
    { message: "referral lead sources need the referring account (D7)" },
  );
export type AccountCreate = z.infer<typeof accountCreateSchema>;

// D4/D7: the standalone create form (unlike the card quick-create) is allowed
// to write this — a referral lead source on the account above pairs with one
// of these, "app-layer responsibility at account creation" per the migration
// comment. account_a is always the new account, account_b the one that sent
// them your way (mirrors accounts/[id]/page.tsx's a/b phrasing).
export const accountRelationshipCreateSchema = z.object({
  id: uuid,
  org_id: uuid,
  account_a_id: uuid,
  relationship_type: z.enum(RELATIONSHIP_TYPES),
  account_b_id: uuid,
  created_by: uuid.nullish(),
});
export type AccountRelationshipCreate = z.infer<
  typeof accountRelationshipCreateSchema
>;

// Task 10 (D-routine): the DISPLAY_VERIFIED disposition fan-out is a scalar
// edit, LWW-guarded like next_action's — same shape, one field.
export const accountUpdateSchema = z.object({
  id: uuid,
  display_last_verified_at: isoTimestamp.nullish(),
});
export type AccountUpdate = z.infer<typeof accountUpdateSchema>;

// Deal create travels as ONE op: the stage gate demands opportunity + open
// next_action in the same transaction, so first_action rides inside the
// payload and the backend replays both through create_opportunity_with_action.
export const opportunityCreateSchema = z
  .object({
    id: uuid,
    org_id: uuid,
    name: z.string().min(1),
    primary_account_id: uuid,
    territory_id: uuid,
    owner_id: uuid,
    stage: z.enum(OPPORTUNITY_STAGES).default("IDENTIFIED"),
    current_status: z.string().min(1),
    current_blocker: z.string().nullish(),
    estimated_revenue: z.number().nonnegative().nullish(),
    probability: z.number().int().min(0).max(100).nullish(),
    expected_close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    product: z.string().nullish(),
    competitor: z.string().nullish(),
    // Nullable since the quote flow (2026-09-01): a quote asks WHO it is for,
    // not where the deal came from — HubSpot's own defaults answer the source
    // when the bridge creates the deal there. The full deal form still
    // requires one; that requirement lives in the form, matching the column,
    // which dropped its NOT NULL the same day.
    lead_source: z.enum(LEAD_SOURCES_ALL).nullish(),
    source_detail: z.string().nullish(),
    referring_account_id: uuid.nullish(),
    project_id: uuid.nullish(),
    /** The person this quote is FOR — a contact of the account. */
    contact_id: uuid.nullish(),
    first_action: z.object({
      id: uuid,
      action: z.string().min(1),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      objective: z.enum(VISIT_OBJECTIVES).nullish(),
      objective_detail: z.string().nullish(),
      kind: z.enum(["SAMPLE_FOLLOW_UP", "QUOTE_FOLLOW_UP", "VISIT", "OTHER"]).nullish(),
    }),
  })
  .refine((o) => o.lead_source !== "OTHER" || Boolean(o.source_detail), {
    message: "OTHER lead source needs a word on where it came from (D8)",
  })
  .refine(
    (o) =>
      !o.lead_source ||
      !(REFERRAL_LEAD_SOURCES as readonly string[]).includes(o.lead_source) ||
      Boolean(o.referring_account_id),
    { message: "referral lead sources need the referring account (D7)" },
  );
export type OpportunityCreate = z.infer<typeof opportunityCreateSchema>;

// Scalar deal edits (stage advance included) ride the D61 LWW path.
export const opportunityUpdateSchema = z.object({
  id: uuid,
  stage: z.enum(OPPORTUNITY_STAGES).optional(),
  current_status: z.string().min(1).optional(),
  current_blocker: z.string().nullish(),
  estimated_revenue: z.number().nonnegative().nullish(),
  probability: z.number().int().min(0).max(100).nullish(),
  expected_close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
export type OpportunityUpdate = z.infer<typeof opportunityUpdateSchema>;

export const ENTITY_TABLES = {
  activity: "activities",
  next_action: "next_actions",
  activity_account: "activity_accounts",
  activity_contact: "activity_contacts",
  voice_capture: "voice_captures",
  contact_candidate: "contact_candidates",
  contact: "contacts",
  account: "accounts",
  account_relationship: "account_relationships",
  opportunity: "opportunities",
} as const;
export type EntityType = keyof typeof ENTITY_TABLES;

export const outboxPayloadSchemas: Record<string, z.ZodTypeAny> = {
  "activity:create": activityCreateSchema,
  "activity:update": activityUpdateSchema,
  "next_action:create": nextActionCreateSchema,
  "next_action:update": nextActionUpdateSchema,
  "voice_capture:create": voiceCaptureCreateSchema,
  "voice_capture:update": voiceCaptureUpdateSchema,
  "contact_candidate:create": contactCandidateCreateSchema,
  "contact_candidate:update": contactCandidateUpdateSchema,
  "contact:create": contactCreateSchema,
  "account:create": accountCreateSchema,
  "account:update": accountUpdateSchema,
  "account_relationship:create": accountRelationshipCreateSchema,
  "opportunity:create": opportunityCreateSchema,
  "opportunity:update": opportunityUpdateSchema,
};
