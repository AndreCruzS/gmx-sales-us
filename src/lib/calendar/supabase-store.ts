// CalendarStore over the service-role client, scoped to one membership —
// same posture as the email store.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgendaItemForCalendar, CalendarStore } from "./port";

export class SupabaseCalendarStore implements CalendarStore {
  constructor(
    private service: SupabaseClient,
    private orgId: string,
    private membershipId: string,
  ) {}

  async getCalendarId(): Promise<string | null> {
    const { data } = await this.service
      .from("rep_calendars")
      .select("google_calendar_id")
      .eq("org_id", this.orgId)
      .eq("membership_id", this.membershipId)
      .maybeSingle();
    return (data?.google_calendar_id as string | undefined) ?? null;
  }

  async saveCalendarId(googleCalendarId: string): Promise<void> {
    const { error } = await this.service.from("rep_calendars").upsert(
      {
        org_id: this.orgId,
        membership_id: this.membershipId,
        google_calendar_id: googleCalendarId,
        status: "active",
      },
      { onConflict: "org_id,membership_id" },
    );
    if (error) throw new Error(`rep_calendars upsert failed: ${error.message}`);
  }

  async listOpenNextActions(): Promise<AgendaItemForCalendar[]> {
    const { data, error } = await this.service
      .from("next_actions")
      .select("id, action, due_date, objective, accounts(name)")
      .eq("org_id", this.orgId)
      .eq("owner_id", this.membershipId)
      .is("completed_at", null)
      .order("due_date")
      .limit(200);
    if (error) throw new Error(`next_actions read failed: ${error.message}`);
    return (
      (data as unknown as {
        id: string;
        action: string;
        due_date: string;
        objective: string | null;
        accounts: { name: string } | null;
      }[]) ?? []
    ).map((r) => ({
      id: r.id,
      action: r.action,
      due_date: r.due_date,
      objective: r.objective,
      accountName: r.accounts?.name ?? null,
    }));
  }

  async listReaderEmails(): Promise<string[]> {
    // Spec §6 ACLs: the rep, their manager, org admins. Explicit grants only.
    const { data: me } = await this.service
      .from("memberships")
      .select("manager_id, users(email)")
      .eq("id", this.membershipId)
      .single();
    const { data: admins } = await this.service
      .from("memberships")
      .select("users(email)")
      .eq("org_id", this.orgId)
      .eq("role", "admin")
      .eq("status", "active");

    const emails = new Set<string>();
    const meRow = me as unknown as {
      manager_id: string | null;
      users: { email: string } | null;
    } | null;
    if (meRow?.users?.email) emails.add(meRow.users.email);
    if (meRow?.manager_id) {
      const { data: mgr } = await this.service
        .from("memberships")
        .select("users(email)")
        .eq("id", meRow.manager_id)
        .single();
      const mgrEmail = (mgr as unknown as { users: { email: string } | null } | null)
        ?.users?.email;
      if (mgrEmail) emails.add(mgrEmail);
    }
    for (const a of (admins ?? []) as unknown as {
      users: { email: string } | null;
    }[]) {
      if (a.users?.email) emails.add(a.users.email);
    }
    return [...emails];
  }
}
