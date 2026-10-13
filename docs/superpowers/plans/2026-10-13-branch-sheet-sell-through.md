# Branch sheets: dealer detail one branch at a time — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A distributor branch's own sheet (with dealers) loads on top of the house's by-branch month, and every dealer reading judges "no dealer detail" per branch and month instead of per house.

**Architecture:** `sell_through_uploads.branch_id` marks a branch sheet; rows keep coming through `sell_through_rows` with `detail` from their upload. The domain gains `branchesWithoutDetail` and `unknownDealers`, and `NoDetailHouse` learns which branches are blind. The loader recognises a one-branch file, confirms it, and patches the month instead of replacing it.

**Tech Stack:** Next.js App Router, Supabase (Postgres, PostgREST, RLS), vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-10-13-branch-sheet-sell-through-design.md`

## Global Constraints

- Everything on screen in English. Nothing invented: no placeholder dealers, no inferred detail.
- `CREATE OR REPLACE VIEW` drops `security_invoker`; no view is touched by this plan, and if one must be, restate `with (security_invoker = true)`.
- Production DDL goes over the direct pg connection (`POSTGRES_URL_NON_POOLING` without `sslmode`, `ssl:{rejectUnauthorized:false}`) with the version inserted into `supabase_migrations.schema_migrations` by hand; the migration file and pgTAP test are kept for CI.
- PostgREST caps every query at 1,000 rows: page with `fetchAllPages` for anything that can exceed it.
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01F8dZSZZyp8LJ3k9wyY2SpJ`.

## Review Focus

1. A dealer buying through a detailed branch AND a blind branch in the same month must be left out, not half-read (Task 2 test "a dealer at both a blind and a detailed branch is unknown").
2. A whole-house file loaded AFTER a branch sheet must not re-insert the branch's blind rows (Task 5: the plan drops rows in branches that have a sheet).
3. A branch sheet loaded twice must replace itself, never double (Task 1 unique index + Task 5 delete-first).
4. `noDetailSentence` for a house blind everywhere must read exactly as yesterday (Task 2 test keeps the sentence verbatim).
5. The quiet ranking's YTD mode must stay untouched by the per-branch rule (Task 4 keeps the `!quietYtd` guard).

---

### Task 1: Migration — a branch sheet is an upload for one branch

**Files:**
- Create: `supabase/migrations/20261013100000_branch_sheet_uploads.sql`
- Create: `supabase/tests/23_branch_sheet_uploads.test.sql`

**Interfaces:**
- Produces: `sell_through_uploads.branch_id uuid null`; check `branch_sheet_has_dealers`; unique index `sell_through_uploads_period_branch_idx`.

- [ ] **Step 1: Write the pgTAP test**

```sql
-- Branch sheets · tests 23 (20261013100000_branch_sheet_uploads.sql).
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select has_column('public', 'sell_through_uploads', 'branch_id', 'an upload can be one branch''s own sheet');
select hasnt_index('public', 'sell_through_uploads', 'sell_through_uploads_period_idx', 'the old one-per-month index is gone');
select has_index('public', 'sell_through_uploads', 'sell_through_uploads_period_branch_idx', 'one per month per branch (or whole house)');

-- The seed holds a Boise branch; a whole-house July and a Riverside July may coexist.
select lives_ok($$
  insert into sell_through_uploads (id, org_id, distributor_id, period, period_kind, uploaded_by, row_count, unmatched_count, detail, branch_id)
  select 'e0000000-0000-0000-0000-000000000001', b.org_id, b.distributor_id, '2031-07-01', 'MONTH', null, 0, 0, 'dealer', b.id
  from distributor_branches b limit 1;
  insert into sell_through_uploads (id, org_id, distributor_id, period, period_kind, uploaded_by, row_count, unmatched_count, detail, branch_id)
  select 'e0000000-0000-0000-0000-000000000002', b.org_id, b.distributor_id, '2031-07-01', 'MONTH', null, 0, 0, 'branch', null
  from distributor_branches b limit 1;
$$, 'a whole-house month and a branch sheet for the same month coexist');

select throws_like($$
  insert into sell_through_uploads (org_id, distributor_id, period, period_kind, uploaded_by, row_count, unmatched_count, detail, branch_id)
  select b.org_id, b.distributor_id, '2031-08-01', 'MONTH', null, 0, 0, 'branch', b.id
  from distributor_branches b limit 1;
$$, '%branch_sheet_has_dealers%', 'a branch sheet without dealers is refused');

select * from finish();
rollback;
```

- [ ] **Step 2: Write the migration**

```sql
-- BRANCH SHEETS (Andre, 2026-10-13; spec 2026-10-13-branch-sheet-sell-through).
--
-- Boise's monthly file names no customer, but Riverside now sends its own
-- sheet for the same month WITH customers, and other branches may follow.
-- A branch sheet is an upload for ONE branch: it replaces that branch inside
-- the month and leaves the rest as the house's file said. Rows keep reading
-- `detail` from their own upload, so a Riverside row says dealer while a
-- Dallas row from the house's file says branch — the blind unit is now the
-- branch and month, not the house.

alter table public.sell_through_uploads
  add column branch_id uuid references public.distributor_branches (id) on delete cascade;
comment on column public.sell_through_uploads.branch_id is
  'Null: the file was the whole house. Set: one branch''s own sheet, loaded for that branch only.';

-- A branch sheet exists to bring dealer detail. One without dealers is the
-- house''s file and loads as such.
alter table public.sell_through_uploads
  add constraint branch_sheet_has_dealers
  check (branch_id is null or detail = 'dealer');

-- One whole-house upload per month, plus at most one sheet per branch.
drop index if exists public.sell_through_uploads_period_idx;
create unique index sell_through_uploads_period_branch_idx
  on public.sell_through_uploads (org_id, distributor_id, period,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
```

(`uploaded_by` nullability: check the seed/table before relying on `null`; if it is `not null`, select an existing membership id in the test instead.)

- [ ] **Step 3: Apply to production over the direct connection**

Run the scratchpad `pg/apply.cjs` with the URL, the file, version `20261013100000`, name `branch_sheet_uploads`. Expected: commit, no error; `select indexname from pg_indexes where tablename='sell_through_uploads'` lists `sell_through_uploads_period_branch_idx` and not the old one.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261013100000_branch_sheet_uploads.sql supabase/tests/23_branch_sheet_uploads.test.sql
git commit -m "feat(db): an upload can be one branch's own sheet"
```

---

### Task 2: Domain — the blind unit is the branch and month

**Files:**
- Modify: `src/lib/domain/sell-through.ts` (around `housesWithoutDetail`, `NoDetailHouse`, `noDetailHouses`, `noDetailSentence`, `recurrence`, `conversion`, `entityAt` dealer case)
- Test: `src/lib/domain/__tests__/sell-through.test.ts` (the `branch-level rows` describe)

**Interfaces:**
- Produces: `branchesWithoutDetail(rows, period): Set<string>`; `unknownDealers(rows, blindBranches: ReadonlySet<string>): Set<string>`; `NoDetailHouse { name; since; branches: string[] | null }`; `noDetailHouses` and `noDetailSentence` as in the spec. `housesWithoutDetail` stays (houses with every branch blind that month).

- [ ] **Step 1: Write the failing tests** (replace the `branch-level rows (Boise, 2026-10-12)` describe's helpers and add these cases; update the existing `toEqual` shapes to include `branches: null`)

```ts
const blindAt = (branch: string, o: Partial<SellThroughRow>) =>
  blind({ branch_id: branch, branch_name: `${branch} Branch`, ...o });
const namedAt = (branch: string, label: string, o: Partial<SellThroughRow>) =>
  named(label, { branch_id: branch, branch_name: `${branch} Branch`, ...o });

it("branchesWithoutDetail names the blind branches of a month, not the house", () => {
  const rows = [
    namedAt("Riverside", "Ganahl", { period: "2026-09-01" }),
    blindAt("Dallas", { period: "2026-09-01" }),
  ];
  expect([...branchesWithoutDetail(rows, "2026-09-01")]).toEqual(["Dallas"]);
  expect([...housesWithoutDetail(rows, "2026-09-01")]).toEqual([]);
});

it("unknownDealers are those with any row at a blind branch, in any month", () => {
  const rows = [
    namedAt("Dallas", "Lowe's", { period: "2026-08-01" }),
    namedAt("Riverside", "Ganahl", { period: "2026-08-01" }),
    namedAt("Riverside", "Ganahl", { period: "2026-09-01" }),
    blindAt("Dallas", { period: "2026-09-01" }),
  ];
  expect([...unknownDealers(rows, branchesWithoutDetail(rows, "2026-09-01"))]).toEqual(["Lowe's"]);
});

it("noDetailHouses lists the blind branches, or null when the whole house is blind", () => {
  const partial = [
    namedAt("Riverside", "Ganahl", { distributor_name: "Boise Cascade", period: "2026-09-01" }),
    blindAt("Dallas", { distributor_name: "Boise Cascade", period: "2026-09-01" }),
    blindAt("Detroit", { distributor_name: "Boise Cascade", period: "2026-09-01" }),
  ];
  expect(noDetailHouses(partial, ["2026-09-01"])).toEqual([
    { name: "Boise Cascade", since: "2026-09-01", branches: ["Dallas", "Detroit"] },
  ]);
  const whole = [blindAt("Dallas", { distributor_name: "Boise Cascade", period: "2026-09-01" })];
  expect(noDetailHouses(whole, ["2026-09-01"])).toEqual([
    { name: "Boise Cascade", since: "2026-09-01", branches: null },
  ]);
});

it("noDetailSentence names the branches when the house is only partly blind", () => {
  expect(noDetailSentence([{ name: "Boise Cascade", since: "2026-09-01", branches: ["Dallas", "Detroit", "Salt Lake"] }])).toBe(
    "Boise Cascade sends no dealer detail for Dallas, Detroit and Salt Lake since September 2026, so dealers buying there are not counted",
  );
  expect(noDetailSentence([
    { name: "A", since: "2026-09-01", branches: null },
    { name: "B", since: "2026-08-01", branches: ["X", "Y"] },
  ])).toBe("A (since September 2026) and B for X and Y (since August 2026) send no dealer detail, so their dealers are not counted");
});

it("recurrence keeps a detailed branch's dealers and leaves a blind branch's out", () => {
  const rows = [
    namedAt("Riverside", "Ganahl", { period: "2026-08-01", quantity: 100 }),
    namedAt("Riverside", "Ganahl", { period: "2026-09-01", quantity: 90 }),
    namedAt("Dallas", "Lowe's", { period: "2026-08-01", quantity: 40 }),
    blindAt("Dallas", { period: "2026-09-01", quantity: 35 }),
  ];
  const r = recurrence(rows, "2026-09-01", "2026-08-01")!;
  expect(r.again.dealers.map((d) => d.name)).toEqual(["Ganahl"]);
  expect(r.dropped.count).toBe(0);
  expect(r.oneFileHouses).toEqual([]);
  expect(r.noDetailHouses).toEqual([{ name: "Boise Cascade", since: "2026-09-01", branches: ["Dallas"] }]);
});

it("a dealer at both a blind and a detailed branch is unknown", () => {
  const rows = [
    namedAt("Riverside", "Ganahl", { period: "2026-08-01", quantity: 100 }),
    namedAt("Dallas", "Ganahl", { period: "2026-08-01", quantity: 10 }),
    namedAt("Riverside", "Ganahl", { period: "2026-09-01", quantity: 0 }),
    blindAt("Dallas", { period: "2026-09-01", quantity: 35 }),
  ];
  const r = recurrence(rows, "2026-09-01", "2026-08-01");
  expect(r === null || r.dropped.count === 0).toBe(true);
});

it("conversion leaves a blind branch's dealers out of the pool", () => {
  const rows = [
    row({ branch_id: "Dallas", period: "2026-07-01", dealer_id: "acc-l", dealer_name: "Lowe's", quantity: 50 }),
    row({ branch_id: "Dallas", period: "2026-08-01", dealer_id: "acc-l", dealer_name: "Lowe's", quantity: 0 }),
    blindAt("Dallas", { period: "2026-09-01", quantity: 80 }),
    row({ period: "2026-07-01", dealer_id: "acc-g", dealer_name: "Ganahl", quantity: 3 }),
    row({ period: "2026-08-01", dealer_id: "acc-g", dealer_name: "Ganahl", quantity: 0 }),
    row({ period: "2026-09-01", dealer_id: "acc-g", dealer_name: "Ganahl", quantity: 4 }),
  ];
  const c = conversion(rows, "2026-09-01", "2026-08-01", new Set(["acc-l", "acc-g"]))!;
  expect(c.pool).toBe(1);
  expect(c.wonBack).toBe(1);
  expect(c.noDetailHouses[0].branches).toEqual(["Dallas"]);
});
```

- [ ] **Step 2: Run the tests, watch them fail**

Run: `npx vitest run src/lib/domain/__tests__/sell-through.test.ts -t "Boise"`
Expected: FAIL — `branchesWithoutDetail is not a function`, `unknownDealers is not a function`, shape mismatches.

- [ ] **Step 3: Implement**

In `sell-through.ts`, after `housesWithoutDetail`:

```ts
/** Branches with rows in `period` and NONE of them at dealer level — the
 *  blind unit since Riverside's own sheet (2026-10-13). YTD rows do not count. */
export function branchesWithoutDetail(rows: readonly SellThroughRow[], period: string): Set<string> {
  const seen = new Set<string>();
  const detailed = new Set<string>();
  for (const r of rows) {
    if (r.period_kind === "YTD" || r.period !== period) continue;
    seen.add(r.branch_id);
    if (!isBranchLevel(r)) detailed.add(r.branch_id);
  }
  return new Set([...seen].filter((b) => !detailed.has(b)));
}

/** Dealers with ANY row at a blind branch, in any month: their present
 *  cannot be read, so no comparison may count them — not dropped, not new,
 *  not won back, not quiet. */
export function unknownDealers(rows: readonly SellThroughRow[], blindBranches: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (isBranchLevel(r) || !blindBranches.has(r.branch_id)) continue;
    out.add(dealerKey(r));
  }
  return out;
}

export interface NoDetailHouse {
  name: string;
  /** The house's earliest branch-level month on file, YYYY-MM-DD. */
  since: string;
  /** The blind branches' short names; null when every branch the house has
   *  rows for in the periods read is blind — the whole house. */
  branches: string[] | null;
}

export function noDetailHouses(rows: readonly SellThroughRow[], periods: readonly string[]): NoDetailHouse[] {
  const blind = new Set<string>();
  for (const p of periods) for (const b of branchesWithoutDetail(rows, p)) blind.add(b);
  if (blind.size === 0) return [];
  const byHouse = new Map<string, { name: string; since: string | null; branches: Map<string, string>; all: Set<string> }>();
  for (const r of rows) {
    if (r.period_kind === "YTD" || !periods.includes(r.period)) continue;
    const h = byHouse.get(r.distributor_id) ?? { name: r.distributor_name, since: null, branches: new Map(), all: new Set() };
    h.all.add(r.branch_id);
    if (blind.has(r.branch_id)) h.branches.set(r.branch_id, shortBranchName(r.branch_name, r.distributor_name));
    byHouse.set(r.distributor_id, h);
  }
  const out: NoDetailHouse[] = [];
  for (const [id, h] of byHouse) {
    if (h.branches.size === 0) continue;
    let since: string | null = null;
    for (const r of rows) {
      if (r.distributor_id !== id || r.period_kind === "YTD" || !isBranchLevel(r) || !h.branches.has(r.branch_id)) continue;
      if (since === null || r.period < since) since = r.period;
    }
    if (!since) continue;
    const whole = h.branches.size === h.all.size;
    out.push({ name: h.name, since, branches: whole ? null : [...h.branches.values()].sort() });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const listOf = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

export function noDetailSentence(houses: readonly NoDetailHouse[]): string | null {
  if (houses.length === 0) return null;
  if (houses.length === 1) {
    const h = houses[0];
    return h.branches === null
      ? `${h.name} sends no dealer detail since ${periodLabel(h.since)}, so its dealers are not counted`
      : `${h.name} sends no dealer detail for ${listOf(h.branches)} since ${periodLabel(h.since)}, so dealers buying there are not counted`;
  }
  const list = houses.map((h) => `${h.name}${h.branches ? ` for ${listOf(h.branches)}` : ""} (since ${periodLabel(h.since)})`);
  return `${listOf(list)} send no dealer detail, so their dealers are not counted`;
}
```

In `recurrence`: replace the `blind` set and `takesPart` with

```ts
  const blindBranches = new Set([
    ...branchesWithoutDetail(rows, latest),
    ...branchesWithoutDetail(rows, previous),
  ]);
  const unknown = unknownDealers(rows, blindBranches);
  const takesPart = (id: string) => housesLatest.has(id) && housesPrevious.has(id);
```

and in the row loop, after `if (!takesPart(...)) continue;`, add `if (isBranchLevel(r) || blindBranches.has(r.branch_id)) continue; const key = dealerKey(r); if (unknown.has(key)) continue;` (move the existing `const key` line accordingly). `oneFileHouses` filter drops `&& !blind.has(h)`.

In `conversion`: the same — `blindBranches`, `unknown`, `bothMonths` without blind; in the row loop, after the house and region checks: `if (isBranchLevel(r) || blindBranches.has(r.branch_id)) continue;` and after `const key = dealerKey(r);` add `if (unknown.has(key)) continue;`. `oneFileHouses` filter drops `&& !blind.has(h)`.

In `entityAt` dealer case: `sub: "no dealer detail for this volume"`.

- [ ] **Step 4: Run the tests, watch them pass; then the whole file**

Run: `npx vitest run src/lib/domain/__tests__/sell-through.test.ts`
Expected: PASS. Fix any older test whose `noDetailHouses` shape changed (`branches: null`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/sell-through.ts src/lib/domain/__tests__/sell-through.test.ts
git commit -m "feat(sell-through): the blind unit is the branch and month, not the house"
```

---

### Task 3: The dealer's own page judges silence per branch

**Files:**
- Modify: `src/lib/domain/dealer-profile.ts` (`detailEnded`, `detailed`, `filesOnHand`, `monthFiles`)
- Modify: `src/components/dealer-module.tsx` (the `detailEnded` paragraph)
- Test: `src/lib/domain/__tests__/dealer-profile.test.ts`

**Interfaces:**
- Produces: `DealerFacts.detailEnded: { house: string; branches: string[]; since: string }[]`.

- [ ] **Step 1: Write the failing tests** (replace the two existing tests in the Boise describe)

```ts
const blindAt = (branch: string, o: Partial<SellThroughRow>) =>
  blind({ branch_id: branch, branch_name: `${branch} Branch`, ...o });

it("does not call a dealer silent in a month its BRANCH sent by branch", () => {
  const rows = [
    row({ branch_id: "dal", branch_name: "Dallas Branch", period: "2026-08-01", dealer_id: "acc-g", dealer_name: "Ganahl", dealer_label: "Ganahl", quantity: 100 }),
    blindAt("dal", { period: "2026-09-01", quantity: 50 }),
    // Riverside named its dealers in September; Ganahl does not buy there.
    row({ branch_id: "riv", branch_name: "Riverside Branch", period: "2026-09-01", dealer_id: "acc-v", dealer_name: "V", dealer_label: "V", quantity: 10 }),
  ];
  const f = dealerFacts(new Set(["acc-g"]), rows)!;
  expect(f.silentIn).toBeNull();
  expect(f.filesOnHand).toEqual(["2026-08-01"]);
  expect(f.detailEnded).toEqual([{ house: "Boise Cascade", branches: ["dal Branch"], since: "2026-09-01" }]);
});

it("judges silence against the branch that still has detail", () => {
  const rows = [
    row({ branch_id: "riv", branch_name: "Riverside Branch", period: "2026-08-01", dealer_id: "acc-g", dealer_name: "Ganahl", dealer_label: "Ganahl", quantity: 100 }),
    row({ branch_id: "riv", branch_name: "Riverside Branch", period: "2026-09-01", dealer_id: "acc-v", dealer_name: "V", dealer_label: "V", quantity: 10 }),
    blindAt("dal", { period: "2026-09-01", quantity: 50 }),
  ];
  const f = dealerFacts(new Set(["acc-g"]), rows)!;
  expect(f.silentIn).toBe("2026-09-01");
  expect(f.detailEnded).toEqual([]);
});
```

(`blindAt("dal", …)` sets `branch_name: "dal Branch"`; the first test's expected branch name follows from it.)

- [ ] **Step 2: Run, watch fail**

Run: `npx vitest run src/lib/domain/__tests__/dealer-profile.test.ts`
Expected: FAIL on `detailEnded` shape and `silentIn`.

- [ ] **Step 3: Implement** in `dealerFacts`:

```ts
  // A MONTH ONLY COUNTS IF ONE OF THIS DEALER'S BRANCHES NAMED ITS DEALERS
  // in it (Riverside's own sheet, 2026-10-13): a blind Dallas says nothing
  // about a yard that buys at Dallas, and nothing at all about one that
  // buys at Riverside.
  const myBranches = new Set(mine.map((r) => r.branch_id));
  const detailed = rows.filter((r) => myBranches.has(r.branch_id) && !isBranchLevel(r));
  const filesOnHand = [...new Set(detailed.map((r) => r.period))].sort();
  const ended = new Map<string, { branches: Set<string>; since: string }>();
  for (const r of rows) {
    if (!myBranches.has(r.branch_id) || !isBranchLevel(r) || r.period_kind === "YTD") continue;
    const at = ended.get(r.distributor_name) ?? { branches: new Set<string>(), since: r.period };
    at.branches.add(r.branch_name);
    if (r.period < at.since) at.since = r.period;
    ended.set(r.distributor_name, at);
  }
  const detailEnded = [...ended.entries()]
    .map(([house, e]) => ({ house, branches: [...e.branches].sort(), since: e.since }))
    .sort((a, b) => a.house.localeCompare(b.house));
```

`DealerFacts.detailEnded` type updated. In `dealer-module.tsx`:

```tsx
{facts.detailEnded
  .map((d) => {
    const list = d.branches.length <= 1 ? d.branches[0] : `${d.branches.slice(0, -1).join(", ")} and ${d.branches[d.branches.length - 1]}`;
    const them = d.branches.length === 1 ? "it" : "them";
    return `${d.house} stopped sending dealer detail for ${list} in ${periodLabel(d.since)} — purchases through ${them} are no longer visible here.`;
  })
  .join(" ")}
```

- [ ] **Step 4: Run, watch pass; `npx tsc --noEmit`**

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/dealer-profile.ts src/lib/domain/__tests__/dealer-profile.test.ts src/components/dealer-module.tsx
git commit -m "feat(dealer): the dealer's page judges silence per branch"
```

---

### Task 4: The quiet ranking skips blind branches and unknown dealers

**Files:**
- Modify: `src/app/home/manager-home.tsx` (`quietRanking` useMemo, around the `blind`/`out` definitions)

- [ ] **Step 1: Implement** — replace the `blind` set with

```ts
    const blindBranches = new Set<string>([
      ...(latest ? branchesWithoutDetail(monthlyRows, latest) : []),
      ...(previous ? branchesWithoutDetail(monthlyRows, previous) : []),
    ]);
    const unknown = quietYtd ? new Set<string>() : unknownDealers(monthlyRows, blindBranches);
```

`out(houseId)` keeps only the missing-newest-month rule: `!quietYtd && latest !== null && !reported.has(houseId)`. In both row loops (`later` and `base`), after the `out` check add `if (!quietYtd && (isBranchLevel(r) || blindBranches.has(r.branch_id))) continue;` and after `const key = dealerKey(r);` add `if (unknown.has(key)) continue;`. Import `branchesWithoutDetail`, `unknownDealers`, `isBranchLevel`; drop `housesWithoutDetail` if unused.

- [ ] **Step 2: `npx tsc --noEmit` and `npx vitest run`** — Expected: clean, all green.

- [ ] **Step 3: Commit**

```bash
git add src/app/home/manager-home.tsx
git commit -m "feat(home): the quiet ranking skips blind branches and the dealers that buy there"
```

---

### Task 5: The loader — a branch's own sheet patches the month

**Files:**
- Modify: `src/lib/domain/sell-through-import.ts` (add `sheetBranch`)
- Modify: `src/app/sell-through/page.tsx` (`UploadRow`, fetch, state, `existing`, save, list, remove copy)
- Test: `src/lib/domain/__tests__/sell-through-import.test.ts`

**Interfaces:**
- Produces: `sheetBranch(plan: ImportPlan, mapping: Mapping): string | null` — the one known branch id every row sits in when a dealer column is mapped; null otherwise.

- [ ] **Step 1: Write the failing test**

```ts
describe("a branch's own sheet (Riverside, 2026-10-13)", () => {
  it("sheetBranch is the one branch every row sits in, only with a dealer column", () => {
    const m = mapping({ branch: 0, dealer: 1, quantity: 2 });
    const one = buildImport(parseSheet("Branch\tCustomer\tQty\nRiverside\tGanahl\t10\nRiverside\tCorona\t5\n"), m, { branches: BRANCHES, dealers: DEALERS });
    expect(sheetBranch(one, m)).toBe("riv");
    const two = buildImport(parseSheet("Branch\tCustomer\tQty\nRiverside\tGanahl\t10\nModesto\tCorona\t5\n"), m, { branches: BRANCHES, dealers: DEALERS });
    expect(sheetBranch(two, m)).toBeNull();
    const noDealer = mapping({ branch: 0, product: 1, quantity: 2 });
    const blind = buildImport(parseSheet("Branch\tItem\tQty\nRiverside\tX\t10\n"), noDealer, { branches: BRANCHES, dealers: DEALERS }, { branchOnly: true });
    expect(sheetBranch(blind, noDealer)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, watch fail** (`sheetBranch is not a function`).

- [ ] **Step 3: Implement**

```ts
/** A BRANCH'S OWN SHEET (Riverside, 2026-10-13): when every row of a file
 *  with a dealer column sits in one branch we already hold, the file can be
 *  loaded for that branch alone. Returns the branch id, or null. Never a
 *  guess: the loader still asks, this only says the question applies. */
export function sheetBranch(plan: ImportPlan, mapping: Mapping): string | null {
  if (mapping.dealer < 0 || plan.rows.length === 0) return null;
  const ids = new Set(plan.rows.map((r) => r.branchId));
  if (ids.size !== 1) return null;
  const [only] = ids;
  return only ?? null;
}
```

- [ ] **Step 4: The page**

1. `UploadRow` gains `branch_id: string | null`; the uploads select adds `branch_id`.
2. State `const [branchSheet, setBranchSheet] = useState(true);` reset to `true` with the sheet headers (same effect as `branchOnly`).
3. After `plan`: `const sheetBranchId = plan ? sheetBranch(plan, mapping) : null; const asBranchSheet = branchSheet && sheetBranchId !== null; const sheetBranchName = mineBranches.find((b) => b.id === sheetBranchId)?.name ?? null;`
4. `existing` becomes the whole-house upload (`u.branch_id === null`); add `existingSheet = uploads.find(same house/period/kind && u.branch_id === sheetBranchId)` and `sheetsForMonth = uploads.filter(same house/period/kind && u.branch_id !== null)`.
5. Under the mapping table, when `sheetBranchId !== null`:

```tsx
<label className="flex items-start gap-2 t-sub">
  <input type="checkbox" checked={branchSheet} onChange={(e) => setBranchSheet(e.target.checked)} />
  <span>
    This file holds one branch only — <strong>{sheetBranchName}</strong>. Load it as {sheetBranchName}'s own sheet:
    it replaces {sheetBranchName} in {periodLabel(period)} and leaves every other branch of the month as it is.
    Unticked, it loads as the whole month and replaces everything this house has for it.
  </span>
</label>
```

6. The whole-house path: `const leftOut = asBranchSheet ? [] : sheetsForMonth.map((s) => ({ ...s, inFile: plan.rows.filter((r) => r.branchId === s.branch_id).length }))`; rows to write exclude those branches; a `t-sub` line per sheet: "{branch} has its own sheet for {month} — {rows} rows with dealer detail. Its {inFile} rows in this file are left out." `loadable` subtracts them.
7. `save()`: if `asBranchSheet`: delete `existingSheet` if any; if `existing`: `delete from sell_through where upload_id = existing.id and branch_id = sheetBranchId`, then `select count` (head) of its remaining rows and `update sell_through_uploads set row_count`; storage path `${period}-${slug(sheetBranchName)}-${safe}`; insert upload with `branch_id: sheetBranchId, detail: "dealer"`. Else: as today, with the left-out filter and `existing` = whole-house only.
8. The warning under the month: for a branch sheet — "{branch} already has its own sheet for {month} — N rows. Loading again REPLACES it." when `existingSheet`; the whole-house warning unchanged otherwise.
9. The Load button label: `${asBranchSheet ? `${existingSheet ? "Replace" : "Load"} ${sheetBranchName} · ` : `${existing ? "Replace" : "Load"} `}…`.
10. Already loaded: title `{periodLabel(u.period)}{u.period_kind === "YTD" ? " · YTD" : ""}{u.branch_id ? ` · ${branchName(u.branch_id)} sheet` : ""}`; sub for a sheet: "N rows · dealer detail"; armed copy for a sheet: "Its N rows go with it. {branch} is then empty for {month} until the house's file is loaded again." `branchName` reads `branches` state.

- [ ] **Step 5: `npx tsc --noEmit`, `npx vitest run`, then on the dev server as Bianca:** open `/sell-through`, pick Boise, September 2026, drop the Riverside sheet; Expected: the box appears ticked naming Riverside Branch; the button reads "Load Riverside Branch · 145 rows"; do NOT press yet (Task 6 does, after the branch `Total` rows are confirmed dropped in the plan's `subtotals` count = 78).

- [ ] **Step 6: Commit**

```bash
git add src/lib/domain/sell-through-import.ts src/lib/domain/__tests__/sell-through-import.test.ts src/app/sell-through/page.tsx
git commit -m "feat(loader): a branch's own sheet replaces that branch inside the month"
```

---

### Task 6: Riverside September 2026, live, and the record

- [ ] **Step 1:** copy the sheet to `docs/boise/2026-09-boise-riverside-AS-RECEIVED.xlsx`.
- [ ] **Step 2:** as Bianca on the dev server (production database): load it as Riverside's sheet for September 2026. Note the unmatched list (expect "HARSPPDE - HARDWOODS SPECIALTY PROD US LP" and a few others). Expected after load: Already loaded shows "September 2026 · by branch…" and "September 2026 · Riverside Branch sheet — 145 rows"; the by-branch upload's row_count reads 132.
- [ ] **Step 3:** reconcile with pg: `select b.name, u.detail, count(*), round(sum(quantity)) from sell_through s join sell_through_uploads u on u.id=s.upload_id join distributor_branches b on b.id=s.branch_id where u.period='2026-09-01' and b.name ilike 'riverside%' group by 1,2` — Riverside LF from the sheet against 46,651.
- [ ] **Step 4:** screens as Bianca (desk + phone screenshots): Sales board "Who kept buying" lists Riverside dealers with the sentence naming the other branches; Reps tiles; a Riverside dealer's module (Ganahl) shows September; a Dallas-only dealer's module says detail ended for Dallas; the map's Riverside pin counts dealers.
- [ ] **Step 5:** `docs/boise/README.md` (September: by branch + Riverside sheet), memory `boise-september-and-the-upload-cadence.md` updated; spec status "shipped".
- [ ] **Step 6:** commit, push, `npx vercel --prod --yes`, and check CI.
