-- Dealer items: what a to-do on a dealer is, where it came from, who typed it.
--
-- next_actions already says what a row is for the routine list (kind: VISIT,
-- SAMPLE_FOLLOW_UP...). The Dealers page needs a second, coarser reading — is
-- this an action, a thing to coordinate, a follow-up, a promise we made, a
-- deadline — so item_type is its own column. Visits keep it null: they are
-- not to-dos. The routine list keeps reading kind.

create type next_action_type as enum
  ('ACTION', 'COORDINATE', 'FOLLOW_UP', 'PROMISE', 'DEADLINE');

create type next_action_source as enum
  ('MANUAL', 'VOICE', 'VISIT_CAPTURE', 'EMAIL_AI', 'EMAIL_BACKFILL');

alter table next_actions
  add column item_type               next_action_type,
  add column source                  next_action_source not null default 'MANUAL',
  add column source_ref              text,
  add column entered_by              uuid references memberships (id),
  add column counterparty_account_id uuid references accounts (id);

-- Everything that is not a visit was, until now, a follow-up. The backfill
-- must not look like an edit to the calendar sync, so updated_at stays put.
alter table next_actions disable trigger set_updated_at;
update next_actions set item_type = 'FOLLOW_UP' where kind is distinct from 'VISIT';
alter table next_actions enable trigger set_updated_at;

-- Fill entered_by and item_type on the way in. Named zz_ so it fires after
-- infer_next_action_kind (triggers run in name order) and sees kind already set.
create or replace function private.stamp_next_action_item()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A signed-in member is always the one who entered it: whatever the client
  -- sent is ignored. Without a membership (service role, server jobs such as
  -- the email import) the supplied value stands.
  if private.active_membership_id() is not null then
    new.entered_by := private.active_membership_id();
  end if;
  if new.item_type is null and new.kind is distinct from 'VISIT' then
    new.item_type := 'FOLLOW_UP';
  end if;
  return new;
end;
$$;

create trigger zz_stamp_next_action_item
  before insert on next_actions
  for each row execute function private.stamp_next_action_item();

-- entered_by is provenance: set once on insert, never changed afterwards.
create or replace function private.keep_next_action_entered_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.entered_by := old.entered_by;
  return new;
end;
$$;

create trigger keep_next_action_entered_by
  before update on next_actions
  for each row execute function private.keep_next_action_entered_by();

-- Insert: own/visible rows as before, plus an item for someone else only when
-- the member entered it themselves and is an admin or assigned to that owner.
drop policy next_actions_insert on next_actions;
create policy next_actions_insert on next_actions
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_id in (select private.visible_membership_ids())
      or (
        entered_by = (select private.active_membership_id())
        and (
          (select private.is_admin())
          or exists (
            select 1
            from public.support_assignments sa
            where sa.support_membership_id = (select private.active_membership_id())
              and sa.rep_membership_id = next_actions.owner_id
              and sa.org_id = next_actions.org_id
          )
        )
      )
    )
  );
