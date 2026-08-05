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

export const ACCOUNT_TYPES = [
  "DISTRIBUTOR",
  "DEALER",
  "CONTRACTOR",
  "ARCHITECT",
  "BUILDER",
  "OTHER",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

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

// Enum value → readable label. "PK" is the trade's own shorthand (Product
// Knowledge class) and must stay uppercase; CSS `capitalize` would render it
// "Pk", which reads as a typo to a rep.
const ACRONYMS = new Set(["pk", "a&d", "gc"]);

export function humanize(value: string): string {
  const text = value
    .replaceAll("_", " ")
    .toLowerCase()
    .split(" ")
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word))
    .join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// D7 — these require a referring account and write an account_relationships row.
export const REFERRAL_LEAD_SOURCES: readonly LeadSource[] = [
  "REFERRAL_DEALER",
  "REFERRAL_DISTRIBUTOR",
  "REFERRAL_CONTRACTOR",
  "REFERRAL_ARCHITECT",
  "SPEC_DRIVEN",
  "REFERRAL_OTHER",
];

// Mirrors opportunity_stage. WON/LOST are terminal; the stage gate exempts
// them from the open-next-action requirement (Rule 3).
export const OPPORTUNITY_STAGES = [
  "IDENTIFIED", "QUALIFIED", "DEVELOPMENT", "QUOTE", "DECISION",
  "WON", "LOST", "ON_HOLD",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

// Mirrors relationship_type in supabase/migrations/20260722000200_enums.sql.
// The account creation fan-out (D4/D7) only ever writes REFERRED_BY, but the
// full set is kept here so the schema matches the DB enum, not a subset of it.
export const RELATIONSHIP_TYPES = [
  "SUPPLIES",
  "PURCHASES_FROM",
  "WORKS_WITH",
  "REFERRED_BY",
  "REFERRED_TO",
  "SPECIFIES_THROUGH",
  "SUPPORTS",
  "PREFERRED_PARTNER",
  "INSTALLER_FOR",
  "ARCHITECT_FOR",
  "DEVELOPER_FOR",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];
