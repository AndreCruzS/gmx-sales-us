"use client";

// The people behind the doors (Andre, 2026-09-02): every contact the org
// holds, in one place — because a quote is sent to a PERSON, and until now a
// person could only be found by first remembering which company they answer
// for. This list is the other direction: the name first, the company as the
// subtitle, the e-mail and phone one tap away.
//
// Adding and correcting live here too: one form, blank for a new person,
// prefilled for an edit. Writes ride the outbox like every other capture —
// create is idempotent by client-minted id (D57), edit is LWW-guarded by the
// row's updated_at (D61), so both work at a counter with no signal.
//
// Same shape as the accounts list: the cached working set renders instantly
// and answers offline (a rep's cache already carries contacts, champions
// first — D56); with signal the full org loads behind it. RLS scopes the
// query to the caller either way, so there is no second set of rules.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { displayAccountName } from "@/lib/format";
import { getOfflineLayer, type CachedContact } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ContactRow extends CachedContact {
  accountName: string | null;
}

interface AccountOption {
  id: string;
  name: string;
  account_type: string;
  city: string | null;
}

const COLUMNS =
  "id, account_id, name, job_title, email, phone, is_champion, updated_at, accounts(name)";

// The form's working copy — one shape for both acts. `editing` carries the
// row being corrected (with its baseVersion); null means a new person.
interface Draft {
  editing: ContactRow | null;
  accountId: string;
  name: string;
  jobTitle: string;
  email: string;
  phone: string;
  champion: boolean;
}

const BLANK: Draft = {
  editing: null,
  accountId: "",
  name: "",
  jobTitle: "",
  email: "",
  phone: "",
  champion: false,
};

export default function ContactsPage() {
  const { profile, status } = useOffline();
  const [cached, setCached] = useState<ContactRow[]>([]);
  const [live, setLive] = useState<{ fresh: boolean; rows: ContactRow[] }>({
    fresh: false,
    rows: [],
  });
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [accountQuery, setAccountQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Optimistic rows layered over whichever list is showing, so a save is
  // visible before the outbox lands it — same D56 idiom as everywhere else.
  const [localEdits, setLocalEdits] = useState<Map<string, ContactRow>>(
    new Map(),
  );

  // The cache first — contacts ride the working set with the account names
  // beside them, so the list stands with no signal at all.
  useEffect(() => {
    if (!profile) return;
    void (async () => {
      const layer = getOfflineLayer();
      const [contacts, accts] = await Promise.all([
        layer.local.getContacts(),
        layer.local.getAccounts(),
      ]);
      const nameOf = new Map(accts.map((a) => [a.id, a.name]));
      setCached(
        contacts.map((c) => ({
          ...c,
          accountName: nameOf.get(c.account_id) ?? null,
        })),
      );
      // The picker starts on the cached working set; the live list below
      // replaces it when the network answers.
      setAccounts((prev) =>
        prev.length > 0
          ? prev
          : accts.map((a) => ({
              id: a.id,
              name: a.name,
              account_type: a.account_type,
              city: a.city,
            })),
      );
    })();
  }, [profile, status.lastPulledAt]);

  // The whole org behind it, when the network answers.
  useEffect(() => {
    if (!profile) return;
    let stale = false;
    void (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const [ct, ac] = await Promise.all([
          supabase
            .from("contacts")
            .select(COLUMNS)
            .order("is_champion", { ascending: false })
            .order("name")
            .limit(1000),
          supabase
            .from("accounts")
            .select("id, name, account_type, city")
            .order("name")
            .limit(500),
        ]);
        if (stale) return;
        if (!ct.error && ct.data) {
          setLive({
            fresh: true,
            rows: (
              ct.data as unknown as (CachedContact & {
                accounts: { name: string } | null;
              })[]
            ).map((c) => ({ ...c, accountName: c.accounts?.name ?? null })),
          });
        }
        if (!ac.error && ac.data) setAccounts(ac.data as AccountOption[]);
      } catch {
        // no signal — the cached working set below is the view
      }
    })();
    return () => {
      stale = true;
    };
  }, [profile, status.lastPulledAt]);

  const rows = useMemo(() => {
    const base = live.fresh ? live.rows : cached;
    if (localEdits.size === 0) return base;
    const merged = base.map((c) => localEdits.get(c.id) ?? c);
    const known = new Set(base.map((c) => c.id));
    for (const [id, row] of localEdits) {
      if (!known.has(id)) merged.unshift(row);
    }
    return merged;
  }, [live, cached, localEdits]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.accountName ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.job_title ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const chosenAccount = draft
    ? (accounts.find((a) => a.id === draft.accountId) ?? null)
    : null;

  const filteredAccounts = useMemo(() => {
    const q = accountQuery.trim().toLowerCase();
    const base = q
      ? accounts.filter((a) => a.name.toLowerCase().includes(q))
      : accounts;
    return base.slice(0, 6);
  }, [accounts, accountQuery]);

  function openAdd() {
    setError(null);
    setAccountQuery("");
    setDraft({ ...BLANK });
  }

  function openEdit(c: ContactRow) {
    setError(null);
    setDraft({
      editing: c,
      accountId: c.account_id,
      name: c.name,
      jobTitle: c.job_title ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      champion: c.is_champion,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || !draft) return;
    if (!draft.name.trim()) {
      setError("The person needs a name.");
      return;
    }
    if (!draft.editing && !draft.accountId) {
      setError("Whose company are they? Pick the account.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const layer = getOfflineLayer();
      const now = new Date().toISOString();
      if (draft.editing) {
        // D61: the edit lands only if the row hasn't moved since we read it.
        await layer.sync.enqueue({
          clientId: draft.editing.id,
          entityType: "contact",
          op: "update",
          payload: {
            id: draft.editing.id,
            name: draft.name.trim(),
            job_title: draft.jobTitle.trim() || null,
            email: draft.email.trim() || null,
            phone: draft.phone.trim() || null,
            is_champion: draft.champion,
          },
          baseVersion: draft.editing.updated_at,
          blobRef: null,
        });
        setLocalEdits((prev) =>
          new Map(prev).set(draft.editing!.id, {
            ...draft.editing!,
            name: draft.name.trim(),
            job_title: draft.jobTitle.trim() || null,
            email: draft.email.trim() || null,
            phone: draft.phone.trim() || null,
            is_champion: draft.champion,
            updated_at: now,
          }),
        );
      } else {
        const id = crypto.randomUUID();
        await layer.sync.enqueue({
          clientId: id,
          entityType: "contact",
          op: "create",
          payload: {
            id,
            org_id: profile.orgId,
            account_id: draft.accountId,
            name: draft.name.trim(),
            job_title: draft.jobTitle.trim() || null,
            email: draft.email.trim() || null,
            phone: draft.phone.trim() || null,
            is_champion: draft.champion,
          },
          baseVersion: null,
          blobRef: null,
        });
        setLocalEdits((prev) =>
          new Map(prev).set(id, {
            id,
            account_id: draft.accountId,
            name: draft.name.trim(),
            job_title: draft.jobTitle.trim() || null,
            email: draft.email.trim() || null,
            phone: draft.phone.trim() || null,
            is_champion: draft.champion,
            updated_at: now,
            accountName: chosenAccount?.name ?? null,
          }),
        );
      }
      void layer.sync.drain();
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack pt-2">
      <section>
        <div className="flex items-center gap-2">
          <label className="field flex min-w-0 flex-1 items-center gap-2">
            <SearchIcon size={16} style={{ color: "var(--ink-muted)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a person, a company, an e-mail"
              className="min-w-0 flex-1 bg-transparent outline-none"
              aria-label="Search contacts"
            />
          </label>
          <button
            type="button"
            onClick={() => (draft ? setDraft(null) : openAdd())}
            className="btn-secondary flex shrink-0 items-center gap-1.5"
          >
            <PlusIcon size={14} />
            {draft ? "Close" : "Add a person"}
          </button>
        </div>

        {draft && (
          <form onSubmit={save} className="card card-pad mt-3 flex flex-col gap-2">
            {draft.editing ? (
              <p className="t-sub">
                {draft.editing.accountName
                  ? `At ${displayAccountName(draft.editing.accountName)}`
                  : "Editing"}
              </p>
            ) : chosenAccount ? (
              <div className="row" style={{ padding: 0 }}>
                <span className="row-body">
                  <span className="t-title block truncate">
                    {chosenAccount.name}
                  </span>
                  <span className="t-sub block truncate">
                    {chosenAccount.city ?? chosenAccount.account_type}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-quiet shrink-0"
                  onClick={() =>
                    setDraft((d) => (d ? { ...d, accountId: "" } : d))
                  }
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="card overflow-hidden">
                <input
                  autoFocus
                  placeholder="Whose company? Find the account"
                  value={accountQuery}
                  onChange={(e) => setAccountQuery(e.target.value)}
                  className="field"
                  style={{ borderRadius: 0, border: 0 }}
                />
                <ul>
                  {filteredAccounts.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft((d) => (d ? { ...d, accountId: a.id } : d));
                          setAccountQuery("");
                        }}
                        className="flex w-full items-baseline gap-2 px-4 py-3 text-left"
                        style={{ borderTop: "1px solid var(--rule)" }}
                      >
                        <span className="t-title">{a.name}</span>
                        <span className="t-hint">{a.city ?? a.account_type}</span>
                      </button>
                    </li>
                  ))}
                  {filteredAccounts.length === 0 && (
                    <p className="t-sub px-4 py-3">No accounts match.</p>
                  )}
                </ul>
              </div>
            )}

            <input
              placeholder="Their name"
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, name: e.target.value } : d))
              }
              className="field"
            />
            <input
              placeholder="Job title (optional)"
              value={draft.jobTitle}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, jobTitle: e.target.value } : d))
              }
              className="field"
            />
            <input
              type="email"
              placeholder="E-mail (optional)"
              value={draft.email}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, email: e.target.value } : d))
              }
              className="field"
            />
            <input
              type="tel"
              placeholder="Phone (optional)"
              value={draft.phone}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, phone: e.target.value } : d))
              }
              className="field"
            />
            <label className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={draft.champion}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, champion: e.target.checked } : d))
                }
              />
              <span className="t-sub">
                Champion — your fan at this account
              </span>
            </label>

            {error && (
              <p className="t-sub" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className="btn-primary mt-1">
              {draft.editing ? "Save the correction" : "Add them"}
            </button>
          </form>
        )}
      </section>

      {shown.length === 0 ? (
        <p className="t-sub px-1">
          {rows.length === 0
            ? "No contacts yet. They arrive as accounts gain their people — a champion named on a new account, a card scanned at a counter."
            : "Nobody matches that."}
        </p>
      ) : (
        <section>
          <div className="section-head">
            <h2 className="t-section">People</h2>
            <span className="t-meta">{shown.length}</span>
          </div>
          <ul className="list">
            {shown.map((c) => (
              <li key={c.id} className="row">
                {/* the row opens the company the person answers for; the
                    e-mail, phone and edit stay their own targets */}
                <Link
                  href={`/accounts/${c.account_id}`}
                  className="row-body min-w-0"
                >
                  <span className="flex items-center gap-2">
                    <span className="t-title truncate">{c.name}</span>
                    {c.is_champion && (
                      <span className="tag tag-accent shrink-0">Champion</span>
                    )}
                  </span>
                  <span className="t-sub block truncate">
                    {[
                      c.job_title,
                      c.accountName ? displayAccountName(c.accountName) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </span>
                </Link>
                <span className="flex shrink-0 items-center gap-1.5">
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="btn-quiet">
                      E-mail
                    </a>
                  )}
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="btn-quiet">
                      Call
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn-quiet"
                    onClick={() => openEdit(c)}
                  >
                    Edit
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
