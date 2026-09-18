-- Dealer aliases · tests 18 (20260918162218_dealer_aliases.sql).
--
-- An alias is a person's word that a distributor's label means one of our
-- accounts. The database applies it, so every path that writes sell_through
-- obeys it. What must hold:
--
-- 1. A NEW ROW with no dealer takes the alias's account — through case and
--    spacing the files never write the same way twice.
-- 2. A NEW ALIAS links the rows already stored under that label.
-- 3. AN ALIAS FILLS A GAP, IT NEVER OVERRULES a dealer already set.
-- 4. ONE LABEL, ONE ANSWER: the same label folded twice is refused.
--
-- Rows are copied from a seeded Boise row (its org, upload, branch, period),
-- so the test does not depend on how the seed spells anything else.

begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

create temp table base as
  select org_id, upload_id, branch_id, period
  from sell_through
  where org_id = '11111111-1111-1111-1111-111111111111'
  limit 1;

create temp table who as
  select
    (select id from accounts where name = 'Ganahl Anaheim' limit 1) as anaheim,
    (select id from accounts where name = 'Ganahl Lumber' limit 1) as banner;

-- ── 2. A new alias links what is already stored ─────────────────────────────

insert into sell_through (org_id, upload_id, branch_id, dealer_id, dealer_label, period, quantity)
select org_id, upload_id, branch_id, null, 'ZZTEST01 - ALIAS STORED EARLIER', period, 100
from base;

insert into dealer_aliases (org_id, label, dealer_id, note)
select '11111111-1111-1111-1111-111111111111',
       'zztest01 -  alias stored earlier', anaheim, 'test'
from who;

select is(
  (select dealer_id from sell_through where dealer_label = 'ZZTEST01 - ALIAS STORED EARLIER'),
  (select anaheim from who),
  'a new alias links the rows already stored under that label'
);

-- ── 1. A new row takes the alias ────────────────────────────────────────────

insert into sell_through (org_id, upload_id, branch_id, dealer_id, dealer_label, period, quantity)
select org_id, upload_id, branch_id, null, '  ZZTEST01 -   Alias Stored Earlier ', period, 50
from base;

select is(
  (select dealer_id from sell_through where dealer_label = '  ZZTEST01 -   Alias Stored Earlier '),
  (select anaheim from who),
  'a new row with no dealer takes the alias, through case and spacing'
);

-- ── 3. It never overrules ───────────────────────────────────────────────────

insert into sell_through (org_id, upload_id, branch_id, dealer_id, dealer_label, period, quantity)
select b.org_id, b.upload_id, b.branch_id, w.banner, 'ZZTEST01 - ALIAS STORED EARLIER', b.period, 7
from base b, who w;

select is(
  (select dealer_id from sell_through
    where dealer_label = 'ZZTEST01 - ALIAS STORED EARLIER' and quantity = 7),
  (select banner from who),
  'a dealer already set on a row is kept'
);

-- ── 4. One label, one answer ────────────────────────────────────────────────

select throws_ok(
  $$insert into dealer_aliases (org_id, label, dealer_id)
    select '11111111-1111-1111-1111-111111111111', 'ZZTEST01 - Alias Stored Earlier', banner
    from who$$,
  '23505',
  null,
  'the same label, folded, cannot mean two accounts'
);

select * from finish();
rollback;
