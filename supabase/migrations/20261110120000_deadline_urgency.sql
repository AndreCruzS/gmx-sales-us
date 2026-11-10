-- Deadlines decide urgency. Mirrors src/lib/domain/deadline.ts.
--
-- next_actions.important is the one answer a person gives; urgency comes from
-- the deadline (no more than 2 business days away, Mon-Fri, or already past).
-- The priority is derived from the two and re-derived every night, because a
-- deadline that was far yesterday is near today.
--
-- Safe to run twice: the column is added if missing, the functions are
-- replaced, the backfill touches only rows not yet answered, and the nightly
-- job is unscheduled before it is scheduled again.

alter table next_actions add column if not exists important boolean;

-- n business days after d. From a weekend, Monday is the first one.
create or replace function private.add_business_days(d date, n int)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  left_ int := n;
begin
  if n <= 0 then
    while extract(isodow from d) >= 6 loop d := d + 1; end loop;
    return d;
  end if;
  while left_ > 0 loop
    d := d + 1;
    if extract(isodow from d) < 6 then left_ := left_ - 1; end if;
  end loop;
  return d;
end;
$$;

-- Weekdays in (today, due] ahead, (due, today] late (negative).
create or replace function private.business_days_until(today date, due date)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when today = due then 0
    when today < due then
      (select count(*)::int from generate_series(today + 1, due, interval '1 day') g
        where extract(isodow from g) < 6)
    else
      -(select count(*)::int from generate_series(due + 1, today, interval '1 day') g
         where extract(isodow from g) < 6)
  end;
$$;

-- The priority the two answers give. ELIMINATE is for display only.
create or replace function private.derive_priority(
  important boolean, due date, today date, owner_gives_work boolean)
returns next_action_priority
language sql
immutable
set search_path = ''
as $$
  select case
    when important is null then null
    when important and private.business_days_until(today, due) <= 2 then 'DO_NOW'
    when important then 'PLAN'
    when private.business_days_until(today, due) <= 2
      then case when owner_gives_work then 'DELEGATE' else 'PLAN' end
    else 'ELIMINATE'
  end::public.next_action_priority;
$$;

-- What may be saved on its own: ELIMINATE never is (a trigger closes the item).
create or replace function private.stored_priority(
  important boolean, due date, today date, owner_gives_work boolean)
returns next_action_priority
language sql
immutable
set search_path = ''
as $$
  select case
    when p = 'ELIMINATE' then
      case when owner_gives_work then 'DELEGATE' else 'PLAN' end::public.next_action_priority
    else p
  end
  from (select private.derive_priority(important, due, today, owner_gives_work) as p) s;
$$;

-- Nightly: re-derive the priority of every open item that has an answer.
-- Runs with set_updated_at off so the calendar sync sees no edit, and stamps no
-- last_changed_by because no member is signed in.
create or replace function private.recompute_priorities()
returns int
language plpgsql
set search_path = ''
as $$
declare
  today_ date := (now() at time zone 'America/Los_Angeles')::date;
  n int;
begin
  alter table public.next_actions disable trigger set_updated_at;
  update public.next_actions a
     set priority = private.stored_priority(
           a.important, a.due_date, today_,
           coalesce((select m.role in ('admin', 'support')
                       from public.memberships m where m.id = a.owner_id), false))
   where a.completed_at is null
     and (a.kind is null or a.kind not in ('VISIT', 'CALL', 'MEETING'))
     and a.important is not null
     and a.priority is distinct from 'ELIMINATE'
     and a.priority is distinct from private.stored_priority(
           a.important, a.due_date, today_,
           coalesce((select m.role in ('admin', 'support')
                       from public.memberships m where m.id = a.owner_id), false));
  get diagnostics n = row_count;
  alter table public.next_actions enable trigger set_updated_at;
  return n;
end;
$$;

revoke execute on function private.recompute_priorities() from public, anon, authenticated;

-- Backfill: Do now and Plan were the important ones; Delegate was not.
alter table next_actions disable trigger set_updated_at;
update next_actions set important = true
 where important is null and priority in ('DO_NOW', 'PLAN') and (kind is null or kind not in ('VISIT', 'CALL', 'MEETING'));
update next_actions set important = false
 where important is null and priority = 'DELEGATE' and (kind is null or kind not in ('VISIT', 'CALL', 'MEETING'));
alter table next_actions enable trigger set_updated_at;

select private.recompute_priorities();

-- 09:00 UTC = 04:00 US Eastern, before anyone's morning.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'recompute-priorities') then
      perform cron.unschedule('recompute-priorities');
    end if;
    perform cron.schedule('recompute-priorities', '0 9 * * *',
                          'select private.recompute_priorities()');
  end if;
end $$;
