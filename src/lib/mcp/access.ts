import type { SupabaseClient } from "@supabase/supabase-js";

// Who may connect an AI agent: everyone with an active membership, since
// 2026-11-10 (Andre: the agent does exactly what the person's role does in the
// app). It replaced the MCP_ALLOWED_EMAILS launch list. What the agent may see
// and change is RLS plus the role checks inside each tool, the same rules as
// the screens — this only answers "is this a GMX Sales member at all".
//
// `db` must act as the person (their session or their token), so RLS limits
// the lookup to their own rows.
export async function hasActiveMembership(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  userId: string | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await db
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1);
  return !error && (data?.length ?? 0) > 0;
}
