-- THE REP'S SECOND HANDSHAKE (Andre, 2026-09-01). Logging in proves who you
-- are; this proves the app may act as you — send the quote from YOUR Gmail,
-- write to YOUR calendar. Admins run the desk and never grant it; every rep
-- does, and the app nags until they have.
--
-- The refresh token is the durable key the SERVER uses later (quote emails,
-- calendar writes). A person may read and write their own connection and
-- nobody else's; the service role reads them all.

create table public.google_connections (
  membership_id uuid primary key references public.memberships(id) on delete cascade,
  org_id uuid not null,
  google_email text,
  scopes text[] not null default '{}',
  refresh_token text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_connections enable row level security;

create policy "own connection: read"
  on public.google_connections for select
  using (membership_id in (select id from public.memberships where user_id = (select auth.uid())));

create policy "own connection: create"
  on public.google_connections for insert
  with check (membership_id in (select id from public.memberships where user_id = (select auth.uid())));

create policy "own connection: update"
  on public.google_connections for update
  using (membership_id in (select id from public.memberships where user_id = (select auth.uid())))
  with check (membership_id in (select id from public.memberships where user_id = (select auth.uid())));

create policy "own connection: delete"
  on public.google_connections for delete
  using (membership_id in (select id from public.memberships where user_id = (select auth.uid())));
