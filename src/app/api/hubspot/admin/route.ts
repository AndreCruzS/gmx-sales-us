// HubSpot admin route (Task 12) — one-time-per-org portal setup and
// backfill. Unlike sync/route.ts (Vercel Cron, all active orgs, GET+POST),
// this is an explicit, single-org, POST-only operator action: setup
// provisions properties/pipeline/owner+stage maps and persists them into
// org_integrations.config; backfill runs the outbound pass over every
// never-synced row so the first cron pass afterward has something to diff
// against instead of creating everything at once. Same auth/service-client
// idiom as sync/route.ts (Bearer CRON_SECRET, service-role client) — no
// rep JWT ever reaches this route.

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HubSpotApi } from "@/lib/hubspot/hubspot-api";
import { accountToCompanyProps, contactToContactProps, opportunityToDealProps } from "@/lib/hubspot/mapping";
import type { HsPropertyDef, HubSpotOrgConfig, HubSpotPort } from "@/lib/hubspot/port";
import { COMPANY_PROPERTY_DEFS, CONTACT_PROPERTY_DEFS, DEAL_PROPERTY_DEFS } from "@/lib/hubspot/properties";
import { buildOwnerMap, STAGE_LABELS, syncOutboundAccounts, syncOutboundContacts, syncOutboundDeals } from "@/lib/hubspot/run-sync";
import { planOutbound } from "@/lib/hubspot/sync-core";
import type { OutboundCandidate, OutboundPlan } from "@/lib/hubspot/sync-core";
import { HubSpotStore } from "@/lib/hubspot/supabase-store";
import type { HubSpotStorePort } from "@/lib/hubspot/supabase-store";

export const maxDuration = 300;

const PIPELINE_LABEL = "MAXIMO USA";

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

/** STAGE_LABELS pairs + ensureDealPipeline's label→id map → our enum→id
 *  stage_map. A label ensureDealPipeline didn't return (shouldn't happen —
 *  it always creates every requested label) is simply omitted rather than
 *  thrown, so a partial pipeline never blocks the rest of setup. */
function buildStageMap(stageIds: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [stage, label] of STAGE_LABELS) {
    if (stageIds[label]) map[stage] = stageIds[label];
  }
  return map;
}

// ── setup ────────────────────────────────────────────────────────────────

/** Wraps a real HubSpotPort so every *write* setup would make (property
 *  creation, pipeline creation) becomes a no-op recorder instead — reads
 *  (listOwners, searchModifiedSince, searchByProperty) pass straight
 *  through, since a dry run only promises not to WRITE. */
function noWritePort(real: HubSpotPort): {
  port: HubSpotPort;
  ensuredProperties: { objectType: string; name: string }[];
} {
  const ensuredProperties: { objectType: string; name: string }[] = [];
  const port: HubSpotPort = {
    batchCreate: async () => [],
    batchUpdate: async () => [],
    searchModifiedSince: real.searchModifiedSince.bind(real),
    searchByProperty: real.searchByProperty.bind(real),
    associateDefault: async () => {},
    listOwners: real.listOwners.bind(real),
    ensureProperty: async (objectType: "companies" | "contacts" | "deals", def: HsPropertyDef) => {
      ensuredProperties.push({ objectType, name: def.name });
    },
    ensureDealPipeline: async (_label: string, stageLabels: string[]) => ({
      pipelineId: "DRY_RUN_PIPELINE",
      stageIds: Object.fromEntries(stageLabels.map((l) => [l, `DRY_RUN_STAGE_${l}`])),
    }),
  };
  return { port, ensuredProperties };
}

async function ensureAllProperties(port: HubSpotPort): Promise<void> {
  for (const def of COMPANY_PROPERTY_DEFS) await port.ensureProperty("companies", def);
  for (const def of CONTACT_PROPERTY_DEFS) await port.ensureProperty("contacts", def);
  for (const def of DEAL_PROPERTY_DEFS) await port.ensureProperty("deals", def);
}

async function handleSetup(
  store: HubSpotStore,
  realPort: HubSpotPort,
  dryRun: boolean,
): Promise<Record<string, unknown>> {
  const memberships = await store.listActiveMembershipEmails();
  const owners = await realPort.listOwners();
  const { ownerMap, unmatched } = buildOwnerMap(owners, memberships);

  if (dryRun) {
    const { port, ensuredProperties } = noWritePort(realPort);
    await ensureAllProperties(port);
    const { stageIds } = await port.ensureDealPipeline(
      PIPELINE_LABEL,
      STAGE_LABELS.map(([, label]) => label),
    );
    return {
      action: "setup",
      dry_run: true,
      would_write: {
        pipeline_label: PIPELINE_LABEL,
        stage_map: buildStageMap(stageIds),
        owner_map: ownerMap,
      },
      properties_ensured: ensuredProperties,
      unmatched_memberships: unmatched,
    };
  }

  await ensureAllProperties(realPort);
  const { pipelineId, stageIds } = await realPort.ensureDealPipeline(
    PIPELINE_LABEL,
    STAGE_LABELS.map(([, label]) => label),
  );
  const config = await store.mergeIntegrationConfig({
    pipeline_id: pipelineId,
    stage_map: buildStageMap(stageIds),
    owner_map: ownerMap,
  });
  return { action: "setup", dry_run: false, config, unmatched_memberships: unmatched };
}

// ── backfill ─────────────────────────────────────────────────────────────

interface PlannedItem {
  action: "create" | "patch" | "adopt";
  entityId: string;
  hubspotId: string | null;
}

function summarizePlan(plan: OutboundPlan, adoptedIds?: Set<string>) {
  const items: PlannedItem[] = [
    ...plan.creates.map((c) => ({
      action: (adoptedIds?.has(c.entityId) ? "adopt" : "create") as PlannedItem["action"],
      entityId: c.entityId,
      hubspotId: c.hubspotId,
    })),
    ...plan.patches.map((p) => ({
      action: (adoptedIds?.has(p.entityId) ? "adopt" : "patch") as PlannedItem["action"],
      entityId: p.entityId,
      hubspotId: p.hubspotId,
    })),
  ];
  return {
    would_create: plan.creates.length,
    would_patch: plan.patches.length,
    would_echo: plan.echoes.length,
    sample: items.slice(0, 10),
  };
}

/** Search-by-email adoption lookup, shared by the dry-run planner (read
 *  only) and the live pre-pass (also links). Returns, per contact row that
 *  has no hubspot_id yet, the HubSpot id a search turned up (or null). */
async function findContactAdoptionTargets(
  port: HubSpotPort,
  rows: { id: string; hubspot_id: string | null; email: string | null }[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const r of rows) {
    if (r.hubspot_id || !r.email) continue;
    const hits = await port.searchByProperty("contacts", "email", r.email, ["email"]);
    if (hits.length) found.set(r.id, hits[0].id);
  }
  return found;
}

async function handleBackfillDryRun(
  port: HubSpotPort,
  store: HubSpotStore,
  cfg: HubSpotOrgConfig,
): Promise<Record<string, unknown>> {
  const accountRows = await store.changedAccountsSince(null);
  const accountCandidates: OutboundCandidate[] = accountRows.map((r) => ({
    entityType: "account",
    entityId: r.id,
    hubspotId: r.hubspot_id,
    updatedAt: r.updated_at,
    props: accountToCompanyProps(r, cfg.owner_map),
  }));
  const accountSnapshots = await store.loadSnapshots("account", accountCandidates.map((c) => c.entityId));
  const accountPlan = planOutbound(accountCandidates, accountSnapshots);

  const contactRows = await store.changedContactsSince(null);
  const adopted = await findContactAdoptionTargets(port, contactRows);
  const contactCandidates: OutboundCandidate[] = contactRows.map((r) => ({
    entityType: "contact",
    entityId: r.id,
    hubspotId: r.hubspot_id ?? adopted.get(r.id) ?? null,
    updatedAt: r.updated_at,
    props: contactToContactProps(r, cfg.owner_map),
  }));
  const contactSnapshots = await store.loadSnapshots("contact", contactCandidates.map((c) => c.entityId));
  const contactPlan = planOutbound(contactCandidates, contactSnapshots);

  const oppRows = await store.changedOpportunitiesSince(null);
  const oppCandidates: OutboundCandidate[] = [];
  const mappingErrors: { entityId: string; error: string }[] = [];
  for (const r of oppRows) {
    try {
      oppCandidates.push({
        entityType: "opportunity",
        entityId: r.id,
        hubspotId: r.hubspot_id,
        updatedAt: r.updated_at,
        props: opportunityToDealProps(r, cfg),
      });
    } catch (err) {
      mappingErrors.push({ entityId: r.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const oppSnapshots = await store.loadSnapshots("opportunity", oppCandidates.map((c) => c.entityId));
  const oppPlan = planOutbound(oppCandidates, oppSnapshots);

  return {
    action: "backfill",
    dry_run: true,
    streams: {
      accounts: summarizePlan(accountPlan),
      contacts: summarizePlan(contactPlan, new Set(adopted.keys())),
      opportunities: { ...summarizePlan(oppPlan), mapping_errors: mappingErrors },
    },
  };
}

/** Overrides getCursor to always report "no cursor" for the given streams,
 *  regardless of what's persisted — backfill's whole point is a full rescan
 *  ("outbound with a null cursor" per spec), independent of whatever cron
 *  has already advanced. Every other call (including setCursor) passes
 *  straight through, so a live backfill still leaves the cursor in a sane
 *  place for the next cron pass. */
function forceNullCursor(store: HubSpotStorePort, streams: string[]): HubSpotStorePort {
  const forced = new Set(streams);
  return {
    getCursor: async (stream) => (forced.has(stream) ? null : store.getCursor(stream)),
    setCursor: store.setCursor.bind(store),
    changedAccountsSince: store.changedAccountsSince.bind(store),
    changedContactsSince: store.changedContactsSince.bind(store),
    changedOpportunitiesSince: store.changedOpportunitiesSince.bind(store),
    changedActivitiesSince: store.changedActivitiesSince.bind(store),
    changedNextActionsSince: store.changedNextActionsSince.bind(store),
    linkHubspotId: store.linkHubspotId.bind(store),
    loadSnapshots: store.loadSnapshots.bind(store),
    saveSnapshot: store.saveSnapshot.bind(store),
    loadLinksByHubspotId: store.loadLinksByHubspotId.bind(store),
    loadHubspotIdsByLocalId: store.loadHubspotIdsByLocalId.bind(store),
    applyCompanyPatch: store.applyCompanyPatch.bind(store),
    applyContactPatch: store.applyContactPatch.bind(store),
    applyDealPatch: store.applyDealPatch.bind(store),
    createDealFromHubSpot: store.createDealFromHubSpot.bind(store),
    recordError: store.recordError.bind(store),
  };
}

async function handleBackfillLive(
  port: HubSpotPort,
  store: HubSpotStore,
  cfg: HubSpotOrgConfig,
): Promise<Record<string, unknown>> {
  // Adopt pre-pass: link every matched contact FIRST, so the outbound pass
  // below sees a hubspotId with no snapshot yet — planOutbound's own rule
  // for that shape is a full-props patch, which is exactly the adopt write
  // (link + patch with our props, including P.managed) the spec calls for.
  const contactRows = await store.changedContactsSince(null);
  const adopted = await findContactAdoptionTargets(port, contactRows);
  for (const [entityId, hubspotId] of adopted) {
    await store.linkHubspotId("contacts", entityId, hubspotId);
  }

  const forced = forceNullCursor(store, ["out:accounts", "out:contacts", "out:deals"]);
  const streams = [
    await syncOutboundAccounts(port, forced, cfg),
    await syncOutboundContacts(port, forced, cfg),
    await syncOutboundDeals(port, forced, cfg),
  ];

  return { action: "backfill", dry_run: false, contacts_adopted: adopted.size, streams };
}

// ── entry point ──────────────────────────────────────────────────────────

interface AdminBody {
  action?: unknown;
  org_id?: unknown;
  dry_run?: unknown;
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: AdminBody;
  try {
    body = (await req.json()) as AdminBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { action, org_id: orgId, dry_run: dryRunRaw } = body;
  if (action !== "setup" && action !== "backfill") {
    return NextResponse.json({ error: "action must be 'setup' or 'backfill'" }, { status: 400 });
  }
  if (typeof orgId !== "string" || orgId.length === 0) {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }
  const dryRun = dryRunRaw === true;

  const service = serviceClient();

  const { data: integration, error: integrationErr } = await service
    .from("org_integrations")
    .select("org_id, credential_ref, config")
    .eq("org_id", orgId)
    .eq("provider", "hubspot")
    .maybeSingle();
  if (integrationErr) {
    return NextResponse.json({ error: integrationErr.message }, { status: 500 });
  }
  if (!integration) {
    return NextResponse.json(
      { error: "No org_integrations row for provider 'hubspot' — connect HubSpot for this org first." },
      { status: 404 },
    );
  }

  const { data: token } = await service.rpc("get_integration_secret", {
    p_ref: integration.credential_ref as string,
  });
  if (!token) {
    return NextResponse.json({ error: "No HubSpot token configured for this org." }, { status: 400 });
  }

  const port = new HubSpotApi(token as string);
  const store = new HubSpotStore(service, orgId);

  try {
    if (action === "setup") {
      const result = await handleSetup(store, port, dryRun);
      return NextResponse.json(result);
    }

    // backfill
    if (!isValidConfig(integration.config)) {
      return NextResponse.json(
        { error: "No sync config for this org yet — run admin setup first." },
        { status: 400 },
      );
    }
    const result = dryRun
      ? await handleBackfillDryRun(port, store, integration.config)
      : await handleBackfillLive(port, store, integration.config);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
