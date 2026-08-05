// SyncBackend over supabase-js — the sync layer talks to Supabase DIRECTLY
// (D3/D62). Vercel stays out of the offline hot path. RLS re-checks every
// replay because these calls carry the rep's own JWT.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SyncRejectionError,
  type OrgSettings,
  type SyncBackend,
  type WorkingSet,
} from "./types";

// routine_items (D-routine) falls back to these when an org hasn't set its
// own windows yet — mirrors the coalesce() defaults in the view itself.
const DEFAULT_DISPLAY_ROUTINE_MONTHS = 4;
const DEFAULT_DISPLAY_VERIFY_MONTHS = 6;

const DUPLICATE_KEY = "23505";
// PostgREST surfaces an RLS write violation as 42501; CHECK violations as 23514.
const REJECTION_CODES = new Set(["42501", "23514", "23503", "23502", "22P02"]);

function classify(code: string | null, message: string): never {
  if (code === "42501") throw new SyncRejectionError(message, "rls");
  if (code && REJECTION_CODES.has(code))
    throw new SyncRejectionError(message, "constraint");
  throw new Error(message); // network / 5xx / unknown → retryable
}

export class SupabaseSyncBackend implements SyncBackend {
  constructor(private supabase: SupabaseClient) {}

  async upsertIgnoreDuplicates(
    table: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    // D57: PK is the client-minted UUID; a double-fired sync hits 23505 /
    // ignoreDuplicates and is a no-op, never a duplicate record.
    const { error } = await this.supabase
      .from(table)
      .upsert(row, { onConflict: "id", ignoreDuplicates: true });
    if (error && error.code !== DUPLICATE_KEY) {
      classify(error.code ?? null, error.message);
    }
  }

  async updateWithVersion(
    table: string,
    id: string,
    patch: Record<string, unknown>,
    baseVersion: string,
  ): Promise<number> {
    // D61 LWW: the update only lands if the server row still carries the
    // updated_at we read. 0 rows = stale (or out of RLS scope) → caller rejects.
    const { data, error } = await this.supabase
      .from(table)
      .update(patch)
      .eq("id", id)
      .eq("updated_at", baseVersion)
      .select("id");
    if (error) classify(error.code ?? null, error.message);
    return data?.length ?? 0;
  }

  async createSignedUploadUrl(bucket: string, path: string) {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path: data.path, token: data.token };
  }

  async uploadToSignedUrl(
    bucket: string,
    path: string,
    token: string,
    blob: Blob,
  ): Promise<void> {
    const { error } = await this.supabase.storage
      .from(bucket)
      .uploadToSignedUrl(path, token, blob);
    if (error) throw new Error(error.message);
  }

  async createOpportunityWithAction(payload: Record<string, unknown>): Promise<void> {
    const { first_action, ...opp } = payload as {
      first_action: Record<string, unknown>;
    } & Record<string, unknown>;
    const { error } = await this.supabase.rpc("create_opportunity_with_action", {
      p_opportunity: opp,
      p_next_action: {
        ...first_action,
        org_id: opp.org_id,
        owner_id: opp.owner_id,
        account_id: opp.primary_account_id,
        opportunity_id: opp.id,
      },
    });
    if (error) classify(error.code ?? null, error.message);
  }

  async pullWorkingSet(): Promise<WorkingSet> {
    // D56: bounded, visit-ready working set — never the whole territory.
    const today = new Date();
    const monthAgo = new Date(today);
    monthAgo.setDate(today.getDate() - 30);

    const [agendaRes, activitiesRes, orgRes] = await Promise.all([
      this.supabase
        .from("next_actions")
        // Routine list (D-routine): widened from the fortnight visit window
        // to ALL open next_actions, capped, so routine chores (which can sit
        // months out — e.g. a display check) are cached regardless of the
        // visit horizon.
        .select(
          "id, action, due_date, completed_at, account_id, opportunity_id, objective, kind, created_at, updated_at",
        )
        .is("completed_at", null)
        .order("due_date")
        .limit(200),
      this.supabase
        .from("activities")
        .select(
          // planned_action_id (D46 link-and-complete) rides along so Home's
          // "Visits this week" tile can dedupe a debriefed planned visit
          // from a walk-in activity — both are rows in this table.
          "id, activity_type, primary_account_id, occurred_at, what_happened, follow_up_required, planned_action_id",
        )
        .gte("occurred_at", monthAgo.toISOString())
        .order("occurred_at", { ascending: false })
        .limit(100),
      // Routine list (D-routine): the org's display-check windows — RLS
      // scopes this to the caller's own org (private.jwt_org_id()), so a
      // plain unfiltered select returns at most one row.
      this.supabase.from("organizations").select("settings").maybeSingle(),
    ]);
    if (agendaRes.error) throw new Error(agendaRes.error.message);
    if (activitiesRes.error) throw new Error(activitiesRes.error.message);
    if (orgRes.error) throw new Error(orgRes.error.message);

    // Mirrors the view's coalesce() semantics: only a MISSING/null key falls
    // back to the default — an explicit 0 (however unlikely) is not falsy here.
    const rawSettings = (orgRes.data?.settings ?? {}) as Record<string, unknown>;
    const settings: OrgSettings = {
      display_routine_months:
        typeof rawSettings.display_routine_months === "number"
          ? rawSettings.display_routine_months
          : DEFAULT_DISPLAY_ROUTINE_MONTHS,
      display_verify_months:
        typeof rawSettings.display_verify_months === "number"
          ? rawSettings.display_verify_months
          : DEFAULT_DISPLAY_VERIFY_MONTHS,
    };

    // Accounts: RLS already narrows this to the rep's own scope (own +
    // territory), which IS the D56 working-set boundary; the limit keeps the
    // cache bounded. Door context beyond these columns joins in later phases.
    const accountsRes = await this.supabase
      .from("accounts")
      .select(
        "id, name, account_type, city, territory_id, has_display_wall, display_last_verified_at, parent_account_id, updated_at",
      )
      .order("name")
      .limit(300);
    if (accountsRes.error) throw new Error(accountsRes.error.message);

    // Contacts ride along (D56): champion name and phone at the door with no
    // signal. Champions sort first so the bound trims spectators, not captains.
    const contactsRes = await this.supabase
      .from("contacts")
      .select(
        "id, account_id, name, job_title, email, phone, is_champion, updated_at",
      )
      .order("is_champion", { ascending: false })
      .order("name")
      .limit(500);
    if (contactsRes.error) throw new Error(contactsRes.error.message);

    return {
      accounts: accountsRes.data,
      contacts: contactsRes.data,
      agenda: agendaRes.data,
      activities: activitiesRes.data,
      settings,
      pulledAt: new Date().toISOString(),
    };
  }
}
