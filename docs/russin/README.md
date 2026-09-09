# Russin — the paper on file

- `2026-05-27-russin-dealer-deliveries.csv` — dollars by delivery address, Aug 2025–May 2026.
  Not a sell-through return (no SKU, no LF, no period). Source of the 14 dealer
  accounts created 2026-09-09 (migration 20260909094817).
- `2026-08-russin-sell-through-jul-aug-combined.xlsx` — Ryan Wittig's export, LF by
  dealer / city / SKU, header "Total LF JULY/AUG 2026". The two months are one
  figure and nothing in the file dates a line.
- `2026-08-russin-sell-through-as-loaded.csv` — the same figures flattened for the
  loader (branch "Russin Montgomery, NY"; dealer label = "NAME - CITY";
  item = "SKU DESCRIPTION"; LF). Loaded as **August 2026** on João's decision
  (2026-09-09): "podemos considerar apenas como mês de agosto". 77,803 LF,
  30 rows, the one zero line (Builders First Source Berlin) skipped.
  When Russin sends July and August apart, load July and REPLACE August.
