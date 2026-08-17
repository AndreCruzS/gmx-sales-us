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

-- The client's Master Territory Map, ten regions, their names not mine. Only
-- three have a Market Owner today; the other seven read TBD on their sheet and
-- so are simply unowned here. An unowned region is a fact about the business,
-- not a hole in the fixture.
--
-- territories.region is null throughout: it was a coarser second grouping I
-- invented ("West", "Northeast") and the client's map has no such level — their
-- Region IS this name.

insert into territories (id, org_id, name) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Northeast'),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Southern California'),
  ('b0000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'Pacific Northwest'),
  ('b0000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'Northern California'),
  ('b0000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'Mountain'),
  ('b0000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'Southwest'),
  ('b0000000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'Texas'),
  ('b0000000-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'Midwest'),
  ('b0000000-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', 'South Central'),
  ('b0000000-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'Southeast'),
  -- The second org, which exists only to prove one org cannot read another's
  -- book. It keeps its own made-up geography.
  ('b0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Acme Metro');

-- Which region covers which state, straight off the map's "States Covered"
-- column. CALIFORNIA IS ABSENT ON PURPOSE: the client splits it north/south by
-- geography, and no two-letter code can tell Stockton from Riverside. Hawaii is
-- absent because their map does not mention it.

insert into territory_states (org_id, state, territory_id)
select '11111111-1111-1111-1111-111111111111', s.state, t.id
from (values
  ('WA', 'Pacific Northwest'), ('OR', 'Pacific Northwest'), ('AK', 'Pacific Northwest'),
  ('ID', 'Mountain'), ('UT', 'Mountain'), ('CO', 'Mountain'),
  ('MT', 'Mountain'), ('WY', 'Mountain'),
  ('AZ', 'Southwest'), ('NV', 'Southwest'), ('NM', 'Southwest'),
  ('TX', 'Texas'),
  ('ND', 'Midwest'), ('SD', 'Midwest'), ('NE', 'Midwest'), ('KS', 'Midwest'),
  ('MN', 'Midwest'), ('IA', 'Midwest'), ('MO', 'Midwest'), ('WI', 'Midwest'),
  ('OH', 'Midwest'), ('IL', 'Midwest'), ('IN', 'Midwest'), ('MI', 'Midwest'),
  ('OK', 'South Central'), ('AR', 'South Central'), ('LA', 'South Central'),
  ('FL', 'Southeast'), ('GA', 'Southeast'), ('SC', 'Southeast'), ('NC', 'Southeast'),
  ('KY', 'Southeast'), ('AL', 'Southeast'), ('MS', 'Southeast'), ('TN', 'Southeast'),
  ('ME', 'Northeast'), ('NH', 'Northeast'), ('VT', 'Northeast'), ('MA', 'Northeast'),
  ('RI', 'Northeast'), ('CT', 'Northeast'), ('NY', 'Northeast'), ('NJ', 'Northeast'),
  ('PA', 'Northeast'), ('DE', 'Northeast'), ('MD', 'Northeast'), ('VA', 'Northeast'),
  ('WV', 'Northeast')
) as s(state, region)
join territories t
  on t.org_id = '11111111-1111-1111-1111-111111111111'
 and t.name = s.region;

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
   'd0000000-0000-0000-0000-000000000200', false, null, 'MEDIUM'),
  -- Californian names off Boise Cascade's real report (17 Aug 2026), held as
  -- accounts so their volume has somewhere to land. The out-of-state customers in
  -- that file — Lee Roy Jordan in Dallas, Maximus in Memphis, N A Mans in Detroit
  -- — are deliberately NOT here: they sit outside every territory GMX covers, and
  -- inventing a rep for them would hide the most useful thing the report says.
  ('d0000000-0000-0000-0000-000000000300', '11111111-1111-1111-1111-111111111111',
   'Valencia Lumber & Panel', 'DEALER', 'Valencia', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null, null, false, null, 'HIGH'),
  ('d0000000-0000-0000-0000-000000000301', '11111111-1111-1111-1111-111111111111',
   'Orange Coast Hardware', 'DEALER', 'Costa Mesa', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null, null, false, null, 'MEDIUM'),
  ('d0000000-0000-0000-0000-000000000302', '11111111-1111-1111-1111-111111111111',
   'Austin Hardwoods', 'DEALER', 'Santa Ana', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null, null, false, null, 'MEDIUM'),
  ('d0000000-0000-0000-0000-000000000303', '11111111-1111-1111-1111-111111111111',
   'DG Lumber Group', 'DEALER', 'Chatsworth', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null, null, false, null, 'LOW'),
  ('d0000000-0000-0000-0000-000000000304', '11111111-1111-1111-1111-111111111111',
   'Saroyan Lumber', 'DEALER', 'Los Angeles', 'CA',
   'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004',
   'EXISTING_RELATIONSHIP', null, null, null, false, null, 'LOW');

-- Their branch networks ------------------------------------------------------

insert into distributor_branches (org_id, distributor_id, name, city, state, external_code) values
  -- BOISE CASCADE, AS BOISE CASCADE WRITES IT. These eight are the branches that
  -- appear in the client's first real BC report (17 Aug 2026) — not a guess at
  -- their network, which is what stood here before and got Modesto, Phoenix,
  -- Denver, Vancouver, Spokane and Albuquerque wrong.
  --
  -- The names are spelled the way THEIR file spells them, and that is functional
  -- rather than cosmetic: their report carries no branch-code column, so the
  -- loader can only match on name. "Boise Cascade - Riverside" against their
  -- "Riverside Branch" matches nothing and would have the importer creating a
  -- duplicate of every yard on the first load.
  --
  -- external_code is null for the same reason: we have never been given one.
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Riverside Branch',  'Riverside',   'CA', null),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Dallas Branch',     'Dallas',      'TX', null),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Memphis Branch',    'Memphis',     'TN', null),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Salt Lake Branch',  'Salt Lake City', 'UT', null),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Detroit Branch',    'Detroit',     'MI', null),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Atlanta Branch',    'Atlanta',     'GA', null),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Houston Branch',    'Houston',     'TX', null),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000005', 'Nashville Branch',  'Nashville',   'TN', null),
  -- Hardwoods / ADENTRA.
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000006', 'Hardwoods - Perris',      'Perris',      'CA', 'HW-PER'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000006', 'Hardwoods - Los Angeles', 'Los Angeles', 'CA', 'HW-LAX'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000006', 'Hardwoods - San Diego',   'San Diego',   'CA', 'HW-SAN'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000006', 'Hardwoods - Stockton',    'Stockton',    'CA', 'HW-STK'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000006', 'Hardwoods - Windsor',     'Windsor',     'CA', 'HW-WIN'),
  -- TJ's house in the northeast.
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000007', 'Russin - Montgomery', 'Montgomery', 'NY', 'RU-MON');

-- Which region each branch sits in.
--
-- CALIFORNIA BY HAND, EVERYWHERE ELSE BY RULE — which is exactly the shape of
-- the client's own map. Riverside, Perris, Los Angeles and San Diego are
-- southern California; Stockton and Windsor are NORTHERN California, five
-- hundred miles away, and go to the other region rather than to whoever happens
-- to be nearest on the list.

update distributor_branches set territory_id = 'b0000000-0000-0000-0000-000000000002'
 where name in ('Riverside Branch', 'Hardwoods - Perris', 'Hardwoods - Los Angeles',
                'Hardwoods - San Diego');
update distributor_branches set territory_id = 'b0000000-0000-0000-0000-000000000011'
 where name in ('Hardwoods - Stockton', 'Hardwoods - Windsor');

-- Everything else places itself off its own state. Dallas and Houston land in
-- Texas, Memphis, Nashville and Atlanta in the Southeast, Salt Lake in the
-- Mountain region, Detroit in the Midwest — and none of those regions has a
-- Market Owner yet, which is the point: the volume now sits against a named
-- region nobody covers instead of against a rep who never sold it.

update distributor_branches b
   set territory_id = public.territory_for_state(b.org_id, b.state)
 where b.territory_id is null
   and b.state is not null
   and public.territory_for_state(b.org_id, b.state) is not null;

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
  ('d0000000-0000-0000-0000-000000000006'::uuid),
  -- Russin, so the Rep lens has a second rep in it. A total bar banded by rep
  -- exists to answer "who is carrying this month", and a book with one rep in it
  -- cannot demonstrate the question, let alone the answer.
  ('d0000000-0000-0000-0000-000000000007'::uuid)
) as dd(id)
join accounts a on a.id = dd.id
cross join (
  select (date_trunc('month', current_date) - (n || ' months')::interval)::date as period
  from generate_series(1, 3) as n
) as p;

-- ── Hardwoods, which reports the YARD ────────────────────────────────────────
--
-- Two houses, two granularities, and the difference is the whole reason this is
-- split into two inserts.
--
-- Hardwoods names the ship-to: "HARDWOODS/GANAHL LAGUNA BEACH". That is what
-- lets a rep be asked about one door. Boise, below, names only the banner, and
-- the client is still chasing them for location-level detail.
--
-- Hardwoods' figures are still invented — no file from them yet. Boise's are the
-- real ones.

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
  -- base is the NEWEST month; the earlier two are divided back by the dealer's
  -- own trend, so every yard moves at its own rate. A single shared factor made
  -- the screen read "up 6% on Jun" against every name at once, which is the sort
  -- of coincidence that makes a reader stop trusting the number.
  round(pr.base * power(pr.trend, m.ord - 3)),
  'LF',
  round(pr.base * power(pr.trend, m.ord - 3) * pr.price, 2)
from (values
  -- Hardwoods Perris covers south Orange County.
  ('HW-PER', 'Ganahl Laguna Beach', 'HARDWOODS/GANAHL LAGUNA BEACH',      'Thermo-Ayous',        2600, 3.28, 0.86),
  ('HW-PER', 'Ganahl Lake Forest',  'HARDWOODS/GANAHL LAKE FOREST',       'Thermo-Ash Decking',  3100, 3.55, 1.05),
  ('HW-PER', 'Ganahl Corona',       'HARDWOODS/GANAHL CORONA',            'Thermo-Ayous',        1800, 3.28, 0.72),
  -- Hardwoods Los Angeles covers the LA basin.
  ('HW-LAX', 'Ganahl Pasadena',     'HARDWOODS/GANAHL PASADENA',          'Thermo-Ayous',        4100, 3.28, 1.02),
  ('HW-LAX', 'BFS Los Angeles',     'HARDWOODS/BFS LOS ANGELES',          'Thermo-Ash Decking', 12400, 3.55, 1.31),
  -- Hardwoods San Diego reaches the county line.
  ('HW-SAN', 'Ganahl Escondido',    'HARDWOODS/GANAHL ESCONDIDO',         'Thermo-Ayous',        1500, 3.28, 0.94),
  ('HW-SAN', 'BFS National City',   'HARDWOODS/BFS NATIONAL CITY',        'Thermo-Ash Decking',  2900, 3.55, 1.12),
  -- A dealer served by BOTH houses, which is the case that would double if the
  -- chain were read wrongly. Valencia takes cladding off Boise's Riverside yard
  -- as well, so it appears under each — see 16_sell_through.
  ('HW-LAX', 'Valencia Lumber & Panel', 'HARDWOODS/VALENCIA LUMBER',        'Thermo-Ayous',        2100, 3.28, 1.07)
) as pr(code, dealer_name, label, product, base, price, trend)
join distributor_branches b
  on b.external_code = pr.code
join accounts a
  on a.name = pr.dealer_name
 and a.org_id = '11111111-1111-1111-1111-111111111111'
cross join (values (1), (2), (3)) as m(ord)
join sell_through_uploads u
  on u.distributor_id = b.distributor_id
 and u.period = (date_trunc('month', current_date) - ((4 - m.ord) || ' months')::interval)::date;

-- Buffalo, through Russin. TJ's patch is a different rep's book entirely: a
-- different house, a different yard, a different state — which is what makes the
-- Rep lens a comparison rather than a single column, and what makes the RLS test
-- in 16_sell_through mean something (TJ sees THIS and none of California).

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
  round(pr.base * power(pr.trend, m.ord - 3)),
  'LF',
  round(pr.base * power(pr.trend, m.ord - 3) * pr.price, 2)
from (values
  -- Buffalo Lumber Co is the only dealer TJ owns, so it is the only one here.
  -- Acme Dealer Central belongs to the OTHER organisation; naming it would look
  -- like a second row and load as nothing, which is worse than a short list.
  ('RU-MON', 'Buffalo Lumber Co', 'BUFFALO LUMBER CO - MAIN', 'Thermo-Ayous', 9400, 3.42, 1.18)
) as pr(code, dealer_name, label, product, base, price, trend)
join distributor_branches b
  on b.external_code = pr.code
join accounts a
  on a.name = pr.dealer_name
 and a.org_id = '11111111-1111-1111-1111-111111111111'
cross join (values (1), (2), (3)) as m(ord)
join sell_through_uploads u
  on u.distributor_id = b.distributor_id
 and u.period = (date_trunc('month', current_date) - ((4 - m.ord) || ' months')::interval)::date;

-- ── Boise Cascade: the real book ─────────────────────────────────────────────
--
-- These 27 branch-to-customer pairs and their volumes are the client's FIRST REAL
-- BC report (17 Aug 2026), aggregated out of 397 spreadsheet lines. Nothing here
-- is invented: 83,153 LF, which is BC's own 10,700 pieces-and-feet converted
-- through the length carried in each item name.
--
-- THE CUSTOMER IS THE BANNER, NOT THE YARD, because that is all BC sends.
-- "GANLUGG - GANAHL LUMBER", 18,564 LF, with no way to know which of Ganahl's
-- nine yards bought it. The fixture says so rather than inventing a split, so
-- what the screens show is what the data can actually support — and the client is
-- chasing BC for location-level detail on exactly this basis. Hardwoods, above,
-- DOES name the yard, which is why the two houses are seeded separately.
--
-- NO PRICE. BC's report has no value column at all, so value is null throughout.
-- Every dollar figure on a Boise row would be a fabrication.
--
-- WHAT IS MATCHED AND WHAT IS NOT. We hold accounts for the Californian names;
-- Dallas, Memphis, Detroit, Atlanta, Houston and Nashville sit outside any
-- territory GMX covers, so their volume lands unmatched and shows under "Nobody
-- yet". That is not a gap in the fixture — 36,700 of BC's 83,153 LF has no GMX rep
-- behind it, and a manager seeing that is the entire point of the screen.

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
  round(pr.lf * power(pr.trend, m.ord - 3)),
  'LF',
  null
from (values
  -- Riverside: Deon's patch, and the only one of the eight branches inside it.
  ('Riverside Branch', 'Ganahl Lumber (Banner)',        'GANLUGG - GANAHL LUMBER',                  'Thermo-Ayous Cladding', 18564, 1.11),
  ('Riverside Branch', 'Builders FirstSource (Banner)', 'BUIFIDE - BUILDERS FIRSTSOURCE',           'Thermo-Ayous Cladding', 11885, 1.26),
  ('Riverside Branch', 'Valencia Lumber & Panel',       'VALLUPVN - VALENCIA LUMBER & PANEL',       'Thermo-Ayous Cladding',  6607, 0.93),
  ('Riverside Branch', null,                            'LUMMEWA - LUMBERMENS MERCHANDISING',       'Thermo-Ayous Cladding',  3058, 1.04),
  ('Riverside Branch', null,                            'USLBHGB - US LBM HOLDINGS LLC',            'Thermo-Ayous Cladding',  2602, 0.88),
  ('Riverside Branch', null,                            'ORGME - ORGILL INC',                       'Thermo-Ayous S4S',        882, 1.15),
  ('Riverside Branch', null,                            'LABHOGGA - LABL HOLDINGS GROUP INC',       'Thermo-Ayous Cladding',   854, 1.00),
  ('Riverside Branch', null,                            'LOWCONW - LOWE''S COMPANIES INC',          'Thermo-Ash Decking',      772, 0.79),
  ('Riverside Branch', 'Orange Coast Hardware',         'ORACOHSA - ORANGE COAST HARDWARE',         'Thermo-Ayous Cladding',   508, 1.08),
  ('Riverside Branch', 'Austin Hardwoods',              'AUSHASA - AUSTIN HARDWOODS INC',           'Thermo-Ayous S4S',        389, 0.91),
  ('Riverside Branch', 'DG Lumber Group',               'DGLUGCH - DG LUMBER GROUP INC',            'Thermo-Ayous Cladding',   247, 1.20),
  ('Riverside Branch', 'Saroyan Lumber',                'SARLUHP - SAROYAN LUMBER COMPANY',         'Thermo-Ayous S4S',         69, 0.85),
  -- Memphis: one customer, and the second largest figure in the whole report.
  ('Memphis Branch',   null,                            'THRBUSCO - MAXIMUS BUILDING SUPPLY',       'Thermo-Ayous S4S',      14000, 1.34),
  -- Dallas: a real market with nobody of ours in it.
  ('Dallas Branch',    null,                            'LEEROJDA - LEE ROY JORDAN REDWOOD LUMBER', 'Thermo-Ayous Cladding',  9763, 1.09),
  ('Dallas Branch',    null,                            'CASJOLLO - CASSITY JONES LBR & BLDG MTLS', 'Thermo-Ayous Cladding',  3508, 0.96),
  ('Dallas Branch',    null,                            'MASHAIR - MASTER-HALCO INC',               'Thermo-Ayous Cladding',  1585, 1.18),
  ('Dallas Branch',    null,                            'BIGDLURI - BIG D LUMBER CO LLC',           'Thermo-Ayous S4S',       1468, 0.90),
  ('Dallas Branch',    null,                            'OWEADCA - OWEN-ADAMS INC',                 'Thermo-Ayous S4S',       1006, 1.05),
  ('Dallas Branch',    'Builders FirstSource (Banner)', 'BUIFIDE - BUILDERS FIRSTSOURCE',           'Thermo-Ayous Cladding',   180, 1.00),
  ('Dallas Branch',    null,                            'LBMADNW - LBM ADVANTAGE',                  'Thermo-Ayous Cladding',   110, 1.00),
  ('Salt Lake Branch', null,                            'TIMEXOG - TIMBERLINE EXTERIORS',           'Thermo-Ayous Cladding',  1973, 1.22),
  ('Salt Lake Branch', null,                            'LANBUPRI - LANSING BUILDING PRODUCTS LLC', 'Thermo-Ayous Cladding',   371, 1.00),
  ('Detroit Branch',   null,                            'NAMASTR - N A MANS & SONS INC',            'Thermo-Ayous Cladding',  1000, 1.00),
  ('Detroit Branch',   'Builders FirstSource (Banner)', 'BUIFIDE - BUILDERS FIRSTSOURCE',           'Thermo-Ayous Cladding',   504, 1.00),
  ('Atlanta Branch',   null,                            'NORSUNO - NORCROSS SUPPLY CO',             'Thermo-Ayous Cladding',   556, 1.00),
  ('Houston Branch',   null,                            'LUMMEWA - LUMBERMENS MERCHANDISING',       'Thermo-Ayous Cladding',   350, 1.00),
  ('Nashville Branch', null,                            'CHABUMCH - CUSTOM BLDG SPLY CHATTANOOGA',  'Thermo-Ayous Cladding',   344, 1.00)
) as pr(branch, dealer_name, label, product, lf, trend)
join distributor_branches b
  on b.name = pr.branch
 and b.distributor_id = 'd0000000-0000-0000-0000-000000000005'
-- LEFT, not inner: a customer we hold no account for still gets its volume
-- loaded, under the label BC gave it. An inner join here would silently drop 44%
-- of the report and call what was left the month.
left join accounts a
  on a.name = pr.dealer_name
 and a.org_id = '11111111-1111-1111-1111-111111111111'
cross join (values (1), (2), (3)) as m(ord)
join sell_through_uploads u
  on u.distributor_id = b.distributor_id
 and u.period = (date_trunc('month', current_date) - ((4 - m.ord) || ' months')::interval)::date;

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
