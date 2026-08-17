-- Territory map · tests 17: territory_states, territory_for_state, and what the
-- map does to attribution (20260817000600_master_territory_map.sql).
--
-- The client's Master Territory Map is the first piece of reference data in this
-- system that DECIDES WHOSE NUMBER A SALE IS. Everything else about it is
-- bookkeeping; these are the rules that would put a rep's name on volume they
-- never sold if they broke.
--
-- 1. A STATE RESOLVES TO EXACTLY ONE REGION, and a branch places itself from it.
-- 2. CALIFORNIA DOES NOT RESOLVE. The client splits it north/south by geography
--    and a two-letter code cannot express that, so the map must refuse rather
--    than pick — Stockton is five hundred miles from Riverside.
-- 3. A REGION WITH NO OWNER ATTRIBUTES TO NOBODY. This is the one that matters:
--    the previous rule fell back to the dealer's owner, so Texas volume landed
--    on the rep who happens to hold the Builders FirstSource banner in southern
--    California. An unowned region has to read as a gap.
-- 4. ONE ORG CANNOT READ ANOTHER'S MAP.
--
-- Seeded fixtures (supabase/seed.sql):
-- socal   = b0000000-0000-0000-0000-000000000002 (Southern California, Deon)
-- norcal  = b0000000-0000-0000-0000-000000000011 (Northern California, no owner)
-- texas   = b0000000-0000-0000-0000-000000000014 (Texas, no owner)
-- deon    = c0000000-0000-0000-0000-000000000004

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- ── 1. The map resolves a state to a region ────────────────────────────────

select is(
  public.territory_for_state('11111111-1111-1111-1111-111111111111', 'TX'),
  'b0000000-0000-0000-0000-000000000014'::uuid,
  'Texas is the Texas region'
);

select is(
  public.territory_for_state('11111111-1111-1111-1111-111111111111', 'TN'),
  'b0000000-0000-0000-0000-000000000017'::uuid,
  'Tennessee is in the Southeast, as the map says and not as the name suggests'
);

-- Files arrive with " tx" and "Tx" in them. A region that depends on somebody
-- typing a state the same way twice is not a rule.
select is(
  public.territory_for_state('11111111-1111-1111-1111-111111111111', '  tx '),
  'b0000000-0000-0000-0000-000000000014'::uuid,
  'a state is matched however it was typed'
);

select ok(
  public.territory_for_state('11111111-1111-1111-1111-111111111111', 'HI') is null,
  'a state the map does not mention stays unknown rather than being guessed'
);

-- ── 2. California refuses to resolve ───────────────────────────────────────

select ok(
  public.territory_for_state('11111111-1111-1111-1111-111111111111', 'CA') is null,
  'California does not resolve by code — the client splits it by geography'
);

-- And the two halves really are held apart, which is the whole reason for the
-- refusal: Stockton must not land on the southern rep.
select is(
  (select t.name from distributor_branches b
     join territories t on t.id = b.territory_id
    where b.name = 'Hardwoods - Stockton'),
  'Northern California',
  'a northern Californian yard sits in the northern region'
);

select is(
  (select t.name from distributor_branches b
     join territories t on t.id = b.territory_id
    where b.name = 'Riverside Branch'),
  'Southern California',
  'and a southern one in the southern region'
);

-- ── 3. Every branch we hold has placed itself ──────────────────────────────

select is(
  (select count(*)::int from distributor_branches
    where org_id = '11111111-1111-1111-1111-111111111111'
      and territory_id is null),
  0,
  'no branch is left without a region'
);

-- ── 4. An unowned region attributes to nobody, not to the nearest rep ──────
--
-- The regression this file exists for. Dallas is Texas; Texas has no Market
-- Owner; the dealer buying there is a banner GMX holds under Deon. Before the
-- map, that made it Deon's volume.

select ok(
  (select bool_and(rep_id is null)
     from sell_through_rows
    where org_id = '11111111-1111-1111-1111-111111111111'
      and branch_name = 'Dallas Branch'),
  'Texas volume belongs to nobody while Texas has no Market Owner'
);

select is(
  (select region_name from sell_through_rows
    where org_id = '11111111-1111-1111-1111-111111111111'
      and branch_name = 'Dallas Branch' limit 1),
  'Texas',
  'and it still says which region it is waiting on'
);

-- The other half of the same rule: a region WITH an owner still attributes.
select is(
  (select distinct rep_name from sell_through_rows
    where org_id = '11111111-1111-1111-1111-111111111111'
      and branch_name = 'Riverside Branch'),
  'Deon Rep',
  'a region with an owner still puts the volume on them'
);

-- ── 5. The map is org-private ──────────────────────────────────────────────

select is(
  public.territory_for_state('22222222-2222-2222-2222-222222222222', 'TX'),
  null,
  'another org gets nothing from our map'
);

select * from finish();
rollback;
