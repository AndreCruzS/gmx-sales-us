-- PK follow-up for reps (spec 2026-11-03-pk-follow-up-for-reps-design.md).
--
-- Andre, 3 Nov: "o rep deve estar ciente do follow up do pk dele, o lance é
-- que os admin veem de todos." Until now a rep read only the next actions he
-- OWNED, so in his own PK he could not see what João or Bia had taken on, and
-- an item handed to him from someone else's PK came without its PK.
--
-- Two widenings, PK only. Nothing else a colleague does becomes visible.
--   · next_actions select: also every item of a PK RUN by someone the reader
--     can see — the rep's own PK in full, a manager's team's PKs in full.
--   · activities select:   also a PK that holds an item OWNED by someone the
--     reader can see — the band of an item handed to the rep from someone
--     else's PK. That does not open the rest of that PK's items: those still
--     need the first rule, which a colleague's PK does not meet.
--
-- Each policy reads a security definer function over the OTHER table, never
-- the other policy, so the two never evaluate one another (no recursion); the
-- functions read as their owner, outside RLS, like can_see_activity.
--
-- Writes do not change: next_actions update/insert/delete and the subtask
-- writes still require the item's OWNER to be visible (or an admin), which is
-- what makes someone else's item read-only on the board. Notes and reads
-- defer to "can see the item", so a rep may add a note to João's item and keep
-- his own read receipt on it.

-- PKs run by someone the reader can see.
create or replace function private.pk_ids_run_by_visible()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.activities a
  where a.org_id = private.jwt_org_id()
    and a.activity_type = 'PK_TRAINING'
    and a.owner_id in (select private.visible_membership_ids());
$$;

-- PKs holding an item owned by someone the reader can see.
create or replace function private.pk_ids_with_visible_item()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct n.activity_id
  from public.next_actions n
  join public.activities a on a.id = n.activity_id
  where n.org_id = private.jwt_org_id()
    and a.activity_type = 'PK_TRAINING'
    and n.owner_id in (select private.visible_membership_ids());
$$;

revoke all on function private.pk_ids_run_by_visible() from public;
grant execute on function private.pk_ids_run_by_visible() to authenticated;
revoke all on function private.pk_ids_with_visible_item() from public;
grant execute on function private.pk_ids_with_visible_item() to authenticated;

drop policy activities_select on activities;
create policy activities_select on activities
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_id in (select private.visible_membership_ids())
      or (select private.is_admin())
      or id in (select private.pk_ids_with_visible_item())
    )
  );

drop policy next_actions_select on next_actions;
create policy next_actions_select on next_actions
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and (
      owner_id in (select private.visible_membership_ids())
      or (select private.is_admin())
      or activity_id in (select private.pk_ids_run_by_visible())
    )
  );
