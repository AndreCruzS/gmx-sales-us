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
//
// ONE PASS AT A TIME (review, 2026-10-12): the cron, the Reps board opening
// and the settings page can all ask at once, and two passes over one
// calendar insert the same visit twice. The org's team_calendars row is
// registered as soon as an owner is known and carries a two-minute lease;
// a caller that cannot claim it answers 409 and the next pass picks up.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GoogleTeamCalendar } from "@/lib/calendar/google-team-calendar";
import { SupabaseTeamCalendarStore } from "@/lib/calendar/team-store";
import { syncTeamCalendar } from "@/lib/calendar/team-sync";
import { GoogleReauthNeeded, oauthClientFromEnv } from "@/lib/google/oauth";
import { orgIdFromJwt } from "@/lib/supabase/jwt";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 300;

/** Creating and sharing a calendar needs the whole Calendar scope; the
 *  events-only grant every rep gives (and admins gave before 2026-10-12)
 *  cannot do it. */
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const LEASE_MS = 2 * 60_000;

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
    // The first active admin whose grant carries the Calendar scope. An
    // older events-only grant cannot create or share the calendar, so it
    // does not make its holder the owner.
    const { data: first } = await service
      .from("google_connections")
      .select("membership_id, scopes, memberships!inner(role, status)")
      .eq("org_id", orgId)
      .eq("memberships.role", "admin")
      .eq("memberships.status", "active")
      .contains("scopes", [CALENDAR_SCOPE])
      .order("connected_at")
      .limit(1)
      .maybeSingle();
    owner = (first?.membership_id as string | undefined) ?? null;
    if (owner) {
      await service
        .from("team_calendars")
        .upsert({ org_id: orgId, owner_membership_id: owner }, { onConflict: "org_id" });
    }
  }
  if (!owner) {
    return {
      error:
        "No admin has connected Google Calendar yet — the calendar owner taps Connect on Email & Calendar.",
    };
  }
  const { data: conn } = await service
    .from("google_connections")
    .select("refresh_token, scopes")
    .eq("membership_id", owner)
    .maybeSingle();
  if (!conn?.refresh_token) {
    return {
      error: "The calendar owner's Google connection has no refresh token — they must reconnect.",
    };
  }
  if (!((conn.scopes as string[] | null) ?? []).includes(CALENDAR_SCOPE)) {
    return {
      error:
        "The calendar owner's Google connection predates the Calendar permission — they must reconnect on Email & Calendar.",
    };
  }
  return { owner, refreshToken: conn.refresh_token as string };
}

/** Claim the org's lease atomically; false when a pass is already running. */
async function claimLease(service: SupabaseClient, orgId: string): Promise<boolean> {
  const now = new Date();
  const { data } = await service
    .from("team_calendars")
    .update({ sync_lease_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("org_id", orgId)
    .or(`sync_lease_until.is.null,sync_lease_until.lt.${now.toISOString()}`)
    .select("org_id");
  return (data?.length ?? 0) > 0;
}

async function releaseLease(service: SupabaseClient, orgId: string): Promise<void> {
  await service.from("team_calendars").update({ sync_lease_until: null }).eq("org_id", orgId);
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
  if ("error" in grant) {
    // Written where the settings page reads it — when there is a row to
    // write to, which there is as soon as an owner was ever registered.
    await service
      .from("team_calendars")
      .update({ last_error: grant.error })
      .eq("org_id", orgId);
    return NextResponse.json({ error: grant.error }, { status: 501 });
  }
  if (!(await claimLease(service, orgId))) {
    return NextResponse.json({ error: "a sync is already running" }, { status: 409 });
  }
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
  } finally {
    await releaseLease(service, orgId);
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
