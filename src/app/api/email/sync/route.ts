// Gmail sync trigger (D33). Two callers:
//   · a signed-in rep syncing their own mailbox (same auth posture as voice)
//   · Vercel Cron with `authorization: Bearer ${CRON_SECRET}` syncing every
//     mailbox that has opted in (has an email_sync_state row)
//
// Until the service-account key lands (client console steps), this returns a
// readable 501 instead of a mystery failure.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GoogleGmailPort } from "@/lib/email/google-gmail";
import { syncMailbox } from "@/lib/email/sync-core";
import { SupabaseEmailStore } from "@/lib/email/supabase-store";
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

function gmailPort(): GoogleGmailPort | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    return new GoogleGmailPort(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function syncOne(
  service: SupabaseClient,
  gmail: GoogleGmailPort,
  orgId: string,
  membershipId: string,
  mailbox: string,
  workspaceDomain: string,
) {
  const store = new SupabaseEmailStore(service, orgId, membershipId);
  return syncMailbox(gmail, store, { mailbox, workspaceDomain });
}

export async function POST(req: Request) {
  const gmail = gmailPort();
  if (!gmail) {
    return NextResponse.json(
      {
        error:
          "Email sync isn't connected yet — the Google service-account key " +
          "(GOOGLE_SERVICE_ACCOUNT_KEY) hasn't been configured.",
      },
      { status: 501 },
    );
  }
  const service = serviceClient();

  // ── Cron mode: every opted-in mailbox ─────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    const { data: states, error } = await service
      .from("email_sync_state")
      .select(
        "org_id, membership_id, memberships(user_id, users(email), organizations:org_id(workspace_domain))",
      );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const results = [];
    for (const s of (states ?? []) as unknown as {
      org_id: string;
      membership_id: string;
      memberships: {
        users: { email: string } | null;
        organizations: { workspace_domain: string | null } | null;
      } | null;
    }[]) {
      const mailbox = s.memberships?.users?.email;
      const domain =
        s.memberships?.organizations?.workspace_domain ??
        mailbox?.split("@")[1] ??
        "";
      if (!mailbox) continue;
      try {
        results.push({
          mailbox,
          ...(await syncOne(service, gmail, s.org_id, s.membership_id, mailbox, domain)),
        });
      } catch (err) {
        results.push({
          mailbox,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return NextResponse.json({ results });
  }

  // ── Caller mode: the signed-in rep's own mailbox ──────────────────────────
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
    .select("id, organizations:org_id(workspace_domain)")
    .eq("user_id", session.user.id)
    .eq("org_id", orgId)
    .eq("status", "active")
    .single();
  if (!membership) {
    return NextResponse.json({ error: "no membership" }, { status: 403 });
  }
  const mailbox = session.user.email;
  if (!mailbox) {
    return NextResponse.json({ error: "no mailbox on the session" }, { status: 400 });
  }
  const domain =
    (membership as unknown as { organizations: { workspace_domain: string | null } | null })
      .organizations?.workspace_domain ?? mailbox.split("@")[1];

  try {
    const report = await syncOne(
      service,
      gmail,
      orgId,
      membership.id as string,
      mailbox,
      domain,
    );
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
