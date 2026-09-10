# Hardwoods Inc. — the paper on file

- `2026-08-hardwoods-socal-sales-by-customer-and-rep.xlsx` — Nick Smith's export,
  "August 2026 Maximo and Accoya SALES BY CUSTOMER AND REP - SC": one flat sheet,
  Branch / Customer / Cust Agent / Item / Major Group / Qty, three yards
  (450 Perris, 451 Phoenix, 452 Chatsworth) with subtotal rows. Everything under
  "Outdoor Living", not only ours.
- `2026-08-hardwoods-sell-through-as-loaded.csv` — the lines the loader read.
  Kept: the product families GMX invoices Hardwoods for (thermo / Maximo /
  Ayous, Ipe, Cumaru, Garapa, radiata, Accoya). Dropped: Kebony, Yukari,
  Balata, DeckWise (27 lines, 16,433) — GMX has never invoiced them — and
  decking tiles sold by the piece (8 lines, 2,461), which carry no length.
  Subtotal rows have no customer and the loader skips them. Negative lines
  (credits, six of them, −6,384) are kept: a return is a real thing.
  Loaded 2026-09-10 as August 2026: 110,912 LF, 122 rows, 13 matched.
  Yards: Perris CA and Chatsworth CA placed in Southern California by hand
  (California is city-placed, never state-placed); Phoenix AZ → Southwest.
