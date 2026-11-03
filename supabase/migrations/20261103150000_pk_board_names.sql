-- PK follow-up for reps · the names on the board (spec 2026-11-03).
--
-- A rep now reads João's item in his PK, and the band of Deon's PK when an
-- item in it is his. Two labels still did not reach him:
--   · who owns an item or wrote a note — memberships are visible to a rep only
--     for himself, so every colleague read "Someone";
--   · the dealer of a PK he did not run — the account is Deon's, so the band
--     read "Dealer".
-- Neither table is widened. Two narrow readers instead, security definer:
--   · pk_member_names(): each active-org membership's id, name, role, status.
--     The names are already readable to every co-member (users_select via
--     visible_user_ids); only the membership → person link was missing.
--   · pk_dealer_names(ids): the dealer's name for the PKs among `ids` that the
--     caller can see under the PK rules of 20261103140000 — nothing else of
--     the account.

create or replace function public.pk_member_names()
returns table (id uuid, full_name text, role text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, u.full_name, m.role::text, m.status::text
  from public.memberships m
  join public.users u on u.id = m.user_id
  where m.org_id = private.jwt_org_id()
    and private.is_active_member();
$$;

create or replace function public.pk_dealer_names(p_activity_ids uuid[])
returns table (activity_id uuid, dealer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, ac.name
  from public.activities a
  join public.accounts ac on ac.id = a.primary_account_id
  where a.id = any (p_activity_ids)
    and a.org_id = private.jwt_org_id()
    and a.activity_type = 'PK_TRAINING'
    and private.is_active_member()
    and (
      private.is_admin()
      or a.id in (select private.pk_ids_run_by_visible())
      or a.id in (select private.pk_ids_with_visible_item())
    );
$$;

revoke all on function public.pk_member_names() from public, anon;
grant execute on function public.pk_member_names() to authenticated;
revoke all on function public.pk_dealer_names(uuid[]) from public, anon;
grant execute on function public.pk_dealer_names(uuid[]) to authenticated;
