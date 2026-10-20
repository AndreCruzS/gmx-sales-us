// TeamCalendarPort over the Google Calendar REST API, acting AS THE OWNER of
// the team calendar through their OAuth grant (not a service account — none
// was ever issued). Every call renews the access token from the refresh
// token first; the cache in oauth.ts makes that free within the hour.

import { accessTokenFromRefresh, type OAuthClient } from "@/lib/google/oauth";
import type { TeamCalendarPort, TeamEvent, TeamEventPayload } from "./team-port";

const API = "https://www.googleapis.com/calendar/v3";
const APP = "commercial-os";

interface GEvent {
  id: string;
  summary?: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
}

function cal(id: string): string {
  return `calendars/${encodeURIComponent(id)}`;
}

function allDay(date: string) {
  const dayAfter = new Date(`${date}T00:00:00Z`);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  return { start: { date }, end: { date: dayAfter.toISOString().slice(0, 10) } };
}

export class GoogleTeamCalendar implements TeamCalendarPort {
  constructor(
    private client: OAuthClient,
    private refreshToken: string,
    /** A REP'S OWN calendar (2026-10-20): list only the events this app
     *  wrote, so a personal appointment is never even read, and paint ours
     *  in one colour so they stand apart from the rep's own. */
    private opts: { onlyOurs?: boolean; colorId?: string } = {},
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const token = await accessTokenFromRefresh(this.client, this.refreshToken);
    return fetch(`${API}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private async ok(res: Response, what: string): Promise<Response> {
    if (!res.ok) throw new Error(`${what} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  async findCalendarByName(summary: string): Promise<string | null> {
    let pageToken = "";
    do {
      const res = await this.ok(
        await this.call(
          "GET",
          `users/me/calendarList?minAccessRole=owner${pageToken ? `&pageToken=${pageToken}` : ""}`,
        ),
        "calendarList.list",
      );
      const body = (await res.json()) as {
        items?: { id: string; summary?: string }[];
        nextPageToken?: string;
      };
      const hit = (body.items ?? []).find((c) => c.summary === summary);
      if (hit) return hit.id;
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);
    return null;
  }

  async createCalendar(summary: string): Promise<string> {
    const res = await this.ok(await this.call("POST", "calendars", { summary }), "calendars.insert");
    return ((await res.json()) as { id: string }).id;
  }

  async deleteCalendar(calendarId: string): Promise<void> {
    const res = await this.call("DELETE", cal(calendarId));
    if (res.status === 404 || res.status === 410) return;
    await this.ok(res, "calendars.delete");
  }

  async calendarExists(calendarId: string): Promise<boolean> {
    const res = await this.call("GET", cal(calendarId));
    if (res.status === 404 || res.status === 410) return false;
    await this.ok(res, "calendars.get");
    return true;
  }

  async grantWriter(calendarId: string, email: string): Promise<void> {
    await this.grant(calendarId, email, "writer");
  }

  async grantReader(calendarId: string, email: string): Promise<void> {
    // Sent once per address (the store remembers it), so Google's invitation
    // e-mail is what puts the calendar in front of the rep.
    await this.grant(calendarId, email, "reader", true);
  }

  private async grant(calendarId: string, email: string, role: "writer" | "reader", notify = false) {
    await this.ok(
      await this.call("POST", `${cal(calendarId)}/acl?sendNotifications=${notify}`, {
        role,
        scope: { type: "user", value: email },
      }),
      `acl.insert(${email})`,
    );
  }

  async listEvents(calendarId: string, fromDate: string, toDate: string): Promise<TeamEvent[]> {
    const out: TeamEvent[] = [];
    let pageToken = "";
    do {
      const q = new URLSearchParams({
        maxResults: "250",
        singleEvents: "true",
        showDeleted: "true",
        timeMin: `${fromDate}T00:00:00Z`,
        timeMax: `${toDate}T23:59:59Z`,
        ...(pageToken ? { pageToken } : {}),
      });
      if (this.opts.onlyOurs) q.append("privateExtendedProperty", `app=${APP}`);
      const res = await this.ok(await this.call("GET", `${cal(calendarId)}/events?${q}`), "events.list");
      const body = (await res.json()) as { items?: GEvent[]; nextPageToken?: string };
      for (const it of body.items ?? []) {
        const priv = it.extendedProperties?.private ?? {};
        const ours = priv.app === APP;
        out.push({
          eventId: it.id,
          date: it.start?.date ?? it.start?.dateTime?.slice(0, 10) ?? "",
          title: it.summary ?? "(no title)",
          nextActionId: ours ? (priv.next_action_id ?? null) : null,
          membershipId: ours ? (priv.membership_id ?? null) : null,
          cancelled: it.status === "cancelled",
        });
      }
      pageToken = body.nextPageToken ?? "";
    } while (pageToken);
    return out.filter((e) => e.date !== "");
  }

  private props(e: TeamEventPayload) {
    return {
      extendedProperties: {
        private: { app: APP, next_action_id: e.nextActionId, membership_id: e.membershipId },
      },
    };
  }

  async insertEvent(calendarId: string, e: TeamEventPayload): Promise<string> {
    const res = await this.ok(
      await this.call("POST", `${cal(calendarId)}/events`, {
        summary: e.title,
        description: e.description,
        ...allDay(e.date),
        ...(this.opts.colorId ? { colorId: this.opts.colorId } : {}),
        ...this.props(e),
      }),
      "events.insert",
    );
    return ((await res.json()) as { id: string }).id;
  }

  async updateEvent(calendarId: string, eventId: string, e: TeamEventPayload): Promise<void> {
    // PATCH keeps what Google holds that we do not model (location, guests,
    // a clock time an admin typed) and changes only what the app owns.
    // pinDate: all-day on the visit's day; otherwise Google's own date and
    // clock stand.
    await this.ok(
      await this.call("PATCH", `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, {
        summary: e.title,
        ...(e.description ? { description: e.description } : {}),
        ...(e.pinDate ? allDay(e.date) : {}),
        ...this.props(e),
      }),
      "events.patch",
    );
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const res = await this.call("DELETE", `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`);
    if (res.status === 404 || res.status === 410) return;
    await this.ok(res, "events.delete");
  }
}
