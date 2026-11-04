-- Agent connector: origin marking and the agent action log.
--
-- Rows made through the connector (Claude or Meta Muse acting with the user's
-- own JWT) carry created_via; app writes leave it null. Every agent write is
-- logged in agent_actions, which backs undo. Only the acting user can see or
-- touch their own log; nothing is ever deleted.

alter table next_actions         add column created_via text check (created_via in ('claude', 'muse'));
alter table activities           add column created_via text check (created_via in ('claude', 'muse'));
alter table next_action_notes    add column created_via text check (created_via in ('claude', 'muse'));
alter table next_action_subtasks add column created_via text check (created_via in ('claude', 'muse'));
alter table accounts             add column created_via text check (created_via in ('claude', 'muse'));
alter table contacts             add column created_via text check (created_via in ('claude', 'muse'));
alter table account_notes        add column created_via text check (created_via in ('claude', 'muse'));

create table agent_actions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default private.jwt_org_id() references organizations (id),
  user_id    uuid not null default auth.uid(),
  session_id text not null,
  via        text not null check (via in ('claude', 'muse')),
  tool       text not null,
  entity     text not null,
  entity_id  uuid not null,
  op         text not null check (op in ('create', 'update')),
  before     jsonb,
  undone_at  timestamptz,
  created_at timestamptz not null default now(),
  -- every table in this schema carries updated_at (01_schema tests)
  updated_at timestamptz not null default now()
);

-- Undo walks a session newest-first.
create index agent_actions_undo_idx
  on agent_actions (user_id, session_id, created_at desc);

create trigger set_updated_at
  before update on agent_actions
  for each row execute function private.set_updated_at();

alter table agent_actions enable row level security;

create policy agent_actions_insert on agent_actions for insert to authenticated
  with check (user_id = auth.uid() and org_id = private.jwt_org_id());
create policy agent_actions_select on agent_actions for select to authenticated
  using (user_id = auth.uid());
create policy agent_actions_update on agent_actions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- no delete policy: the log is append-only.
