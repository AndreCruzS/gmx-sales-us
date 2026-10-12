# Branch-level sell-through — design

Status: shipped 2026-10-12 (commits d7bf99e..8c71ac6); approved in conversation by Andre the same day ("precisamos manter ao máximo o que já temos e implementar a solução para a Boise").
máximo o que já temos e implementar a solução para a Boise").

## Why

Boise Cascade's monthly file no longer carries a customer column, and Boise
has refused to add one back. From September 2026 their file says which branch
sold what, and nothing about who bought it. Boise is most of the book.

Nothing is to be faked: no placeholder dealer, no inference. Everything that
reads quantity and branch keeps counting Boise. Everything that reads the
dealer leaves Boise out from the first branch-level month and says so on the
screen, in words, where it would otherwise have shown a number.

## Model

- `sell_through_uploads.detail text not null default 'dealer'`, check
  `in ('dealer','branch')`. A branch-level upload is an admin's explicit
  choice at load time, stored on the upload.
- `sell_through.dealer_label` becomes nullable. A branch-level row has
  `dealer_id null` and `dealer_label null`. Nothing else about the row changes
  (branch, product, quantity in LF, LY, value, product_line).
- `sell_through_rows` gains `detail` (from the upload), appended last.
  `security_invoker = true` restated. `sell_through_periods` is unchanged.
- The alias trigger and the house-account join both key on the label and
  match nothing on null — a branch-level row is never a house account and
  never aliased.

## Rules, reading by reading

**Counts everything, unchanged:** region · branch · product totals and bands,
the month goal, YTD against LY, the map's state colouring and pin size,
`sell_through_periods`, coverage.

**The dealer lens** (dealers ranked by what they bought): branch-level volume
is one band per house at the end, keyed `undisclosed:<distributor_id>`,
named "<House> — no dealer detail", in the unmatched tone, with no account
and no dealer module behind it. Totals still reconcile with the other lenses.

**Who kept buying · stopped · new** (`recurrence`), **conversion rate**
(`conversion`), **gone quiet / fading** (the quiet ranking): a house whose
rows in either compared month are branch-level is treated like a house
missing a month — excluded from the pool, never read as "everyone dropped".
The result names it: `noDetailHouses: {name, since}[]`, where `since` is the
house's earliest branch-level month. Every screen that shows one of these
readings prints the sentence
"Boise Cascade sends no dealer detail since September 2026, so its dealers
are not counted" next to the figure — the Sales board's "Who kept buying"
header, the "Account gone quiet" header, and the Reps board's Stopped buying
and Conversion rate tiles (which today print no exclusion at all).

**The dealer's own page** (`dealerFacts`, dealer module): month files are
only months where at least one of this dealer's houses has dealer detail;
silence is judged only against those. The facts carry
`detailEnded: {house, since}[]` and the module prints "Boise Cascade stopped
sending dealer detail in September 2026 — purchases through them are no
longer visible here." The month columns stop at the last detailed month.

**The map:** "dealers buying there" counts dealer-level rows only. A pin with
volume and no dealer-level rows reads "no dealer detail" where the count
would be.

**Market cards** (region lens): the top-4 dealer list and "+N more dealers"
read dealer-level rows; when the region also holds branch-level volume the
card adds "· <House>: no dealer detail".

**The loader:** the Customer column is no longer required. When it is not
mapped, a checkbox appears: "This file has no customer column — load it by
branch. Totals count; dealers do not." Only with it ticked does the plan
build; the upload is stored `detail='branch'`, rows with null label,
`unmatched_count 0`. The uploads list says "by branch · no dealer detail"
instead of "N unnamed". `mappingProblem` keeps refusing a file with no
dealer column unless the box is ticked.

**Boise September 2026:** loaded by branch the day this ships, from
`docs/boise/2026-09-boise-sell-through-AS-RECEIVED.xlsx`, month named by hand
(September 2026), PC → LF through the existing conversion.

## What is lost, stated

Dealer-level reading of Boise ends with August 2026. "Who kept buying" and
the quiet register read Hardwoods and Russin only. The rep conversion rate
loses its main source and only recovers with order attribution. None of
these screens will pretend otherwise.

## Testing

- vitest: `entityAt` on a branch-level row; `recurrence` and `conversion`
  exclude and name a branch-level house; the quiet ranking's exclusion
  helper; `dealerFacts` silence and `detailEnded`; `mappingProblem` with the
  box; `buildImport` by branch keeps rows with a null label.
- pgTAP suite 21: `detail` check, nullable label, the view column.
- Screen: Bianca loads Boise September by branch; Sales board totals rise,
  "Who kept buying" names Boise; Reps tiles name Boise; a Boise dealer's
  module says detail ended in September; the map's Boise pins say "no dealer
  detail".
