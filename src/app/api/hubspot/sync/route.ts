// HubSpot sync trigger (Task 11). Cron-only — unlike email/calendar, reps
// never trigger this: the pipeline lives in HubSpot, and sync runs on
// Vercel Cron's 5-minute clock (vercel.json). Same courtesy as the other
// sync routes: a readable 501 instead of a mystery failure when nothing is
// configured yet, but here that means "no active org_integrations row for
// hubspot" rather than a single missing env var — the token is per-org.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HubSpotApi } from "@/lib/hubspot/hubspot-api";
import type { HubSpotOrgConfig } from "@/lib/hubspot/port";
import { runOrgSync } from "@/lib/hubspot/run-sync";
import { HubSpotStore } from "@/lib/hubspot/supabase-store";

export const maxDuration = 300;

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function isValidConfig(config: unknown): config is HubSpotOrgConfig {
  const c = config as Partial<HubSpotOrgConfig> | null;
  return Boolean(
    c &&
      typeof c.pipeline_id === "string" &&
      c.pipeline_id.length > 0 &&
      c.stage_map &&
      typeof c.stage_map === "object" &&
      c.owner_map &&
      typeof c.owner_map === "object",
  );
}

// Vercel Cron invokes scheduled routes with GET, not POST — export both
// against the same handler (F3) so `vercel.json`'s cron entry actually fires
// this route instead of 405ing every 5 minutes.
async function handler(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const service = serviceClient();
  const { data: orgs, error } = await service
    .from("org_integrations")
    .select("org_id, credential_ref, config")
    .eq("provider", "hubspot")
    .eq("status", "active");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!orgs || orgs.length === 0) {
    return NextResponse.json(
      {
        error:
          "HubSpot sync isn't connected yet — no active org_integrations row for provider 'hubspot'.",
      },
      { status: 501 },
    );
  }

  const results: Record<string, unknown>[] = [];
  for (const row of orgs as { org_id: string; credential_ref: string; config: unknown }[]) {
    const { data: token } = await service.rpc("get_integration_secret", {
      p_ref: row.credential_ref,
    });
    if (!token) {
      results.push({ org_id: row.org_id, skipped: "no token configured" });
      continue;
    }
    if (!isValidConfig(row.config)) {
      results.push({ org_id: row.org_id, skipped: "no sync config — run admin setup first" });
      continue;
    }
    try {
      const port = new HubSpotApi(token as string);
      const store = new HubSpotStore(service, row.org_id);
      const report = await runOrgSync(port, store, row.config, new Date());
      results.push({ org_id: row.org_id, ...report });
    } catch (err) {
      results.push({
        org_id: row.org_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ results });
}

export const POST = handler;
export const GET = handler;
