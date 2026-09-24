-- Product line · tests 19 (20260924165355_product_line.sql).
--
-- The screens read one line at a time and open on THERMO, so the line a
-- product belongs to decides what every figure counts. The rule lives twice —
-- here, on the stored column the aggregates group by, and in the app
-- (src/lib/domain/sell-through.ts, productLine) for the rows already fetched.
-- These are the examples the two must agree on; they come from the real files.
--
-- 1. The three lines are read out of the product name.
-- 2. "TM" counts as thermally modified, but only as its own word (Andre,
--    2026-09-24, on a Radiata Pine T&G carrying 11,562 LF).
-- 3. A row with no product name has no line — it is unknown, not a hardwood.
-- 4. The reading view carries the column, and the period totals split by it
--    without changing what a month adds up to.

begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

create temp table base as
  select org_id, upload_id, branch_id, period
  from sell_through
  where org_id = '11111111-1111-1111-1111-111111111111'
  limit 1;

create temp table sample (label text, product text, want text);
insert into sample values
  ('thermowood',  '083003213 1X6-154" THERMOWOOD CLAD V-GRV/NCKL GAP AYOUS', 'THERMO'),
  ('maximo',      '16MTAYVJNG 1X6 MAXIMO THERMO AYOUS V-JOINT/NICKEL GAP',   'THERMO'),
  ('spelled out', 'MLTAGAY422059_Ayous T&G Reversible Thermally Modified',   'THERMO'),
  ('tm as a word','MLTAGRP422301_Radiata Pine T&G N-GAP TM Saicos Finish',   'THERMO'),
  ('accoya',      'MLEDMAY422096_FSC Accoya Grey Radiata Pine Decking E4E',  'ACCOYA'),
  ('ipe',         'MLDECIP550001_Ipe Decking_1 X 6 X RL',                    'HARDWOODS'),
  ('garapa',      'MLS4SGP452725_Garapa S4S E4E_1 X 6 X RL',                 'HARDWOODS');

insert into sell_through (org_id, upload_id, branch_id, dealer_label, product, period, quantity)
select b.org_id, b.upload_id, b.branch_id, 'ZZLINE - TEST', s.product, b.period, 10
from base b, sample s;

select is(
  (select count(*)::int from sell_through st
     join sample s on s.product = st.product
    where st.dealer_label = 'ZZLINE - TEST' and st.product_line is distinct from s.want),
  0,
  'every product name lands on the line the app reads it as'
);

select is(
  (select product_line from sell_through
    where dealer_label = 'ZZLINE - TEST'
      and product like '%TM Saicos%'),
  'THERMO',
  'TM, as its own word, is thermally modified'
);

-- A code that merely contains the letters is not a treatment.
insert into sell_through (org_id, upload_id, branch_id, dealer_label, product, period, quantity)
select org_id, upload_id, branch_id, 'ZZLINE - TEST', 'MLDECTMX999_Ipe Decking_1 X 6 X RL', period, 10
from base;

select is(
  (select product_line from sell_through
    where dealer_label = 'ZZLINE - TEST' and product like 'MLDECTMX999%'),
  'HARDWOODS',
  'letters inside a code do not make a row thermo'
);

insert into sell_through (org_id, upload_id, branch_id, dealer_label, product, period, quantity)
select org_id, upload_id, branch_id, 'ZZLINE - NONAME', null, period, 10 from base;

select is(
  (select product_line from sell_through where dealer_label = 'ZZLINE - NONAME'),
  null,
  'a row with no product name has no line — unknown, not a hardwood'
);

select has_column('public', 'sell_through_rows', 'product_line',
  'the reading view carries the line');
select has_column('public', 'sell_through_periods', 'product_line',
  'the period totals carry the line');

-- The month still adds up to what it always did, split or not.
select is(
  (select sum(quantity) from sell_through_periods
    where period = (select period from base) and period_kind = 'MONTH'),
  (select sum(quantity) from sell_through_rows
    where period = (select period from base) and period_kind = 'MONTH'),
  'splitting the totals by line changes no month''s total'
);

select isnt(
  (select count(distinct product_line)::int from sell_through_periods
    where period = (select period from base)),
  0,
  'a month reports at least one line'
);

select * from finish();
rollback;
