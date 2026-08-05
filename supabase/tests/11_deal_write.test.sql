-- HubSpot sync bridge · tests 11: create_opportunity_with_action (task 2) —
-- the rep's atomic deal-create RPC that bundles an opportunity and its first
-- open next_action into one transaction so the deferred stage-gate trigger
-- (20260722000600_loop.sql:184-217) is satisfied at commit. Follows the
-- fixture prologue of 07_exceptions.test.sql (seeded org + persona,
-- tests.set_claims + set local role authenticated) — no new fixtures needed,
-- the seeded org/territory/rep membership/account already cover this.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

-- Seeded fixtures (supabase/seed.sql): org1, Deon's SoCal territory, Deon's
-- own membership, and an account Deon owns (ABC Construction — sourced
-- REFERRAL_DEALER, so it does not collide with the EXISTING_RELATIONSHIP
-- lead_source used on the new opportunity below). Note: deon@gmxgroup.com is
-- membership c...004, NOT tj@gmxgroup.com (tj is c...003 / Buffalo) — the
-- persona must match the owner_id used below or the insert policies
-- (owner_id in visible_membership_ids()) reject the row.
-- org         = 11111111-1111-1111-1111-111111111111
-- territory   = b0000000-0000-0000-0000-000000000002
-- membership  = c0000000-0000-0000-0000-000000000004 (deon@gmxgroup.com, rep)
-- account     = d0000000-0000-0000-0000-000000000004 (ABC Construction, owner Deon)

select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;

select has_function('public', 'create_opportunity_with_action', array['jsonb', 'jsonb']);

-- happy path: one call, both rows, gate satisfied at commit.
-- The stage-gate constraint trigger is DEFERRABLE INITIALLY DEFERRED, so it
-- only actually evaluates at COMMIT or when forced early — inside this
-- single wrapping transaction it would otherwise never fire at all, and the
-- "commits past the gate" claim would be unproven. Force it the same way
-- 05_stage_trigger.test.sql:31,46-47 does: `set constraints all immediate`
-- flushes the queued deferred check, then `set constraints all deferred`
-- restores deferral for anything still to come in the transaction.
select lives_ok($$
  select public.create_opportunity_with_action(
    '{"id":"aaaaaaaa-0000-0000-0000-000000000001","org_id":"11111111-1111-1111-1111-111111111111",
      "name":"Ganahl decking","primary_account_id":"d0000000-0000-0000-0000-000000000004",
      "territory_id":"b0000000-0000-0000-0000-000000000002","owner_id":"c0000000-0000-0000-0000-000000000004",
      "stage":"IDENTIFIED","current_status":"Intro made at counter",
      "lead_source":"EXISTING_RELATIONSHIP"}'::jsonb,
    '{"id":"aaaaaaaa-0000-0000-0000-000000000002","org_id":"11111111-1111-1111-1111-111111111111",
      "action":"Drop decking sample","owner_id":"c0000000-0000-0000-0000-000000000004",
      "due_date":"2026-08-12","account_id":"d0000000-0000-0000-0000-000000000004",
      "opportunity_id":"aaaaaaaa-0000-0000-0000-000000000001",
      "kind":"SAMPLE_FOLLOW_UP"}'::jsonb);
  set constraints all immediate;
  set constraints all deferred;
$$, 'create with bundled first action commits past the stage gate');

select is(
  (select count(*)::int from opportunities  where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1,
  'opportunity row landed');
select is(
  (select count(*)::int from next_actions where opportunity_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and completed_at is null), 1,
  'open first action landed');

-- idempotent replay (D57): the double-fired outbox op is a no-op. Both
-- inserts hit `on conflict (id) do nothing`, so no row is actually inserted
-- and the AFTER INSERT stage-gate trigger has no new event queued — but we
-- still force+restore deferral here, mirroring the happy path, so the replay
-- is proven inert under the same constraint-checking regime instead of
-- coasting through on the fact that nothing was ever checked.
select lives_ok($$
  select public.create_opportunity_with_action(
    '{"id":"aaaaaaaa-0000-0000-0000-000000000001","org_id":"11111111-1111-1111-1111-111111111111",
      "name":"Ganahl decking","primary_account_id":"d0000000-0000-0000-0000-000000000004",
      "territory_id":"b0000000-0000-0000-0000-000000000002","owner_id":"c0000000-0000-0000-0000-000000000004",
      "stage":"IDENTIFIED","current_status":"Intro made at counter",
      "lead_source":"EXISTING_RELATIONSHIP"}'::jsonb,
    '{"id":"aaaaaaaa-0000-0000-0000-000000000002","org_id":"11111111-1111-1111-1111-111111111111",
      "action":"Drop decking sample","owner_id":"c0000000-0000-0000-0000-000000000004",
      "due_date":"2026-08-12","account_id":"d0000000-0000-0000-0000-000000000004",
      "opportunity_id":"aaaaaaaa-0000-0000-0000-000000000001",
      "kind":"SAMPLE_FOLLOW_UP"}'::jsonb);
  set constraints all immediate;
  set constraints all deferred;
$$, 'replay is a no-op');
select is(
  (select count(*)::int from next_actions where opportunity_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1,
  'no duplicate action on replay');

reset role;

select * from finish();
rollback;
