-- Branch-level sell-through · tests 21 (20261012180000_branch_level_sell_through.sql).
--
-- 1. An upload says its detail level; only dealer/branch are allowed.
-- 2. A branch-level row has no label and the view says which it is.

begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select col_default_is('public', 'sell_through_uploads', 'detail', 'dealer',
  'uploads default to dealer detail');
select col_is_null('public', 'sell_through', 'dealer_label', 'a branch-level row has no label');
select has_column('public', 'sell_through_rows', 'detail', 'the reading view carries the level');

create temp table u as
  select id from sell_through_uploads limit 1;
select throws_like(
  $$ update sell_through_uploads set detail = 'customer' where id = (select id from u) $$,
  '%detail%', 'detail rejects anything but dealer/branch');
select lives_ok(
  $$ update sell_through_uploads set detail = 'branch' where id = (select id from u) $$,
  'detail takes branch');

select * from finish();
rollback;
