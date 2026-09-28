-- BIANCA'S ANSWERS, WRITTEN DOWN (her matching sheet, answered 2026-09-28).
--
-- Every row here is her word, not a guess. She marked five pairs "Same
-- dealer", three pairs "Different" (one of which means a dealer of its own),
-- and left the rest for a question she still has to answer — those are not
-- here. What is created:
--
--   Same dealer (one account, both spellings tied to it)
--     DG Lumber Group ................ 12,584 LF
--     Beyond Lumber (LABL Holdings) ... 5,930 LF   ← her name for it, said in
--                                                   the 18 Sep meeting
--     Orange Coast Hardware & Lumber .. 2,460 LF
--     CJ Redwood ...................... 1,672 LF
--     Hudson & West Hardwoods ......... 1,141 LF
--   Different, so a dealer of its own
--     Timberline Exteriors (Utah) ..... 8,715 LF   ← never merge with
--                                                   Timberline Enterprises (MA)
--   The two pairs left in "no match found", where the file names the yard
--     Interstate & Lakeland Lumber — Newtown, Stamford (13,754 LF)
--     Trade Supply Group — East Islip, Watermill (14,506 LF)
--
-- 32,502 LF of sell-through stops being ownerless, plus 28,260 in the pairs.
--
-- The aliases do the linking: the trigger from 20260924 (dealer_aliases)
-- attaches every stored row under those labels and records the PURCHASES_FROM
-- each one proves, and next month's file lands on them by itself.
--
-- Idempotent on purpose: an account that already exists by name is left alone,
-- and an alias that exists is not written twice.

with org as (
  select org_id from accounts where name = 'Valencia Lumber' limit 1
),
made as (
  insert into accounts
    (org_id, name, account_type, city, state, territory_id, owner_id, lead_source,
     source_detail, referring_account_id)
  -- REFERRAL_DISTRIBUTOR is the honest source — the house's own file named
  -- them — and the check constraint rightly insists on saying WHICH house.
  select o.org_id, v.name, 'DEALER', v.city, v.state, v.territory::uuid, v.owner::uuid,
         'REFERRAL_DISTRIBUTOR', v.detail, v.house::uuid
  from org o
  cross join (values
    -- Southern California, Deonn's ground
    ('DG Lumber Group', null, 'CA', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
     'Bianca''s matching sheet 2026-09-28: one dealer under two spellings (Hardwoods DGL8844, Boise DGLUGCH)', 'd0000000-0000-0000-0000-000000000006'),
    ('Beyond Lumber', null, 'CA', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
     'Bianca: LABL Holdings Group trades as Beyond Lumber (18 Sep meeting; matching sheet 2026-09-28)', 'd0000000-0000-0000-0000-000000000006'),
    ('Orange Coast Hardware & Lumber', null, 'CA', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
     'Bianca''s matching sheet 2026-09-28: Boise writes the name cut short', 'd0000000-0000-0000-0000-000000000006'),
    ('CJ Redwood', null, 'CA', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
     'Bianca''s matching sheet 2026-09-28: C. J. Redwood, Inc. and CJ Redwood Wholesale Lumber are one', 'd0000000-0000-0000-0000-000000000006'),
    ('Hudson & West Hardwoods', null, 'CA', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
     'Bianca''s matching sheet 2026-09-28: the HUDSON row on her California tracker', 'd0000000-0000-0000-0000-000000000006'),
    -- Mountain has no Market Owner yet, so an admin holds it
    ('Timberline Exteriors', null, 'UT', 'b0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000001',
     'Bianca''s matching sheet 2026-09-28: NOT Timberline Enterprises of Braintree, MA', 'd0000000-0000-0000-0000-000000000005'),
    -- Northeast, Anthony's ground: two banners the files name yard by yard
    ('Interstate & Lakeland Lumber', null, 'CT', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000011',
     'Russin''s file names two yards of it; banner over them', 'd0000000-0000-0000-0000-000000000007'),
    ('Interstate & Lakeland Lumber Newtown', 'Newtown', 'CT', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000011',
     'Russin August 2026 return, which names the ship-to yard', 'd0000000-0000-0000-0000-000000000007'),
    ('Interstate & Lakeland Lumber Stamford', 'Stamford', 'CT', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000011',
     'Russin August 2026 return, which names the ship-to yard', 'd0000000-0000-0000-0000-000000000007'),
    ('Trade Supply Group', null, 'NY', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000011',
     'Russin''s file names two yards of it; banner over them', 'd0000000-0000-0000-0000-000000000007'),
    ('Trade Supply Group East Islip', 'East Islip', 'NY', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000011',
     'Russin August 2026 return, which names the ship-to yard', 'd0000000-0000-0000-0000-000000000007'),
    ('Trade Supply Group Watermill', 'Watermill', 'NY', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000011',
     'Russin August 2026 return, which names the ship-to yard', 'd0000000-0000-0000-0000-000000000007')
  ) as v(name, city, state, territory, owner, detail, house)
  where not exists (
    select 1 from accounts x where x.org_id = o.org_id and x.name = v.name
  )
  returning 1
)
select count(*) from made;

-- The yards hang under their banner, so a banner adds its yards up.
update accounts y
set parent_account_id = b.id
from accounts b
where b.org_id = y.org_id
  and y.parent_account_id is null
  and (
    (b.name = 'Interstate & Lakeland Lumber' and y.name in
      ('Interstate & Lakeland Lumber Newtown', 'Interstate & Lakeland Lumber Stamford'))
    or (b.name = 'Trade Supply Group' and y.name in
      ('Trade Supply Group East Islip', 'Trade Supply Group Watermill'))
  );

-- Her word, as an alias per spelling. The trigger links what is stored.
insert into dealer_aliases (org_id, label, dealer_id, created_by, note)
select a.org_id, v.label, a.id,
       'c0000000-0000-0000-0000-000000000001'::uuid,
       'Bianca''s matching sheet, answered 2026-09-28'
from (values
  ('DG Lumber Group', 'DGL8844 - DG LUMBER GROUP, INC.'),
  ('DG Lumber Group', 'DGLUGCH - DG LUMBER GROUP INC'),
  ('Beyond Lumber', 'BEYO6912 - LABL HOLDINGS GROUP, INC.'),
  ('Beyond Lumber', 'LABHOGGA - LABL HOLDINGS GROUP INC'),
  ('Orange Coast Hardware & Lumber', 'ORA1774 - ORANGE COAST HARDWARE & LUMBER'),
  ('Orange Coast Hardware & Lumber', 'ORACOHSA - ORANGE COAST HARDWARE'),
  ('CJ Redwood', 'CJR5881 - C. J. REDWOOD, INC.'),
  ('CJ Redwood', 'CJRWHES - CJ REDWOOD WHOLESALE LUMBER'),
  ('Hudson & West Hardwoods', 'HUD4000 - HUDSON & WEST HARDWOODS LLC'),
  ('Timberline Exteriors', 'TIMEXOG - TIMBERLINE EXTERIORS'),
  ('Interstate & Lakeland Lumber Newtown', 'INTERSTATE & LAKELAND LUMBER - NEWTOWN'),
  ('Interstate & Lakeland Lumber Stamford', 'INTERSTATE & LAKELAND LUMBER - STAMFORD'),
  ('Trade Supply Group East Islip', 'TRADE SUPPLY GROUP - EAST ISLIP'),
  ('Trade Supply Group Watermill', 'TRADE SUPPLY GROUP - WATERMILL')
) as v(dealer, label)
join accounts a on a.name = v.dealer
on conflict (org_id, label_key) do nothing;
