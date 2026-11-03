-- PK follow-up for reps (spec 2026-11-03-pk-follow-up-for-reps-design.md).
--
-- Andre, 3 Nov: "o rep deve estar ciente do follow up do pk dele, o lance é
-- que os admin veem de todos." Until now a rep read only the next actions he
-- OWNED, so in his own PK he could not see what João or Bia had taken on, and
-- an item handed to him from someone else's PK came without its PK.
--
-- THE TABLE POLICIES DO NOT CHANGE. The rep's day (the offline working set,
-- the agenda, the routine list, the home counts) reads next_actions and
-- activities trusting RLS to mean "mine". Widening those policies would have
-- put João's PK follow-ups on TJ's routine list and Deon's PK in TJ's visit
-- history. So the wider PK reading lives only behind the board's own readers:
--
--   · pk_board_items():  next actions the reader can see as before, plus every
--                        item of a PK RUN by someone the reader can see — the
--                        rep's own PK in full, a manager's team's PKs in full.
--   · pk_board_visits(): PK visits the reader can see as before, plus a PK
--                        that holds an item OWNED by someone the reader can
--                        see — the band of an item handed to the rep from a
--                        colleague's PK. That does not open the rest of that
--                        PK's items: those need the first rule.
--
-- Notes, reads and subtasks follow the same item rule through
-- can_see_next_action(), so a rep can read and add a note on João's item and
-- keep his own read receipt there. Every write rule on next_actions and on
-- subtasks is untouched: someone else's item stays read-only for a rep.

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

-- The item rule: the table's own rule, or an item of a PK run by someone visible.
create or replace function private.can_see_next_action(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.next_actions n
    where n.id = p_id
      and n.org_id = private.jwt_org_id()
      and private.is_active_member()
      and (
        n.owner_id in (select private.visible_membership_ids())
        or private.is_admin()
        or n.activity_id in (select private.pk_ids_run_by_visible())
      )
  );
$$;

revoke all on function private.pk_ids_run_by_visible() from public;
grant execute on function private.pk_ids_run_by_visible() to authenticated;
revoke all on function private.pk_ids_with_visible_item() from public;
grant execute on function private.pk_ids_with_visible_item() to authenticated;
revoke all on function private.can_see_next_action(uuid) from public;
grant execute on function private.can_see_next_action(uuid) to authenticated;

-- ── THE BOARD'S READERS ────────────────────────────────────────────────────
-- Set-returning, so PostgREST filters, orders, pages and embeds on them like a
-- table. Embeds (the dealer account) still run under the caller's RLS.

create or replace function public.pk_board_items()
returns setof public.next_actions
language sql
stable
security definer
set search_path = ''
as $$
  select n.*
  from public.next_actions n
  where n.org_id = private.jwt_org_id()
    and private.is_active_member()
    and n.activity_id is not null
    and (
      n.owner_id in (select private.visible_membership_ids())
      or private.is_admin()
      or n.activity_id in (select private.pk_ids_run_by_visible())
    );
$$;

create or replace function public.pk_board_visits()
returns setof public.activities
language sql
stable
security definer
set search_path = ''
as $$
  select a.*
  from public.activities a
  where a.org_id = private.jwt_org_id()
    and private.is_active_member()
    and a.activity_type = 'PK_TRAINING'
    and (
      a.owner_id in (select private.visible_membership_ids())
      or private.is_admin()
      or a.id in (select private.pk_ids_with_visible_item())
    );
$$;

revoke all on function public.pk_board_items() from public, anon;
grant execute on function public.pk_board_items() to authenticated;
revoke all on function public.pk_board_visits() from public, anon;
grant execute on function public.pk_board_visits() to authenticated;

-- ── NOTES, READS, SUBTASKS FOLLOW THE ITEM RULE ────────────────────────────

drop policy next_action_notes_select on next_action_notes;
create policy next_action_notes_select on next_action_notes
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and private.can_see_next_action(next_action_id)
  );

drop policy next_action_notes_insert on next_action_notes;
create policy next_action_notes_insert on next_action_notes
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and private.can_see_next_action(next_action_id)
  );

drop policy next_action_notes_update on next_action_notes;
create policy next_action_notes_update on next_action_notes
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and author_id = (select private.active_membership_id())
    and private.can_see_next_action(next_action_id)
  )
  with check (
    org_id = (select private.jwt_org_id())
    and author_id = (select private.active_membership_id())
  );

drop policy next_action_reads_select on next_action_reads;
create policy next_action_reads_select on next_action_reads
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and private.can_see_next_action(next_action_id)
  );

drop policy next_action_reads_insert on next_action_reads;
create policy next_action_reads_insert on next_action_reads
  for insert to authenticated
  with check (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and membership_id = (select private.active_membership_id())
    and private.can_see_next_action(next_action_id)
  );

drop policy next_action_reads_update on next_action_reads;
create policy next_action_reads_update on next_action_reads
  for update to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and membership_id = (select private.active_membership_id())
  )
  with check (
    org_id = (select private.jwt_org_id())
    and membership_id = (select private.active_membership_id())
    and private.can_see_next_action(next_action_id)
  );

drop policy next_action_subtasks_select on next_action_subtasks;
create policy next_action_subtasks_select on next_action_subtasks
  for select to authenticated
  using (
    org_id = (select private.jwt_org_id())
    and (select private.is_active_member())
    and private.can_see_next_action(next_action_id)
  );
