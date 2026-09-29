-- ANAWALT, ANSWERED BY BIANCA HERSELF (round-2 sheet, 2026-09-29).
--
-- She ticked "No - not a dealer" in the list and, in the same sheet, looked up
-- and typed out all five Anawalt stores so we could tell which one the file
-- means. Nobody does that for a name that is not a customer. Her list is the
-- answer: Robertson Blvd is the West Hollywood store, 641 N. Robertson Blvd.
-- The tick was the tired end of ninety rows; the five addresses were the work.
--
-- So we do not ask her again. The label names the yard, she named the city,
-- and the "<Company> <City>" rule she asked for does the rest. With this, no
-- label in any sell-through file is left without a dealer.
with org as (select distinct org_id from sell_through),
made as (
  insert into accounts
    (org_id, name, account_type, address, city, state, postal_code,
     territory_id, owner_id, lead_source, source_detail, referring_account_id)
  select o.org_id, 'Anawalt Lumber West Hollywood', 'DEALER',
         '641 N. Robertson Blvd', 'West Hollywood', 'CA', '90069',
         'b0000000-0000-0000-0000-000000000002'::uuid,
         'c0000000-0000-0000-0000-000000000004'::uuid,
         'REFERRAL_DISTRIBUTOR',
         'Bianca''s round-2 sheet, 2026-09-29: the five Anawalt stores, of which Robertson Blvd is this one',
         'd0000000-0000-0000-0000-000000000006'::uuid
  from org o
  where not exists (
    select 1 from accounts x
    where x.org_id = o.org_id and x.name = 'Anawalt Lumber West Hollywood'
  )
  returning id, org_id
)
insert into dealer_aliases (org_id, label, dealer_id, created_by, note)
select m.org_id, 'ANAW9134 - ANAWALT LUMBER- ROBERTSON', m.id,
       'c0000000-0000-0000-0000-000000000001'::uuid,
       'Bianca''s round-2 sheet, 2026-09-29: Robertson Blvd is the West Hollywood store'
from made m
on conflict (org_id, label_key) do nothing;
