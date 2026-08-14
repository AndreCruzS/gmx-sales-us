-- The gates have three states, not two.
--
-- Bianca's tracker records each gate as `ok`, `pending` or `no` — and the app
-- was only ever counting the `ok`s. A branch with a merchandiser being hired
-- and a wall going up read exactly like a branch where nobody had started,
-- which is the opposite of what a rollout book is for: pending IS the work in
-- progress, and it is the column she looks at to know whether anything is
-- moving.
--
-- Two corrections here.
--
-- 1. A BRANCH IS A DEALER. account_rollout_status has always included
--    distributors, which was harmless while there were none in the data. Now
--    that Boise, Hardwoods and Russin exist it inflated the book from four
--    branches to seven and made every gate look worse than it is. The tracker's
--    own sections are dealer banners — Ganahl, BFS, Dixie Line — and a
--    distributor does not get a display wall or a PK class for its counter.
--
-- 2. PENDING IS COUNTED. dashboard_rollout gains a pending count per gate,
--    appended so the existing columns keep their places.
--
-- security_invoker is restated on both: CREATE OR REPLACE VIEW rewrites a
-- view's options, and omitting it silently drops RLS.

create or replace view account_rollout_status
  with (security_invoker = true) as
select
  a.id            as account_id,
  a.org_id,
  a.owner_id,
  a.territory_id,
  a.name,
  a.parent_account_id,
  coalesce(r.pk_state, 'NO')           as pk_state,
  coalesce(r.merchandiser_state, 'NO') as merchandiser_state,
  case
    when a.has_display_wall and a.display_last_verified_at is not null then 'OK'
    when a.has_display_wall then 'PENDING'
    else 'NO'
  end::rollout_gate_state              as display_wall_state,
  coalesce(r.material_state, 'NO')     as material_state,
  r.product,
  r.notes,
  (
    (case when coalesce(r.pk_state, 'NO') = 'OK' then 1 else 0 end)
    + (case when coalesce(r.merchandiser_state, 'NO') = 'OK' then 1 else 0 end)
    + (case when a.has_display_wall and a.display_last_verified_at is not null then 1 else 0 end)
    + (case when coalesce(r.material_state, 'NO') = 'OK' then 1 else 0 end)
  )                                    as gates_done,
  r.updated_at,
  r.updated_by
from accounts a
left join account_rollout r on r.account_id = a.id
where a.account_type = 'DEALER';

create or replace view dashboard_rollout
  with (security_invoker = true) as
select
  org_id,
  count(*)                                                  as branches,
  count(*) filter (where pk_state = 'OK')                   as pk_done,
  count(*) filter (where merchandiser_state = 'OK')         as merchandiser_done,
  count(*) filter (where display_wall_state = 'OK')         as display_wall_done,
  count(*) filter (where material_state = 'OK')             as material_done,
  count(*) filter (where gates_done = 4)                    as fully_through,
  count(*) filter (where gates_done = 0)                    as not_started,
  count(*) filter (where pk_state = 'PENDING')              as pk_pending,
  count(*) filter (where merchandiser_state = 'PENDING')    as merchandiser_pending,
  count(*) filter (where display_wall_state = 'PENDING')    as display_wall_pending,
  count(*) filter (where material_state = 'PENDING')        as material_pending
from account_rollout_status
group by org_id;

comment on view dashboard_rollout is
  'Rollout gates per org, counted three ways each: done, in progress, and (by '
  'subtraction) not started. Branches are dealers; a distributor is not one.';
