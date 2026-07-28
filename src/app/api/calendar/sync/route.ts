// Calendar reconciliation trigger (spec §6/§7). Same two callers as email:
// a signed-in rep for their own calendar, or Vercel Cron (CRON_SECRET) for
// every rep with an active membership. Returns a readable 501 until the
// service-account key is configured.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GoogleCalendarPort } from "@/lib/calendar/google-calendar";
import { syncRepCalendar } from "@/lib/calendar/sync-core";
import { SupabaseCalendarStore } from "@/lib/calendar/supabase-store";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 300;

function orgIdFromJwt(token: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    return payload.org_id ?? null;
  } catch {
    return null;
  }
}

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function calendarPort(): GoogleCalendarPort | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    return new GoogleCalendarPort(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function syncOne(
  service: SupabaseClient,
  port: GoogleCalendarPort,
  orgId: string,
  membershipId: string,
  repName: string,
) {
  const store = new SupabaseCalendarStore(service, orgId, membershipId);
  return syncRepCalendar(port, store, { repName });
}

export async function POST(req: Request) {
  const port = calendarPort();
  if (!port) {
    return NextResponse.json(
      {
        error:
          "Calendar sync isn't connected yet — the Google service-account " +
          "key (GOOGLE_SERVICE_ACCOUNT_KEY) hasn't been configured.",
      },
      { status: 501 },
    );
  }
  const service = serviceClient();

  // ── Cron mode: every active rep ───────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    const { data: reps, error } = await service
      .from("memberships")
      .select("id, org_id, role, status, users(full_name, email)")
      .eq("status", "active")
      .eq("role", "rep");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const results = [];
    for (const r of (reps ?? []) as unknown as {
      id: string;
      org_id: string;
      users: { full_name: string | null; email: string } | null;
    }[]) {
      const name = r.users?.full_name ?? r.users?.email ?? "Rep";
      try {
        results.push({ rep: name, ...(await syncOne(service, port, r.org_id, r.id, name)) });
      } catch (err) {
        results.push({
          rep: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return NextResponse.json({ results });
  }

  // ── Caller mode: the signed-in rep's own calendar ─────────────────────────
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
  const { data: membership } = await service
    .from("memberships")
    .select("id, users(full_name)")
    .eq("user_id", session.user.id)
    .eq("org_id", orgId)
    .eq("status", "active")
    .single();
  if (!membership) {
    return NextResponse.json({ error: "no membership" }, { status: 403 });
  }
  const repName =
    (membership as unknown as { users: { full_name: string | null } | null })
      .users?.full_name ??
    session.user.email ??
    "Rep";

  try {
    const report = await syncOne(
      service,
      port,
      orgId,
      membership.id as string,
      repName,
    );
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
