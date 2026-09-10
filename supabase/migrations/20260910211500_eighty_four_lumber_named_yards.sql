-- 84 LUMBER'S TWO NAMED YARDS (Andre, 2026-09-10: "84 age como dealer no nosso
-- sistema, precisamos entender os locais dela como branches assim como
-- acontece com a Ganahl", "para não perder no mapa").
--
-- Of the five places 84 Lumber shows up in the files, only TWO carry a yard of
-- their own, and both come from Russin, who writes the ship-to town into the
-- name: "84 LUMBER CO - PATCHOGUE" and "84 LUMBER CO - WEST MIFFLIN". Those
-- two become accounts here, on the Russin pattern — Northeast under Anthony,
-- referred by Russin, the file as the proof.
--
-- The other three carry NO yard at all. Boise writes one corporate label
-- ("EIGFOLEF - 84 LUMBER COMPANY") for Dallas and Riverside alike, and
-- Hardwoods writes another ("84L8820 - 84 LUMBER COMPANY") out of Phoenix; the
-- only thing that varies is which of the DISTRIBUTOR's branches shipped, which
-- is not the dealer's address. Those rows are deliberately left unnamed rather
-- than hung on a banner whose region would then be a guess — 23,285 LF of
-- Arizona credited to a Northeast account is the misattribution the region
-- model exists to prevent. They wait on a decision about who owns a national
-- banner, and on Southwest and Texas having a rep at all (today they have
-- none).
--
-- NO BANNER ACCOUNT YET, on purpose. Ganahl can have one because Ganahl is a
-- Southern California chain; 84 Lumber is national, and a banner has to sit in
-- some region under some rep. That is Andre's call, not a default.
--
-- Guarded like the Russin batch: without Russin, the territory or the rep
-- membership this is a clean no-op.
-- THREE STATEMENTS, NOT ONE. A CTE reads the snapshot the statement began
-- with, so an `insert ... returning` in one branch is invisible to a `join
-- accounts` in another: the first cut of this migration created both yards and
-- then linked nothing and re-pointed nothing, because the join found no rows.
-- The accounts are made first, and only then read back.
with russin as (
  select a.id as russin_id, a.org_id, t.id as territory_id, m.id as owner_id
  from accounts a
  join territories t on t.org_id = a.org_id and t.name = 'Northeast'
  join memberships m on m.id = 'c0000000-0000-0000-0000-000000000011'::uuid
                    and m.org_id = a.org_id
  where a.id = 'd0000000-0000-0000-0000-000000000007'::uuid
),
yards(name, city, state) as (
  values
    ('84 Lumber Patchogue',   'Patchogue',   'NY'),
    ('84 Lumber West Mifflin','West Mifflin','PA')
)
insert into accounts
  (org_id, name, account_type, city, state, territory_id, owner_id,
   lead_source, source_detail, referring_account_id)
select r.org_id, y.name, 'DEALER', y.city, y.state, r.territory_id, r.owner_id,
       'REFERRAL_DISTRIBUTOR',
       'Russin August 2026 sell-through return, which names the ship-to yard',
       r.russin_id
from yards y cross join russin r
on conflict (org_id, name) do nothing;

-- Each yard's proof: the Russin line that names it.
insert into account_relationships
  (org_id, account_a_id, relationship_type, account_b_id, notes, last_confirmed_at)
select a.org_id, a.id, 'PURCHASES_FROM', r.id,
       format('Russin August 2026 return: %s LF', to_char(y.lf, 'FM999,999,990.00')),
       timestamptz '2026-09-10'
from (values
        ('84 Lumber Patchogue',    343.00),
        ('84 Lumber West Mifflin', 8204.00)
     ) as y(name, lf)
join accounts a on a.name = y.name
join accounts r on r.id = 'd0000000-0000-0000-0000-000000000007'::uuid
               and r.org_id = a.org_id
on conflict (org_id, account_a_id, relationship_type, account_b_id)
  do update set last_confirmed_at = excluded.last_confirmed_at,
                notes = excluded.notes;

-- The month is already loaded, so the two lines are re-pointed by hand. The
-- loader will match them itself next time: our {84, lumber, patchogue} sits
-- inside their {84, lumber, co, patchogue}.
update sell_through s
set dealer_id = a.id
from (values
        ('84 Lumber Patchogue',    '84 LUMBER CO - PATCHOGUE'),
        ('84 Lumber West Mifflin', '84 LUMBER CO - WEST MIFFLIN')
     ) as m(name, label)
join accounts a on a.name = m.name
where s.dealer_id is null
  and s.org_id = a.org_id
  and s.dealer_label = m.label;
