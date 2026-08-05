// runOrgSync — one full pass driven by a fake HubSpotPort + fake in-memory
// HubSpotStorePort, proving the orchestration (stream order, plan→execute→
// snapshot→cursor) without touching Supabase or the HubSpot API. sync-core.ts
// and mapping.ts already have their own fixture suites; this test only checks
// that run-sync wires them together correctly.

import { describe, expect, it } from "vitest";
import type { HsFilter, HsObjectType, HsProps, HsRecord, HubSpotOrgConfig, HubSpotPort } from "../port";
import { buildOwnerMap, runOrgSync, STAGE_LABELS, syncOutboundAccounts, syncOutboundContacts } from "../run-sync";
import { OPPORTUNITY_STAGES } from "@/lib/domain/enums";
import type { DealPatch } from "../mapping";
import type {
  DealLocalLink,
  HubSpotStorePort,
  ReviewAction,
  SyncedAccountRow,
  SyncedContactRow,
  SyncedOpportunityRow,
} from "../supabase-store";
import type { LocalLink, Snapshot } from "../sync-core";

const CFG: HubSpotOrgConfig = {
  pipeline_id: "pl-1",
  stage_map: { IDENTIFIED: "s1", QUALIFIED: "s2", DEVELOPMENT: "s3" },
  owner_map: { "mem-1": "hs-owner-1" },
};

const NEW_ACCOUNT: SyncedAccountRow = {
  id: "acct-1",
  hubspot_id: null,
  updated_at: "2026-08-05T10:00:00.000Z",
  parent_account_id: null,
  name: "Ganahl Lumber",
  city: "Anaheim",
  account_type: "DEALER",
  lead_source: "JOBSITE",
  has_display_wall: false,
  owner_id: "mem-1",
};

// Deal A: both sides changed since the snapshot (local's amount, HubSpot's
// stage). Local is newer overall → local-wins, but HubSpot stays
// stage-authoritative — sync-core's stagePatch carries the HS stage anyway.
const DEAL_A: HsRecord = {
  id: "hs-deal-a",
  props: { dealstage: "s3", amount: "5000" },
  lastModifiedAt: "1754380000000",
};
const DEAL_A_LINK: DealLocalLink = {
  entityId: "opp-a",
  updatedAt: "2026-08-05T12:00:00.000Z", // newer than DEAL_A's lastModifiedAt
  props: { dealstage: "s2", amount: "6000" }, // local changed amount
  ownerId: "mem-1",
  accountId: "acct-a",
};
const DEAL_A_SNAPSHOT: Snapshot = {
  entityId: "opp-a",
  hubspotId: "hs-deal-a",
  props: { dealstage: "s2", amount: "5000" },
};

// Deal B: HubSpot-only stage change (local unchanged vs snapshot) → plain
// apply, stageChanged true → a review action is recorded.
const DEAL_B: HsRecord = {
  id: "hs-deal-b",
  props: { dealstage: "s2" },
  lastModifiedAt: "1754390000000",
};
const DEAL_B_LINK: DealLocalLink = {
  entityId: "opp-b",
  updatedAt: "2026-08-01T09:00:00.000Z",
  props: { dealstage: "s1" }, // matches snapshot — local unchanged
  ownerId: "mem-2",
  accountId: "acct-b",
};
const DEAL_B_SNAPSHOT: Snapshot = {
  entityId: "opp-b",
  hubspotId: "hs-deal-b",
  props: { dealstage: "s1" },
};

// Deal C: no local link at all → unlinked → createDealFromHubSpot.
const DEAL_C: HsRecord = {
  id: "hs-deal-c",
  props: { dealstage: "s1", associatedcompanyid: "hs-company-x" },
  lastModifiedAt: "1754399000000",
};

interface FakePort extends HubSpotPort {
  calls: string[];
}

function makeFakePort(): FakePort {
  const calls: string[] = [];
  return {
    calls,
    async batchCreate(type, inputs) {
      calls.push(`batchCreate:${type}`);
      return inputs.map((input, i) => ({
        id: `${type}-new-${i}`,
        props: input.props,
        lastModifiedAt: "1000",
      }));
    },
    async batchUpdate(type, inputs) {
      calls.push(`batchUpdate:${type}`);
      return inputs.map((input) => ({ id: input.id, props: input.props, lastModifiedAt: "1000" }));
    },
    async searchModifiedSince(
      type: HsObjectType,
      _sinceMs: string,
      _filters: HsFilter[],
      _properties: string[],
      after?: string,
    ) {
      calls.push(`search:${type}`);
      if (type === "deals" && after === undefined) {
        return { results: [DEAL_A, DEAL_B, DEAL_C], after: null };
      }
      return { results: [], after: null };
    },
    async searchByProperty() {
      calls.push("searchByProperty");
      return [];
    },
    async associateDefault(fromType, _fromId, toType) {
      calls.push(`associate:${fromType}->${toType}`);
    },
    async listOwners() {
      return [];
    },
    async ensureProperty() {},
    async ensureDealPipeline() {
      return { pipelineId: "pl-1", stageIds: {} };
    },
  };
}

interface FakeStore extends HubSpotStorePort {
  cursors: Map<string, string>;
  applyDealPatchCalls: { entityId: string; patch: DealPatch; review: ReviewAction | null }[];
  createDealCalls: HsRecord[];
  errorCalls: unknown[][];
}

function makeFakeStore(): FakeStore {
  const cursors = new Map<string, string>();
  const applyDealPatchCalls: FakeStore["applyDealPatchCalls"] = [];
  const createDealCalls: HsRecord[] = [];
  const errorCalls: unknown[][] = [];

  const dealLinks = new Map<string, LocalLink>([
    ["hs-deal-a", DEAL_A_LINK],
    ["hs-deal-b", DEAL_B_LINK],
  ]);
  const dealSnapshots = new Map<string, Snapshot>([
    ["opp-a", DEAL_A_SNAPSHOT],
    ["opp-b", DEAL_B_SNAPSHOT],
  ]);

  return {
    cursors,
    applyDealPatchCalls,
    createDealCalls,
    errorCalls,

    async getCursor(stream) {
      return cursors.get(stream) ?? null;
    },
    async setCursor(stream, cursor) {
      cursors.set(stream, cursor);
    },
    async changedAccountsSince(iso) {
      return iso ? [] : [NEW_ACCOUNT];
    },
    async changedContactsSince() {
      return [];
    },
    async changedOpportunitiesSince() {
      return [];
    },
    async changedActivitiesSince() {
      return [];
    },
    async changedNextActionsSince() {
      return [];
    },
    async linkHubspotId() {},
    async loadSnapshots(entityType, entityIds) {
      const out = new Map<string, Snapshot>();
      if (entityType !== "opportunity") return out;
      for (const id of entityIds) {
        const s = dealSnapshots.get(id);
        if (s) out.set(id, s);
      }
      return out;
    },
    async saveSnapshot() {},
    async loadLinksByHubspotId(table, hubspotIds) {
      const out = new Map<string, LocalLink>();
      if (table !== "opportunities") return out;
      for (const id of hubspotIds) {
        const l = dealLinks.get(id);
        if (l) out.set(id, l);
      }
      return out;
    },
    async loadHubspotIdsByLocalId() {
      return new Map();
    },
    async applyCompanyPatch() {},
    async applyContactPatch() {},
    async applyDealPatch(entityId, patch, review) {
      applyDealPatchCalls.push({ entityId, patch, review });
    },
    async createDealFromHubSpot(record) {
      createDealCalls.push(record);
    },
    async recordError(...args) {
      errorCalls.push(args);
    },
  };
}

describe("runOrgSync", () => {
  it("drives one full pass: outbound create, HS-wins stage conflict, inbound stage apply, unlinked create", async () => {
    const port = makeFakePort();
    const store = makeFakeStore();
    const now = new Date("2026-08-05T08:00:00.000Z");

    const report = await runOrgSync(port, store, CFG, now);

    // ── call order: companies before contacts before deals ─────────────────
    const companiesIdx = port.calls.findIndex((c) => c.includes(":companies"));
    const contactsIdx = port.calls.findIndex((c) => c.includes(":contacts"));
    const dealsIdx = port.calls.findIndex((c) => c.includes(":deals"));
    expect(companiesIdx).toBeGreaterThanOrEqual(0);
    expect(contactsIdx).toBeGreaterThan(companiesIdx);
    expect(dealsIdx).toBeGreaterThan(contactsIdx);

    // ── 1 new account → outbound create + cursor advances to its updated_at ─
    expect(port.calls).toContain("batchCreate:companies");
    expect(store.cursors.get("out:accounts")).toBe("2026-08-05T10:00:00.000Z");

    // ── deal A: both sides changed, HubSpot stays stage-authoritative ──────
    const dealA = store.applyDealPatchCalls.find((c) => c.entityId === "opp-a");
    expect(dealA?.patch).toEqual({ stage: "DEVELOPMENT" });
    expect(dealA?.review).not.toBeNull();
    expect(dealA?.review?.owner_id).toBe("mem-1");
    expect(dealA?.review?.account_id).toBe("acct-a");
    expect(dealA?.review?.due_date).toBe("2026-08-07"); // now + 2d, deterministic

    // ── deal B: inbound-only stage change → review action recorded ─────────
    const dealB = store.applyDealPatchCalls.find((c) => c.entityId === "opp-b");
    expect(dealB?.patch).toEqual({ stage: "QUALIFIED" });
    expect(dealB?.review).not.toBeNull();
    expect(dealB?.review?.action).toBe("Review deal — stage changed in HubSpot");
    expect(dealB?.review?.owner_id).toBe("mem-2");

    // ── deal C: unlinked → createDealFromHubSpot called once ───────────────
    expect(store.createDealCalls.map((r) => r.id)).toEqual(["hs-deal-c"]);

    // ── inbound cursor advances to the max lastModifiedAt SEEN (deal C's,
    //    the largest, even though it routed to create rather than apply) ───
    expect(store.cursors.get("in:deals")).toBe("1754399000000");

    // No stream should have hit an unexpected error path.
    expect(store.errorCalls).toHaveLength(0);

    const dealsStream = report.streams.find((s) => s.stream === "in:deals");
    expect(dealsStream?.succeeded).toBe(3);
    expect(dealsStream?.errors).toBe(0);
  });

  it("strips associatedcompanyid before comparing deal props, so it never breaks echo suppression", async () => {
    // A deal record that differs from the snapshot ONLY by carrying
    // associatedcompanyid (a HubSpot-side property that never appears in
    // opportunityToDealProps's outbound shape) must resolve as an echo, not
    // an apply — otherwise every inbound deal poll would treat itself as
    // "changed" purely because of the association property.
    const port: HubSpotPort = {
      async batchCreate() {
        return [];
      },
      async batchUpdate() {
        return [];
      },
      async searchModifiedSince(type: HsObjectType) {
        if (type === "deals") {
          return {
            results: [
              {
                id: "hs-deal-echo",
                props: { dealstage: "s1", associatedcompanyid: "hs-company-y" } as HsProps,
                lastModifiedAt: "1754400000000",
              },
            ],
            after: null,
          };
        }
        return { results: [], after: null };
      },
      async searchByProperty() {
        return [];
      },
      async associateDefault() {},
      async listOwners() {
        return [];
      },
      async ensureProperty() {},
      async ensureDealPipeline() {
        return { pipelineId: "pl-1", stageIds: {} };
      },
    };

    const applyDealPatchCalls: { entityId: string }[] = [];
    const store: HubSpotStorePort = {
      async getCursor() {
        return null;
      },
      async setCursor() {},
      async changedAccountsSince() {
        return [];
      },
      async changedContactsSince() {
        return [];
      },
      async changedOpportunitiesSince() {
        return [];
      },
      async changedActivitiesSince() {
        return [];
      },
      async changedNextActionsSince() {
        return [];
      },
      async linkHubspotId() {},
      async loadSnapshots(entityType) {
        if (entityType !== "opportunity") return new Map();
        return new Map([
          [
            "opp-echo",
            { entityId: "opp-echo", hubspotId: "hs-deal-echo", props: { dealstage: "s1" } },
          ],
        ]);
      },
      async saveSnapshot() {},
      async loadLinksByHubspotId(table) {
        if (table !== "opportunities") return new Map();
        return new Map([
          [
            "hs-deal-echo",
            {
              entityId: "opp-echo",
              updatedAt: "2026-08-05T09:00:00.000Z",
              props: { dealstage: "s1" },
              ownerId: "mem-1",
              accountId: "acct-1",
            } satisfies DealLocalLink,
          ],
        ]);
      },
      async loadHubspotIdsByLocalId() {
        return new Map();
      },
      async applyCompanyPatch() {},
      async applyContactPatch() {},
      async applyDealPatch(entityId) {
        applyDealPatchCalls.push({ entityId });
      },
      async createDealFromHubSpot() {},
      async recordError() {},
    };

    const report = await runOrgSync(port, store, CFG, new Date("2026-08-05T08:00:00.000Z"));

    expect(applyDealPatchCalls).toHaveLength(0);
    const dealsStream = report.streams.find((s) => s.stream === "in:deals");
    expect(dealsStream?.succeeded).toBe(1);
    expect(dealsStream?.errors).toBe(0);
  });
});

// F1: a failed row must never be skipped forever by a cursor that advanced
// past it — changed*Since queries are `updated_at > cursor`, so the cursor
// may only advance to the greatest SUCCESSFUL updated_at that is strictly
// below the earliest FAILED row's updated_at this pass.
describe("F1: partial-failure outbound cursor advancement", () => {
  function makeMinimalPort(): FakePort {
    const calls: string[] = [];
    return {
      calls,
      async batchCreate(type, inputs) {
        calls.push(`batchCreate:${type}`);
        return inputs.map((input, i) => ({
          id: `${type}-new-${i}`,
          props: input.props,
          lastModifiedAt: "1000",
        }));
      },
      async batchUpdate(type, inputs) {
        calls.push(`batchUpdate:${type}`);
        return inputs.map((input) => ({ id: input.id, props: input.props, lastModifiedAt: "1000" }));
      },
      async searchModifiedSince() {
        return { results: [], after: null };
      },
      async searchByProperty() {
        return [];
      },
      async associateDefault() {},
      async listOwners() {
        return [];
      },
      async ensureProperty() {},
      async ensureDealPipeline() {
        return { pipelineId: "pl-1", stageIds: {} };
      },
    };
  }

  function makeDealsOnlyStore(opportunities: SyncedOpportunityRow[]): FakeStore {
    const cursors = new Map<string, string>();
    const applyDealPatchCalls: FakeStore["applyDealPatchCalls"] = [];
    const createDealCalls: HsRecord[] = [];
    const errorCalls: unknown[][] = [];
    return {
      cursors,
      applyDealPatchCalls,
      createDealCalls,
      errorCalls,
      async getCursor(stream) {
        return cursors.get(stream) ?? null;
      },
      async setCursor(stream, cursor) {
        cursors.set(stream, cursor);
      },
      async changedAccountsSince() {
        return [];
      },
      async changedContactsSince() {
        return [];
      },
      async changedOpportunitiesSince(iso) {
        return iso ? [] : opportunities;
      },
      async changedActivitiesSince() {
        return [];
      },
      async changedNextActionsSince() {
        return [];
      },
      async linkHubspotId() {},
      async loadSnapshots() {
        return new Map();
      },
      async saveSnapshot() {},
      async loadLinksByHubspotId() {
        return new Map();
      },
      async loadHubspotIdsByLocalId() {
        return new Map();
      },
      async applyCompanyPatch() {},
      async applyContactPatch() {},
      async applyDealPatch(entityId, patch, review) {
        applyDealPatchCalls.push({ entityId, patch, review });
      },
      async createDealFromHubSpot(record) {
        createDealCalls.push(record);
      },
      async recordError(...args) {
        errorCalls.push(args);
      },
    };
  }

  function opp(over: Partial<SyncedOpportunityRow> & { id: string }): SyncedOpportunityRow {
    return {
      hubspot_id: null,
      updated_at: "2026-08-05T08:00:00.000Z",
      primary_account_id: "acct-1",
      owner_id: "mem-1",
      name: "Deal",
      stage: "IDENTIFIED",
      estimated_revenue: null,
      expected_close_date: null,
      current_status: "ok",
      current_blocker: null,
      lead_source: "JOBSITE",
      ...over,
    };
  }

  it("advances the cursor only to the greatest success strictly below the earliest failure", async () => {
    // opp-mid-fail's stage ("BOGUS_STAGE") has no entry in CFG.stage_map, so
    // opportunityToDealProps throws for it — a realistic per-row outbound
    // failure alongside two rows that map fine.
    const rows: SyncedOpportunityRow[] = [
      opp({ id: "opp-earliest", updated_at: "2026-08-05T08:00:00.000Z", stage: "IDENTIFIED" }),
      opp({ id: "opp-mid-fail", updated_at: "2026-08-05T09:00:00.000Z", stage: "BOGUS_STAGE" }),
      opp({ id: "opp-late", updated_at: "2026-08-05T11:00:00.000Z", stage: "QUALIFIED" }),
    ];
    const port = makeMinimalPort();
    const store = makeDealsOnlyStore(rows);

    const report = await runOrgSync(port, store, CFG, new Date("2026-08-05T12:00:00.000Z"));

    // opp-late (11:00) succeeded, but the cursor must NOT jump to it — that
    // would permanently skip opp-mid-fail (09:00) on every future pass
    // (`updated_at > cursor`). Only opp-earliest (08:00, strictly below the
    // 09:00 failure) is eligible.
    expect(store.cursors.get("out:deals")).toBe("2026-08-05T08:00:00.000Z");

    const dealsStream = report.streams.find((s) => s.stream === "out:deals");
    expect(dealsStream?.succeeded).toBe(2);
    expect(dealsStream?.errors).toBe(1);
  });

  it("does not advance the cursor at all when the earliest failure precedes every success", async () => {
    const rows: SyncedOpportunityRow[] = [
      opp({ id: "opp-early-fail", updated_at: "2026-08-05T07:00:00.000Z", stage: "BOGUS_STAGE" }),
      opp({ id: "opp-late-success", updated_at: "2026-08-05T12:00:00.000Z", stage: "QUALIFIED" }),
    ];
    const port = makeMinimalPort();
    const store = makeDealsOnlyStore(rows);

    await runOrgSync(port, store, CFG, new Date("2026-08-05T13:00:00.000Z"));

    expect(store.cursors.has("out:deals")).toBe(false);
  });
});

// F7: a `after` token that stops advancing must not spin the pagination
// loop forever — searchAll bails and the stream records the anomaly instead
// of hanging the whole cron invocation.
describe("F7: stalled search pagination is guarded, not looped forever", () => {
  it("stops after the after token repeats and records an error", async () => {
    const searchCalls: (string | undefined)[] = [];
    const port: HubSpotPort = {
      async batchCreate() {
        return [];
      },
      async batchUpdate() {
        return [];
      },
      async searchModifiedSince(type: HsObjectType, _sinceMs, _filters, _properties, after?: string) {
        if (type !== "deals") return { results: [], after: null };
        searchCalls.push(after);
        // Always hands back the same `after` — a non-advancing cursor, which
        // would spin forever without the stall guard.
        return { results: [], after: "cur-stuck" };
      },
      async searchByProperty() {
        return [];
      },
      async associateDefault() {},
      async listOwners() {
        return [];
      },
      async ensureProperty() {},
      async ensureDealPipeline() {
        return { pipelineId: "pl-1", stageIds: {} };
      },
    };

    const errorCalls: unknown[][] = [];
    const store: HubSpotStorePort = {
      async getCursor() {
        return null;
      },
      async setCursor() {},
      async changedAccountsSince() {
        return [];
      },
      async changedContactsSince() {
        return [];
      },
      async changedOpportunitiesSince() {
        return [];
      },
      async changedActivitiesSince() {
        return [];
      },
      async changedNextActionsSince() {
        return [];
      },
      async linkHubspotId() {},
      async loadSnapshots() {
        return new Map();
      },
      async saveSnapshot() {},
      async loadLinksByHubspotId() {
        return new Map();
      },
      async loadHubspotIdsByLocalId() {
        return new Map();
      },
      async applyCompanyPatch() {},
      async applyContactPatch() {},
      async applyDealPatch() {},
      async createDealFromHubSpot() {},
      async recordError(...args) {
        errorCalls.push(args);
      },
    };

    const report = await runOrgSync(port, store, CFG, new Date("2026-08-05T08:00:00.000Z"));

    // First call: after=undefined, returns "cur-stuck" (advances, not
    // stalled). Second call: after="cur-stuck", returns "cur-stuck" again
    // (repeats) — stalled, loop breaks. Exactly 2 calls, not an infinite loop.
    expect(searchCalls).toEqual([undefined, "cur-stuck"]);

    const stalledError = errorCalls.find(
      (args) => typeof args[5] === "string" && (args[5] as string).includes("stalled"),
    );
    expect(stalledError).toBeDefined();

    const dealsStream = report.streams.find((s) => s.stream === "in:deals");
    expect(dealsStream?.errors).toBeGreaterThanOrEqual(1);
  });
});

// Task 12 Step 1: the admin route's setup helpers, tested in isolation from
// any HubSpot API or Supabase call — buildOwnerMap and STAGE_LABELS are pure.
describe("STAGE_LABELS", () => {
  it("carries exactly the 8 opportunity-stage enum values, each with a label", () => {
    expect(STAGE_LABELS.map(([stage]) => stage).sort()).toEqual([...OPPORTUNITY_STAGES].sort());
    expect(STAGE_LABELS).toHaveLength(8);
    for (const [, label] of STAGE_LABELS) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("builds a stage_map whose keys are exactly the 8 enum values", () => {
    // Mirrors how the admin route turns ensureDealPipeline's label→id map
    // into our enum→id stage_map.
    const stageIds = Object.fromEntries(STAGE_LABELS.map(([, label]) => [label, `hs-${label}`]));
    const stageMap = Object.fromEntries(
      STAGE_LABELS.map(([stage, label]) => [stage, stageIds[label]]),
    );
    expect(Object.keys(stageMap).sort()).toEqual([...OPPORTUNITY_STAGES].sort());
  });
});

describe("buildOwnerMap", () => {
  it("matches owners to memberships by email, case-insensitively", () => {
    const owners = [
      { id: "hs-owner-1", email: "Rep@Example.com" },
      { id: "hs-owner-2", email: "second@example.com" },
    ];
    const memberships = [
      { membershipId: "mem-1", email: "rep@example.com" }, // differs only by case
      { membershipId: "mem-2", email: "SECOND@EXAMPLE.COM" },
    ];

    const { ownerMap, unmatched } = buildOwnerMap(owners, memberships);

    expect(ownerMap).toEqual({ "mem-1": "hs-owner-1", "mem-2": "hs-owner-2" });
    expect(unmatched).toEqual([]);
  });

  it("lists memberships with no matching HubSpot owner as unmatched, not fatal", () => {
    const owners = [{ id: "hs-owner-1", email: "rep@example.com" }];
    const memberships = [
      { membershipId: "mem-1", email: "rep@example.com" },
      { membershipId: "mem-2", email: "nobody@example.com" },
    ];

    const { ownerMap, unmatched } = buildOwnerMap(owners, memberships);

    expect(ownerMap).toEqual({ "mem-1": "hs-owner-1" });
    expect(unmatched).toEqual(["mem-2"]);
  });

  it("returns an empty map and no unmatched entries when there are no memberships", () => {
    const { ownerMap, unmatched } = buildOwnerMap([{ id: "hs-1", email: "a@b.com" }], []);
    expect(ownerMap).toEqual({});
    expect(unmatched).toEqual([]);
  });
});

// I-1: hubspot-api.ts's HubSpotApi.batchCreate/batchUpdate throw on a 207
// partial-success response rather than returning a short/misaligned results
// array (see hubspot-api.test.ts). This test proves the OTHER half of the
// fix: a stream with no per-record fallback (accounts/opportunities — only
// contacts gets one, I-2) must treat that thrown error as a batch-level
// failure — every candidate recordError'd, NO linkHubspotId call for
// anyone — rather than pairing a short results array to the wrong rows by
// index and silently cross-linking a hubspot_id to the wrong local account.
describe("I-1: a batch-level partial-success failure never cross-links ids", () => {
  function accountRow(over: Partial<SyncedAccountRow> & { id: string }): SyncedAccountRow {
    return {
      hubspot_id: null,
      updated_at: "2026-08-05T08:00:00.000Z",
      parent_account_id: null,
      name: "Some Account",
      city: "Anaheim",
      account_type: "DEALER",
      lead_source: "JOBSITE",
      has_display_wall: false,
      owner_id: "mem-1",
      ...over,
    };
  }

  it("records an error for every candidate and links no one when batchCreate throws", async () => {
    const linkCalls: { table: string; id: string; hubspotId: string }[] = [];
    const errorCalls: unknown[][] = [];
    const cursors = new Map<string, string>();

    const port: HubSpotPort = {
      async batchCreate() {
        // Simulates hubspot-api.ts's I-1 throw on a 207 Multi-Status batch.
        throw new Error("HubSpot API 207: partial success");
      },
      async batchUpdate() {
        return [];
      },
      async searchModifiedSince() {
        return { results: [], after: null };
      },
      async searchByProperty() {
        return [];
      },
      async associateDefault() {},
      async listOwners() {
        return [];
      },
      async ensureProperty() {},
      async ensureDealPipeline() {
        return { pipelineId: "pl-1", stageIds: {} };
      },
    };

    const rows: SyncedAccountRow[] = [
      accountRow({ id: "acct-a", updated_at: "2026-08-05T08:00:00.000Z" }),
      accountRow({ id: "acct-b", updated_at: "2026-08-05T09:00:00.000Z" }),
    ];

    const store: HubSpotStorePort = {
      async getCursor(stream) {
        return cursors.get(stream) ?? null;
      },
      async setCursor(stream, cursor) {
        cursors.set(stream, cursor);
      },
      async changedAccountsSince(iso) {
        return iso ? [] : rows;
      },
      async changedContactsSince() {
        return [];
      },
      async changedOpportunitiesSince() {
        return [];
      },
      async changedActivitiesSince() {
        return [];
      },
      async changedNextActionsSince() {
        return [];
      },
      async linkHubspotId(table, id, hubspotId) {
        linkCalls.push({ table, id, hubspotId });
      },
      async loadSnapshots() {
        return new Map();
      },
      async saveSnapshot() {},
      async loadLinksByHubspotId() {
        return new Map();
      },
      async loadHubspotIdsByLocalId() {
        return new Map();
      },
      async applyCompanyPatch() {},
      async applyContactPatch() {},
      async applyDealPatch() {},
      async createDealFromHubSpot() {},
      async recordError(...args) {
        errorCalls.push(args);
      },
    };

    const outcome = await syncOutboundAccounts(port, store, CFG);

    expect(linkCalls).toHaveLength(0);
    expect(errorCalls).toHaveLength(2);
    expect(errorCalls.map((args) => args[2])).toEqual(["acct-a", "acct-b"]);
    expect(outcome.succeeded).toBe(0);
    expect(outcome.errors).toBe(2);
    // Both candidates failed, so the cursor must not advance at all.
    expect(cursors.has("out:accounts")).toBe(false);
  });
});

// I-2: an ongoing contact create batch that partially fails (a colliding
// email 207s the whole batch, per hubspot-api.ts's I-1 fix) must not wedge
// out:contacts forever — F1's cursor floor would refetch the SAME
// candidates every 5-minute pass. syncOutboundContacts falls back to a
// per-record create-or-adopt for that batch.
describe("I-2: ongoing out:contacts falls back to per-record create-or-adopt on a batch failure", () => {
  function contactRow(over: Partial<SyncedContactRow> & { id: string; email: string }): SyncedContactRow {
    return {
      hubspot_id: null,
      updated_at: "2026-08-05T08:00:00.000Z",
      account_id: "acct-1",
      name: "Someone",
      phone: null,
      job_title: null,
      is_champion: false,
      ...over,
    };
  }

  const CONTACT_OK = contactRow({
    id: "c-ok",
    email: "new@example.com",
    updated_at: "2026-08-05T08:00:00.000Z",
    account_id: "acct-ok",
  });
  const CONTACT_COLLIDING = contactRow({
    id: "c-collide",
    email: "dup@example.com",
    updated_at: "2026-08-05T08:05:00.000Z",
    account_id: "acct-collide",
  });
  const CONTACT_BAD = contactRow({
    id: "c-bad",
    email: "fail@example.com",
    updated_at: "2026-08-05T08:10:00.000Z",
    account_id: "acct-bad",
  });

  interface FakeContactPort extends HubSpotPort {
    associateCalls: { contactHsId: string; companyHsId: string }[];
  }

  function makePort(): FakeContactPort {
    const associateCalls: FakeContactPort["associateCalls"] = [];
    return {
      associateCalls,
      async batchCreate(type, inputs) {
        if (type !== "contacts" || inputs.length > 1) {
          throw new Error("simulated 207 partial-success batch failure");
        }
        const email = inputs[0].props.email;
        if (email === "new@example.com") {
          return [{ id: "hs-new", props: inputs[0].props, lastModifiedAt: "1" }];
        }
        throw new Error(`simulated create failure for ${email}`);
      },
      async batchUpdate() {
        return [];
      },
      async searchModifiedSince() {
        return { results: [], after: null };
      },
      async searchByProperty(_type, _prop, value) {
        if (value === "dup@example.com") {
          return [{ id: "hs-existing-dup", props: { email: value }, lastModifiedAt: "1" }];
        }
        return [];
      },
      async associateDefault(_fromType, contactHsId, _toType, companyHsId) {
        associateCalls.push({ contactHsId, companyHsId });
      },
      async listOwners() {
        return [];
      },
      async ensureProperty() {},
      async ensureDealPipeline() {
        return { pipelineId: "pl-1", stageIds: {} };
      },
    };
  }

  interface FakeContactStore extends HubSpotStorePort {
    linkCalls: { table: string; id: string; hubspotId: string }[];
    saveSnapshotCalls: { entityType: string; entityId: string }[];
    errorCalls: unknown[][];
    cursors: Map<string, string>;
  }

  function makeStore(rows: SyncedContactRow[]): FakeContactStore {
    const linkCalls: FakeContactStore["linkCalls"] = [];
    const saveSnapshotCalls: FakeContactStore["saveSnapshotCalls"] = [];
    const errorCalls: unknown[][] = [];
    const cursors = new Map<string, string>();
    // acct-bad deliberately has no company mapping — irrelevant, since c-bad
    // fails before association is ever attempted.
    const companyByAccount = new Map([
      ["acct-ok", "hs-company-ok"],
      ["acct-collide", "hs-company-collide"],
    ]);

    return {
      linkCalls,
      saveSnapshotCalls,
      errorCalls,
      cursors,
      async getCursor(stream) {
        return cursors.get(stream) ?? null;
      },
      async setCursor(stream, cursor) {
        cursors.set(stream, cursor);
      },
      async changedAccountsSince() {
        return [];
      },
      async changedContactsSince(iso) {
        return iso ? [] : rows;
      },
      async changedOpportunitiesSince() {
        return [];
      },
      async changedActivitiesSince() {
        return [];
      },
      async changedNextActionsSince() {
        return [];
      },
      async linkHubspotId(table, id, hubspotId) {
        linkCalls.push({ table, id, hubspotId });
      },
      async loadSnapshots() {
        return new Map();
      },
      async saveSnapshot(entityType, s) {
        saveSnapshotCalls.push({ entityType, entityId: s.entityId });
      },
      async loadLinksByHubspotId() {
        return new Map();
      },
      async loadHubspotIdsByLocalId(table, ids) {
        const out = new Map<string, string>();
        if (table !== "accounts") return out;
        for (const id of ids) {
          const hs = companyByAccount.get(id);
          if (hs) out.set(id, hs);
        }
        return out;
      },
      async applyCompanyPatch() {},
      async applyContactPatch() {},
      async applyDealPatch() {},
      async createDealFromHubSpot() {},
      async recordError(...args) {
        errorCalls.push(args);
      },
    };
  }

  it("adopts the colliding contact, creates the clean one, and records an error for the genuine failure", async () => {
    const port = makePort();
    const store = makeStore([CONTACT_OK, CONTACT_COLLIDING, CONTACT_BAD]);

    const outcome = await syncOutboundContacts(port, store, CFG);

    // Colliding contact: adopted via the email search hit — linked to the
    // FOUND hubspot id, never created, and (per the no-snapshot rule) no
    // snapshot saved for it — next pass sends a full-props patch instead.
    const collideLink = store.linkCalls.find((c) => c.id === "c-collide");
    expect(collideLink?.hubspotId).toBe("hs-existing-dup");
    expect(store.saveSnapshotCalls.some((s) => s.entityId === "c-collide")).toBe(false);
    expect(port.associateCalls).toContainEqual({
      contactHsId: "hs-existing-dup",
      companyHsId: "hs-company-collide",
    });

    // Clean contact: created, linked, snapshotted, and associated normally.
    const okLink = store.linkCalls.find((c) => c.id === "c-ok");
    expect(okLink?.hubspotId).toBe("hs-new");
    expect(store.saveSnapshotCalls.some((s) => s.entityId === "c-ok")).toBe(true);
    expect(port.associateCalls).toContainEqual({ contactHsId: "hs-new", companyHsId: "hs-company-ok" });

    // Genuinely-failing contact: no create, no adoption match, no link call —
    // just a recorded error, same as any other outbound failure.
    expect(store.linkCalls.some((c) => c.id === "c-bad")).toBe(false);
    const badError = store.errorCalls.find((args) => args[2] === "c-bad");
    expect(badError).toBeDefined();

    expect(outcome.succeeded).toBe(2);
    expect(outcome.errors).toBe(1);

    // F1: cursor floors strictly below c-bad's (08:10) updated_at, so it's
    // refetched and retried next pass instead of being skipped forever.
    expect(store.cursors.get("out:contacts")).toBe("2026-08-05T08:05:00.000Z");
  });
});
