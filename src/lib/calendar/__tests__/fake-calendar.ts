// A Google Calendar in memory, shared by the team and mirror tests.

import type { TeamCalendarPort, TeamEvent, TeamEventPayload } from "../team-port";

export class FakeCalendar implements TeamCalendarPort {
  calendars = new Map<string, string>();
  acls = new Map<string, Map<string, string>>();
  events = new Map<string, TeamEvent[]>();
  seq = 0;
  async findCalendarByName(summary: string) {
    for (const [id, s] of this.calendars) if (s === summary) return id;
    return null;
  }
  async createCalendar(summary: string) {
    const id = `cal-${++this.seq}`;
    this.calendars.set(id, summary);
    this.acls.set(id, new Map());
    this.events.set(id, []);
    return id;
  }
  async calendarExists(id: string) {
    return this.calendars.has(id);
  }
  async grantWriter(id: string, email: string) {
    this.acls.get(id)!.set(email, "writer");
  }
  async grantReader(id: string, email: string) {
    this.acls.get(id)!.set(email, "reader");
  }
  async listEvents(id: string, from: string, to: string) {
    return (this.events.get(id) ?? []).filter((e) => e.date >= from && e.date <= to);
  }
  async insertEvent(id: string, e: TeamEventPayload) {
    const eventId = `ev-${++this.seq}`;
    this.events.get(id)!.push({
      eventId,
      date: e.date,
      title: e.title,
      nextActionId: e.nextActionId,
      membershipId: e.membershipId,
      cancelled: false,
    });
    return eventId;
  }
  async updateEvent(id: string, eventId: string, e: TeamEventPayload) {
    const ev = this.events.get(id)!.find((x) => x.eventId === eventId)!;
    Object.assign(ev, {
      date: e.date,
      title: e.title,
      nextActionId: e.nextActionId,
      membershipId: e.membershipId,
    });
  }
  async deleteEvent(id: string, eventId: string) {
    this.events.set(
      id,
      this.events.get(id)!.filter((x) => x.eventId !== eventId),
    );
  }
  /** Test helper: an event somebody typed into Google by hand. */
  handMade(id: string, date: string, title: string) {
    const eventId = `ev-${++this.seq}`;
    this.events.get(id)!.push({
      eventId,
      date,
      title,
      nextActionId: null,
      membershipId: null,
      cancelled: false,
    });
    return eventId;
  }
}
