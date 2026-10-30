# Dealers page — design

Date: 2026-10-30 · Status: draft for review · Mockup: https://claude.ai/artifact/CZEf2FFdih7iLYXKHP8eGx

## 1. Why

In the 27 Oct meeting Bianca asked for a page that answers "which dealers need what from us, and are we keeping our word?" Today the answer is spread over her visit-report emails, rep notes and memory. The Dealers page is the admin action page for Bianca and João. Accounts stays the registry, Sales stays the numbers, and reps keep their own to-dos on their home page.

Nav: **Sales · Dealers · Reps · Accounts** (agreed in the meeting).

## 2. Scope

**In**
1. Overview: tier KPIs, tier map by market, dealers of a market, "Work on harder" list, to-dos split the way Bia's reports split them, rep estimate vs actual.
2. Dealer sheet, opening beside the map: tier and priority, goal and progress, potential, last visit and what is pending, visit timeline, promises to this dealer, estimate vs actual chart.
3. Bia's four sections in visit capture.
4. AI proposals from client email (confirm before they count).
5. Rep monthly estimates.
6. Optional email backfill.

**Out**
- Dealer dots on the map. Files carry no dealer addresses; markets are coloured instead, as on the sales map.
- California region by dealer city. Blocked by data (97% of sell-through rows carry no dealer city); explained to Bia and João separately.
- Rep home/travelling status and quoted-LF pipeline per rep. These belong to the Reps page.
- Auto-pricing.

**Audience:** admins only, desktop. Reps feed it from their phones.

## 3. Meeting asks → where they live

| # | Bia's ask (27 Oct) | Where |
|---|---|---|
| 1 | Open a dealer: last visit, what is pending, visit history, number of visits | Dealer sheet |
| 2 | A goal per dealer and progress (Buren: one truck a month in 12 months) | `dealer_goals`, sheet |
| 3 | Potential next to volume: stores, product lines, public research, rep view, registration questions | `dealer_potential`, overview column, sheet |
| 4 | Leadership picks the accounts to work on harder | `dealer_priorities` (★) |
| 5 | Promises per dealer, to see over-promising | Kept-promise rule, sheet |
| 6 | Rep monthly estimate per account vs actual (João) | `rep_estimates` |
| 7 | Assistants enter for executives | `next_actions.entered_by` |
| 8 | History from past email | Optional backfill (phase 5) |

## 4. Data

### Reused
- **`activities`** = visits. `what_happened` holds the summary; the timeline and "last visit" read from it.
- **`next_actions`** = every to-do. New columns:
  - `kind` enum: `action`, `coordinate`, `follow_up`, `promise`, `deadline`. The overview tabs are Action items (`action`, `promise`, `deadline`), To coordinate, Follow-ups.
  - `source` enum: `manual`, `voice`, `visit_capture`, `email_ai`, `email_backfill`; `source_ref` text (message id or voice capture id).
  - `entered_by` → memberships. `owner_id` stays as whose item it is.
  - `status` enum: `proposed`, `open`, `dismissed`. Only `open` items count anywhere. `completed_at` still marks done.
  - `counterparty_account_id` → accounts, for deadlines with a distributor ("Boise: paint finish").
- **`sell_through`**: volume and actuals, always in LF.
- Territory and branch region give the **market**, same rule as the sales map.

### New tables (admin-written, org-scoped, RLS like the rest)
- `dealer_goals` (account_id, target_monthly_lf, target_date, set_by, timestamps). One active goal per dealer. The UI may show trucks once Bia confirms the LF per truck; storage stays LF.
- `dealer_priorities` (account_id, reason, owner_id, set_by, active, timestamps). The ★.
- `dealer_potential` (account_id, store_count, product_lines_carried, research_note, research_url, rep_view, registration_answers jsonb, suggested_tier, timestamps).
- `rep_estimates` (rep_id, account_id, month, estimated_lf, timestamps; unique per rep, account, month).

### Computed
- **Tier view**, trailing 12 months of dealer-level sell-through:
  - T1: dealers that together make up 80% of LF, ranked by LF.
  - T3: fewer than 3 purchase months in the window.
  - T2: the rest.
  - No history: excluded from tiers, listed as targets.
- **Kept promise:** `kind = promise` and `completed_at::date <= due_date`.
- **Promises per visit:** promises to a dealer ÷ its visits, compared with the team average.

## 5. How items get in

1. **Manual:** "+ Add" with dealer, kind, due date, owner, and "entering for".
2. **Say it:** the existing voice command gains promise, coordinate and deadline cards.
3. **Visit capture:** logging a visit offers Bia's four sections. Summary → `what_happened`; Action items, To coordinate and Follow-ups → `next_actions` with that kind and `source = visit_capture`. Bia's emailed reports are a format reference only; the app does not read them.
4. **Client email AI:** reads through the rep's existing Gmail grant and proposes commitments ("we'll send the price sheet by the 5th").

AI rules:
- Items arrive `proposed` and show under "Found in email · confirm" (Confirm / Edit / Dismiss). A dismissed item never returns.
- Every item links to its source.
- The AI never changes a tier, goal or star.
- An unmatched dealer asks "which dealer?" on the card; it does not guess.

**Backfill (optional, last):** one pass over past client email for reps who granted access. Items older than 60 days come in as done, tagged "imported from email".

**Rep estimates:** at the start of each month the rep's home page lists their accounts with an LF box each.

## 6. Edge cases

- Dealer with no sales: "No history · target", never Tier 3.
- Month not loaded yet (sell-through arrives month N−1): show "waiting on <distributor> <month> file", not 0%.
- Branch-level files with no dealer (Boise since Sep 2026): volume counts for the market, not for a dealer; the page says so.
- No goal: "not set" and a "Set goal" link for admins.
- PostgREST 1,000-row cap: page every list with `fetchAllPages`.
- Any replaced view restates `WITH (security_invoker = true)`.

## 7. Permissions

- Admins: read all; write goals, stars, potential.
- Reps: write visits, items and estimates for their own accounts.
- Assistants: write items "for" the executive who delegated to them (`entered_by` ≠ `owner_id`).

## 8. Checks

- pgTAP: the tier view (80% cut, 3-month rule, no-history exclusion), the kept-promise rule, RLS on the new tables and on `proposed` items.
- One read-only run on production data that should land near 22 / 74 / 14 with ~40 untiered.
- Visual check of the overview and the dealer sheet at desktop width with real data.

## 9. Phases

1. Overview, dealer sheet, tier view, new `next_actions` columns and Bia's split, four sections in visit capture.
2. Goals, stars, potential, registration questions.
3. Rep monthly estimates.
4. Client email AI proposals.
5. Optional backfill.

## 10. Open questions

- How many LF in one truck (for showing goals in trucks)?
- The registration question matrix itself: Bia to send her questions and how each answer maps to a tier.
- Bia's own HTML layout suggestion, when it arrives, to be reconciled with the mockup.
