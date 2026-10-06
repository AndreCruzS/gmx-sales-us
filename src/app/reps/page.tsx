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
import { AgendaCalendar } from "@/components/agenda-calendar";
import { useOffline } from "@/components/offline-provider";
import { CalendarIcon, MicrophoneIcon } from "@/components/icons";
import { Pager, usePaged, usePageSize } from "@/components/pager";
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
import { humanize } from "@/lib/domain/enums";
import {
  ACTIVE_QUOTE_STAGES,
  isOverdue,
  quoteStageLabel,
  sortQuotes,
  totalValue,
} from "@/lib/domain/quotes";
import { manages } from "@/lib/domain/roles";
import { displayAccountName, formatDay, formatMoney } from "@/lib/format";
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
  /** VISIT is the agenda; anything else is a promise. null is a row the
   *  trigger has not classified yet, read as a visit — the Agenda's rule. */
  kind: string | null;
  objective: string | null;
  accounts: { name: string } | null;
}

interface QuoteRow {
  id: string;
  name: string;
  stage: string;
  estimated_revenue: number | null;
  expected_close_date: string | null;
  updated_at: string | null;
  owner_id: string;
  primary_account_id: string;
  account: { name: string } | null;
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
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  // Stamped when the data lands, never read during a render.
  const [todayIso, setTodayIso] = useState("");
  const [gates, setGates] = useState<GateRow[]>([]);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [walls, setWalls] = useState<WallRow[]>([]);
  const [pick, setPick] = useState<Pick>(undefined);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [sc, na, qt, gs, ev, dw] = await Promise.all([
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
        .select("id, action, due_date, owner_id, account_id, kind, objective, accounts(name)")
        .is("completed_at", null)
        .order("due_date")
        .limit(1000),
      // THE QUOTES, as the Quotes page defines them: a price is out and no
      // answer is back. The embed names its constraint because opportunities
      // reaches accounts by half a dozen columns.
      supabase
        .from("opportunities")
        .select(
          "id, name, stage, estimated_revenue, expected_close_date, updated_at, owner_id, primary_account_id, account:accounts!opportunities_primary_account_id_fkey(name)",
        )
        .in("stage", ACTIVE_QUOTE_STAGES as unknown as string[])
        .limit(500),
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
    setQuotes(qt.error ? [] : ((qt.data as unknown as QuoteRow[]) ?? []));
    setGates(gs.error ? [] : ((gs.data as unknown as GateRow[]) ?? []));
    setEvidence(ev.error ? [] : ((ev.data as unknown as EvidenceRow[]) ?? []));
    setWalls(dw.error ? [] : ((dw.data as unknown as WallRow[]) ?? []));
    setTodayIso(isoToday());
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
  // THE AGENDA AND THE PROMISES are one table told apart by kind: a visit is
  // on the calendar, everything else is owed. Both come back soonest first.
  const visits = useMemo(
    () => myActions.filter((a) => a.kind === "VISIT" || a.kind === null),
    [myActions],
  );
  const owed = useMemo(
    () => myActions.filter((a) => a.kind !== "VISIT" && a.kind !== null),
    [myActions],
  );
  // Read against the day the data landed on, like the quotes — never
  // Date.now() inside a render.
  const missed = useMemo(
    () => (todayIso ? visits.filter((v) => v.due_date < todayIso).length : 0),
    [visits, todayIso],
  );
  const soon = useMemo(() => {
    if (!todayIso) return 0;
    const horizon = new Date(`${todayIso}T00:00:00`);
    horizon.setDate(horizon.getDate() + 14);
    const until = isoOf(horizon);
    return visits.filter((v) => v.due_date >= todayIso && v.due_date <= until).length;
  }, [visits, todayIso]);
  const owedLate = useMemo(
    () => (todayIso ? owed.filter((o) => o.due_date < todayIso).length : 0),
    [owed, todayIso],
  );
  const everOne = actions.length > 0;

  const myQuotes = useMemo(
    () => sortQuotes(at ? quotes.filter((q) => q.owner_id === at) : quotes, todayIso),
    [quotes, at, todayIso],
  );
  const quotesLate = useMemo(
    () => (todayIso ? myQuotes.filter((q) => isOverdue(q, todayIso)).length : 0),
    [myQuotes, todayIso],
  );

  // WHAT IS ON EACH PLATE — the one figure a chip can carry (the Sales
  // board's "Slipping 4" idiom). With the roster cards gone (Andre,
  // 2026-10-06: the filter row made them redundant) this is where the team
  // is still compared at a glance: open visits, promises and quotes, by rep.
  const plate = useMemo(() => {
    const m = new Map<string, number>();
    const add = (id: string) => m.set(id, (m.get(id) ?? 0) + 1);
    for (const a of actions) add(a.owner_id);
    for (const q of quotes) add(q.owner_id);
    return m;
  }, [actions, quotes]);

  /** membership_id → name, for the caption on a row while everyone is read. */
  const names = useMemo(
    () => new Map(reps.map((r) => [r.membership_id, r.rep_name] as const)),
    [reps],
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
    // The week first and whole; the promises and the quotes share a line.
    const want: { k: string; w: DeskWidth }[] = [
      { k: "agenda", w: "full" },
      { k: "followups", w: "narrow" },
      { k: "quotes", w: "narrow" },
    ];
    if (counts) want.push({ k: "gates", w: "full" });
    return spanner(packDesk(want));
  }, [counts]);

  // SHAPE WITHOUT VALUES — the same rule home-skeleton.tsx sets out: blocks
  // where the figures will be, never a zero standing in for an unknown.
  if (loadedAt === null && !loadFailed) {
    return (
      <div className="stack pt-2" aria-busy="true">
        <section>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">
            Reps
          </h1>
          <span className="skel mt-2" style={{ width: "70%", height: 13 }} />
        </section>
        {/* The filter row, the three figures, the week: the shape the page
            takes, drawn before its numbers. */}
        <section>
          <div className="chip-row" aria-hidden="true">
            {[88, 120, 110, 112, 104].map((w, i) => (
              <span key={i} className="skel" style={{ width: w, height: 36, borderRadius: 999 }} />
            ))}
          </div>
        </section>
        <section>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className="card card-pad block">
                <span className="skel" style={{ width: "40%", height: 10 }} />
                <span className="skel mt-2" style={{ width: "30%", height: 28 }} />
                <span className="skel mt-2" style={{ width: "60%", height: 11 }} />
              </span>
            ))}
          </div>
        </section>
        <section>
          <span className="skel" style={{ width: "100%", height: 220 }} />
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
      <section data-desk="hero" data-span="full">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">
          Reps
        </h1>
        <p className="t-sub mt-1" style={{ maxWidth: "58ch" }}>
          {chosen
            ? `${chosen.rep_name} — ${chosen.territory_name ?? "no patch"}. Their agenda, what they are owed, what is out for a price, and which of their dealers is not selling yet.`
            : "The team, its agenda, its promises and its quotes on one screen. Pick a name to read one patch; the work is done from here, not from somewhere else."}
        </p>
      </section>

      {/* THE FILTER ROW GOVERNS THE WHOLE PAGE — the Sales board's rule
          (Andre, 2026-09-04), and this board is built to its shape (Andre,
          2026-10-06: "primeiro a visão geral … e depois podemos filtrar").
          Everyone first, then the names; whatever is pressed scopes every
          tile and every list beneath it. */}
      <section className="adapt sales-filters" data-desk="filters">
        <div className="chip-row mb-3" role="group" aria-label="Whose work">
          <button
            type="button"
            className="chip"
            aria-pressed={at === null}
            onClick={() => setPick(null)}
          >
            Everyone
          </button>
          {reps.map((r) => (
            <button
              key={r.membership_id}
              type="button"
              className="chip"
              aria-pressed={r.membership_id === at}
              onClick={() => setPick(r.membership_id)}
            >
              {r.rep_name}
              {(plate.get(r.membership_id) ?? 0) > 0 && (
                <span className="chip-count">
                  {QTY.format(plate.get(r.membership_id) ?? 0)}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* THE THREE FIGURES a manager asks about the work, for the scope the
          row above set: what is on the calendar, what is owed, what is out
          for a price. Each one is the headline of the list below it. */}
      <section className="adapt" data-desk="tiles" key={`tiles-${at ?? "all"}`}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="card card-pad">
            <div className="t-meta uppercase tracking-wide">Visits planned</div>
            <div className="fig fig-xl mt-1">{QTY.format(visits.length)}</div>
            <div className="t-hint mt-0.5">
              {visits.length === 0
                ? "nothing on the calendar"
                : `${QTY.format(soon)} in the next 14 days${missed > 0 ? ` · ${QTY.format(missed)} missed` : ""}`}
            </div>
          </div>
          <div className="card card-pad">
            <div className="t-meta uppercase tracking-wide">Owed</div>
            <div
              className="fig fig-xl mt-1"
              style={{ color: owedLate > 0 ? "var(--danger)" : undefined }}
            >
              {QTY.format(owed.length)}
            </div>
            <div className="t-hint mt-0.5">
              {owed.length === 0
                ? "no promise waiting"
                : owedLate > 0
                  ? `${QTY.format(owedLate)} past the date`
                  : "all still inside their dates"}
            </div>
          </div>
          <div className="card card-pad">
            <div className="t-meta uppercase tracking-wide">Out for quote</div>
            <div className="fig fig-xl mt-1">{QTY.format(myQuotes.length)}</div>
            <div className="t-hint mt-0.5">
              {myQuotes.length === 0
                ? "no price in anybody’s hands"
                : `${formatMoney(Math.round(totalValue(myQuotes)))} out${quotesLate > 0 ? ` · ${QTY.format(quotesLate)} past the close date` : ""}`}
            </div>
          </div>
        </div>
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

      {/* THE TEAM'S WEEK, up front (Andre, 2026-10-06): the wall itself, not
          a list about it — the month one click away. The chip row above is
          its filter, so the calendar's own rail is off. Nothing is booked
          from here yet: that arrives with the team's Google Calendar. */}
      <section
        className="adapt"
        data-desk="agenda"
        data-span={span("agenda")}
        key={`agenda-${at ?? "all"}`}
      >
        <AgendaCalendar
          bump={0}
          onError={() => undefined}
          defaultView="week"
          owner={at}
          extra={
            <Link href="/visits?plan=new" className="btn-quiet">
              Plan a visit
            </Link>
          }
        />
      </section>

      {/* THE PROMISES — moved off Sales (Andre, 2026-10-02: the Sales board
          is about sales; a promise is about a person). A visit is not one of
          these: it is on the agenda above. */}
      <PromiseList
        desk="followups"
        title="Waiting on somebody"
        rows={owed}
        who={chosen?.rep_name ?? null}
        names={names}
        hint={
          owed.length === 0
            ? "nothing is owed right now"
            : `${QTY.format(owed.length)} open${owedLate > 0 ? ` · ${QTY.format(owedLate)} past the date` : ""}${chosen ? ` · ${chosen.rep_name}` : ""}`
        }
        empty={
          everOne
            ? "Everything that was promised here has been recorded."
            : "No follow-up has been written yet — nothing has been promised, which is not the same as nothing being owed. They appear here the moment a visit or a note sets a next step."
        }
        span={span("followups")}
      />

      {/* THE QUOTES — every price in a customer's hands, the one past its
          close date first. The quote is a reason to open the account, not a
          place to sit, so the row opens the account. */}
      <QuoteList
        rows={myQuotes}
        who={chosen?.rep_name ?? null}
        names={names}
        todayIso={todayIso}
        late={quotesLate}
        span={span("quotes")}
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

// ── A list of promises, and the two buttons that end one ────────────────────
//
// The agenda and the follow-ups are the same row: something somebody said
// they would do, against a dealer, by a date. One component, two headings.
//
// A row is not ticked here. "Done is earned, not ticked" has been the rule
// since D45: a follow-up clears itself when the visit or the call is recorded
// against it, which is what "Log it" opens — /record carries the item id, so
// recording closes this exact promise rather than leaving a twin behind. The
// other button moves the date, because a promise that cannot be kept today is
// better re-booked than left to rot into an exception.
//
// The empty state is careful. Zero open rows can mean two very different
// things, and reading one as the other is the kind of flattering lie this app
// does not tell: all of them cleared, or none was ever written. The caller
// says which.
function PromiseList({
  desk,
  title,
  rows,
  who,
  names,
  hint,
  empty,
  more,
  span,
}: {
  desk: string;
  title: string;
  rows: readonly ActionRow[];
  who: string | null;
  names: ReadonlyMap<string, string>;
  hint: string;
  empty: string;
  more?: { href: string; label: string };
  span: string;
}) {
  const size = usePageSize(8, 5);
  const { slice, page, pages, from, setPage, total } = usePaged(rows, size);

  return (
    <section
      className="adapt card quiet-col"
      data-desk={desk}
      data-span={span}
      key={`${desk}-${who ?? "all"}`}
    >
      <div className="quiet-head">
        <span className="t-title">{title}</span>
        <span className="t-hint">
          {hint}
          {more && (
            <>
              {" · "}
              <Link href={more.href} className="t-action">
                {more.label}
              </Link>
            </>
          )}
        </span>
      </div>

      {total === 0 ? (
        <p className="t-sub">{empty}</p>
      ) : (
        <ul className="list">
          {slice.map((r) => {
            const rep = names.get(r.owner_id);
            // What the row is about, in the rep's words: the objective they
            // booked it with, or the action as it was written.
            const what = r.objective ? humanize(r.objective) : r.action;
            return (
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
                    <span className="t-hint">
                      {what}
                      {/* Whose, only while the whole team is on screen: under
                          one name every row is theirs. */}
                      {who === null && rep ? ` · ${rep}` : ""}
                    </span>
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
            );
          })}
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

// ── Every price in a customer's hands ────────────────────────────────────────
//
// The same definition of "a quote" the Quotes page uses — an opportunity at
// QUOTE or DECISION, because a price is out and no answer is back — and the
// same order: past its close date first, then by date, the undated last. A
// quote with no close date is not urgent, it is unmanaged.
function QuoteList({
  rows,
  who,
  names,
  todayIso,
  late,
  span,
}: {
  rows: readonly QuoteRow[];
  who: string | null;
  names: ReadonlyMap<string, string>;
  todayIso: string;
  late: number;
  span: string;
}) {
  const size = usePageSize(8, 5);
  const { slice, page, pages, from, setPage, total } = usePaged(rows, size);

  return (
    <section
      className="adapt card quiet-col"
      data-desk="quotes"
      data-span={span}
      key={`quotes-${who ?? "all"}`}
    >
      <div className="quiet-head">
        <span className="t-title">Out for quote</span>
        <span className="t-hint">
          {total === 0
            ? "no price in anybody’s hands"
            : `${QTY.format(total)} open · ${formatMoney(Math.round(totalValue(rows)))}${late > 0 ? ` · ${QTY.format(late)} past the close date` : ""}${who ? ` · ${who}` : ""}`}
          {" · "}
          <Link href="/quotes" className="t-action">
            All quotes
          </Link>
        </span>
      </div>

      {total === 0 ? (
        <p className="t-sub">
          Nothing out for quote. When a deal reaches a price, it lands here.
        </p>
      ) : (
        <ul className="list">
          {slice.map((r) => {
            const over = isOverdue(r, todayIso);
            const rep = names.get(r.owner_id);
            return (
              <li key={r.id}>
                <div className="row fu-row">
                  <span className="row-body">
                    <Link href={`/accounts/${r.primary_account_id}`} className="t-title fu-name">
                      {r.name}
                    </Link>
                    <span className="t-hint">
                      {r.account ? displayAccountName(r.account.name) : "Account"}
                      {who === null && rep ? ` · ${rep}` : ""}
                      {" · "}
                      {quoteStageLabel(r.stage)}
                    </span>
                  </span>
                  <span className="fu-side">
                    <span className="sales-move" data-dir={over ? "down" : undefined}>
                      {r.expected_close_date
                        ? `${over ? "was due" : "closes"} ${formatDay(r.expected_close_date)}`
                        : "no close date"}
                    </span>
                    <span className="fig fig-md">{formatMoney(r.estimated_revenue)}</span>
                  </span>
                </div>
              </li>
            );
          })}
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
  return due < isoToday();
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoToday(): string {
  return isoOf(new Date());
}
