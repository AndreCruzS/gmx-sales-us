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

export const ENTITY_TABLES = {
  activity: "activities",
  next_action: "next_actions",
  activity_account: "activity_accounts",
  activity_contact: "activity_contacts",
} as const;
export type EntityType = keyof typeof ENTITY_TABLES;

export const outboxPayloadSchemas: Record<string, z.ZodTypeAny> = {
  "activity:create": activityCreateSchema,
  "next_action:create": nextActionCreateSchema,
  "next_action:update": nextActionUpdateSchema,
};
