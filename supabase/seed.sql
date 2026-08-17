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
   'authenticated', 'authenticated', 'bianca@gmxgroup.com', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Bianca Admin"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'joao@gmxgroup.com', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Joao Manager"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'tj@gmxgroup.com', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"TJ Rep"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000004',
   'authenticated', 'authenticated', 'deon@gmxgroup.com', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Deon Rep"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000005',
   'authenticated', 'authenticated', 'eric@gmxgroup.com', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Eric Support"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000006',
   'authenticated', 'authenticated', 'alex@acme.test', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Alex AcmeAdmin"}',
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000007',
   'authenticated', 'authenticated', 'riley@acme.test', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
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
   'Ganahl Buena Park', 'DEALER', 'Buena Park', 'CA',
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
  -- Distributors. Leadership's markup of the manager view (13 Aug 2026) splits
  -- a rep's week by whose distributor business it was — Boise and Hardwoods on
  -- Deon's bar, Russin on TJ's — so the channel above the dealer has to exist
  -- in the data before the chart can say anything.
  ('d0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'Boise Cascade', 'DISTRIBUTOR', 'Anaheim', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   -- HIGH, not STRATEGIC: an account seeded today has no activity behind it,
   -- and STRATEGIC_ACCOUNT_QUIET would fire on it the moment it exists. A
   -- fixture that manufactures a false alarm teaches the wrong thing about the
   -- alarm.
   'EXISTING_RELATIONSHIP', null, null, null, false, null, 'HIGH'),
  ('d0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'Hardwoods Specialty', 'DISTRIBUTOR', 'Santa Fe Springs', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null, null, false, null, 'HIGH'),
  ('d0000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   'Russin Lumber', 'DISTRIBUTOR', 'Montgomery', 'NY',
   'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003',
   'EXISTING_RELATIONSHIP', null, null, null, false, null, 'HIGH'),
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
   'c0000000-0000-0000-0000-000000000007'),
  -- Who supplies which branch. Stated as "A SUPPLIES B", the direction
  -- dashboard_plan_by_channel reads to put a visit under a distributor.
  -- Anaheim and Orange run through different houses on purpose: that is the
  -- case the banner lens cannot see and the distributor lens can.
  ('d3000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000005', 'SUPPLIES',
   'd0000000-0000-0000-0000-000000000001', 'STRONG',
   'c0000000-0000-0000-0000-000000000004'),
  ('d3000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000006', 'SUPPLIES',
   'd0000000-0000-0000-0000-000000000002', 'MODERATE',
   'c0000000-0000-0000-0000-000000000004'),
  ('d3000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'd0000000-0000-0000-0000-000000000007', 'SUPPLIES',
   'd0000000-0000-0000-0000-000000000003', 'STRONG',
   'c0000000-0000-0000-0000-000000000003');

-- Rollout gates (Bianca's CA tracker) -----------------------------------------
--
-- Three states, as her sheet records them: ok / pending / no. The display wall
-- is NOT here — it derives from accounts.has_display_wall and its verification
-- date, so one question never gets two answers.
--
-- Buffalo is the shape worth seeding: material in stock and no merchandiser
-- behind it. The real tracker has four Dixie Line branches exactly like that,
-- and it is the finding a funnel would hide.
insert into account_rollout (account_id, org_id, pk_state, merchandiser_state,
                             material_state, product) values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'OK', 'OK', 'OK', 'Ayous Flutted/Ayous Vjoint'),
  ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'OK', 'PENDING', 'PENDING', 'Ayous Vjoint'),
  ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'OK', 'NO', 'OK', 'Thermo-Ash Decking'),
  ('d0000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'PENDING', 'NO', 'NO', null);

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

-- Quantities are in LINEAR FEET, the unit the trade actually quotes in and the
-- one leadership's markup asks the dealer breakdown to be shown in. The columns
-- were always here (estimated_quantity + quantity_unit); nothing had been
-- putting a number in them.
insert into opportunities (id, org_id, name, project_id, primary_account_id,
                           territory_id, owner_id, product, stage, current_status,
                           lead_source, dealer_id, estimated_revenue,
                           estimated_quantity, quantity_unit) values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Tower — Thermo-Ayous Cladding', 'e0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000004',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'Thermo-Ayous', 'IDENTIFIED', 'Sample requested at jobsite walk',
   'JOBSITE', 'd0000000-0000-0000-0000-000000000001', 180000.00, 24000, 'LF'),
  -- Won, so Ganahl Anaheim has volume behind it rather than only promises.
  ('f0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Anaheim counter — Thermo-Ash decking', null,
   'd0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'Thermo-Ash Decking', 'WON', 'Stocked and reordering',
   'EXISTING_RELATIONSHIP', 'd0000000-0000-0000-0000-000000000001', 96000.00,
   30000, 'LF'),
  ('f0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Orange yard — Thermo-Ash decking', null,
   'd0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'Thermo-Ash Decking', 'QUOTE', 'Priced, waiting on the buyer',
   'EXISTING_RELATIONSHIP', 'd0000000-0000-0000-0000-000000000002', 64000.00,
   20000, 'LF'),
  ('f0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'Buffalo counter — Thermo-Ayous', null,
   'd0000000-0000-0000-0000-000000000003',
   'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003',
   'Thermo-Ayous', 'WON', 'First order landed after the PK class',
   'PK_CLASS', 'd0000000-0000-0000-0000-000000000003', 38000.00, 12000, 'LF'),
  -- A DISTRIBUTOR customer. GMX sells to the house as well as to the door, and
  -- a screen that bands sales "by customer" has to be able to show both.
  ('f0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'Boise programme — Thermo-Ayous', null,
   'd0000000-0000-0000-0000-000000000005',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'Thermo-Ayous', 'WON', 'Stocking programme running',
   'EXISTING_RELATIONSHIP', null, 118000.00, 36000, 'LF'),
  ('f0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'Plaza Decking', 'e0000000-0000-0000-0000-000000000002',
   'd2000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000007',
   'Thermo-Ash Decking', 'IDENTIFIED', 'Intro meeting done',
   'COLD_OUTREACH', 'd2000000-0000-0000-0000-000000000001', 45000.00, 15000, 'LF');

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
   'f0000000-0000-0000-0000-000000000002', 'COLLECT_QUOTE'),
  -- A week with a shape to it, so the manager view has something to divide.
  -- Dated off date_trunc so they stay inside one week whenever the seed runs,
  -- rather than drifting across the Monday boundary on a Friday reset.
  -- Deon runs two banners through two different houses; TJ runs one.
  ('f1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Counter refresh — Thermo-Ash facings',
   'c0000000-0000-0000-0000-000000000004',
   date_trunc('week', current_date)::date, 'd0000000-0000-0000-0000-000000000002',
   null, 'MERCHANDISING_CHECK'),
  ('f1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Walk the yard with the buyer', 'c0000000-0000-0000-0000-000000000004',
   date_trunc('week', current_date)::date + 3, 'd0000000-0000-0000-0000-000000000002',
   null, 'RELATIONSHIP_MAINTENANCE'),
  ('f1000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'Restock sample box', 'c0000000-0000-0000-0000-000000000004',
   date_trunc('week', current_date)::date + 2, 'd0000000-0000-0000-0000-000000000001',
   null, 'MERCHANDISING_CHECK'),
  ('f1000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'Follow up the PK leads', 'c0000000-0000-0000-0000-000000000003',
   date_trunc('week', current_date)::date + 1, 'd0000000-0000-0000-0000-000000000003',
   null, 'FOLLOW_UP_LEAD'),
  ('f1000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   'Stocking conversation with the owner',
   'c0000000-0000-0000-0000-000000000003',
   date_trunc('week', current_date)::date + 4, 'd0000000-0000-0000-0000-000000000003',
   null, 'CONVERT_STOCKING_DEALER'),
  -- The stage gate: a deal that is not WON or LOST must have an open next
  -- action against it, so the Orange quote carries its own chase.
  -- Deliberately dated into NEXT week, off date_trunc for the same reason as the
  -- block above: `current_date + 4` lands next week on a Friday but inside this
  -- week on a Monday, which silently changes what "this week's commitments"
  -- means depending on the day the seed happens to run.
  ('f1000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   'Chase the Orange decking quote', 'c0000000-0000-0000-0000-000000000004',
   date_trunc('week', current_date)::date + 8, 'd0000000-0000-0000-0000-000000000002',
   'f0000000-0000-0000-0000-000000000004', 'COLLECT_QUOTE');

-- A year with a shape to it -----------------------------------------------
--
-- "Month by Month, Year to date" needs months to look at. These are ordinary
-- won deals dated back across the year; the stage-event trigger stamps them at
-- insert time, so the events are then backdated to when the sale actually
-- happened — which is the date dashboard_won_monthly reads.
insert into opportunities (id, org_id, name, primary_account_id, territory_id,
                           owner_id, product, stage, current_status, lead_source,
                           dealer_id, estimated_revenue, estimated_quantity,
                           quantity_unit) values
  ('f0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   'Anaheim spring reorder', 'd0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'Thermo-Ash Decking', 'WON', 'Delivered', 'EXISTING_RELATIONSHIP',
   'd0000000-0000-0000-0000-000000000001', 58000.00, 18000, 'LF'),
  ('f0000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
   'Orange first order', 'd0000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'Thermo-Ayous', 'WON', 'Delivered', 'EXISTING_RELATIONSHIP',
   'd0000000-0000-0000-0000-000000000002', 34000.00, 11000, 'LF'),
  ('f0000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
   'Buffalo summer stock', 'd0000000-0000-0000-0000-000000000003',
   'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003',
   'Thermo-Ash Decking', 'WON', 'Delivered', 'PK_CLASS',
   'd0000000-0000-0000-0000-000000000003', 71000.00, 22000, 'LF'),
  ('f0000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111',
   'Anaheim midsummer top-up', 'd0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'Thermo-Ayous', 'WON', 'Delivered', 'EXISTING_RELATIONSHIP',
   'd0000000-0000-0000-0000-000000000001', 42000.00, 13000, 'LF');

update opportunity_stage_events
   set occurred_at = case opportunity_id
     when 'f0000000-0000-0000-0000-00000000000a' then now() - interval '4 months'
     when 'f0000000-0000-0000-0000-00000000000b' then now() - interval '3 months'
     when 'f0000000-0000-0000-0000-00000000000c' then now() - interval '2 months'
     when 'f0000000-0000-0000-0000-00000000000d' then now() - interval '1 month'
   end
 where opportunity_id in (
   'f0000000-0000-0000-0000-00000000000a',
   'f0000000-0000-0000-0000-00000000000b',
   'f0000000-0000-0000-0000-00000000000c',
   'f0000000-0000-0000-0000-00000000000d'
 );

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
   'Intro call with Casey', '{RELATIONSHIP_DEVELOPMENT}', false, null),
  -- Half of the week above kept, half still owed: the gap is the whole point
  -- of the chart, so the seed has to contain one.
  ('ac000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'DEALER_VISIT', 'd0000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000004',
   date_trunc('week', current_date) + interval '1 day', true,
   'f1000000-0000-0000-0000-000000000003', 'MERCHANDISING_CHECK',
   'Facings redone, took a decking enquiry', '{OPPORTUNITY_IDENTIFIED}',
   true, null),
  ('ac000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'DEALER_VISIT', 'd0000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000003',
   date_trunc('week', current_date) + interval '2 days', true,
   'f1000000-0000-0000-0000-000000000006', 'FOLLOW_UP_LEAD',
   'Chased both PK leads; one wants a quote', '{QUOTE_REQUESTED}', true, null),
  -- Done, but nothing written down: the stop was closed against its plan and
  -- what_happened was left empty. This is the "owes a note" segment, and the
  -- state the rep's own debrief prompt exists to clear.
  ('ac000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'DEALER_VISIT', 'd0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000004',
   date_trunc('week', current_date) + interval '3 days', true,
   'f1000000-0000-0000-0000-000000000005', 'MERCHANDISING_CHECK',
   null, '{}', false, null);

-- Closing a planned action is two writes in the app, never one: the activity
-- links back (D46) AND the commitment is stamped completed_at — home's debrief
-- and review's send both do exactly this. The seed has to record it the same
-- way, or one screen reads the visit as done while another still has it open.
update next_actions na
   set completed_at = a.occurred_at
  from activities a
 where a.planned_action_id = na.id;

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

-- ── Sell-through: the distributors' own books ────────────────────────────────
--
-- Real networks, because the shape of the real thing is the point. Sources:
--   Boise Cascade BMD    — 39 distribution centres; California at Riverside and
--                          Modesto (Modesto replaced Lathrop in Nov 2023).
--   Hardwoods (ADENTRA)  — 32 centres; California at Perris (the US West
--                          office), Stockton (which merged Livermore, Modesto
--                          and Rancho Cordova), Los Angeles, San Diego, and
--                          Windsor (Mount Storm, joined August 2026).
--   Ganahl Lumber        — fourteen SoCal yards.
--   Builders FirstSource — California yards including Los Angeles, Santa
--                          Clarita and National City.
--
-- Branches carry no territory and no owner on purpose: they are locations in
-- somebody else's network, so Boise's whole footprint costs a rep nothing.

-- The rest of Ganahl's real yards, and BFS as a second banner ----------------

insert into accounts (id, org_id, name, account_type, city, state, territory_id,
                      owner_id, lead_source, source_detail, referring_account_id,
                      parent_account_id, has_display_wall, display_last_verified_at,
                      strategic_importance) values
  ('d0000000-0000-0000-0000-000000000110', '11111111-1111-1111-1111-111111111111',
   'Ganahl Corona', 'DEALER', 'Corona', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null,
   'd0000000-0000-0000-0000-000000000000', true, now() - interval '3 months', 'HIGH'),
  ('d0000000-0000-0000-0000-000000000111', '11111111-1111-1111-1111-111111111111',
   'Ganahl Costa Mesa', 'DEALER', 'Costa Mesa', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null,
   'd0000000-0000-0000-0000-000000000000', true, now() - interval '1 month', 'STRATEGIC'),
  ('d0000000-0000-0000-0000-000000000112', '11111111-1111-1111-1111-111111111111',
   'Ganahl Laguna Beach', 'DEALER', 'Laguna Beach', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null,
   'd0000000-0000-0000-0000-000000000000', false, null, 'MEDIUM'),
  ('d0000000-0000-0000-0000-000000000113', '11111111-1111-1111-1111-111111111111',
   'Ganahl Los Alamitos', 'DEALER', 'Los Alamitos', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null,
   'd0000000-0000-0000-0000-000000000000', true, now() - interval '5 months', 'HIGH'),
  ('d0000000-0000-0000-0000-000000000114', '11111111-1111-1111-1111-111111111111',
   'Ganahl Pasadena', 'DEALER', 'Pasadena', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null,
   'd0000000-0000-0000-0000-000000000000', false, null, 'MEDIUM'),
  ('d0000000-0000-0000-0000-000000000115', '11111111-1111-1111-1111-111111111111',
   'Ganahl Lake Forest', 'DEALER', 'Lake Forest', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null,
   'd0000000-0000-0000-0000-000000000000', false, null, 'MEDIUM'),
  ('d0000000-0000-0000-0000-000000000116', '11111111-1111-1111-1111-111111111111',
   'Ganahl Escondido', 'DEALER', 'Escondido', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null,
   'd0000000-0000-0000-0000-000000000000', false, null, 'LOW'),
  -- Builders FirstSource, the second banner in Bianca's tracker.
  ('d0000000-0000-0000-0000-000000000200', '11111111-1111-1111-1111-111111111111',
   'Builders FirstSource (Banner)', 'DEALER', null, 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null, null, false, null, 'STRATEGIC'),
  ('d0000000-0000-0000-0000-000000000201', '11111111-1111-1111-1111-111111111111',
   'BFS Los Angeles', 'DEALER', 'Los Angeles', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null,
   'd0000000-0000-0000-0000-000000000200', true, now() - interval '2 months', 'STRATEGIC'),
  ('d0000000-0000-0000-0000-000000000202', '11111111-1111-1111-1111-111111111111',
   'BFS Santa Clarita', 'DEALER', 'Santa Clarita', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null,
   'd0000000-0000-0000-0000-000000000200', false, null, 'HIGH'),
  ('d0000000-0000-0000-0000-000000000203', '11111111-1111-1111-1111-111111111111',
   'BFS National City', 'DEALER', 'National City', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null,
   'd0000000-0000-0000-0000-000000000200', false, null, 'MEDIUM');

-- Their branch networks ------------------------------------------------------

insert into distributor_branches (org_id, distributor_id, name, city, state, external_code) values
  -- Boise Cascade BMD. The two Californian centres are the ones that serve
  -- these dealers; the rest are real BMD locations, here so the coverage map
  -- has a country on it rather than one state.
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Boise Cascade - Riverside',      'Riverside',      'CA', 'BC-RIV'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Boise Cascade - Modesto',        'Modesto',        'CA', 'BC-MOD'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Boise Cascade - Phoenix',        'Phoenix',        'AZ', 'BC-PHX'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Boise Cascade - Salt Lake City', 'Salt Lake City', 'UT', 'BC-SLC'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Boise Cascade - Denver',         'Denver',         'CO', 'BC-DEN'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Boise Cascade - Vancouver',      'Vancouver',      'WA', 'BC-VAN'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Boise Cascade - Spokane',        'Spokane',        'WA', 'BC-SPO'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Boise Cascade - Albuquerque',    'Albuquerque',    'NM', 'BC-ABQ'),
  -- Hardwoods / ADENTRA.
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000006', 'Hardwoods - Perris',      'Perris',      'CA', 'HW-PER'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000006', 'Hardwoods - Los Angeles', 'Los Angeles', 'CA', 'HW-LAX'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000006', 'Hardwoods - San Diego',   'San Diego',   'CA', 'HW-SAN'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000006', 'Hardwoods - Stockton',    'Stockton',    'CA', 'HW-STK'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000006', 'Hardwoods - Windsor',     'Windsor',     'CA', 'HW-WIN'),
  -- TJ's house in the northeast.
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000007', 'Russin - Montgomery', 'Montgomery', 'NY', 'RU-MON');

-- One upload per distributor per month. The newest is LAST month, because that
-- is when the file arrives — the lag is the truth, not a gap in the fixture.

insert into sell_through_uploads (org_id, distributor_id, period, uploaded_by, filename)
select
  '11111111-1111-1111-1111-111111111111',
  dd.id,
  p.period,
  'c0000000-0000-0000-0000-000000000001',
  lower(replace(a.name, ' ', '-')) || '-' || to_char(p.period, 'YYYY-MM') || '.xlsx'
from (values
  ('d0000000-0000-0000-0000-000000000005'::uuid),
  ('d0000000-0000-0000-0000-000000000006'::uuid)
) as dd(id)
join accounts a on a.id = dd.id
cross join (
  select (date_trunc('month', current_date) - (n || ' months')::interval)::date as period
  from generate_series(1, 3) as n
) as p;

-- The rows. One list of branch-to-dealer pairs, walked across the three months
-- with a per-month factor, so the book grows the way a real one does instead of
-- repeating itself. dealer_label is written the way a distributor's system
-- would write it, because that is what the matcher will have to cope with.

insert into sell_through (org_id, upload_id, branch_id, dealer_id, dealer_label,
                          period, product, quantity, unit, value)
select
  '11111111-1111-1111-1111-111111111111',
  u.id,
  b.id,
  a.id,
  pr.label,
  u.period,
  pr.product,
  round(pr.base * m.factor),
  'LF',
  round(pr.base * m.factor * pr.price, 2)
from (values
  -- Boise Riverside serves Orange County and the Inland Empire.
  ('BC-RIV', 'Ganahl Anaheim',      'GANAHL LUMBER - ANAHEIM #4471',      'Thermo-Ayous',        9800, 3.15),
  ('BC-RIV', 'Ganahl Buena Park',   'GANAHL LUMBER - BUENA PARK #4472',   'Thermo-Ayous',        4200, 3.15),
  ('BC-RIV', 'Ganahl Corona',       'GANAHL LUMBER - CORONA #4478',       'Thermo-Ash Decking',  6100, 3.40),
  ('BC-RIV', 'Ganahl Costa Mesa',   'GANAHL LUMBER - COSTA MESA #4473',   'Thermo-Ayous',        7400, 3.15),
  ('BC-RIV', 'Ganahl Los Alamitos', 'GANAHL LUMBER - LOS ALAMITOS #4479', 'Thermo-Ash Decking',  3300, 3.40),
  ('BC-RIV', 'BFS Santa Clarita',   'BUILDERS FIRSTSOURCE SANTA CLARITA', 'Thermo-Ayous',        5200, 3.15),
  -- Hardwoods Perris covers south Orange County.
  ('HW-PER', 'Ganahl Laguna Beach', 'HARDWOODS/GANAHL LAGUNA BEACH',      'Thermo-Ayous',        2600, 3.28),
  ('HW-PER', 'Ganahl Lake Forest',  'HARDWOODS/GANAHL LAKE FOREST',       'Thermo-Ash Decking',  3100, 3.55),
  ('HW-PER', 'Ganahl Corona',       'HARDWOODS/GANAHL CORONA',            'Thermo-Ayous',        1800, 3.28),
  -- Hardwoods Los Angeles covers the LA basin.
  ('HW-LAX', 'Ganahl Pasadena',     'HARDWOODS/GANAHL PASADENA',          'Thermo-Ayous',        4100, 3.28),
  ('HW-LAX', 'BFS Los Angeles',     'HARDWOODS/BFS LOS ANGELES',          'Thermo-Ash Decking', 12400, 3.55),
  -- Hardwoods San Diego reaches the county line.
  ('HW-SAN', 'Ganahl Escondido',    'HARDWOODS/GANAHL ESCONDIDO',         'Thermo-Ayous',        1500, 3.28),
  ('HW-SAN', 'BFS National City',   'HARDWOODS/BFS NATIONAL CITY',        'Thermo-Ash Decking',  2900, 3.55)
) as pr(code, dealer_name, label, product, base, price)
join distributor_branches b
  on b.external_code = pr.code
join accounts a
  on a.name = pr.dealer_name
 and a.org_id = '11111111-1111-1111-1111-111111111111'
cross join (values (1, 0.82), (2, 0.94), (3, 1.0)) as m(ord, factor)
join sell_through_uploads u
  on u.distributor_id = b.distributor_id
 and u.period = (date_trunc('month', current_date) - ((4 - m.ord) || ' months')::interval)::date;

-- A row nobody could match. Boise's file names a yard we hold no account for,
-- so the volume is kept and counted as unmatched rather than dropped — the
-- difference between "they bought nothing" and "we could not read the name".

insert into sell_through (org_id, upload_id, branch_id, dealer_id, dealer_label,
                          period, product, quantity, unit, value)
select
  '11111111-1111-1111-1111-111111111111',
  u.id,
  b.id,
  null,
  'ORCO BLOCK & HARDSCAPE - STANTON',
  u.period,
  'Thermo-Ayous',
  2400,
  'LF',
  7560.00
from distributor_branches b
join sell_through_uploads u
  on u.distributor_id = b.distributor_id
 and u.period = (date_trunc('month', current_date) - interval '1 month')::date
where b.external_code = 'BC-RIV';

-- Keep each upload honest about what it carries.

update sell_through_uploads u
   set row_count = c.n,
       unmatched_count = c.unmatched
  from (
    select upload_id,
           count(*) as n,
           count(*) filter (where dealer_id is null) as unmatched
    from sell_through
    group by upload_id
  ) c
 where c.upload_id = u.id;

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
