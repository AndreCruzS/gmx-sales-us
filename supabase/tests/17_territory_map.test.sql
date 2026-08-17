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

select plan(17);

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
  'Deonn Deford',
  'a region with an owner still puts the volume on them'
);

-- ── 5. The map is org-private ──────────────────────────────────────────────

select is(
  public.territory_for_state('22222222-2222-2222-2222-222222222222', 'TX'),
  null,
  'another org gets nothing from our map'
);

-- ── 6. The Market Owners the map names, and only those ─────────────────────

select results_eq(
  $$ select t.name, coalesce(u.full_name, '-- TBD --')
       from territories t
       left join memberships m on m.territory_id = t.id and m.role = 'rep'
       left join users u on u.id = m.user_id
      where t.org_id = '11111111-1111-1111-1111-111111111111'
      order by t.name $$,
  $$ values
      ('Midwest'::text,             '-- TBD --'::text),
      ('Mountain',                  '-- TBD --'),
      ('Northeast',                 'Anthony Peca'),
      ('Northern California',       'Jason'),
      ('Pacific Northwest',         '-- TBD --'),
      ('South Central',             '-- TBD --'),
      ('Southeast',                 '-- TBD --'),
      ('Southern California',       'Deonn Deford'),
      ('Southwest',                 '-- TBD --'),
      ('Texas',                     '-- TBD --') $$,
  'three regions have the owner the map names and seven are honestly unowned'
);

-- The rename, not a second person. Moving 46,436 LF onto a new Deonn while the
-- old Deon kept his accounts would have been the wrong way to read the map.
select is(
  (select count(*)::int from users where email = 'deon@gmxgroup.com'),
  1,
  'Deonn Deford is the existing user renamed, not a duplicate'
);

-- ── 7. Handing over a region does not cost an account its owner ────────────
--
-- TJ held the Northeast in my own seed and the client gives it to Anthony. His
-- membership survives the handover because Buffalo Lumber Co's owner_id points
-- at it — detached, not deleted.

select ok(
  (select territory_id is null from memberships
    where id = 'c0000000-0000-0000-0000-000000000003'),
  'the rep who lost the region holds no region'
);

select ok(
  (select count(*) > 0 from accounts
    where owner_id = 'c0000000-0000-0000-0000-000000000003'),
  'and still owns his accounts'
);

-- The point of the whole handover: the volume went with the region.
select is(
  (select distinct rep_name from sell_through_rows
    where org_id = '11111111-1111-1111-1111-111111111111'
      and branch_name = 'Russin - Montgomery'),
  'Anthony Peca',
  'Northeast volume is the new owner''s, not the old one''s'
);

select * from finish();
rollback;
