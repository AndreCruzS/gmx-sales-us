# Boise Cascade — the paper on file

- `2026-07-boise-sell-through.xlsx` — July 2026. Columns
  `Branch / Item / Customer Name / Qty / LY Qty / UOM`. Note the order: Item
  comes BEFORE Customer Name here and after it in August. The loader maps by
  header name, so the swap costs nothing — but a reader comparing the two by
  eye will be caught out.
- `2026-08-boise-sell-through.xlsx` — August 2026, columns
  `Branch / Customer Name / Item / Qty / LY Qty / UOM`.

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

**STILL UNVERIFIABLE:** the `boise-ytd-jan-jun-2026.xlsx` upload — 639 rows,
401,454.77 LF, the single largest thing in the book — has no source file kept
anywhere. Nobody can check it. Ask Boise to re-send it, and keep every file from
now on: the upload records only a hashed filename, not the document.
