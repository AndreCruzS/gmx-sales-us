# Branch sheets: dealer detail one branch at a time — design

Status: shipped 2026-10-13 (commits c73999a..3f4a22e); approved in conversation
by Andre the same day ("ok" to the path below). Evolves
`2026-10-12-branch-level-sell-through-design.md`. Riverside September 2026
loaded as a branch sheet the same day: 140 rows, 46,651 LF, reconciled to the
cent with the by-branch file.

## Why

Boise Cascade's monthly file still names no customer. But Riverside Branch
now sends its own sheet for the same month, with the same layout plus a
"Customer Name" column, and other branches may follow — or not. Riverside is
65% of Boise's September 2026 (46,651 of 72,211 LF). Yesterday's model
judges "no dealer detail" per HOUSE and month. With Riverside named, Boise
would count as detailed and every dealer buying through Dallas, Salt Lake,
Detroit, Memphis, Houston, Atlanta or Nashville would read as "stopped
buying". And the loader, with the customer column mapped, drops rows whose
customer cell is empty, and holds one upload per house and month, so the
Riverside sheet cannot land beside the by-branch month at all.

Nothing is faked and nothing is assumed: a branch that names its dealers is
read; a branch that does not is left out and named; each branch decides for
itself, month by month.

## Model

- `sell_through_uploads.branch_id uuid null references distributor_branches
  (id) on delete cascade`. Null means the file was the whole house (as
  today). Set means the file was ONE branch's own sheet, loaded for that
  branch only — a **branch sheet**.
- Check: `branch_id is null or detail = 'dealer'`. A branch sheet exists to
  bring dealer detail; a branch sheet without dealers is the house's file.
- The unique index `sell_through_uploads_period_idx (org_id, distributor_id,
  period)` is replaced by one on `(org_id, distributor_id, period,
  coalesce(branch_id, uuid_nil()))`: one whole-house upload per month, plus
  at most one branch sheet per branch per month.
- `sell_through_rows` is unchanged: `detail` already comes from the upload,
  so a Riverside row from the branch sheet reads `dealer` while a Dallas row
  from the house's file reads `branch`. `sell_through_periods` is unchanged
  (checked at implementation: it reads periods, not uploads).

## The loader

**A branch sheet is recognised, then confirmed, never guessed.** When the
plan's rows all sit in ONE branch we already hold and a customer column is
mapped, the loader offers, ticked by default:

> This file holds one branch only — Riverside Branch. Load it as
> Riverside Branch's own sheet: it replaces Riverside Branch in September
> 2026 and leaves every other branch of the month as it is.

Unticked, the file loads as the whole month, replacing everything the house
has for it (today's behaviour), and the existing warning says so.

**Saving a branch sheet** (house H, period P, kind K, branch B):

1. A previous branch sheet for (H, P, K, B) is deleted (its rows cascade).
2. If the whole-house upload for (H, P, K) exists, its rows at branch B are
   deleted and its `row_count` is set to what remains. The upload itself,
   its file in storage and its other branches are untouched.
3. The new upload is inserted with `branch_id = B`, `detail = 'dealer'`,
   its file stored at `<org>/<house>/<period>-<branch-slug>-<filename>`,
   and its rows inserted as today.

**Saving the whole house** when branch sheets exist for (H, P, K): the
plan's rows in those branches are left out, and the screen says, before
Load: "Riverside Branch has its own sheet for September 2026 — 145 rows
with dealer detail. Its 140 rows in this file are left out." Either order
of loading converges on the same book.

**Already loaded** lists a branch sheet as its own line under the month:
"September 2026 · Riverside Branch sheet — 145 rows · dealer detail".
Removing it says: "Its 145 rows go with it. Riverside Branch is then empty
for September 2026 until the house's file is loaded again."

## Reading rules

The blind unit is the **branch and month**, not the house.

- `branchesWithoutDetail(rows, period)`: branches with rows in `period`,
  none of them at dealer level.
- `unknownDealers(rows, blindBranches)`: the keys of every dealer with ANY
  row (any month, YTD included) at a blind branch. Their present cannot be
  read; they are left out of every comparison, never read as dropped, new,
  won back or quiet.
- `NoDetailHouse` gains `branches: string[] | null`: the blind branches'
  short names, or null when every branch the house has rows for in the
  periods read is blind (the whole house).
- `noDetailSentence`:
  - whole house (unchanged): "Boise Cascade sends no dealer detail since
    September 2026, so its dealers are not counted";
  - some branches: "Boise Cascade sends no dealer detail for Dallas, Detroit
    and Salt Lake since September 2026, so dealers buying there are not
    counted";
  - several houses: "A (since September 2026) and B for X and Y (since
    August 2026) send no dealer detail, so their dealers are not counted".
- `recurrence`, `conversion`: a house takes part when it has both months
  on file (unchanged). Rows at blind branches and rows of unknown dealers
  are skipped. `oneFileHouses` no longer subtracts blind houses (a blind
  house still has both months). `noDetailHouses` as above.
- The quiet ranking (monthly mode): the same two skips replace "house
  blind"; the missing-newest-month rule stays.
- `dealerFacts`: a month counts as a file for this dealer only when one of
  the dealer's own BRANCHES had dealer detail in it. `detailEnded` becomes
  `{ house, branches: string[], since }[]` (earliest blind month among those
  branches), and the module prints "Boise Cascade stopped sending dealer
  detail for Dallas Branch in September 2026 — purchases through it are no
  longer visible here." ("for Dallas Branch and Salt Lake Branch … through
  them").
- The map, the dealer lens band, the market cards and the Reps scope are
  already per branch or per row and keep working; the band's second line
  becomes "no dealer detail for this volume".

## What is lost, stated

A dealer that buys through a blind branch — even if it also buys through a
detailed one — is unknown for as long as that branch is blind, and says so
in the sentence. Boise's non-Riverside dealers stay invisible until their
branches send a sheet. Nothing asks Boise for anything.

## Riverside September 2026

Loaded the day this ships, from the sheet Bianca received (saved at
`docs/boise/2026-09-boise-riverside-AS-RECEIVED.xlsx`), as a branch sheet
on top of the by-branch September: 145 data rows, 78 subtotals dropped, 19
customers, 6,186 PC this month against 3,037 last year. Reconciliation:
Riverside's LF after the load against the 46,651 LF the by-branch file
gave it. One line to watch: 1,408 PC to "HARSPPDE - HARDWOODS SPECIALTY
PROD US LP", which is another distributor — Bianca decides at the loader
whether it is a house account.

## Testing

- vitest: `branchesWithoutDetail`; `unknownDealers`; `noDetailHouses` with
  `branches` (partial and whole); `noDetailSentence` three forms;
  `recurrence` keeps a detailed branch's dealers and leaves a blind
  branch's out; `conversion` the same; `dealerFacts` per branch and the
  new `detailEnded` shape; the loader's `sheetBranch` helper.
- pgTAP 23: `branch_id` column; the check; the unique index allows a whole
  upload and a branch sheet for the same month and refuses two whole ones.
- Screen, as Bianca: load the Riverside sheet; Already loaded shows both
  lines; Sales board "Who kept buying" lists Riverside dealers and the
  sentence names the other branches; Reps tiles the same; a Riverside
  dealer's module shows September; a Dallas dealer's module says detail
  ended for Dallas; the map's Riverside pin counts dealers again.
