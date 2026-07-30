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
//
// Final-review finding 3 (baseVersion resolution): itemVersions/accountVersion
// must be resolved by the CALLER from its cached working set BEFORE calling
// this function — that's what makes "can't resolve" detectable here rather
// than surfacing as a thrown sync-engine guard (sync-engine.ts:40 throws on
// any update op with a falsy baseVersion, which sinks the ENTIRE Send).
// Dispositions are pre-checked by the sheet, so a stale one (item completed
// elsewhere, dropped by the 200-row cache cap, or on another device) reaches
// here without any rep action — it must be dropped, not thrown. A missing
// itemVersions entry (DONE) or a null accountVersion (DISPLAY_VERIFIED) means
// "not in cache" — that op is silently excluded (console note only); the
// commitment creates and the other dispositions still go through.
//
// Final-review finding 4 (typed commitments): kind-bearing next_actions used
// to skip the untyped path's guards entirely — no blank-field skip (a blank
// due_date would fail zod at the outbox boundary and sink the whole Send),
// no objective (an AI-extracted VISIT objective was silently dropped), no
// activity_id (permanent record-of-truth asymmetry vs. the untyped path's
// `activity_id: activityId`, unbackfillable once synced). All three are
// fixed below to mirror the untyped loop in review/page.tsx's send()
// exactly: same blank-field skip, same D48 OTHER->null objective guard, same
// activity_id linkage.

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
  itemVersions: Record<string, string>, // next_action id -> updated_at (LWW base); caller-resolved, absent = not cached
  accountVersion: string | null, // account's updated_at (LWW base); caller-resolved, null = not cached
  nowIso: string,
  activityId: string, // Rule 3 linkage, same as the untyped next-action creates
): DebriefOp[] {
  const ops: DebriefOp[] = [];
  let accountVerified = false;
  let accountVersionMissingWarned = false;

  for (const disposition of draft.routine_dispositions ?? []) {
    if (disposition.disposition === "DONE") {
      const baseVersion = itemVersions[disposition.item_id];
      if (!baseVersion) {
        // Pre-checked disposition, item not in the cached agenda (completed
        // elsewhere / dropped by the 200-row cap / another device) — drop
        // rather than emit an update with no baseVersion, which would throw
        // at enqueue and sink the whole Send.
        console.warn(
          `buildRoutineOps: dropping DONE disposition for next_action ${disposition.item_id} — not in cached agenda, no baseVersion to update against`,
        );
        continue;
      }
      ops.push({
        entityType: "next_action",
        op: "update",
        payload: { id: disposition.item_id, completed_at: nowIso },
        baseVersion,
      });
    } else if (disposition.disposition === "DISPLAY_VERIFIED") {
      // At most one account update no matter how many display mentions the
      // rep confirmed — the account only has one display_last_verified_at.
      if (accountVerified) continue;
      if (!accountVersion) {
        if (!accountVersionMissingWarned) {
          console.warn(
            `buildRoutineOps: dropping DISPLAY_VERIFIED for account ${accountId} — account not in cache, no baseVersion to update against`,
          );
          accountVersionMissingWarned = true;
        }
        continue;
      }
      accountVerified = true;
      ops.push({
        entityType: "account",
        op: "update",
        payload: { id: accountId, display_last_verified_at: nowIso },
        baseVersion: accountVersion,
      });
    }
  }

  for (const nextAction of draft.next_actions ?? []) {
    if (!nextAction.kind) continue; // untyped commitments ride the plain create path
    // Same empty-field skip as the untyped loop (review/page.tsx send()) — a
    // blank due_date fails zod at the outbox boundary and would sink the
    // whole Send; a blank action is nothing to act on.
    if (!nextAction.action.trim() || !nextAction.due_date) continue;
    ops.push({
      entityType: "next_action",
      op: "create",
      payload: {
        id: crypto.randomUUID(), // client-minted (D57 idempotency key)
        org_id: orgId,
        owner_id: ownerId,
        account_id: accountId,
        activity_id: activityId, // Rule 3 linkage — matches the untyped path
        kind: nextAction.kind,
        action: nextAction.action,
        due_date: nextAction.due_date,
        // D48: OTHER requires objective_detail, which a draft can't supply —
        // drop OTHER rather than trip the check, same as the untyped path.
        objective:
          nextAction.objective === "OTHER" ? null : (nextAction.objective ?? null),
      },
      baseVersion: null,
    });
  }

  return ops;
}
