"use client";

// D45: default capture = ONE NOTE + FOLLOW-UP FLAG. If this takes more than
// 15 seconds in a truck, it does not happen. The full form exists behind a
// disclosure and is never mandatory. Submit works fully offline: optimistic
// local write + outbox enqueue; the SyncEngine lands it when it can.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import {
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  VISIT_OBJECTIVES,
  type ActivityOutcome,
  type ActivityType,
  type VisitObjective,
} from "@/lib/domain/enums";
import {
  getOfflineLayer,
  type CachedAccount,
  type CachedAgendaItem,
} from "@/lib/offline";

export default function CapturePage() {
  const { profile } = useOffline();
  const router = useRouter();

  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [agenda, setAgenda] = useState<CachedAgendaItem[]>([]);
  const [linkPlanned, setLinkPlanned] = useState(true);
  const [accountQuery, setAccountQuery] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType>("DEALER_VISIT");
  const [objective, setObjective] = useState<VisitObjective | "">("");
  const [objectiveDetail, setObjectiveDetail] = useState("");
  const [outcomes, setOutcomes] = useState<ActivityOutcome[]>([]);
  const [keyInfo, setKeyInfo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const layer = getOfflineLayer();
    void layer.local.getAccounts().then(setAccounts);
    void layer.local.getAgenda().then(setAgenda);
  }, []);

  const filtered = useMemo(() => {
    const q = accountQuery.trim().toLowerCase();
    if (!q) return accounts.slice(0, 8);
    return accounts.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 8);
  }, [accounts, accountQuery]);

  const selected = accounts.find((a) => a.id === accountId) ?? null;

  // D46 planned-vs-actual: if the cached agenda (today + tomorrow, D56) holds
  // an open item for this account, offer to record this activity AS that
  // planned visit — linking it and completing the agenda item.
  const plannedItem = useMemo(
    () =>
      accountId
        ? (agenda.find((i) => i.account_id === accountId && !i.completed_at) ??
          null)
        : null,
    [agenda, accountId],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) {
      setError("Not signed in.");
      return;
    }
    if (!accountId) {
      setError("Pick the account — everything hangs off it.");
      return;
    }
    if (objective === "OTHER" && !objectiveDetail.trim()) {
      setError("OTHER objective needs a word on what it was (D48).");
      return;
    }
    setBusy(true);
    setError(null);

    const id = crypto.randomUUID();
    const linked = linkPlanned ? plannedItem : null;
    const payload = {
      id,
      org_id: profile.orgId,
      activity_type: activityType,
      primary_account_id: accountId,
      owner_id: profile.membershipId,
      occurred_at: new Date().toISOString(),
      // D46: planned_done when linked to an agenda item; unplanned otherwise.
      // planned_not_done is derived by the exception engine, never stored.
      was_planned: Boolean(linked),
      planned_action_id: linked?.id ?? null,
      objective: objective || (linked?.objective as typeof objective) || null,
      objective_detail: objectiveDetail.trim() || null,
      what_happened: note.trim() || null,
      key_information: keyInfo.trim() || null,
      outcomes,
      follow_up_required: followUp,
    };

    try {
      const layer = getOfflineLayer();
      await layer.sync.enqueue({
        clientId: id,
        entityType: "activity",
        op: "create",
        payload,
        baseVersion: null,
        blobRef: null,
      });
      // Recording the planned visit completes its agenda item — the loop
      // closes through the same LWW-guarded outbox path.
      if (linked) {
        await layer.sync.enqueue({
          clientId: linked.id,
          entityType: "next_action",
          op: "update",
          payload: { id: linked.id, completed_at: new Date().toISOString() },
          baseVersion: linked.updated_at,
          blobRef: null,
        });
      }
      // Optimistic read-model write so the capture is immediately visible.
      await layer.local.putLocalActivity({
        id,
        activity_type: activityType,
        primary_account_id: accountId,
        occurred_at: payload.occurred_at,
        what_happened: payload.what_happened,
        follow_up_required: followUp,
        pendingSync: true,
      });
      void layer.sync.drain(); // fire-and-forget; offline just stays queued
      router.push("/");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Register activity</h1>

      {/* Account picker from the offline working set (D56) */}
      {selected ? (
        <div className="flex items-center justify-between rounded-xl border border-amber-500 px-4 py-3">
          <div>
            <div className="font-medium">{selected.name}</div>
            <div className="text-xs opacity-60">
              {selected.account_type}
              {selected.city ? ` · ${selected.city}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAccountId(null)}
            className="text-sm font-medium text-amber-600"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            placeholder="Search account…"
            value={accountQuery}
            onChange={(e) => setAccountQuery(e.target.value)}
            className="rounded-xl border border-black/15 bg-transparent px-4 py-3 dark:border-white/20"
          />
          <div className="flex flex-col overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
            {filtered.length === 0 && (
              <p className="px-4 py-3 text-sm opacity-60">
                No cached accounts{accountQuery ? " match" : ""} — pull to refresh
                when online.
              </p>
            )}
            {filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAccountId(a.id)}
                className="border-b border-black/5 px-4 py-3 text-left text-sm last:border-b-0 hover:bg-black/5 dark:border-white/10"
              >
                <span className="font-medium">{a.name}</span>
                <span className="ml-2 text-xs opacity-60">{a.account_type}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* D46: planned vs actual — link this capture to the planned visit */}
      {plannedItem && (
        <label className="flex items-center gap-3 rounded-xl border border-amber-500/50 bg-amber-500/5 px-4 py-3">
          <input
            type="checkbox"
            checked={linkPlanned}
            onChange={(e) => setLinkPlanned(e.target.checked)}
            className="h-5 w-5 accent-amber-500"
          />
          <span className="text-sm">
            <span className="font-medium">This was the planned visit:</span>{" "}
            {plannedItem.action}
            {plannedItem.objective && (
              <span className="ml-1 opacity-60">
                ({plannedItem.objective.replaceAll("_", " ")})
              </span>
            )}
          </span>
        </label>
      )}

      {/* The D45 core: one note… */}
      <textarea
        placeholder="What happened? One note is enough."
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        className="rounded-xl border border-black/15 bg-transparent px-4 py-3 dark:border-white/20"
      />

      {/* …and the follow-up flag */}
      <label className="flex items-center gap-3 rounded-xl border border-black/10 px-4 py-3 dark:border-white/15">
        <input
          type="checkbox"
          checked={followUp}
          onChange={(e) => setFollowUp(e.target.checked)}
          className="h-5 w-5 accent-amber-500"
        />
        <span className="font-medium">Needs follow-up</span>
      </label>

      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        className="text-left text-sm font-medium text-amber-600"
      >
        {showMore ? "Hide detail" : "More detail (optional)"}
      </button>

      {showMore && (
        <div className="flex flex-col gap-3 rounded-xl border border-black/10 p-4 dark:border-white/15">
          <label className="flex flex-col gap-1 text-sm">
            <span className="opacity-60">Activity type</span>
            <select
              value={activityType}
              onChange={(e) => setActivityType(e.target.value as ActivityType)}
              className="rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
            >
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="opacity-60">Objective (D48)</span>
            <select
              value={objective}
              onChange={(e) => setObjective(e.target.value as VisitObjective | "")}
              className="rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
            >
              <option value="">—</option>
              {VISIT_OBJECTIVES.map((o) => (
                <option key={o} value={o}>
                  {o.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          {objective === "OTHER" && (
            <input
              placeholder="What was the objective?"
              value={objectiveDetail}
              onChange={(e) => setObjectiveDetail(e.target.value)}
              className="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
            />
          )}

          <fieldset className="flex flex-col gap-1 text-sm">
            <span className="opacity-60">Outcomes</span>
            <div className="flex flex-wrap gap-2">
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
                    className={`rounded-full border px-3 py-1 text-xs ${
                      on
                        ? "border-amber-500 bg-amber-500/15 font-medium"
                        : "border-black/15 dark:border-white/20"
                    }`}
                  >
                    {o.replaceAll("_", " ")}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <textarea
            placeholder="Key information learned (optional)"
            value={keyInfo}
            onChange={(e) => setKeyInfo(e.target.value)}
            rows={2}
            className="rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="rounded-2xl bg-amber-500 px-5 py-4 text-lg font-semibold text-black disabled:opacity-50"
      >
        Save — works offline
      </button>
    </form>
  );
}
