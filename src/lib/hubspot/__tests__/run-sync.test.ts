// runOrgSync — one full pass driven by a fake HubSpotPort + fake in-memory
// HubSpotStorePort, proving the orchestration (stream order, plan→execute→
// snapshot→cursor) without touching Supabase or the HubSpot API. sync-core.ts
// and mapping.ts already have their own fixture suites; this test only checks
// that run-sync wires them together correctly.

import { describe, expect, it } from "vitest";
import type { HsFilter, HsObjectType, HsProps, HsRecord, HubSpotOrgConfig, HubSpotPort } from "../port";
import { runOrgSync } from "../run-sync";
import type { DealPatch } from "../mapping";
import type {
  DealLocalLink,
  HubSpotStorePort,
  ReviewAction,
  SyncedAccountRow,
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
