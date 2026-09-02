-- The five houses, by their right names.
--
-- Andre named the real distributor partners (2026-09-01):
--   Hardwoods Inc. · Boise Cascade Company · Rugby Architectural Building
--   Products · Russin · Capital Lumber Company
--
-- Two were already on the books; "Hardwoods Specialty" was the wrong company —
-- the partner is Hardwoods Inc., and Jason's next action already points at this
-- very row, so it is a RENAME, not a replace: the id (d0…06) keeps its branch
-- mappings, its sell-through attribution and its links. Boise Cascade keeps its
-- everyday name — it is how the client's own sell-through file speaks.
--
-- The other three are created with the same shape the existing two carry
-- (STRATEGIC distributors, same territory and owner, EXISTING_RELATIONSHIP).
-- City/state stay null — the existing rows hold no addresses either, and a
-- guessed address is worse than an empty one (the map learned that lesson).
--
-- Fixed ids, so the seed and any later branch mappings can speak of them:
--   d0…07 Russin  ·  d0…08 Rugby  ·  d0…09 Capital Lumber
-- (d0…07 matches the id seed.sql already uses for Russin locally.)
--
-- Rename guarded by id AND current name; inserts by fixed id, guarded the way
-- first_sell_through_entry guards its own — the territory and membership these
-- rows lean on are born in seed.sql, which runs AFTER migrations on a local
-- reset, so an unguarded insert would fail the reset on a foreign key. With
-- the exists-guards this is a no-op locally and reapplying anywhere is a
-- no-op too (on conflict do nothing).

update accounts
   set name = 'Hardwoods Inc.'
 where id = 'd0000000-0000-0000-0000-000000000006'
   and org_id = '11111111-1111-1111-1111-111111111111'
   and name = 'Hardwoods Specialty';

insert into accounts (
  id, org_id, name, account_type,
  territory_id, owner_id, lead_source, strategic_importance
)
select
  h.id,
  '11111111-1111-1111-1111-111111111111',
  h.name, 'DISTRIBUTOR',
  'b0000000-0000-0000-0000-000000000002',
  'c0000000-0000-0000-0000-000000000004',
  'EXISTING_RELATIONSHIP', 'STRATEGIC'
from (values
  ('d0000000-0000-0000-0000-000000000007'::uuid, 'Russin'),
  ('d0000000-0000-0000-0000-000000000008'::uuid, 'Rugby Architectural Building Products'),
  ('d0000000-0000-0000-0000-000000000009'::uuid, 'Capital Lumber Company')
) as h(id, name)
where exists (
  select 1 from territories
   where id = 'b0000000-0000-0000-0000-000000000002'
     and org_id = '11111111-1111-1111-1111-111111111111'
)
and exists (
  select 1 from memberships
   where id = 'c0000000-0000-0000-0000-000000000004'
     and org_id = '11111111-1111-1111-1111-111111111111'
)
on conflict (id) do nothing;
