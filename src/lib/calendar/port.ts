// Calendar projection ports (spec §6). The calendar is a PROJECTION of
// next_actions — never a source of truth — so the core is a reconciliation:
// diff what Google shows against what the agenda says, and make Google agree.
// Q5 (two-way sync) is deliberately answered "one-way": the app is the sole
// author, reps read.

export interface ProjectedEvent {
  eventId: string;
  nextActionId: string; // extendedProperties.private.next_action_id
  date: string; // all-day, YYYY-MM-DD
  title: string;
}

export interface EventPayload {
  nextActionId: string;
  date: string; // due_date — the model tracks commitment DAYS (D46), not clock times
  title: string;
  description: string;
}

export interface CalendarPort {
  /** Create a calendar owned by the service account; returns its id. */
  createCalendar(summary: string): Promise<string>;
  /** True if the calendar still exists (a deleted one must be recreated). */
  calendarExists(calendarId: string): Promise<boolean>;
  /** Grant read access; roles per spec §6 — no default rule, no domain rule. */
  grantReader(calendarId: string, email: string): Promise<void>;
  /** Every event this app authored (filtered by the private property). */
  listProjectedEvents(calendarId: string): Promise<ProjectedEvent[]>;
  insertEvent(calendarId: string, e: EventPayload): Promise<void>;
  updateEvent(calendarId: string, eventId: string, e: EventPayload): Promise<void>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

export interface AgendaItemForCalendar {
  id: string;
  action: string;
  due_date: string;
  objective: string | null;
  accountName: string | null;
}

export interface CalendarStore {
  getCalendarId(): Promise<string | null>;
  saveCalendarId(googleCalendarId: string): Promise<void>;
  /** Open next actions for this membership — the projection's source. */
  listOpenNextActions(): Promise<AgendaItemForCalendar[]>;
  /** Reader emails: the rep, their manager, org admins (spec §6 ACLs). */
  listReaderEmails(): Promise<string[]>;
}
