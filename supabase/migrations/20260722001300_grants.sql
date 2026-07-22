-- Phase 1 · migration 13: base table privileges.
--
-- Locally-applied migrations run as postgres, whose objects do not inherit
-- Supabase's default grants — so grant explicitly. RLS (default-deny, enabled
-- on every table, verified by tests/01) remains the actual row gate:
--   - authenticated gets base DML privileges; policies decide the rows
--     (tables with no policy for an operation — email inserts, user_hierarchy,
--     org_integrations for non-admins — still deny everything).
--   - anon gets schema USAGE only: zero table privileges.
--   - service_role gets full DML for server-side jobs (bypasses RLS).

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated, service_role;
