// SupabaseSyncBackend argument-shaping: the sync-engine tests (fake-backend.ts)
// cover dispatch routing but stub the RPC call shape away entirely. This file
// asserts the actual p_opportunity/p_next_action payloads sent to
// create_opportunity_with_action, and the classify() error routing.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SyncRejectionError } from "../types";
import { SupabaseSyncBackend } from "../supabase-backend";

const ORG = "22222222-2222-2222-2222-222222222222";
const OWNER = "55555555-5555-5555-5555-555555555555";
const ACCOUNT = "33333333-3333-3333-3333-333333333333";
const OPP = "11111111-1111-1111-1111-111111111111";

function opportunityPayload() {
  return {
    id: OPP,
    org_id: ORG,
    name: "Ganahl decking",
    primary_account_id: ACCOUNT,
    territory_id: "44444444-4444-4444-4444-444444444444",
    owner_id: OWNER,
    stage: "IDENTIFIED",
    current_status: "Intro made",
    lead_source: "EXISTING_RELATIONSHIP",
    first_action: {
      id: "66666666-6666-6666-6666-666666666666",
      action: "Drop decking sample",
      due_date: "2026-08-12",
      kind: "SAMPLE_FOLLOW_UP",
    },
  };
}

function backendWithRpc(rpc: ReturnType<typeof vi.fn>): SupabaseSyncBackend {
  const stubClient = { rpc } as unknown as SupabaseClient;
  return new SupabaseSyncBackend(stubClient);
}

describe("SupabaseSyncBackend.createOpportunityWithAction — RPC argument shaping", () => {
  it("calls create_opportunity_with_action with opportunity/next_action split correctly", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const backend = backendWithRpc(rpc);
    const payload = opportunityPayload();

    await backend.createOpportunityWithAction(payload);

    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("create_opportunity_with_action");

    // p_opportunity: the opportunity fields, with first_action stripped out.
    expect(args.p_opportunity).not.toHaveProperty("first_action");
    expect(args.p_opportunity).toMatchObject({
      id: OPP,
      org_id: ORG,
      name: "Ganahl decking",
      primary_account_id: ACCOUNT,
      territory_id: "44444444-4444-4444-4444-444444444444",
      owner_id: OWNER,
      stage: "IDENTIFIED",
      current_status: "Intro made",
      lead_source: "EXISTING_RELATIONSHIP",
    });

    // p_next_action: first_action's own fields plus the derived FKs.
    expect(args.p_next_action).toMatchObject({
      id: "66666666-6666-6666-6666-666666666666",
      action: "Drop decking sample",
      due_date: "2026-08-12",
      kind: "SAMPLE_FOLLOW_UP",
      org_id: ORG, // derived from payload.org_id
      owner_id: OWNER, // derived from payload.owner_id
      account_id: ACCOUNT, // derived from payload.primary_account_id
      opportunity_id: OPP, // derived from payload.id
    });
  });

  it("routes a rejection-coded RPC error through classify() as a SyncRejectionError", async () => {
    const rpc = vi.fn().mockResolvedValue({
      error: { code: "23514", message: "opportunity stage gate: no open next_action" },
    });
    const backend = backendWithRpc(rpc);

    await expect(
      backend.createOpportunityWithAction(opportunityPayload()),
    ).rejects.toBeInstanceOf(SyncRejectionError);
  });
});
