-- Phase 2 tests · 06: custom access token hook (D18/D23/D24) + set_active_org.
begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

-- 1. User with last_active_org_id set and an active membership → claim = that org.
update public.users set last_active_org_id = '11111111-1111-1111-1111-111111111111'
 where id = 'a0000000-0000-0000-0000-000000000003'; -- TJ
select is(
  (public.custom_access_token_hook(jsonb_build_object(
     'user_id', 'a0000000-0000-0000-0000-000000000003',
     'claims', '{"role":"authenticated"}'::jsonb
   )) -> 'claims' ->> 'org_id'),
  '11111111-1111-1111-1111-111111111111',
  'hook stamps the remembered active org'
);

-- 2. No last_active_org_id → falls back to earliest active membership.
update public.users set last_active_org_id = null
 where id = 'a0000000-0000-0000-0000-000000000003';
select is(
  (public.custom_access_token_hook(jsonb_build_object(
     'user_id', 'a0000000-0000-0000-0000-000000000003',
     'claims', '{}'::jsonb
   )) -> 'claims' ->> 'org_id'),
  '11111111-1111-1111-1111-111111111111',
  'hook falls back to the earliest active membership'
);

-- 3. Remembered org without an active membership → falls back, never stamps it.
update public.users set last_active_org_id = '22222222-2222-2222-2222-222222222222'
 where id = 'a0000000-0000-0000-0000-000000000003'; -- TJ is not an acme member
select is(
  (public.custom_access_token_hook(jsonb_build_object(
     'user_id', 'a0000000-0000-0000-0000-000000000003',
     'claims', '{}'::jsonb
   )) -> 'claims' ->> 'org_id'),
  '11111111-1111-1111-1111-111111111111',
  'a remembered org without membership is ignored (D24)'
);
update public.users set last_active_org_id = null
 where id = 'a0000000-0000-0000-0000-000000000003';

-- 4. Suspended membership does not produce a claim.
update public.memberships set status = 'suspended'
 where id = 'c0000000-0000-0000-0000-000000000007'; -- Riley (only acme membership… rep)
select is(
  (public.custom_access_token_hook(jsonb_build_object(
     'user_id', 'a0000000-0000-0000-0000-000000000007',
     'claims', '{}'::jsonb
   )) -> 'claims' ->> 'org_id'),
  null,
  'suspended-only memberships yield no org claim'
);
update public.memberships set status = 'active'
 where id = 'c0000000-0000-0000-0000-000000000007';

-- 5. Existing claims are preserved.
select is(
  (public.custom_access_token_hook(jsonb_build_object(
     'user_id', 'a0000000-0000-0000-0000-000000000004',
     'claims', '{"role":"authenticated","email":"deon@gmxgroup.com"}'::jsonb
   )) -> 'claims' ->> 'email'),
  'deon@gmxgroup.com',
  'hook preserves existing claims'
);

-- 6/7. set_active_org: rejects a non-member org, accepts a member org.
create temp table _rpc (check_name text primary key, sqlstate text);
grant select, insert on _rpc to authenticated;

do $$
begin
  perform tests.set_claims('tj@gmxgroup.com', 'gmx-us');
  perform set_config('role', 'authenticated', true);
  begin
    perform public.set_active_org('22222222-2222-2222-2222-222222222222');
    insert into _rpc values ('switch_to_foreign_org', '00000');
  exception when others then
    insert into _rpc values ('switch_to_foreign_org', sqlstate);
  end;
  begin
    perform public.set_active_org('11111111-1111-1111-1111-111111111111');
    insert into _rpc values ('switch_to_own_org', '00000');
  exception when others then
    insert into _rpc values ('switch_to_own_org', sqlstate);
  end;
  perform set_config('role', 'postgres', true);
end;
$$;

select is((select sqlstate from _rpc where check_name = 'switch_to_foreign_org'),
  '42501', 'set_active_org rejects an org without membership');
select is((select sqlstate from _rpc where check_name = 'switch_to_own_org'),
  '00000', 'set_active_org accepts a member org');

select * from finish();
rollback;
