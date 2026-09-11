-- The already-loaded months do not re-match themselves when an account appears,
-- so the rows the new California roster claims are re-pointed by hand.
--
-- WHICH rows was decided by running the loader's OWN matchDealer over the
-- current account list, not by eye: {builders, firstsource} sits inside
-- {buifide, builders, firstsource}, and the five new BFS yards do not fit
-- because their town is not in the label. The banner is the honest level here —
-- Boise's file never says which yard, and 129,944 LF had been sitting unnamed
-- because of it.
update sell_through s
set dealer_id = a.id
from (values
  ('BUIFIDE - BUILDERS FIRSTSOURCE',  'Builders FirstSource'),
  ('AUSHASA - AUSTIN HARDWOODS INC',  'Austin Hardwoods'),
  ('AUS1990 - AUSTIN HARDWOODS',      'Austin Hardwoods'),
  ('LEALUES - LEARNED LUMBER',        'Learned Lumber')
) as m(label, account)
join accounts a on a.name = m.account
where s.dealer_id is null and s.org_id = a.org_id and s.dealer_label = m.label;

-- One the matcher will not take on its own, and a person can. Hardwoods writes
-- "BUILDERS FIRST SOURCE" in three words where Boise writes it in two, so no
-- token rule reaches from one to the other — the same wall Valencia sat behind.
-- This is the same company with a space in it, not a judgement about identity.
update sell_through s
set dealer_id = a.id
from accounts a
where a.name = 'Builders FirstSource'
  and s.org_id = a.org_id
  and s.dealer_id is null
  and s.dealer_label = 'BUIL4061 - BUILDERS FIRST SOURCE';

update sell_through_uploads u
set unmatched_count = (select count(*) from sell_through s
                        where s.upload_id = u.id and s.dealer_id is null);
