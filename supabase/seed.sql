-- Phase 1 seed — local dev + test fixtures. NOT for production.
--
-- Two orgs so the cross-tenant leakage suite has something to leak:
--   org1 gmx-us   : Bianca (admin), João (manager), TJ (rep, Buffalo),
--                   Deon (rep, SoCal), Eric (support → TJ)   [spec §10 archetypes]
--   org2 acme-test: Alex (admin), Riley (rep)
--
-- Wrapped in an explicit transaction: the opportunity stage gate is DEFERRED
-- and requires the opportunity + its open next_action to land together.

begin;

-- Organizations ---------------------------------------------------------------

insert into organizations (id, name, slug, workspace_domain) values
  ('11111111-1111-1111-1111-111111111111', 'GMX USA',             'gmx-us',    'gmxgroup.com'),
  ('22222222-2222-2222-2222-222222222222', 'Acme Building Products', 'acme-test', 'acme.test');

insert into org_integrations (org_id, provider, credential_ref) values
  ('11111111-1111-1111-1111-111111111111', 'openai', 'vault:gmx-us/openai'),
  ('22222222-2222-2222-2222-222222222222', 'google', 'vault:acme-test/google');

-- Auth users (mirrored into public.users by on_auth_user_created trigger) -----

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, email_change, email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'bianca@gmxgroup.com', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Bianca Admin"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'joao@gmxgroup.com', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Joao Manager"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'tj@gmxgroup.com', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"TJ Rep"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000004',
   'authenticated', 'authenticated', 'deon@gmxgroup.com', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Deon Rep"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000005',
   'authenticated', 'authenticated', 'eric@gmxgroup.com', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Eric Support"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000006',
   'authenticated', 'authenticated', 'alex@acme.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Alex AcmeAdmin"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000007',
   'authenticated', 'authenticated', 'riley@acme.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Riley AcmeRep"}',
   now(), now(), '', '', '', '');

-- Territories -----------------------------------------------------------------

insert into territories (id, org_id, name, region) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Buffalo', 'Northeast'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'SoCal',   'West'),
  ('b0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Acme Metro', 'Central');

-- Memberships (hierarchy: João manages TJ + Deon; Eric supports TJ) -----------

insert into memberships (id, org_id, user_id, role, territory_id, manager_id) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-000000000001', 'admin',   null, null),
  ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-000000000002', 'manager', null, null),
  ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-000000000003', 'rep',
   'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-000000000004', 'rep',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-000000000005', 'support', null, null),
  ('c0000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000006', 'admin',   null, null),
  ('c0000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-000000000007', 'rep',
   'b0000000-0000-0000-0000-000000000003', null);

insert into support_assignments (org_id, support_membership_id, rep_membership_id) values
  ('11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000003');

-- Accounts (branch-level, D49: two Ganahl branches under one banner) ----------

insert into accounts (id, org_id, name, account_type, city, state, territory_id,
                      owner_id, lead_source, source_detail, referring_account_id,
                      parent_account_id, has_display_wall, display_last_verified_at,
                      strategic_importance) values
  ('d0000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'Ganahl Lumber (Banner)', 'DEALER', null, 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null, null, false, null, 'STRATEGIC'),
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Ganahl Anaheim', 'DEALER', 'Anaheim', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null,
   'd0000000-0000-0000-0000-000000000000', true, now() - interval '2 months', 'STRATEGIC'),
  ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Ganahl Orange', 'DEALER', 'Orange', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null,
   'd0000000-0000-0000-0000-000000000000', false, null, 'HIGH'),
  ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Buffalo Lumber Co', 'DEALER', 'Buffalo', 'NY',
   'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003',
   'PK_CLASS', null, null, null, false, null, 'MEDIUM'),
  -- Referral-sourced contractor (D7): referred by Ganahl Anaheim
  ('d0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'ABC Construction', 'CONTRACTOR', 'Anaheim', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'REFERRAL_DEALER', null, 'd0000000-0000-0000-0000-000000000001',
   null, false, null, 'HIGH'),
  -- org2
  ('d2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Acme Dealer Central', 'DEALER', 'Springfield', 'IL',
   'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000007',
   'COLD_OUTREACH', null, null, null, false, null, 'MEDIUM'),
  ('d2000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Acme Contractor LLC', 'CONTRACTOR', 'Springfield', 'IL',
   'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000007',
   'REFERRAL_DEALER', null, 'd2000000-0000-0000-0000-000000000001',
   null, false, null, 'LOW');

-- Contacts (one champion per account, D50) ------------------------------------

insert into contacts (id, org_id, account_id, name, job_title, email, phone,
                      influence_level, is_champion) values
  ('d1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000001', 'Mike Torres', 'Store Manager',
   'mike.torres@ganahl.example', '+17145550101', 'DECISION_MAKER', true),
  ('d1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000001', 'Sam Lee', 'Counter Sales',
   'sam.lee@ganahl.example', '+17145550102', 'MEDIUM', false),
  ('d1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000004', 'Paula Ortiz', 'Project Manager',
   'paula@abcconstruction.example', '+17145550103', 'HIGH', true),
  ('d1200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'd2000000-0000-0000-0000-000000000001', 'Casey Acme', 'Owner',
   'casey@acme.test', '+12175550100', 'DECISION_MAKER', true);

-- Account relationships (the commercial network, D4/D7) -----------------------

insert into account_relationships (id, org_id, account_a_id, relationship_type,
                                   account_b_id, strength, created_by) values
  ('d3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000004', 'REFERRED_BY',
   'd0000000-0000-0000-0000-000000000001', 'STRONG',
   'c0000000-0000-0000-0000-000000000004'),
  ('d3000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000004', 'PURCHASES_FROM',
   'd0000000-0000-0000-0000-000000000001', 'MODERATE',
   'c0000000-0000-0000-0000-000000000004'),
  ('d3200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'd2000000-0000-0000-0000-000000000002', 'REFERRED_BY',
   'd2000000-0000-0000-0000-000000000001', 'WEAK',
   'c0000000-0000-0000-0000-000000000007');

-- Projects (D5: project ≠ opportunity) ----------------------------------------

insert into projects (id, org_id, name, location, project_type, status, created_by) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Anaheim Mixed-Use Tower', 'Anaheim, CA', 'Mixed-use', 'DESIGN',
   'c0000000-0000-0000-0000-000000000004'),
  ('e0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Springfield Plaza', 'Springfield, IL', 'Retail', 'PLANNING',
   'c0000000-0000-0000-0000-000000000007');

insert into project_stakeholders (org_id, project_id, account_id, stakeholder_role) values
  ('11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000004', 'CONTRACTOR'),
  ('11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000001', 'DEALER'),
  ('22222222-2222-2222-2222-222222222222', 'e0000000-0000-0000-0000-000000000002',
   'd2000000-0000-0000-0000-000000000002', 'CONTRACTOR');

-- Opportunities + their open next actions (stage gate is deferred; they must
-- land in the same transaction) ----------------------------------------------

insert into opportunities (id, org_id, name, project_id, primary_account_id,
                           territory_id, owner_id, product, stage, current_status,
                           lead_source, dealer_id, estimated_revenue) values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Tower — Thermo-Ayous Cladding', 'e0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000004',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'Thermo-Ayous', 'IDENTIFIED', 'Sample requested at jobsite walk',
   'JOBSITE', 'd0000000-0000-0000-0000-000000000001', 180000.00),
  ('f0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Plaza Decking', 'e0000000-0000-0000-0000-000000000002',
   'd2000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000007',
   'Thermo-Ash Decking', 'IDENTIFIED', 'Intro meeting done',
   'COLD_OUTREACH', 'd2000000-0000-0000-0000-000000000001', 45000.00);

insert into next_actions (id, org_id, action, owner_id, due_date, account_id,
                          opportunity_id, objective) values
  ('f1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Send Thermo-Ayous sample and follow up with Paula',
   'c0000000-0000-0000-0000-000000000004', current_date + 7,
   'd0000000-0000-0000-0000-000000000004',
   'f0000000-0000-0000-0000-000000000001', 'FOLLOW_UP_LEAD'),
  -- planned agenda item (D46/D48): Deon's merchandising check at Ganahl Anaheim
  ('f1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Store visit — verify display wall', 'c0000000-0000-0000-0000-000000000004',
   current_date, 'd0000000-0000-0000-0000-000000000001',
   null, 'MERCHANDISING_CHECK'),
  ('f1200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Send decking quote', 'c0000000-0000-0000-0000-000000000007', current_date + 3,
   'd2000000-0000-0000-0000-000000000002',
   'f0000000-0000-0000-0000-000000000002', 'COLLECT_QUOTE');

-- Activities (planned-done + unplanned, D45/D46) ------------------------------

insert into activities (id, org_id, activity_type, primary_account_id, owner_id,
                        occurred_at, was_planned, planned_action_id, objective,
                        what_happened, outcomes, follow_up_required, opportunity_id) values
  -- TJ, unplanned PK debrief note (D45 minimal capture: note + flag)
  ('ac000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'PK_TRAINING', 'd0000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000003', now() - interval '1 day', false, null,
   'PK_DELIVERY', 'PK class for 8 counter staff; two quote leads to chase',
   '{TRAINING_NEEDED,OPPORTUNITY_IDENTIFIED}', true, null),
  -- Deon, planned-done store visit against the agenda item above
  ('ac000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'DEALER_VISIT', 'd0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000004', now(), true,
   'f1000000-0000-0000-0000-000000000002', 'MERCHANDISING_CHECK',
   'Display wall verified, restocked samples', '{RELATIONSHIP_DEVELOPMENT}',
   false, null),
  ('ac200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'PHONE_CALL', 'd2000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000007', now(), false, null, null,
   'Intro call with Casey', '{RELATIONSHIP_DEVELOPMENT}', false, null);

insert into activity_accounts (org_id, activity_id, account_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'ac000000-0000-0000-0000-000000000002',
   'd0000000-0000-0000-0000-000000000001', 'PRIMARY'),
  ('11111111-1111-1111-1111-111111111111', 'ac000000-0000-0000-0000-000000000002',
   'd0000000-0000-0000-0000-000000000004', 'INVOLVED');

insert into activity_contacts (org_id, activity_id, contact_id) values
  ('11111111-1111-1111-1111-111111111111', 'ac000000-0000-0000-0000-000000000002',
   'd1000000-0000-0000-0000-000000000001');

-- Capture pipelines -----------------------------------------------------------

insert into voice_captures (id, org_id, owner_id, audio_path, status, language) values
  ('ae000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111/a0000000-0000-0000-0000-000000000003/ae000000-0000-0000-0000-000000000001.m4a',
   'PENDING', 'en'),
  ('ae200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000007',
   '22222222-2222-2222-2222-222222222222/a0000000-0000-0000-0000-000000000007/ae200000-0000-0000-0000-000000000001.m4a',
   'PENDING', 'en');

insert into contact_candidates (id, org_id, created_by, source, raw_ref, extracted) values
  ('af000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-000000000003', 'BUSINESS_CARD',
   '11111111-1111-1111-1111-111111111111/cards/af000000.jpg',
   '{"name": {"value": "Jordan Card", "confidence": 0.93}}'),
  ('af200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000007', 'MANUAL', null,
   '{"name": {"value": "Manual Entry", "confidence": 1.0}}');

-- Email (Tier 2 fixtures so leakage covers these tables) ----------------------

insert into email_threads (id, org_id, membership_id, gmail_thread_id, subject,
                           participants, matched_account_id, matched_contact_id) values
  ('ba000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-000000000003', 'thr_gmx_001',
   'Quote request — Thermo-Ayous',
   '["tj@gmxgroup.com", "mike.torres@ganahl.example"]',
   'd0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001'),
  ('ba200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000007', 'thr_acme_001', 'Decking pricing',
   '["riley@acme.test", "casey@acme.test"]',
   'd2000000-0000-0000-0000-000000000001', 'd1200000-0000-0000-0000-000000000001');

insert into email_messages (id, org_id, thread_id, gmail_message_id, from_addr,
                            to_addrs, sent_at, direction, snippet, has_attachments) values
  ('bb000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'ba000000-0000-0000-0000-000000000001', 'msg_gmx_001',
   'mike.torres@ganahl.example', '{tj@gmxgroup.com}', now() - interval '2 hours',
   'INBOUND', 'Can you quote the Ayous cladding…', true),
  ('bb200000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'ba200000-0000-0000-0000-000000000001', 'msg_acme_001',
   'casey@acme.test', '{riley@acme.test}', now() - interval '1 hour',
   'INBOUND', 'Pricing please', false);

insert into email_attachments (id, org_id, message_id, filename, mime_type,
                               size_bytes, sha256, storage_path, classification) values
  ('bc000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'bb000000-0000-0000-0000-000000000001', 'takeoff.pdf', 'application/pdf',
   204800, '5c3e1f0a9b8d7e6f5c3e1f0a9b8d7e6f5c3e1f0a9b8d7e6f5c3e1f0a9b8d7e6f',
   '11111111-1111-1111-1111-111111111111/email/5c3e1f0a9b8d7e6f5c3e1f0a9b8d7e6f5c3e1f0a9b8d7e6f5c3e1f0a9b8d7e6f',
   'QUOTE');

insert into email_sync_state (org_id, membership_id, history_id, last_synced_at) values
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000003',
   '1000001', now()),
  ('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000007',
   '2000001', now());

insert into org_email_exclusions (org_id, pattern, reason) values
  ('11111111-1111-1111-1111-111111111111', 'payroll.example.com', 'HR safety net'),
  ('22222222-2222-2222-2222-222222222222', 'benefits.acme.test', 'HR safety net');

commit;

-- Test helpers (local/CI only — seed is never applied to production) ----------

create schema if not exists tests;

-- Simulate a PostgREST-authenticated user: set the JWT claims (sub + custom
-- org_id claim, D18/D23) and switch to the authenticated role.
create or replace function tests.authenticate_as(p_email text, p_org_slug text)
returns void
language plpgsql
as $$
declare
  v_user_id uuid;
  v_org_id  uuid;
begin
  select id into strict v_user_id from public.users where email = p_email;
  select id into strict v_org_id  from public.organizations where slug = p_org_slug;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'role', 'authenticated',
    'email', p_email,
    'org_id', v_org_id
  )::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Set claims only (leakage loop switches role around each probe itself).
create or replace function tests.set_claims(p_email text, p_org_slug text)
returns void
language plpgsql
as $$
declare
  v_user_id uuid;
  v_org_id  uuid;
begin
  select id into strict v_user_id from public.users where email = p_email;
  select id into strict v_org_id  from public.organizations where slug = p_org_slug;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_user_id,
    'role', 'authenticated',
    'email', p_email,
    'org_id', v_org_id
  )::text, true);
end;
$$;

create or replace function tests.clear_auth()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;
