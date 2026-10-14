"use client";

// The people behind the doors (Andre, 2026-09-02): every contact the org
// holds, in one place — because a quote is sent to a PERSON, and until now a
// person could only be found by first remembering which company they answer
// for. This list is the other direction: the name first, the company as the
// subtitle, the e-mail and phone one tap away.
//
// READ LIKE THE SALES BOARD (Andre, 2026-10-14). With the distributor
// directories loaded the list is sixty-five names and climbing, so it gets
// the board's WALK above it — Everyone › Distributors › Boise Cascade ›
// Riverside, each step collapsing into a crumb while the next stage's
// choices become chips, region as the one sideways narrowing — reads company
// by company with a head where the block changes, and turns a page at a
// time. The rules live in lib/domain/contact-list and are tested there; this
// file only wires them to the screen, in the Sales board's own trail, back
// pill and context sentence.
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
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { ChipSelect } from "@/components/chip-select";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { Pager, usePaged, usePageSize } from "@/components/pager";
import {
  NO_CONTACT_SCOPE,
  contactGroup,
  contactRegion,
  contextSentence,
  countBy,
  narrowContacts,
  nextStage,
  sortContacts,
  withGroupHeads,
  type ContactListRow,
  type ContactScope,
  type ContactStep,
} from "@/lib/domain/contact-list";
import { displayAccountName } from "@/lib/format";
import { getOfflineLayer, type CachedContact } from "@/lib/offline";
import { fetchAllPages } from "@/lib/supabase/page";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type ContactRow = CachedContact & ContactListRow;

interface AccountOption {
  id: string;
  name: string;
  account_type: string;
  city: string | null;
  territory_id: string | null;
}

const COLUMNS =
  "id, account_id, name, job_title, email, phone, is_champion, updated_at, " +
  "accounts(name, account_type, territory_id), distributor_branches(name, territory_id)";

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
  const [regions, setRegions] = useState<{ id: string; name: string }[]>([]);
  const [scope, setScope] = useState<ContactScope>(NO_CONTACT_SCOPE);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [accountQuery, setAccountQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Optimistic rows layered over whichever list is showing, so a save is
  // visible before the outbox lands it — same D56 idiom as everywhere else.
  const [localEdits, setLocalEdits] = useState<Map<string, ContactRow>>(
    new Map(),
  );
  const size = usePageSize(20, 10);

  // The cache first — contacts ride the working set with the account names
  // beside them, so the list stands with no signal at all. The cache knows no
  // branches, so a cached distributor person sits under the house's region
  // until the network answers.
  useEffect(() => {
    if (!profile) return;
    void (async () => {
      const layer = getOfflineLayer();
      const [contacts, accts] = await Promise.all([
        layer.local.getContacts(),
        layer.local.getAccounts(),
      ]);
      const byId = new Map(accts.map((a) => [a.id, a]));
      setCached(
        contacts.map((c) => {
          const a = byId.get(c.account_id);
          return {
            ...c,
            accountName: a?.name ?? null,
            accountType: a?.account_type ?? null,
            accountTerritoryId: a?.territory_id ?? null,
            branchName: null,
            branchTerritoryId: null,
          };
        }),
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
              territory_id: a.territory_id,
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
        const [ct, ac, tr] = await Promise.all([
          fetchAllPages((from, to) =>
            supabase
              .from("contacts")
              .select(COLUMNS)
              .order("name")
              .order("id")
              .range(from, to),
          ),
          fetchAllPages((from, to) =>
            supabase
              .from("accounts")
              .select("id, name, account_type, city, territory_id")
              .order("name")
              .order("id")
              .range(from, to),
          ),
          supabase.from("territories").select("id, name").order("name"),
        ]);
        if (stale) return;
        setLive({
          fresh: true,
          rows: (
            ct as unknown as (CachedContact & {
              accounts: {
                name: string;
                account_type: string;
                territory_id: string | null;
              } | null;
              distributor_branches: {
                name: string;
                territory_id: string | null;
              } | null;
            })[]
          ).map((c) => ({
            ...c,
            accountName: c.accounts?.name ?? null,
            accountType: c.accounts?.account_type ?? null,
            accountTerritoryId: c.accounts?.territory_id ?? null,
            branchName: c.distributor_branches?.name ?? null,
            branchTerritoryId: c.distributor_branches?.territory_id ?? null,
          })),
        });
        setAccounts(ac as AccountOption[]);
        if (!tr.error && tr.data) setRegions(tr.data);
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

  const shown = useMemo(
    () => sortContacts(narrowContacts(rows, scope)),
    [rows, scope],
  );
  const { slice, page, pages, from, setPage } = usePaged(shown, size);
  const listRef = useRef<HTMLElement | null>(null);
  // A page turn is tapped at the FOOT of the list; the new page starts at
  // its head, so the reader is taken there rather than left at the end.
  function turn(next: number) {
    setPage(next);
    listRef.current?.scrollIntoView({ block: "start" });
  }

  // A new narrowing starts at its own first page, never halfway down the
  // last one.
  function narrow(patch: Partial<ContactScope>) {
    setScope((s) => ({ ...s, ...patch }));
    setPage(0);
  }

  // The next stage's chips, counted under the region and the search, so a
  // choice that would empty the screen says so before it is made — the
  // dealer lens's rule. Region is counted under the path for the same reason.
  const stage = useMemo(
    () => nextStage(narrowContacts(rows, { ...scope, path: [] }), scope.path),
    [rows, scope],
  );
  const regionOptions = useMemo(() => {
    const under = narrowContacts(rows, { ...scope, regionId: "" });
    const n = countBy(under, contactRegion);
    return regions
      .filter((t) => (n.get(t.id) ?? 0) > 0 || t.id === scope.regionId)
      .map((t) => ({ id: t.id, label: t.name, hint: String(n.get(t.id) ?? 0) }));
  }, [rows, regions, scope]);

  const path = scope.path;
  // The way out names where it goes: "‹ Distributors" rather than "‹ Back".
  const backLabel =
    path.length === 0 ? null : path.length === 1 ? "Everyone" : path[path.length - 2].name;
  function goTo(next: readonly ContactStep[]) {
    narrow({ path: next });
  }
  function stepInto(dim: ContactStep["dim"], key: string, name: string) {
    goTo([...path, { dim, key, name }]);
  }
  const sentence = contextSentence(path, shown.length);

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
            accountType: chosenAccount?.account_type ?? null,
            accountTerritoryId: chosenAccount?.territory_id ?? null,
            branchName: null,
            branchTerritoryId: null,
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
              value={scope.query}
              onChange={(e) => narrow({ query: e.target.value })}
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

      {/* THE WALK, in the Sales board's own furniture. Where you are as a
          sentence; the trail with a solid way out, only once there is
          somewhere to come back FROM; then the next stage's chips with the
          region beside them. The row must not clip — the chip-select's panel
          is absolute (see chip-select). */}
      {rows.length > 0 && (
        <section aria-label="Narrow the directory">
          <p className="sales-context" aria-live="polite">
            {sentence.map((part, i) => (
              <span key={i} className={i === 0 ? "sales-context-what" : undefined}>
                {i > 0 ? " · " : ""}
                {part}
              </span>
            ))}
          </p>

          {path.length > 0 && (
            <nav className="sales-crumbs" aria-label="Where you are">
              <button
                type="button"
                className="sales-back"
                onClick={() => goTo(path.slice(0, -1))}
              >
                <span className="sales-back-arrow" aria-hidden="true">
                  &#8249;
                </span>
                {backLabel}
              </button>
              <span className="sales-trail">
                <button type="button" onClick={() => goTo([])}>
                  Everyone
                </button>
                {path.map((st, i) => (
                  <button
                    key={`${st.dim}-${st.key}`}
                    type="button"
                    onClick={() => goTo(path.slice(0, i + 1))}
                    aria-current={i === path.length - 1 ? "step" : undefined}
                  >
                    {st.name}
                  </button>
                ))}
              </span>
            </nav>
          )}

          <div className="dealer-scope">
            {path.length === 0 && (
              <button type="button" className="chip" aria-pressed>
                Everyone <span className="chip-count">{shown.length}</span>
              </button>
            )}
            {stage?.options.map((o) => (
              <button
                key={o.key}
                type="button"
                className="chip"
                aria-pressed={false}
                disabled={o.count === 0}
                onClick={() => stepInto(stage.dim, o.key, o.name)}
              >
                {o.name} <span className="chip-count">{o.count}</span>
              </button>
            ))}
            <ChipSelect
              label="Narrow to one region"
              allLabel="All regions"
              value={scope.regionId}
              options={regionOptions}
              onChange={(id) => narrow({ regionId: id })}
            />
          </div>
        </section>
      )}

      {shown.length === 0 ? (
        <p className="t-sub px-1">
          {rows.length === 0
            ? "No contacts yet. They arrive as accounts gain their people — a champion named on a new account, a card scanned at a counter."
            : "Nobody matches that."}
        </p>
      ) : (
        <section ref={listRef} style={{ scrollMarginTop: 72 }}>
          <div className="section-head">
            <h2 className="t-section">People</h2>
            <span className="t-meta">{shown.length}</span>
          </div>
          <ul className="list">
            {withGroupHeads(slice, contactGroup).map(({ row: c, head }) => (
              <Fragment key={c.id}>
              {head && (
                <li className="acct-step-head contact-head" aria-hidden="true">
                  {head}
                </li>
              )}
              <li className="row">
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
                      c.branchName ?? null,
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
              </Fragment>
            ))}
          </ul>
          {pages > 1 && (
            <Pager
              page={page}
              pages={pages}
              from={from}
              shown={slice.length}
              total={shown.length}
              onPage={turn}
              className="contact-pager"
            />
          )}
        </section>
      )}
    </div>
  );
}
