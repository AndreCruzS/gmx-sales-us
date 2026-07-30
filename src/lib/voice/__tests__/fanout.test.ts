// Task 10 (D-routine): the review sheet's fan-out — a confirmed debrief
// draft's dispositions and typed commitments become outbox ops. Pure builder,
// no I/O: the caller (review page) enqueues whatever this returns and rolls
// back on partial failure (D62).
//
// Carried finding (Task 9 review): routine_dispositions is required-without-
// default on the schema, but pre-existing ai_draft rows lack the field —
// this must tolerate that (defensive `?? []`), same as sanitizeDraft.

import { describe, expect, it } from "vitest";
import { buildRoutineOps } from "../fanout";
import type { DebriefDraft } from "../draft";

function baseDraft(overrides: Partial<DebriefDraft> = {}): DebriefDraft {
  return {
    summary: "Visited the dealer, discussed samples.",
    activity_type: "DEALER_VISIT",
    what_happened: "Talked about display wall placement.",
    key_information: null,
    commercial_potential: null,
    outcomes: [],
    follow_up_required: false,
    next_actions: [],
    routine_dispositions: [],
    ...overrides,
  };
}

const ACCOUNT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const ORG_ID = "cccccccc-0000-0000-0000-000000000001";
const NOW = "2026-07-30T12:00:00.000Z";
const ACCOUNT_VERSION = "2026-07-01T00:00:00.000Z";

describe("buildRoutineOps", () => {
  it("turns a DONE disposition, a DISPLAY_VERIFIED disposition, and two sample commitments into fan-out ops", () => {
    const draft = baseDraft({
      routine_dispositions: [
        { item_id: "na-1", disposition: "DONE", note: null },
        { item_id: ACCOUNT_ID, disposition: "DISPLAY_VERIFIED", note: null },
      ],
      next_actions: [
        {
          action: "Send sample A",
          due_date: "2026-08-01",
          objective: null,
          kind: "SAMPLE_FOLLOW_UP",
        },
        {
          action: "Send sample B",
          due_date: "2026-08-05",
          objective: null,
          kind: "SAMPLE_FOLLOW_UP",
        },
      ],
    });
    const itemVersions = { "na-1": "2026-07-20T00:00:00.000Z" };

    const ops = buildRoutineOps(
      draft,
      ACCOUNT_ID,
      OWNER_ID,
      ORG_ID,
      itemVersions,
      ACCOUNT_VERSION,
      NOW,
    );

    const update = ops.find(
      (o) => o.entityType === "next_action" && o.op === "update",
    );
    expect(update).toEqual({
      entityType: "next_action",
      op: "update",
      payload: { id: "na-1", completed_at: NOW },
      baseVersion: "2026-07-20T00:00:00.000Z",
    });

    const acctUpdates = ops.filter((o) => o.entityType === "account");
    expect(acctUpdates).toHaveLength(1);
    expect(acctUpdates[0]).toEqual({
      entityType: "account",
      op: "update",
      payload: { id: ACCOUNT_ID, display_last_verified_at: NOW },
      baseVersion: ACCOUNT_VERSION,
    });

    const creates = ops.filter(
      (o) => o.entityType === "next_action" && o.op === "create",
    );
    expect(creates).toHaveLength(2);
    for (const c of creates) {
      expect(c.payload).toMatchObject({
        org_id: ORG_ID,
        owner_id: OWNER_ID,
        account_id: ACCOUNT_ID,
        kind: "SAMPLE_FOLLOW_UP",
      });
      expect(c.baseVersion).toBeNull();
      expect(typeof c.payload.id).toBe("string");
    }
    const ids = creates.map((c) => c.payload.id as string);
    expect(new Set(ids).size).toBe(2);

    expect(ops).toHaveLength(4); // 1 update + 1 account update + 2 creates
  });

  it("emits at most one account update even with several DISPLAY_VERIFIED mentions", () => {
    const draft = baseDraft({
      routine_dispositions: [
        { item_id: ACCOUNT_ID, disposition: "DISPLAY_VERIFIED", note: null },
        {
          item_id: ACCOUNT_ID,
          disposition: "DISPLAY_VERIFIED",
          note: "mentioned twice",
        },
      ],
    });

    const ops = buildRoutineOps(
      draft,
      ACCOUNT_ID,
      OWNER_ID,
      ORG_ID,
      {},
      ACCOUNT_VERSION,
      NOW,
    );

    expect(ops.filter((o) => o.entityType === "account")).toHaveLength(1);
  });

  it("with no dispositions, produces only creates for kind-bearing commitments", () => {
    const draft = baseDraft({
      next_actions: [
        {
          action: "Chase the quote",
          due_date: "2026-08-10",
          objective: null,
          kind: "QUOTE_FOLLOW_UP",
        },
        {
          action: "Untyped note",
          due_date: "2026-08-11",
          objective: null,
          kind: null,
        },
      ],
    });

    const ops = buildRoutineOps(
      draft,
      ACCOUNT_ID,
      OWNER_ID,
      ORG_ID,
      {},
      ACCOUNT_VERSION,
      NOW,
    );

    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entityType: "next_action", op: "create" });
    expect(ops[0].payload.kind).toBe("QUOTE_FOLLOW_UP");
  });

  it("defends against a stored draft missing routine_dispositions (Task 9 finding)", () => {
    const draft = { ...baseDraft(), routine_dispositions: undefined } as unknown as DebriefDraft;

    expect(() =>
      buildRoutineOps(draft, ACCOUNT_ID, OWNER_ID, ORG_ID, {}, ACCOUNT_VERSION, NOW),
    ).not.toThrow();
  });
});
