-- The reference data the first real sell-through entry needs.
--
-- Production has every sell-through table and not one row of the things those
-- tables point AT: no distributor accounts at all. So the loader's "Which house
-- sent it" list is empty, and an admin who opens the screen cannot get past the
-- first field. This is the data that has to exist before anybody can load a
-- month, and it is reference data about companies we sell to — which is why it
-- belongs in a migration rather than in somebody's afternoon.
--
-- WHAT IS NOT HERE. The July figures themselves. Those go in through the loader,
-- because that is the path that captures the original .xlsx into storage, records
-- who loaded it and when, and writes source_quantity beside every converted
-- figure. A month inserted by SQL would have none of that, and the first thing
-- anybody asks about a number is where it came from.
--
-- Everything below is idempotent AND guarded on the rows it points at existing.
-- That second part is not defensive decoration: migrations run against an EMPTY
-- database locally, before seed.sql creates the org, the territories and the
-- memberships. Without the guards this file fails the foreign key on every
-- `supabase db reset`, and then fails again in CI. With them it does nothing
-- locally — the seed already carries all of this — and does the work on
-- production, where those rows are already there.

-- ── The two houses that send us files ───────────────────────────────────────
--
-- Boise Cascade and Hardwoods are the two the client named. Their ids match the
-- development seed on purpose, so a branch or a row that behaves one way locally
-- behaves the same way here.
--
-- TERRITORY AND OWNER ARE A PLACEHOLDER, and the comment matters more than the
-- value. accounts.territory_id and owner_id are both NOT NULL, so every account
-- must sit in exactly one territory under exactly one rep — but Boise Cascade is
-- national. It ships out of Riverside, Dallas, Memphis, Salt Lake, Detroit,
-- Atlanta, Houston and Nashville, and no rep owns all of that.
--
-- SoCal/Deon is recorded here because it is the only Californian pairing that
-- exists and something must be. It is NOT a claim that Deon owns Boise. The
-- branch-to-region work exists precisely to stop attribution flowing through this
-- column: once a branch carries its own region, whose volume it is stops
-- depending on which single territory the house happens to be filed under.

insert into accounts (
  id, org_id, name, account_type, city, state,
  territory_id, owner_id, lead_source, strategic_importance
)
select
  h.id,
  '11111111-1111-1111-1111-111111111111',
  h.name, 'DISTRIBUTOR', null, null,
  'b0000000-0000-0000-0000-000000000002',
  'c0000000-0000-0000-0000-000000000004',
  'EXISTING_RELATIONSHIP', 'STRATEGIC'
from (values
  ('d0000000-0000-0000-0000-000000000005'::uuid, 'Boise Cascade'),
  ('d0000000-0000-0000-0000-000000000006'::uuid, 'Hardwoods Specialty')
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
on conflict (org_id, name) do nothing;

-- ── Boise's branches, exactly as Boise writes them ──────────────────────────
--
-- These eight are the branches that appear in the client's first real BC report
-- (17 Aug 2026). Not a guess at their network — only the eight we have actually
-- seen sell, which is also the honest denominator for a coverage map.
--
-- THE SPELLING IS FUNCTIONAL. Their report carries no branch-code column, so the
-- loader can only match a branch on its name. "Riverside Branch" is what their
-- file says; anything else here and the first upload creates a duplicate of every
-- yard. external_code is null for the same reason: they have never given us one.
--
-- Hardwoods gets no branches, because no Hardwoods file has arrived yet. Theirs
-- will be created by the loader on their first upload rather than invented now.

insert into distributor_branches (org_id, distributor_id, name, city, state, external_code)
select
  '11111111-1111-1111-1111-111111111111',
  'd0000000-0000-0000-0000-000000000005',
  b.name, b.city, b.state, null
from (values
  ('Riverside Branch', 'Riverside',      'CA'),
  ('Dallas Branch',    'Dallas',         'TX'),
  ('Memphis Branch',   'Memphis',        'TN'),
  ('Salt Lake Branch', 'Salt Lake City', 'UT'),
  ('Detroit Branch',   'Detroit',        'MI'),
  ('Atlanta Branch',   'Atlanta',        'GA'),
  ('Houston Branch',   'Houston',        'TX'),
  ('Nashville Branch', 'Nashville',      'TN')
) as b(name, city, state)
-- The house itself has to be there. On a fresh local database it is not, and this
-- whole statement correctly does nothing.
where exists (
  select 1 from accounts
   where id = 'd0000000-0000-0000-0000-000000000005'
     and org_id = '11111111-1111-1111-1111-111111111111'
)
and not exists (
  select 1 from distributor_branches d
   where d.org_id = '11111111-1111-1111-1111-111111111111'
     and d.distributor_id = 'd0000000-0000-0000-0000-000000000005'
     and d.name = b.name
);

-- ── One correction while we are here ────────────────────────────────────────
--
-- "Ganahl Orange" is fiction, and it is mine: Ganahl has no Orange yard. Their
-- Californian list runs Anaheim, Buena Park, Corona, Costa Mesa and on, which is
-- also how the client's own rollout tracker reads. Renamed rather than deleted
-- because the row may already carry activity, and nothing keys on an account name.
--
-- Guarded, so it does nothing if a Buena Park has since been created properly.

update accounts
   set name = 'Ganahl Buena Park',
       city = 'Buena Park'
 where org_id = '11111111-1111-1111-1111-111111111111'
   and name = 'Ganahl Orange'
   and not exists (
     select 1 from accounts a
      where a.org_id = '11111111-1111-1111-1111-111111111111'
        and a.name = 'Ganahl Buena Park'
   );
