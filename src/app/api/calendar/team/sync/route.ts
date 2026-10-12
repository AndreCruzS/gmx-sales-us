// The team calendar's one trigger (spec 2026-10-12). Two callers:
//   · Vercel Cron, GET with `authorization: Bearer ${CRON_SECRET}`, every org
//   · a signed-in admin, POST, their org — the settings page right after the
//     grant lands, and the Reps board on load (fire-and-forget)
//
// WHOSE GRANT: the org's registered owner (team_calendars.owner_membership_id).
// Before one is registered, the first admin with a Google connection becomes
// the owner — that is the Connect tap on /settings/google.
//
// Vercel Cron sends GET, not POST — both are exported (the §6 route only had
// POST and 405'd every hour for a month).

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GoogleTeamCalendar } from "@/lib/calendar/google-team-calendar";
import { SupabaseTeamCalendarStore } from "@/lib/calendar/team-store";
import { syncTeamCalendar } from "@/lib/calendar/team-sync";
import { GoogleReauthNeeded, oauthClientFromEnv } from "@/lib/google/oauth";
import { orgIdFromJwt } from "@/lib/supabase/jwt";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 300;

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The owner's membership and refresh token for one org, or why not. */
async function ownerGrant(
  service: SupabaseClient,
  orgId: string,
): Promise<{ owner: string; refreshToken: string } | { error: string }> {
  const { data: reg } = await service
    .from("team_calendars")
    .select("owner_membership_id")
    .eq("org_id", orgId)
    .maybeSingle();
  let owner = (reg?.owner_membership_id as string | undefined) ?? null;
  if (!owner) {
    const { data: first } = await service
      .from("google_connections")
      .select("membership_id, memberships!inner(role, status)")
      .eq("org_id", orgId)
      .eq("memberships.role", "admin")
      .eq("memberships.status", "active")
      .order("connected_at")
      .limit(1)
      .maybeSingle();
    owner = (first?.membership_id as string | undefined) ?? null;
  }
  if (!owner) {
    return {
      error:
        "No admin has connected Google Calendar yet — the calendar owner taps Connect on Email & Calendar.",
    };
  }
  const { data: conn } = await service
    .from("google_connections")
    .select("refresh_token")
    .eq("membership_id", owner)
    .maybeSingle();
  if (!conn?.refresh_token) {
    return {
      error: "The calendar owner's Google connection has no refresh token — they must reconnect.",
    };
  }
  return { owner, refreshToken: conn.refresh_token as string };
}

async function syncOrg(service: SupabaseClient, orgId: string) {
  const client = oauthClientFromEnv();
  if (!client) {
    return NextResponse.json(
      {
        error:
          "Calendar sync isn't connected yet — GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not configured.",
      },
      { status: 501 },
    );
  }
  const grant = await ownerGrant(service, orgId);
  if ("error" in grant) return NextResponse.json({ error: grant.error }, { status: 501 });
  const port = new GoogleTeamCalendar(client, grant.refreshToken);
  const store = new SupabaseTeamCalendarStore(service, orgId, grant.owner);
  try {
    const report = await syncTeamCalendar(port, store, today());
    return NextResponse.json({ ...report, owner: grant.owner });
  } catch (err) {
    if (err instanceof GoogleReauthNeeded) {
      return NextResponse.json({ error: err.message, owner: grant.owner }, { status: 409 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), owner: grant.owner },
      { status: 502 },
    );
  }
}

async function handler(req: Request) {
  const service = serviceClient();

  // ── Cron: every org that has an owner or a candidate ─────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    const { data: orgs } = await service.from("google_connections").select("org_id");
    const ids = [...new Set(((orgs ?? []) as { org_id: string }[]).map((o) => o.org_id))];
    const results = [];
    for (const orgId of ids) {
      const res = await syncOrg(service, orgId);
      results.push({ orgId, status: res.status, ...(await res.json()) });
    }
    return NextResponse.json({ results });
  }
  if (req.method === "GET") {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // ── Admin: their own org ──────────────────────────────────────────────────
  const supabase = await getSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const orgId = orgIdFromJwt(session.access_token);
  if (!orgId) return NextResponse.json({ error: "no active org" }, { status: 403 });
  const { data: me } = await service
    .from("memberships")
    .select("id, role")
    .eq("user_id", session.user.id)
    .eq("org_id", orgId)
    .eq("status", "active")
    .maybeSingle();
  if (!me || me.role !== "admin") {
    return NextResponse.json({ error: "admins only" }, { status: 403 });
  }
  return syncOrg(service, orgId);
}

export const GET = handler;
export const POST = handler;
