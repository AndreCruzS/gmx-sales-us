// The impure orchestration layer (Task 11): composes the pure planners
// (sync-core.ts), pure mappers (mapping.ts), the HubSpotPort, and the
// HubSpotStorePort into one per-org pass. No direct Supabase client, no
// direct fetch — everything impure comes in through `port`/`store`, so a
// fake of both drives the whole pass under vitest (see __tests__/run-sync.test.ts).
//
// Pass order (spec Task 11): outbound accounts → contacts → deals →
// activities → next_actions, then inbound companies → contacts → deals.
// Each stream is independently try/caught — one stream's failure never
// blocks the next — and each stream advances its own cursor only past what
// it actually finished (outbound: rows pushed; inbound: records seen, since
// a per-record failure is surfaced via recordError rather than retried by
// an automatic rescan — D62).

import {
  accountToCompanyProps,
  activityToEngagement,
  contactToContactProps,
  dealPropsToPatch,
  nextActionToTaskProps,
  opportunityToDealProps,
} from "./mapping";
import { P } from "./properties";
import type {
  HsFilter,
  HsObjectType,
  HsProps,
  HsRecord,
  HubSpotOrgConfig,
  HubSpotPort,
} from "./port";
import type {
  DealLocalLink,
  HubSpotStorePort,
  ReviewAction,
  SyncedAccountRow,
  SyncedActivityRow,
  SyncedContactRow,
  SyncedOpportunityRow,
} from "./supabase-store";
import { planInbound, planOutbound } from "./sync-core";
import type { OutboundCandidate } from "./sync-core";

export interface StreamOutcome {
  stream: string;
  succeeded: number;
  errors: number;
}

export interface SyncReport {
  streams: StreamOutcome[];
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Running max over ISO-8601 UTC timestamps — safe to compare lexicographically. */
function maxIso(a: string | null, b: string): string {
  if (a === null) return b;
  return b > a ? b : a;
}

/** Running max over ms-epoch strings. */
function maxMs(a: string | null, b: string): string {
  if (a === null) return b;
  return Number(b) > Number(a) ? b : a;
}

async function searchAll(
  port: HubSpotPort,
  type: HsObjectType,
  sinceMs: string,
  filters: HsFilter[],
  properties: string[],
): Promise<HsRecord[]> {
  const all: HsRecord[] = [];
  let after: string | undefined;
  for (;;) {
    const { results, after: next } = await port.searchModifiedSince(
      type,
      sinceMs,
      filters,
      properties,
      after,
    );
    all.push(...results);
    if (!next) break;
    after = next;
  }
  return all;
}

// ── Outbound: accounts, contacts, deals (steps 1-3) ─────────────────────────
//
// Shared by all three entity streams — only differs in table/HS type/prop
// mapper/post-create association. `associate` runs only after a CREATE (per
// the brief: "after creates, for rows with ..."), never after a patch.

interface OutboundEntityRow {
  id: string;
  hubspot_id: string | null;
  updated_at: string;
}

async function syncOutboundEntities<Row extends OutboundEntityRow>(
  port: HubSpotPort,
  store: HubSpotStorePort,
  opts: {
    stream: string;
    entityType: "account" | "contact" | "opportunity";
    table: string;
    hsType: HsObjectType;
    rows: Row[];
    toProps: (r: Row) => HsProps;
    associate?: (entityId: string, hsId: string, row: Row) => Promise<void>;
  },
): Promise<StreamOutcome> {
  const { stream, entityType, table, hsType, rows, toProps, associate } = opts;
  let succeeded = 0;
  let errors = 0;
  if (rows.length === 0) return { stream, succeeded, errors };

  const byId = new Map(rows.map((r) => [r.id, r]));
  const candidates: OutboundCandidate[] = [];
  const processedUpdatedAts: string[] = [];

  for (const r of rows) {
    try {
      candidates.push({
        entityType,
        entityId: r.id,
        hubspotId: r.hubspot_id,
        updatedAt: r.updated_at,
        props: toProps(r),
      });
    } catch (err) {
      errors++;
      await store.recordError("outbound", entityType, r.id, r.hubspot_id, {}, errMsg(err));
    }
  }

  const snapshots = await store.loadSnapshots(
    entityType,
    candidates.map((c) => c.entityId),
  );
  const plan = planOutbound(candidates, snapshots);

  for (const entityId of plan.echoes) {
    succeeded++;
    processedUpdatedAts.push(byId.get(entityId)!.updated_at);
  }

  if (plan.creates.length) {
    let created: HsRecord[] = [];
    try {
      created = await port.batchCreate(
        hsType,
        plan.creates.map((c) => ({ props: c.props })),
      );
    } catch (err) {
      errors += plan.creates.length;
      for (const cand of plan.creates) {
        await store.recordError("outbound", entityType, cand.entityId, null, cand.props, errMsg(err));
      }
      created = [];
    }
    for (let i = 0; i < created.length; i++) {
      const cand = plan.creates[i];
      const rec = created[i];
      try {
        await store.linkHubspotId(table, cand.entityId, rec.id);
        await store.saveSnapshot(entityType, {
          entityId: cand.entityId,
          hubspotId: rec.id,
          props: cand.props,
        });
        if (associate) await associate(cand.entityId, rec.id, byId.get(cand.entityId)!);
        succeeded++;
        processedUpdatedAts.push(byId.get(cand.entityId)!.updated_at);
      } catch (err) {
        errors++;
        await store.recordError("outbound", entityType, cand.entityId, rec.id, cand.props, errMsg(err));
      }
    }
  }

  if (plan.patches.length) {
    try {
      await port.batchUpdate(
        hsType,
        plan.patches.map((p) => ({ id: p.hubspotId, props: p.props })),
      );
      for (const p of plan.patches) {
        try {
          const row = byId.get(p.entityId)!;
          await store.saveSnapshot(entityType, {
            entityId: p.entityId,
            hubspotId: p.hubspotId,
            props: toProps(row),
          });
          succeeded++;
          processedUpdatedAts.push(row.updated_at);
        } catch (err) {
          errors++;
          await store.recordError("outbound", entityType, p.entityId, p.hubspotId, p.props, errMsg(err));
        }
      }
    } catch (err) {
      errors += plan.patches.length;
      for (const p of plan.patches) {
        await store.recordError("outbound", entityType, p.entityId, p.hubspotId, p.props, errMsg(err));
      }
    }
  }

  // Cursor advances only past rows we actually finished pushing (creates +
  // patches + echoes); a failed row's updated_at is never included, so it
  // resurfaces on the next pass unless its error row is resolved by hand.
  if (processedUpdatedAts.length) {
    const max = processedUpdatedAts.reduce((a, b) => (b > a ? b : a));
    await store.setCursor(stream, max);
  }

  return { stream, succeeded, errors };
}

async function syncOutboundAccounts(
  port: HubSpotPort,
  store: HubSpotStorePort,
  cfg: HubSpotOrgConfig,
): Promise<StreamOutcome> {
  const stream = "out:accounts";
  try {
    const cursor = await store.getCursor(stream);
    const rows = await store.changedAccountsSince(cursor);
    return await syncOutboundEntities<SyncedAccountRow>(port, store, {
      stream,
      entityType: "account",
      table: "accounts",
      hsType: "companies",
      rows,
      toProps: (r) => accountToCompanyProps(r, cfg.owner_map),
      associate: async (_entityId, hsId, row) => {
        if (!row.parent_account_id) return;
        const parents = await store.loadHubspotIdsByLocalId("accounts", [row.parent_account_id]);
        const parentHsId = parents.get(row.parent_account_id);
        if (parentHsId) await port.associateDefault("companies", hsId, "companies", parentHsId);
      },
    });
  } catch (err) {
    await store.recordError("outbound", "account", null, null, {}, errMsg(err));
    return { stream, succeeded: 0, errors: 1 };
  }
}

async function syncOutboundContacts(
  port: HubSpotPort,
  store: HubSpotStorePort,
  cfg: HubSpotOrgConfig,
): Promise<StreamOutcome> {
  const stream = "out:contacts";
  try {
    const cursor = await store.getCursor(stream);
    const rows = await store.changedContactsSince(cursor);
    return await syncOutboundEntities<SyncedContactRow>(port, store, {
      stream,
      entityType: "contact",
      table: "contacts",
      hsType: "contacts",
      rows,
      toProps: (r) => contactToContactProps(r, cfg.owner_map),
      associate: async (_entityId, hsId, row) => {
        const companies = await store.loadHubspotIdsByLocalId("accounts", [row.account_id]);
        const companyHsId = companies.get(row.account_id);
        if (companyHsId) await port.associateDefault("contacts", hsId, "companies", companyHsId);
      },
    });
  } catch (err) {
    await store.recordError("outbound", "contact", null, null, {}, errMsg(err));
    return { stream, succeeded: 0, errors: 1 };
  }
}

async function syncOutboundDeals(
  port: HubSpotPort,
  store: HubSpotStorePort,
  cfg: HubSpotOrgConfig,
): Promise<StreamOutcome> {
  const stream = "out:deals";
  try {
    const cursor = await store.getCursor(stream);
    const rows = await store.changedOpportunitiesSince(cursor);
    return await syncOutboundEntities<SyncedOpportunityRow>(port, store, {
      stream,
      entityType: "opportunity",
      table: "opportunities",
      hsType: "deals",
      rows,
      toProps: (r) => opportunityToDealProps(r, cfg),
      associate: async (_entityId, hsId, row) => {
        const companies = await store.loadHubspotIdsByLocalId("accounts", [row.primary_account_id]);
        const companyHsId = companies.get(row.primary_account_id);
        if (companyHsId) await port.associateDefault("deals", hsId, "companies", companyHsId);
      },
    });
  } catch (err) {
    await store.recordError("outbound", "opportunity", null, null, {}, errMsg(err));
    return { stream, succeeded: 0, errors: 1 };
  }
}

// ── Outbound: activities (step 4) ───────────────────────────────────────────
//
// One batchCreate call per engagement type (meetings/calls/notes), not per
// activity — HubSpot's batch API is the whole point of grouping. Associated
// to company + deal (when linked to an opportunity) + every attending contact.

async function syncOutboundActivities(
  port: HubSpotPort,
  store: HubSpotStorePort,
): Promise<StreamOutcome> {
  const stream = "out:activities";
  let succeeded = 0;
  let errors = 0;
  try {
    const cursor = await store.getCursor(stream);
    const rows = await store.changedActivitiesSince(cursor);
    if (rows.length === 0) return { stream, succeeded, errors };

    const byType = new Map<
      "meetings" | "calls" | "notes",
      { row: SyncedActivityRow; props: HsProps }[]
    >();
    for (const row of rows) {
      const eng = activityToEngagement(row);
      const list = byType.get(eng.type) ?? [];
      list.push({ row, props: eng.props });
      byType.set(eng.type, list);
    }

    let maxUpdatedAt: string | null = null;

    for (const [type, items] of byType) {
      let created: HsRecord[] = [];
      try {
        created = await port.batchCreate(
          type,
          items.map((i) => ({ props: i.props })),
        );
      } catch (err) {
        errors += items.length;
        for (const i of items) {
          await store.recordError("outbound", "activity", i.row.id, null, i.props, errMsg(err));
        }
        continue;
      }

      for (let i = 0; i < items.length; i++) {
        const { row, props } = items[i];
        const rec = created[i];
        try {
          await store.linkHubspotId("activities", row.id, rec.id);

          const companies = await store.loadHubspotIdsByLocalId("accounts", [row.primary_account_id]);
          const companyHsId = companies.get(row.primary_account_id);
          if (companyHsId) await port.associateDefault(type, rec.id, "companies", companyHsId);

          if (row.opportunity_id) {
            const deals = await store.loadHubspotIdsByLocalId("opportunities", [row.opportunity_id]);
            const dealHsId = deals.get(row.opportunity_id);
            if (dealHsId) await port.associateDefault(type, rec.id, "deals", dealHsId);
          }

          if (row.contact_ids.length) {
            const contacts = await store.loadHubspotIdsByLocalId("contacts", row.contact_ids);
            for (const contactHsId of contacts.values()) {
              await port.associateDefault(type, rec.id, "contacts", contactHsId);
            }
          }

          succeeded++;
          maxUpdatedAt = maxIso(maxUpdatedAt, row.updated_at);
        } catch (err) {
          errors++;
          await store.recordError("outbound", "activity", row.id, rec.id, props, errMsg(err));
        }
      }
    }

    if (maxUpdatedAt) await store.setCursor(stream, maxUpdatedAt);
  } catch (err) {
    errors++;
    await store.recordError("outbound", "activity", null, null, {}, errMsg(err));
  }
  return { stream, succeeded, errors };
}

// ── Outbound: next_actions (step 5) ─────────────────────────────────────────
//
// Two disjoint groups: never-linked rows become tasks; already-linked rows
// that completed get their status flipped. A linked-but-still-open row is a
// no-op — task bodies don't sync incrementally in v1.

async function syncOutboundNextActions(
  port: HubSpotPort,
  store: HubSpotStorePort,
  cfg: HubSpotOrgConfig,
): Promise<StreamOutcome> {
  const stream = "out:next_actions";
  let succeeded = 0;
  let errors = 0;
  try {
    const cursor = await store.getCursor(stream);
    const rows = await store.changedNextActionsSince(cursor);
    if (rows.length === 0) return { stream, succeeded, errors };

    const toCreate = rows.filter((r) => !r.hubspot_id);
    const toComplete = rows.filter((r) => r.hubspot_id && r.completed_at);
    let maxUpdatedAt: string | null = null;

    if (toCreate.length) {
      let created: HsRecord[] = [];
      try {
        created = await port.batchCreate(
          "tasks",
          toCreate.map((r) => ({ props: nextActionToTaskProps(r, cfg.owner_map) })),
        );
      } catch (err) {
        errors += toCreate.length;
        for (const r of toCreate) {
          await store.recordError("outbound", "next_action", r.id, null, {}, errMsg(err));
        }
      }
      for (let i = 0; i < created.length; i++) {
        const row = toCreate[i];
        const rec = created[i];
        try {
          await store.linkHubspotId("next_actions", row.id, rec.id);
          succeeded++;
          maxUpdatedAt = maxIso(maxUpdatedAt, row.updated_at);
        } catch (err) {
          errors++;
          await store.recordError("outbound", "next_action", row.id, rec.id, {}, errMsg(err));
        }
      }
    }

    if (toComplete.length) {
      try {
        await port.batchUpdate(
          "tasks",
          toComplete.map((r) => ({ id: r.hubspot_id as string, props: { hs_task_status: "COMPLETED" } })),
        );
        for (const r of toComplete) {
          succeeded++;
          maxUpdatedAt = maxIso(maxUpdatedAt, r.updated_at);
        }
      } catch (err) {
        errors += toComplete.length;
        for (const r of toComplete) {
          await store.recordError("outbound", "next_action", r.id, r.hubspot_id, {}, errMsg(err));
        }
      }
    }

    if (maxUpdatedAt) await store.setCursor(stream, maxUpdatedAt);
  } catch (err) {
    errors++;
    await store.recordError("outbound", "next_action", null, null, {}, errMsg(err));
  }
  return { stream, succeeded, errors };
}

// ── Inbound: companies, contacts (step 6) ───────────────────────────────────
//
// Shared: search maximo_managed=true, plan with no stage concept, apply the
// patch, snapshot. `unlinked` has no admin-mapping UI yet in v1 — a company
// or contact born in HubSpot surfaces as an error row instead of a silent
// local create (spec: only deals get an inbound create path).

async function syncInboundEntities(
  port: HubSpotPort,
  store: HubSpotStorePort,
  opts: {
    stream: string;
    entityType: "account" | "contact";
    table: "accounts" | "contacts";
    hsType: "companies" | "contacts";
    properties: string[];
    applyPatch: (entityId: string, patch: HsProps) => Promise<void>;
  },
): Promise<StreamOutcome> {
  const { stream, entityType, table, hsType, properties, applyPatch } = opts;
  let succeeded = 0;
  let errors = 0;
  try {
    const cursor = await store.getCursor(stream);
    const filters: HsFilter[] = [{ propertyName: P.managed, operator: "EQ", value: "true" }];
    const records = await searchAll(port, hsType, cursor ?? "0", filters, properties);
    if (records.length === 0) return { stream, succeeded, errors };

    const links = await store.loadLinksByHubspotId(
      table,
      records.map((r) => r.id),
    );
    const snapshots = await store.loadSnapshots(
      entityType,
      [...links.values()].map((l) => l.entityId),
    );
    const decisions = planInbound(records, links, snapshots, { stagePropName: null });

    let maxLastModified: string | null = null;
    for (let i = 0; i < decisions.length; i++) {
      const decision = decisions[i];
      const record = records[i];
      maxLastModified = maxMs(maxLastModified, record.lastModifiedAt);
      try {
        if (decision.kind === "echo") {
          succeeded++;
        } else if (decision.kind === "apply") {
          await applyPatch(decision.entityId, decision.patch);
          await store.saveSnapshot(entityType, {
            entityId: decision.entityId,
            hubspotId: record.id,
            props: record.props,
          });
          succeeded++;
        } else if (decision.kind === "local-wins") {
          // No stage concept for companies/contacts — local is simply
          // correct; nothing to write either direction this pass.
          succeeded++;
        } else {
          errors++;
          await store.recordError(
            "inbound",
            entityType,
            null,
            record.id,
            record.props,
            `unlinked ${entityType} from HubSpot — needs admin mapping (v1 has no create path here)`,
          );
        }
      } catch (err) {
        errors++;
        await store.recordError("inbound", entityType, null, record.id, record.props, errMsg(err));
      }
    }

    if (maxLastModified) await store.setCursor(stream, maxLastModified);
  } catch (err) {
    errors++;
    await store.recordError("inbound", entityType, null, null, {}, errMsg(err));
  }
  return { stream, succeeded, errors };
}

async function syncInboundCompanies(port: HubSpotPort, store: HubSpotStorePort): Promise<StreamOutcome> {
  return syncInboundEntities(port, store, {
    stream: "in:companies",
    entityType: "account",
    table: "accounts",
    hsType: "companies",
    properties: ["name", "city", P.accountType, P.leadSource, P.displayWall, P.managed],
    applyPatch: (id, patch) => store.applyCompanyPatch(id, patch),
  });
}

async function syncInboundContacts(port: HubSpotPort, store: HubSpotStorePort): Promise<StreamOutcome> {
  return syncInboundEntities(port, store, {
    stream: "in:contacts",
    entityType: "contact",
    table: "contacts",
    hsType: "contacts",
    properties: ["firstname", "lastname", "email", "phone", "jobtitle", P.isChampion, P.managed],
    applyPatch: (id, patch) => store.applyContactPatch(id, patch),
  });
}

// ── Inbound: deals (step 7) ──────────────────────────────────────────────────
//
// HubSpot is always stage-authoritative. `associatedcompanyid` is requested
// only for the unlinked→create path and stripped before planning/snapshotting
// so it never pollutes the echo-suppression prop space (it isn't part of
// opportunityToDealProps's outbound shape).

const DEAL_PROPERTIES = [
  "dealname",
  "dealstage",
  "pipeline",
  "amount",
  "closedate",
  P.currentStatus,
  P.currentBlocker,
  P.leadSource,
  P.managed,
  "associatedcompanyid",
];

function stripAssociationProp(record: HsRecord): HsRecord {
  const props: HsProps = { ...record.props };
  delete props.associatedcompanyid;
  return { ...record, props };
}

function buildReviewAction(now: Date, link: DealLocalLink): ReviewAction {
  const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  due.setUTCDate(due.getUTCDate() + 2);
  return {
    id: crypto.randomUUID(),
    action: "Review deal — stage changed in HubSpot",
    owner_id: link.ownerId,
    due_date: due.toISOString().slice(0, 10),
    account_id: link.accountId,
  };
}

async function syncInboundDeals(
  port: HubSpotPort,
  store: HubSpotStorePort,
  cfg: HubSpotOrgConfig,
  now: Date,
): Promise<StreamOutcome> {
  const stream = "in:deals";
  let succeeded = 0;
  let errors = 0;
  try {
    const cursor = await store.getCursor(stream);
    const filters: HsFilter[] = [
      { propertyName: P.managed, operator: "EQ", value: "true" },
      { propertyName: "pipeline", operator: "EQ", value: cfg.pipeline_id },
    ];
    const records = await searchAll(port, "deals", cursor ?? "0", filters, DEAL_PROPERTIES);
    if (records.length === 0) return { stream, succeeded, errors };

    const planningRecords = records.map(stripAssociationProp);
    const links = (await store.loadLinksByHubspotId(
      "opportunities",
      records.map((r) => r.id),
      cfg,
    )) as Map<string, DealLocalLink>;
    const snapshots = await store.loadSnapshots(
      "opportunity",
      [...links.values()].map((l) => l.entityId),
    );
    const decisions = planInbound(planningRecords, links, snapshots, { stagePropName: "dealstage" });

    let maxLastModified: string | null = null;
    for (let i = 0; i < decisions.length; i++) {
      const decision = decisions[i];
      const record = records[i]; // original, still carries associatedcompanyid
      const planningProps = planningRecords[i].props;
      maxLastModified = maxMs(maxLastModified, record.lastModifiedAt);

      try {
        if (decision.kind === "echo") {
          succeeded++;
        } else if (decision.kind === "apply") {
          const patch = dealPropsToPatch(decision.patch, cfg);
          const link = links.get(record.id);
          const review = decision.stageChanged && link ? buildReviewAction(now, link) : null;
          await store.applyDealPatch(decision.entityId, patch, review);
          await store.saveSnapshot("opportunity", {
            entityId: decision.entityId,
            hubspotId: record.id,
            props: planningProps,
          });
          succeeded++;
        } else if (decision.kind === "local-wins") {
          if (decision.stagePatch) {
            const patch = dealPropsToPatch(decision.stagePatch, cfg);
            const link = links.get(record.id);
            const review = link ? buildReviewAction(now, link) : null;
            await store.applyDealPatch(decision.entityId, patch, review);
          }
          succeeded++;
        } else {
          await store.createDealFromHubSpot(record, cfg);
          succeeded++;
        }
      } catch (err) {
        errors++;
        await store.recordError("inbound", "opportunity", null, record.id, record.props, errMsg(err));
      }
    }

    if (maxLastModified) await store.setCursor(stream, maxLastModified);
  } catch (err) {
    errors++;
    await store.recordError("inbound", "opportunity", null, null, {}, errMsg(err));
  }
  return { stream, succeeded, errors };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function runOrgSync(
  port: HubSpotPort,
  store: HubSpotStorePort,
  cfg: HubSpotOrgConfig,
  now: Date = new Date(),
): Promise<SyncReport> {
  const streams: StreamOutcome[] = [];

  streams.push(await syncOutboundAccounts(port, store, cfg));
  streams.push(await syncOutboundContacts(port, store, cfg));
  streams.push(await syncOutboundDeals(port, store, cfg));
  streams.push(await syncOutboundActivities(port, store));
  streams.push(await syncOutboundNextActions(port, store, cfg));
  streams.push(await syncInboundCompanies(port, store));
  streams.push(await syncInboundContacts(port, store));
  streams.push(await syncInboundDeals(port, store, cfg, now));

  return { streams };
}
