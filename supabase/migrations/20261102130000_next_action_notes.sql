-- PK follow-up: an append-only notes log on every to-do.
--
-- Notes are never deleted. The author may edit one; each edit keeps the body it
-- replaced in next_action_note_versions, so the log can always show what was
-- said first. Who wrote a note is the signed-in member, never the client's word.
-- A note is visible to whoever can see its to-do (the parent's own policy does
-- the filtering).

create table next_action_notes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations (id),
  next_action_id uuid not null references next_actions (id) on delete cascade,
  author_id      uuid not null references memberships (id),
  body           text not null check (length(btrim(body)) > 0),
  created_at     timestamptz not null default now(),
  edited_at      timestamptz,
  updated_at     timestamptz not null default now()
);

create index next_action_notes_item_idx
  on next_action_notes (next_action_id, created_at);

-- org_id and updated_at are here because every table in this schema carries
-- them (01_schema tests); the version rows are only ever written by the trigger.
create table next_action_note_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id),
  note_id     uuid not null references next_action_notes (id) on delete cascade,
  body        text not null,
  replaced_at timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index next_action_note_versions_note_idx
  on next_action_note_versions (note_id, replaced_at);

create trigger set_updated_at
  before update on next_action_notes
  for each row execute function private.set_updated_at();
create trigger set_updated_at
  before update on next_action_note_versions
  for each row execute function private.set_updated_at();

-- On the way in: a signed-in member is the author, the clock is ours, nothing
-- is edited yet.
create or replace function private.stamp_next_action_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Without a membership (service role: a one-off import, a server job) the
  -- supplied author, created_at and edited_at stand.
  if private.active_membership_id() is not null then
    new.author_id := private.active_membership_id();
    new.created_at := now();
    new.edited_at := null;
  end if;
  return new;
end;
$$;

create trigger stamp_next_action_note
  before insert on next_action_notes
  for each row execute function private.stamp_next_action_note();

-- On edit: only the body moves. The replaced body goes to versions; security
-- definer because clients have no insert policy there.
create or replace function private.version_next_action_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.org_id := old.org_id;
  new.next_action_id := old.next_action_id;
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  new.edited_at := old.edited_at;
  if new.body is distinct from old.body then
    insert into public.next_action_note_versions (org_id, note_id, body)
    values (old.org_id, old.id, old.body);
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger version_next_action_note
  before update on next_action_notes
  for each row execute function private.version_next_action_note();

alter table next_action_notes enable row level security;
alter table next_action_note_versions enable row level security;

create policy next_action_notes_select on next_action_notes
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and exists (select 1 from public.next_actions n where n.id = next_action_id)
  );

create policy next_action_notes_insert on next_action_notes
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and exists (select 1 from public.next_actions n where n.id = next_action_id)
  );

create policy next_action_notes_update on next_action_notes
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and author_id = (select private.active_membership_id())
    and exists (select 1 from public.next_actions n where n.id = next_action_id)
  )
  with check (
    org_id = (select private.jwt_org_id())
    and author_id = (select private.active_membership_id())
  );

-- No delete policy on notes; none at all but select on versions.
create policy next_action_note_versions_select on next_action_note_versions
  for select to authenticated
  using (
    exists (select 1 from public.next_action_notes nn where nn.id = note_id)
  );
