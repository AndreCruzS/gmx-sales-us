-- Branch sheets · tests 23 (20261013100000_branch_sheet_uploads.sql).
--
-- 1. An upload can be one branch's own sheet (branch_id).
-- 2. The month index allows a whole-house upload AND a sheet per branch.
-- 3. A branch sheet without dealer detail is refused.

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select has_column('public', 'sell_through_uploads', 'branch_id', 'an upload can be one branch''s own sheet');
select hasnt_index('public', 'sell_through_uploads', 'sell_through_uploads_period_idx', 'the old one-per-month index is gone');
select has_index('public', 'sell_through_uploads', 'sell_through_uploads_period_branch_idx', 'one per month per branch, or whole house');

select lives_ok($$
  insert into sell_through_uploads (id, org_id, distributor_id, period, period_kind, row_count, unmatched_count, detail, branch_id)
  select 'e0000000-0000-0000-0000-000000000001', b.org_id, b.distributor_id, '2031-07-01', 'MONTH', 0, 0, 'dealer', b.id
  from distributor_branches b order by b.name limit 1;
  insert into sell_through_uploads (id, org_id, distributor_id, period, period_kind, row_count, unmatched_count, detail, branch_id)
  select 'e0000000-0000-0000-0000-000000000002', b.org_id, b.distributor_id, '2031-07-01', 'MONTH', 0, 0, 'branch', null
  from distributor_branches b order by b.name limit 1;
$$, 'a whole-house month and a branch sheet for the same month coexist');

select throws_like($$
  insert into sell_through_uploads (org_id, distributor_id, period, period_kind, row_count, unmatched_count, detail, branch_id)
  select b.org_id, b.distributor_id, '2031-07-01', 'MONTH', 0, 0, 'branch', null
  from distributor_branches b order by b.name limit 1;
$$, '%sell_through_uploads_period_branch_idx%', 'a second whole-house upload for the month is refused');

select throws_like($$
  insert into sell_through_uploads (org_id, distributor_id, period, period_kind, row_count, unmatched_count, detail, branch_id)
  select b.org_id, b.distributor_id, '2031-08-01', 'MONTH', 0, 0, 'branch', b.id
  from distributor_branches b order by b.name limit 1;
$$, '%branch_sheet_has_dealers%', 'a branch sheet without dealers is refused');

select * from finish();
rollback;
