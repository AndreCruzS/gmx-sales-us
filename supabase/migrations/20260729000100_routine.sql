-- Routine list (spec 2026-07-29): chores are next_actions with a kind;
-- display checks derive from accounts. Chores surface here BEFORE they
-- become exceptions — an escalated item leaves this view (one home rule).

create type next_action_kind as enum
  ('VISIT', 'SAMPLE_FOLLOW_UP', 'QUOTE_FOLLOW_UP', 'DISPLAY_CHECK', 'OTHER');

alter table next_actions add column kind next_action_kind;

update next_actions set kind = case
  when objective is not null then 'VISIT'::next_action_kind
  when action ~* 'sample'    then 'SAMPLE_FOLLOW_UP'::next_action_kind
  when action ~* 'quote'     then 'QUOTE_FOLLOW_UP'::next_action_kind
  when action ~* 'display'   then 'DISPLAY_CHECK'::next_action_kind
  else 'OTHER'::next_action_kind
end;

-- Debrief context: "How did it go?" pre-links the visit; dispositions need
-- the account known at processing time.
alter table voice_captures
  add column account_id uuid references accounts (id),
  add column planned_action_id uuid references next_actions (id);

-- Keep classifying next_actions the same way the backfill did: app code that
-- creates a commitment typically sets kind explicitly (debrief dispositions,
-- Task 3+), but anything landing without one — manual entry, imports, the
-- test fixtures below — still gets a consistent, correct kind instead of
-- silently falling out of the routine list.
create or replace function private.infer_next_action_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is null then
    new.kind := case
      when new.objective is not null then 'VISIT'::public.next_action_kind
      when new.action ~* 'sample'    then 'SAMPLE_FOLLOW_UP'::public.next_action_kind
      when new.action ~* 'quote'     then 'QUOTE_FOLLOW_UP'::public.next_action_kind
      when new.action ~* 'display'   then 'DISPLAY_CHECK'::public.next_action_kind
      else 'OTHER'::public.next_action_kind
    end;
  end if;
  return new;
end;
$$;

create trigger infer_next_action_kind
  before insert on next_actions
  for each row execute function private.infer_next_action_kind();

-- Handoff to the exception engine: exception_overdue_follow_up (migration
-- 20260722001500) has no configurable grace window — it fires the instant
-- na.due_date < current_date. Routine mirrors that boundary exactly
-- (due_date >= current_date) so an item is a chore right up until the moment
-- it escalates, with no gap and no day of double-listing.
create view routine_items
  (kind, item_id, org_id, owner_membership_id, account_id, account_name,
   action, context_date, due_date)
  with (security_invoker = true) as
-- chores from next_actions, minus escalated ones
select
  na.kind::text,
  na.id,
  na.org_id,
  na.owner_id,
  na.account_id,
  a.name,
  na.action,
  na.created_at::date,
  na.due_date
from next_actions na
left join accounts a on a.id = na.account_id
join organizations org on org.id = na.org_id
where na.completed_at is null
  and na.kind in ('SAMPLE_FOLLOW_UP', 'QUOTE_FOLLOW_UP', 'OTHER')
  and na.due_date >= current_date
union all
-- display checks: inside the routine window, before the exception threshold
select
  'DISPLAY_CHECK'::text,
  a.id,
  a.org_id,
  a.owner_id,
  a.id,
  a.name,
  'Check the display wall'::text,
  a.display_last_verified_at::date,
  (a.display_last_verified_at
    + make_interval(months => coalesce((org.settings ->> 'display_verify_months')::int, 6)))::date
from accounts a
join organizations org on org.id = a.org_id
where a.has_display_wall
  and a.display_last_verified_at is not null
  and a.display_last_verified_at < now()
    - make_interval(months => coalesce((org.settings ->> 'display_routine_months')::int, 4))
  and a.display_last_verified_at >= now()
    - make_interval(months => coalesce((org.settings ->> 'display_verify_months')::int, 6));

grant select on routine_items to authenticated;
