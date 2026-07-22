// SyncBackend over supabase-js — the sync layer talks to Supabase DIRECTLY
// (D3/D62). Vercel stays out of the offline hot path. RLS re-checks every
// replay because these calls carry the rep's own JWT.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SyncRejectionError, type SyncBackend, type WorkingSet } from "./types";

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

  async pullWorkingSet(): Promise<WorkingSet> {
    // D56: bounded, visit-ready working set — never the whole territory.
    const today = new Date();
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(today.getDate() + 2);
    const monthAgo = new Date(today);
    monthAgo.setDate(today.getDate() - 30);

    const [agendaRes, activitiesRes] = await Promise.all([
      this.supabase
        .from("next_actions")
        .select(
          "id, action, due_date, completed_at, account_id, opportunity_id, objective, updated_at",
        )
        .is("completed_at", null)
        .lt("due_date", dayAfterTomorrow.toISOString().slice(0, 10))
        .order("due_date"),
      this.supabase
        .from("activities")
        .select(
          "id, activity_type, primary_account_id, occurred_at, what_happened, follow_up_required",
        )
        .gte("occurred_at", monthAgo.toISOString())
        .order("occurred_at", { ascending: false })
        .limit(100),
    ]);
    if (agendaRes.error) throw new Error(agendaRes.error.message);
    if (activitiesRes.error) throw new Error(activitiesRes.error.message);

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

    return {
      accounts: accountsRes.data,
      agenda: agendaRes.data,
      activities: activitiesRes.data,
      pulledAt: new Date().toISOString(),
    };
  }
}
