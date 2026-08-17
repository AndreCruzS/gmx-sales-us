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
    account_id: null,
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
const ACTIVITY_ID = "dddddddd-0000-0000-0000-000000000001";
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
      ACTIVITY_ID,
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
        activity_id: ACTIVITY_ID,
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
      ACTIVITY_ID,
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
      ACTIVITY_ID,
    );

    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      entityType: "next_action",
      op: "create",
      payload: { activity_id: ACTIVITY_ID },
    });
    expect(ops[0].payload.kind).toBe("QUOTE_FOLLOW_UP");
  });

  it("defends against a stored draft missing routine_dispositions (Task 9 finding)", () => {
    const draft = { ...baseDraft(), routine_dispositions: undefined } as unknown as DebriefDraft;

    expect(() =>
      buildRoutineOps(
        draft,
        ACCOUNT_ID,
        OWNER_ID,
        ORG_ID,
        {},
        ACCOUNT_VERSION,
        NOW,
        ACTIVITY_ID,
      ),
    ).not.toThrow();
  });

  // Final-review finding 3: a pre-checked DONE disposition whose item isn't
  // in the cached agenda (completed elsewhere, dropped by the 200-row cache
  // cap, or another device) must be dropped, not turned into an update op
  // with baseVersion null — that would throw at enqueue (sync-engine.ts's
  // D61 guard) and sink the entire Send, including the activity and every
  // other op in the same fan-out.
  it("drops a DONE disposition whose item is not in the cached itemVersions, keeps the rest", () => {
    const draft = baseDraft({
      routine_dispositions: [
        { item_id: "na-cached", disposition: "DONE", note: null },
        { item_id: "na-not-cached", disposition: "DONE", note: null },
      ],
    });
    const itemVersions = { "na-cached": "2026-07-20T00:00:00.000Z" };

    const ops = buildRoutineOps(
      draft,
      ACCOUNT_ID,
      OWNER_ID,
      ORG_ID,
      itemVersions,
      ACCOUNT_VERSION,
      NOW,
      ACTIVITY_ID,
    );

    const updates = ops.filter(
      (o) => o.entityType === "next_action" && o.op === "update",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.id).toBe("na-cached");
  });

  // Same principle, the DISPLAY_VERIFIED path: an uncached account (the old
  // `?? ""` fallback in review/page.tsx) must not produce an update op —
  // `accountVersion: null` signals "not resolvable" and the op is dropped.
  it("drops a DISPLAY_VERIFIED disposition when accountVersion is null (account not cached)", () => {
    const draft = baseDraft({
      routine_dispositions: [
        { item_id: ACCOUNT_ID, disposition: "DISPLAY_VERIFIED", note: null },
      ],
    });

    const ops = buildRoutineOps(
      draft,
      ACCOUNT_ID,
      OWNER_ID,
      ORG_ID,
      {},
      null,
      NOW,
      ACTIVITY_ID,
    );

    expect(ops.filter((o) => o.entityType === "account")).toHaveLength(0);
  });

  // Final-review finding 4: typed (kind-bearing) commitments used to skip
  // the untyped path's guards entirely. A blank due_date must be excluded
  // here rather than reach the outbox boundary, where it would fail zod
  // (nextActionCreateSchema's due_date regex) and sink the whole Send.
  it("excludes a kind-bearing commitment with a blank due_date", () => {
    const draft = baseDraft({
      next_actions: [
        { action: "Send sample", due_date: "", objective: null, kind: "SAMPLE_FOLLOW_UP" },
        {
          action: "Send another",
          due_date: "2026-08-01",
          objective: null,
          kind: "SAMPLE_FOLLOW_UP",
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
      ACTIVITY_ID,
    );

    expect(ops).toHaveLength(1);
    expect(ops[0].payload.action).toBe("Send another");
  });

  // A VISIT-kind commitment's AI-extracted objective must survive into the
  // create payload — it used to be dropped entirely for typed commitments.
  it("threads objective through for a kind-bearing commitment, applying the D48 OTHER guard", () => {
    const draft = baseDraft({
      next_actions: [
        {
          action: "Discovery visit",
          due_date: "2026-08-01",
          objective: "MEET_CONTRACTOR",
          kind: "VISIT",
        },
        {
          action: "Some other visit",
          due_date: "2026-08-02",
          objective: "OTHER",
          kind: "VISIT",
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
      ACTIVITY_ID,
    );

    expect(ops).toHaveLength(2);
    const discovery = ops.find((o) => o.payload.action === "Discovery visit");
    expect(discovery?.payload.objective).toBe("MEET_CONTRACTOR");
    // D48: OTHER requires objective_detail, which a draft can't supply — a
    // draft-sourced OTHER objective is dropped to null rather than trip the
    // DB check constraint, same as the untyped path.
    const other = ops.find((o) => o.payload.action === "Some other visit");
    expect(other?.payload.objective).toBeNull();
  });
});
