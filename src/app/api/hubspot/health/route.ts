// HubSpot sync health (Task 13) — the admin-facing signal for the dashboard
// card. Session-only: unlike the cron routes in this folder (Bearer
// CRON_SECRET, service client throughout), this one is called from the
// browser by a signed-in manager/admin. Same caller-mode dance as
// email/sync/route.ts (getSupabaseServerClient + orgIdFromJwt) to find the
// org, then the service client both checks the caller's role AND reads the
// sync tables — hubspot_sync_errors/hubspot_sync_cursors have RLS enabled
// with zero policies (see 20260805000100_hubspot.sql), so only service_role
// can see them; this route is the one place that role gate lives.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { orgIdFromJwt } from "@/lib/supabase/jwt";
import { getSupabaseServerClient } from "@/lib/supabase/server";

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const orgId = orgIdFromJwt(session.access_token);
  if (!orgId) {
    return NextResponse.json({ error: "no active org" }, { status: 403 });
  }

  const service = serviceClient();

  const { data: membership } = await service
    .from("memberships")
    .select("role")
    .eq("user_id", session.user.id)
    .eq("org_id", orgId)
    .eq("status", "active")
    .single();
  if (!membership || !["manager", "admin"].includes(membership.role as string)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: integration } = await service
    .from("org_integrations")
    .select("org_id")
    .eq("org_id", orgId)
    .eq("provider", "hubspot")
    .eq("status", "active")
    .maybeSingle();
  const configured = Boolean(integration);

  const { count: unresolvedErrors } = await service
    .from("hubspot_sync_errors")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .is("resolved_at", null);

  const { data: cursors } = await service
    .from("hubspot_sync_cursors")
    .select("updated_at")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(1);
  const lastPassAt = cursors?.[0]?.updated_at ?? null;

  return NextResponse.json({
    configured,
    unresolvedErrors: unresolvedErrors ?? 0,
    lastPassAt,
  });
}
