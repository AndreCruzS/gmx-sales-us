// Gmail sync trigger (D33). Two callers:
//   · a signed-in rep syncing their own mailbox (same auth posture as voice)
//   · Vercel Cron with `authorization: Bearer ${CRON_SECRET}` — every 15 min
//
// WHOSE MAILBOXES (Andre, 2026-10-20): every active REP whose own Google
// grant carries gmail.readonly — the "Finish your setup" tap asks for it —
// read through that grant. The service-account path (spec §6) stays for any
// mailbox registered in email_sync_state, should a key ever be issued.
// Admins are never read.
//
// Vercel Cron sends GET; the route only answered POST, so the cron had been
// a 405 since August. Both are exported now.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GoogleGmailPort } from "@/lib/email/google-gmail";
import { syncMailbox } from "@/lib/email/sync-core";
import { SupabaseEmailStore } from "@/lib/email/supabase-store";
import { oauthClientFromEnv } from "@/lib/google/oauth";
import { GMAIL_READ } from "@/lib/google/scopes";
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

function serviceAccountPort(): GoogleGmailPort | null {
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

interface Mailbox {
  orgId: string;
  membershipId: string;
  mailbox: string;
  domain: string;
  port: GoogleGmailPort;
}

interface Embedded {
  users: { email: string } | null;
  organizations: { workspace_domain: string | null } | null;
}

function domainOf(m: Embedded | null, mailbox: string): string {
  return m?.organizations?.workspace_domain ?? mailbox.split("@")[1] ?? "";
}

/** Every active rep whose own grant can read their mail. */
async function repMailboxes(service: SupabaseClient, onlyMembership?: string): Promise<Mailbox[]> {
  const client = oauthClientFromEnv();
  if (!client) return [];
  let q = service
    .from("google_connections")
    .select(
      "org_id, membership_id, google_email, refresh_token, memberships!inner(role, status, users(email), organizations:org_id(workspace_domain))",
    )
    .eq("memberships.role", "rep")
    .eq("memberships.status", "active")
    .contains("scopes", [GMAIL_READ]);
  if (onlyMembership) q = q.eq("membership_id", onlyMembership);
  const { data, error } = await q;
  if (error) throw new Error(`google_connections read failed: ${error.message}`);
  const out: Mailbox[] = [];
  for (const r of (data ?? []) as unknown as {
    org_id: string;
    membership_id: string;
    google_email: string | null;
    refresh_token: string | null;
    memberships: Embedded | null;
  }[]) {
    const mailbox = r.google_email ?? r.memberships?.users?.email;
    if (!mailbox || !r.refresh_token) continue;
    out.push({
      orgId: r.org_id,
      membershipId: r.membership_id,
      mailbox,
      domain: domainOf(r.memberships, mailbox),
      port: new GoogleGmailPort({ kind: "own-grant", client, refreshToken: r.refresh_token }),
    });
  }
  return out;
}

/** Mailboxes registered for the service account, when a key exists. */
async function serviceAccountMailboxes(service: SupabaseClient): Promise<Mailbox[]> {
  const sa = serviceAccountPort();
  if (!sa) return [];
  const { data, error } = await service
    .from("email_sync_state")
    .select("org_id, membership_id, memberships(users(email), organizations:org_id(workspace_domain))");
  if (error) throw new Error(error.message);
  const out: Mailbox[] = [];
  for (const s of (data ?? []) as unknown as {
    org_id: string;
    membership_id: string;
    memberships: Embedded | null;
  }[]) {
    const mailbox = s.memberships?.users?.email;
    if (!mailbox) continue;
    out.push({
      orgId: s.org_id,
      membershipId: s.membership_id,
      mailbox,
      domain: domainOf(s.memberships, mailbox),
      port: sa,
    });
  }
  return out;
}

async function run(service: SupabaseClient, boxes: Mailbox[]) {
  const results = [];
  for (const b of boxes) {
    try {
      results.push({
        mailbox: b.mailbox,
        ...(await syncOne(service, b.port, b.orgId, b.membershipId, b.mailbox, b.domain)),
      });
    } catch (err) {
      results.push({ mailbox: b.mailbox, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

async function handler(req: Request) {
  const service = serviceClient();

  // ── Cron mode: every rep who granted read, then any SA-registered box ─────
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    try {
      const own = await repMailboxes(service);
      const seen = new Set(own.map((b) => b.membershipId));
      const sa = (await serviceAccountMailboxes(service)).filter((b) => !seen.has(b.membershipId));
      return NextResponse.json({ results: await run(service, [...own, ...sa]) });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }
  if (req.method === "GET") {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
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
  const [own] = await repMailboxes(service, membership.id as string);
  const mailbox = own?.mailbox ?? session.user.email;
  const port = own?.port ?? serviceAccountPort();
  if (!port || !mailbox) {
    return NextResponse.json(
      {
        error:
          "Email reading isn't connected yet — finish your setup on Email & Calendar to let the app read your client email.",
      },
      { status: 501 },
    );
  }
  const domain =
    (membership as unknown as { organizations: { workspace_domain: string | null } | null })
      .organizations?.workspace_domain ?? mailbox.split("@")[1];

  try {
    const report = await syncOne(service, port, orgId, membership.id as string, mailbox, domain);
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

export const GET = handler;
export const POST = handler;
