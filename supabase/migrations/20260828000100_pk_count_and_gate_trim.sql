-- PK becomes a COUNT, not a checkbox that saturates.
--
-- The class gets taught more than once at the same counter — new staff, a new
-- product line — and Bianca wants the book to remember that: "o número de pk
-- acumulado se foi feito mais de uma vez pro mesmo cliente". A state can say
-- done; only a count can say how much teaching has actually happened.
--
-- pk_state STAYS, synced from the count, because every existing view, the
-- exception queries and the offline layer read it. One writer (the count),
-- one derived reading (the state) — the trigger is what stops them drifting.
--
-- The other asks from the same review land in the APP, not here: material
-- shown as yes/no (the enum keeps PENDING for the tracker's sake), the
-- merchandiser gate hidden, the wall relabelled "Display wall / rolling
-- display". Schema only changes where the data itself was missing a fact.

alter table account_rollout
  add column if not exists pk_count integer not null default 0
  constraint account_rollout_pk_count_nonneg check (pk_count >= 0);

-- Every branch already marked OK has had at least the one class.
update account_rollout set pk_count = 1 where pk_state = 'OK' and pk_count = 0;

create or replace function private.account_rollout_sync_pk()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.pk_count = 0 and new.pk_state = 'OK' then
    -- A state-only writer (the tracker import) says done without a count:
    -- the state is the truth on the way in, so it implies the first class.
    new.pk_count := 1;
  elsif new.pk_count > 0 then
    new.pk_state := 'OK';
  elsif new.pk_state = 'OK' then
    -- The count went back to zero, so the gate is no longer done. PENDING is
    -- left alone: a class being scheduled is not a class taught.
    new.pk_state := 'NO';
  end if;
  return new;
end;
$$;

create trigger sync_pk_state
  before insert or update of pk_count on account_rollout
  for each row execute function private.account_rollout_sync_pk();

-- Both views appended-to, never reordered: CREATE OR REPLACE holds existing
-- columns to their places, and every consumer reads by name anyway.
-- security_invoker restated on both — replacing a view rewrites its options,
-- and omitting it silently drops RLS.

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
  r.updated_by,
  coalesce(r.pk_count, 0)              as pk_count
from accounts a
left join account_rollout r on r.account_id = a.id
where a.account_type = 'DEALER';

comment on view account_rollout_status is
  'Four rollout gates per account, plus how many PK classes each has actually '
  'had. gates_done is a count, not a stage: gates complete out of order and '
  'the gaps are the point.';

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
  count(*) filter (where material_state = 'PENDING')        as material_pending,
  coalesce(sum(pk_count), 0)                                as pk_total
from account_rollout_status
group by org_id;

comment on view dashboard_rollout is
  'Rollout gates per org, counted three ways each: done, in progress, and (by '
  'subtraction) not started — plus pk_total, the classes actually taught, '
  'which can exceed pk_done because a counter can be taught twice.';
