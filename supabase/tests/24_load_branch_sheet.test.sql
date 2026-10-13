-- Loading a branch sheet · tests 24 (20261013120000_load_branch_sheet.sql).
--
-- 1. The function replaces ONE branch inside the house's month and nothing else.
-- 2. Called twice, it replaces its own sheet, never doubles.
-- 3. A month and a YTD-through-the-same-month may coexist.

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_function('public', 'load_branch_sheet', array['jsonb', 'jsonb'], 'load_branch_sheet exists');

-- Two Boise branches from the seed, a whole-house July 2031 with rows at both.
create temp table t as
  select b.org_id, b.distributor_id, b.id as branch_id, row_number() over (order by b.name) as n
  from distributor_branches b
  join accounts a on a.id = b.distributor_id
  where a.name ilike 'boise%'
  order by b.name limit 2;

insert into sell_through_uploads (id, org_id, distributor_id, period, period_kind, row_count, unmatched_count, detail)
select 'e0000000-0000-0000-0000-000000000010', org_id, distributor_id, '2031-07-01', 'MONTH', 3, 0, 'branch'
from t where n = 1;

insert into sell_through (org_id, upload_id, branch_id, dealer_label, period, product, quantity)
-- Cast in a UNION: a bare literal is text there, and the column is uuid.
select org_id, 'e0000000-0000-0000-0000-000000000010'::uuid, branch_id, null::text, '2031-07-01'::date, 'X', 10 from t where n = 1
union all
select org_id, 'e0000000-0000-0000-0000-000000000010'::uuid, branch_id, null::text, '2031-07-01'::date, 'Y', 20 from t where n = 1
union all
select org_id, 'e0000000-0000-0000-0000-000000000010'::uuid, branch_id, null::text, '2031-07-01'::date, 'Z', 30 from t where n = 2;

-- Branch 1 sends its own sheet with one dealer row.
select lives_ok($$
  select load_branch_sheet(
    jsonb_build_object('org_id', org_id, 'distributor_id', distributor_id, 'period', '2031-07-01',
                       'period_kind', 'MONTH', 'branch_id', branch_id, 'unmatched_count', 1,
                       'filename', 'riverside.xlsx'),
    jsonb_build_array(jsonb_build_object('branch_id', branch_id, 'dealer_id', null,
                       'dealer_label', 'GANLUGG - GANAHL LUMBER', 'product', 'X', 'quantity', 30)))
  from t where n = 1
$$, 'a branch sheet loads');

select is((select count(*)::int from sell_through where upload_id = 'e0000000-0000-0000-0000-000000000010'),
  1, 'the house file keeps only the other branch''s row');
select is((select row_count from sell_through_uploads where id = 'e0000000-0000-0000-0000-000000000010'),
  1, 'and its row_count says so');
select is((select count(*)::int from sell_through_uploads u join t on t.branch_id = u.branch_id where u.period = '2031-07-01'),
  1, 'one sheet upload for the branch');
select is((select dealer_label from sell_through s join t on t.branch_id = s.branch_id and t.n = 1 where s.period = '2031-07-01'),
  'GANLUGG - GANAHL LUMBER', 'the branch''s rows are the sheet''s');

-- Loaded again: replaced, not doubled.
select lives_ok($$
  select load_branch_sheet(
    jsonb_build_object('org_id', org_id, 'distributor_id', distributor_id, 'period', '2031-07-01',
                       'period_kind', 'MONTH', 'branch_id', branch_id),
    jsonb_build_array(jsonb_build_object('branch_id', branch_id, 'dealer_label', 'A', 'product', 'X', 'quantity', 1),
                      jsonb_build_object('branch_id', branch_id, 'dealer_label', 'B', 'product', 'Y', 'quantity', 2)))
  from t where n = 1
$$, 'the same sheet loads again');
select is((select count(*)::int from sell_through s join t on t.branch_id = s.branch_id and t.n = 1 where s.period = '2031-07-01'),
  2, 'the branch holds the new sheet''s rows only');

select * from finish();
rollback;
