"use client";

// Today — the whole day on one screen, in the order a rep asks about it:
// what's overdue, what's on for today, what the system flagged, what's coming.
// The agenda is an ADVANCE COMMITMENT measured against reality (D46); visits
// are planned with a required objective (D48). Online reads the fortnight from
// the server; offline falls back to the cached today+tomorrow set (D56).
// Mark-done rides the LWW-guarded outbox, so it works offline too.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import {
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
} from "@/components/icons";
import {
  VISIT_OBJECTIVES,
  humanize,
  type VisitObjective,
} from "@/lib/domain/enums";
import { displayAccountName, relativizeDates } from "@/lib/format";
import {
  getOfflineLayer,
  wipeLocalData,
  type CachedAccount,
  type CachedActivity,
} from "@/lib/offline";
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

interface ExceptionRow {
  exception_type: string;
  subject_type: string;
  subject_id: string;
  title: string | null;
  detail: string | null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Two alarm tiers, not one: a broken promise or money on the table is danger;
// hygiene the system noticed (no champion yet, display unchecked) is attention.
// Seven identical red triangles teach a rep to ignore all of them.
const DANGER_EXCEPTIONS = new Set([
  "OVERDUE_FOLLOW_UP",
  "QUOTE_NO_FOLLOW_UP",
  "OPPORTUNITY_NO_NEXT_ACTION",
  "STRATEGIC_ACCOUNT_QUIET",
]);

function DateChip({ date, danger }: { date: string; danger?: boolean }) {
  return (
    <span
      className="row-lead flex-col leading-none"
      style={
        danger
          ? { background: "var(--danger-tint)", color: "var(--danger)" }
          : undefined
      }
    >
      <span className="text-[15px] font-bold">
        {Number(date.slice(8, 10))}
      </span>
      <span className="text-[9px] font-semibold uppercase tracking-wide opacity-70">
        {new Date(`${date}T00:00:00`).toLocaleString("en-US", {
          month: "short",
        })}
      </span>
    </span>
  );
}

export default function TodayPage() {
  const { profile, status } = useOffline();
  const router = useRouter();
  const [items, setItems] = useState<AgendaRow[]>([]);
  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [attention, setAttention] = useState<ExceptionRow[]>([]);
  const [recent, setRecent] = useState<CachedActivity[]>([]);
  const [offlineView, setOfflineView] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [planAccount, setPlanAccount] = useState("");
  const [planAction, setPlanAction] = useState("");
  const [planDate, setPlanDate] = useState(isoDate(new Date()));
  const [planObjective, setPlanObjective] = useState<VisitObjective | "">("");
  const [planObjectiveDetail, setPlanObjectiveDetail] = useState("");
  const [dayRefs, setDayRefs] = useState(() => ({ today: "", tomorrow: "" }));

  const load = useCallback(async () => {
    const layer = getOfflineLayer();
    setDayRefs({
      today: isoDate(new Date()),
      tomorrow: isoDate(new Date(Date.now() + 86_400_000)),
    });
    void layer.local.getAccounts().then(setAccounts);
    void layer.local
      .getRecentActivities()
      .then((a) => setRecent(a.slice(0, 3)));
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
          data as unknown as (AgendaRow & {
            accounts: { name: string } | null;
          })[]
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
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, status.pending, status.lastPulledAt]);

  useEffect(() => {
    if (!profile) return;
    // Management by exception (spec §3/§14): RLS scopes to the caller.
    void getSupabaseBrowserClient()
      .from("exceptions")
      .select("exception_type, subject_type, subject_id, title, detail")
      .order("since", { ascending: true })
      .limit(8)
      .then(({ data }) => setAttention((data as ExceptionRow[]) ?? []));
  }, [profile, status.lastPulledAt]);

  async function markDone(item: AgendaRow) {
    setError(null);
    try {
      const layer = getOfflineLayer();
      await layer.sync.enqueue({
        clientId: item.id,
        entityType: "next_action",
        op: "update",
        payload: { id: item.id, completed_at: new Date().toISOString() },
        baseVersion: item.updated_at, // D61: stale completion → Review
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
    // D48: every visit is intentional — the objective is set when planned.
    if (!planObjective) {
      setError("Every visit has a purpose — pick it.");
      return;
    }
    if (planObjective === "OTHER" && !planObjectiveDetail.trim()) {
      setError("A word on what the purpose is.");
      return;
    }
    if (!planAccount || !planAction.trim()) {
      setError("The account and what you'll do there are needed.");
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

  async function logout() {
    // D60: wipe the local cache before the session goes away.
    await wipeLocalData();
    await getSupabaseBrowserClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const groups = useMemo(() => {
    const { today, tomorrow } = dayRefs;
    const buckets: Record<string, AgendaRow[]> = {
      Overdue: [],
      Today: [],
      Tomorrow: [],
      "Later this week": [],
    };
    for (const i of items) {
      if (i.due_date < today) buckets.Overdue.push(i);
      else if (i.due_date === today) buckets.Today.push(i);
      else if (i.due_date === tomorrow) buckets.Tomorrow.push(i);
      else buckets["Later this week"].push(i);
    }
    return buckets;
  }, [items, dayRefs]);

  const flagged = useMemo(() => {
    // An exception that merely restates a commitment already visible above
    // (the engine's overdue echo of an agenda row) is noise on this screen.
    const visible = new Set(items.map((i) => i.id));
    const kept = attention.filter(
      (e) => !(e.subject_type === "next_action" && visible.has(e.subject_id)),
    );
    // Danger first — the tier order is the read order.
    return kept.sort(
      (a, b) =>
        Number(DANGER_EXCEPTIONS.has(b.exception_type)) -
        Number(DANGER_EXCEPTIONS.has(a.exception_type)),
    );
  }, [attention, items]);

  const nothingPlanned = items.length === 0;

  return (
    <div className="stack pt-2">
      <section>
        {/* planning is occasional; the day is the screen. The action sits
            quiet on the right instead of pushing the day below the fold. */}
        <div className="flex justify-end">
          <button
            onClick={() => setShowPlan((v) => !v)}
            className="btn-secondary flex items-center gap-1.5"
          >
            <CalendarIcon size={15} style={{ color: "var(--ink-secondary)" }} />
            {showPlan ? "Close" : "Plan a visit"}
          </button>
        </div>

        {offlineView && (
          <p className="tag tag-accent mt-3">
            No signal — showing today and tomorrow from this device
          </p>
        )}

        {showPlan && (
          <form
            onSubmit={planVisit}
            className="card card-pad mt-3 flex flex-col gap-2"
          >
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
              <option value="">Why are you going?</option>
              {VISIT_OBJECTIVES.map((o) => (
                <option key={o} value={o}>
                  {humanize(o)}
                </option>
              ))}
            </select>
            {planObjective === "OTHER" && (
              <input
                placeholder="What's the purpose?"
                value={planObjectiveDetail}
                onChange={(e) => setPlanObjectiveDetail(e.target.value)}
                className="field"
                style={{ background: "var(--surface-page)" }}
              />
            )}
            <button type="submit" className="btn-primary mt-1">
              Put it on the plan
            </button>
          </form>
        )}

        {error && (
          <p className="t-sub mt-2" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        {nothingPlanned && (
          <p className="t-sub mt-3 px-1">
            Nothing planned. Next week should be on the plan by Friday — the
            system notices when it isn&apos;t.
          </p>
        )}
      </section>

      {(["Overdue", "Today", "Tomorrow"] as const).map((label) =>
        groups[label].length === 0 ? null : (
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
              <span className="t-meta">{groups[label].length}</span>
            </div>
            <ul className="list">
              {groups[label].map((i) => (
                <li key={i.id} className="row">
                  <DateChip date={i.due_date} danger={label === "Overdue"} />
                  {/* the row opens the account it's about; Done stays its own
                      target on the right */}
                  {i.account_id ? (
                    <Link
                      href={`/accounts/${i.account_id}`}
                      className="row-body min-w-0"
                    >
                      <span className="t-title block truncate">{i.action}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        {i.accountName && (
                          <span className="t-sub">{i.accountName}</span>
                        )}
                        {i.objective && (
                          <span className="tag tag-accent">
                            {humanize(i.objective)}
                          </span>
                        )}
                      </span>
                    </Link>
                  ) : (
                    <span className="row-body min-w-0">
                      <span className="t-title block truncate">{i.action}</span>
                      {i.objective && (
                        <span className="tag tag-accent mt-1">
                          {humanize(i.objective)}
                        </span>
                      )}
                    </span>
                  )}
                  <button
                    onClick={() => markDone(i)}
                    className="btn-quiet flex shrink-0 items-center gap-1.5"
                  >
                    <CheckIcon size={14} />
                    Done
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}

      {flagged.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Needs your attention</h2>
            {flagged.some((e) => DANGER_EXCEPTIONS.has(e.exception_type)) ? (
              <span className="tag tag-danger">{flagged.length}</span>
            ) : (
              <span className="t-meta">{flagged.length}</span>
            )}
          </div>
          <ul className="list">
            {flagged.map((e) => {
              const danger = DANGER_EXCEPTIONS.has(e.exception_type);
              const body = (
                <>
                  <span
                    className="row-lead"
                    style={
                      danger ? { background: "var(--danger-tint)" } : undefined
                    }
                  >
                    <AlertIcon
                      size={18}
                      style={{
                        color: danger ? "var(--danger)" : "var(--accent-ink)",
                      }}
                    />
                  </span>
                  <span className="row-body">
                    <span className="t-title block truncate">
                      {e.title ? displayAccountName(e.title) : e.title}
                    </span>
                    <span className="t-sub block">
                      {humanize(e.exception_type)}
                      {e.detail ? ` — ${relativizeDates(e.detail)}` : ""}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={`${e.exception_type}-${e.subject_id}`}>
                  {e.subject_type === "account" ? (
                    <Link href={`/accounts/${e.subject_id}`} className="row">
                      {body}
                      <ChevronRightIcon
                        size={14}
                        style={{ color: "var(--ink-muted)" }}
                      />
                    </Link>
                  ) : (
                    <div className="row">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {groups["Later this week"].length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Later this week</h2>
            <span className="t-meta">{groups["Later this week"].length}</span>
          </div>
          <ul className="list">
            {groups["Later this week"].map((i) => (
              <li key={i.id} className="row">
                <DateChip date={i.due_date} />
                <span className="row-body min-w-0">
                  <span className="t-title block truncate">{i.action}</span>
                  {i.accountName && (
                    <span className="t-sub block">{i.accountName}</span>
                  )}
                </span>
                <button
                  onClick={() => markDone(i)}
                  className="btn-quiet flex shrink-0 items-center gap-1.5"
                >
                  <CheckIcon size={14} />
                  Done
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Just recorded</h2>
            <Link href="/weekly" className="t-action">
              The week
            </Link>
          </div>
          <ul className="list">
            {recent.map((a) => (
              <li key={a.id} className="row">
                <DateChip date={a.occurred_at.slice(0, 10)} />
                <span className="row-body">
                  <span className="flex items-center gap-2">
                    <span className="t-title truncate">
                      {humanize(a.activity_type)}
                    </span>
                    {a.pendingSync && (
                      <span className="tag tag-accent">waiting for signal</span>
                    )}
                  </span>
                  {a.what_happened && (
                    <span className="t-sub line-clamp-2 block">
                      {a.what_happened}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile && (
        <section className="flex items-center justify-between">
          <span className="t-meta truncate">{profile.email}</span>
          <button onClick={logout} className="btn-quiet">
            Log out
          </button>
        </section>
      )}
    </div>
  );
}
