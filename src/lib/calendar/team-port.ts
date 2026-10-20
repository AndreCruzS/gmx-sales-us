// THE TEAM CALENDAR'S TWO PORTS (spec 2026-10-12). One Google Calendar for
// the whole team, owned by a desk account, shared with the admins; events
// flow both ways. The core (team-sync.ts) only knows these interfaces, so
// it is proven with fakes and the adapters stay thin.

export const TEAM_CALENDAR_SUMMARY = "GMX Sales Team";

/** An event as the calendar holds it. Private properties ride back as ids. */
export interface TeamEvent {
  eventId: string;
  /** Start day, YYYY-MM-DD — all-day events keep the day, timed ones lose the clock. */
  date: string;
  title: string;
  nextActionId: string | null;
  membershipId: string | null;
  cancelled: boolean;
}

export interface TeamEventPayload {
  date: string;
  title: string;
  description: string;
  nextActionId: string;
  membershipId: string;
  /** App-born: the event is all-day on the visit's day and the app sets it.
   *  Google-born: the admin's own date and clock are left alone. */
  pinDate: boolean;
}

export interface TeamCalendarPort {
  findCalendarByName(summary: string): Promise<string | null>;
  createCalendar(summary: string): Promise<string>;
  calendarExists(calendarId: string): Promise<boolean>;
  /** "Make changes to events". Inserting for an existing scope updates it. */
  grantWriter(calendarId: string, email: string): Promise<void>;
  /** "See all event details" — a rep's mirror is read, never edited. */
  grantReader(calendarId: string, email: string): Promise<void>;
  listEvents(calendarId: string, fromDate: string, toDate: string): Promise<TeamEvent[]>;
  /** Returns the new event id. */
  insertEvent(calendarId: string, e: TeamEventPayload): Promise<string>;
  updateEvent(calendarId: string, eventId: string, e: TeamEventPayload): Promise<void>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

/** A visit as the app holds it — a next_actions row of kind VISIT. */
export interface VisitRow {
  id: string;
  action: string;
  due_date: string;
  completed_at: string | null;
  owner_id: string;
  objective: string | null;
  calendar_event_id: string | null;
  calendar_origin: "app" | "google" | null;
  accountName: string | null;
  ownerFirstName: string;
}

export interface TeamCalendarStore {
  getCalendar(): Promise<{ googleCalendarId: string } | null>;
  saveCalendarId(id: string): Promise<void>;
  /** Every active admin's e-mail — the people the calendar is shared with. */
  listAdminEmails(): Promise<string[]>;
  /** Open visits in the window, plus completed ones that still hold an event. */
  listVisits(fromDate: string, toDate: string): Promise<VisitRow[]>;
  /** Whose grant the server uses; Google-born visits are theirs until assigned. */
  ownerMembershipId(): Promise<string>;
  markProjected(nextActionId: string, eventId: string): Promise<void>;
  clearProjection(nextActionId: string): Promise<void>;
  /** Returns the new row's id and its owner's first name, for the event's rep label. */
  importVisit(v: {
    eventId: string;
    date: string;
    title: string;
    ownerId: string;
  }): Promise<{ id: string; ownerFirstName: string }>;
  updateImported(nextActionId: string, v: { date: string; title: string }): Promise<void>;
  deleteImported(nextActionId: string): Promise<void>;
  recordResult(r: { syncedAt: string; error: string | null }): Promise<void>;
  /** Rows by id, in or out of the window — for a tagged event whose visit
   *  the window did not return: deleted, completed, or just moved. */
  lookupVisits(
    ids: string[],
  ): Promise<Map<string, { calendar_event_id: string | null; completed_at: string | null }>>;
}
