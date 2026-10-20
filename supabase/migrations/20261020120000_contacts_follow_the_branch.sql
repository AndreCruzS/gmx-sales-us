-- A DISTRIBUTOR'S PEOPLE ARE SEEN BY THE REGION THEY SIT IN (João, meeting of
-- 13 Oct 2026: "A Laura entra como rep do Texas. Ela não vai ter contato de
-- todo mundo ... Tudo aqui dentro filtrado por região").
--
-- Contacts were seen through their ACCOUNT, and every distributor account is
-- filed under Southern California. So the SoCal reps saw Boise's Dallas and
-- Houston people, and Anthony could not see one of Russin's nine — all of whom
-- sit in Russin's Montgomery yard, in his own Northeast.
--
-- The rule now:
--   * a dealer's person      — as before, whoever can see the dealer;
--   * a person in a branch   — whoever holds the branch's region (admins: all);
--   * a house person, in no branch (Boise's product managers, Hardwoods' VP
--     West) — every active member. Head office serves every region, and it is
--     the number a rep in any region calls first.
--
-- The distributor itself and its branch network become readable to every
-- active member, because a contact's company and yard must print beside the
-- name. Only the SELECT widens; writes on accounts and branches are unchanged,
-- and so is everything else keyed on can_see_account (notes, rollout, quotes).

create or replace function private.can_see_contact(p_account_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.accounts a
      where a.id = p_account_id
        and a.org_id = private.jwt_org_id()
        and a.account_type = 'DISTRIBUTOR'
    ) then private.can_see_account(p_account_id)
    when p_branch_id is null then private.is_active_member()
    else private.is_admin() or exists (
      select 1 from public.distributor_branches b
      where b.id = p_branch_id
        and b.territory_id in (select private.visible_territory_ids())
    )
  end;
$$;

revoke all on function private.can_see_contact(uuid, uuid) from public;
grant execute on function private.can_see_contact(uuid, uuid) to authenticated;

drop policy contacts_select on contacts;
create policy contacts_select on contacts
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and private.can_see_contact(account_id, branch_id)
  );

drop policy contacts_write on contacts;
create policy contacts_write on contacts
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and private.can_see_contact(account_id, branch_id)
  );

drop policy contacts_update on contacts;
create policy contacts_update on contacts
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and private.can_see_contact(account_id, branch_id)
  )
  with check (
    org_id = (select private.jwt_org_id())
    and private.can_see_contact(account_id, branch_id)
  );

drop policy accounts_select on accounts;
create policy accounts_select on accounts
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_id in (select private.visible_membership_ids())
      or territory_id in (select private.visible_territory_ids())
      or (select private.is_admin())
      or account_type = 'DISTRIBUTOR'
    )
  );

drop policy distributor_branches_select on distributor_branches;
create policy distributor_branches_select on distributor_branches
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
  );
