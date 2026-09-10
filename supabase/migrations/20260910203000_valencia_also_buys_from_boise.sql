-- VALENCIA BUYS FROM BOISE TOO (João, 2026-09-10).
-- Bianca found Valencia in Hardwoods' August; João then said the house buys
-- from Boise as well, and Boise's files have been carrying it all along under
-- a DIFFERENT NAME: "VALLUPVN - VALENCIA LUMBER & PANEL" out of Riverside,
-- where Hardwoods writes "VAL5800 - VALENCIA LUMBER, INC.".
--
-- No fold gets from one of those to the other on its own — "& PANEL" is not a
-- suffix any rule can drop, and inventing one that did would merge houses that
-- merely share a town's name. That two labels are ONE COMPANY is a person's
-- word, and this is that word written down: the same paper-proves / person-
-- confirms split as PURCHASES_FROM.
--
-- Three uploads carry it, 45 rows and 20,105 LF, none of it ever matched:
--   Jan–Jun 2026 (YTD, so six months cumulative)  18 rows   8,708.83 LF
--   July 2026                                     15 rows   6,607.25 LF
--   August 2026                                   12 rows   4,789.16 LF
-- August across both houses comes to 11,919 LF — Boise's 4,789 beside
-- Hardwoods' 7,130 — and the region cards already key a dealer by
-- dealer_id ?? label (2dfb637), so the two houses read as one row, which is
-- the case that commit was written for.
--
-- The loader would match these by itself on the NEXT Boise file: our
-- {valencia, lumber} sits inside their {vallupvn, valencia, lumber, panel}.
-- It does not go back over what is already stored, hence the update.
--
-- Guarded like the link before it: without Valencia or Boise this is a no-op.
with pair as (
  select v.id as valencia_id, v.org_id, b.id as boise_id
  from accounts v
  join accounts b on b.id = 'd0000000-0000-0000-0000-000000000005'::uuid
                and b.org_id = v.org_id
  where v.id = '3882d718-9e20-4d2a-8366-913d059f14a5'::uuid
),
linked as (
  insert into account_relationships
    (org_id, account_a_id, relationship_type, account_b_id, notes, last_confirmed_at)
  select p.org_id, p.valencia_id, 'PURCHASES_FROM', p.boise_id,
         'João, 2026-09-10: Valencia buys from Boise as well. Boise writes it '
         '"VALLUPVN - VALENCIA LUMBER & PANEL" out of Riverside — 45 lines, '
         '20,105 LF across Jan–Jun YTD, July and August 2026',
         timestamptz '2026-09-10'
  from pair p
  on conflict (org_id, account_a_id, relationship_type, account_b_id)
    do update set last_confirmed_at = excluded.last_confirmed_at,
                  notes = excluded.notes
  returning 1
)
update sell_through s
set dealer_id = p.valencia_id
from pair p
where s.dealer_id is null
  and s.org_id = p.org_id
  and s.dealer_label like 'VALLUPVN %';
