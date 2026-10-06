"use client";

// REPS — the second of the four boards (Andre, meeting of 2026-10-02).
//
// The structural change he asked for is SALES · REPS · ACCOUNTS · CONTACTS,
// one board each, so that moving between them never loses your place. Sales
// keeps only sales: what the month did, what is slipping, what the goal says.
// Everything that is about a PERSON doing the work moved here.
//
// Two things arrived with it, both by name:
//   · "Getting dealers selling" — the rollout gates. On Sales they only ever
//     appeared under the Rep lens, which is the tell: they were never a sales
//     reading. They are a list of dealers somebody has to go and finish.
//   · The follow-ups — a promise on somebody's calendar.
//
// AND THE PAGE ACTS (Andre: "o admin resolveu montar varios dashboards que tb
// possuem actions já percebeste né"). Every board is overview → insight →
// act HERE. So the gates keep their checkboxes and their PK counter, and a
// follow-up carries the two buttons that can actually end it: record what
// happened, or move the date. A board that shows a problem and sends you
// somewhere else to solve it is a report, and the admin is not building
// reports.
//
// WHOSE numbers: picking a rep narrows the whole page — the roster stays on
// screen, so the way back is where you left it. A rep who signs in sees their
// own row preselected, because for them "the team" is not the question.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import { CalendarIcon, MicrophoneIcon } from "@/components/icons";
import { Pager, usePaged, usePageSize } from "@/components/pager";
import { RepsMenu } from "@/components/reps-menu";
import { RolloutTimeline } from "@/components/rollout-timeline";
import { packDesk, spanner, type DeskWidth } from "@/lib/desk-pack";
import {
  countGates,
  displayRoster,
  latestMaterialEvidence,
  materialRoster,
  pkRoster,
  type GateRow,
} from "@/lib/domain/rollout";
import { manages } from "@/lib/domain/roles";
import { avatarLetter, displayAccountName, formatDay } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

interface RepRow {
  membership_id: string;
  rep_name: string;
  territory_name: string | null;
  activities_30d: number;
  open_opportunities: number;
  open_next_actions: number;
  overdue_next_actions: number;
  quotes_outstanding: number;
  last_activity_at: string | null;
}

interface ActionRow {
  id: string;
  action: string;
  due_date: string;
  owner_id: string;
  account_id: string | null;
  accounts: { name: string } | null;
}

interface EvidenceRow {
  account_id: string;
  period: string;
  lf: number;
}

interface WallRow {
  id: string;
  display_last_verified_at: string | null;
}

/** Whose board is being read. `undefined` means nobody has chosen yet, so the
 *  default below still applies; `null` is the deliberate choice of everyone,
 *  which is a different thing and must survive a reload. */
type Pick = string | null | undefined;

export default function RepsPage() {
  const { profile, status } = useOffline();

  const [reps, setReps] = useState<RepRow[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [gates, setGates] = useState<GateRow[]>([]);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [walls, setWalls] = useState<WallRow[]>([]);
  const [pick, setPick] = useState<Pick>(undefined);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [sc, na, gs, ev, dw] = await Promise.all([
      supabase
        .from("dashboard_rep_scorecard")
        .select(
          "membership_id, rep_name, territory_name, activities_30d, open_opportunities, open_next_actions, overdue_next_actions, quotes_outstanding, last_activity_at",
        )
        .order("rep_name"),
      // THE PROMISES. Open only — a kept one is history, and this board is
      // what is still owed. Soonest first, so the overdue rise to the top on
      // their own without a second sort.
      supabase
        .from("next_actions")
        .select("id, action, due_date, owner_id, account_id, accounts(name)")
        .is("completed_at", null)
        .order("due_date")
        .limit(1000),
      // The gates, with the owner — this is what makes the book a REP's book
      // rather than a list of 136 dealers nobody is standing next to.
      supabase
        .from("account_rollout_status")
        .select(
          "account_id, org_id, owner_id, name, pk_state, merchandiser_state, display_wall_state, material_state, pk_count",
        )
        .limit(500),
      // Every month a return shows a dealer selling — the Material gate's
      // citation. All months on purpose: the proof does not blink.
      supabase
        .from("account_material_evidence")
        .select("account_id, period, lf")
        .limit(1000),
      supabase
        .from("accounts")
        .select("id, display_last_verified_at")
        .eq("account_type", "DEALER")
        .limit(500),
    ]);
    setReps(sc.error ? [] : ((sc.data as unknown as RepRow[]) ?? []));
    setActions(na.error ? [] : ((na.data as unknown as ActionRow[]) ?? []));
    setGates(gs.error ? [] : ((gs.data as unknown as GateRow[]) ?? []));
    setEvidence(ev.error ? [] : ((ev.data as unknown as EvidenceRow[]) ?? []));
    setWalls(dw.error ? [] : ((dw.data as unknown as WallRow[]) ?? []));
    setLoadedAt(Date.now());
  }, []);

  // Every attempt must CONCLUDE: this board is network-only, so "no signal" is
  // a state it has to be able to say out loud rather than draw as zeros.
  const attempt = useCallback(async () => {
    setLoadFailed(false);
    try {
      await load();
    } catch {
      setLoadFailed(true);
    }
  }, [load]);

  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => void attempt(), 0);
    return () => clearTimeout(timer);
  }, [profile, attempt, status.lastPulledAt]);

  // A REP LANDS ON THEMSELVES, because for them "the team" is not the
  // question. DERIVED, not set from an effect: an effect that preselects has
  // to remember whether it already ran, and that memory is the bug — a reload
  // would undo a manager's "Everyone" the moment the roster came back. So
  // `undefined` means unchosen and reads this default; any real choice, "all"
  // included, overrides it and stays.
  const myDefault = useMemo(() => {
    if (!profile || manages(profile.role)) return null;
    return reps.some((r) => r.membership_id === profile.membershipId)
      ? profile.membershipId
      : null;
  }, [profile, reps]);
  const at = pick === undefined ? myDefault : pick;

  const chosen = useMemo(
    () => reps.find((r) => r.membership_id === at) ?? null,
    [reps, at],
  );

  // ── WHAT THE PICK NARROWS ─────────────────────────────────────────────────
  const myActions = useMemo(
    () => (at ? actions.filter((a) => a.owner_id === at) : actions),
    [actions, at],
  );

  const myGates = useMemo(
    () => (at ? gates.filter((g) => g.owner_id === at) : gates),
    [gates, at],
  );

  // DEALERS WITH NOBODY ON THEM. Not a question for the client (that is a
  // leadership conversation, not a column in anybody's spreadsheet) — a
  // number this board can read off its own tables. It only makes sense for
  // the whole team: inside one rep's reading there is by definition no hole.
  const ownerless = useMemo(() => {
    const own = new Set(reps.map((r) => r.membership_id));
    return gates.filter((g) => !g.owner_id || !own.has(g.owner_id)).length;
  }, [gates, reps]);

  const counts = useMemo(() => countGates(myGates), [myGates]);
  const pkAccounts = useMemo(() => pkRoster(myGates), [myGates]);
  const latestEvidence = useMemo(
    () => latestMaterialEvidence(evidence),
    [evidence],
  );
  const materialAccounts = useMemo(
    () => materialRoster(myGates, latestEvidence),
    [myGates, latestEvidence],
  );
  const wallMap = useMemo(() => new Map(walls.map((w) => [w.id, w])), [walls]);
  const displayAccounts = useMemo(
    () => displayRoster(myGates, wallMap),
    [myGates, wallMap],
  );

  // ── THE WRITES, OPTIMISTIC ────────────────────────────────────────────────
  // The row being ticked is already on the screen, so the truth is only
  // re-read when the write fails. Same three writers the Sales page used to
  // own; they came across with the board.
  const setPkCount = useCallback(
    async (accountId: string, next: number) => {
      const row = gates.find((g) => g.account_id === accountId);
      if (!row || next < 0) return;
      setGates((prev) =>
        prev.map((g) =>
          g.account_id === accountId
            ? {
                ...g,
                pk_count: next,
                pk_state: next > 0 ? "OK" : g.pk_state === "OK" ? "NO" : g.pk_state,
              }
            : g,
        ),
      );
      const { error } = await getSupabaseBrowserClient()
        .from("account_rollout")
        .upsert(
          { account_id: accountId, org_id: row.org_id, pk_count: next },
          { onConflict: "account_id" },
        );
      if (error) void attempt();
    },
    [gates, attempt],
  );

  // The manual yes/no (Andre, 2026-09-04): the box is the word of whoever last
  // stood in the store — the evidence beside it never ticks it.
  const setMaterial = useCallback(
    async (accountId: string, next: boolean) => {
      const row = gates.find((g) => g.account_id === accountId);
      if (!row) return;
      setGates((prev) =>
        prev.map((g) =>
          g.account_id === accountId
            ? { ...g, material_state: next ? "OK" : "NO" }
            : g,
        ),
      );
      const { error } = await getSupabaseBrowserClient()
        .from("account_rollout")
        .upsert(
          { account_id: accountId, org_id: row.org_id, material_state: next ? "OK" : "NO" },
          { onConflict: "account_id" },
        );
      if (error) void attempt();
    },
    [gates, attempt],
  );

  // The wall's yes/no writes to the ACCOUNT: checking says "it is up, I saw
  // it" — so it stamps the verification too. Unchecking takes both back.
  const setDisplay = useCallback(
    async (accountId: string, next: boolean) => {
      const stamp = new Date().toISOString();
      setGates((prev) =>
        prev.map((g) =>
          g.account_id === accountId
            ? { ...g, display_wall_state: next ? "OK" : "NO" }
            : g,
        ),
      );
      setWalls((prev) => {
        const row = { id: accountId, display_last_verified_at: next ? stamp : null };
        return prev.some((w) => w.id === accountId)
          ? prev.map((w) => (w.id === accountId ? row : w))
          : [...prev, row];
      });
      const { error } = await getSupabaseBrowserClient()
        .from("accounts")
        .update({
          has_display_wall: next,
          display_last_verified_at: next ? stamp : null,
        })
        .eq("id", accountId);
      if (error) void attempt();
    },
    [attempt],
  );

  // The desk packs itself — the same rule the Sales board obeys, so a block
  // added here later finds its line without anybody naming a column.
  const span = useMemo(() => {
    const want: { k: string; w: DeskWidth }[] = [{ k: "roster", w: "full" }];
    want.push({ k: "followups", w: counts ? "wide" : "full" });
    if (counts) want.push({ k: "gates", w: "full" });
    return spanner(packDesk(want));
  }, [counts]);

  // SHAPE WITHOUT VALUES — the same rule home-skeleton.tsx sets out: blocks
  // where the figures will be, never a zero standing in for an unknown.
  if (loadedAt === null && !loadFailed) {
    return (
      <div className="stack pt-2" aria-busy="true">
        <RepsMenu />
        <section>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">
            Reps
          </h1>
          <span className="skel mt-2" style={{ width: "70%", height: 13 }} />
        </section>
        <section>
          <div className="section-head">
            <h2 className="t-section">The team</h2>
          </div>
          <ul className="reps-roster">
            {[0, 1, 2, 3].map((i) => (
              <li key={i}>
                <span className="rep-card" aria-hidden="true">
                  <span className="rep-card-head">
                    <span className="skel" style={{ width: 34, height: 34, borderRadius: 999 }} />
                    <span className="rep-who">
                      <span className="skel" style={{ width: "72%", height: 14 }} />
                      <span className="skel mt-1" style={{ width: "48%", height: 11 }} />
                    </span>
                  </span>
                  <span className="rep-figs">
                    {[0, 1, 2].map((j) => (
                      <span key={j} className="rep-fig">
                        <span className="skel" style={{ width: "60%", height: 19 }} />
                        <span className="skel mt-1" style={{ width: "90%", height: 10 }} />
                      </span>
                    ))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <div className="card">
          <span className="skel" style={{ width: "36%", height: 14 }} />
          <span className="skel mt-2" style={{ width: "58%", height: 11 }} />
        </div>
      </div>
    );
  }

  if (loadedAt === null) {
    return (
      <div className="stack pt-2">
        <RepsMenu />
        <section>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">
            Reps
          </h1>
          <p className="t-sub mt-1" style={{ maxWidth: "52ch" }}>
            The team&rsquo;s week lives on the server and this device can&rsquo;t
            reach it right now. Nothing is lost &mdash; anything you record
            still saves and syncs when you&rsquo;re back.
          </p>
        </section>
        <button
          type="button"
          onClick={() => void attempt()}
          className="btn-secondary w-full"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="stack pt-2 mgr-home reps-board">
      <RepsMenu />
      <section data-desk="hero" data-span="full">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">
          Reps
        </h1>
        <p className="t-sub mt-1" style={{ maxWidth: "58ch" }}>
          {chosen
            ? `${chosen.rep_name} — ${chosen.territory_name ?? "no patch"}. What is owed, and which of their dealers is not selling yet.`
            : "Who is carrying what. Pick a name to read one patch; the work is done from here, not from somewhere else."}
        </p>
      </section>

      {/* THE ROSTER — the page's filter and its first reading at once. Each
          card says the three things a manager asks about a person: what they
          are waiting on, what is out for an answer, when they were last seen
          doing something. */}
      <section className="adapt" data-desk="roster" data-span={span("roster")}>
        <div className="section-head">
          <h2 className="t-section">The team</h2>
          {at && (
            <button type="button" className="t-action" onClick={() => setPick(null)}>
              Everyone
            </button>
          )}
        </div>
        {reps.length === 0 ? (
          <p className="t-sub">
            No active rep or manager is on the books yet.
          </p>
        ) : (
          <ul className="reps-roster">
            {reps.map((r) => {
              const on = r.membership_id === at;
              return (
                <li key={r.membership_id}>
                  <button
                    type="button"
                    className="rep-card"
                    data-on={on}
                    aria-pressed={on}
                    onClick={() => setPick(on ? null : r.membership_id)}
                  >
                    <span className="rep-card-head">
                      <span className="rep-mark" aria-hidden="true">
                        {avatarLetter(r.rep_name ?? "?")}
                      </span>
                      <span className="rep-who">
                        <span className="t-title">{r.rep_name ?? "—"}</span>
                        <span className="t-hint">
                          {r.territory_name ?? "No patch"}
                        </span>
                      </span>
                    </span>
                    <span className="rep-figs">
                      <span className="rep-fig">
                        <span
                          className="fig fig-md"
                          style={{
                            color:
                              r.overdue_next_actions > 0
                                ? "var(--danger)"
                                : undefined,
                          }}
                        >
                          {QTY.format(r.open_next_actions ?? 0)}
                        </span>
                        <span className="t-meta uppercase tracking-wide">
                          {r.overdue_next_actions > 0
                            ? `owed · ${r.overdue_next_actions} late`
                            : "owed"}
                        </span>
                      </span>
                      <span className="rep-fig">
                        <span className="fig fig-md">
                          {QTY.format(r.quotes_outstanding ?? 0)}
                        </span>
                        <span className="t-meta uppercase tracking-wide">
                          out for quote
                        </span>
                      </span>
                      <span className="rep-fig">
                        <span className="fig fig-md">
                          {QTY.format(r.activities_30d ?? 0)}
                        </span>
                        <span className="t-meta uppercase tracking-wide">
                          logged, 30d
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {/* The hole, stated. 45 of the 136 dealers sit under an admin rather
            than a rep, which is a leadership decision waiting to be made —
            and a number we can read ourselves rather than ask for. */}
        {!at && ownerless > 0 && (
          <p className="t-hint mt-2">
            {/* One expression, not a word stitched to a wrapped line: JSX
                trims the leading space of a text node that runs onto the next
                line, and "45 dealersare" is what that costs. */}
            {`${QTY.format(ownerless)} ${ownerless === 1 ? "dealer is" : "dealers are"} on nobody’s patch — they answer to an admin, so they appear in the book below but in no rep’s reading of it.`}
          </p>
        )}
      </section>

      {/* THE FOLLOW-UPS — moved off Sales (Andre, 2026-10-02: the Sales board
          is about sales; a promise is about a person). */}
      <FollowUps
        rows={myActions}
        who={chosen?.rep_name ?? null}
        everOne={actions.length > 0}
        span={span("followups")}
      />

      {/* GETTING DEALERS SELLING — the section that came across by name. */}
      {counts && (
        <div
          className="adapt"
          data-desk="gates"
          data-span={span("gates")}
          key={`gates-${at ?? "all"}`}
        >
          <RolloutTimeline
            counts={counts}
            heading={chosen ? "Getting their dealers selling" : "Getting dealers selling"}
            pkAccounts={pkAccounts}
            onPkCount={setPkCount}
            materialAccounts={materialAccounts}
            onMaterial={setMaterial}
            displayAccounts={displayAccounts}
            onDisplay={setDisplay}
          />
        </div>
      )}

      {counts === null && (
        <p className="t-sub">
          {at
            ? "No dealer is on this patch yet, so there is no rollout to read."
            : "No dealer account is on the books yet."}
        </p>
      )}
    </div>
  );
}

// ── What is still owed, and the two buttons that end it ─────────────────────
//
// A row is not ticked here. "Done is earned, not ticked" has been the rule
// since D45: a follow-up clears itself when the visit or the call is recorded
// against it, which is what "Log it" opens — /record carries the item id, so
// recording closes this exact promise rather than leaving a twin behind. The
// other button moves the date, because a promise that cannot be kept today is
// better re-booked than left to rot into an exception.
//
// The empty state is careful. Zero open follow-ups can mean two very different
// things, and reading one as the other is the kind of flattering lie this app
// does not tell: all of them cleared, or none was ever written. So it says
// which.
function FollowUps({
  rows,
  who,
  everOne,
  span,
}: {
  rows: readonly ActionRow[];
  who: string | null;
  everOne: boolean;
  span: string;
}) {
  const size = usePageSize(8, 5);
  const { slice, page, pages, from, setPage, total } = usePaged(rows, size);
  const late = rows.filter((r) => isLate(r.due_date)).length;

  return (
    <section
      className="adapt card quiet-col"
      data-desk="followups"
      data-span={span}
      key={`fu-${who ?? "all"}`}
    >
      <div className="quiet-head">
        <span className="t-title">Waiting on somebody</span>
        <span className="t-hint">
          {total === 0
            ? "nothing is owed right now"
            : `${QTY.format(total)} open${late > 0 ? ` · ${QTY.format(late)} past the date` : ""}${who ? ` · ${who}` : ""}`}
        </span>
      </div>

      {total === 0 ? (
        <p className="t-sub">
          {everOne
            ? "Everything that was promised here has been recorded."
            : "No follow-up has been written yet — nothing has been promised, which is not the same as nothing being owed. They appear here the moment a visit or a note sets a next step."}
        </p>
      ) : (
        <ul className="list">
          {slice.map((r) => (
            <li key={r.id}>
              <div className="row fu-row">
                <span className="row-body">
                  {r.account_id ? (
                    <Link href={`/accounts/${r.account_id}`} className="t-title fu-name">
                      {displayAccountName(r.accounts?.name ?? "—")}
                    </Link>
                  ) : (
                    <span className="t-title">No company on it</span>
                  )}
                  <span className="t-hint">{r.action}</span>
                </span>
                <span className="fu-side">
                  <span
                    className="sales-move"
                    data-dir={isLate(r.due_date) ? "down" : undefined}
                  >
                    {formatDay(r.due_date)}
                  </span>
                  <span className="fu-acts">
                    {/* The item id rides along so recording CLOSES this
                        promise instead of logging a stranger beside it. */}
                    <Link
                      href={
                        r.account_id
                          ? `/record?account=${r.account_id}&item=${r.id}`
                          : `/record?item=${r.id}`
                      }
                      className="fu-act"
                      title="Record what happened — that is what clears it"
                    >
                      <MicrophoneIcon size={14} />
                      Log it
                    </Link>
                    {r.account_id && (
                      <Link
                        href={`/visits?plan=${r.account_id}`}
                        className="fu-act"
                        title="Book it for a day you can keep"
                      >
                        <CalendarIcon size={14} />
                        Re-book
                      </Link>
                    )}
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <Pager
          page={page}
          pages={pages}
          from={from}
          shown={slice.length}
          total={total}
          onPage={setPage}
          className="fu-pager"
        />
      )}
    </section>
  );
}

/** Past the date, read against the local day — the same boundary the rest of
 *  the app's dates use. */
function isLate(due: string): boolean {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return due < iso;
}
