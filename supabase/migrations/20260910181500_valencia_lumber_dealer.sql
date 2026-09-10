-- VALENCIA LUMBER IS A DEALER (Bianca, 2026-09-10).
-- Reading Hardwoods' August return she stopped on one line: "VAL5800 -
-- VALENCIA LUMBER, INC." bought 4,748 LF of FSC Accoya Grey Radiata Pine
-- Decking through Perris, and Valencia is a dealer of ours — not a name to
-- leave sitting in the unmatched queue. Eight lines and 7,130 LF in that one
-- month were being held back from every screen a rep reads, because an
-- unmatched row is admin-only on purpose (nobody is held to a number whose
-- owner is unknown).
--
-- So the account is created and the month is re-pointed at it. Referred by
-- Hardwoods, with the file itself as the source — the same paper-proves /
-- person-confirms split the Russin dealers were written with.
--
-- No address is invented. The company is almost certainly the Santa Clarita
-- yard the name suggests, but "almost certainly" is how a dealer ends up on
-- the wrong pin, and Ganahl Lumber already sits here with a null city. Bianca
-- fills the city in when she has it in front of her.
--
-- OWNER: Deonn, who owns Hardwoods itself and every other Southern California
-- account. Alejandro is the second SoCal rep and owns nothing yet — when the
-- California line finally gets drawn (deferred since 2026-09-04), Valencia
-- moves with whatever else is on his side of it. Putting it under Deonn now is
-- the reversible choice; leaving it unmatched is not, because the volume stays
-- invisible.
--
-- Guarded like the Russin link: without Hardwoods or the rep membership this
-- is a clean no-op on a fresh local reset.
with hardwoods as (
  select a.id as hardwoods_id, a.org_id, a.territory_id, m.id as owner_id
  from accounts a
  join memberships m on m.id = 'c0000000-0000-0000-0000-000000000004'::uuid
                    and m.org_id = a.org_id
  where a.id = 'd0000000-0000-0000-0000-000000000006'::uuid
),
inserted as (
  insert into accounts
    (org_id, name, account_type, state, territory_id, owner_id,
     lead_source, source_detail, referring_account_id)
  select h.org_id, 'Valencia Lumber', 'DEALER', 'CA', h.territory_id, h.owner_id,
         'REFERRAL_DISTRIBUTOR',
         'Hardwoods August 2026 sell-through return; confirmed a dealer by Bianca 2026-09-10',
         h.hardwoods_id
  from hardwoods h
  on conflict (org_id, name) do nothing
  returning id, org_id
),
valencia as (
  select id, org_id from inserted
  union all
  select a.id, a.org_id from accounts a
  where a.name = 'Valencia Lumber' and not exists (select 1 from inserted)
),
linked as (
  insert into account_relationships
    (org_id, account_a_id, relationship_type, account_b_id, notes, last_confirmed_at)
  select v.org_id, v.id, 'PURCHASES_FROM', h.hardwoods_id,
         'Hardwoods August 2026 return, Perris: 8 lines, 7,130 LF, of which '
         '4,748 LF FSC Accoya Grey Radiata Pine Decking',
         timestamptz '2026-09-10'
  from valencia v cross join hardwoods h
  on conflict (org_id, account_a_id, relationship_type, account_b_id)
    do update set last_confirmed_at = excluded.last_confirmed_at,
                  notes = excluded.notes
  returning 1
)
-- The month is already loaded, so the rows have to be re-pointed by hand.
-- matchDealer would find this account on the NEXT file — {valencia, lumber} is
-- inside {val5800, valencia, lumber} — but it does not go back over what is
-- already stored.
update sell_through s
set dealer_id = v.id
from valencia v
where s.dealer_id is null
  and s.org_id = v.org_id
  and s.dealer_label like 'VAL5800 %';
