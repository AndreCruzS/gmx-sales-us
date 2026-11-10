"use client";

// THE D9 GATE for anything said into the one microphone (spec
// 2026-11-04-one-mic-design.md): the visit that was described — every field
// editable — and what was asked to be booked, each a card ticked to include.
// One Save fans out through the outbox: the activity, its follow-ups, the
// routine fan-out, the contacts, the bookings, then the capture itself.
//
// Moved out of /review so Say it opens the same sheet the moment a note is
// written up online; offline, the same capture waits in Review and opens here.

import { useEffect, useState } from "react";
import { BookingCard, bookingPayload, bookingProblem, headLabel, type BookingCardState } from "@/components/booking-card";
import { useOffline } from "@/components/offline-provider";
import { XIcon } from "@/components/icons";
import {
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  humanize,
  type ActivityOutcome,
  type ActivityType,
} from "@/lib/domain/enums";
import { displayAccountName } from "@/lib/format";
import { getOfflineLayer, type CachedAccount, type CachedAgendaItem } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { buildRoutineOps } from "@/lib/voice/fanout";
import { draftedAction } from "@/lib/voice/draft";
import { hasVisit, type SayStoredDraft } from "@/lib/voice/say";
import {
  PRIORITY_LABEL,
  PROGRESS_LABEL,
  alertDate,
  daysFrom,
  pkDateOf,
  type Priority,
} from "@/lib/domain/pk-follow-up";
import { defaultDeadline, isTask, localIsoDate, storedPriority } from "@/lib/domain/deadline";
import { givesWorkToOthers } from "@/lib/domain/roles";
import { ImportanceDeadline } from "@/components/importance-deadline";

/** The statuses a new item can start in. */
const STARTS = ["NOT_STARTED", "WORKING_ON_IT", "WAITING"] as const;
type Start = (typeof STARTS)[number];

/** A follow-up row as the sheet edits it: the draft's fields, defaulted. */
interface ActionRow {
  action: string;
  due_date: string;
  objective: string | null;
  kind: "SAMPLE_FOLLOW_UP" | "QUOTE_FOLLOW_UP" | "VISIT" | "OTHER" | null;
  priority: Priority | null;
  /** Important? - the person's one answer; null while unknown. */
  important: boolean | null;
  /** Why the AI weighed it so ("Important: … · Due: …"). */
  reason: string | null;
  /** False for an item that is neither important nor urgent, until the person keeps it. */
  keep: boolean;
  progress: Start;
  subtasks: string[];
  note: string;
}

export interface CaptureRow {
  id: string;
  status: string;
  transcript: string | null;
  ai_draft: (SayStoredDraft & { error?: string }) | null;
  audio_path: string | null;
  created_at: string;
  updated_at: string;
  // D46 pre-link (Task 5): the account/planned visit this capture was taken
  // against, when known at capture time — carried through so Send can attach
  // the routine fan-out (Task 10) and the activity's planned_action_id.
  account_id: string | null;
  planned_action_id: string | null;
  // Set when the visit was already logged inline and the model ran only to
  // find the extras — Send enriches this activity rather than creating one.
  activity_id: string | null;
}

// Rep-language label for a confirmed routine disposition (D-routine, Task
// 10): pre-checked in the sheet, unchecking removes the op on Send. No
// jargon — "disposition"/"item_id" never surface in the UI.
function dispositionLabel(
  disposition: { item_id: string; disposition: "DONE" | "DISPLAY_VERIFIED" },
  agenda: CachedAgendaItem[],
): string {
  if (disposition.disposition === "DISPLAY_VERIFIED") {
    return "Display wall checked — uncheck if not right";
  }
  const item = agenda.find((a) => a.id === disposition.item_id);
  return `${item?.action ?? "That routine item"} — done, uncheck if not right`;
}

// The D9 gate: every field editable, the rep commits explicitly. Send fans out
// through the standard outbox (D10) — activity + next actions + the routine
// fan-out (dispositions/typed commitments, Task 10) + capture update.
export function DebriefSheet({
  capture,
  accounts,
  agenda,
  onClose,
  onDone,
}: {
  capture: CaptureRow;
  accounts: CachedAccount[];
  agenda: CachedAgendaItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { profile } = useOffline();
  const draft = capture.ai_draft as SayStoredDraft;
  // One microphone (2026-11-04): a capture may hold a visit, things to book,
  // or both. A draft stored before that is a visit with nothing to book.
  const visit = hasVisit(draft);
  const [bookings, setBookings] = useState<BookingCardState[]>(() =>
    (draft.commands ?? []).map((cmd, i) => ({ ...cmd, key: `${capture.id}-${i}`, done: false, include: true })),
  );
  const choices = accounts.map((a) => ({ id: a.id, name: displayAccountName(a.name) }));
  const patchBooking = (key: string, p: Partial<BookingCardState>) =>
    setBookings((list) => list.map((b) => (b.key === key ? { ...b, ...p } : b)));
  // What the rep said, then what the system worked out, then nothing.
  //
  // capture.account_id first because it is a fact: the rep picked it, or the
  // agenda deep link named it. The draft's proposal only fills a blank — it never
  // overrides somebody who already answered. And it is a DEFAULT, not a decision:
  // it lands in the same dropdown, editable, because nothing becomes a record
  // without the rep looking at it (D9).
  const [accountId, setAccountId] = useState(
    capture.account_id ?? draft.account_id ?? "",
  );
  const [activityType, setActivityType] = useState<ActivityType>(
    draft.activity_type,
  );
  const [whatHappened, setWhatHappened] = useState(draft.what_happened);
  const [keyInfo, setKeyInfo] = useState(draft.key_information ?? "");
  const [potential, setPotential] = useState(draft.commercial_potential ?? "");
  const [outcomes, setOutcomes] = useState<ActivityOutcome[]>(draft.outcomes);
  const [followUp, setFollowUp] = useState(draft.follow_up_required);
  // PK by voice (2026-11-04): a PK's follow-ups carry priority, status,
  // checklist and note to the PK board. Old drafts lack them: defaulted here.
  // "Today" is the device's local date; the owner is the speaker, so the
  // speaker's role decides Delegate.
  const [today] = useState(() => localIsoDate());
  const ownerGivesWork = givesWorkToOthers(profile?.role);
  const pkDate = pkDateOf(capture.created_at);
  const [actions, setActions] = useState<ActionRow[]>(() =>
    (draft.next_actions ?? []).map((na) => {
      const d = draftedAction(na, {
        today,
        pkDate,
        isPk: draft.activity_type === "PK_TRAINING",
        ownerGivesWork,
      });
      return {
        action: na.action,
        due_date: d.due_date,
        objective: na.objective ?? null,
        kind: na.kind ?? null,
        priority: d.priority,
        important: d.important,
        reason: na.priority_reason ?? null,
        keep: d.keep,
        progress: na.progress ?? "NOT_STARTED",
        subtasks: na.subtasks ?? [],
        note: na.note ?? "",
      };
    }),
  );
  const importanceField = (na: ActionRow, i: number) => (
    <ImportanceDeadline
      important={na.important}
      due={na.due_date}
      today={today}
      ownerGivesWork={ownerGivesWork}
      stored={na.priority}
      onChange={(c) =>
        // "Eliminate" on a sheet row means: do not save it (the row offers
        // "Keep it" back). Nothing is created closed.
        c.priority === "ELIMINATE"
          ? patchAction(i, { keep: false })
          : patchAction(i, {
              ...(c.important !== undefined ? { important: c.important } : {}),
              ...(c.due_date ? { due_date: c.due_date } : {}),
              priority: c.priority,
            })
      }
    />
  );
  const patchAction = (i: number, p: Partial<ActionRow>) =>
    setActions((prev) => prev.map((x, j) => (j === i ? { ...x, ...p } : x)));
  // Routine confirmations (D-routine, Task 10): pre-checked — the rep
  // unchecks anything the model got wrong rather than opting in from zero.
  // Task 9 finding, carried: routine_dispositions is required-without-default
  // on the schema, but pre-existing ai_draft rows lack it — `?? []` defends
  // against that.
  const [dispositions, setDispositions] = useState(
    (draft.routine_dispositions ?? []).map((d) => ({ ...d, confirmed: true })),
  );
  // The people the note carried (Andre, 2026-09-02): offered pre-checked,
  // the same contract as the routine confirmations — the rep unchecks a
  // wrong one rather than opting in from zero. `?? []` defends drafts
  // extracted before the field existed.
  const [people, setPeople] = useState(
    (draft.contacts ?? []).map((c) => ({
      ...c,
      confirmed: true,
      onFile: false,
    })),
  );
  // A suggestion matching a contact already on the chosen account starts
  // unchecked and says so — the model re-hearing a person is not a second
  // person. Cache-read, so the check works with no signal.
  useEffect(() => {
    if (!accountId) return;
    let stale = false;
    void getOfflineLayer()
      .local.getContacts(accountId)
      .then((existing) => {
        if (stale) return;
        const names = new Set(
          existing.map((e) => e.name.trim().toLowerCase()),
        );
        setPeople((prev) =>
          prev.map((p) =>
            names.has(p.name.trim().toLowerCase())
              ? { ...p, confirmed: false, onFile: true }
              : { ...p, onFile: false },
          ),
        );
      });
    return () => {
      stale = true;
    };
  }, [accountId]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!profile) return;
    if (visit && !accountId) {
      setError("Pick the account this belongs to.");
      return;
    }
    // Every booking ticked must be complete before anything is queued.
    const toBook = bookings.filter((b) => b.kind !== "QUOTE" && (b.include ?? true) && !b.done);
    for (const b of toBook) {
      const problem = bookingProblem(b);
      if (problem) {
        setError(`${headLabel(b)} “${b.action || "untitled"}”: ${problem}`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    // A PK's follow-ups all take the PK path below (priority, status,
    // checklist, note), typed ones included; the routine fan-out skips them.
    const pk = visit && activityType === "PK_TRAINING";
    // Compensation: the fan-out is multiple outbox ops; if any enqueue fails,
    // roll back the ones already queued so a retry can't create duplicates.
    const enqueuedSeqs: number[] = [];
    try {
      const layer = getOfflineLayer();
      // A capture from the day spine's inline debrief ALREADY has its activity:
      // the rep logged the line and moved on, and the model only ever ran to
      // find the extras (commitments, outcomes, what was learned). Enrich that
      // activity rather than filing the same visit a second time — and leave
      // the planned action alone, since logging it inline already closed it.
      // Without this, Send created a duplicate activity and its completion op
      // was rejected as a stale write.
      const existingActivityId = visit ? (capture.activity_id ?? null) : null;
      const activityId = existingActivityId ?? crypto.randomUUID();
      const now = new Date().toISOString();
      // Final-review finding 2: a voice debrief of a planned visit must close
      // the visit exactly like the typed /record path does — `was_planned`
      // reflects whether this capture was pre-linked to a planned
      // next_action, not hardcoded false.
      const plannedActionId = capture.planned_action_id ?? null;
      if (visit && !existingActivityId) {
        enqueuedSeqs.push(
          await layer.sync.enqueue({
            clientId: activityId,
            entityType: "activity",
            op: "create",
            payload: {
              id: activityId,
              org_id: profile.orgId,
              activity_type: activityType,
              primary_account_id: accountId,
              owner_id: profile.membershipId,
              occurred_at: capture.created_at,
              was_planned: Boolean(plannedActionId),
              // D46 gap fix (carried from Task 6's review): the capture's own
              // pre-link rides through to the activity it becomes, same as the
              // typed /record path already does.
              planned_action_id: plannedActionId,
              what_happened: whatHappened,
              key_information: keyInfo.trim() || null,
              commercial_potential: potential.trim() || null,
              outcomes,
              follow_up_required: followUp,
            },
            baseVersion: null,
            blobRef: null,
          }),
        );
      } else if (visit && existingActivityId) {
        // The activity already exists — the rep logged this stop inline from
        // the day spine and the model only ran afterwards, to find the extras.
        // Everything it found (what it heard worth keeping, the commercial
        // read, the outcome tags) had nowhere to go before activity:update
        // existed, and was quietly dropped: the note survived, the analysis
        // did not.
        //
        // updated_at is fetched rather than cached, because CachedActivity
        // does not carry it — and it must be the server's value, since it is
        // the D61 LWW guard. If the read fails (no signal), the enrich is
        // skipped rather than sinking the whole Send: the rep's own note is
        // already recorded, and losing the model's additions is the smaller
        // failure of the two.
        try {
          const { data, error: readError } = await getSupabaseBrowserClient()
            .from("activities")
            .select("updated_at")
            .eq("id", existingActivityId)
            .single();
          if (readError || !data?.updated_at) throw new Error("no version");
          enqueuedSeqs.push(
            await layer.sync.enqueue({
              clientId: existingActivityId,
              entityType: "activity",
              op: "update",
              payload: {
                id: existingActivityId,
                what_happened: whatHappened,
                key_information: keyInfo.trim() || null,
                commercial_potential: potential.trim() || null,
                outcomes,
                follow_up_required: followUp,
              },
              baseVersion: data.updated_at as string,
              blobRef: null,
            }),
          );
        } catch {
          console.warn(
            `ReviewSheet.send: could not read a version for activity ${existingActivityId} — skipping the enrich`,
          );
        }
      }
      // Recording a planned visit's debrief completes its agenda item — same
      // as record/page.tsx's submit(). Rides right after the activity create
      // (FIFO). If the planned item isn't in the cached agenda (dropped by
      // the cache cap, completed elsewhere, another device), there's no
      // baseVersion to update against — skip the completion op rather than
      // throw and sink the whole Send (finding 3's principle); the activity
      // itself still records was_planned/planned_action_id correctly.
      // ...unless the inline debrief already closed it, in which case the
      // cached updated_at is stale by definition and this op would be rejected.
      if (visit && plannedActionId && !existingActivityId) {
        const plannedItem = agenda.find((a) => a.id === plannedActionId);
        if (plannedItem) {
          enqueuedSeqs.push(
            await layer.sync.enqueue({
              clientId: plannedActionId,
              entityType: "next_action",
              op: "update",
              payload: { id: plannedActionId, completed_at: now },
              baseVersion: plannedItem.updated_at,
              blobRef: null,
            }),
          );
        } else {
          console.warn(
            `ReviewSheet.send: planned_action_id ${plannedActionId} not in cached agenda — skipping completion`,
          );
        }
      }
      for (const na of visit ? actions : []) {
        if (!na.action.trim() || !na.due_date) continue;
        if (!na.keep) continue;
        // Typed commitments (a kind set) are created by the routine fan-out
        // below instead, which is where their kind actually gets persisted —
        // except on a PK, where every follow-up goes to the board from here.
        if (na.kind && !pk) continue;
        const naId = crypto.randomUUID();
        // The PK board's rule: alert = PK date + days, written into due_date.
        // A spoken date sets the days; a date before the PK is the PK day.
        const days = pk && na.priority ? Math.max(0, daysFrom(pkDate, na.due_date)) : null;
        // Every task carries Important? and its priority; the days are the PK board's.
        const taskFields = isTask(na.kind) ? { important: na.important, priority: na.priority } : {};
        const pkFields = pk
          ? {
              ...(na.kind ? { kind: na.kind } : {}),
              ...taskFields,
              priority_days: days,
              ...(days !== null ? { due_date: alertDate(pkDate, days) } : {}),
              progress: na.progress,
              source: "VISIT_CAPTURE" as const,
            }
          : taskFields;
        enqueuedSeqs.push(
          await layer.sync.enqueue({
            clientId: naId,
            entityType: "next_action",
            op: "create",
            payload: {
              id: naId,
              org_id: profile.orgId,
              action: na.action.trim(),
              owner_id: profile.membershipId,
              due_date: na.due_date,
              account_id: accountId,
              activity_id: activityId, // Rule 3 linkage
              // D48: OTHER requires objective_detail — a draft can't supply
              // it, so drop OTHER rather than trip the check.
              objective:
                na.objective === "OTHER" ? null : (na.objective ?? null),
              ...pkFields,
            },
            baseVersion: null,
            blobRef: null,
          }),
        );
        if (!pk) continue;
        // Its checklist, then its first note — after the item (FIFO).
        const titles = na.subtasks.map((t) => t.trim()).filter(Boolean);
        for (let k = 0; k < titles.length; k++) {
          const subId = crypto.randomUUID();
          enqueuedSeqs.push(
            await layer.sync.enqueue({
              clientId: subId,
              entityType: "next_action_subtask",
              op: "create",
              payload: { id: subId, org_id: profile.orgId, next_action_id: naId, title: titles[k], position: k },
              baseVersion: null,
              blobRef: null,
            }),
          );
        }
        if (na.note.trim()) {
          const noteId = crypto.randomUUID();
          enqueuedSeqs.push(
            await layer.sync.enqueue({
              clientId: noteId,
              entityType: "next_action_note",
              op: "create",
              payload: { id: noteId, org_id: profile.orgId, next_action_id: naId, body: na.note.trim() },
              baseVersion: null,
              blobRef: null,
            }),
          );
        }
      }

      // The people the note carried, still checked at Send (D9): each becomes
      // a real contact on the chosen account, riding the same fan-out and the
      // same compensation. Idempotent by client-minted id like every create.
      for (const p of visit ? people : []) {
        if (!p.confirmed || !p.name.trim()) continue;
        const contactId = crypto.randomUUID();
        enqueuedSeqs.push(
          await layer.sync.enqueue({
            clientId: contactId,
            entityType: "contact",
            op: "create",
            payload: {
              id: contactId,
              org_id: profile.orgId,
              account_id: accountId,
              name: p.name.trim(),
              job_title: p.job_title,
              email: p.email,
              phone: p.phone,
            },
            baseVersion: null,
            blobRef: null,
          }),
        );
      }

      // Routine fan-out (D-routine, Task 10): confirmed dispositions
      // (DONE/DISPLAY_VERIFIED) and typed commitments become their own ops,
      // appended to the same fan-out — FIFO seq still guarantees the
      // activity above lands first; D62 compensation covers all of it.
      //
      // Final-review finding 3: versions are resolved from the cache HERE,
      // before buildRoutineOps runs, so "not in cache" is representable
      // (missing key / null) rather than coerced into a truthy placeholder.
      // The old `accountVersion ?? ""` fallback below used to hand
      // buildRoutineOps a value that looked resolved but would throw at
      // enqueue (sync-engine.ts's D61 guard rejects update ops with a falsy
      // baseVersion) — buildRoutineOps now drops any op it can't resolve a
      // real baseVersion for, instead of producing one that sinks the Send.
      const itemVersions: Record<string, string> = {};
      for (const d of dispositions) {
        if (d.disposition !== "DONE") continue;
        const item = agenda.find((a) => a.id === d.item_id);
        if (item) itemVersions[d.item_id] = item.updated_at;
      }
      const accountVersion = accounts.find((a) => a.id === accountId)?.updated_at ?? null;
      const routineOps = !visit ? [] : buildRoutineOps(
        {
          ...draft,
          // Final-review finding 4: typed (kind-bearing) commitments used to
          // skip the untyped loop's guards entirely (a blank due_date would
          // fail zod at the outbox boundary and sink the whole Send). Apply
          // the same empty-field skip here, before they ever reach
          // buildRoutineOps — mirrors `if (!na.action.trim() || !na.due_date)
          // continue` in the untyped loop above.
          next_actions: pk
            ? []
            : actions
                .filter((na) => na.kind && na.keep && na.action.trim() && na.due_date)
                .map((na) => ({
                  action: na.action,
                  due_date: na.due_date,
                  objective: (na.objective as never) ?? null,
                  kind: na.kind,
                  important: na.important,
                  priority: na.priority,
                })),
          routine_dispositions: dispositions
            .filter((d) => d.confirmed)
            .map((d) => ({
              item_id: d.item_id,
              disposition: d.disposition,
              note: d.note,
            })),
        },
        accountId,
        profile.membershipId,
        profile.orgId,
        itemVersions,
        accountVersion,
        now,
        activityId,
      );
      for (const op of routineOps) {
        enqueuedSeqs.push(
          await layer.sync.enqueue({
            clientId: op.payload.id as string,
            entityType: op.entityType,
            op: op.op,
            payload: op.payload,
            baseVersion: op.baseVersion,
            blobRef: null,
          }),
        );
      }

      // The bookings ticked (one microphone): each its own next_action, the
      // same write Say it makes, inside the same fan-out and compensation.
      for (const b of toBook) {
        const id = crypto.randomUUID();
        enqueuedSeqs.push(
          await layer.sync.enqueue({
            clientId: id,
            entityType: "next_action",
            op: "create",
            payload: {
              ...bookingPayload(b, { id, orgId: profile.orgId, membershipId: profile.membershipId }),
              // Booked at a PK, for that dealer: it is that PK's follow-up too,
              // and shows on its band on the PK board.
              ...(pk && b.accountId === accountId ? { activity_id: activityId } : {}),
            },
            baseVersion: null,
            blobRef: null,
          }),
        );
      }

      enqueuedSeqs.push(
        await layer.sync.enqueue({
          clientId: capture.id,
          entityType: "voice_capture",
          op: "update",
          payload: visit
            ? {
                id: capture.id,
                status: "SENT",
                reviewed_at: now,
                sent_at: now,
                activity_id: activityId,
              }
            : { id: capture.id, status: "REVIEWED", reviewed_at: now },
          baseVersion: capture.updated_at,
          blobRef: null,
        }),
      );
      // Only mirror an activity this Send actually created — the inline path
      // already mirrored its own.
      if (visit && !existingActivityId) {
        await layer.local.putLocalActivity({
          id: activityId,
          activity_type: activityType,
          primary_account_id: accountId,
          occurred_at: capture.created_at,
          what_happened: whatHappened,
          follow_up_required: followUp,
          // Mirrors the outbox payload's planned_action_id above (D46) — Home's
          // "Visits this week" tile dedupes a debriefed planned visit from a
          // walk-in on this field, same as the typed /record path.
          planned_action_id: capture.planned_action_id ?? null,
          pendingSync: true,
        });
      }
      void layer.sync.drain();
      onDone();
    } catch (err) {
      // Roll back whatever part of the fan-out already queued.
      const layer = getOfflineLayer();
      for (const seq of enqueuedSeqs) {
        await layer.local.deleteOutbox(seq);
      }
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function discard() {
    const layer = getOfflineLayer();
    await layer.sync.enqueue({
      clientId: capture.id,
      entityType: "voice_capture",
      op: "update",
      payload: { id: capture.id, status: "DISCARDED" },
      baseVersion: capture.updated_at,
      blobRef: null,
    });
    void layer.sync.drain();
    onDone();
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
        <h2 className="t-title text-base">{visit ? "Check & save" : "Check & book"}</h2>
        {visit && <p className="t-sub mt-1">{draft.summary}</p>}

        {capture.transcript && (
          <details className="t-sub mt-2">
            <summary className="cursor-pointer">
              What you said, word for word
            </summary>
            <p className="mt-1">{capture.transcript}</p>
          </details>
        )}

        <div className="mt-4 flex flex-col gap-3">
          {visit && (
          <>
          <div>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="field"
            >
              <option value="">Which account is this?</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {/* Say so when the account is the system's guess rather than the
                rep's answer. A silently pre-filled dropdown reads as something
                they already confirmed, and this is the one field where being
                wrong files a visit against a company they never went to — so it
                gets one line asking for a glance, and only when it was guessed. */}
            {!capture.account_id && draft.account_id === accountId && (
              <p className="t-sub mt-1">
                Picked from what you said &mdash; change it if that&apos;s not right.
              </p>
            )}
          </div>

          <select
            value={activityType}
            onChange={(e) => setActivityType(e.target.value as ActivityType)}
            className="field"
          >
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>

          <textarea
            value={whatHappened}
            onChange={(e) => setWhatHappened(e.target.value)}
            rows={3}
            className="field"
          />
          <textarea
            placeholder="Anything worth remembering"
            value={keyInfo}
            onChange={(e) => setKeyInfo(e.target.value)}
            rows={2}
            className="field"
          />
          <input
            placeholder="Business potential you saw"
            value={potential}
            onChange={(e) => setPotential(e.target.value)}
            className="field"
          />

          <div className="flex flex-wrap gap-1.5">
            {ACTIVITY_OUTCOMES.map((o) => {
              const on = outcomes.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() =>
                    setOutcomes((prev) =>
                      on ? prev.filter((x) => x !== o) : [...prev, o],
                    )
                  }
                  className={on ? "tag tag-solid" : "tag"}
                >
                  {humanize(o)}
                </button>
              );
            })}
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={followUp}
              onChange={(e) => setFollowUp(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Needs a follow-up
          </label>

          {dispositions.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="t-hint">On your list</span>
              {dispositions.map((d, i) => (
                <label key={`${d.item_id}-${i}`} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={d.confirmed}
                    onChange={() =>
                      setDispositions((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, confirmed: !x.confirmed } : x,
                        ),
                      )
                    }
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  {dispositionLabel(d, agenda)}
                </label>
              ))}
            </div>
          )}

          {people.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="t-hint">
                People in this note — save them as contacts
              </span>
              {people.map((p, i) => (
                <label key={`${p.name}-${i}`} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={p.confirmed}
                    onChange={() =>
                      setPeople((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, confirmed: !x.confirmed } : x,
                        ),
                      )
                    }
                    className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {p.name}
                      {p.onFile ? " — already on file" : ""}
                    </span>
                    <span className="t-sub block truncate">
                      {[p.job_title, p.email, p.phone]
                        .filter(Boolean)
                        .join(" · ") || "no details"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="t-hint">What happens next</span>
            {actions.map((na, i) => (
              <div key={i} className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  value={na.action}
                  onChange={(e) =>
                    setActions((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, action: e.target.value } : x,
                      ),
                    )
                  }
                  className="field min-w-0 flex-1"
                />
                <input
                  type="date"
                  value={na.due_date}
                  onChange={(e) => {
                    const v = e.target.value;
                    // A task's priority follows its deadline.
                    patchAction(i, {
                      due_date: v,
                      ...(v && isTask(na.kind) && na.important !== null
                        ? { priority: storedPriority(na.important, v, today, ownerGivesWork) }
                        : {}),
                    });
                  }}
                  className="field"
                  // .field is width:100%; beside the action it must keep to its own size.
                  style={{ width: "auto", flex: "0 0 auto" }}
                />
                <button
                  onClick={() =>
                    setActions((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="btn-quiet shrink-0"
                  aria-label={`Remove: ${na.action || "untitled"}`}
                >
                  <XIcon size={14} />
                </button>
              </div>
              {na.reason && isTask(na.kind) && (
                <p className="pk-row-reason t-hint">{na.reason}</p>
              )}
              {!na.keep && (
                <label className="pk-row-eliminate t-hint">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => patchAction(i, { keep: true })}
                  />
                  Not important and not urgent — not saved. Keep it
                </label>
              )}
              {activityType !== "PK_TRAINING" && na.keep && isTask(na.kind) && (
                <div className="pk-row-fields">{importanceField(na, i)}</div>
              )}
              {activityType === "PK_TRAINING" && na.keep && (
                <details className="pk-row-details" open={Boolean(na.priority || na.subtasks.length || na.note || na.progress !== "NOT_STARTED")}>
                  <summary className="t-hint">
                    {[
                      na.priority ? PRIORITY_LABEL[na.priority] : "No priority",
                      PROGRESS_LABEL[na.progress],
                      na.subtasks.length ? `${na.subtasks.length} subtasks` : null,
                      na.note ? "note" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </summary>
                  {importanceField(na, i)}
                  <div className="pk-row-fields">
                    <select
                      className="field"
                      aria-label="Status"
                      value={na.progress}
                      onChange={(e) => patchAction(i, { progress: e.target.value as Start })}
                    >
                      {STARTS.map((p) => (
                        <option key={p} value={p}>
                          {PROGRESS_LABEL[p]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {na.subtasks.map((t, k) => (
                    <div key={k} className="flex gap-2">
                      <input
                        className="field min-w-0 flex-1"
                        value={t}
                        aria-label={`Subtask ${k + 1}`}
                        onChange={(e) =>
                          patchAction(i, { subtasks: na.subtasks.map((x, m) => (m === k ? e.target.value : x)) })
                        }
                      />
                      <button
                        type="button"
                        className="btn-quiet shrink-0"
                        aria-label={`Remove subtask: ${t || "untitled"}`}
                        onClick={() => patchAction(i, { subtasks: na.subtasks.filter((_, m) => m !== k) })}
                      >
                        <XIcon size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="t-action text-left"
                    onClick={() => patchAction(i, { subtasks: [...na.subtasks, ""] })}
                  >
                    + Add a subtask
                  </button>
                  <textarea
                    className="field"
                    rows={2}
                    placeholder="A note for the board"
                    value={na.note}
                    onChange={(e) => patchAction(i, { note: e.target.value })}
                  />
                </details>
              )}
              </div>
            ))}
            <button
              onClick={() =>
                setActions((prev) => [
                  ...prev,
                  {
                    action: "",
                    due_date: defaultDeadline(null, activityType === "PK_TRAINING", activityType === "PK_TRAINING" ? pkDate : today),
                    objective: null,
                    kind: null,
                    priority: null,
                    important: null,
                    reason: null,
                    keep: true,
                    progress: "NOT_STARTED",
                    subtasks: [],
                    note: "",
                  },
                ])
              }
              className="t-action text-left"
              type="button"
            >
              + Add one
            </button>
          </div>
          </>
          )}

          {bookings.length > 0 && (
            <div className="flex flex-col gap-2">
              {visit && <span className="t-hint">Also to book</span>}
              {bookings.map((b) => (
                <BookingCard
                  key={b.key}
                  card={b}
                  choices={choices}
                  reps={draft.reps ?? []}
                  team={draft.team ?? []}
                  mode="include"
                  onPatch={(p) => patchBooking(b.key, p)}
                  onConfirm={() => {
                    // A quote opens its builder on the account (a new tab, so
                    // this sheet and its visit stay as they are).
                    if (b.kind !== "QUOTE") return;
                    const problem = bookingProblem(b);
                    if (problem) return setError(problem);
                    const say = encodeURIComponent(b.action);
                    window.open(`/accounts/${b.accountId}/new-deal?stage=QUOTE&say=${say}`, "_blank");
                    patchBooking(b.key, { done: true });
                  }}
                />
              ))}
            </div>
          )}

          {error && (
            <p className="t-sub" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <button
              onClick={send}
              disabled={busy}
              className="btn-primary flex-1"
              style={{ maxWidth: "none" }}
            >
              {visit ? "Save it" : "Book them"}
            </button>
            <button onClick={discard} className="btn-secondary" type="button">
              Throw away
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

