-- Phase 1 tests · 04: data-model constraints — D7/D8 lead-source rules,
-- relationship guards, one champion per account (D50), org-scoped uniques,
-- objective detail (D48), manager-chain guards. Run as postgres (RLS is
-- covered by 02/03; these are pure constraint checks).
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- D8: OTHER requires source_detail.
select throws_ok(
  $$ insert into accounts (org_id, name, account_type, territory_id, owner_id, lead_source)
     values ('11111111-1111-1111-1111-111111111111', 'No Detail Co', 'DEALER',
             'b0000000-0000-0000-0000-000000000001',
             'c0000000-0000-0000-0000-000000000003', 'OTHER') $$,
  '23514', null,
  'D8: OTHER lead source without source_detail is rejected'
);

select lives_ok(
  $$ insert into accounts (org_id, name, account_type, territory_id, owner_id,
                           lead_source, source_detail)
     values ('11111111-1111-1111-1111-111111111111', 'Detail Co', 'DEALER',
             'b0000000-0000-0000-0000-000000000001',
             'c0000000-0000-0000-0000-000000000003', 'OTHER', 'Neighbor tip') $$,
  'D8: OTHER with source_detail is accepted'
);

-- D7: referral sources require the referring account.
select throws_ok(
  $$ insert into accounts (org_id, name, account_type, territory_id, owner_id, lead_source)
     values ('11111111-1111-1111-1111-111111111111', 'Referred NoRef Co', 'CONTRACTOR',
             'b0000000-0000-0000-0000-000000000002',
             'c0000000-0000-0000-0000-000000000004', 'REFERRAL_DEALER') $$,
  '23514', null,
  'D7: referral lead source without referring_account_id is rejected'
);

select lives_ok(
  $$ insert into accounts (org_id, name, account_type, territory_id, owner_id,
                           lead_source, referring_account_id)
     values ('11111111-1111-1111-1111-111111111111', 'Referred OK Co', 'CONTRACTOR',
             'b0000000-0000-0000-0000-000000000002',
             'c0000000-0000-0000-0000-000000000004', 'REFERRAL_DEALER',
             'd0000000-0000-0000-0000-000000000001') $$,
  'D7: referral with referring_account_id is accepted'
);

-- lead_source domain: unknown values rejected (until admin-promoted, Q6).
select throws_ok(
  $$ insert into accounts (org_id, name, account_type, territory_id, owner_id, lead_source)
     values ('11111111-1111-1111-1111-111111111111', 'Bogus Source Co', 'DEALER',
             'b0000000-0000-0000-0000-000000000001',
             'c0000000-0000-0000-0000-000000000003', 'CARRIER_PIGEON') $$,
  '23514', null,
  'lead_source domain rejects unknown values'
);

-- Same rules on opportunities (D6: lead source on both objects).
select throws_ok(
  $$ insert into opportunities (org_id, name, primary_account_id, territory_id,
                                owner_id, stage, current_status, lead_source)
     values ('11111111-1111-1111-1111-111111111111', 'Bad Opp',
             'd0000000-0000-0000-0000-000000000004',
             'b0000000-0000-0000-0000-000000000002',
             'c0000000-0000-0000-0000-000000000004', 'IDENTIFIED', 'x', 'OTHER') $$,
  '23514', null,
  'D8 applies to opportunities too'
);

-- Relationships: no self-reference; (a, type, b) unique per org.
select throws_ok(
  $$ insert into account_relationships (org_id, account_a_id, relationship_type, account_b_id)
     values ('11111111-1111-1111-1111-111111111111',
             'd0000000-0000-0000-0000-000000000001', 'WORKS_WITH',
             'd0000000-0000-0000-0000-000000000001') $$,
  '23514', null,
  'account relationship cannot self-reference'
);

select throws_ok(
  $$ insert into account_relationships (org_id, account_a_id, relationship_type, account_b_id)
     values ('11111111-1111-1111-1111-111111111111',
             'd0000000-0000-0000-0000-000000000004', 'REFERRED_BY',
             'd0000000-0000-0000-0000-000000000001') $$,
  '23505', null,
  'duplicate (a, type, b) relationship is rejected'
);

-- D50: one champion per account.
select throws_ok(
  $$ insert into contacts (org_id, account_id, name, is_champion)
     values ('11111111-1111-1111-1111-111111111111',
             'd0000000-0000-0000-0000-000000000001', 'Second Champion', true) $$,
  '23505', null,
  'D50: second champion on an account is rejected'
);

-- Uniques are org-scoped (D16): same name allowed across orgs, not within.
select throws_ok(
  $$ insert into accounts (org_id, name, account_type, territory_id, owner_id, lead_source)
     values ('11111111-1111-1111-1111-111111111111', 'Ganahl Anaheim', 'DEALER',
             'b0000000-0000-0000-0000-000000000002',
             'c0000000-0000-0000-0000-000000000004', 'EXISTING_RELATIONSHIP') $$,
  '23505', null,
  'duplicate account name within an org is rejected'
);

select lives_ok(
  $$ insert into accounts (org_id, name, account_type, territory_id, owner_id, lead_source)
     values ('22222222-2222-2222-2222-222222222222', 'Ganahl Anaheim', 'DEALER',
             'b0000000-0000-0000-0000-000000000003',
             'c0000000-0000-0000-0000-000000000007', 'COLD_OUTREACH') $$,
  'same account name in a different org is accepted'
);

-- D48: OTHER objective needs free-text detail.
select throws_ok(
  $$ insert into next_actions (org_id, action, owner_id, due_date, objective)
     values ('11111111-1111-1111-1111-111111111111', 'Mystery visit',
             'c0000000-0000-0000-0000-000000000003', current_date + 1, 'OTHER') $$,
  '23514', null,
  'D48: OTHER objective without objective_detail is rejected'
);

-- Manager-chain cycle guard.
select throws_ok(
  $$ update memberships set manager_id = 'c0000000-0000-0000-0000-000000000003'
     where id = 'c0000000-0000-0000-0000-000000000002' $$,
  'P0001', null,
  'manager chain cycles are rejected'
);

select * from finish();
rollback;
