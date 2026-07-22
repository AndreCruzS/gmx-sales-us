-- Phase 2 · migration 14: org_id JWT claim (D18/D23) + org switch RPC.
--
-- The custom access token hook stamps the ACTIVE org onto every issued JWT.
-- RLS then verifies a live membership for that claim on every query (D24) —
-- the claim selects the org; the membership check authorizes it.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims  jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user  uuid  := (event ->> 'user_id')::uuid;
  v_org   uuid;
begin
  select u.last_active_org_id into v_org
  from public.users u
  where u.id = v_user;

  -- The remembered org must still hold an active membership (D24); otherwise
  -- fall back to the earliest active membership, or no claim at all.
  if v_org is not null and not exists (
    select 1 from public.memberships m
    where m.user_id = v_user and m.org_id = v_org and m.status = 'active'
  ) then
    v_org := null;
  end if;

  if v_org is null then
    select m.org_id into v_org
    from public.memberships m
    where m.user_id = v_user and m.status = 'active'
    order by m.joined_at
    limit 1;
  end if;

  if v_org is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(v_org::text));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Only the auth server may run the hook.
revoke execute on function public.custom_access_token_hook(jsonb)
  from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb)
  to supabase_auth_admin;

-- Org switcher (D23): validate the target membership, persist it, then the
-- client refreshes its session so the hook re-issues the claim. The caller
-- must also wipe the local cache (D60) — that is client-side responsibility.
create or replace function public.set_active_org(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.org_id = p_org_id
      and m.status = 'active'
  ) then
    raise exception 'no active membership in org %', p_org_id
      using errcode = '42501';
  end if;

  update public.users
     set last_active_org_id = p_org_id
   where id = (select auth.uid());
end;
$$;

revoke execute on function public.set_active_org(uuid) from public, anon;
grant execute on function public.set_active_org(uuid) to authenticated;
