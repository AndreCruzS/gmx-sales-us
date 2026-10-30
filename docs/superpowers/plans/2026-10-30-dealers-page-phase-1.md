# Dealers page · Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/dealers`, the admin action page: tiers, tier map by market, dealers of a market, to-dos split Action items / To coordinate / Follow-ups, and a dealer sheet with last visit, pending items, visit timeline and promises. Visit capture gains Bia's sections.

**Architecture:** One migration extends `next_actions` with an item type, a source and who entered it. Tiers and promise maths are pure functions in `src/lib/domain/`, tested with vitest, because most dealers are keyed by their file label, not an account (same reason `dealer-profile.ts` is pure). The page is a client component like `/reps`, reading through `fetchAllPages`, and reuses `SalesMap` and `useDealerModule` as they are.

**Tech Stack:** Next.js App Router, Supabase (Postgres, RLS, pgTAP), zod schemas + offline outbox, vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-dealers-page-design.md`

## Global Constraints

- All UI copy in English. Desktop is the target; the page must not break on a phone.
- LF is the only measure. Rows whose `unit` is not LF (case-insensitive) are ignored for tiers.
- Tier rule (confirmed 2026-10-30): trailing 12 months; T1 = dealers that together make up 80% of LF; T3 = fewer than 3 purchase months; T2 = the rest; no history = untiered target.
- Branch-level rows (`isBranchLevel`) never count toward a dealer.
- Every list query goes through `fetchAllPages` with a deterministic `order`.
- Any view created or replaced states `WITH (security_invoker = true)`.
- The two type faces rule: figures in `--font-fig`; terminal mono only for `.paste-box`.
- No dealer dots on the map.

## Review Focus

1. **A dealer with sales only in YTD files** (no monthly rows). Expected: tiered from the YTD total, counted as one purchase month. Test in Task 2.
2. **The 80% boundary.** The dealer that crosses 80% is T1; ties in LF are broken by name so the result is stable. Test in Task 2.
3. **Visits recorded before this migration** have no `item_type` on their follow-ups. Expected: existing non-visit rows read as Follow-ups, visit rows stay out of the to-do list. Test in Task 1.
4. **Assistant enters an item for Bianca.** Expected: `owner_id` = Bianca, `entered_by` = the assistant, and the assistant can insert it under RLS. Test in Task 1.
5. **Offline visit with three section lines.** Expected: the activity and its three items all ride the outbox, and the items carry the activity id. Test in Task 5.

---

### Task 1: Migration — item type, source and who entered it

**Files:**
- Create: `supabase/migrations/20261030120000_dealer_items.sql`
- Create: `supabase/tests/27_dealer_items.test.sql`
- Modify: `src/lib/database.types.ts` (regenerated)

**Interfaces:**
- Produces: enum `next_action_type` = `ACTION | COORDINATE | FOLLOW_UP | PROMISE | DEADLINE`; enum `next_action_source` = `MANUAL | VOICE | VISIT_CAPTURE | EMAIL_AI | EMAIL_BACKFILL`; columns on `next_actions`: `item_type next_action_type null`, `source next_action_source not null default 'MANUAL'`, `source_ref text null`, `entered_by uuid null references memberships(id)`, `counterparty_account_id uuid null references accounts(id)`.

Decisions:
- `item_type` is separate from the existing `kind` (VISIT, SAMPLE_FOLLOW_UP…), which the routine list still uses. Visits keep `item_type` null.
- Backfill: `item_type = 'FOLLOW_UP'` where `kind is distinct from 'VISIT'`.
- A `before insert` trigger sets `entered_by := private.active_membership_id()` when null, and sets `item_type := 'FOLLOW_UP'` when null and `kind is distinct from 'VISIT'` (after the existing kind trigger; name it so it sorts later).
- RLS: extend the insert policy so a member may insert an item whose `owner_id` is someone else only when `entered_by` is themselves and they are admin or listed in `support_assignments` for that owner. Read the existing `support_assignments` columns before writing the predicate.
- The `status` / `proposed` column is NOT in this phase; it arrives with the email AI (phase 4).

- [ ] **Step 1: Write the failing pgTAP test** `27_dealer_items.test.sql` with `plan(7)`:
  - `has_type('public','next_action_type')`, `has_column('public','next_actions','item_type')`, `col_default_is('public','next_actions','source','MANUAL'::next_action_source)`.
  - `is((select count(*) from next_actions where kind = 'VISIT' and item_type is not null), 0::bigint, 'visits stay out of the to-do list')`.
  - `is((select count(*) from next_actions where kind is distinct from 'VISIT' and item_type is null), 0::bigint, 'old follow-ups read as follow-ups')`.
  - As a seeded assistant (support_assignments row for an admin owner): `lives_ok` inserting an item with that admin as `owner_id`, then `is(entered_by, assistant membership)`.
  - As a plain rep with no assignment: `throws_ok` inserting an item owned by another rep.
- [ ] **Step 2:** Run `npm run db:test`. Expected: 27 fails, the others pass.
- [ ] **Step 3:** Write the migration as decided above.
- [ ] **Step 4:** `npm run db:reset && npm run db:test`. Expected: all pass.
- [ ] **Step 5:** `npm run db:types`; `npx tsc --noEmit` passes.
- [ ] **Step 6:** Commit `feat(dealers): next_actions carry an item type, a source and who entered them`.

### Task 2: Dealer tiers (pure)

**Files:**
- Create: `src/lib/domain/dealer-tiers.ts`
- Test: `src/lib/domain/__tests__/dealer-tiers.test.ts`

**Interfaces:**
- Consumes: `SellThroughRow`, `dealerKey`, `dealerDisplayName`, `isBranchLevel` from `@/lib/domain/sell-through`.
- Produces:
  ```ts
  export type Tier = "T1" | "T2" | "T3";
  export interface DealerTier {
    key: string; name: string; accountId: string | null;
    lf: number; purchaseMonths: number; share: number; // share of total LF, 0..1
    tier: Tier; regionId: string | null; regionName: string | null;
  }
  export function tierDealers(rows: readonly SellThroughRow[], asOf: string /* YYYY-MM-01 */): DealerTier[];
  export function tierCounts(tiers: readonly DealerTier[]): Record<Tier, number>;
  export function untieredTargets<T extends { id: string }>(dealerAccounts: readonly T[], tiers: readonly DealerTier[]): T[];
  ```
  Window: the 12 months ending the month before `asOf`. Region = the region with most LF for that dealer. T1 is decided before T3: a dealer inside the 80% is T1 even with fewer than 3 months.

- [ ] **Step 1: Write failing tests:**
  - `"the dealers that make up 80% of LF are T1, including the one that crosses it"`: LF 50/30/10/10 → tiers T1, T1, then the rest by months.
  - `"fewer than 3 purchase months is T3"` and `"3 or more is T2"`.
  - `"branch-level rows and non-LF rows count for nobody"`.
  - `"rows outside the 12-month window are ignored"` (asOf `2026-11-01` drops `2025-10-01`).
  - `"a YTD row counts as one purchase month"` (Review Focus 1).
  - `"ties in LF break by name"` (Review Focus 2).
  - `"untieredTargets returns dealer accounts with no tier"`.
- [ ] **Step 2:** `npx vitest run src/lib/domain/__tests__/dealer-tiers.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(dealers): tier dealers by the 80% LF rule`.

### Task 3: Dealer items (pure)

**Files:**
- Create: `src/lib/domain/dealer-items.ts`
- Test: `src/lib/domain/__tests__/dealer-items.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ItemType = "ACTION" | "COORDINATE" | "FOLLOW_UP" | "PROMISE" | "DEADLINE";
  export type Bucket = "action" | "coordinate" | "follow_up";
  export const BUCKET_LABEL: Record<Bucket, string>; // "Action items", "To coordinate", "Follow-ups"
  export const ITEM_TYPE_LABEL: Record<ItemType, string>; // "Action", "To coordinate", "Follow-up", "Promise", "Deadline"
  export function bucketOf(t: ItemType): Bucket; // ACTION, PROMISE, DEADLINE → action
  export interface ItemLike { item_type: ItemType | null; due_date: string; completed_at: string | null; account_id: string | null; }
  export function isLate(i: ItemLike, today: string): boolean; // open and due_date < today
  export function isKeptPromise(i: ItemLike): boolean; // PROMISE, completed on or before due_date (date part)
  export interface PromiseStats { visits: number; promises: number; kept: number; late: number; open: number; perVisit: number | null; }
  export function promiseStats(items: readonly ItemLike[], visitCount: number, today: string): PromiseStats;
  ```

- [ ] **Step 1: Write failing tests** for each export, including `"a promise completed a day after its due date is not kept"` and `"perVisit is null with no visits"`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(dealers): buckets, late items and kept promises`.

### Task 4: Outbox accepts the new fields

**Files:**
- Modify: `src/lib/domain/schemas.ts:73-90` (`nextActionCreateSchema`)
- Test: `src/lib/domain/__tests__/schemas.test.ts`

**Interfaces:**
- Produces: `nextActionCreateSchema` gains `item_type: z.enum(ITEM_TYPES).nullish()`, `source: z.enum(["MANUAL","VOICE","VISIT_CAPTURE"]).nullish()`, `entered_by: uuid.nullish()`, `counterparty_account_id: uuid.nullish()`. Export `ITEM_TYPES` from `dealer-items.ts`.

- [ ] **Step 1:** Failing test: `"a next_action create keeps item_type, source and entered_by"` (zod strips unknown keys, so the parsed object must still hold them).
- [ ] **Step 2:** Run `npx vitest run src/lib/domain/__tests__/schemas.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Extend the schema.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(dealers): the outbox carries a to-do's type and source`.

### Task 5: Visit capture gets Bia's sections

**Files:**
- Modify: `src/app/record/page.tsx` (note + account path, around the `entityType: "activity"` enqueue at ~line 323)
- Create: `src/lib/domain/visit-sections.ts`
- Test: `src/lib/domain/__tests__/visit-sections.test.ts`

**Interfaces:**
- Consumes: `ItemType` (Task 3), `NextActionCreate` (Task 4).
- Produces: `export function sectionItems(input: { activityId: string; orgId: string; ownerId: string; accountId: string; today: string; actions: string; coordinate: string; followUps: string; }): NextActionCreate[]`. One item per non-empty line; types ACTION / COORDINATE / FOLLOW_UP; `due_date` = today + 7 days; `source = "VISIT_CAPTURE"`; `activity_id` set; fresh `crypto.randomUUID()` ids.

UI: under the note, three optional textareas labelled "Action items", "To coordinate", "Follow-ups", hint "One per line". The note itself is the Summary. Each item from `sectionItems` is enqueued with `entityType: "next_action", op: "create"` right after the activity.

- [ ] **Step 1:** Failing tests: `"one item per non-empty line, typed by section"`, `"due in 7 days and linked to the visit"`, `"blank sections make nothing"`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement `sectionItems`; wire the textareas and enqueue in `record/page.tsx`.
- [ ] **Step 4:** Run vitest. Expected: PASS. Then in the dev app, record a visit offline (DevTools offline) with one line in each section; go online; check that `next_actions` has three rows with that `activity_id` (Review Focus 5).
- [ ] **Step 5:** Commit `feat(record): a visit note splits into action items, to coordinate and follow-ups`.

### Task 6: `/dealers` overview

**Files:**
- Create: `src/app/dealers/page.tsx`
- Modify: `src/components/nav-bar.tsx` (TITLES `"/dealers": "Dealers"`, add to ROOTS), `src/components/tab-bar.tsx`
- Modify: `src/app/accounts/page.tsx` (a "Contacts" link in its header)

Desk tab bar (Andre, 2026-10-30): **Sales · Dealers · Reps · Accounts**, with the existing Add button kept where it sits today. Contacts leaves the desk bar: `/contacts` stays a route, reached from a link on the Accounts board, and the Accounts tab stays lit on `/contacts` (same pattern as Agenda and Quotes lighting Reps). Reps' bar is unchanged.

**Interfaces:**
- Consumes: `tierDealers`, `tierCounts`, `untieredTargets` (Task 2); `bucketOf`, `isLate`, `BUCKET_LABEL` (Task 3); `SalesMap` (as is); `fetchAllPages`; `manages`.

Layout (matches the mockup, screen 1):
- Gate: `manages(profile?.role)`; anyone else sees "This page is for the sales desk."
- KPI row: Tier 1 / Tier 2 / Tier 3 / No history counts, with T1's share of LF.
- `SalesMap` with the trailing-12-month rows; picking a market sets `picked`. Beside or below it, one card per market with "T1 n · T2 n · T3 n" and a ⚠ count of late items for that market's dealers.
- "<Market> · dealers" table: Dealer, Tier, Last visit, Open (late chip), Rep. Clicking a row opens the dealer sheet (Task 7).
- To-dos card: tabs Action items / To coordinate / Follow-ups (counts in the tab), filter Everyone / Mine / by rep, sorted late first then by due date; each row shows type, owner and "entered by X for Y" when they differ. Rows where `item_type` is null are left out.
- Data reads: `sell_through_rows` (same select list as `/reps`, `order("period").order("row_id")`), dealer `accounts`, open `next_actions` with `item_type` not null, latest `activities` per account.

- [ ] **Step 1:** Build the page against the dev database.
- [ ] **Step 2:** `npm run lint && npx tsc --noEmit && npm run build`. Expected: clean.
- [ ] **Step 3:** With production-like data, check the KPI counts land near 22 / 74 / 14 with ~40 untiered. Write the actual numbers in the commit body.
- [ ] **Step 4:** Screenshot at 1280px and 400px (real click, not the accessibility tree); no horizontal page scroll at 400px.
- [ ] **Step 5:** Commit `feat(dealers): the desk's Dealers board — tiers, markets and to-dos`.

### Task 7: Dealer sheet

**Files:**
- Create: `src/components/dealer-sheet.tsx`
- Modify: `src/app/dealers/page.tsx` (open it on row click)

**Interfaces:**
- Consumes: `DealerTier` (Task 2); `promiseStats`, `isLate`, `ITEM_TYPE_LABEL` (Task 3); `useDealerModule` for the sales facts.
- Produces: `export function DealerSheet(props: { dealer: DealerTier; onClose: () => void }): JSX.Element`.

Content, top to bottom: tier chip and name, region, rep; "Last visit · <date>" with `what_happened` and that visit's still-open items; "Promises to this dealer" from `promiseStats` with the ⚠ line when `perVisit` is above the team average; visit timeline (date, owner, first line of `what_happened`); a "Sales facts" link that opens the existing dealer module. A dealer with no account shows only the tier and the sales facts link, with "No visits recorded: this dealer has no account yet."

Desk: side panel beside the map, list stays put. Phone: full-width sheet.

- [ ] **Step 1:** Build the sheet.
- [ ] **Step 2:** `npm run lint && npx tsc --noEmit`. Expected: clean.
- [ ] **Step 3:** Open BFS Heber (or any dealer with visits) in dev; check last visit, pending items and promise counts against the rows in the database. Screenshot.
- [ ] **Step 4:** Commit `feat(dealers): open a dealer — last visit, what's pending, promises, history`.

### Task 8: Add an item from the board

**Files:**
- Modify: `src/app/dealers/page.tsx`, `src/components/dealer-sheet.tsx`
- Create: `src/components/dealer-item-form.tsx`

**Interfaces:**
- Consumes: `nextActionCreateSchema` (Task 4); outbox `layer.sync.enqueue({ entityType: "next_action", op: "create", ... })`.
- Produces: `export function DealerItemForm(props: { accountId?: string; onDone: () => void }): JSX.Element`.

Fields: dealer (prefilled from the sheet), type (Action, To coordinate, Follow-up, Promise, Deadline), what, due date, owner (defaults to me), "Entering for" (shown when the user has a `support_assignments` row; sets `owner_id` to that person and `entered_by` to me), and for Deadline an optional distributor (`counterparty_account_id`). `source = "MANUAL"`.

- [ ] **Step 1:** Build the form; wire "+ Add" on the to-dos card and in the sheet.
- [ ] **Step 2:** Lint, typecheck, build. Expected: clean.
- [ ] **Step 3:** In dev, as an assistant user, add a Promise for Bianca; check it shows "entered by <assistant> for Bianca" (Review Focus 4 end to end).
- [ ] **Step 4:** Commit `feat(dealers): add an action, promise or deadline from the board`.

### Task 9: Whole-branch check

- [ ] `npm test && npm run db:test && npm run lint && npm run build` all pass.
- [ ] Update the spec's §4 to match what shipped (`item_type` column, tiers computed in the app).
- [ ] Open a PR from `feat/dealers-page`.
