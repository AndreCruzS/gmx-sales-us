-- A NOTE ON THE ACCOUNT'S HISTORY (Bianca, 2026-09-18: "em history, eu
-- queria colocar a possibilidade de add note para ir atualizando também o que
-- está acontecendo" — e.g. "falamos com a Michelle, precisamos comprar o
-- vendor package que eles oferecem").
--
-- Its own table, not an activity of type OTHER: an activity is a visit, a
-- call, a PK — the things a rep's day is counted in, and every scorecard and
-- planned-vs-actual figure reads activities. A note is what someone learned
-- or decided; counting it as a visit would put a sentence typed at a desk on
-- a rep's numbers. The History reads both, in time order.
--
-- Visible to whoever can see the account; written by whoever can see it, in
-- their own name; corrected by its author or an admin.

create table account_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  account_id uuid not null references accounts(id) on delete cascade,
  author_id uuid references memberships(id) on delete set null,
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index account_notes_account_idx on account_notes (account_id, created_at desc);

create trigger set_updated_at
  before update on account_notes
  for each row execute function private.set_updated_at();

alter table account_notes enable row level security;

create policy account_notes_select on account_notes
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and private.can_see_account(account_id)
  );

create policy account_notes_insert on account_notes
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and author_id = (select private.active_membership_id())
    and private.can_see_account(account_id)
  );

create policy account_notes_update on account_notes
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (author_id = (select private.active_membership_id()) or (select private.is_admin()))
  )
  with check (
    org_id = (select private.jwt_org_id())
    and (author_id = (select private.active_membership_id()) or (select private.is_admin()))
  );

create policy account_notes_delete on account_notes
  for delete to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (author_id = (select private.active_membership_id()) or (select private.is_admin()))
  );

grant select, insert, update, delete on account_notes to authenticated;
