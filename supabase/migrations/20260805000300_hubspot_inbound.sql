-- HubSpot sync bridge · migration 3: the inbound deal writer.
-- HubSpot is stage-authoritative (spec §2), but the stage gate (Rule 3) must
-- not erode: a stage arriving from HubSpot with no open next action gets a
-- "review" action injected in the same transaction — the gate stays satisfied
-- and the rep gets a to-do instead of a silently moved pipeline.
-- SECURITY DEFINER + service_role-only: this is the sync engine's pen, no
-- rep JWT ever reaches it. coalesce() semantics: an absent patch key keeps
-- the current value; inbound nulling of fields is deliberately unsupported.
--
-- Two review-fix notes (2026-08-05):
-- 1. The deferred stage-gate trigger fires on `update of stage, current_status`
--    — Postgres decides that by whether the column is a SET-clause TARGET, not
--    by whether its value actually changes. A single coalesce()-style UPDATE
--    that always lists both columns therefore trips the gate on every call,
--    even field-only patches (e.g. {"estimated_revenue": 50000}) against a
--    deal with no open next action. Fixed by branching into two UPDATEs: the
--    stage/current_status columns are only ever mentioned in the SET clause
--    when the patch actually carries one of those keys.
-- 2. p_org_id was never checked against the target opportunity before the
--    review-action INSERT, so a mismatched org call could inject a next_action
--    under the wrong org, pointed at another org's opportunity, and still
--    return success (the trailing UPDATE's `and o.org_id = p_org_id` silently
--    matched zero rows). Fixed with an explicit ownership lookup up front —
--    absent scoped row raises, so the sync store records it as an error row
--    instead of pretending the write happened.

create or replace function public.hubspot_apply_deal(
  p_org_id uuid,
  p_opportunity_id uuid,
  p_patch jsonb,
  p_review_action jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_stage public.opportunity_stage := (p_patch->>'stage')::public.opportunity_stage;
begin
  -- Ownership check first: no injection, no update, until the opportunity is
  -- confirmed to belong to this org.
  perform 1 from public.opportunities o
   where o.id = p_opportunity_id
     and o.org_id = p_org_id;

  if not found then
    raise exception
      'hubspot_apply_deal: opportunity % not found for org %',
      p_opportunity_id, p_org_id;
  end if;

  if v_new_stage is not null
     and v_new_stage not in ('WON', 'LOST')
     and p_review_action is not null
     and not exists (
       select 1 from public.next_actions na
       where na.opportunity_id = p_opportunity_id
         and na.completed_at is null
     )
  then
    insert into public.next_actions (
      id, org_id, action, owner_id, due_date, account_id, opportunity_id, kind
    )
    values (
      (p_review_action->>'id')::uuid,
      p_org_id,
      p_review_action->>'action',
      (p_review_action->>'owner_id')::uuid,
      (p_review_action->>'due_date')::date,
      (p_review_action->>'account_id')::uuid,
      p_opportunity_id,
      'OTHER'::public.next_action_kind
    )
    on conflict (id) do nothing;
  end if;

  -- Only mention stage/current_status in the SET clause when the patch
  -- actually carries one of those keys — the deferred gate trigger fires on
  -- column-as-SET-target, not on value change, so an always-listed coalesce()
  -- would trip the gate on every field-only sync too.
  if p_patch ? 'stage' or p_patch ? 'current_status' then
    update public.opportunities o
       set stage               = coalesce(v_new_stage, o.stage),
           current_status      = coalesce(p_patch->>'current_status', o.current_status,
                                          case when v_new_stage is not null
                                               then 'Stage set in HubSpot' end),
           current_blocker     = coalesce(p_patch->>'current_blocker', o.current_blocker),
           estimated_revenue   = coalesce((p_patch->>'estimated_revenue')::numeric, o.estimated_revenue),
           expected_close_date = coalesce((p_patch->>'expected_close_date')::date, o.expected_close_date),
           probability         = coalesce((p_patch->>'probability')::smallint, o.probability),
           name                = coalesce(p_patch->>'name', o.name)
     where o.id = p_opportunity_id
       and o.org_id = p_org_id;
  else
    update public.opportunities o
       set current_blocker     = coalesce(p_patch->>'current_blocker', o.current_blocker),
           estimated_revenue   = coalesce((p_patch->>'estimated_revenue')::numeric, o.estimated_revenue),
           expected_close_date = coalesce((p_patch->>'expected_close_date')::date, o.expected_close_date),
           probability         = coalesce((p_patch->>'probability')::smallint, o.probability),
           name                = coalesce(p_patch->>'name', o.name)
     where o.id = p_opportunity_id
       and o.org_id = p_org_id;
  end if;
end;
$$;

revoke all on function public.hubspot_apply_deal(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.hubspot_apply_deal(uuid, uuid, jsonb, jsonb) to service_role;
