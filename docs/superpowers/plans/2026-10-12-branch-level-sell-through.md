# Branch-level Sell-through Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load a distributor's file that has no customer column at branch level, keep every total exact, and make every dealer-keyed reading exclude that house and say so.

**Architecture:** One flag on the upload (`detail`), one nullable column on the row (`dealer_label`), one column on the reading view. In the domain, one predicate (`isBranchLevel`) and one helper (`housesWithoutDetail`) feed the three dealer readings (`recurrence`, `conversion`, the quiet ranking) and the dealer facts; every screen prints the same sentence from `noDetailSentence`. The loader gets a checkbox.

**Tech Stack:** Next.js App Router, Supabase (Postgres, pgTAP), vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-branch-level-sell-through-design.md`

## Global Constraints

- Everything on screen in English.
- Local dev writes to PRODUCTION; migrations are applied over the direct connection and the version recorded by hand (CLI history is drifted).
- `CREATE OR REPLACE VIEW` drops `security_invoker`; every view restates `with (security_invoker = true)`.
- The sentence is one, everywhere: `"<House> sends no dealer detail since <Month YYYY>, so its dealers are not counted"` (plural: "their dealers").
- Branch-level dealer key: `undisclosed:<distributor_id>`; name `"<House> — no dealer detail"`.
- No fallback or inference for a file with no dealer column: only the admin's ticked box loads it, as `detail='branch'`.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01F8dZSZZyp8LJ3k9wyY2SpJ`.

## Review Focus

1. **A house that is branch-level in the NEWEST month but dealer-level in the previous one** (Boise Sep vs Aug). Expected: excluded from kept/stopped/new, named with "since September 2026"; the August dealers are NOT "dropped". Pinned in Task 2 (`recurrence` test).
2. **A house that is branch-level in BOTH compared months.** Expected: excluded, same sentence, no exception thrown. Pinned in Task 2.
3. **A dealer supplied by two houses, one of which went branch-level.** Expected: still judged against the house that has detail; `detailEnded` names the blind house; silence is not declared from the blind month. Pinned in Task 3.
4. **A branch-level row in the dealer lens.** Expected: one band per house, no account, no module; the region total still matches. Pinned in Task 2 (`entityAt`) and checked on screen in Task 7.
5. **An admin loads a file that DOES have a customer column with the box ticked.** Expected: the box is only offered when no dealer column is mapped; if both are set the plan uses the column. Pinned in Task 4 (`mappingProblem`/`buildImport` tests).

---

### Task 1: Schema — `detail` on uploads, nullable label, view column

**Files:**
- Create: `supabase/migrations/20261012180000_branch_level_sell_through.sql`
- Create: `supabase/tests/21_branch_level_sell_through.test.sql`

- [ ] **Step 1: pgTAP test** (CI runs it; no local runner)

```sql
-- supabase/tests/21_branch_level_sell_through.test.sql
-- Branch-level sell-through · tests 21 (20261012180000).
-- 1. An upload says its detail level; only dealer/branch are allowed.
-- 2. A branch-level row has no label and the view says which it is.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select col_default_is('public', 'sell_through_uploads', 'detail', '''dealer''::text', 'uploads default to dealer detail');
select col_is_null('public', 'sell_through', 'dealer_label', 'a branch-level row has no label');
select has_column('public', 'sell_through_rows', 'detail', 'the reading view carries the level');

create temp table u as
  select id, org_id, distributor_id from sell_through_uploads limit 1;
select throws_like(
  $$ update sell_through_uploads set detail = 'customer' where id = (select id from u) $$,
  '%detail%', 'detail rejects anything but dealer/branch');
select lives_ok(
  $$ update sell_through_uploads set detail = 'branch' where id = (select id from u) $$,
  'detail takes branch');

select * from finish();
rollback;
```

- [ ] **Step 2: Migration**

```sql
-- supabase/migrations/20261012180000_branch_level_sell_through.sql
-- BRANCH-LEVEL SELL-THROUGH (Andre, 2026-10-12; spec 2026-10-12-branch-level-sell-through).
--
-- Boise Cascade's file lost its customer column for good. A file like that
-- is loaded BY BRANCH: the upload says so, its rows carry no dealer, and
-- every reading keyed on the dealer leaves the house out and says why.
-- Nothing is inferred and nothing is invented: a branch-level row is not a
-- dealer called "undisclosed", it is volume with no dealer.

alter table public.sell_through_uploads
  add column detail text not null default 'dealer'
  check (detail in ('dealer', 'branch'));
comment on column public.sell_through_uploads.detail is
  'dealer: the file named who bought. branch: it only said which branch sold — an admin''s explicit choice at load time.';

alter table public.sell_through alter column dealer_label drop not null;
comment on column public.sell_through.dealer_label is
  'What the file called the dealer, verbatim. Null only on a branch-level upload.';

-- The reading view gains the column (appended, so every reader is untouched).
-- security_invoker is RESTATED on purpose: create or replace drops it.
create or replace view public.sell_through_rows
with (security_invoker = true) as
 SELECT st.org_id, st.period,
        CASE WHEN b.territory_id IS NOT NULL THEN owner.id ELSE d.owner_id END AS rep_id,
        CASE WHEN b.territory_id IS NOT NULL THEN ( SELECT COALESCE(ou.full_name, ou.email) FROM users ou WHERE ou.id = owner.user_id)
             ELSE COALESCE(du.full_name, du.email) END AS rep_name,
    t.id AS region_id, t.name AS region_name,
    owner.id AS market_owner_id,
    ( SELECT COALESCE(ou.full_name, ou.email) FROM users ou WHERE ou.id = owner.user_id) AS market_owner_name,
    dist.id AS distributor_id, dist.name AS distributor_name,
    b.id AS branch_id, b.name AS branch_name, b.city AS branch_city, b.state AS branch_state,
    d.id AS dealer_id, d.name AS dealer_name, st.dealer_label,
    st.product, st.quantity, st.unit, st.value, st.ly_quantity,
    u.period_kind,
    ha.id IS NOT NULL AS is_house_account, ha.kind AS house_account_kind,
    st.id AS row_id, st.product_line,
    u.detail
   FROM sell_through st
     JOIN sell_through_uploads u ON u.id = st.upload_id
     JOIN distributor_branches b ON b.id = st.branch_id
     JOIN accounts dist ON dist.id = b.distributor_id
     LEFT JOIN territories t ON t.id = b.territory_id
     LEFT JOIN LATERAL ( SELECT m2.id, m2.user_id FROM memberships m2
          WHERE m2.territory_id = t.id AND m2.org_id = st.org_id AND m2.role = 'rep'::membership_role
          ORDER BY m2.created_at LIMIT 1) owner ON true
     LEFT JOIN accounts d ON d.id = st.dealer_id
     LEFT JOIN memberships m ON m.id = d.owner_id
     LEFT JOIN users du ON du.id = m.user_id
     LEFT JOIN distributor_house_accounts ha ON ha.org_id = st.org_id AND ha.distributor_id = dist.id AND ha.dealer_label = st.dealer_label;
```

(`sell_through_periods` selects named columns from this view and needs no change; verify after applying: `select detail, count(*) from sell_through_rows group by 1`.)

- [ ] **Step 3: Apply to production** over the direct connection (pg script, as for 20261012160000), record version `20261012180000` in `supabase_migrations.schema_migrations`, verify `select count(*) from sell_through_rows where detail='dealer'` equals the row count before.
- [ ] **Step 4: Commit** `feat(db): branch-level sell-through — detail on uploads, nullable label, view column`.

---

### Task 2: Domain — `isBranchLevel`, `dealerKey`, `entityAt`, `housesWithoutDetail`, `noDetailHouses` in `recurrence` and `conversion`, `noDetailSentence`

**Files:**
- Modify: `src/lib/domain/sell-through.ts`
- Test: `src/lib/domain/__tests__/sell-through.test.ts`

**Interfaces (Produces):**
```ts
export interface SellThroughRow { …; dealer_label: string | null; detail?: "dealer" | "branch" | null }
export const UNDISCLOSED_PREFIX = "undisclosed:";
export function isBranchLevel(r: Pick<SellThroughRow, "detail">): boolean
export function dealerKey(r: SellThroughRow): string            // dealer_id ?? (branch-level ? undisclosed:<dist> : label)
export function dealerDisplayName(r: SellThroughRow): string    // dealer_name ?? displayDealerLabel(label) ?? "<House> — no dealer detail"
export interface NoDetailHouse { name: string; since: string }  // since = "YYYY-MM-DD" of the earliest branch-level month
export function housesWithoutDetail(rows, period: string): Set<string>   // distributor ids with rows in `period` and NONE at dealer level
export function noDetailHouses(rows, periods: string[]): NoDetailHouse[]  // houses branch-level in ANY of `periods`, each with its earliest branch-level month on file
export function noDetailSentence(houses: NoDetailHouse[]): string | null  // null when empty
Recurrence.noDetailHouses: NoDetailHouse[]; Conversion.noDetailHouses: NoDetailHouse[]
```

- [ ] **Step 1: Failing tests** (append to the sell-through suite; use the file's existing `row()` fixture helper — read its signature first — adding `detail` and `dealer_label: null` where needed)

```ts
describe("branch-level rows (Boise, 2026-10-12)", () => {
  it("entityAt keys a branch-level row on the house, with no account", () => {
    const e = entityAt(row({ distributor_id: "boise", distributor_name: "Boise Cascade", dealer_id: null, dealer_label: null, detail: "branch" }), "dealer");
    expect(e.key).toBe("undisclosed:boise");
    expect(e.name).toBe("Boise Cascade — no dealer detail");
    expect(e.accountId).toBeNull();
  });
  it("housesWithoutDetail names a house whose month has no dealer rows", () => {
    const rows = [
      row({ distributor_id: "boise", period: "2026-09-01", dealer_label: null, detail: "branch" }),
      row({ distributor_id: "hw", period: "2026-09-01", dealer_label: "A" }),
    ];
    expect([...housesWithoutDetail(rows, "2026-09-01")]).toEqual(["boise"]);
    expect([...housesWithoutDetail(rows, "2026-08-01")]).toEqual([]);
  });
  it("recurrence leaves a house out from its first branch-level month and names it", () => {
    const rows = [
      row({ distributor_id: "boise", distributor_name: "Boise Cascade", period: "2026-08-01", dealer_label: "Ganahl", quantity: 100 }),
      row({ distributor_id: "boise", distributor_name: "Boise Cascade", period: "2026-09-01", dealer_label: null, detail: "branch", quantity: 90 }),
      row({ distributor_id: "hw", distributor_name: "Hardwoods", period: "2026-08-01", dealer_label: "Valencia", quantity: 10 }),
      row({ distributor_id: "hw", distributor_name: "Hardwoods", period: "2026-09-01", dealer_label: "Valencia", quantity: 12 }),
    ];
    const r = recurrence(rows, "2026-09-01", "2026-08-01")!;
    expect(r.dropped.count).toBe(0);           // Ganahl did not "stop"
    expect(r.again.dealers.map((d) => d.name)).toEqual(["Valencia"]);
    expect(r.noDetailHouses).toEqual([{ name: "Boise Cascade", since: "2026-09-01" }]);
    expect(r.oneFileHouses).toEqual([]);
  });
  it("recurrence survives a house branch-level in both months", () => {
    const rows = [
      row({ distributor_id: "boise", period: "2026-08-01", dealer_label: null, detail: "branch", quantity: 5 }),
      row({ distributor_id: "boise", period: "2026-09-01", dealer_label: null, detail: "branch", quantity: 5 }),
      row({ distributor_id: "hw", period: "2026-08-01", dealer_label: "V", quantity: 1 }),
      row({ distributor_id: "hw", period: "2026-09-01", dealer_label: "V", quantity: 1 }),
    ];
    expect(recurrence(rows, "2026-09-01", "2026-08-01")!.noDetailHouses[0].since).toBe("2026-08-01");
  });
  it("conversion excludes the blind house the same way", () => {
    const rows = [
      row({ distributor_id: "boise", distributor_name: "Boise Cascade", period: "2026-07-01", dealer_id: "acc-g", dealer_label: "Ganahl", quantity: 50 }),
      row({ distributor_id: "boise", distributor_name: "Boise Cascade", period: "2026-08-01", dealer_id: "acc-g", dealer_label: "Ganahl", quantity: 0 }),
      row({ distributor_id: "boise", distributor_name: "Boise Cascade", period: "2026-09-01", dealer_label: null, detail: "branch", quantity: 80 }),
      row({ distributor_id: "hw", distributor_name: "Hardwoods", period: "2026-08-01", dealer_id: "acc-v", dealer_label: "V", quantity: 0 }),
      row({ distributor_id: "hw", distributor_name: "Hardwoods", period: "2026-07-01", dealer_id: "acc-v", dealer_label: "V", quantity: 3 }),
      row({ distributor_id: "hw", distributor_name: "Hardwoods", period: "2026-09-01", dealer_id: "acc-v", dealer_label: "V", quantity: 4 }),
    ];
    const c = conversion(rows, "2026-09-01", "2026-08-01", new Set(["acc-v", "acc-g"]))!;
    expect(c.pool).toBe(1);
    expect(c.noDetailHouses).toEqual([{ name: "Boise Cascade", since: "2026-09-01" }]);
  });
  it("noDetailSentence reads one house or several", () => {
    expect(noDetailSentence([])).toBeNull();
    expect(noDetailSentence([{ name: "Boise Cascade", since: "2026-09-01" }]))
      .toBe("Boise Cascade sends no dealer detail since September 2026, so its dealers are not counted");
    expect(noDetailSentence([{ name: "A", since: "2026-09-01" }, { name: "B", since: "2026-08-01" }]))
      .toBe("A (since September 2026) and B (since August 2026) send no dealer detail, so their dealers are not counted");
  });
});
```

- [ ] **Step 2: Run, see them fail** (`npx vitest run src/lib/domain/__tests__/sell-through.test.ts`).
- [ ] **Step 3: Implement** in `sell-through.ts`:
  - type change; `UNDISCLOSED_PREFIX`; `isBranchLevel`; `dealerKey`; `dealerDisplayName`.
  - `entityAt` dealer case: `if (isBranchLevel(row)) return { key: UNDISCLOSED_PREFIX+row.distributor_id, name: `${row.distributor_name} — no dealer detail`, dim, accountId: null, kind: null, sub: "the house sends no dealer detail" }` before the existing branches; `displayDealerLabel(row.dealer_label ?? "")` where the label is read.
  - `housesWithoutDetail(rows, period)`: houses with a row in `period` (non-YTD) and no row in `period` with `!isBranchLevel`.
  - `noDetailHouses(rows, periods)`: for each house blind in any of `periods`, `since` = min period over all rows of that house with `isBranchLevel`.
  - In `recurrence` and `conversion`: after `housesLatest/housesPrevious`, compute `blind = new Set([...housesWithoutDetail(rows, latest), ...housesWithoutDetail(rows, previous)])`; `bothMonths(id)` also requires `!blind.has(id)`; `oneFileHouses` excludes blind houses (they are named in `noDetailHouses` instead); add `noDetailHouses: noDetailHouses(rows, [latest, previous])` to the result; keys through `dealerKey`, names through `dealerDisplayName`.
  - `dealerWhere`: key through `dealerKey`.
  - `noDetailSentence` uses `periodLabel` (exists) for the month.
- [ ] **Step 4: Green; whole domain suite green; lint.**
- [ ] **Step 5: Commit** `feat(sell-through): a branch-level house is left out of the dealer readings and named`.

---

### Task 3: Dealer facts — months with detail only, `detailEnded`

**Files:**
- Modify: `src/lib/domain/dealer-profile.ts`
- Test: `src/lib/domain/__tests__/dealer-profile.test.ts`

**Interfaces:** `DealerFacts.detailEnded: { house: string; since: string }[]`; `dealerKeyOf` delegates to `dealerKey`.

- [ ] **Step 1: Failing tests**

```ts
it("does not call a dealer silent in a month its house sent by branch", () => {
  const rows = [
    row({ distributor_id: "boise", distributor_name: "Boise Cascade", period: "2026-08-01", dealer_id: "acc-g", dealer_label: "Ganahl", quantity: 100 }),
    row({ distributor_id: "boise", distributor_name: "Boise Cascade", period: "2026-09-01", dealer_label: null, detail: "branch", quantity: 50 }),
  ];
  const f = dealerFacts(new Set(["acc-g"]), rows)!;
  expect(f.silentIn).toBeNull();
  expect(f.filesOnHand).toEqual(["2026-08-01"]);
  expect(f.detailEnded).toEqual([{ house: "Boise Cascade", since: "2026-09-01" }]);
});
it("judges silence against the house that still has detail", () => {
  const rows = [
    row({ distributor_id: "boise", distributor_name: "Boise Cascade", period: "2026-08-01", dealer_id: "acc-g", dealer_label: "Ganahl", quantity: 100 }),
    row({ distributor_id: "boise", distributor_name: "Boise Cascade", period: "2026-09-01", dealer_label: null, detail: "branch", quantity: 50 }),
    row({ distributor_id: "hw", distributor_name: "Hardwoods", period: "2026-08-01", dealer_id: "acc-g", dealer_label: "GAN - GANAHL", quantity: 10 }),
    row({ distributor_id: "hw", distributor_name: "Hardwoods", period: "2026-09-01", dealer_id: "acc-v", dealer_label: "V", quantity: 10 }),
  ];
  const f = dealerFacts(new Set(["acc-g"]), rows)!;
  expect(f.silentIn).toBe("2026-09-01");     // Hardwoods' September names dealers and Ganahl is not in it
  expect(f.detailEnded).toEqual([{ house: "Boise Cascade", since: "2026-09-01" }]);
});
```

- [ ] **Step 2: Fail. Step 3: Implement:** `myHouses = new Set(mine.map(r => r.distributor_id))`; `filesOnHand` and `monthFiles` = periods having at least one row from `myHouses` with `!isBranchLevel`; `detailEnded` = for each house in `myHouses` with any branch-level row, `{house, since: min branch-level period}`; `labels` filters nulls; `name` falls back to `dealerDisplayName`. **Step 4: Green, lint. Step 5: Commit** `feat(dealer-profile): silence is judged only against months with dealer detail`.

---

### Task 4: Importer — `branchOnly`

**Files:**
- Modify: `src/lib/domain/sell-through-import.ts`
- Test: `src/lib/domain/__tests__/sell-through-import.test.ts`

**Interfaces:** `mappingProblem(mapping, opts?: { branchOnly?: boolean })`; `buildImport(sheet, mapping, ctx, opts?: { branchOnly?: boolean })`; `PlannedRow.dealerLabel: string | null`.

- [ ] **Step 1: Failing tests**

```ts
describe("a file with no customer column (Boise, 2026-10-12)", () => {
  it("mappingProblem still refuses it unless the admin says branch-only", () => {
    const m = { ...EMPTY_MAPPING, branch: 0, product: 1, quantity: 2 };
    expect(mappingProblem(m)).toBe("Say which column holds the dealer.");
    expect(mappingProblem(m, { branchOnly: true })).toBeNull();
  });
  it("buildImport by branch keeps every line with no dealer at all", () => {
    const sheet = rowsToSheet([["Branch", "Item", "Qty", "UOM"], ["Riverside", "1X6-16' THERMO", "10", "PC"]]);
    const m = { ...EMPTY_MAPPING, branch: 0, product: 1, quantity: 2, unit: 3 };
    const plan = buildImport(sheet, m, { branches: [BRANCH_RIVERSIDE], dealers: [], aliases: [] }, { branchOnly: true });
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].dealerId).toBeNull();
    expect(plan.rows[0].dealerLabel).toBeNull();
    expect(plan.unmatched).toEqual([]);
  });
  it("a mapped customer column wins over the box", () => {
    const sheet = rowsToSheet([["Branch", "Customer", "Qty"], ["Riverside", "Ganahl", "10"]]);
    const m = { ...EMPTY_MAPPING, branch: 0, dealer: 1, quantity: 2 };
    const plan = buildImport(sheet, m, { branches: [BRANCH_RIVERSIDE], dealers: [], aliases: [] }, { branchOnly: true });
    expect(plan.rows[0].dealerLabel).toBe("Ganahl");
  });
});
```
(Use the suite's existing sheet/branch fixtures; adjust names to what the file defines.)

- [ ] **Step 2: Fail. Step 3: Implement:** `const byBranch = opts?.branchOnly && mapping.dealer < 0;` `dealerLabel = byBranch ? null : at(row,"dealer")`; subtotal check uses `dealerLabel ?? ""`; the skip test `dealerLabel !== null && dealerLabel.length === 0`; `dealerId = dealerLabel === null ? null : …`; unmatched summary and `unconvertible.label` skip/`"(by branch)"` when null. **Step 4: Green, lint. Step 5: Commit** `feat(import): a file with no customer column loads by branch, on the admin's word`.

---

### Task 5: Loader page — the box, the upload's `detail`, the list

**Files:**
- Modify: `src/app/sell-through/page.tsx`

- [ ] FIELDS `dealer` → `need: false`. State `const [branchOnly, setBranchOnly] = useState(false)`; reset to false when the sheet changes. Under the mapping table, when `mapping.dealer < 0`:
```tsx
<label className="flex items-start gap-2 t-sub">
  <input type="checkbox" checked={branchOnly} onChange={(e) => setBranchOnly(e.target.checked)} />
  <span>
    This file has no customer column. Load it <strong>by branch</strong>: totals count, dealers do not —
    every reading of who bought leaves this house out and says so.
  </span>
</label>
```
- [ ] `mappingProblem(mapping, { branchOnly })`; `buildImport(…, { branchOnly })`.
- [ ] `save()`: upload insert gains `detail: branchOnly && mapping.dealer < 0 ? "branch" : "dealer"`; `unmatched_count: byBranch ? 0 : …`.
- [ ] Uploads list: when `u.detail === "branch"` print `" · by branch · no dealer detail"` instead of the unnamed count (add `detail` to the uploads select).
- [ ] Plan summary: when by branch, the "N dealers matched" line reads "Loaded by branch — no dealers in this file."
- [ ] Lint, type-check, screenshot of the box. **Commit** `feat(sell-through): the loader takes a file with no customer column, by branch`.

---

### Task 6: Screens — the sentence everywhere, the quiet ranking, the map, the cards, the module

**Files:**
- Modify: `src/app/home/manager-home.tsx`, `src/app/reps/page.tsx`, `src/components/sales-map.tsx`, `src/components/team-sales.tsx`, `src/components/dealer-module.tsx`

- [ ] **manager-home:** `SELL_COLS` adds `detail`. `quietRanking`: `const blind = housesWithoutDetail(monthlyRows, latest)` (and for `quietYtd`, also `housesWithoutDetail(monthlyRows, latest)` — a house blind in the newest month cannot be judged in either mode); skip rows with `blind.has(r.distributor_id)` in `base` and `later`; keys via `dealerKey`, names via `dealerDisplayName`; return `noDetail: noDetailHouses(monthlyRows, [latest])`. "Who kept buying" header: after the oneFileHouses clause add `` · ${noDetailSentence(recur.noDetailHouses)} `` when non-null. "Account gone quiet" header: same sentence from `quietRanking.noDetail`.
- [ ] **reps/page:** `SELL_COLS` adds `detail`. Stopped buying hint: `` `${…} went silent · Aug against Jul${lost.noDetailHouses.length ? ` · ${noDetailSentence(lost.noDetailHouses)}` : ""}` ``. Conversion tile: same with `conv.noDetailHouses`. `noCompareReason`: unchanged.
- [ ] **sales-map:** build `branchDealers` only for `!isBranchLevel(r)`, keyed by `dealerKey(r)`, named by `dealerDisplayName(r)`; pin gains `blind: qty > 0 && dealers.length === 0 && rows.some(r => r.branch_id === b.id && isBranchLevel(r))`; the count text reads "no dealer detail" when `blind`; tooltip likewise.
- [ ] **team-sales `cardExtras`:** dealers from `!isBranchLevel(r)` via `dealerKey`/`dealerDisplayName`; add `undisclosed: { house: string; qty: number }[]`; render after "+N more dealers": `` · {house}: no dealer detail `` per house.
- [ ] **dealer-module:** after the overview sentence, when `facts.detailEnded.length > 0`: `<p className="t-hint">{facts.detailEnded.map(d => `${d.house} stopped sending dealer detail in ${periodLabel(d.since)} — purchases through them are no longer visible here.`).join(" ")}</p>`. Month columns already follow `filesOnHand`.
- [ ] Lint, type-check, `npx vitest run`. **Commit** `feat(desk): every dealer reading names the house that sends no dealer detail`.

---

### Task 7: Boise September, on screen, shipped

- [ ] As Bianca on the dev server (writes to production): `/sell-through`, Boise Cascade, month September 2026, file `docs/boise/2026-09-boise-sell-through-AS-RECEIVED.xlsx`, tick the box, load. Expected plan: 284 lines minus subtotals, PC → LF through the item length; the README's branch raw quantities reconcile.
- [ ] Screens, screenshots at desk and phone: Sales board (totals include Sep; "Who kept buying" names Boise; "Account gone quiet" names Boise and lists no Boise dealer), Reps board tiles (sentence), map (Boise pins say "no dealer detail"), a Boise dealer's module (detail ended in September), dealer lens (one "Boise Cascade — no dealer detail" band).
- [ ] `git push origin main`, `npx vercel --prod --yes`, probe production.
- [ ] Update `docs/boise/README.md` (September: loaded by branch on 2026-10-12) and the memory `boise-september-and-the-upload-cadence.md`. Spec status → shipped. **Commit** `docs: Boise September loaded by branch`.
