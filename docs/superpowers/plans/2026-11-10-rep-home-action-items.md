# Rep Home action items + deadline-driven urgency — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every open item gets a deadline that decides its urgency. The person
answers only "important?". A rep's Home shows the open work in four boxes,
and a tap opens a **My work** page.

**Architecture:**
- One pure domain module (`src/lib/domain/deadline.ts`) decides:
  - business days;
  - the urgent cap;
  - the default deadline for each kind;
  - the derived priority.
- The database mirrors that rule:
  - a new `important` column;
  - a SQL `derive_priority`;
  - a nightly pg_cron recompute.
- Every writer (the PK drawer, Say it/debrief, the MCP tools, the Suggest
  route) goes through the domain module.
- The Home block and the My work page read the offline cache.

**Tech Stack:** Next.js 16, supabase-js, Postgres/pgTAP, pg_cron, zod 4,
vitest, AI SDK `generateObject`.

**Spec:** `docs/superpowers/specs/2026-11-10-rep-home-action-items-design.md`

## Global Constraints

- UI copy in English. Labels: **Do now · Plan · No priority · Scheduled**.
  The page title is **My work**. The Home block is **Your action items**.
  Do not rename "Do now".
- Urgent means the deadline is no more than **2 business days** away
  (Mon–Fri, no holidays), or already past.
- Marking urgent sets the deadline to `min(given, today + 2 business days)`.
- The priority for a rep: important and urgent → `DO_NOW`; important →
  `PLAN`; urgent and not important → `PLAN`; neither → `ELIMINATE`, which
  is a suggestion only. An owner whose role is admin or support gets
  `DELEGATE` for urgent and not important. The owner's role decides, through
  `givesWorkToOthers(role)` in `src/lib/domain/roles.ts`.
- `important` null → no priority (null).
- Default deadlines in business days:
  - `QUOTE_FOLLOW_UP` 2;
  - `SAMPLE_FOLLOW_UP` 3;
  - `DISPLAY_CHECK` 10;
  - PK follow-up 5, counted from the PK date;
  - `OTHER`/null 5.
- VISIT/CALL/MEETING have no priority and no suggestion. Their booked date
  is their date.
- A suggestion is never saved without the person's yes.
- "Today" is the device's **local** date, never `toISOString().slice(0,10)`.
- Numbers use `--font-fig`. Never use `--font-mono` outside `.paste-box`.
- Prod SQL runs only via
  `npx supabase db query --linked -f <scratchpad file>`. **Never
  `db push`.**
- Mobile first. Verify at 390 px with a real screenshot.

## Review Focus

1. **A Friday or weekend "today".** Friday + 2 business days = Tuesday.
   Saturday + 2 = Tuesday. A deadline on Monday seen on Saturday is urgent.
   Tests are in Task 1.
2. **A non-PK follow-up with a priority must still route to
   `update_follow_up`, not the PK tools.** `isPkItem` in
   `src/lib/mcp/tools/agenda.ts:213` treats `priority !== null` as PK
   today. Test in Task 6.
3. **An existing `DELEGATE` on a rep-owned item.** It shows as Plan on the
   rep's screens, and the nightly recompute rewrites it to PLAN. Tests in
   Tasks 1 and 2.
4. **The device in another time zone than UTC late in the evening.** "Late"
   must not flip at UTC midnight. Test of `localIsoDate` in Task 1.
5. **An item marked urgent whose given date is earlier than today + 2
   business days.** The given date wins. Tests in Tasks 1 and 5.

---

### Task 1: Deadline domain module

**Files:**
- Create: `src/lib/domain/deadline.ts`
- Test: `src/lib/domain/__tests__/deadline.test.ts`

**Interfaces — Produces:**
- `localIsoDate(d?: Date): string` — the local `YYYY-MM-DD`.
- `addBusinessDays(iso: string, n: number): string` — when starting on a
  weekend, it first rolls to the next Monday and then counts.
  `addBusinessDays("2026-11-13", 2) === "2026-11-17"` (a Friday gives a
  Tuesday). `("2026-11-14", 2) === "2026-11-17"`.
- `businessDaysUntil(today: string, due: string): number` — negative when
  late. Weekend days do not count.
- `isUrgent(due: string, today: string): boolean` —
  `businessDaysUntil(today, due) <= 2`.
- `urgentCap(given: string | null, today: string): string` —
  `min(given ?? ∞, addBusinessDays(today, 2))`.
- `DEFAULT_DEADLINE_DAYS: Record<"QUOTE_FOLLOW_UP"|"SAMPLE_FOLLOW_UP"|"DISPLAY_CHECK"|"PK"|"OTHER", number>`
  with the values from Global Constraints.
- `defaultDeadline(kind: string | null, isPk: boolean, from: string): string`
  — the PK value when `isPk`. An unknown or null kind uses `OTHER`.
- `derivePriority(important: boolean | null, due: string, today: string, ownerGivesWork: boolean): Priority | null`
- `deadlineLabel(due: string, today: string): { text: string; late: boolean }`
  — "due today", "due in 3d", "2d late". Calendar days in the text,
  business days only for urgency.
- `isTask(kind: string | null): boolean` — false for VISIT, CALL and
  MEETING.

- [ ] **Step 1: Write the failing tests.** They cover:
  - the business-day cases above;
  - Monday seen on Saturday is urgent (`businessDaysUntil("2026-11-14","2026-11-16") === 1`);
  - `urgentCap("2026-11-11","2026-11-10") === "2026-11-11"`;
  - `urgentCap("2026-11-30","2026-11-10") === "2026-11-12"`;
  - `urgentCap(null,"2026-11-10") === "2026-11-12"`;
  - `derivePriority` for all four combinations, for a rep (`false`) and an
    admin (`true`). For example
    `derivePriority(false,"2026-11-11","2026-11-10",false) === "PLAN"` and
    the same with `true` → `"DELEGATE"`;
  - `derivePriority(null, …) === null`;
  - `defaultDeadline("QUOTE_FOLLOW_UP", false, "2026-11-13") === "2026-11-17"`;
  - `defaultDeadline("OTHER", true, "2026-11-02") === "2026-11-09"`;
  - `localIsoDate(new Date(2026,10,10,23,30)) === "2026-11-10"`;
  - the `deadlineLabel` cases.
- [ ] **Step 2:** `npx vitest run src/lib/domain/__tests__/deadline.test.ts`
  → FAIL (module missing).
- [ ] **Step 3: Implement.** Use pure date math on `YYYY-MM-DD` at UTC noon
  to avoid DST drift.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(domain): deadlines decide urgency (business days, cap, defaults, derived priority)`.

### Task 2: Database — `important`, derive_priority, nightly recompute

**Files:**
- Create: `supabase/migrations/20261110120000_deadline_urgency.sql`
- Create: `supabase/tests/36_deadline_urgency.test.sql`
- Modify: `src/lib/database.types.ts`. Regenerate with
  `npx supabase gen types typescript --local`, or add `important: boolean | null`
  by hand to the Row, Insert and Update of `next_actions` if generation is
  unavailable.

**Interfaces — Produces:**
- `next_actions.important boolean` (nullable).
- `private.add_business_days(d date, n int) returns date`.
- `private.business_days_until(today date, due date) returns int`.
- `private.derive_priority(important boolean, due date, today date, owner_gives_work boolean) returns next_action_priority`.
  It has the same table as Task 1. Null important → null.
- `private.recompute_priorities() returns int`:
  - It covers open items (`completed_at is null`) where `important is not null`
    and `priority is distinct from 'ELIMINATE'`.
  - It sets `priority` to the derived value. For a member the owner's role
    is read from `memberships.role`: admin or support → true.
  - It returns the row count.
  - It must run with `set_updated_at` **disabled**, as in
    `20261102120000_pk_priority_status.sql`, so the calendar sync does not
    see an edit.
  - It does not stamp `last_changed_by`, because no member is signed in.
- A cron job `recompute-priorities` at `0 9 * * *`, which is 04:00 US
  Eastern, before anyone's morning.
- Backfill:
  - `important = true` where the priority is `DO_NOW` or `PLAN`;
  - `false` where it is `DELEGATE`;
  - null otherwise.
  - Then run `select private.recompute_priorities();` once, in the
    migration.

- [ ] **Step 1: Write the failing pgTAP tests.**
  - `has_column` for `important`.
  - `add_business_days('2026-11-13',2) = '2026-11-17'`.
  - `derive_priority(false,'2026-11-11','2026-11-10',false) = 'PLAN'`, and
    with `true` → `'DELEGATE'`.
  - After the backfill a seeded rep-owned DELEGATE item reads PLAN.
  - `recompute_priorities()` moves an important item due within 2 business
    days to DO_NOW.
  - The cron job exists in `cron.job`.
  - Follow the conventions of `supabase/tests/35_agent_connector.test.sql`
    (seed ids, `plan()`).
- [ ] **Step 2:** `npx supabase test db` → the new file FAILS.
- [ ] **Step 3: Write the migration.** Apply it locally with
  `npx supabase migration up` (local only).
- [ ] **Step 4:** `npx supabase test db` → all PASS.
- [ ] **Step 5:** Commit `feat(db): important on next_actions; priority follows the deadline nightly`.

### Task 3: Shared matrix rules, Suggest route returns a deadline

**Files:**
- Modify: `src/lib/domain/eisenhower.ts`
- Modify: `src/app/api/pk/suggest-priority/route.ts`
- Test: `src/lib/domain/__tests__/eisenhower.test.ts` and the route's
  existing test, if any. Grep for `suggest-priority` under `__tests__`.

**Interfaces — Consumes:** Task 1 (`urgentCap`, `derivePriority`,
`defaultDeadline`).

**Interfaces — Produces:**
- `MATRIX_RULES`, rewritten:
  - It asks IMPORTANT only, with the same definition as today.
  - Then the DEADLINE rules: a date said is used as said; "urgent" or the
    dealer waiting (asked for it, GMX promised it, a job or delivery
    depends on it) means `urgent: true`. Otherwise, no date.
  - The reason shape is "Important: … · Due: …", at most 15 words.
- `matrixGuessSchema = z.object({ important: z.boolean(), urgent: z.boolean(), said_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), reason: z.string() })`.
  `urgent` here means "said or implied urgent". It no longer decides the
  quadrant directly.
- `suggestDeadline(g: {urgent: boolean; said_date: string | null}, fallback: string, today: string): string`:
  - urgent → `urgentCap(said_date ?? fallback, today)`;
  - otherwise → `said_date ?? fallback`.
- Remove `quadrantOf` and `draftedQuadrant` once Tasks 4–6 stop calling
  them. Delete them in the last task that drops a caller (Task 6, Step 3).
- The route's input adds `kind: string | null`. Its output is
  `{ important, due_date, reason, priority }`, where:
  - `due_date = suggestDeadline(object, defaultDeadline(kind, true, pkDate), today)`;
  - `priority = derivePriority(important, due_date, today, ownerGivesWork)`;
  - `ownerGivesWork` comes from a new body field
    `ownerGivesWork: boolean`, which the drawer knows.

- [ ] **Step 1: Failing tests for `suggestDeadline`.**
  - `({urgent:true,said_date:null},"2026-11-17","2026-11-10") === "2026-11-12"`;
  - `({urgent:true,said_date:"2026-11-11"},…) === "2026-11-11"`;
  - `({urgent:false,said_date:"2026-11-20"},…) === "2026-11-20"`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Update the route.
- [ ] **Step 4:** Run → PASS. Run `npx tsc --noEmit`. Callers of the old
  schema break here; that is expected, and Tasks 4–6 fix them. Instead of
  leaving the tree red: keep `quadrantOf` exported until Task 6, and make
  this task's commit typecheck by adapting callers minimally (read the
  `urgent`/`important` fields the same way).
- [ ] **Step 5:** Commit `feat(pk): Suggest answers important and a deadline`.

### Task 4: PK drawer and board — "Important?" + deadline

**Files:**
- Modify: `src/components/pk-item-drawer.tsx`:
  - the edit view at 406-446;
  - the read view at 373-382;
  - `alertLine` at 67-86;
  - the Suggest UI at 263-297 and 460-497.
- Modify: `src/components/pk-band.tsx`, the Alert cell at about line 265:
  use `deadlineLabel`.
- Modify: `src/lib/domain/pk-follow-up.ts`:
  - `isAlertPassed` and `daysToAlert` mean "deadline passed / days to
    deadline" for any open item with a priority;
  - keep `priorityPatch` only if still used, otherwise delete it.
- Modify: `src/lib/domain/pk-export.ts`. The column header "Alert" becomes
  "Deadline". Keep the `priority_days` column as "Days after PK", computed
  as `daysFrom(pkDate, due_date)`.
- Create: `src/components/importance-deadline.tsx`. This is the shared
  control used by the drawer and the My work page (Task 8).
- Test: the existing `pk-follow-up` and `pk-export` tests. Update their
  expectations.

**Interfaces — Produces:**
- `<ImportanceDeadline important={boolean|null} due={string} today={string} ownerGivesWork={boolean} onChange={(p:{important?:boolean|null; due_date?:string; priority:Priority|null}) => void} suggest?: () => Promise<{important:boolean; due_date:string; reason:string} | null> />`.
  It renders:
  - **Important?** Yes / No (segmented);
  - **Deadline** (a date input);
  - an **Urgent** button that sets `due_date = urgentCap(due, today)`;
  - the derived priority tag;
  - an optional "Suggest" that shows "Suggested: Thu Nov 12 · <reason>"
    with **Apply**.
- Every change emits `priority = derivePriority(...)`. The drawer writes
  `{ important, due_date, priority, priority_days: daysFrom(pkDate, due_date) }`
  through `usePkItemWrites.write`. Add `important` to `PkItem` and
  `PkItemPatch`, and to the board's select (find the `pk_board_*` RPC
  column list; if the RPC returns `next_actions.*` nothing is needed,
  otherwise add the column to the RPC in Task 2's migration).
- The drawer derives `ownerGivesWork` from the item owner's role. The board
  already has members (names). If it lacks roles, add `role` to the members
  read that feeds `names`.

- [ ] **Step 1: Update the tests.**
  - `isAlertPassed` with a priority and `due_date < today` stays true.
  - A pk-export test expects the header "Deadline".
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** the control and wire the drawer. Remove the
  priority `<select>` and the "Days after the PK" input. Display rule: the
  priority tag shown on a row is
  `derivePriority(item.important, item.due_date, today, ownerGivesWork)`
  when `important !== null`, otherwise the stored `item.priority` (legacy).
- [ ] **Step 4:** Run `npx vitest run`, then `npx tsc --noEmit`. Screenshot
  the drawer at 1366 px and at 390 px on `localhost:3012/dealers/pk`
  (seed user `bianca@gmxgroup.com`).
- [ ] **Step 5:** Commit `feat(pk): the drawer asks Important? and a deadline; urgency follows the date`.

### Task 5: Say it / debrief — drafts carry importance and a deadline

**Files:**
- Modify: `src/lib/voice/draft.ts`. The schema at 73-102 and the prompt at
  about 235-238:
  - `due_date` becomes nullable ("only a date said");
  - keep `urgent` (said or implied) and `important`;
  - drop the +1/+2/+7 instructions.
- Modify: `src/components/debrief-sheet.tsx`:
  - the helper at 47-62 computes
    `due = urgent ? urgentCap(said ?? def, today) : (said ?? def)`, with
    `def = defaultDeadline(kind, isPk, isPk ? pkDate : today)`;
  - `priority = derivePriority(important, due, today, ownerGivesWork)`,
    where the owner is the speaker (the debrief always plans for oneself);
  - replace the priority `<select>` at 854-867 with `ImportanceDeadline`;
  - the save path at 365-380 writes `important, due_date, priority, priority_days`
    (PK only).
- Modify: `src/lib/domain/schemas.ts` at 79-99 and 121-126: add
  `important: z.boolean().nullish()` next to `priority`.
- Test: the existing draft and debrief tests (grep `draftedQuadrant`,
  `asked_by_dealer` under `__tests__`).

- [ ] **Step 1:** Failing test: a drafted follow-up with
  `{urgent:true, important:false, due_date:null, kind:"QUOTE_FOLLOW_UP"}`
  on 2026-11-10 by a rep yields `due_date "2026-11-12"` and priority
  `"PLAN"`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run` → PASS. Run `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(voice): Say it drafts importance and a deadline; the code applies the urgent cap`.

### Task 6: Agent connector

**Files:**
- Modify: `src/lib/mcp/pk-rows.ts` (`planFollowUp`, lines 21-26).
- Modify: `src/lib/mcp/tools/pk.ts`:
  - `create_pk` at 619-636;
  - the plan at 311-312;
  - `update_pk_item` at 421-453 and 655-667;
  - `alert_date` at 178 → also expose `deadline`;
  - the prompt text at 582.
- Modify: `src/lib/mcp/tools/agenda.ts`:
  - `plan_follow_up` and `update_follow_up` gain optional
    `important: boolean` and `urgent: boolean`, which apply the same rule
    to a non-PK follow-up;
  - `isPkItem` at 213 drops the `priority !== null` shortcut and always
    checks `pk_board_visits`.
- Modify: `src/lib/mcp/guide.ts`:
  - the section "PK FOLLOW-UPS: HOW TO PRIORITISE" becomes "FOLLOW-UPS:
    IMPORTANCE AND DEADLINES";
  - it uses `${MATRIX_RULES}` and states the urgent cap, the defaults, and
    "show the deadline in the receipt".
- Delete `quadrantOf` and `draftedQuadrant` from `eisenhower.ts` once no
  caller remains.
- Test: the existing MCP unit tests, plus `MCP_IT=1` integration tests
  under `src/lib/mcp`.

**Interfaces — Consumes:** Tasks 1 and 3. Tool inputs:
- `urgent` (optional boolean: the person said urgent, or the dealer is
  waiting);
- `important` (boolean);
- `due_date` (optional: only a date the person said);
- `reason`.

The tool computes the deadline with `suggestDeadline` and the priority with
`derivePriority`, using the **owner's** role.

- [ ] **Step 1: Failing tests.**
  - `planFollowUp` for a rep owner with `{urgent:true, important:false}`
    on 2026-11-10 → `{priority:"PLAN", due_date:"2026-11-12"}`.
  - The same with an admin owner → `"DELEGATE"`.
  - An integration test: `update_follow_up` on a non-PK follow-up that has
    a priority and an `activity_id` (a visit debrief) is **not** refused as
    a PK item.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run` and
  `MCP_IT=1 npx vitest run src/lib/mcp` (local stack up) → PASS.
- [ ] **Step 5:** Commit `feat(connector): the agent records importance and a deadline; the code applies the urgent cap`.

### Task 7: Cache carries what the Home needs

**Files:**
- Modify: `src/lib/offline/types.ts`. Add to `CachedAgendaItem`:
  - `owner_id: string | null`;
  - `priority: string | null`;
  - `important: boolean | null`;
  - `entered_by: string | null`;
  - `entered_by_name: string | null`;
  - `source_type: string | null` (the linked activity's `activity_type`);
  - `account_name: string | null`, only if the cached accounts do not
    already cover it (check `CachedAccount`; prefer the existing accounts
    cache).
- Modify: `src/lib/offline/supabase-backend.ts`, the select at about
  line 118. Add the columns, plus the embeds
  `enterer:memberships!next_actions_entered_by_fkey(users(full_name))` and
  `activity:activities!next_actions_activity_id_fkey(activity_type)`.
  Name the FK in each embed: next_actions has more than one FK to
  memberships and to activities, so an unnamed embed is ambiguous. Look up
  the real constraint names in the migrations. Flatten them into the cached
  fields.
- Modify: the offline layer's schema version, if it has one (grep
  `version` in `src/lib/offline`), so old caches refill.
- Test: the existing offline backend tests.

- [ ] **Step 1:** Failing test: the backend maps a fetched row into
  `owner_id`, `important`, `entered_by_name` and `source_type`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS, then `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(offline): cached agenda items carry owner, importance and who gave them`.

### Task 8: Home block "Your action items" + the My work page

**Files:**
- Create: `src/lib/domain/my-work.ts` and
  `src/lib/domain/__tests__/my-work.test.ts`.
- Create: `src/components/your-action-items.tsx` (the Home block).
- Create: `src/app/my-work/page.tsx` (the client page).
- Modify: `src/app/home/home-client.tsx`:
  - render `<YourActionItems>` between `DaySpine` and `YourPksCard`, for
    the rep Home only;
  - replace the UTC `isoDate` (lines 116-123) with `localIsoDate` from
    Task 1 for `todayIso`.
- Modify: `src/app/globals.css`. Add classes `.ai-block`, `.ai-box`,
  `.ai-from` and `.mw-*`, modelled on the mockup
  `.superpowers/mockups/rep-home-action-items.html` (option B).

**Interfaces — Consumes:** Tasks 1 and 7.

**Interfaces — Produces** (`my-work.ts`):
- `type Box = "DO_NOW" | "PLAN" | "NONE" | "SCHEDULED"`.
- `boxOf(i: CachedAgendaItem, today: string, ownerGivesWork: boolean): Box | null`:
  - null for closed items and `ELIMINATE`;
  - SCHEDULED for VISIT, CALL and MEETING;
  - otherwise the derived priority (a stored `DELEGATE` for a rep → PLAN;
    null → NONE).
- `countBoxes(items, me, today, gives)` returns
  `Record<Box, { n: number; late: number; soon: number; next: string | null }>`.
  It keeps only `owner_id === me`.
- `givers(items, me, seenAt: string | null, now: string)` returns
  `{ names: string[]; n: number }`. It counts open own items where
  `entered_by` is not null and not `me`, and `created_at > (seenAt ?? now − 7 days)`.
- `groupForPage(items, filter: Box | "ALL" | "NEW", …)` returns
  `{ key: "LATE"|"TODAY"|"SOON"|"LATER"; items }[]`. SOON is "Next 2
  business days". For SCHEDULED items the LATE group reads "Overdue".

**The Home block:**
- Four `Link` boxes to `/my-work?f=do-now|plan|none|scheduled`.
- Sub-lines:
  - "N late" in red;
  - otherwise "N due ≤ 2d" (Do now only);
  - otherwise "next <short date>";
  - "classify them" for No priority.
- A box with 0 is greyed and still tappable.
- The banner: "**Bianca** gave you 2 items", or "**Bianca** and 1 other
  gave you 3 items". It links to `/my-work?f=new`.
- `seenAt` is read from the offline meta store, key `action_items_seen_at`.

**The My work page:**
- Chips: All · Do now · Plan · No priority · Scheduled, plus New when the
  banner has items.
- Grouped lists. A row shows:
  - the action;
  - a tag;
  - the account;
  - `deadlineLabel`;
  - "never closed" on overdue scheduled items;
  - "from a PK" or "from a visit";
  - "from <Name>".
- On mount it writes `action_items_seen_at = now`.
- Row actions (ruling: the Agenda has no edit sheet, so no new editor;
  minimal inline controls):
  - **PK follow-up:** link to `/visits/pk?item=<id>` (the drawer already
    opens from `?item=`).
  - **Other task:** tapping the row unfolds the `ImportanceDeadline`
    control (Task 4) and a **Done** button. The writes go through the same
    outbox `next_action` update op that `usePkItemWrites` uses, or that the
    Agenda's `markDone` uses.
  - **Visit, call or meeting:** link to `/accounts/<account_id>`, as the
    Agenda does, plus the Agenda's **Done**.

- [ ] **Step 1: Failing tests for `my-work.ts`.** The Done-means case from
  the spec:
  - The Lezzer item (due 11-11, important null, entered by Bianca) → NONE.
  - The Dykes item → NONE.
  - Two VISITs due 10-22 and 10-27 → SCHEDULED, `late: 2`.
  - `givers` → `{names:["Bianca"], n:2}`.
  - A rep-owned stored `DELEGATE` → PLAN.
  - Someone else's item is excluded.
  - Friday grouping.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the module, the block, the page and the CSS.
- [ ] **Step 4:** Run `npx vitest run` and `npx tsc --noEmit`. Lint the
  changed files. Seed or insert the Done-means data locally for `tj@gmxgroup.com`.
  Take screenshots at 390 px of:
  - the Home;
  - the page on each chip;
  - the banner clearing after a visit to the page.
  Also check offline: DevTools offline + reload Home → the numbers are
  still shown.
- [ ] **Step 5:** Commit `feat(home): Your action items on the rep Home; My work lists what is open`.

### Task 9: Ship

- [ ] **Step 1:** Run the full `npx vitest run`, then `npx supabase test db`,
  then `MCP_IT=1 npx vitest run src/lib/mcp`, then `npx tsc --noEmit` and
  `npx eslint src`. All must be green.
- [ ] **Step 2:** Apply the migration to prod. Copy
  `20261110120000_deadline_urgency.sql` to the scratchpad and run
  `npx supabase db query --linked -f <that file>`. Then verify with
  separate queries (the CLI shows only the last result):
  - `select count(*) from next_actions where important is not null;`
  - `select jobname from cron.job where jobname='recompute-priorities';`
  - Andre's two items still have `important` null.
- [ ] **Step 3:** `git push origin HEAD:main`. Wait for the Vercel
  production deploy to show READY. If GitHub push fails, deploy through
  Vercel.
- [ ] **Step 4:** On `sales.gmxgroup.com`, view only, as a rep if one is
  available: the Home block renders. Report to Andre.
