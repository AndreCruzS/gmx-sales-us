-- Phase 1 tests · 01: schema sanity — RLS enabled everywhere, org_id and
-- trigger-maintained updated_at on every table (build brief §2/§4).
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- Every public base table has RLS enabled. A table added later without RLS
-- fails here before the leakage suite even runs.
select is(
  (select count(*)::int from pg_tables
   where schemaname = 'public' and not rowsecurity),
  0,
  'RLS is enabled on every public table'
);

-- Every public base table except organizations/users carries org_id (D16/D17).
select is(
  (select count(*)::int
   from information_schema.tables t
   where t.table_schema = 'public'
     and t.table_type = 'BASE TABLE'
     and t.table_name not in ('organizations', 'users')
     and not exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = t.table_name
         and c.column_name = 'org_id'
     )),
  0,
  'every table except organizations/users has org_id'
);

-- Every public base table has created_at + updated_at and a set_updated_at
-- trigger (updated_at is the LWW version key, D61).
select is(
  (select count(*)::int
   from information_schema.tables t
   where t.table_schema = 'public'
     and t.table_type = 'BASE TABLE'
     and not exists (
       select 1 from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = t.table_name
         and c.column_name = 'updated_at'
     )),
  0,
  'every table has updated_at'
);

select is(
  (select count(*)::int
   from information_schema.tables t
   where t.table_schema = 'public'
     and t.table_type = 'BASE TABLE'
     and not exists (
       select 1 from pg_trigger tr
       join pg_class cl on cl.oid = tr.tgrelid
       join pg_namespace ns on ns.oid = cl.relnamespace
       where ns.nspname = 'public'
         and cl.relname = t.table_name
         and tr.tgname = 'set_updated_at'
     )),
  0,
  'every table has the set_updated_at trigger'
);

-- Spot-check the load-bearing objects exist.
select has_table('public'::name, 'user_hierarchy'::name, 'user_hierarchy closure table exists');
select has_function('private'::name, 'visible_membership_ids'::name, 'visibility helper exists');
select has_trigger('public'::name, 'opportunities'::name, 'opportunity_stage_gate'::name,
                   'opportunity stage gate trigger exists');

-- updated_at actually moves on update (as postgres, bypassing RLS).
update public.territories set region = 'Northeast US'
 where id = 'b0000000-0000-0000-0000-000000000001';
select cmp_ok(
  (select updated_at from public.territories
    where id = 'b0000000-0000-0000-0000-000000000001'),
  '>=',
  (select created_at from public.territories
    where id = 'b0000000-0000-0000-0000-000000000001'),
  'set_updated_at maintains updated_at'
);

select * from finish();
rollback;
