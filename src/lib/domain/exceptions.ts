// One name per exception, in the language the business uses out loud.
//
// The generic humanize() turns NO_CHAMPION into "No champion", which is the
// column name read aloud rather than the thing itself. Reps and managers say
// "captain", "gone quiet", "wall not verified" — so those are the words the
// screens use, and they are defined once here rather than per page.
//
// `short` is the chip form for filter rows where space is a column; `label` is
// the sentence form for a list a manager reads down.

export const EXCEPTION_LABEL: Record<string, string> = {
  OPPORTUNITY_NO_NEXT_ACTION: "Deal with no next action",
  OVERDUE_FOLLOW_UP: "Follow-up overdue",
  QUOTE_NO_FOLLOW_UP: "Quote sent with no follow-up",
  STRATEGIC_ACCOUNT_QUIET: "Account gone quiet",
  OPPORTUNITY_STALE: "Deal not moving",
  PROJECT_NO_DEALER: "Project with no dealer",
  CONTRACTOR_RELATIONSHIP_STALE: "Contractor gone quiet",
  NEW_ACCOUNT_NO_FOLLOW_UP: "New account, nothing booked",
  NEXT_WEEK_NOT_PLANNED: "Next week not planned",
  NO_CHAMPION: "No captain",
  DISPLAY_NOT_VERIFIED: "Display wall not verified",
};

export const EXCEPTION_SHORT: Record<string, string> = {
  STRATEGIC_ACCOUNT_QUIET: "Quiet",
  NO_CHAMPION: "No captain",
  DISPLAY_NOT_VERIFIED: "Wall not verified",
  NEW_ACCOUNT_NO_FOLLOW_UP: "No next action",
  CONTRACTOR_RELATIONSHIP_STALE: "Gone quiet",
  OVERDUE_FOLLOW_UP: "Follow-up overdue",
  QUOTE_NO_FOLLOW_UP: "Quote unchased",
  OPPORTUNITY_NO_NEXT_ACTION: "No next action",
  OPPORTUNITY_STALE: "Not moving",
  PROJECT_NO_DEALER: "No dealer",
  NEXT_WEEK_NOT_PLANNED: "Next week empty",
};

// A broken promise or money on the table is danger; hygiene the system noticed
// is attention. Kept in step with /visits and home, which draw the same line.
export const DANGER_EXCEPTION_TYPES = [
  "OVERDUE_FOLLOW_UP",
  "QUOTE_NO_FOLLOW_UP",
  "OPPORTUNITY_NO_NEXT_ACTION",
  "STRATEGIC_ACCOUNT_QUIET",
] as const;

export const DANGER_EXCEPTIONS: ReadonlySet<string> = new Set(
  DANGER_EXCEPTION_TYPES,
);

// The exceptions that hang off an account, and so belong on an account list.
export const ACCOUNT_EXCEPTION_TYPES = [
  "STRATEGIC_ACCOUNT_QUIET",
  "NO_CHAMPION",
  "DISPLAY_NOT_VERIFIED",
  "NEW_ACCOUNT_NO_FOLLOW_UP",
  "CONTRACTOR_RELATIONSHIP_STALE",
] as const;

/** Sentence form, falling back to the raw type rather than inventing one. */
export function exceptionLabel(type: string): string {
  return EXCEPTION_LABEL[type] ?? type.toLowerCase().replace(/_/g, " ");
}

/** Chip form, falling back to the sentence form. */
export function exceptionShort(type: string): string {
  return EXCEPTION_SHORT[type] ?? exceptionLabel(type);
}
