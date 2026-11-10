"use client";

// MY WORK (spec 2026-11-10): what the rep owns that is still open, sorted.
// The Home's four boxes open it on their chip (?f=do-now…); the banner opens
// it on New. Read from the device cache, like the Home, so it works with no
// signal. Opening it stamps `action_items_seen_at`, which clears the banner.
//
// No new editor (the Agenda has none): a PK follow-up opens its drawer on the
// board; a visit, call or meeting opens its account, as the Agenda does, with
// the Agenda's Done; any other task unfolds Important? and the deadline in
// place, with Done. Every write is the outbox's next_action update (D61).

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { CheckIcon } from "@/components/icons";
import { ImportanceDeadline, type ImportanceDeadlineChange } from "@/components/importance-deadline";
import { GaveYou, SEEN_AT_KEY } from "@/components/your-action-items";
import { deadlineLabel, isTask, localIsoDate } from "@/lib/domain/deadline";
import { formatTime } from "@/lib/domain/commitments";
import { givesWorkToOthers } from "@/lib/domain/roles";
import type { Priority } from "@/lib/domain/pk-follow-up";
import {
  BOXES,
  BOX_LABEL,
  BOX_PARAM,
  boxOf,
  countBoxes,
  filterFromParam,
  givers,
  groupForPage,
  groupLabel,
  shortDate,
  type PageFilter,
} from "@/lib/domain/my-work";
import { displayAccountName } from "@/lib/format";
import { getOfflineLayer, type CachedAccount, type CachedAgendaItem } from "@/lib/offline";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const KIND_LABEL: Record<string, string> = { VISIT: "Visit", CALL: "Call", MEETING: "Meeting" };
const PK_SOURCE = "PK_TRAINING";
const ON_DEVICE = "Saved on this device. It reaches the others when the connection is back.";

type Patch = Pick<ImportanceDeadlineChange, "important" | "due_date"> & {
  priority?: Priority | null;
  completed_at?: string;
};

export default function MyWorkPage() {
  // useSearchParams needs a boundary.
  return (
    <Suspense fallback={<div className="stack pt-2" aria-busy="true" />}>
      <MyWork />
    </Suspense>
  );
}

function MyWork() {
  const { profile, status } = useOffline();
  const me = profile?.membershipId ?? "";
  const gives = givesWorkToOthers(profile?.role);
  const router = useRouter();
  const params = useSearchParams();
  const filter = filterFromParam(params.get("f"));

  const [agenda, setAgenda] = useState<CachedAgendaItem[]>([]);
  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  // The moment the page was last opened BEFORE this visit: New lists what came
  // in since, for as long as the page is open. The stamp for next time is
  // written as soon as it is read.
  const [clock, setClock] = useState<{ today: string; now: string; seenAt: string | null } | null>(
    null,
  );
  // Edits on screen ahead of the cache (the pull refills it after the drain).
  const [patches, setPatches] = useState<Record<string, Patch>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const local = getOfflineLayer().local;
    void local.getMeta(SEEN_AT_KEY).then((seenAt) => {
      const now = new Date().toISOString();
      setClock({ today: localIsoDate(), now, seenAt });
      void local.setMeta(SEEN_AT_KEY, now);
    });
  }, []);

  const load = useCallback(async () => {
    const local = getOfflineLayer().local;
    const [a, accts] = await Promise.all([local.getAgenda(), local.getAccounts()]);
    setAgenda(a);
    setAccounts(accts);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, status.pending, status.lastPulledAt]);

  const items = useMemo(
    () =>
      agenda.map((i) => (patches[i.id] ? ({ ...i, ...patches[i.id] } as CachedAgendaItem) : i)),
    [agenda, patches],
  );
  const accountName = useMemo(() => {
    const byId = new Map(accounts.map((a) => [a.id, displayAccountName(a.name)]));
    return (id: string | null) => (id ? (byId.get(id) ?? null) : null);
  }, [accounts]);

  const counts = useMemo(
    () => (me && clock ? countBoxes(items, me, clock.today, gives) : null),
    [items, me, clock, gives],
  );
  const gave = useMemo(
    () => (me && clock ? givers(items, me, clock.seenAt, clock.now) : null),
    [items, me, clock],
  );
  const groups = useMemo(
    () =>
      me && clock
        ? groupForPage(items, filter, {
            me,
            today: clock.today,
            gives,
            seenAt: clock.seenAt,
            now: clock.now,
          })
        : [],
    [items, filter, me, clock, gives],
  );

  // One write at a time per page, each with the newest updated_at the device
  // knows for that row (D61): a quick second edit never goes out stale.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const base = useRef<Record<string, string>>({});

  function write(item: CachedAgendaItem, patch: Patch) {
    setPatches((prev) => ({ ...prev, [item.id]: { ...prev[item.id], ...patch } }));
    setNote(null);
    chain.current = chain.current
      .then(async () => {
        const layer = getOfflineLayer();
        const seq = await layer.sync.enqueue({
          clientId: item.id,
          entityType: "next_action",
          op: "update",
          payload: { id: item.id, ...patch },
          baseVersion: base.current[item.id] ?? item.updated_at,
          blobRef: null,
        });
        await layer.sync.drain();
        if ((await layer.local.listRejected()).some((r) => r.seq === seq)) {
          setPatches((prev) => {
            const next = { ...prev };
            delete next[item.id];
            return next;
          });
          setNote("That change was not saved — the list shows what is saved now.");
          return;
        }
        const head = await layer.local.nextPending();
        if (head !== null && (head.seq ?? Infinity) <= seq) {
          setNote(ON_DEVICE);
          return;
        }
        const { data } = await getSupabaseBrowserClient()
          .from("next_actions")
          .select("updated_at")
          .eq("id", item.id)
          .maybeSingle();
        if (data?.updated_at) base.current[item.id] = data.updated_at;
      })
      .catch(() => setNote("That change could not be saved on this device. Try again."));
  }

  function pick(next: PageFilter) {
    const q = next === "ALL" ? "" : `?f=${next === "NEW" ? "new" : BOX_PARAM[next]}`;
    router.replace(`/my-work${q}`, { scroll: false });
  }

  // The chosen chip in sight: New and Scheduled sit past the edge at 390 px.
  const chipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chipsRef.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [filter, clock]);

  const showNew = (gave?.n ?? 0) > 0;
  const total = counts ? BOXES.reduce((s, b) => s + counts[b].n, 0) : 0;

  return (
    <div className="stack pt-2 mw-page">
      <div className="mw-top">
        <Link href="/" className="t-action">
          ← Home
        </Link>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">My work</h1>
        {gave && gave.n > 0 && (
          <p className="ai-from mw-from">
            <span>
              <GaveYou names={gave.names} n={gave.n} />
            </span>
          </p>
        )}
        <div ref={chipsRef} className="chip-row mw-chips" role="group" aria-label="Show">
          <Chip on={filter === "ALL"} label="All" n={total} onClick={() => pick("ALL")} />
          {BOXES.map((b) => (
            <Chip
              key={b}
              on={filter === b}
              label={BOX_LABEL[b]}
              n={counts?.[b].n ?? 0}
              onClick={() => pick(b)}
            />
          ))}
          {(showNew || filter === "NEW") && (
            <Chip on={filter === "NEW"} label="New" n={gave?.n ?? 0} onClick={() => pick("NEW")} />
          )}
        </div>
        {note && <p className="t-hint" role="status">{note}</p>}
      </div>

      {clock && groups.length === 0 && (
        <p className="t-sub px-1">Nothing open here.</p>
      )}

      {clock &&
        groups.map((g) => (
          <section key={g.key} className="mw-group">
            <div className="section-head">
              <h2 className="t-section" data-late={g.key === "LATE" || undefined}>
                {groupLabel(g.key, filter)}
              </h2>
              <span className="t-meta mw-fig">{g.items.length}</span>
            </div>
            <ul className="list">
              {g.items.map((i) => (
                <Row
                  key={i.id}
                  item={i}
                  me={me}
                  today={clock.today}
                  gives={gives}
                  account={accountName(i.account_id)}
                  open={openId === i.id}
                  onToggle={() => setOpenId((cur) => (cur === i.id ? null : i.id))}
                  onChange={(p) => write(i, p)}
                  onDone={() => write(i, { completed_at: new Date().toISOString() })}
                />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}

function Chip({
  on,
  label,
  n,
  onClick,
}: {
  on: boolean;
  label: string;
  n: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={onClick}>
      {label}
      <span className="chip-count">{n}</span>
    </button>
  );
}

function Row({
  item,
  me,
  today,
  gives,
  account,
  open,
  onToggle,
  onChange,
  onDone,
}: {
  item: CachedAgendaItem;
  me: string;
  today: string;
  gives: boolean;
  account: string | null;
  open: boolean;
  onToggle: () => void;
  onChange: (p: Patch) => void;
  onDone: () => void;
}) {
  const task = isTask(item.kind);
  const isPk = task && item.source_type === PK_SOURCE;
  const box = boxOf(item, today, gives);
  const tag = task ? (box ? BOX_LABEL[box] : null) : (KIND_LABEL[item.kind ?? ""] ?? "Visit");
  const late = item.due_date < today;
  const when = task
    ? deadlineLabel(item.due_date, today)
    : {
        text: [shortDate(item.due_date), formatTime(item.due_time)].filter(Boolean).join(", "),
        late,
      };
  const giver =
    item.entered_by != null && item.entered_by !== me
      ? (item.entered_by_name?.trim().split(/\s+/)[0] ?? null)
      : null;
  const source = item.source_type
    ? item.source_type === PK_SOURCE
      ? "from a PK"
      : "from a visit"
    : null;

  const body = (
    <>
      <span className="t-title block">{item.action}</span>
      <span className="mw-meta">
        {tag && (
          <span className="mw-tag" data-box={task ? box : "SCHEDULED"}>
            {tag}
          </span>
        )}
        {account && <span>{account}</span>}
        <span className="mw-when" data-late={when.late || undefined}>
          {when.text}
        </span>
        {!task && late && <span className="mw-never">never closed</span>}
        {source && <span className="mw-src">{source}</span>}
        {giver && <span className="mw-giver">from {giver}</span>}
      </span>
    </>
  );

  const done = (
    <button type="button" onClick={onDone} className="btn-quiet flex shrink-0 items-center gap-1.5">
      <CheckIcon size={14} />
      Done
    </button>
  );

  if (isPk) {
    return (
      <li className="row mw-row">
        <Link href={`/visits/pk?item=${item.id}`} className="row-body min-w-0">
          {body}
        </Link>
      </li>
    );
  }

  if (!task) {
    return (
      <li className="row mw-row">
        {item.account_id ? (
          <Link href={`/accounts/${item.account_id}`} className="row-body min-w-0">
            {body}
          </Link>
        ) : (
          <span className="row-body min-w-0">{body}</span>
        )}
        {done}
      </li>
    );
  }

  return (
    <li className="row mw-row mw-task" data-open={open || undefined}>
      <button
        type="button"
        className="row-body min-w-0 mw-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        {body}
      </button>
      {open && (
        <div className="mw-edit">
          <ImportanceDeadline
            important={item.important ?? null}
            due={item.due_date}
            today={today}
            ownerGivesWork={gives}
            stored={(item.priority as Priority | null | undefined) ?? null}
            onChange={(p) => onChange(p)}
          />
          <div className="mw-edit-acts">{done}</div>
        </div>
      )}
    </li>
  );
}
