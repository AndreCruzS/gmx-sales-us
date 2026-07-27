"use client";

// The agenda is an ADVANCE COMMITMENT measured against reality (D46), not a
// to-do list. Items are next_actions; visits are planned with a required
// objective (D48); next week must be planned by Friday (D47 — the exception
// engine watches). Online reads the week from the server; offline falls back
// to the cached today+tomorrow working set (D56). Mark-done goes through the
// outbox (LWW-guarded), so it works offline and conflicts land in the tray.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import {
  VISIT_OBJECTIVES,
  type VisitObjective,
} from "@/lib/domain/enums";
import { getOfflineLayer, type CachedAccount } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface AgendaRow {
  id: string;
  action: string;
  due_date: string;
  completed_at: string | null;
  account_id: string | null;
  opportunity_id: string | null;
  objective: string | null;
  updated_at: string;
  accountName?: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function AgendaPage() {
  const { profile } = useOffline();
  const [items, setItems] = useState<AgendaRow[]>([]);
  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [offlineView, setOfflineView] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Plan-a-visit form state
  const [planAccount, setPlanAccount] = useState("");
  const [planAction, setPlanAction] = useState("");
  const [planDate, setPlanDate] = useState(isoDate(new Date()));
  const [planObjective, setPlanObjective] = useState<VisitObjective | "">("");
  const [planObjectiveDetail, setPlanObjectiveDetail] = useState("");

  const [dayRefs, setDayRefs] = useState(() => ({
    today: "",
    tomorrow: "",
  }));

  const load = useCallback(async () => {
    const layer = getOfflineLayer();
    setDayRefs({
      today: isoDate(new Date()),
      tomorrow: isoDate(new Date(Date.now() + 86_400_000)),
    });
    void layer.local.getAccounts().then(setAccounts);
    try {
      const weekAhead = new Date();
      weekAhead.setDate(weekAhead.getDate() + 14);
      const { data, error } = await getSupabaseBrowserClient()
        .from("next_actions")
        .select(
          "id, action, due_date, completed_at, account_id, opportunity_id, objective, updated_at, accounts(name)",
        )
        .is("completed_at", null)
        .lte("due_date", isoDate(weekAhead))
        .order("due_date");
      if (error) throw new Error(error.message);
      setOfflineView(false);
      // PostgREST returns the FK embed as an object; supabase-js without
      // generated types infers an array — hence the unknown hop.
      setItems(
        (
          data as unknown as (AgendaRow & { accounts: { name: string } | null })[]
        ).map((r) => ({ ...r, accountName: r.accounts?.name })),
      );
    } catch {
      // Offline: the cached working set covers today + tomorrow (D56).
      const cached = await layer.local.getAgenda();
      const accts = await layer.local.getAccounts();
      const byId = new Map(accts.map((a) => [a.id, a.name]));
      setOfflineView(true);
      setItems(
        cached
          .filter((c) => !c.completed_at)
          .map((c) => ({
            ...c,
            updated_at: c.updated_at,
            accountName: c.account_id ? byId.get(c.account_id) : undefined,
          })),
      );
    }
  }, []);

  useEffect(() => {
    // async load; state lands from promise callbacks, never synchronously
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function markDone(item: AgendaRow) {
    setError(null);
    try {
      const layer = getOfflineLayer();
      await layer.sync.enqueue({
        clientId: item.id,
        entityType: "next_action",
        op: "update",
        payload: { id: item.id, completed_at: new Date().toISOString() },
        baseVersion: item.updated_at, // D61: stale completion → error tray
        blobRef: null,
      });
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      void layer.sync.drain();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function planVisit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    // D48: every visit is intentional — objective is REQUIRED at scheduling.
    if (!planObjective) {
      setError("Pick the objective — every visit is intentional (D48).");
      return;
    }
    if (planObjective === "OTHER" && !planObjectiveDetail.trim()) {
      setError("OTHER objective needs a word on what it is.");
      return;
    }
    if (!planAccount || !planAction.trim()) {
      setError("Account and action are required.");
      return;
    }
    setError(null);
    const id = crypto.randomUUID();
    const layer = getOfflineLayer();
    await layer.sync.enqueue({
      clientId: id,
      entityType: "next_action",
      op: "create",
      payload: {
        id,
        org_id: profile.orgId,
        action: planAction.trim(),
        owner_id: profile.membershipId,
        due_date: planDate,
        account_id: planAccount,
        objective: planObjective,
        objective_detail: planObjectiveDetail.trim() || null,
      },
      baseVersion: null,
      blobRef: null,
    });
    const acctName = accounts.find((a) => a.id === planAccount)?.name;
    setItems((prev) =>
      [
        ...prev,
        {
          id,
          action: planAction.trim(),
          due_date: planDate,
          completed_at: null,
          account_id: planAccount,
          opportunity_id: null,
          objective: planObjective,
          updated_at: new Date().toISOString(),
          accountName: acctName,
        },
      ].sort((a, b) => a.due_date.localeCompare(b.due_date)),
    );
    setShowPlan(false);
    setPlanAction("");
    setPlanObjective("");
    setPlanObjectiveDetail("");
    void layer.sync.drain();
  }

  const groups = useMemo(() => {
    const { today, tomorrow } = dayRefs;
    const buckets: Record<string, AgendaRow[]> = {
      Overdue: [],
      Today: [],
      Tomorrow: [],
      "This & next week": [],
    };
    for (const i of items) {
      if (i.due_date < today) buckets.Overdue.push(i);
      else if (i.due_date === today) buckets.Today.push(i);
      else if (i.due_date === tomorrow) buckets.Tomorrow.push(i);
      else buckets["This & next week"].push(i);
    }
    return buckets;
  }, [items, dayRefs]);

  return (
    <div className="stack pt-2">
      <section>
        <div className="section-head">
          <h1 className="t-section">Agenda</h1>
          <button onClick={() => setShowPlan((v) => !v)} className="t-action">
            {showPlan ? "Close" : "+ Plan a visit"}
          </button>
        </div>

        {offlineView && (
          <p className="tag tag-accent mb-3">
            Offline — today and tomorrow only
          </p>
        )}

        {showPlan && (
          <form onSubmit={planVisit} className="card card-pad mb-4 flex flex-col gap-2">
            <select
              value={planAccount}
              onChange={(e) => setPlanAccount(e.target.value)}
              className="field"
              style={{ background: "var(--surface-page)" }}
            >
              <option value="">Which account?</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <input
              placeholder="What will you do there?"
              value={planAction}
              onChange={(e) => setPlanAction(e.target.value)}
              className="field"
              style={{ background: "var(--surface-page)" }}
            />
            <input
              type="date"
              value={planDate}
              onChange={(e) => setPlanDate(e.target.value)}
              className="field"
              style={{ background: "var(--surface-page)" }}
            />
            <select
              value={planObjective}
              onChange={(e) =>
                setPlanObjective(e.target.value as VisitObjective | "")
              }
              className="field"
              style={{ background: "var(--surface-page)" }}
            >
              <option value="">Objective — every visit has one</option>
              {VISIT_OBJECTIVES.map((o) => (
                <option key={o} value={o}>
                  {o.replaceAll("_", " ").toLowerCase()}
                </option>
              ))}
            </select>
            {planObjective === "OTHER" && (
              <input
                placeholder="What is the objective?"
                value={planObjectiveDetail}
                onChange={(e) => setPlanObjectiveDetail(e.target.value)}
                className="field"
                style={{ background: "var(--surface-page)" }}
              />
            )}
            <button type="submit" className="btn-primary mt-1">
              Add to agenda
            </button>
          </form>
        )}

        {error && (
          <p className="t-sub mb-2" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        {items.length === 0 && (
          <p className="t-sub px-1">
            Nothing scheduled. Next week needs planning by Friday — the system
            notices when it isn&apos;t.
          </p>
        )}
      </section>

      {Object.entries(groups).map(([label, rows]) =>
        rows.length === 0 ? null : (
          <section key={label}>
            <div className="section-head">
              <h2
                className="t-section"
                style={
                  label === "Overdue" ? { color: "var(--danger)" } : undefined
                }
              >
                {label}
              </h2>
              <span className="t-meta">{rows.length}</span>
            </div>
            <ul className="list">
              {rows.map((i) => (
                <li key={i.id} className="row">
                  <span
                    className="row-lead flex-col leading-none"
                    style={
                      label === "Overdue"
                        ? {
                            background: "var(--danger-tint)",
                            color: "var(--danger)",
                          }
                        : undefined
                    }
                  >
                    <span className="text-[15px] font-bold">
                      {Number(i.due_date.slice(8, 10))}
                    </span>
                    <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">
                      {new Date(`${i.due_date}T00:00:00`).toLocaleString(
                        "en-US",
                        { month: "short" },
                      )}
                    </span>
                  </span>
                  <span className="row-body">
                    <span className="t-title block truncate">{i.action}</span>
                    {/* the lead chip already carries the date — don't repeat it */}
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      {i.accountName && (
                        <span className="t-sub">{i.accountName}</span>
                      )}
                      {i.objective && (
                        <span className="tag tag-accent">
                          {i.objective.replaceAll("_", " ")}
                        </span>
                      )}
                    </span>
                  </span>
                  <button
                    onClick={() => markDone(i)}
                    className="btn-quiet shrink-0"
                  >
                    Done
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
