// Zod at the outbox boundary (build brief §4): every payload the SyncEngine
// replays against Supabase is validated here first. Server ids are client-
// minted UUIDs (D57) — `id` is the idempotency key.

import { z } from "zod";
import { ACTIVITY_OUTCOMES, ACTIVITY_TYPES, VISIT_OBJECTIVES } from "./enums";

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

export const ENTITY_TABLES = {
  activity: "activities",
  next_action: "next_actions",
  activity_account: "activity_accounts",
  activity_contact: "activity_contacts",
  voice_capture: "voice_captures",
} as const;
export type EntityType = keyof typeof ENTITY_TABLES;

export const outboxPayloadSchemas: Record<string, z.ZodTypeAny> = {
  "activity:create": activityCreateSchema,
  "next_action:create": nextActionCreateSchema,
  "next_action:update": nextActionUpdateSchema,
  "voice_capture:create": voiceCaptureCreateSchema,
  "voice_capture:update": voiceCaptureUpdateSchema,
};
