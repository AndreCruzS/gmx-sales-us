// Mirrors supabase/migrations/20260722000200_enums.sql. These constants render
// the capture form with no network (part of the D56 offline working set).

export const ACTIVITY_TYPES = [
  "DEALER_VISIT",
  "DISTRIBUTOR_VISIT",
  "CONTRACTOR_MEETING",
  "ARCHITECT_MEETING",
  "JOBSITE_VISIT",
  "PK_TRAINING",
  "PHONE_CALL",
  "QUOTE_FOLLOWUP",
  "SAMPLE_FOLLOWUP",
  "EMAIL",
  "OTHER",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_OUTCOMES = [
  "RELATIONSHIP_DEVELOPMENT",
  "OPPORTUNITY_IDENTIFIED",
  "PROJECT_IDENTIFIED",
  "QUOTE_REQUESTED",
  "SAMPLE_REQUESTED",
  "TECHNICAL_SUPPORT_NEEDED",
  "TRAINING_NEEDED",
  "NO_IMMEDIATE_OPPORTUNITY",
] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

// D48 — required at scheduling, picklist + free text.
export const VISIT_OBJECTIVES = [
  "COLLECT_QUOTE",
  "MEET_CONTRACTOR",
  "CONVERT_STOCKING_DEALER",
  "FOLLOW_UP_LEAD",
  "PK_DELIVERY",
  "MERCHANDISING_CHECK",
  "RELATIONSHIP_MAINTENANCE",
  "OTHER",
] as const;
export type VisitObjective = (typeof VISIT_OBJECTIVES)[number];

// Spec §2 mobile sheet: these five surface first; the rest behind "more".
export const LEAD_SOURCES_PRIMARY = [
  "REFERRAL_DEALER",
  "PK_CLASS",
  "JOBSITE",
  "EXISTING_RELATIONSHIP",
  "INBOUND_WEB",
] as const;

export const LEAD_SOURCES_ALL = [
  "REFERRAL_DEALER",
  "REFERRAL_DISTRIBUTOR",
  "REFERRAL_CONTRACTOR",
  "REFERRAL_ARCHITECT",
  "SPEC_DRIVEN",
  "REFERRAL_OTHER",
  "PK_CLASS",
  "JOBSITE",
  "COLD_OUTREACH",
  "EXISTING_RELATIONSHIP",
  "TRADE_SHOW",
  "INBOUND_WEB",
  "MARKETING_CAMPAIGN",
  "MANUFACTURER_LEAD",
  "SOCIAL",
  "OTHER",
] as const;
export type LeadSource = (typeof LEAD_SOURCES_ALL)[number];

// D7 — these require a referring account and write an account_relationships row.
export const REFERRAL_LEAD_SOURCES: readonly LeadSource[] = [
  "REFERRAL_DEALER",
  "REFERRAL_DISTRIBUTOR",
  "REFERRAL_CONTRACTOR",
  "REFERRAL_ARCHITECT",
  "SPEC_DRIVEN",
  "REFERRAL_OTHER",
];
