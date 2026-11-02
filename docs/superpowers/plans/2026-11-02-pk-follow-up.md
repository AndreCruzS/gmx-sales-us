# PK follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/dealers/pk`, the PK follow-up board: one band per PK visit, Eisenhower priority with an alert date, two statuses, an append-only notes log, per-user read receipts, subtasks counting in the PK %, and an Excel export.

**Architecture:** Three migrations extend `next_actions` (priority, two statuses, who changed them last, a trigger keeping `completed_at` in sync) and add four child tables (notes, note versions, reads, subtasks) whose RLS defers to the parent item. The rules (alert date, alert passed, band %, unread, summary) are pure functions in `src/lib/domain/pk-follow-up.ts`. The board is a client page like `/dealers`, reading through `fetchAllPages`; item field changes ride the offline outbox (`next_action:update`), notes/subtasks/reads go straight to Supabase (desk, online).

**Tech Stack:** Next.js App Router, Supabase (Postgres, RLS, pgTAP), zod + offline outbox, vitest, `write-excel-file` (dynamic import).

**Spec:** `docs/superpowers/specs/2026-11-02-pk-follow-up-design.md` · Mockup: https://claude.ai/artifact/R1KJ8Lv95dS2XygNQb6SX2 (layout reference; copy its labels).

## Global Constraints

- All UI copy in English. Desktop target; the page must not break on a phone.
- A PK item = a `next_actions` row whose `activity_id` points at an `activities` row with `activity_type = 'PK_TRAINING'`. Nothing in this plan changes items that are not PK items, except the generic `completed_at` ↔ `progress` sync trigger.
- Default days: `DO_NOW` 1, `PLAN` 7, `DELEGATE` 2, `ELIMINATE` none.
- Alert date = PK date (local calendar date of `occurred_at`) + `priority_days`, written into `due_date`.
- Labels: Action required `PENDING_ACTION` "Pending action" · `AWAITING_RESPONSE` "Awaiting response" · `NONE` "—"; Status `NOT_STARTED` "Not started" · `WORKING_ON_IT` "Working on it" · `STUCK` "Stuck" · `DONE` "Done"; Priority `DO_NOW` "Do now" · `PLAN` "Plan" · `DELEGATE` "Delegate" · `ELIMINATE` "Eliminate".
- Every list read goes through `fetchAllPages` with a deterministic `order`. Embeds of accounts from `next_actions` name `accounts!next_actions_account_id_fkey`.
- Colours come from tokens in `src/app/globals.css`; add new tokens there (light + dark) for the status cells. Figures in `--font-fig`; terminal mono only for `.paste-box`.
- Migrations are applied to production later with `npx supabase db query --linked -f <file>` + `migration repair --status applied`; never `db push`. Do not touch production in any task.
- `npm test`, `npm run db:test`, `npx tsc --noEmit` and `npm run lint` stay green after every task.

## Review Focus

1. **Done from another screen.** Home marks a PK item done (sets `completed_at` only). Expected: progress reads `DONE` on the board. Test in Task 1.
2. **Eliminate then un-eliminate.** Expected: Eliminate closes the item (`completed_at` set, days null); switching to Plan reopens it unless progress is `DONE`. Test in Task 1.
3. **My own change is not "new".** I change a status, then reload. Expected: not unread for me, unread for the other admin. Test in Task 4.
4. **Band with an Eliminate item and an item with no subtasks.** Expected: Eliminate excluded; the subtask-less item counts as one unit. Test in Task 4.
5. **Note edited twice.** Expected: two rows in versions, the note shows the last text and "edited"; a delete is refused. Test in Task 2.

---

### Task 1: Migration — priority and the two statuses

**Files:**
- Create: `supabase/migrations/20261102120000_pk_priority_status.sql`
- Create: `supabase/tests/28_pk_priority_status.test.sql`
- Modify: `src/lib/database.types.ts` (regenerated), `src/lib/domain/schemas.ts`, `src/lib/domain/__tests__/schemas.test.ts`

**Interfaces:**
- Produces: enums `next_action_priority` (`DO_NOW | PLAN | DELEGATE | ELIMINATE`), `next_action_required` (`PENDING_ACTION | AWAITING_RESPONSE | NONE`), `next_action_progress` (`NOT_STARTED | WORKING_ON_IT | STUCK | DONE`); columns `priority null`, `priority_days int null check (priority_days >= 0)`, `action_required not null default 'NONE'`, `progress not null default 'NOT_STARTED'`, `last_changed_by uuid null references memberships(id)`, `last_changed_at timestamptz null`.
- `nextActionUpdateSchema` gains optional `priority` (nullable), `priority_days` (int ≥ 0, nullable), `action_required`, `progress`.

Trigger (before insert or update, named to sort after the existing ones, e.g. `zz_sync_next_action_progress`):
- progress changed to `DONE` → `completed_at := coalesce(completed_at, now())`.
- progress changed away from `DONE` and priority is not `ELIMINATE` → `completed_at := null`.
- `completed_at` changed from null to a value and progress not `DONE` and priority not `ELIMINATE` → `progress := 'DONE'`. From a value to null → if progress is `DONE`, `progress := 'NOT_STARTED'`.
- priority changed to `ELIMINATE` → `completed_at := coalesce(completed_at, now())`, `priority_days := null`. Changed away from `ELIMINATE` → `completed_at := null` unless progress is `DONE`.
- Any of priority, priority_days, action_required, progress changed (or set non-default on insert) → `last_changed_by := private.active_membership_id()` (keep the supplied value when that is null), `last_changed_at := now()`.
- Backfill: existing rows with `completed_at` not null get `progress = 'DONE'`, with `set_updated_at` disabled around the update (same pattern as `20261030120000_dealer_items.sql`).

- [ ] **Step 1:** Write `28_pk_priority_status.test.sql` covering: column defaults; a completed backfilled row reads `DONE`; progress→DONE sets completed_at; `completed_at` set alone → progress `DONE` (Review Focus 1); ELIMINATE sets completed_at and nulls days, back to PLAN clears completed_at, back to PLAN with progress DONE keeps it (Review Focus 2); changing action_required as a seeded admin stamps `last_changed_by` with that membership; `priority_days = -1` throws `23514`.
- [ ] **Step 2:** `npm run db:test` → 28 fails.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npm run db:reset && npm run db:test` → all pass.
- [ ] **Step 5:** `npm run db:types`; extend `nextActionUpdateSchema` with a schemas test that a patch `{id, priority: "DELEGATE", priority_days: 2, due_date, action_required: "AWAITING_RESPONSE", progress: "STUCK"}` survives parsing intact and `priority_days: -1` fails. `npm test`, `npx tsc --noEmit` pass.
- [ ] **Step 6:** Commit `feat(pk): next_actions carry a priority, an action-required and a progress`.

### Task 2: Migration — append-only notes

**Files:**
- Create: `supabase/migrations/20261102130000_next_action_notes.sql`
- Create: `supabase/tests/29_next_action_notes.test.sql`
- Modify: `src/lib/database.types.ts` (regenerated)

**Interfaces:**
- Produces: `next_action_notes(id uuid pk default gen_random_uuid(), org_id uuid not null references organizations, next_action_id uuid not null references next_actions on delete cascade, author_id uuid not null references memberships, body text not null check (length(btrim(body)) > 0), created_at timestamptz not null default now(), edited_at timestamptz null)`, index on `(next_action_id, created_at)`; `next_action_note_versions(id uuid pk, note_id uuid not null references next_action_notes on delete cascade, body text not null, replaced_at timestamptz not null default now())`.

Decisions:
- Before-insert trigger: `author_id := private.active_membership_id()` when a member is signed in (client value ignored); `created_at := now()`, `edited_at := null`.
- Before-update trigger: only `body` may change (author_id, next_action_id, org_id, created_at kept from old); when body changes, insert old body into versions and set `edited_at := now()`. The versions insert runs `security definer` with `set search_path = ''`.
- RLS on notes: select/insert where `org_id = jwt_org_id()`, active member, and `exists (select 1 from public.next_actions n where n.id = next_action_id)`; update only where `author_id = private.active_membership_id()`; no delete policy. Versions: select through the same parent check (join notes); no insert/update/delete policies.

- [ ] **Step 1:** Write `29_next_action_notes.test.sql`: a member who can see the item adds a note and `author_id` is them even if another id was sent; another member's update affects 0 rows; the author edits twice → 2 version rows and `edited_at` set (Review Focus 5); delete affects 0 rows; a rep who cannot see the parent item reads 0 notes; an empty body throws.
- [ ] **Step 2:** `npm run db:test` → 29 fails.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npm run db:reset && npm run db:test` → pass; `npm run db:types`; `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(pk): an append-only notes log per item`.

### Task 3: Migration — read receipts and subtasks

**Files:**
- Create: `supabase/migrations/20261102140000_next_action_reads_subtasks.sql`
- Create: `supabase/tests/30_next_action_reads_subtasks.test.sql`
- Modify: `src/lib/database.types.ts` (regenerated)

**Interfaces:**
- Produces: `next_action_reads(org_id uuid not null, membership_id uuid not null references memberships, next_action_id uuid not null references next_actions on delete cascade, last_read_at timestamptz not null default now(), primary key (membership_id, next_action_id))`; `next_action_subtasks(id uuid pk default gen_random_uuid(), org_id uuid not null, next_action_id uuid not null references next_actions on delete cascade, title text not null check (length(btrim(title)) > 0), done_at timestamptz null, position int not null default 0, created_by uuid references memberships, created_at timestamptz not null default now())`, index on `(next_action_id, position)`.
- Client upsert for a read: `supabase.from("next_action_reads").upsert({org_id, membership_id: me, next_action_id, last_read_at: new Date().toISOString()}, {onConflict: "membership_id,next_action_id"})`.

Decisions:
- Reads RLS: select where org matches and the parent item is visible; insert/update only where `membership_id = private.active_membership_id()`; no delete.
- Subtasks RLS: select where the parent is visible; insert/update/delete where the parent is visible AND the member may update it (admin, or owner in `visible_membership_ids()` — same predicate as `next_actions_update`). `created_by` stamped by trigger.

- [ ] **Step 1:** Write `30_next_action_reads_subtasks.test.sql`: a member upserts their own read; writing a read for another membership throws `42501`; an admin reads both members' reads for the item; a rep who cannot see the parent reads 0 subtasks and cannot insert one; an admin adds, ticks (`done_at`) and deletes a subtask.
- [ ] **Step 2:** `npm run db:test` → 30 fails.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npm run db:reset && npm run db:test` → pass; `npm run db:types`; `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(pk): who has read an item, and its subtasks`.

### Task 4: PK follow-up rules (pure)

**Files:**
- Create: `src/lib/domain/pk-follow-up.ts`
- Test: `src/lib/domain/__tests__/pk-follow-up.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PRIORITIES = ["DO_NOW", "PLAN", "DELEGATE", "ELIMINATE"] as const;
  export type Priority = (typeof PRIORITIES)[number];
  export const DEFAULT_DAYS: Record<Priority, number | null>; // 1, 7, 2, null
  export const PRIORITY_LABEL, REQUIRED_LABEL, PROGRESS_LABEL: Record<…, string>; // Global Constraints labels
  export type Required = "PENDING_ACTION" | "AWAITING_RESPONSE" | "NONE";
  export type Progress = "NOT_STARTED" | "WORKING_ON_IT" | "STUCK" | "DONE";

  export interface PkItem {
    id: string; action: string; owner_id: string; due_date: string;
    completed_at: string | null; priority: Priority | null; priority_days: number | null;
    action_required: Required; progress: Progress;
    last_changed_by: string | null; last_changed_at: string | null;
  }
  export interface PkNote { id: string; next_action_id: string; author_id: string; body: string; created_at: string; edited_at: string | null }
  export interface PkSubtask { id: string; next_action_id: string; title: string; done_at: string | null; position: number }
  export interface PkRead { membership_id: string; next_action_id: string; last_read_at: string }

  /** Local calendar date of an ISO timestamp, 'YYYY-MM-DD'. */
  export function pkDateOf(occurredAt: string): string;
  /** pkDate + days, on the calendar (no timezone shift). */
  export function alertDate(pkDate: string, days: number): string;
  /** The patch a priority pick writes: priority, priority_days (default), due_date (alert) — due_date omitted for ELIMINATE. */
  export function priorityPatch(pkDate: string, priority: Priority, days?: number): { priority: Priority; priority_days: number | null; due_date?: string };
  /** Open, not ELIMINATE, priority set, due_date < today. */
  export function isAlertPassed(i: PkItem, today: string): boolean;
  /** Days from today to the alert: negative = passed. null when no alert. */
  export function daysToAlert(i: PkItem, today: string): number | null;
  /** Band %: 0..1, or null when nothing counts. */
  export function bandProgress(items: readonly PkItem[], subtasks: readonly PkSubtask[]): number | null;
  /** Something by someone else after my last read. */
  export function isUnread(i: PkItem, notes: readonly PkNote[], myRead: PkRead | undefined, me: string): boolean;
  export interface PkSummary { pksOpen: number; followUps: number; alertPassed: number; onUs: number; waiting: number; newForMe: number }
  export function summarize(bands: readonly { items: readonly PkItem[] }[], unread: (i: PkItem) => boolean, today: string): PkSummary;
  ```
- Summary rules: counts exclude closed items (`completed_at` set, which includes Eliminate); `pksOpen` = bands with at least one open item; `onUs` = open with `PENDING_ACTION`; `waiting` = open with `AWAITING_RESPONSE`.

- [ ] **Step 1: Write the failing tests:**
  - `alertDate("2026-10-20", 2) === "2026-10-22"`; `alertDate("2026-10-30", 7) === "2026-11-06"` (month roll).
  - `priorityPatch("2026-10-20", "DELEGATE")` → `{priority: "DELEGATE", priority_days: 2, due_date: "2026-10-22"}`; with `days = 5` → due `"2026-10-25"`; `"ELIMINATE"` → `{priority: "ELIMINATE", priority_days: null}` and no `due_date` key.
  - `isAlertPassed`: due `2026-10-22`, today `2026-11-02`, open, DELEGATE → true; due today → false; ELIMINATE → false; priority null → false; completed → false.
  - `bandProgress` (Review Focus 4): item A with 2/5 subtasks done, item B no subtasks and done, item C ELIMINATE with 3 subtasks → `(2 + 1) / (5 + 1) = 0.5`; all ELIMINATE → null.
  - `isUnread` (Review Focus 3): my own note after my read → false; another's note after my read → true; another's status change (`last_changed_by` ≠ me, `last_changed_at` > read) → true; no read row and no others' activity → false; no read row and another's note → true.
  - `summarize` on two bands (one all closed) gives the expected six counts.
- [ ] **Step 2:** `npx vitest run src/lib/domain/__tests__/pk-follow-up.test.ts` → fails.
- [ ] **Step 3:** Implement. `alertDate` uses the same UTC calendar maths as `addDays` in `visit-sections.ts`; `pkDateOf` uses the browser's local date (`new Date(iso)` → getFullYear/getMonth/getDate).
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat(pk): the follow-up rules — alert, progress, unread, summary`.

### Task 5: The board — `/dealers/pk`

**Files:**
- Create: `src/app/dealers/pk/page.tsx`, `src/components/pk-board.tsx` (bands + rows), `src/components/dealers-tabs.tsx`
- Modify: `src/app/dealers/page.tsx` (render `<DealersTabs current="overview" />` under the h1), `src/app/globals.css` (status cell tokens and `.pk-*` styles), `src/components/nav-bar.tsx` (`/dealers/pk` keeps Dealers highlighted, if the nav matches exact paths)

**Interfaces:**
- Consumes: Task 4 types and functions; tables from Tasks 1–3.
- Produces: `export interface PkBand { activityId: string; accountId: string | null; dealer: string; pkDate: string; location: string | null; items: PkItem[] }`; `PkBoard` props `{ bands, notes, subtasks, reads, names: Map<string,string>, me: string, todayIso: string, onOpen(itemId: string): void, onAdd(activityId: string): void }`.
- `DealersTabs({ current: "overview" | "pk" })` — two links, `aria-current="page"` on the current one.

Data load (page): `activities` where `activity_type = 'PK_TRAINING'` (id, occurred_at, location, primary_account_id, account name) → `next_actions` where `activity_id in (…)` (all Task 1 columns + `account_id`) → notes, subtasks, reads `in` those item ids → `memberships` names (same query as `/dealers`). All via `fetchAllPages`, ordered. Gate with `seesDealersBoard`; same loading skeleton / offline message pattern as `/dealers`. Stamp `todayIso` when data lands.

Render, following the mockup: summary strip (six figures from `summarize`), toolbar (search on action/dealer/note text, owner select, Action required select, "Unread only", "Show done" — off hides closed items except they still count in the band %), bands newest PK first with fold toggle, rows as in spec §3. Eliminate rows dimmed. Unread rows show the red dot. "+ Add action" calls `onAdd`.

"+ Add action": a one-line input at the band's foot; enqueue `next_action:create` with `activity_id`, `account_id` of the band, `owner_id = me`, `item_type: "ACTION"`, `source: "MANUAL"`, `due_date` = today + 7 (no priority yet).

- [ ] **Step 1:** Write `src/components/__tests__/pk-board.test.tsx` only if the repo already tests components (check `src/components/__tests__`); otherwise the logic stays in Task 4 and this task is verified in the browser.
- [ ] **Step 2:** Build the page, board and tabs.
- [ ] **Step 3:** `npx tsc --noEmit`, `npm run lint`, `npm test` pass.
- [ ] **Step 4:** Browser check (`npm run dev`, local DB with a seeded PK visit and items — add the seed rows to `supabase/seed.sql`: one PK_TRAINING activity with three items, two notes, three subtasks): both tabs, bands fold, filters, light and dark, 1440px and 400px.
- [ ] **Step 5:** Commit `feat(pk): the PK follow-up board`.

### Task 6: The item drawer

**Files:**
- Create: `src/components/pk-item-drawer.tsx`
- Modify: `src/app/dealers/pk/page.tsx`, `src/app/globals.css`

**Interfaces:**
- Consumes: `priorityPatch`, `alertDate`, `isAlertPassed`, labels (Task 4); outbox `next_action:update` (Task 1 schema).
- Produces: `PkItemDrawer` props `{ item: PkItem, band: PkBand, notes: PkNote[], versionsByNote: Map<string, {body: string; replaced_at: string}[]>, subtasks: PkSubtask[], reads: PkRead[], names, me, todayIso, onChanged(): void, onClose(): void }`.

Behaviour:
- Opening upserts my read (Task 3 interface) and the page clears the item's red dot without a reload.
- Status and priority selects write through the outbox: `layer.sync.enqueue({clientId: item.id, entityType: "next_action", op: "update", payload: {id, ...patch}, baseVersion: <item updated_at>, blobRef: null})` then `drain()`, updating local state optimistically. Look at an existing `next_action` update call for the exact `baseVersion` value. Priority change uses `priorityPatch`; editing days re-runs it with the typed days.
- Alert line: `"Alert: PK Oct 20 + 2 days = Oct 22 · deadline passed"` / `"… · in 3 days"`; "No alert — Eliminate" / "Set a priority to get an alert".
- Subtasks: list with checkboxes (toggle `done_at`), add box, delete (×). Direct Supabase writes; on error show one line and roll back.
- Notes log, oldest first: author · date and time · body; "edited" with a disclosure listing the earlier texts (load versions on open). The author's own notes have "Edit". Add-note box at the foot. No delete.
- "Seen": every member with a read row, with the time; members who have not read it are listed as "Not viewed yet".
- Escape closes the drawer (but not while typing in a form field — see commit 48dd7de for the pattern).

- [ ] **Step 1:** Build the drawer and wire it.
- [ ] **Step 2:** `npx tsc --noEmit`, `npm run lint`, `npm test` pass.
- [ ] **Step 3:** Browser check as two users (Bianca and João dev logins): João changes a status and adds a note → Bianca's row shows the red dot; Bianca opens it → dot clears and João appears in "Seen" after her read. Priority Delegate on an Oct 20 PK shows Oct 22 and "deadline passed"; Eliminate dims the row and the band % changes.
- [ ] **Step 4:** Commit `feat(pk): the item drawer — statuses, priority, subtasks, notes, seen`.

### Task 7: Excel export

**Files:**
- Create: `src/lib/domain/pk-export.ts`, `src/lib/domain/__tests__/pk-export.test.ts`
- Modify: `src/components/pk-board.tsx` (toolbar button), `package.json` (`write-excel-file@4.1.1`)

**Interfaces:**
- Produces: `export function pkExportSheets(bands: PkBand[], notes: PkNote[], subtasks: PkSubtask[], names: Map<string,string>): { followUps: Cell[][]; subtasks: Cell[][] }` where `Cell = { value: string | number | Date | null; fontWeight?: "bold"; span?: number } | null`; and `export function pkExportFileName(today: string): string` → `"PK follow-up · Nov 2, 2026.xlsx"` for `"2026-11-02"`.

Columns (spec §5) — sheet "PK follow-ups": Action, Action required, Status, Priority, Days, Alert date, Owner, Subtasks, Notes; one bold header row per PK (`"<dealer> · PK <Mon D> · <place> · <n>%"`). Sheet "Subtasks": PK, Action, Subtask, Done. Alert date empty for Eliminate and unset priority. Notes cell joins notes oldest first with newlines as `"<Author> · <Mon D, h:mm a>: <body>"` + `" (edited)"`.

- [ ] **Step 1:** Tests: file name; a band with a DELEGATE item gives its header row then a row with `"Delegate"`, `2`, alert date `2026-10-22`; an edited note ends in `" (edited)"`; Eliminate has empty alert; subtasks sheet has one row per subtask with `Done` empty when not done.
- [ ] **Step 2:** Fail, implement, pass.
- [ ] **Step 3:** Button: `const { default: writeXlsxFile } = await import("write-excel-file")` with two sheets; exports what the filters show.
- [ ] **Step 4:** `npm test`, `npx tsc --noEmit`, `npm run lint`; browser: the file downloads and opens with both sheets.
- [ ] **Step 5:** Commit `feat(pk): export the PK follow-ups to Excel`.

### Task 8: Import of the October PKs (after merge, on Andre's go)

**Files:**
- Create: `supabase/oneoff/2026-11-02-import-october-pks.sql`

Waits for PK Control's own Excel export (Andre exports it from Bia's browser) and for the migrations of Tasks 1–3 to be live in production. Build the SQL from that file: three `PK_TRAINING` activities (Capital Lumber Company, existing distributor account; Burton Lumber, existing dealer account; BFS Heber — create `Builders FirstSource Heber` dealer account if none matches), 17 `next_actions` with `activity_id`, priority/days/due_date per Task 4 rules, statuses, owners (Bianca / João memberships looked up by name), notes with original author and timestamp, subtasks. Idempotent: fixed UUIDs and `on conflict do nothing`. Show Andre the row counts from a dry run (`begin … rollback`) before running it for real.

---

## Execution notes

- Branch `feat/pk-follow-up` from `main`.
- After Task 7: whole-branch review, browser check, then ask Andre before merging to `main` (push = production deploy) and before applying the three migrations to production.
