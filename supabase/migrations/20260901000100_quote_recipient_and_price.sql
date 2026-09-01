-- The quote grows a RECIPIENT and a PRICE (Andre, 2026-09-01).
--
-- A quote is for a PERSON, not a building: opportunities carry the contact it
-- was made for. The survey's lines carry the counter's own price per linear
-- foot — given by the operator at quote time, never fetched (pricing lives in
-- Spruce; this is the rep's estimate) — and the deal's estimated value is the
-- sum of lf × price across the lines.
--
-- lead_source loosens to nullable: the quote flow no longer asks where the
-- deal came from — when the HubSpot bridge creates the deal over there, its
-- own defaults answer for it. The non-quote form still requires one; the
-- check moved from the column to the capture schema, where the two flows can
-- differ.

alter table public.opportunities
  add column contact_id uuid references public.contacts(id) on delete set null;

alter table public.opportunities
  alter column lead_source drop not null;

alter table public.quote_items
  add column price_per_lf numeric
  check (price_per_lf is null or price_per_lf >= 0);

-- The create RPC names its columns, so the new one must be named too.
create or replace function public.create_opportunity_with_action(
  p_opportunity jsonb,
  p_next_action jsonb
)
returns void
language plpgsql
set search_path to ''
as $function$
begin
  insert into public.opportunities (
    id, org_id, name, primary_account_id, territory_id, owner_id,
    stage, current_status, current_blocker,
    estimated_revenue, probability, expected_close_date,
    product, competitor,
    lead_source, source_detail, referring_account_id, project_id,
    contact_id
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
    (p_opportunity->>'project_id')::uuid,
    (p_opportunity->>'contact_id')::uuid
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
$function$;
