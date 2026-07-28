// CalendarPort over the Google Calendar REST API. The service account acts as
// ITSELF here (no sub): it owns every rep calendar and shares them by ACL —
// which is exactly what makes "no default rule, no domain-wide rule" (spec §6)
// enforceable: nobody sees a calendar they weren't explicitly granted.

import {
  serviceAccountToken,
  type ServiceAccountKey,
} from "@/lib/google/auth";
import type { CalendarPort, EventPayload, ProjectedEvent } from "./port";

const SCOPE = "https://www.googleapis.com/auth/calendar";
const API = "https://www.googleapis.com/calendar/v3";
const PROP = "next_action_id";

export class GoogleCalendarPort implements CalendarPort {
  constructor(private key: ServiceAccountKey) {}

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const token = await serviceAccountToken(this.key, SCOPE);
    return fetch(`${API}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async createCalendar(summary: string): Promise<string> {
    const res = await this.call("POST", "calendars", { summary });
    if (!res.ok) {
      throw new Error(`calendars.insert ${res.status}: ${await res.text()}`);
    }
    return ((await res.json()) as { id: string }).id;
  }

  async calendarExists(calendarId: string): Promise<boolean> {
    const res = await this.call(
      "GET",
      `calendars/${encodeURIComponent(calendarId)}`,
    );
    if (res.status === 404 || res.status === 410) return false;
    if (!res.ok) throw new Error(`calendars.get ${res.status}`);
    return true;
  }

  async grantReader(calendarId: string, email: string): Promise<void> {
    // acl.insert with an existing rule for the same scope updates it — the
    // re-assert-on-every-pass healing the core relies on.
    const res = await this.call(
      "POST",
      `calendars/${encodeURIComponent(calendarId)}/acl`,
      { role: "reader", scope: { type: "user", value: email } },
    );
    if (!res.ok) {
      throw new Error(`acl.insert(${email}) ${res.status}: ${await res.text()}`);
    }
  }

  async listProjectedEvents(calendarId: string): Promise<ProjectedEvent[]> {
    const events: ProjectedEvent[] = [];
    let pageToken = "";
    do {
      const res = await this.call(
        "GET",
        `calendars/${encodeURIComponent(calendarId)}/events?maxResults=250&privateExtendedProperty=app%3Dcommercial-os${
          pageToken ? `&pageToken=${pageToken}` : ""
        }`,
      );
      if (!res.ok) throw new Error(`events.list ${res.status}`);
      const body = (await res.json()) as {
        items?: {
          id: string;
          summary?: string;
          start?: { date?: string };
          extendedProperties?: { private?: Record<string, string> };
          status?: string;
        }[];
        nextPageToken?: string;
      };
      for (const it of body.items ?? []) {
        const nextActionId = it.extendedProperties?.private?.[PROP];
        if (!nextActionId || it.status === "cancelled") continue;
        events.push({
          eventId: it.id,
          nextActionId,
          date: it.start?.date ?? "",
          title: it.summary ?? "",
        });
      }
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);
    return events;
  }

  private eventBody(e: EventPayload) {
    // All-day events: the model tracks commitment days (D46), not clock times.
    const dayAfter = new Date(`${e.date}T00:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    return {
      summary: e.title,
      description: e.description,
      start: { date: e.date },
      end: { date: dayAfter.toISOString().slice(0, 10) },
      extendedProperties: {
        private: { app: "commercial-os", [PROP]: e.nextActionId },
      },
    };
  }

  async insertEvent(calendarId: string, e: EventPayload): Promise<void> {
    const res = await this.call(
      "POST",
      `calendars/${encodeURIComponent(calendarId)}/events`,
      this.eventBody(e),
    );
    if (!res.ok) {
      throw new Error(`events.insert ${res.status}: ${await res.text()}`);
    }
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    e: EventPayload,
  ): Promise<void> {
    const res = await this.call(
      "PUT",
      `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      this.eventBody(e),
    );
    if (!res.ok) {
      throw new Error(`events.update ${res.status}: ${await res.text()}`);
    }
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const res = await this.call(
      "DELETE",
      `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`events.delete ${res.status}`);
    }
  }
}
