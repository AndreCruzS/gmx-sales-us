-- Phase 1 · migration 1: extensions, private schema, shared trigger functions
-- private schema: security definer helpers + trigger functions. Not exposed via
-- PostgREST. authenticated needs USAGE so policies can call granted helpers.

create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

-- updated_at is trigger-maintained: it is the LWW version key (D61). Clients
-- never set it; a stale offline edit is rejected by filtering on it (error tray).
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
