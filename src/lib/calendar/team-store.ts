// TeamCalendarStore over the service-role client, scoped to ONE org by the
// route that built it — the same posture as the email store. Visits are
// next_actions rows of kind VISIT (or null: the trigger has not classified
// them yet, read as a visit, the Agenda's rule).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MirrorRep, MirrorStore } from "./mirror-sync";
import type { TeamCalendarStore, VisitRow } from "./team-port";

const EVENT_SCOPES: ReadonlySet<string> = new Set([
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar",
]);

const OWNER_EMBED = "memberships!next_actions_owner_id_fkey(users(full_name))";
const VISIT_COLS = `id, action, due_date, completed_at, owner_id, objective, calendar_event_id, calendar_origin, accounts(name), ${OWNER_EMBED}`;

interface Raw {
  id: string;
  action: string;
  due_date: string;
  completed_at: string | null;
  owner_id: string;
  objective: string | null;
  calendar_event_id: string | null;
  calendar_origin: "app" | "google" | null;
  accounts: { name: string } | null;
  memberships: { users: { full_name: string | null } | null } | null;
}

function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

function toVisit(r: Raw): VisitRow {
  return {
    id: r.id,
    action: r.action,
    due_date: r.due_date,
    completed_at: r.completed_at,
    owner_id: r.owner_id,
    objective: r.objective,
    calendar_event_id: r.calendar_event_id,
    calendar_origin: r.calendar_origin,
    accountName: r.accounts?.name ?? null,
    ownerFirstName: firstName(r.memberships?.users?.full_name),
  };
}

export class SupabaseTeamCalendarStore implements TeamCalendarStore {
  constructor(
    private service: SupabaseClient,
    private orgId: string,
    private owner: string,
  ) {}

  async getCalendar() {
    const { data } = await this.service
      .from("team_calendars")
      .select("google_calendar_id")
      .eq("org_id", this.orgId)
      .maybeSingle();
    // The row exists before the calendar does (the route registers the
    // owner first); null here means "not found or created yet".
    const id = (data?.google_calendar_id as string | null | undefined) ?? null;
    return id ? { googleCalendarId: id } : null;
  }

  async saveCalendarId(id: string) {
    const { error } = await this.service.from("team_calendars").upsert(
      { org_id: this.orgId, google_calendar_id: id, owner_membership_id: this.owner },
      { onConflict: "org_id" },
    );
    if (error) throw new Error(`team_calendars upsert failed: ${error.message}`);
  }

  async listAdminEmails() {
    // The owner is not on the list: the calendar is theirs already, and
    // asking Google to make its owner a "writer" is a request with no
    // documented answer (review, 2026-10-12).
    const { data, error } = await this.service
      .from("memberships")
      .select("id, users(email)")
      .eq("org_id", this.orgId)
      .eq("role", "admin")
      .eq("status", "active")
      .neq("id", this.owner);
    if (error) throw new Error(`admins read failed: ${error.message}`);
    return ((data ?? []) as unknown as { users: { email: string } | null }[])
      .map((r) => r.users?.email)
      .filter((e): e is string => Boolean(e))
      .sort();
  }

  async lookupVisits(ids: string[]) {
    const out = new Map<string, { calendar_event_id: string | null; completed_at: string | null }>();
    if (ids.length === 0) return out;
    const { data, error } = await this.service
      .from("next_actions")
      .select("id, calendar_event_id, completed_at")
      .eq("org_id", this.orgId)
      .in("id", ids.slice(0, 500));
    if (error) throw new Error(`next_actions lookup failed: ${error.message}`);
    for (const r of (data ?? []) as { id: string; calendar_event_id: string | null; completed_at: string | null }[]) {
      out.set(r.id, { calendar_event_id: r.calendar_event_id, completed_at: r.completed_at });
    }
    return out;
  }

  async ownerMembershipId() {
    return this.owner;
  }

  async listVisits(fromDate: string, toDate: string): Promise<VisitRow[]> {
    const { data, error } = await this.service
      .from("next_actions")
      .select(VISIT_COLS)
      .eq("org_id", this.orgId)
      .or("kind.eq.VISIT,kind.is.null")
      .gte("due_date", fromDate)
      .lte("due_date", toDate)
      .or("completed_at.is.null,calendar_event_id.not.is.null")
      .order("due_date")
      .limit(500);
    if (error) throw new Error(`next_actions read failed: ${error.message}`);
    return ((data ?? []) as unknown as Raw[]).map(toVisit);
  }

  async markProjected(id: string, eventId: string) {
    const { error } = await this.service
      .from("next_actions")
      .update({ calendar_event_id: eventId, calendar_origin: "app" })
      .eq("id", id);
    if (error) throw new Error(`markProjected failed: ${error.message}`);
  }

  async clearProjection(id: string) {
    const { error } = await this.service
      .from("next_actions")
      .update({ calendar_event_id: null })
      .eq("id", id);
    if (error) throw new Error(`clearProjection failed: ${error.message}`);
  }

  async importVisit(v: { eventId: string; date: string; title: string; ownerId: string }) {
    const { data, error } = await this.service
      .from("next_actions")
      .insert({
        org_id: this.orgId,
        action: v.title,
        due_date: v.date,
        owner_id: v.ownerId,
        kind: "VISIT",
        calendar_event_id: v.eventId,
        calendar_origin: "google",
      })
      .select(`id, ${OWNER_EMBED}`)
      .single();
    if (error) throw new Error(`importVisit failed: ${error.message}`);
    const row = data as unknown as Pick<Raw, "id" | "memberships">;
    return { id: row.id, ownerFirstName: firstName(row.memberships?.users?.full_name) };
  }

  async updateImported(id: string, v: { date: string; title: string }) {
    const { error } = await this.service
      .from("next_actions")
      .update({ due_date: v.date, action: v.title })
      .eq("id", id)
      .eq("calendar_origin", "google");
    if (error) throw new Error(`updateImported failed: ${error.message}`);
  }

  async deleteImported(id: string) {
    const { error } = await this.service
      .from("next_actions")
      .delete()
      .eq("id", id)
      .eq("calendar_origin", "google")
      .is("completed_at", null);
    if (error) throw new Error(`deleteImported failed: ${error.message}`);
  }

  async recordResult(r: { syncedAt: string; error: string | null }) {
    await this.service
      .from("team_calendars")
      .update({ last_synced_at: r.syncedAt, last_error: r.error })
      .eq("org_id", this.orgId);
  }
}

/** The reps' mirrors (mirror-sync.ts), over the same service-role client. */
export class SupabaseMirrorStore implements MirrorStore {
  constructor(
    private service: SupabaseClient,
    private orgId: string,
    private owner: string,
  ) {}

  async listReps(): Promise<MirrorRep[]> {
    const { data, error } = await this.service
      .from("memberships")
      .select("id, users(email, full_name)")
      .eq("org_id", this.orgId)
      .eq("role", "rep")
      .eq("status", "active")
      .neq("id", this.owner);
    if (error) throw new Error(`reps read failed: ${error.message}`);
    const reps = ((data ?? []) as unknown as {
      id: string;
      users: { email: string | null; full_name: string | null } | null;
    }[]).filter((r) => r.users?.email);
    // A rep's own grant counts when it can write events in their calendar.
    const { data: conns } = await this.service
      .from("google_connections")
      .select("membership_id, refresh_token, scopes")
      .in("membership_id", reps.map((r) => r.id));
    const grant = new Map<string, string>();
    for (const c of (conns ?? []) as {
      membership_id: string;
      refresh_token: string | null;
      scopes: string[] | null;
    }[]) {
      if (c.refresh_token && (c.scopes ?? []).some((x) => EVENT_SCOPES.has(x))) {
        grant.set(c.membership_id, c.refresh_token);
      }
    }
    return reps.map((r) => ({
      membershipId: r.id,
      email: r.users!.email as string,
      fullName: (r.users!.full_name ?? "").trim() || (r.users!.email as string),
      ownGrant: grant.get(r.id) ?? null,
    }));
  }

  async getMirror(membershipId: string) {
    const { data } = await this.service
      .from("rep_mirror_calendars")
      .select("google_calendar_id, shared_with")
      .eq("membership_id", membershipId)
      .maybeSingle();
    if (!data?.google_calendar_id) return null;
    return {
      calendarId: data.google_calendar_id as string,
      sharedWith: (data.shared_with as string | null) ?? null,
    };
  }

  async saveMirror(membershipId: string, m: { calendarId: string; sharedWith: string | null }) {
    const { error } = await this.service.from("rep_mirror_calendars").upsert(
      {
        membership_id: membershipId,
        org_id: this.orgId,
        google_calendar_id: m.calendarId,
        shared_with: m.sharedWith,
      },
      { onConflict: "membership_id" },
    );
    if (error) throw new Error(`rep_mirror_calendars upsert failed: ${error.message}`);
  }

  async listOpenVisits(fromDate: string, toDate: string): Promise<VisitRow[]> {
    const { data, error } = await this.service
      .from("next_actions")
      .select(VISIT_COLS)
      .eq("org_id", this.orgId)
      .or("kind.eq.VISIT,kind.is.null")
      .is("completed_at", null)
      .gte("due_date", fromDate)
      .lte("due_date", toDate)
      .order("due_date")
      .limit(1000);
    if (error) throw new Error(`next_actions read failed: ${error.message}`);
    return ((data ?? []) as unknown as Raw[]).map(toVisit);
  }

  async recordMirror(membershipId: string, r: { syncedAt: string; error: string | null }) {
    await this.service
      .from("rep_mirror_calendars")
      .update({ last_synced_at: r.syncedAt, last_error: r.error })
      .eq("membership_id", membershipId);
  }
}
