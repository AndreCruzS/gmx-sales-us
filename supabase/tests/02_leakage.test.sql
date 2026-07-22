-- Phase 1 tests · 02: cross-tenant leakage suite (spec §4 testing note).
--
-- Seed has two orgs. For EVERY public table carrying org_id, probe as an
-- authenticated user of each org and assert zero foreign-org rows — both with
-- an explicit foreign-org filter and unfiltered. Tables are discovered from
-- information_schema, so a table added later is covered automatically.
-- A tampered claim (org the user has no membership in, D24) must yield zero
-- rows everywhere.
--
-- Pattern: probes run inside DO blocks that flip role to `authenticated` per
-- query; pgTAP assertions always run as postgres.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

create temp table _probe (
  persona     text,
  tbl         text,
  foreign_cnt bigint, -- rows of the other org, explicitly filtered
  other_cnt   bigint, -- rows not of my org, unfiltered scan
  own_cnt     bigint  -- rows of my org (control: proves probes aren't vacuous)
);

create temp table _extra (check_name text primary key, val bigint);

-- The DO block below records probe results while running as `authenticated`.
grant select, insert on _probe, _extra to authenticated;

do $$
declare
  v_org1 uuid := '11111111-1111-1111-1111-111111111111'; -- gmx-us
  v_org2 uuid := '22222222-2222-2222-2222-222222222222'; -- acme-test
  p record;
  r record;
  v_foreign bigint;
  v_other   bigint;
  v_own     bigint;
begin
  for p in
    select * from (values
      ('org2-rep',   'riley@acme.test',     'acme-test', '22222222-2222-2222-2222-222222222222'::uuid, '11111111-1111-1111-1111-111111111111'::uuid),
      ('org1-rep',   'tj@gmxgroup.com',     'gmx-us',    '11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid),
      ('org1-admin', 'bianca@gmxgroup.com', 'gmx-us',    '11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid),
      -- TJ has no membership in acme-test: a forged/stale org claim (D24)
      ('tampered',   'tj@gmxgroup.com',     'acme-test', '22222222-2222-2222-2222-222222222222'::uuid, '11111111-1111-1111-1111-111111111111'::uuid)
    ) as t(persona, email, slug, my_org, foreign_org)
  loop
    perform tests.set_claims(p.email, p.slug);

    for r in
      select t.table_name
      from information_schema.tables t
      where t.table_schema = 'public'
        and t.table_type = 'BASE TABLE'
        and exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public'
            and c.table_name = t.table_name
            and c.column_name = 'org_id'
        )
    loop
      perform set_config('role', 'authenticated', true);
      execute format('select count(*) from public.%I where org_id = $1', r.table_name)
        into v_foreign using p.foreign_org;
      execute format('select count(*) from public.%I where org_id <> $1', r.table_name)
        into v_other using p.my_org;
      execute format('select count(*) from public.%I where org_id = $1', r.table_name)
        into v_own using p.my_org;
      perform set_config('role', 'postgres', true);
      insert into _probe values (p.persona, r.table_name, v_foreign, v_other, v_own);
    end loop;
  end loop;

  -- organizations (no org_id column) + users identity table, as org2 rep
  perform tests.set_claims('riley@acme.test', 'acme-test');
  perform set_config('role', 'authenticated', true);
  insert into _extra
    select 'org2_sees_foreign_orgs', count(*) from public.organizations
     where id <> v_org2;
  insert into _extra
    select 'org2_sees_own_org', count(*) from public.organizations
     where id = v_org2;
  insert into _extra
    select 'org2_sees_org1_users', count(*) from public.users
     where email like '%gmxgroup.com';
  perform set_config('role', 'postgres', true);
end;
$$;

select is(
  (select coalesce(sum(foreign_cnt), -1)::bigint from _probe where persona = 'org2-rep'),
  0::bigint,
  'org2 rep sees zero org1 rows on every table (explicit filter)'
);

select is(
  (select coalesce(sum(other_cnt), -1)::bigint from _probe where persona = 'org2-rep'),
  0::bigint,
  'org2 rep sees zero non-org2 rows on every table (unfiltered)'
);

select is(
  (select coalesce(sum(foreign_cnt + other_cnt), -1)::bigint
     from _probe where persona in ('org1-rep', 'org1-admin')),
  0::bigint,
  'org1 rep and admin see zero org2 rows on every table'
);

-- Controls: probes are not vacuously green.
select cmp_ok(
  (select sum(own_cnt)::bigint from _probe where persona = 'org2-rep'), '>', 0::bigint,
  'control: org2 rep sees own-org rows'
);

select is(
  (select coalesce(sum(foreign_cnt + other_cnt + own_cnt), -1)::bigint
     from _probe where persona = 'tampered'),
  0::bigint,
  'a claim without an active membership yields zero rows everywhere (D24)'
);

select is((select val from _extra where check_name = 'org2_sees_foreign_orgs'),
  0::bigint, 'org2 rep cannot see other organization rows');
select is((select val from _extra where check_name = 'org2_sees_own_org'),
  1::bigint, 'control: org2 rep sees their own organization row');
select is((select val from _extra where check_name = 'org2_sees_org1_users'),
  0::bigint, 'org2 rep sees no org1 user identities');

select * from finish();
rollback;
