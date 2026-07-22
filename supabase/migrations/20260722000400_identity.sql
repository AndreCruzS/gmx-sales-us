-- Phase 1 · migration 4: identity — users, territories, memberships,
-- support_assignments (D53), user_hierarchy closure table (spec §4).
--
-- users = identity only; memberships = org-scoped role/territory/manager (D22).
-- All ownership FKs elsewhere point at memberships(id), not users(id): the
-- org-scoped membership is the actor, and the manager chain lives on it.

create table users (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null unique,
  full_name          text,
  avatar_url         text,
  last_active_org_id uuid references organizations (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger set_updated_at
  before update on users
  for each row execute function private.set_updated_at();

-- Mirror auth.users into public.users on signup.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create table territories (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id),
  name       text not null,
  region     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

create trigger set_updated_at
  before update on territories
  for each row execute function private.set_updated_at();

create table memberships (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations (id),
  user_id          uuid not null references users (id),
  role             membership_role not null default 'rep',
  territory_id     uuid references territories (id),
  manager_id       uuid references memberships (id),
  status           membership_status not null default 'active',
  debrief_language text not null default 'en', -- Q7: per-membership transcription language
  joined_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, user_id),
  check (manager_id <> id)
);

create trigger set_updated_at
  before update on memberships
  for each row execute function private.set_updated_at();

-- Support role acts on behalf of assigned reps (D53). RLS reads this.
create table support_assignments (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations (id),
  support_membership_id uuid not null references memberships (id),
  rep_membership_id     uuid not null references memberships (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (org_id, support_membership_id, rep_membership_id),
  check (support_membership_id <> rep_membership_id)
);

create trigger set_updated_at
  before update on support_assignments
  for each row execute function private.set_updated_at();

-- user_hierarchy strategy: closure table (ancestor sees descendant), including
-- self at depth 0. Rebuilt per-org by trigger on memberships — org headcounts
-- are small, so whole-org rebuild is simple and always correct. Server-internal:
-- RLS enabled with no policies; only security definer helpers read it.
create table user_hierarchy (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations (id),
  ancestor_id   uuid not null references memberships (id) on delete cascade,
  descendant_id uuid not null references memberships (id) on delete cascade,
  depth         int  not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (ancestor_id, descendant_id)
);

create trigger set_updated_at
  before update on user_hierarchy
  for each row execute function private.set_updated_at();

create or replace function private.rebuild_user_hierarchy(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_hierarchy where org_id = p_org_id;

  insert into public.user_hierarchy (org_id, ancestor_id, descendant_id, depth)
  with recursive chain as (
    select m.id as descendant_id, m.id as ancestor_id, 0 as depth
    from public.memberships m
    where m.org_id = p_org_id
    union all
    select c.descendant_id, m.manager_id, c.depth + 1
    from chain c
    join public.memberships m on m.id = c.ancestor_id
    where m.manager_id is not null
      and c.depth < 32 -- belt-and-braces; cycles are blocked by trigger below
  )
  select p_org_id, ancestor_id, descendant_id, depth from chain;
end;
$$;

-- Reject manager cycles and cross-org manager links before they corrupt the
-- closure rebuild.
create or replace function private.check_membership_manager()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cursor uuid;
  v_org    uuid;
  v_depth  int := 0;
begin
  if new.manager_id is null then
    return new;
  end if;

  select org_id into v_org from public.memberships where id = new.manager_id;
  if v_org is distinct from new.org_id then
    raise exception 'manager % is not a membership of org %', new.manager_id, new.org_id;
  end if;

  v_cursor := new.manager_id;
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'manager chain cycle detected for membership %', new.id;
    end if;
    select manager_id into v_cursor from public.memberships where id = v_cursor;
    v_depth := v_depth + 1;
    if v_depth > 64 then
      raise exception 'manager chain too deep for membership %', new.id;
    end if;
  end loop;

  return new;
end;
$$;

create trigger check_membership_manager
  before insert or update of manager_id, org_id on memberships
  for each row execute function private.check_membership_manager();

create or replace function private.on_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.rebuild_user_hierarchy(old.org_id);
    return old;
  end if;
  perform private.rebuild_user_hierarchy(new.org_id);
  return new;
end;
$$;

create trigger rebuild_hierarchy_on_membership_change
  after insert or delete or update of manager_id, status on memberships
  for each row execute function private.on_membership_change();
