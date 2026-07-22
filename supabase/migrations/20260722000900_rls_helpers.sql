-- Phase 1 · migration 9: RLS helper functions (spec §4, D18/D23/D24/D53).
--
-- All helpers are SECURITY DEFINER with a pinned empty search_path, live in the
-- non-exposed `private` schema, and are granted to `authenticated` only where a
-- policy needs to call them. Every helper that answers "who am I" derives from
-- BOTH the JWT org claim and a live active membership row — never the claim
-- alone (D24).

-- The active org travels as a custom JWT claim (D18/D23).
create or replace function private.jwt_org_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'org_id', '')::uuid;
$$;

-- The caller's active membership in the claimed org — the org gate (D24).
create or replace function private.active_membership_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.org_id = private.jwt_org_id()
    and m.status = 'active';
$$;

create or replace function private.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.active_membership_id() is not null;
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.id = private.active_membership_id()
      and m.role = 'admin'
  );
$$;

-- The visibility fan-out: manager-down, never peer-to-peer (spec §4).
--   admin   → every membership in the org
--   others  → self ∪ closure-table descendants ∪ support assignments (D53)
create or replace function private.visible_membership_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.id, m.role, m.org_id
    from public.memberships m
    where m.id = private.active_membership_id()
  )
  select m.id
  from public.memberships m, me
  where m.org_id = me.org_id
    and (
      me.role = 'admin'
      or m.id in (
        select uh.descendant_id
        from public.user_hierarchy uh, me
        where uh.ancestor_id = me.id
        union
        select sa.rep_membership_id
        from public.support_assignments sa, me
        where sa.support_membership_id = me.id
          and sa.org_id = me.org_id
      )
    );
$$;

create or replace function private.visible_territory_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.territory_id
  from public.memberships m
  where m.id in (select private.visible_membership_ids())
    and m.territory_id is not null;
$$;

-- Identities of co-members of the active org (names/avatars for pickers).
create or replace function private.visible_user_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
  from public.memberships m
  where m.org_id = private.jwt_org_id()
    and private.is_active_member();
$$;

-- Parent-visibility helpers for child/join tables. These re-implement the
-- parent rule inside SECURITY DEFINER instead of relying on recursive RLS
-- evaluation of the parent table (correct + no recursion + one indexed lookup).

create or replace function private.can_see_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.accounts a
    where a.id = p_account_id
      and a.org_id = private.jwt_org_id()
      and (
        a.owner_id in (select private.visible_membership_ids())
        or a.territory_id in (select private.visible_territory_ids())
      )
  );
$$;

create or replace function private.can_see_activity(p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.activities a
    where a.id = p_activity_id
      and a.org_id = private.jwt_org_id()
      and a.owner_id in (select private.visible_membership_ids())
  );
$$;

create or replace function private.can_see_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.org_id = private.jwt_org_id()
      and private.is_active_member()
  );
$$;

create or replace function private.can_see_thread(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.email_threads t
    where t.id = p_thread_id
      and t.org_id = private.jwt_org_id()
      and t.membership_id in (select private.visible_membership_ids())
  );
$$;

-- Lock down: only what policies need is callable by clients.
revoke all on all functions in schema private from public, anon, authenticated;

grant execute on function
  -- called from check constraints, which evaluate as the inserting role
  private.is_referral_lead_source(text),
  private.jwt_org_id(),
  private.active_membership_id(),
  private.is_active_member(),
  private.is_admin(),
  private.visible_membership_ids(),
  private.visible_territory_ids(),
  private.visible_user_ids(),
  private.can_see_account(uuid),
  private.can_see_activity(uuid),
  private.can_see_project(uuid),
  private.can_see_thread(uuid)
to authenticated;
