# Home Widgets + Routine List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Home as a widget grid (visits, routine to-do, attention, review, week), with the customer's routine list (samples/quotes/display walls) born and cleared through the voice debrief.

**Architecture:** The routine substrate is the existing `next_actions` table plus a new `kind` column; display checks are derived from `accounts.display_last_verified_at`. One `security_invoker` view serves the list online; a pure client-side builder reproduces it offline from the D56 working set. Debrief AI proposes dispositions/commitments that flow through the existing review gate (D9) and outbox (D10).

**Tech Stack:** Next.js 16 PWA, Supabase (Postgres + RLS, pgTAP), Dexie behind D55 interfaces, Vercel AI Gateway (`generateObject` + zod), vitest.

**Spec:** `docs/superpowers/specs/2026-07-29-home-widgets-routine-design.md`

## Global Constraints

- **No emojis anywhere** — UI and mockups use Hue icons (`src/components/icons.tsx`; add new icons via `npm run icons` if the set lacks one, else reuse).
- **No system jargon in UI copy** — no "PENDING", "pipeline", "sync", "error tray". Write in rep language (see `STATUS_LABEL` in `src/app/review/page.tsx` for tone).
- **Offline code never imports Dexie directly** — only `@/lib/offline` (ESLint enforces).
- **Nothing writes without the rep's OK** (D9); all writes ride the outbox (D10) via `getOfflineLayer().sync.enqueue(...)`.
- **SQL views are `security_invoker`; name EVERY column** in view DDL (unnamed `::text` columns collide in pgTAP).
- **Local migrations need explicit grants** (see `20260722001300_grants.sql` pattern) — new tables/views get `grant select` to `authenticated`.
- **pgTAP assertions must not sit inside savepoint-rollback scopes**; follow fixture patterns from `supabase/tests/07_exceptions.test.sql`.
- **Windows PowerShell**: multi-line commit messages via `git commit -F <file>` (here-strings with special chars silently fail).
- Gates: `npx supabase test db` (pgTAP), `npm test` (vitest), `npm run build`. Docker Desktop must be running for the local stack.

---

### Task 1: Routine schema — `kind`, capture linkage, `routine_items` view

**Files:**
- Create: `supabase/migrations/20260729000100_routine.sql`
- Test: `supabase/tests/09_routine.test.sql`

**Interfaces:**
- Produces: `next_actions.kind next_action_kind` (`'VISIT'|'SAMPLE_FOLLOW_UP'|'QUOTE_FOLLOW_UP'|'DISPLAY_CHECK'|'OTHER'`, nullable), `voice_captures.account_id uuid`, `voice_captures.planned_action_id uuid`, and view `routine_items(kind text, item_id uuid, org_id uuid, owner_membership_id uuid, account_id uuid, account_name text, action text, context_date date, due_date date)`. Org setting key `display_routine_months` (default 4).

- [ ] **Step 1: Write the failing pgTAP suite**

`supabase/tests/09_routine.test.sql` — follow the fixture prologue of `07_exceptions.test.sql` (same two-org seed, same role-switching helpers). Assertions:

```sql
begin;
select plan(12);

-- 1-3: schema
select has_column('public', 'next_actions', 'kind', 'next_actions has kind');
select has_column('public', 'voice_captures', 'account_id', 'captures link account');
select has_column('public', 'voice_captures', 'planned_action_id', 'captures link plan');

-- 4: backfill inference — seed rows in fixtures: one with objective (→VISIT),
-- one action 'Send sample pack' (→SAMPLE_FOLLOW_UP), one 'Chase quote'
-- (→QUOTE_FOLLOW_UP), one 'Call back' (→OTHER)
select results_eq(
  $$ select kind::text from next_actions where org_id = :'org_a' order by action $$,
  $$ values ('QUOTE_FOLLOW_UP'), ('OTHER'), ('SAMPLE_FOLLOW_UP'), ('VISIT') $$,
  'backfill inferred kinds');

-- 5-7: routine_items content (as rep role, set via request.jwt.claims like suite 07)
select is((select count(*) from routine_items where kind = 'SAMPLE_FOLLOW_UP')::int, 1, 'sample chore listed');
select is((select count(*) from routine_items where kind = 'DISPLAY_CHECK')::int, 1,
  'display unverified 5 months → routine (window 4, threshold 6)');
select is((select count(*) from routine_items where kind = 'VISIT')::int, 0, 'visits are not chores');

-- 8: escalation handoff — fixture next_action overdue past the
-- exception_overdue_follow_up threshold must NOT appear in routine_items
select is((select count(*) from routine_items where item_id = :'overdue_na')::int, 0,
  'escalated item leaves routine');

-- 9: display past 6 months lives in the exception, not routine
select is((select count(*) from routine_items
           where kind = 'DISPLAY_CHECK' and account_id = :'stale_display_acct')::int, 0,
  'display past threshold leaves routine');

-- 10-11: RLS scoping — rep sees own, other-org rep sees zero (suite 07 pattern)
-- 12: completed next_action absent
select * from finish();
rollback;
```

Write the real fixture inserts (accounts with `has_display_wall`, `display_last_verified_at` at 5 and 7 months ago; next_actions owned by the fixture rep with the four action texts; one overdue beyond `overdue_follow_up_days`).

- [ ] **Step 2: Run to verify it fails**

Run: `npx supabase test db`
Expected: suite 09 FAILS ("column kind does not exist").

- [ ] **Step 3: Write the migration**

```sql
-- Routine list (spec 2026-07-29): chores are next_actions with a kind;
-- display checks derive from accounts. Chores surface here BEFORE they
-- become exceptions — an escalated item leaves this view (one home rule).

create type next_action_kind as enum
  ('VISIT', 'SAMPLE_FOLLOW_UP', 'QUOTE_FOLLOW_UP', 'DISPLAY_CHECK', 'OTHER');

alter table next_actions add column kind next_action_kind;

update next_actions set kind = case
  when objective is not null then 'VISIT'::next_action_kind
  when action ~* 'sample'    then 'SAMPLE_FOLLOW_UP'::next_action_kind
  when action ~* 'quote'     then 'QUOTE_FOLLOW_UP'::next_action_kind
  when action ~* 'display'   then 'DISPLAY_CHECK'::next_action_kind
  else 'OTHER'::next_action_kind
end;

-- Debrief context: "How did it go?" pre-links the visit; dispositions need
-- the account known at processing time.
alter table voice_captures
  add column account_id uuid references accounts (id),
  add column planned_action_id uuid references next_actions (id);

create view routine_items
  (kind, item_id, org_id, owner_membership_id, account_id, account_name,
   action, context_date, due_date)
  with (security_invoker = true) as
-- chores from next_actions, minus escalated ones
select
  na.kind::text,
  na.id,
  na.org_id,
  na.owner_id,
  na.account_id,
  a.name,
  na.action,
  na.created_at::date,
  na.due_date
from next_actions na
left join accounts a on a.id = na.account_id
join organizations org on org.id = na.org_id
where na.completed_at is null
  and na.kind in ('SAMPLE_FOLLOW_UP', 'QUOTE_FOLLOW_UP', 'OTHER')
  and na.due_date >= current_date
    - make_interval(days => coalesce((org.settings ->> 'overdue_follow_up_days')::int, 7))
union all
-- display checks: inside the routine window, before the exception threshold
select
  'DISPLAY_CHECK'::text,
  a.id,
  a.org_id,
  a.owner_id,
  a.id,
  a.name,
  'Check the display wall'::text,
  a.display_last_verified_at::date,
  (a.display_last_verified_at
    + make_interval(months => coalesce((org.settings ->> 'display_verify_months')::int, 6)))::date
from accounts a
join organizations org on org.id = a.org_id
where a.has_display_wall
  and a.display_last_verified_at is not null
  and a.display_last_verified_at < now()
    - make_interval(months => coalesce((org.settings ->> 'display_routine_months')::int, 4))
  and a.display_last_verified_at >= now()
    - make_interval(months => coalesce((org.settings ->> 'display_verify_months')::int, 6));

grant select on routine_items to authenticated;
```

Check the exact overdue-exception predicate in `20260722001500_agenda_exceptions.sql` (view `exception_overdue_follow_up`, line ~34) and mirror its threshold key name exactly so the handoff has no gap and no overlap. Accounts with `display_last_verified_at is null` are already the exception's business (it treats null as never-verified) — routine skips them, matching test 9.

- [ ] **Step 4: Run suites**

Run: `npx supabase test db`
Expected: suite 09 PASSES; suites 01–08 still green (108+ tests).

- [ ] **Step 5: Apply to local stack and regenerate types**

Run: `npx supabase migration up` (local), then
`npx supabase gen types typescript --local > src/lib/database.types.ts`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260729000100_routine.sql supabase/tests/09_routine.test.sql src/lib/database.types.ts
git commit -m "feat(db): routine substrate - next_actions.kind, capture linkage, routine_items view"
```

---

### Task 2: Working set carries kind + routine settings

**Files:**
- Modify: `src/lib/offline/types.ts` (CachedAgendaItem, WorkingSet)
- Modify: `src/lib/offline/supabase-backend.ts` (pullWorkingSet)
- Modify: `src/lib/offline/local-store.dexie.ts` (only if the agenda table schema needs the new field declared — Dexie only indexes listed keys, extra fields store fine; touch only if an index is declared)
- Test: extend `src/lib/offline/__tests__` pull fixture

**Interfaces:**
- Consumes: `routine_items` view, `next_actions.kind` (Task 1).
- Produces: `CachedAgendaItem.kind: string | null`; `WorkingSet.settings: { display_routine_months: number; display_verify_months: number }`; `LocalStore.getMeta("org_settings")` JSON with the same shape.

- [ ] **Step 1: Extend the failing test** — in the existing pull/working-set vitest (`src/lib/offline/__tests__`), extend the fake backend's `pullWorkingSet` fixture with `kind: "SAMPLE_FOLLOW_UP"` on one agenda row and a `settings` object, and assert both round-trip through `putWorkingSet` → `getAgenda()` / `getMeta("org_settings")`.

```ts
it("caches agenda kind and org settings", async () => {
  await engine.pull();
  const agenda = await local.getAgenda();
  expect(agenda.find((a) => a.id === "na-sample")?.kind).toBe("SAMPLE_FOLLOW_UP");
  expect(JSON.parse((await local.getMeta("org_settings"))!)).toEqual({
    display_routine_months: 4,
    display_verify_months: 6,
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- offline` → FAIL (kind undefined).

- [ ] **Step 3: Implement**

`types.ts`: add `kind: string | null` to `CachedAgendaItem`; add `settings` to `WorkingSet`. In `supabase-backend.ts` `pullWorkingSet()`: add `kind` to the `next_actions` select; widen the agenda pull from the fortnight window to **all open next_actions** (`completed_at is null`, cap 200 ordered by `due_date`) so routine chores are cached regardless of horizon; read `organizations.settings` for the caller's org and map with the 4/6 defaults. In the sync engine's pull path, `setMeta("org_settings", JSON.stringify(ws.settings))`.

- [ ] **Step 4: Run tests pass** — `npm test -- offline` → PASS (all 12+ existing offline tests too).

- [ ] **Step 5: Commit** — `git commit -m "feat(offline): agenda kind + org routine settings join the working set"`

---

### Task 3: Routine builder (pure, offline-capable)

**Files:**
- Create: `src/lib/routine/items.ts`
- Test: `src/lib/routine/__tests__/items.test.ts`

**Interfaces:**
- Consumes: `CachedAgendaItem`, `CachedAccount` from `@/lib/offline`.
- Produces:

```ts
export interface RoutineItem {
  kind: "SAMPLE_FOLLOW_UP" | "QUOTE_FOLLOW_UP" | "DISPLAY_CHECK" | "OTHER";
  itemId: string;          // next_action id, or account id for display checks
  accountId: string | null;
  accountName: string;
  action: string;
  contextDate: string;     // ISO date the chore was born / last verified
  dueDate: string;
}
export interface RoutineSettings { display_routine_months: number; display_verify_months: number; overdue_follow_up_days: number }
export function buildRoutineItems(
  agenda: CachedAgendaItem[], accounts: CachedAccount[],
  settings: RoutineSettings, todayIso: string,
): RoutineItem[]
export function groupRoutine(items: RoutineItem[]): { kind: RoutineItem["kind"]; label: string; items: RoutineItem[] }[]
export function debriefWaiting(agenda: CachedAgendaItem[], todayIso: string): CachedAgendaItem[]
```

Labels: `SAMPLE_FOLLOW_UP` → "Samples to follow up", `QUOTE_FOLLOW_UP` → "Quotes to chase", `DISPLAY_CHECK` → "Display walls to check", `OTHER` → "Also on your list". Empty groups omitted. `buildRoutineItems` mirrors the view's rules exactly (open, non-VISIT kinds, not past the overdue window; display checks inside \[routine, verify) months). `debriefWaiting` = agenda items with `kind === "VISIT"`, `due_date < todayIso`, `completed_at === null`.

- [ ] **Step 1: Write failing tests** — fixtures covering: sample/quote grouped; VISIT excluded; completed excluded; overdue-past-window excluded (escalated); display at 5 months included, at 7 excluded, null excluded; `debriefWaiting` returns yesterday's unvisited visit and not today's; account name join falls back to "" when accountId is null.

```ts
const s = { display_routine_months: 4, display_verify_months: 6, overdue_follow_up_days: 7 };
it("escalated chores leave routine", () => {
  const agenda = [na({ id: "old", kind: "QUOTE_FOLLOW_UP", due_date: "2026-07-10" })];
  expect(buildRoutineItems(agenda, [], s, "2026-07-29")).toEqual([]);
});
```

- [ ] **Step 2: Run to verify fail** — `npm test -- routine` → FAIL (module not found).
- [ ] **Step 3: Implement** the two pure functions (date math with plain string comparison on ISO dates; months via `Date.setMonth` on `T00:00:00` anchors — the React-compiler lint bans `new Date()` in render paths, fine in lib code).
- [ ] **Step 4: Run tests pass** — `npm test -- routine` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(routine): pure builder mirrors routine_items for offline"`

---

### Task 4: Day list moves to /visits

**Files:**
- Create: `src/app/visits/page.tsx` (content of current `src/app/page.tsx`, moved)
- Modify: `src/app/page.tsx` (temporarily: `redirect("/visits")` — replaced in Task 6)
- Modify: `src/components/nav-bar.tsx` (screen title map gains "Visits")

**Interfaces:**
- Produces: route `/visits` rendering the existing agenda (grouped week view, plan-a-visit with required objective, mark-done). Query params consumed later: `/visits?plan=<accountId>&objective=MERCHANDISING_CHECK` opens the plan form prefilled (add ~8 lines reading `useSearchParams` to seed `planAccount`/`planObjective` and `setShowPlan(true)`).

- [ ] **Step 1: Move** — `git mv src/app/page.tsx src/app/visits/page.tsx`; create new `src/app/page.tsx` containing only `import { redirect } from "next/navigation"; export default function Home() { redirect("/visits"); }`.
- [ ] **Step 2: Wire the prefill params** in `visits/page.tsx` (read once on mount; guard invalid objective values against `VISIT_OBJECTIVES`).
- [ ] **Step 3: Verify** — `npm run dev`, open `/` (redirects to `/visits`, day list renders), `/visits?plan=<any-cached-account-id>&objective=MERCHANDISING_CHECK` (form open, fields seeded). `npm run build` green.
- [ ] **Step 4: Commit** — `git commit -m "refactor(ia): day list moves to /visits, one tap behind Home"`

---

### Task 5: Record accepts pre-links; captures carry account

**Files:**
- Modify: `src/app/record/page.tsx` (query params `?visit=<nextActionId>` and `?account=<accountId>&item=<nextActionId>`)
- Modify: `src/lib/domain/schemas.ts` (`voiceCaptureCreateSchema` gains `account_id`, `planned_action_id`, both nullable uuid)
- Test: extend the record-flow vitest if one exists; otherwise the schema test below

**Interfaces:**
- Consumes: `voice_captures.account_id` / `planned_action_id` columns (Task 1).
- Produces: voice capture outbox payloads carrying `account_id` + `planned_action_id`; Home and Routine can deep-link `/record?visit=…` / `/record?account=…&item=…`.

- [ ] **Step 1: Failing schema test** — in the schemas vitest: `voiceCaptureCreateSchema.parse({ ...existingFixture, account_id: uuid, planned_action_id: uuid })` passes and both survive; missing/null both fine. Run → FAIL.
- [ ] **Step 2: Implement** — extend the zod schema; in `record/page.tsx` read `useSearchParams`: `visit` resolves the agenda item from `getAgenda()` and preselects its account with the D46 link offered as already-on; `account`+`item` preselect account and stash `planned_action_id`. Both voice and typed paths include the two fields in the capture create payload.
- [ ] **Step 3: Tests pass; manual check** — `/record?visit=<id>` shows the account chip preselected. Commit: `git commit -m "feat(record): pre-linked debriefs - captures know their visit"`

---

### Task 6: The new Home

**Files:**
- Create: `src/app/home/home-client.tsx` (the widget grid component, ~200 lines)
- Modify: `src/app/page.tsx` (drop Task 4's redirect; render Home)
- Modify: `src/components/nav-bar.tsx` (title for `/` becomes "Home")

**Interfaces:**
- Consumes: `buildRoutineItems`, `groupRoutine`, `debriefWaiting`, `RoutineSettings` (Task 3); `useOffline()` for profile/status; `getOfflineLayer().local` for cache; exceptions fetch pattern from the old Today page (danger-tier only, reuse `DANGER_EXCEPTIONS`).
- Produces: Home per the approved mockup (`.superpowers/brainstorm/465-1785334473/content/home-c-final.html`): greeting + sync line, search field (inline filter over cached accounts/contacts, same behavior as the accounts page inline search — extract nothing, copy the ~20-line pattern), full-width Visits tile → `/visits`, four tiles (Routine → `/routine`, Needs attention → existing attention destination, Waiting your OK → `/review`, Visits this week → `/dashboard`), action row (Scan card → `/record?mode=card`, Voice note → `/record`, Accounts → `/accounts`, Add account → `/accounts/new`), Debrief waiting card → `/record?visit=<id>`.

Tile counts, all cache-first: visits = open `kind==="VISIT"` due within 14 days; routine = `buildRoutineItems(...).length` with kind breakdown subline; attention = danger-tier exception count (server fetch, cached count in meta `attention_count` for offline); review = Task 7's hook; week = visits completed/planned this week from cached agenda + activities. Use the existing tile/card CSS vocabulary (`card`, `card-pad`, tinted backgrounds via CSS vars) — check `src/app/globals.css` before inventing classes. Amber number on attention uses `var(--warn)`-family tokens if present, else the existing danger/attention pattern from the old Today.

- [ ] **Step 1: Build `home-client.tsx`** — structure:

```tsx
"use client";
// Home — the launcher: glance, then go. Counts come from the cache first so
// the screen is honest with no signal; server refresh fills in behind.
export default function HomeClient() {
  const { profile, status } = useOffline();
  const [agenda, setAgenda] = useState<CachedAgendaItem[]>([]);
  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [settings, setSettings] = useState<RoutineSettings>(DEFAULT_SETTINGS);
  const [attention, setAttention] = useState<number | null>(null);
  // load(): getAgenda/getAccounts/getMeta("org_settings"); then online-only:
  // danger exceptions count → setMeta("attention_count") — fall back to meta offline.
  const routine = useMemo(() => buildRoutineItems(agenda, accounts, settings, todayIso), [...]);
  const waiting = useMemo(() => debriefWaiting(agenda, todayIso), [...]);
  // render per the mockup; every count renders from state, no fetch-in-render
}
```

Greeting line: "Good morning/afternoon, {first name}" by local hour; sub-line reuses the sync badge's language for state ("all set to sync" / "N saves waiting for signal").

- [ ] **Step 2: Verify in browser** — dev server: Home renders with fixtures from the local stack; airplane mode (DevTools offline) still renders tiles from cache with the honest sub-line. **Hard-reload (ignoreCache) after offline-layer edits before trusting behavior** (Turbopack HMR stale-module gotcha).
- [ ] **Step 3: `npm run build`** green (service worker registers in prod only — already handled).
- [ ] **Step 4: Commit** — `git commit -m "feat(home): the launcher - widget grid over the rep's day"`

---

### Task 7: Review badge

**Files:**
- Create: `src/lib/review/count.ts`
- Modify: `src/components/tab-bar.tsx` (badge on Review tab)
- Modify: `src/app/review/page.tsx` (after each load, `setMeta("review_counts", JSON.stringify({captures, candidates}))`)
- Test: `src/lib/review/__tests__/count.test.ts`

**Interfaces:**
- Produces: `export async function reviewCount(local: LocalStore): Promise<number>` = `listRejected().length` + parsed `review_counts` meta (0 when absent); `useReviewCount()` hook subscribing to sync status changes + a 30s interval, used by both the tab badge and Home's "Waiting your OK" tile.

- [ ] **Step 1: Failing test** — fake LocalStore with 2 rejected + meta `{"captures":1,"candidates":3}` → `reviewCount` = 6; absent meta → 2. Run → FAIL.
- [ ] **Step 2: Implement** count fn + hook; badge in `tab-bar.tsx` as a small pill on the Review tab (`aria-label` includes the number; hidden when 0).
- [ ] **Step 3: Tests pass; visual check** both mobile tab bar and desktop rail. Commit: `git commit -m "feat(review): the tab shows what waits on you"`

---

### Task 8: Routine page

**Files:**
- Create: `src/app/routine/page.tsx`
- Modify: `src/components/nav-bar.tsx` (title "Routine")

**Interfaces:**
- Consumes: `buildRoutineItems` + `groupRoutine` (cache-first), `routine_items` view (online refresh, same shape mapped into `RoutineItem`).
- Produces: grouped list per the right-hand mockup panel. Row action by kind: `SAMPLE_FOLLOW_UP`/`QUOTE_FOLLOW_UP`/`OTHER` → "Record call" → `/record?account=<accountId>&item=<itemId>`; `DISPLAY_CHECK` → "Plan visit" → `/visits?plan=<accountId>&objective=MERCHANDISING_CHECK`. Footer line (rep language): "Recording the call or checking the wall clears these — nothing to tick."

- [ ] **Step 1: Build the page** — same load pattern as Home; groups render with `.p-h`-style section labels using existing list row classes; context line "sample sent {date}" / "quoted {date}" / "last checked {date}" via `relativizeDates` from `@/lib/format`.
- [ ] **Step 2: Verify** — seed a sample/quote/display fixture locally; rows deep-link correctly (tap through to Record with account preselected). Offline renders from cache.
- [ ] **Step 3: Commit** — `git commit -m "feat(routine): the customer's to-do list, grouped by chore"`

---

### Task 9: Debrief schema learns dispositions + commitments

**Files:**
- Modify: `src/lib/voice/draft.ts`
- Test: `src/lib/voice/__tests__/draft.test.ts` (create if absent)

**Interfaces:**
- Produces:

```ts
export const routineContextItem = z.object({ item_id: z.string(), kind: z.string(), action: z.string() });
// added to debriefDraftSchema:
routine_dispositions: z.array(z.object({
  item_id: z.string().describe("id of an open routine item explicitly addressed"),
  disposition: z.enum(["DONE", "DISPLAY_VERIFIED"]),
  note: z.string().nullable(),
})).describe("ONLY items the rep actually addressed; empty when none"),
// next_actions entries gain: kind: z.enum(["SAMPLE_FOLLOW_UP","QUOTE_FOLLOW_UP","VISIT","OTHER"]).nullable()
export function sanitizeDraft(draft: DebriefDraft, openItemIds: string[]): DebriefDraft
export function extractionPrompt(capturedAtIso: string, language: string, routineContext?: RoutineContextItem[]): string
```

`sanitizeDraft` drops any disposition whose `item_id` is not in `openItemIds` (the hallucination guard). The prompt, when context is present, appends: the open items as an id/kind/action list, with "Propose a disposition ONLY for items the rep explicitly mentioned. Never invent item ids." New commitments carry `kind` so the routine list gets them typed ("they asked for two samples" → two entries with `kind: "SAMPLE_FOLLOW_UP"`).

- [ ] **Step 1: Failing tests** — parse a draft with one valid + one fabricated `item_id`, `sanitizeDraft` keeps only the valid one; empty context → prompt has no routine section; commitments without kind still parse (nullable). Run → FAIL.
- [ ] **Step 2: Implement.** — schema + sanitize + prompt.
- [ ] **Step 3: Tests pass.** Commit: `git commit -m "feat(voice): debrief speaks routine - dispositions in, commitments out"`

---

### Task 10: Process route context + review fan-out

**Files:**
- Modify: `src/app/api/voice/process/route.ts` (fetch routine context, sanitize post-parse)
- Create: `src/lib/voice/fanout.ts` (pure op builder)
- Modify: `src/app/review/page.tsx` (render dispositions/commitments in the draft sheet; Send enqueues the ops)
- Test: `src/lib/voice/__tests__/fanout.test.ts`

**Interfaces:**
- Consumes: `voice_captures.account_id` (Task 5), `sanitizeDraft` + extended schema (Task 9), `routine_items` view (service client filtered to the capture's owner + account).
- Produces:

```ts
export interface DebriefOp { entityType: EntityType; op: "create" | "update"; payload: Record<string, unknown>; baseVersion: string | null }
export function buildRoutineOps(
  draft: DebriefDraft, accountId: string, ownerId: string, orgId: string,
  itemVersions: Record<string, string>,   // next_action id → updated_at (LWW base)
  accountVersion: string, nowIso: string,
): DebriefOp[]
```

Rules: `DONE` disposition → `next_action:update { id, completed_at: nowIso }` with that item's baseVersion; `DISPLAY_VERIFIED` → `account:update { id: accountId, display_last_verified_at: nowIso }` with accountVersion (emit at most one account update even if several display mentions); each commitment with a `kind` → `next_action:create` (client-minted UUID, org/owner/account/kind/action/due_date). Review page: dispositions render as pre-checked confirmations in the sheet ("Display wall checked — uncheck if not right"), unchecking removes the op; the existing Send path appends these ops to its fan-out (FIFO seq already guarantees the activity parent lands first; compensation per D62 unchanged).

Route change: after loading the capture, if `account_id` is set, service-client select from `routine_items` where `account_id` and `owner_membership_id` match the capture's owner; pass to `extractionPrompt`; after `generateObject`, run `sanitizeDraft` with those ids before storing `ai_draft`.

- [ ] **Step 1: Failing fanout tests** — draft with 1 DONE + 1 DISPLAY_VERIFIED + 2 sample commitments → ops: one next_action:update (correct baseVersion), one account:update, two next_action:create with kind SAMPLE_FOLLOW_UP and distinct client UUIDs; two DISPLAY_VERIFIED mentions → still one account update; no dispositions → only creates. Run → FAIL.
- [ ] **Step 2: Implement `fanout.ts`; tests pass.**
- [ ] **Step 3: Wire route + review sheet.** Typed-debrief E2E on local stack: capture against an account with an open sample follow-up + unverified display, transcript mentioning both → draft shows disposition confirmations → Send → DB: next_action completed, `display_last_verified_at` set, new next_actions rows present, Routine tile count dropped.
- [ ] **Step 4: `npm test` + `npx supabase test db` green. Commit:** `git commit -m "feat(debrief): the loop closes - routine cleared and born through the review gate"`

---

### Task 11: Add account form

**Files:**
- Create: `src/app/accounts/new/page.tsx`
- Modify: `src/app/accounts/page.tsx` (header "Add" button → `/accounts/new`)

**Interfaces:**
- Consumes: `accountCreateSchema` + `account:create` outbox path (already exercised by the card flow — read the create branch of the card confirm sheet in `src/app/review/page.tsx` and reuse its payload construction exactly, including the referral `account_relationships` fan-out and lead-source rules).
- Produces: standalone create form — name (helper text: brand + city, e.g. "Ganahl Anaheim"), account type, lead source (full list incl. referrals; referral selection reveals a required referring-account picker over cached accounts), optional city/champion note. Enqueues through the outbox; works offline; new account appears in the cached list optimistically.

- [ ] **Step 1: Build the form** (reuse the card sheet's field components/classes; Zod-validate before enqueue; referral without referring account blocks submit with rep-language copy "Who sent them your way? Referrals need the referring account.").
- [ ] **Step 2: Verify** — create online + airplane-mode create (syncs on reconnect, exactly-once); referral creates the relationship row; D7 constraint satisfied (check DB).
- [ ] **Step 3: Commit** — `git commit -m "feat(accounts): add account from Home - the form the card reader was hiding"`

---

### Task 12: Gates + persona walk

**Files:** none new — verification only. Use superpowers:verification-before-completion.

- [ ] **Step 1: Full gates** — `npm test`, `npx supabase test db`, `npm run lint`, `npm run build`. All green, no skips.
- [ ] **Step 2: Persona walk (production build, local stack)** — as rep Marcus: morning glance (tiles honest) → plan a visit from /visits → Routine: record a sample call (pre-linked) → How did it go? on yesterday's visit → voice/typed debrief → review sheet dispositions → Send → Home counts moved. Airplane-mode pass: Home renders, search works, badge shows, add-account queues. Screenshot each screen — **look at the visuals, not just the a11y tree** (charts/tiles have rendered-broken-but-snapshot-fine history).
- [ ] **Step 3: Update session state** — add the feature block to `00-PROJECT-CONTEXT.md` session state; note the two new org settings and the `next_actions.kind` proposal in `supabase/README.md` pending-decisions list.
- [ ] **Step 4: Commit** — `git commit -m "feat(home): widget Home + Routine list, walked as the persona"`

---

## Self-review notes

- **Spec coverage:** Home grid → T6; routine data/view → T1–T3; lifecycle escalation → T1 (view) + T3 (builder); debrief both directions → T9–T10; add account → T11; badge → T7; offline → T2/T3/T6/T8; testing → per-task + T12. Day-list relocation → T4; "How did it go?" pre-link → T5. PK/TJ-mode/manual-todos explicitly out of scope.
- **Type consistency:** `RoutineItem.itemId` (client) vs `routine_items.item_id` (SQL) — mapping happens in T8's online refresh; `kind` string values identical across enum, zod, and builder.
- **Known judgment calls for the implementer:** exact threshold key `overdue_follow_up_days` must be read from the existing exception view (T1 step 3 says mirror it); if `globals.css` lacks an amber token, reuse the attention-tier styling from the old Today rather than inventing one.
