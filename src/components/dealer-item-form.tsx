"use client";

// ADD A TO-DO FROM THE DEALERS BOARD (Bianca, meeting 2026-10-27): the desk
// writes up an action, a promise, something to coordinate, a follow-up or a
// deadline for a dealer without leaving the board — and, when an assistant
// supports an executive, on that executive's behalf.
//
// Whose it is: "Owner" (me, or — for an admin — any active member). An
// assistant (someone with a support_assignments row) also gets "Entering for":
// the people they support. Picking one makes that person the owner and keeps
// the assistant as the one who typed it, so the board reads "entered by <me>
// for <them>". The database overwrites entered_by with the signed-in member on
// insert, so what is sent here is advisory, and RLS is what lets the insert
// through (admin, or a support row for that owner).
//
// It writes through the offline outbox like the visit form does, so a flaky
// connection never loses the line. What it READS to fill its pickers (dealers,
// members, who the reader supports) does need the server; if that fails the
// form says so rather than showing an empty list as if it were true.

import { useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import type { DealerItem } from "@/components/dealers-todos";
import { ITEM_TYPES, ITEM_TYPE_LABEL, type ItemType } from "@/lib/domain/dealer-items";
import { nextActionCreateSchema } from "@/lib/domain/schemas";
import { isAdmin } from "@/lib/domain/roles";
import { displayAccountName } from "@/lib/format";
import { getOfflineLayer } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchAllPages } from "@/lib/supabase/page";

interface Pick {
  id: string;
  name: string;
}

interface MemberRow {
  id: string;
  status: string;
  users: { full_name: string | null } | null;
}

interface Options {
  dealers: Pick[];
  distributors: Pick[];
  members: Pick[];
  /** The people the reader supports, by membership id. */
  supported: string[];
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function loadOptions(me: string, needDealers: boolean): Promise<Options> {
  const supabase = getSupabaseBrowserClient();
  const [dealers, distributors, members, support] = await Promise.all([
    needDealers
      ? fetchAllPages<Pick>((from, to) =>
          supabase
            .from("accounts")
            .select("id, name")
            .eq("account_type", "DEALER")
            .order("name")
            .order("id")
            .range(from, to),
        )
      : Promise.resolve<Pick[]>([]),
    fetchAllPages<Pick>((from, to) =>
      supabase
        .from("accounts")
        .select("id, name")
        .eq("account_type", "DISTRIBUTOR")
        .order("name")
        .order("id")
        .range(from, to),
    ),
    // Names for the owner picker (admins) and for "Entering for" (assistants).
    fetchAllPages<MemberRow>((from, to) =>
      supabase
        .from("memberships")
        .select("id, status, users(full_name)")
        .order("id")
        .range(from, to)
        .then((r) => ({ data: r.data as unknown as MemberRow[] | null, error: r.error })),
    ),
    fetchAllPages<{ rep_membership_id: string }>((from, to) =>
      supabase
        .from("support_assignments")
        .select("rep_membership_id")
        .eq("support_membership_id", me)
        .order("rep_membership_id")
        .range(from, to),
    ),
  ]);
  return {
    dealers,
    distributors,
    members: members
      .filter((m) => m.status === "active")
      .map((m) => ({ id: m.id, name: m.users?.full_name ?? "Someone" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    supported: support.map((s) => s.rep_membership_id),
  };
}

export function DealerItemForm({
  accountId,
  accountName,
  onDone,
  onSaved,
}: {
  /** The dealer, when the form opens from a dealer's sheet. */
  accountId?: string;
  accountName?: string;
  onDone: () => void;
  /** The row as the board lists it, so it can show before the server has it. */
  onSaved?: (item: DealerItem) => void;
}) {
  const { profile } = useOffline();
  const me = profile?.membershipId ?? null;
  const admin = isAdmin(profile?.role);

  const [opts, setOpts] = useState<Options | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [dealerId, setDealerId] = useState<string | null>(accountId ?? null);
  const [dealerQuery, setDealerQuery] = useState("");
  const [type, setType] = useState<ItemType>("ACTION");
  const [what, setWhat] = useState("");
  const [due, setDue] = useState(() => isoOf(new Date()));
  const [owner, setOwner] = useState<string>("");
  const [enteringFor, setEnteringFor] = useState<string>("");
  const [distributorId, setDistributorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    let stale = false;
    loadOptions(me, !accountId)
      .then((o) => !stale && setOpts(o))
      .catch(() => !stale && setLoadFailed(true));
    return () => {
      stale = true;
    };
  }, [me, accountId]);

  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of opts?.members ?? []) m.set(p.id, p.name);
    return m;
  }, [opts]);

  const supportedPeople = useMemo(
    () =>
      (opts?.supported ?? [])
        .map((id) => ({ id, name: nameOf.get(id) ?? "Someone" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [opts, nameOf],
  );

  const dealerMatches = useMemo(() => {
    const q = dealerQuery.trim().toLowerCase();
    if (!q || !opts) return [];
    return opts.dealers
      .filter((d) => displayAccountName(d.name).toLowerCase().includes(q))
      .slice(0, 8);
  }, [dealerQuery, opts]);

  const pickedDealerName =
    accountName ??
    (dealerId && opts?.dealers.find((d) => d.id === dealerId)
      ? displayAccountName(opts.dealers.find((d) => d.id === dealerId)!.name)
      : null);

  async function save() {
    if (!profile || !me) return;
    if (!dealerId) {
      setError("Pick the dealer this is about.");
      return;
    }
    if (!what.trim()) {
      setError("Say what it is.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      setError("Pick the day it is due.");
      return;
    }
    // "Entering for" wins: it is whose it IS. Otherwise the owner picker
    // (admins) or me.
    const ownerId = enteringFor || owner || me;
    const id = crypto.randomUUID();
    const payload = {
      id,
      org_id: profile.orgId,
      action: what.trim(),
      owner_id: ownerId,
      due_date: due,
      account_id: dealerId,
      item_type: type,
      source: "MANUAL" as const,
      entered_by: me,
      counterparty_account_id: type === "DEADLINE" && distributorId ? distributorId : null,
    };
    const parsed = nextActionCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setError("Something in the form is not right. Check the dealer and the date.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const layer = getOfflineLayer();
      await layer.sync.enqueue({
        clientId: id,
        entityType: "next_action",
        op: "create",
        payload,
        baseVersion: null,
        blobRef: null,
      });
      void layer.sync.drain();
      onSaved?.({
        id,
        action: payload.action,
        due_date: due,
        owner_id: ownerId,
        account_id: dealerId,
        item_type: type,
        source: "MANUAL",
        entered_by: me,
        completed_at: null,
        account: pickedDealerName ? { name: pickedDealerName } : null,
      });
      onDone();
    } catch {
      setError("It could not be saved on this device. Try again.");
      setBusy(false);
    }
  }

  const showOwner = admin && (opts?.members.length ?? 0) > 1;
  const showEnteringFor = supportedPeople.length > 0;

  return (
    <div className="newco card card-pad flex flex-col gap-3" role="group" aria-label="Add a to-do">
      <p className="sales-eyebrow">Add a to-do</p>

      {loadFailed && (
        <p className="t-sub" style={{ color: "var(--danger)" }}>
          The lists for this form could not be read right now. Close it and try again when
          you&rsquo;re back online.
        </p>
      )}

      {!accountId && (
        <div className="flex flex-col gap-1">
          <span className="t-hint">Dealer</span>
          {dealerId ? (
            <div className="row">
              <span className="row-body">
                <span className="t-title block truncate">{pickedDealerName ?? "Dealer"}</span>
              </span>
              <button
                type="button"
                className="btn-quiet shrink-0"
                onClick={() => {
                  setDealerId(null);
                  setDealerQuery("");
                }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                className="field"
                placeholder="Start typing the dealer's name"
                value={dealerQuery}
                onChange={(e) => setDealerQuery(e.target.value)}
                disabled={!opts}
                aria-label="Dealer"
              />
              {dealerMatches.length > 0 && (
                <ul className="card overflow-hidden">
                  {dealerMatches.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className="flex w-full items-baseline gap-2 px-4 py-3 text-left"
                        onClick={() => {
                          setDealerId(d.id);
                          setDealerQuery("");
                        }}
                      >
                        <span className="t-title truncate">{displayAccountName(d.name)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="t-hint">Kind</span>
        <div className="newco-types" role="group" aria-label="Kind of to-do">
          {ITEM_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className="chip"
              aria-pressed={type === t}
              onClick={() => setType(t)}
            >
              {ITEM_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="t-hint">What</span>
        <textarea
          className="field"
          rows={2}
          placeholder={
            type === "PROMISE"
              ? "What was promised?"
              : type === "DEADLINE"
                ? "What has to be done by then?"
                : "One line is enough."
          }
          value={what}
          onChange={(e) => setWhat(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="t-hint">Due</span>
        <input
          type="date"
          className="field"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </label>

      {showOwner && (
        <label className="flex flex-col gap-1">
          <span className="t-hint">Owner</span>
          <select
            className="field"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            disabled={enteringFor !== ""}
          >
            <option value="">Me</option>
            {opts!.members
              .filter((m) => m.id !== me)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
      )}

      {showEnteringFor && (
        <label className="flex flex-col gap-1">
          <span className="t-hint">Entering for</span>
          <select
            className="field"
            value={enteringFor}
            onChange={(e) => setEnteringFor(e.target.value)}
          >
            <option value="">Myself</option>
            {supportedPeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {type === "DEADLINE" && (opts?.distributors.length ?? 0) > 0 && (
        <label className="flex flex-col gap-1">
          <span className="t-hint">Distributor (optional)</span>
          <select
            className="field"
            value={distributorId}
            onChange={(e) => setDistributorId(e.target.value)}
          >
            <option value="">None</option>
            {opts!.distributors.map((d) => (
              <option key={d.id} value={d.id}>
                {displayAccountName(d.name)}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p className="t-sub" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <div className="newco-actions">
        <button type="button" className="btn-quiet" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void save()}
          disabled={busy || loadFailed}
        >
          Add it
        </button>
      </div>
    </div>
  );
}
