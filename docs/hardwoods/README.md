# Hardwoods Inc. — the paper on file

- `2026-08-hardwoods-socal-sales-by-customer-and-rep.xlsx` — Nick Smith's export,
  "August 2026 Maximo and Accoya SALES BY CUSTOMER AND REP - SC": one flat sheet,
  Branch / Customer / Cust Agent / Item / Major Group / Qty, three yards
  (450 Perris, 451 Phoenix, 452 Chatsworth) with subtotal rows. Everything under
  "Outdoor Living", not only ours.
- **HARDWOODS QUOTES IN LINEAR FEET ALREADY.** Their Qty column is LF for every
  line, so nothing is converted on the way in — and the file carries no unit
  column, which is exactly what the loader needs to leave the figure alone
  (`toLinearFeet` reads a blank unit as LF). The piece-count arithmetic that
  Boise's file needs — pieces × the length in the item name ÷ 12 — must never be
  applied here. Decking tiles are LF too: they read as "2' X 2'" and look like a
  piece count, and reading them that way is what cost August 2,461 LF on the
  first pass.
- `2026-08-hardwoods-sell-through-as-loaded.csv` — the lines the loader read.
  Kept: the product families GMX invoices Hardwoods for (thermo / Maximo /
  Ayous, Ipe, Cumaru, Garapa, radiata, Accoya), decking tiles included.
  Dropped: Kebony, Yukari, Balata, DeckWise (27 lines, 16,433) — GMX has never
  invoiced them. Subtotal rows have no customer and the loader skips them.
  Negative lines (credits, eight of them, −6,388) are kept: a return is a real
  thing.
  Loaded 2026-09-10 as August 2026: 113,373 LF, 130 rows, 22 matched
  — and the file’s own grand total of 129,806 less the 16,433 dropped comes
  to exactly that, which is the check to run on every Hardwoods month.
  Yards: Perris CA and Chatsworth CA placed in Southern California by hand
  (California is city-placed, never state-placed); Phoenix AZ → Southwest.
- Valencia Lumber was created as a dealer on 2026-09-10 (Bianca: “valencia é
  dealer”) after her eye caught its 4,748 LF of FSC Accoya Grey decking. Its
  eight lines and 7,130 LF had been sitting unmatched, which on this schema
  means admin-only — invisible to the rep who owns the account. The remaining
  108 unmatched rows are a queue, not a quiet month; 84 Lumber (23,285 LF,
  Phoenix) is the biggest name still in it.
