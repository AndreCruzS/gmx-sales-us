-- Phase 1 tests · 03: hierarchy visibility matrix (spec §4, D53).
-- Rep sees own rows + territory accounts; manager sees the manager_id chain;
-- admin sees org-wide; support sees/writes for assigned reps; NEVER peer-to-peer.
--
-- Seed fixtures (org1): João manages TJ (Buffalo) + Deon (SoCal); Eric is
-- support assigned to TJ. TJ owns 1 activity; Deon owns 1 activity.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

create temp table _vis (check_name text primary key, val bigint);
create temp table _dml (check_name text primary key, sqlstate text);

-- The DO block below records results while running as `authenticated`.
grant select, insert on _vis, _dml to authenticated;

do $$
declare
  m_tj   uuid := 'c0000000-0000-0000-0000-000000000003';
  m_deon uuid := 'c0000000-0000-0000-0000-000000000004';
  v_org1 uuid := '11111111-1111-1111-1111-111111111111';
begin
  -- DML attempts record their outcome into _dml: '00000' = succeeded.
  -- ---- TJ (rep, Buffalo) ----
  perform tests.set_claims('tj@gmxgroup.com', 'gmx-us');
  perform set_config('role', 'authenticated', true);
  insert into _vis select 'tj_own_activities',   count(*) from public.activities where owner_id = m_tj;
  insert into _vis select 'tj_peer_activities',  count(*) from public.activities where owner_id = m_deon;
  insert into _vis select 'tj_all_activities',   count(*) from public.activities;
  insert into _vis select 'tj_buffalo_accounts', count(*) from public.accounts where name = 'Buffalo Lumber Co';
  insert into _vis select 'tj_socal_accounts',   count(*) from public.accounts where name = 'Ganahl Anaheim';
  insert into _vis select 'tj_peer_next_actions', count(*) from public.next_actions where owner_id = m_deon;
  -- Peer-owned insert must be rejected by WITH CHECK (42501).
  begin
    insert into public.activities (org_id, activity_type, primary_account_id, owner_id, what_happened)
    values (v_org1, 'PHONE_CALL', 'd0000000-0000-0000-0000-000000000003', m_deon, 'should fail');
    insert into _dml values ('tj_insert_for_peer', '00000');
  exception when others then
    insert into _dml values ('tj_insert_for_peer', sqlstate);
  end;
  perform set_config('role', 'postgres', true);

  -- ---- Deon (rep, SoCal) ----
  perform tests.set_claims('deon@gmxgroup.com', 'gmx-us');
  perform set_config('role', 'authenticated', true);
  insert into _vis select 'deon_socal_accounts', count(*) from public.accounts where territory_id = 'b0000000-0000-0000-0000-000000000002';
  insert into _vis select 'deon_buffalo_accounts', count(*) from public.accounts where name = 'Buffalo Lumber Co';
  perform set_config('role', 'postgres', true);

  -- ---- João (manager of both reps) ----
  perform tests.set_claims('joao@gmxgroup.com', 'gmx-us');
  perform set_config('role', 'authenticated', true);
  insert into _vis select 'joao_team_activities', count(*) from public.activities where owner_id in (m_tj, m_deon);
  insert into _vis select 'joao_team_next_actions', count(*) from public.next_actions where owner_id in (m_tj, m_deon);
  perform set_config('role', 'postgres', true);

  -- ---- Bianca (admin) ----
  perform tests.set_claims('bianca@gmxgroup.com', 'gmx-us');
  perform set_config('role', 'authenticated', true);
  insert into _vis select 'admin_all_activities', count(*) from public.activities;
  insert into _vis select 'admin_all_accounts',   count(*) from public.accounts;
  perform set_config('role', 'postgres', true);

  -- ---- Eric (support, assigned to TJ only — D53) ----
  perform tests.set_claims('eric@gmxgroup.com', 'gmx-us');
  perform set_config('role', 'authenticated', true);
  insert into _vis select 'eric_tj_activities',   count(*) from public.activities where owner_id = m_tj;
  insert into _vis select 'eric_deon_activities', count(*) from public.activities where owner_id = m_deon;
  -- Support CAN write on behalf of the assigned rep…
  begin
    insert into public.next_actions (org_id, action, owner_id, due_date, account_id)
    values (v_org1, 'Chase PK quote for TJ', m_tj, current_date + 2,
            'd0000000-0000-0000-0000-000000000003');
    insert into _dml values ('eric_insert_for_tj', '00000');
  exception when others then
    insert into _dml values ('eric_insert_for_tj', sqlstate);
  end;
  -- …but not for an unassigned rep.
  begin
    insert into public.next_actions (org_id, action, owner_id, due_date, account_id)
    values (v_org1, 'Should fail for Deon', m_deon, current_date + 2,
            'd0000000-0000-0000-0000-000000000001');
    insert into _dml values ('eric_insert_for_deon', '00000');
  exception when others then
    insert into _dml values ('eric_insert_for_deon', sqlstate);
  end;
  perform set_config('role', 'postgres', true);
end;
$$;

-- Rep: own rows, never a peer's (TJ=Buffalo, Deon=SoCal).
select is((select val from _vis where check_name = 'tj_own_activities'),  1::bigint, 'rep sees own activities');
select is((select val from _vis where check_name = 'tj_peer_activities'), 0::bigint, 'rep sees zero peer activities');
select is((select val from _vis where check_name = 'tj_all_activities'),  1::bigint, 'rep unfiltered feed is own rows only');
select is((select val from _vis where check_name = 'tj_buffalo_accounts'), 1::bigint, 'rep sees own-territory account');
select is((select val from _vis where check_name = 'tj_socal_accounts'),  0::bigint, 'rep cannot see peer-territory account');
select is((select val from _vis where check_name = 'tj_peer_next_actions'), 0::bigint, 'rep sees zero peer next actions');
select is((select sqlstate from _dml where check_name = 'tj_insert_for_peer'), '42501',
  'rep cannot insert a record owned by a peer');

select is((select val from _vis where check_name = 'deon_socal_accounts'), 4::bigint,
  'rep sees all accounts in own territory (banner + 2 branches + contractor)');
select is((select val from _vis where check_name = 'deon_buffalo_accounts'), 0::bigint,
  'SoCal rep cannot see Buffalo account');

-- Manager: the manager_id chain fans out down, both reps visible.
select is((select val from _vis where check_name = 'joao_team_activities'), 2::bigint,
  'manager sees both reps'' activities');
select is((select val from _vis where check_name = 'joao_team_next_actions'), 2::bigint,
  'manager sees both reps'' next actions');

-- Admin: org-wide.
select is((select val from _vis where check_name = 'admin_all_activities'), 2::bigint, 'admin sees all org activities');
select is((select val from _vis where check_name = 'admin_all_accounts'), 5::bigint, 'admin sees all org accounts');

-- Support (D53): assigned rep only, read AND write.
select is((select val from _vis where check_name = 'eric_tj_activities'), 1::bigint, 'support sees assigned rep''s activities');
select is((select val from _vis where check_name = 'eric_deon_activities'), 0::bigint, 'support sees zero unassigned-rep activities');
select is(
  (select string_agg(check_name || '=' || sqlstate, ',' order by check_name)
     from _dml where check_name like 'eric%'),
  'eric_insert_for_deon=42501,eric_insert_for_tj=00000',
  'support writes for assigned rep succeed and for unassigned rep are rejected'
);

select * from finish();
rollback;
