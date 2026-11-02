-- PK follow-up: a priority, an action-required and a progress on every to-do.
--
-- priority says how soon (Do now / Plan / Delegate) or that it is dropped
-- (Eliminate); priority_days feeds the alert date the client writes into
-- due_date. action_required says whose move it is; progress says how far it is.
-- progress is not called status: status stays free for the email-AI proposals.
-- Done and Eliminate both close the item through completed_at, so the home
-- page, agenda and late counts keep working unchanged.

create type next_action_priority as enum ('DO_NOW', 'PLAN', 'DELEGATE', 'ELIMINATE');
create type next_action_required as enum ('PENDING_ACTION', 'AWAITING_RESPONSE', 'NONE');
create type next_action_progress as enum ('NOT_STARTED', 'WORKING_ON_IT', 'STUCK', 'DONE');

alter table next_actions
  add column priority        next_action_priority,
  add column priority_days   int check (priority_days >= 0),
  add column action_required next_action_required not null default 'NONE',
  add column progress        next_action_progress not null default 'NOT_STARTED',
  add column last_changed_by uuid references memberships (id),
  add column last_changed_at timestamptz;

-- Everything already closed reads Done. Not an edit as far as the calendar
-- sync is concerned, so updated_at stays put.
alter table next_actions disable trigger set_updated_at;
update next_actions set progress = 'DONE' where completed_at is not null;
alter table next_actions enable trigger set_updated_at;

-- Keeps completed_at, progress and priority telling one story, and stamps who
-- moved a status. Named zz_ so it fires after the other next_actions triggers.
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
        or new.action_required <> 'NONE' or new.progress <> 'NOT_STARTED'))
     or (tg_op = 'UPDATE' and (new.priority is distinct from old.priority
        or new.priority_days is distinct from old.priority_days
        or new.action_required is distinct from old.action_required
        or new.progress is distinct from old.progress)) then
    if private.active_membership_id() is not null then
      new.last_changed_by := private.active_membership_id();
      new.last_changed_at := now();
    end if;
  end if;

  return new;
end;
$$;

create trigger zz_sync_next_action_progress
  before insert or update on next_actions
  for each row execute function private.sync_next_action_progress();
