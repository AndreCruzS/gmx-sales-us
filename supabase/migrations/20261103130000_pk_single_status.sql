-- PK follow-up, one status, part two (2026-11-03). Every open item that was
-- waiting on the dealer becomes WAITING; everything else keeps its progress
-- (Not started reads "To do", Working on it reads "In progress"). Then the
-- sync trigger stops looking at action_required and the column goes.
-- Not an edit as far as the calendar sync is concerned, so updated_at stays.
alter table public.next_actions disable trigger set_updated_at;
update public.next_actions
   set progress = 'WAITING'
 where action_required = 'AWAITING_RESPONSE'
   and progress in ('NOT_STARTED', 'WORKING_ON_IT');
alter table public.next_actions enable trigger set_updated_at;

-- The same function as 20261102120000, without action_required.
create or replace function private.sync_next_action_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  prio_changed boolean;
  prog_changed boolean;
  comp_changed boolean;
  old_completed timestamptz;
begin
  if tg_op = 'INSERT' then
    prio_changed := new.priority is not null;
    prog_changed := new.progress <> 'NOT_STARTED';
    comp_changed := new.completed_at is not null;
    old_completed := null;
  else
    prio_changed := new.priority is distinct from old.priority;
    prog_changed := new.progress is distinct from old.progress;
    comp_changed := new.completed_at is distinct from old.completed_at;
    old_completed := old.completed_at;
  end if;

  -- Eliminate closes the item and has no days.
  if new.priority = 'ELIMINATE' then
    new.priority_days := null;
    if prio_changed then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  elsif prio_changed and tg_op = 'UPDATE' and old.priority = 'ELIMINATE'
        and new.progress <> 'DONE' and not comp_changed then
    -- Leaving Eliminate reopens the item, unless it is Done.
    new.completed_at := null;
  end if;

  if new.priority is distinct from 'ELIMINATE' then
    if comp_changed and new.completed_at is not null and new.progress <> 'DONE' then
      -- Closed by timestamp (home "done", or a row inserted closed). When the
      -- same write also moved progress, the timestamp wins: it is the more
      -- specific statement that the item is finished.
      new.progress := 'DONE';
    elsif prog_changed then
      if new.progress = 'DONE' then
        new.completed_at := coalesce(new.completed_at, now());
      elsif tg_op = 'UPDATE' and old.progress = 'DONE' then
        new.completed_at := null;
      end if;
    elsif comp_changed and old_completed is not null and new.completed_at is null
          and new.progress = 'DONE' then
      -- Reopened from another screen.
      new.progress := 'NOT_STARTED';
    end if;
  elsif prog_changed and new.progress = 'DONE' then
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  -- An Eliminate item whose completed_at is cleared directly stays Eliminate
  -- with progress untouched: it is open again, and the board shows it dimmed
  -- until the priority is changed. Leaving DONE while eliminated keeps
  -- completed_at, because Eliminate alone keeps the item closed.

  -- Who moved a status or the priority, and when. Only a signed-in member
  -- stamps. Without one (service role, server jobs) both columns stay exactly
  -- as supplied, so a server write never re-attributes a member's change.
  if (tg_op = 'INSERT' and (new.priority is not null or new.priority_days is not null
        or new.progress <> 'NOT_STARTED'))
     or (tg_op = 'UPDATE' and (new.priority is distinct from old.priority
        or new.priority_days is distinct from old.priority_days
        or new.progress is distinct from old.progress)) then
    if private.active_membership_id() is not null then
      new.last_changed_by := private.active_membership_id();
      new.last_changed_at := now();
    end if;
  end if;

  return new;
end;
$$;

alter table public.next_actions drop column action_required;
drop type public.next_action_required;
