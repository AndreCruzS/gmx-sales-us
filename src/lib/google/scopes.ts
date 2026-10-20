// WHAT EACH ROLE ASKS GOOGLE FOR, in one place — the setup page asks for it,
// the banner checks a grant against it, and the server reads it back.
//
// A REP asks for what a rep does: send a quote, put a visit on their
// calendar, and (Andre, 2026-10-20) let the app READ their mail, so a
// conversation with a client on the CRM lands on that client's record. Only
// reps: an admin's mailbox is not a patch, and is never read.
// An ADMIN asks for the whole Calendar scope, because the team calendar is
// created and shared from their account (spec 2026-10-12) and neither
// creating a calendar nor sharing it fits inside calendar.events.

export const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_READ = "https://www.googleapis.com/auth/gmail.readonly";
export const CALENDAR_EVENTS = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_FULL = "https://www.googleapis.com/auth/calendar";

export const REP_SCOPES: readonly string[] = [GMAIL_SEND, GMAIL_READ, CALENDAR_EVENTS];
export const ADMIN_SCOPES: readonly string[] = [GMAIL_SEND, CALENDAR_FULL];

export function scopesFor(role: string | null | undefined): readonly string[] {
  return role === "admin" ? ADMIN_SCOPES : REP_SCOPES;
}

/** What the role asks for that this grant does not hold — empty when whole. */
export function missingScopes(
  role: string | null | undefined,
  granted: readonly string[] | null | undefined,
): string[] {
  const have = new Set(granted ?? []);
  return scopesFor(role).filter((s) => !have.has(s));
}
