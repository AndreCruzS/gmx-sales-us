# Boise Cascade — the paper on file

- `2026-07-boise-sell-through.xlsx` — July 2026. Columns
  `Branch / Item / Customer Name / Qty / LY Qty / UOM`. Note the order: Item
  comes BEFORE Customer Name here and after it in August. The loader maps by
  header name, so the swap costs nothing — but a reader comparing the two by
  eye will be caught out.
- `2026-08-boise-sell-through.xlsx` — August 2026, columns
  `Branch / Customer Name / Item / Qty / LY Qty / UOM`.
- `2026-09-boise-sell-through-AS-RECEIVED.xlsx` — September 2026, loaded BY
  BRANCH (see below). Columns `Branch / Item / Qty / LY Qty / UOM` — five, not
  six. Kept here exactly as it arrived, unedited, because the rule at the foot
  of this file applies to the bad ones too.
- `2026-09-boise-riverside-AS-RECEIVED.xlsx` — September 2026, **Riverside
  Branch's own sheet**, columns `Branch / Item / Customer Name / Qty / LY Qty /
  UOM`, Riverside only. Loaded 2026-10-13 as a branch sheet (see below).

## September 2026 — Riverside sends its own sheet with customers (2026-10-13)

Bianca received a Riverside-only sheet for September with the customer column
back: 223 lines, 78 `Total` subtotals, 140 sales lines (5 blank/zero), 19
customers, 6,186 PC → **46,651 LF — exactly what the by-branch file gave
Riverside**. Loaded as a **branch sheet** (upload `branch_id` = Riverside,
`detail = 'dealer'`): it replaced Riverside's 140 blind rows inside the
by-branch September (now 132 rows) and left the other seven branches as they
were. Totals unchanged at 72,211 LF. Other branches may follow — each sheet
loads the same way, one branch at a time; none is assumed.

Since then every dealer reading judges "no dealer detail" per BRANCH and
month: Riverside's dealers are back in kept buying / stopped / new, the quiet
register, the conversion rate and the dealer module; the other seven branches'
dealers stay out and the screen says "Boise Cascade sends no dealer detail for
Atlanta, Dallas, Detroit, Houston, Memphis, Nashville and Salt Lake since
September 2026, so dealers buying there are not counted". Spec:
`docs/superpowers/specs/2026-10-13-branch-sheet-sell-through-design.md`.

Three Riverside labels could not be matched and loaded under their own
spelling: `HARSPPDE - HARDWOODS SPECIALTY PROD US LP` (1,408 LF — another
distributor, a house-to-house sale, Bianca to decide whether it is a house
account), `LAMELLA - LA MESA LUMBER CO` (1,082 LF), `ZZGLOFOLAV - GLOBAL FOREST
LUMBER COMPANY` (0 LF, LY only).

## September 2026 — the customer column is missing

**LOADED BY BRANCH on 2026-10-12** (272 rows, 11,118 raw → 72,211 LF, upload
`detail = 'branch'`), after Boise refused for good to put the customer column
back (Andre, 2026-10-12). From this month on every Boise file loads this way:
the loader's "This file has no customer column — load it by branch" box, ticked
by an admin. Totals by region, branch and product count it; every reading of
WHO bought (kept buying / stopped / new, gone quiet, conversion rate, the dealer
module, the map's dealer counts) leaves Boise out from September 2026 and says
so on the screen. Spec: `docs/superpowers/specs/2026-10-12-branch-level-sell-through-design.md`.
The paragraphs below describe the file as it arrived and why it was first refused.


Cory Dalos sent it on 2026-10-05 (Bianca forwarded it; Andre confirmed the
month on 2026-10-06 — nothing inside the file says so). It carries
**no `Customer Name` column at all**: 284 detail lines that say which branch
sold what, and nothing about who bought it.

The loader refuses it, by design — `mappingProblem()` in
`src/lib/domain/sell-through-import.ts` stops at *"Say which column holds the
dealer."* That refusal is doing its job. Loaded branch-only, September would
read as every Boise dealer going silent at once, straight into the gone-quiet
register, the recurrence strip and the rep conversion rate.

What it holds, for whoever reconciles the real file when it comes (raw Qty, the
file's own units — 270 lines PC, 13 LF, 1 unmarked):

| branch | Qty | LY Qty |
|---|---:|---:|
| Atlanta | 7 | 70 |
| Dallas | 1,872.5 | 1,159 |
| Detroit | 1,611 | 0 |
| Houston | 147 | 0 |
| Memphis | 601 | 0 |
| Nashville | 0 | 419 |
| Riverside | 6,186 | 3,037 |
| Salt Lake | 693 | 12,700 |
| **total** | **11,117.5** | **17,385** |

Those figures match no month already in the book — July was 10,700 and August
12,442 by the same raw-quantity measure — which is the other half of the proof
that this is a new month and not a re-send.

**Asked of Boise:** the same report with `Customer Name`, as July and August
had it, and the month named on it. **Open with Bianca** (Andre, 2026-10-06):
how we handle a file that arrives without the customer column.

**CADENCE, from 2026-10-06 (Andre):** we upload the month BEFORE — the file
that lands in October is September's. The month is still never written inside
Boise's file, so it is still named by hand at load time.

**BOISE QUOTES IN PIECES, NOT FEET.** 248 of July's 255 detail lines and 265 of
August's 277 carry `UOM = PC`; only a handful are already LF. The length is
inside the item description — `1X6-94" THERMOWOOD` is a 94-inch board — and the
conversion is pieces × inches ÷ 12. This is the opposite of Hardwoods, whose Qty
is linear feet already (see `docs/hardwoods`). Applying the wrong house's rule
would be a silent, enormous error in either direction.

The files are pivots with subtotal rows: a per-customer line whose Item reads
`Total`, and a per-branch grand total. The loader drops them on the whole-cell
match — 142 of them in July, 45 in August.

## Reconciliation, 2026-09-11

Both months were recomputed from the spreadsheet without consulting the loader,
and then again by running the loader itself, to see whether two independent
readings agree.

| month | file | database | gap |
|---|---|---|---|
| July  | 83,153.08 LF | 83,153.11 LF | 0.03, per-row rounding to numeric(14,2) |
| August | 73,720.50 LF | 73,720.45 LF | 0.05, same |

August needed a repair to get there. Two `ZZSAM - SAMPLES` lines at the Detroit
branch, 168 LF each, were in the file and absent from the book; the loader keeps
them, so their absence was never a rule anybody wrote. Restored 2026-09-11
(migration `20260911094200`).

July's row counts differ from the file by design: 69 lines carry quantity 0 with
no last-year figure, which is neither a sale nor lost business, and the loader
skips them.

**KEEP EVERY FILE, INCLUDING THE ONES WE CANNOT LOAD.** September is here as
proof of what was sent and when, so the next conversation with Boise starts
from the document rather than from memory.

**STILL UNVERIFIABLE:** the `boise-ytd-jan-jun-2026.xlsx` upload — 639 rows,
401,454.77 LF, the single largest thing in the book — has no source file kept
anywhere. Nobody can check it. Ask Boise to re-send it, and keep every file from
now on: the upload records only a hashed filename, not the document.
