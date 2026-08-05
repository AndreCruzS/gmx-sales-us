-- HubSpot sync bridge · tests 12: hubspot_apply_deal (task 3) — the inbound
-- deal writer the sync engine calls as service_role. HubSpot is
-- stage-authoritative, but the stage gate (Rule 3,
-- 20260722000600_loop.sql:184-217) must not erode: a stage change with no
-- open next_action gets a "review" action injected in the same call.
--
-- Fixture prologue follows 11_deal_write.test.sql: create the opportunity +
-- its first open next_action through create_opportunity_with_action, as
-- Deon (rep), forcing the deferred stage-gate to actually fire with
-- `set constraints all immediate; set constraints all deferred;` — same
-- idiom, because a deferred gate that never fires proves nothing. Then
-- `reset role` so postgres plays the service role for hubspot_apply_deal
-- (SECURITY DEFINER, service_role-only in production; postgres also
-- bypasses RLS, matching that posture in tests).
--
-- Seeded fixtures (supabase/seed.sql):
-- org         = 11111111-1111-1111-1111-111111111111
-- org2        = 22222222-2222-2222-2222-222222222222 (acme-test, cross-org probe)
-- territory   = b0000000-0000-0000-0000-000000000002 (SoCal)
-- membership  = c0000000-0000-0000-0000-000000000004 (deon@gmxgroup.com, rep)
-- account     = d0000000-0000-0000-0000-000000000004 (ABC Construction, owner Deon)
--
-- Tests 4-5 below are review-round regression coverage (2026-08-05 fix):
-- 4. a field-only patch (no "stage"/"current_status" keys) against a deal
--    with NO open next action must still succeed — the deferred gate trigger
--    fires on `update of stage, current_status` by SET-clause TARGET, not by
--    value change, so the original always-coalesce UPDATE tripped the gate
--    on every call regardless of whether the patch touched those columns.
-- 5. a call whose p_org_id does not own p_opportunity_id must raise instead
--    of silently no-op-ing (the original code let the review-action INSERT
--    fire before any ownership check, landing a next_actions row under the
--    wrong org pointed at another org's opportunity).

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;

-- Fixture setup (not a counted assertion, mirrors 11's happy-path insert):
-- opportunity 'bbbb...01' + its open first action 'bbbb...02', landed in one
-- transaction so the deferred stage gate is satisfied, then forced early
-- (11's idiom) so the gate genuinely evaluates instead of coasting to commit.
select public.create_opportunity_with_action(
  '{"id":"bbbbbbbb-0000-0000-0000-000000000001","org_id":"11111111-1111-1111-1111-111111111111",
    "name":"HubSpot-linked deal","primary_account_id":"d0000000-0000-0000-0000-000000000004",
    "territory_id":"b0000000-0000-0000-0000-000000000002","owner_id":"c0000000-0000-0000-0000-000000000004",
    "stage":"IDENTIFIED","current_status":"Intro made at counter",
    "lead_source":"EXISTING_RELATIONSHIP"}'::jsonb,
  '{"id":"bbbbbbbb-0000-0000-0000-000000000002","org_id":"11111111-1111-1111-1111-111111111111",
    "action":"Follow up with Paula","owner_id":"c0000000-0000-0000-0000-000000000004",
    "due_date":"2026-08-12","account_id":"d0000000-0000-0000-0000-000000000004",
    "opportunity_id":"bbbbbbbb-0000-0000-0000-000000000001",
    "kind":"OTHER"}'::jsonb);
set constraints all immediate;
set constraints all deferred;

reset role;

select has_function('public', 'hubspot_apply_deal',
  array['uuid', 'uuid', 'jsonb', 'jsonb']);

-- 1. open action exists → stage change applies, NO extra action injected
select lives_ok($$
  select public.hubspot_apply_deal('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
    '{"stage":"QUALIFIED"}'::jsonb,
    '{"id":"bbbbbbbb-0000-0000-0000-000000000003","action":"Review deal — stage changed in HubSpot",
      "owner_id":"c0000000-0000-0000-0000-000000000004","due_date":"2026-08-07","account_id":"d0000000-0000-0000-0000-000000000004"}'::jsonb);
  set constraints all immediate;
  set constraints all deferred;
$$, 'stage change with open action applies');
select is((select stage::text from opportunities where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'QUALIFIED', 'stage moved');
select is((select count(*)::int from next_actions where opportunity_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  1, 'no injected action when one is open');

-- 2. complete the open action, advance again → review action IS injected
update next_actions set completed_at = now() where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select lives_ok($$
  select public.hubspot_apply_deal('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
    '{"stage":"DEVELOPMENT"}'::jsonb,
    '{"id":"bbbbbbbb-0000-0000-0000-000000000004","action":"Review deal — stage changed in HubSpot",
      "owner_id":"c0000000-0000-0000-0000-000000000004","due_date":"2026-08-07","account_id":"d0000000-0000-0000-0000-000000000004"}'::jsonb);
  set constraints all immediate;
  set constraints all deferred;
$$, 'stage change with no open action injects the review action');
select is((select count(*)::int from next_actions
  where opportunity_id = 'bbbbbbbb-0000-0000-0000-000000000001' and completed_at is null), 1,
  'review action injected');

-- 3. stage history recorded by the existing trigger
select cmp_ok((select count(*) from opportunity_stage_events
  where opportunity_id = 'bbbbbbbb-0000-0000-0000-000000000001'), '>=', 2::bigint,
  'stage events logged for both transitions');

-- 4. field-only patch (no "stage"/"current_status" keys), deal has NO open
-- next action — must succeed. Second fixture opportunity so this is
-- independent of the completed/injected actions above.
select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;

select public.create_opportunity_with_action(
  '{"id":"cccccccc-0000-0000-0000-000000000001","org_id":"11111111-1111-1111-1111-111111111111",
    "name":"HubSpot field-only sync target","primary_account_id":"d0000000-0000-0000-0000-000000000004",
    "territory_id":"b0000000-0000-0000-0000-000000000002","owner_id":"c0000000-0000-0000-0000-000000000004",
    "stage":"IDENTIFIED","current_status":"Intro made at counter",
    "lead_source":"EXISTING_RELATIONSHIP"}'::jsonb,
  '{"id":"cccccccc-0000-0000-0000-000000000002","org_id":"11111111-1111-1111-1111-111111111111",
    "action":"Follow up with Paula","owner_id":"c0000000-0000-0000-0000-000000000004",
    "due_date":"2026-08-12","account_id":"d0000000-0000-0000-0000-000000000004",
    "opportunity_id":"cccccccc-0000-0000-0000-000000000001",
    "kind":"OTHER"}'::jsonb);
set constraints all immediate;
set constraints all deferred;

reset role;

-- close the only open action, so this deal now has none — exactly the state
-- that reproduced the bug when the patch still listed stage/current_status.
update next_actions set completed_at = now() where id = 'cccccccc-0000-0000-0000-000000000002';

select lives_ok($$
  select public.hubspot_apply_deal('11111111-1111-1111-1111-111111111111', 'cccccccc-0000-0000-0000-000000000001',
    '{"estimated_revenue": 50000}'::jsonb, null);
  set constraints all immediate;
  set constraints all deferred;
$$, 'field-only patch with no open next action does not trip the stage gate');
select is((select estimated_revenue from opportunities where id = 'cccccccc-0000-0000-0000-000000000001'),
  50000.00, 'field updated without touching stage/current_status');

-- 5. org-mismatched call raises instead of silently no-op-ing. Targets the
-- 'cccccccc' opportunity from test 4 specifically because it now has NO open
-- next action — exactly the condition under which the injection branch
-- would otherwise fire and land a next_actions row under the WRONG org
-- (org2) pointed at org1's opportunity/account, which is how the bug was
-- originally reproduced (a mismatched-org call that "succeeded" by writing
-- into the wrong tenant).
select throws_like($$
  select public.hubspot_apply_deal('22222222-2222-2222-2222-222222222222', 'cccccccc-0000-0000-0000-000000000001',
    '{"stage":"QUOTE"}'::jsonb,
    '{"id":"cccccccc-0000-0000-0000-000000000003","action":"Review deal — stage changed in HubSpot",
      "owner_id":"c0000000-0000-0000-0000-000000000004","due_date":"2026-08-07","account_id":"d0000000-0000-0000-0000-000000000004"}'::jsonb)
$$, '%not found for org%', 'org-mismatched call raises instead of silently no-op-ing');
select is((select stage::text from opportunities where id = 'cccccccc-0000-0000-0000-000000000001'),
  'IDENTIFIED', 'org-mismatched call left the opportunity stage untouched');
select is((select count(*)::int from next_actions where opportunity_id = 'cccccccc-0000-0000-0000-000000000001'),
  1, 'org-mismatched call injected no next_actions row, cross-org or otherwise');

select * from finish();
rollback;
