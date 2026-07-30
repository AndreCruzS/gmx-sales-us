// Task 10 (D-routine): the review sheet's fan-out. A confirmed debrief draft
// carries routine dispositions (chores the rep addressed) and typed
// commitments (next_actions with a kind) — this turns both into the outbox
// ops the Send path enqueues. Pure, no I/O: the caller is responsible for
// enqueueing what this returns and rolling back on partial failure (D62),
// same as every other multi-op flow on the review page.
//
// Carried finding (Task 9's review): routine_dispositions is required-
// without-default on the schema, but pre-existing ai_draft rows lack the
// field — defended here with `?? []`, same as sanitizeDraft.

import type { EntityType } from "@/lib/domain/schemas";
import type { DebriefDraft } from "./draft";

export interface DebriefOp {
  entityType: EntityType;
  op: "create" | "update";
  payload: Record<string, unknown>;
  baseVersion: string | null;
}

export function buildRoutineOps(
  draft: DebriefDraft,
  accountId: string,
  ownerId: string,
  orgId: string,
  itemVersions: Record<string, string>, // next_action id -> updated_at (LWW base)
  accountVersion: string,
  nowIso: string,
): DebriefOp[] {
  const ops: DebriefOp[] = [];
  let accountVerified = false;

  for (const disposition of draft.routine_dispositions ?? []) {
    if (disposition.disposition === "DONE") {
      ops.push({
        entityType: "next_action",
        op: "update",
        payload: { id: disposition.item_id, completed_at: nowIso },
        baseVersion: itemVersions[disposition.item_id] ?? null,
      });
    } else if (disposition.disposition === "DISPLAY_VERIFIED") {
      // At most one account update no matter how many display mentions the
      // rep confirmed — the account only has one display_last_verified_at.
      if (!accountVerified) {
        accountVerified = true;
        ops.push({
          entityType: "account",
          op: "update",
          payload: { id: accountId, display_last_verified_at: nowIso },
          baseVersion: accountVersion,
        });
      }
    }
  }

  for (const nextAction of draft.next_actions ?? []) {
    if (!nextAction.kind) continue; // untyped commitments ride the plain create path
    ops.push({
      entityType: "next_action",
      op: "create",
      payload: {
        id: crypto.randomUUID(), // client-minted (D57 idempotency key)
        org_id: orgId,
        owner_id: ownerId,
        account_id: accountId,
        kind: nextAction.kind,
        action: nextAction.action,
        due_date: nextAction.due_date,
      },
      baseVersion: null,
    });
  }

  return ops;
}
