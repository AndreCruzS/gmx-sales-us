-- What the file said, next to what the app reasons in.
--
-- The first real distributor report (17 Aug 2026) arrived in PIECES, not linear
-- feet: 379 rows in PC, 15 in LF, and the LF ones are exactly the random-length
-- items — which is correct trade practice, because a fixed-length board is sold
-- by the piece and a random-length one by the foot.
--
-- That mixture cannot be added up. The file's own grand total is "10,700" against
-- a column holding both pieces and feet, and a number like that is not a figure,
-- it is two figures in a trench coat. Everything this app shows is LF, which is
-- what the trade quotes in, so quantity is normalised to LF on the way in.
--
-- The length is in the item description — 1X6-94" is ninety-four inches — so a
-- piece count converts exactly. All 255 sales rows of the first real file
-- converted; the ones that cannot are the random-length items, which arrive in LF
-- already.
--
-- WHY KEEP THE SOURCE. A derived figure whose input is gone cannot be checked. If
-- the length parse is ever wrong — a new item naming convention, a description
-- with two measurements in it — the only way anyone finds out is by comparing
-- what we stored against what the distributor sent. So both are kept, and the
-- conversion stays auditable for as long as the row exists.

alter table sell_through
  add column source_quantity numeric(14, 2),
  add column source_unit     text;

comment on column sell_through.quantity is
  'Linear feet, always. Converted on import when the file was in another unit.';
comment on column sell_through.source_quantity is
  'The figure as the distributor''s file gave it, before any conversion. Null '
  'for rows that arrived in LF and needed none.';
comment on column sell_through.source_unit is
  'The unit the file used — PC, LF, whatever they write. Null when it was '
  'already LF.';
