// TeamCalendarStore over the service-role client, scoped to ONE org by the
// route that built it — the same posture as the email store. Visits are
// next_actions rows of kind VISIT (or null: the trigger has not classified
// them yet, read as a visit, the Agenda's rule).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamCalendarStore, VisitRow } from "./team-port";

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
    return ((data ?? []) as unknown as Raw[]).map((r) => ({
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
    }));
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
