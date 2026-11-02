-- PK follow-up: who has read a to-do, and a checklist of subtasks under it.
--
-- Reads: one row per (member, item) holding the last time that member opened
-- it. A member writes only their own row; everyone who can see the item sees
-- the rows (that is what lets the board show who has read it). Never deleted.
-- Subtasks: visible to whoever can see the item, editable by whoever may update
-- it (an admin, or the owner / someone above the owner), same as next_actions.

create table next_action_reads (
  org_id         uuid not null references organizations (id),
  membership_id  uuid not null references memberships (id),
  next_action_id uuid not null references next_actions (id) on delete cascade,
  last_read_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (membership_id, next_action_id)
);

create index next_action_reads_item_idx on next_action_reads (next_action_id);

create table next_action_subtasks (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations (id),
  next_action_id uuid not null references next_actions (id) on delete cascade,
  title          text not null check (length(btrim(title)) > 0),
  done_at        timestamptz,
  position       int not null default 0,
  created_by     uuid references memberships (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index next_action_subtasks_item_idx
  on next_action_subtasks (next_action_id, position);

-- updated_at is here because every table in this schema carries it (01_schema
-- tests); last_read_at stays the meaningful read time.
create trigger set_updated_at
  before update on next_action_reads
  for each row execute function private.set_updated_at();
create trigger set_updated_at
  before update on next_action_subtasks
  for each row execute function private.set_updated_at();

-- A signed-in member is the creator, whatever the client sent; with no member
-- (service role: a one-off import) the supplied value stands.
create or replace function private.stamp_next_action_subtask()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.active_membership_id() is not null then
    new.created_by := private.active_membership_id();
  end if;
  return new;
end;
$$;

create trigger stamp_next_action_subtask
  before insert on next_action_subtasks
  for each row execute function private.stamp_next_action_subtask();

alter table next_action_reads enable row level security;
alter table next_action_subtasks enable row level security;

create policy next_action_reads_select on next_action_reads
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and exists (select 1 from public.next_actions n where n.id = next_action_id)
  );

create policy next_action_reads_insert on next_action_reads
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and membership_id = (select private.active_membership_id())
    and exists (select 1 from public.next_actions n where n.id = next_action_id)
  );

create policy next_action_reads_update on next_action_reads
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and membership_id = (select private.active_membership_id())
  )
  with check (
    org_id = (select private.jwt_org_id())
    and membership_id = (select private.active_membership_id())
    and exists (select 1 from public.next_actions n where n.id = next_action_id)
  );

-- No delete policy on reads.

create policy next_action_subtasks_select on next_action_subtasks
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and exists (select 1 from public.next_actions n where n.id = next_action_id)
  );

create policy next_action_subtasks_insert on next_action_subtasks
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and exists (
      select 1 from public.next_actions n
       where n.id = next_action_id
         and (n.owner_id in (select private.visible_membership_ids())
              or (select private.is_admin()))
    )
  );

create policy next_action_subtasks_update on next_action_subtasks
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and exists (
      select 1 from public.next_actions n
       where n.id = next_action_id
         and (n.owner_id in (select private.visible_membership_ids())
              or (select private.is_admin()))
    )
  )
  with check (
    org_id = (select private.jwt_org_id())
    and exists (
      select 1 from public.next_actions n
       where n.id = next_action_id
         and (n.owner_id in (select private.visible_membership_ids())
              or (select private.is_admin()))
    )
  );

create policy next_action_subtasks_delete on next_action_subtasks
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and exists (
      select 1 from public.next_actions n
       where n.id = next_action_id
         and (n.owner_id in (select private.visible_membership_ids())
              or (select private.is_admin()))
    )
  );
