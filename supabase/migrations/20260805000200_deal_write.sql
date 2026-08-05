-- HubSpot sync bridge · migration 2: the rep deal-create path.
-- The generic outbox replays one op per statement, but the stage gate demands
-- opportunity + open next_action in the SAME transaction — so the create
-- travels as one RPC. SECURITY INVOKER: the rep's own RLS insert policies
-- re-check at replay (D62). on conflict do nothing = D57 idempotent replay.

create or replace function public.create_opportunity_with_action(
  p_opportunity jsonb,
  p_next_action jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.opportunities (
    id, org_id, name, primary_account_id, territory_id, owner_id,
    stage, current_status, current_blocker,
    estimated_revenue, probability, expected_close_date,
    product, competitor,
    lead_source, source_detail, referring_account_id, project_id
  )
  values (
    (p_opportunity->>'id')::uuid,
    (p_opportunity->>'org_id')::uuid,
    p_opportunity->>'name',
    (p_opportunity->>'primary_account_id')::uuid,
    (p_opportunity->>'territory_id')::uuid,
    (p_opportunity->>'owner_id')::uuid,
    coalesce((p_opportunity->>'stage')::public.opportunity_stage, 'IDENTIFIED'),
    p_opportunity->>'current_status',
    p_opportunity->>'current_blocker',
    (p_opportunity->>'estimated_revenue')::numeric,
    (p_opportunity->>'probability')::smallint,
    (p_opportunity->>'expected_close_date')::date,
    p_opportunity->>'product',
    p_opportunity->>'competitor',
    (p_opportunity->>'lead_source')::public.lead_source_value,
    p_opportunity->>'source_detail',
    (p_opportunity->>'referring_account_id')::uuid,
    (p_opportunity->>'project_id')::uuid
  )
  on conflict (id) do nothing;

  insert into public.next_actions (
    id, org_id, action, owner_id, due_date,
    account_id, opportunity_id, objective, objective_detail, kind
  )
  values (
    (p_next_action->>'id')::uuid,
    (p_next_action->>'org_id')::uuid,
    p_next_action->>'action',
    (p_next_action->>'owner_id')::uuid,
    (p_next_action->>'due_date')::date,
    (p_next_action->>'account_id')::uuid,
    (p_next_action->>'opportunity_id')::uuid,
    (p_next_action->>'objective')::public.visit_objective,
    p_next_action->>'objective_detail',
    (p_next_action->>'kind')::public.next_action_kind
  )
  on conflict (id) do nothing;
end;
$$;

grant execute on function public.create_opportunity_with_action(jsonb, jsonb) to authenticated;
