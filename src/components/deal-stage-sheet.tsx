"use client";

// Stage advance sheet (Task 6, hubspot-sync-bridge): opened from the account
// page's opportunity row when the rep taps the stage pill. Bottom-sheet idiom
// matches src/app/review/page.tsx's ReviewSheet/CardSheet.
//
// Rule 3 at edit time mirrors the create-time gate in new-deal/page.tsx: a
// deal moving to a non-terminal stage (anything but WON/LOST) must have an
// open next action. If it already does (hasOpenAction, derived by the caller
// from the account page's loaded next_actions), no extra input is required
// here. If it doesn't, the rep must supply one right in this sheet.
//
// Save enqueues in FIFO-safe order: the action (when required) goes in
// BEFORE the opportunity update. The outbox drains by seq, and the deferred
// stage-change DB gate needs the action already on the books when the
// update commits.

import { useState } from "react";
import { useOffline } from "@/components/offline-provider";
import {
  OPPORTUNITY_STAGES,
  humanize,
  type OpportunityStage,
} from "@/lib/domain/enums";
import { getOfflineLayer } from "@/lib/offline";

// Mirrors nextActionCreateSchema.kind (src/lib/domain/schemas.ts) — same set
// as new-deal/page.tsx's first-action trio. DISPLAY_CHECK is deliberately
// excluded there too: it's only ever derived from an account, never created
// directly.
const ACTION_KINDS = [
  "SAMPLE_FOLLOW_UP",
  "QUOTE_FOLLOW_UP",
  "VISIT",
  "OTHER",
] as const;
type ActionKind = (typeof ACTION_KINDS)[number];

export interface DealStageSheetOpportunity {
  id: string;
  name: string;
  stage: string;
  current_status: string | null;
  updated_at: string;
  primary_account_id: string;
}

export function DealStageSheet({
  opportunity,
  hasOpenAction,
  onClose,
}: {
  opportunity: DealStageSheetOpportunity;
  hasOpenAction: boolean;
  onClose: () => void;
}) {
  const { profile } = useOffline();
  const [stage, setStage] = useState<OpportunityStage>(
    opportunity.stage as OpportunityStage,
  );
  const [status, setStatus] = useState(opportunity.current_status ?? "");
  const [actionText, setActionText] = useState("");
  const [actionDue, setActionDue] = useState("");
  const [actionKind, setActionKind] = useState<ActionKind>("VISIT");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Rule 3: a non-terminal stage needs an open next action. hasOpenAction is
  // fixed at open time (the sheet doesn't watch for actions created
  // elsewhere mid-edit) — recomputing against the chosen stage as the rep
  // changes it is what makes the block appear/disappear live.
  const needsAction =
    stage !== "WON" && stage !== "LOST" && !hasOpenAction;

  async function save() {
    if (!profile) {
      setError("You're signed out.");
      return;
    }
    if (!status.trim()) {
      setError("Where does this stand? A quick line is needed.");
      return;
    }
    if (needsAction) {
      if (!actionText.trim()) {
        setError("This stage needs an open next action — what's next?");
        return;
      }
      if (!actionDue) {
        setError("When is that action due?");
        return;
      }
    }

    setBusy(true);
    setError(null);
    // Compensation: two outbox ops; if the second enqueue fails after the
    // first succeeded, roll back what's already queued so a retry can't
    // strand a duplicate action (same pattern as accounts/new/page.tsx's
    // submit() and the sheets in src/app/review/page.tsx).
    const enqueuedSeqs: number[] = [];
    try {
      const layer = getOfflineLayer();

      // FIFO: enqueue the action first so the deferred stage-change gate
      // sees it already on the books when the update op commits.
      if (needsAction) {
        const actionId = crypto.randomUUID();
        enqueuedSeqs.push(
          await layer.sync.enqueue({
            clientId: actionId,
            entityType: "next_action",
            op: "create",
            payload: {
              id: actionId,
              org_id: profile.orgId,
              action: actionText.trim(),
              owner_id: profile.membershipId,
              due_date: actionDue,
              account_id: opportunity.primary_account_id,
              opportunity_id: opportunity.id,
              kind: actionKind,
            },
            baseVersion: null,
            blobRef: null,
          }),
        );
      }

      enqueuedSeqs.push(
        await layer.sync.enqueue({
          clientId: opportunity.id,
          entityType: "opportunity",
          op: "update",
          payload: {
            id: opportunity.id,
            stage,
            current_status: status.trim(),
          },
          // A stale baseVersion (deal moved in HubSpot meanwhile) lands in
          // the error tray by design (D61) — no special handling needed
          // here.
          baseVersion: opportunity.updated_at,
          blobRef: null,
        }),
      );

      void layer.sync.drain();
      onClose();
    } catch (err) {
      const layer = getOfflineLayer();
      for (const seq of enqueuedSeqs) {
        await layer.local.deleteOutbox(seq);
      }
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div
      className="sheet-overlay flex items-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="sheet-panel max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl p-5"
        style={{ background: "var(--surface-page)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="t-title text-base">{opportunity.name}</h2>
        <p className="t-sub mt-1">Move this deal forward.</p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="t-hint">Stage</span>
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value as OpportunityStage)}
              className="field"
            >
              {OPPORTUNITY_STAGES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="t-hint">Where does this stand?</span>
            <input
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="field"
              placeholder="A quick line on where things are"
            />
          </label>

          {needsAction && (
            <div
              className="flex flex-col gap-3"
              style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }}
            >
              <p className="t-hint">
                No open next action on this deal — one&apos;s needed to move
                it to this stage.
              </p>

              <label className="flex flex-col gap-1">
                <span className="t-hint">What are you doing next?</span>
                <input
                  value={actionText}
                  onChange={(e) => setActionText(e.target.value)}
                  className="field"
                  placeholder="e.g. Send a quote"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="t-hint">By when?</span>
                <input
                  type="date"
                  value={actionDue}
                  onChange={(e) => setActionDue(e.target.value)}
                  className="field"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="t-hint">What kind of follow-up is this?</span>
                <select
                  value={actionKind}
                  onChange={(e) =>
                    setActionKind(e.target.value as ActionKind)
                  }
                  className="field"
                >
                  {ACTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {humanize(k)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {error && (
            <p className="t-sub" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="btn-primary flex-1"
              style={{ maxWidth: "none" }}
            >
              Save
            </button>
            <button
              onClick={onClose}
              className="btn-secondary"
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
