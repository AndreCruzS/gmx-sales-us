begin;
set local search_path = public;
insert into accounts (id, org_id, name, account_type, city, state, territory_id, owner_id, lead_source, source_detail, parent_account_id)
values ('4b4c4598-441e-5942-b154-8c5329b4e582', '11111111-1111-1111-1111-111111111111', 'Builders FirstSource Heber', 'DEALER', 'Heber City', 'UT', 'b0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000001',
 'EXISTING_RELATIONSHIP', $q$From PK Control (gmxreviews.com): BFS Heber, Dave Fagg. Imported 2026-11-06.$q$, 'b884c2d0-7f27-462b-8d96-4037215d90f7')
on conflict (id) do nothing;
insert into activities (id, org_id, activity_type, primary_account_id, owner_id, occurred_at, location, purpose, what_happened, follow_up_required)
values ('f8c5ae28-2ed1-56e5-96f2-2a7acbbc5ae8', '11111111-1111-1111-1111-111111111111', 'PK_TRAINING', 'd0000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000001', ('2026-10-20 12:00')::timestamp at time zone 'America/Denver', $q$Salt Lake City, UT$q$, $q$PK Control meeting$q$, $q$Meeting from PK Control (gmxreviews.com), imported 2026-11-06. Participants: João, Bianca.$q$, true)
on conflict (id) do nothing;
insert into activities (id, org_id, activity_type, primary_account_id, owner_id, occurred_at, location, purpose, what_happened, follow_up_required)
values ('75afff55-aec7-5ff1-8050-2c0a1f2f517d', '11111111-1111-1111-1111-111111111111', 'PK_TRAINING', '4b4c4598-441e-5942-b154-8c5329b4e582', 'c0000000-0000-0000-0000-000000000001', ('2026-10-22 12:00')::timestamp at time zone 'America/Denver', $q$Heber City, UT$q$, $q$PK Control meeting$q$, $q$Meeting from PK Control (gmxreviews.com), imported 2026-11-06. Participants: Dave Fagg (BFS); João, Bianca.$q$, true)
on conflict (id) do nothing;
insert into activities (id, org_id, activity_type, primary_account_id, owner_id, occurred_at, location, purpose, what_happened, follow_up_required)
values ('f2b254a2-d769-54d2-a6c4-906e8f7a3c7c', '11111111-1111-1111-1111-111111111111', 'PK_TRAINING', 'fa97e541-5ea7-4c8f-867a-c657b3c70f3f', 'c0000000-0000-0000-0000-000000000001', ('2026-10-23 12:00')::timestamp at time zone 'America/Denver', $q$Heber City, UT$q$, $q$PK Control meeting$q$, $q$Meeting from PK Control (gmxreviews.com), imported 2026-11-06. Participants: Burton Lumber – Quent and Justin Cook / Boise Cascade – Kyle, Scott, and Colton.$q$, true)
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('1847759d-03f7-5bde-8899-322753aea430', '11111111-1111-1111-1111-111111111111', $q$Send Maximo commercial and technical materials$q$, 'c0000000-0000-0000-0000-000000000001', '2026-10-22', 'd0000000-0000-0000-0000-000000000009', 'f8c5ae28-2ed1-56e5-96f2-2a7acbbc5ae8', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 $q$DELEGATE$q$, 2, 'WORKING_ON_IT', ('2026-10-22 19:24:34')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('fa2e9878-aa02-5de1-ac93-8c8836363b09', '11111111-1111-1111-1111-111111111111', '1847759d-03f7-5bde-8899-322753aea430', 'c0000000-0000-0000-0000-000000000001', $q$Send Maximo commercial and technical literature, as agreed during the October 20 meeting in Salt Lake City, Utah.$q$, ('2026-10-22 19:24:34')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('2d63db54-3d53-5e3d-83ca-72c7b3b057d7', '11111111-1111-1111-1111-111111111111', '1847759d-03f7-5bde-8899-322753aea430', $q$Prepare the Maximo commercial materials.$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('adf452e1-d3b6-56a1-b952-4776bcb806b3', '11111111-1111-1111-1111-111111111111', '1847759d-03f7-5bde-8899-322753aea430', $q$Send the materials to Capital Lumber.$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('31aaabc1-6aae-5791-ba87-037c78a0c467', '11111111-1111-1111-1111-111111111111', '1847759d-03f7-5bde-8899-322753aea430', $q$Confirm receipt of the materials.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('db4fa17f-4218-52e5-b3d3-fab292a6f459', '11111111-1111-1111-1111-111111111111', $q$Propose 3 weeks for dealer visits$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-09', 'd0000000-0000-0000-0000-000000000009', 'f8c5ae28-2ed1-56e5-96f2-2a7acbbc5ae8', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 $q$DO_NOW$q$, 20, 'WORKING_ON_IT', ('2026-10-22 20:39:53')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('5752fc92-0093-5cac-aae0-60ff174b4f8b', '11111111-1111-1111-1111-111111111111', 'db4fa17f-4218-52e5-b3d3-fab292a6f459', 'c0000000-0000-0000-0000-000000000001', $q$Share three available weeks with Capital Lumber for a future market visit and dealer development activities. Dates are still to be confirmed.

Consider extending the visits to Idaho Falls, Eastern Idaho.$q$, ('2026-10-22 20:39:53')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('fc8c8ad7-8074-5d08-a2aa-75f354bf9d61', '11111111-1111-1111-1111-111111111111', 'db4fa17f-4218-52e5-b3d3-fab292a6f459', 'c0000000-0000-0000-0000-000000000001', $q$Nov 5, 2026 – Bianca and João will email Jason proposing the second through fourth weeks of January 2027 as possible dates for dealer visits. The email will also address the possibility of including Accoya in the VMI program. Deadline to send: Nov 9, 2026.$q$, ('2026-11-05 17:40:24')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('6c758491-7340-5a6f-9c11-f5894ca76a88', '11111111-1111-1111-1111-111111111111', 'db4fa17f-4218-52e5-b3d3-fab292a6f459', $q$Identify three available weeks for dealer visits.$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('3604dda3-e36a-5f57-b32e-d68792b8a22a', '11111111-1111-1111-1111-111111111111', 'db4fa17f-4218-52e5-b3d3-fab292a6f459', $q$Email Jason – Propose January 2027 dealer visit dates and discuss Accoya VMI (by Nov 9)$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('72b310ac-2508-5c15-8ade-47793f171783', '11111111-1111-1111-1111-111111111111', 'db4fa17f-4218-52e5-b3d3-fab292a6f459', $q$Confirm the preferred week.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('3cf04a77-e836-5cc1-bc6e-e08f1bfbce4f', '11111111-1111-1111-1111-111111111111', 'db4fa17f-4218-52e5-b3d3-fab292a6f459', $q$Coordinate the dealer visit schedule and locations.$q$, null, 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('05d32969-1090-502b-bc13-fe82baac467b', '11111111-1111-1111-1111-111111111111', $q$Evaluate Accoya - VMI or truckload sale$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-09', 'd0000000-0000-0000-0000-000000000009', 'f8c5ae28-2ed1-56e5-96f2-2a7acbbc5ae8', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 $q$PLAN$q$, 20, 'WORKING_ON_IT', ('2026-10-23 14:22:25')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('355e054a-f20d-5fd8-9c9c-b70992e364f1', '11111111-1111-1111-1111-111111111111', '05d32969-1090-502b-bc13-fe82baac467b', 'c0000000-0000-0000-0000-000000000001', $q$Evaluate two commercial options for Accoya with Capital Lumber: (1) VMI and (2) the sale of a full truckload (TL).$q$, ('2026-10-23 14:22:25')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('fd881a40-3548-5367-b083-7af586e8c08e', '11111111-1111-1111-1111-111111111111', '05d32969-1090-502b-bc13-fe82baac467b', 'c0000000-0000-0000-0000-000000000001', $q$November 5, 2026 – Bianca and João will discuss the possibility of including Accoya in Capital Lumber's VMI program in the same email to Jason regarding January dealer visits. The email is scheduled to be sent by November 9, 2026. Awaiting Jason's feedback.$q$, ('2026-11-05 18:02:29')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('290e8bf5-cb37-5101-9e79-ceb2e534be2e', '11111111-1111-1111-1111-111111111111', '05d32969-1090-502b-bc13-fe82baac467b', $q$Evaluate the VMI commercial option.$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('deb50e30-44df-5847-85cc-1b9ef2b61e77', '11111111-1111-1111-1111-111111111111', '05d32969-1090-502b-bc13-fe82baac467b', $q$Evaluate the truckload purchase option.$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('efa2f49d-d86a-5e0e-9eb0-e191db962425', '11111111-1111-1111-1111-111111111111', '05d32969-1090-502b-bc13-fe82baac467b', $q$Compare the feasibility and commercial conditions of both options.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('cfbb902b-c20a-5b59-bf8f-6e3b93a6a931', '11111111-1111-1111-1111-111111111111', '05d32969-1090-502b-bc13-fe82baac467b', $q$Define the preferred approach with Capital Lumber.$q$, null, 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('5044923d-a827-5ba2-b881-32c95fd6ac40', '11111111-1111-1111-1111-111111111111', $q$Investigate architect resistance$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-06', 'd0000000-0000-0000-0000-000000000009', 'f8c5ae28-2ed1-56e5-96f2-2a7acbbc5ae8', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 null, null, 'WORKING_ON_IT', ('2026-10-22 20:46:14')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('07ea2268-a287-54ef-a1e0-f10f7224b0b5', '11111111-1111-1111-1111-111111111111', '5044923d-a827-5ba2-b881-32c95fd6ac40', 'c0000000-0000-0000-0000-000000000001', $q$Identify the reasons architects are reluctant to specify Maximo products and develop an action plan to address these concerns during future visits.$q$, ('2026-10-22 20:46:14')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('92589171-2c72-5549-ad63-913d72ec817f', '11111111-1111-1111-1111-111111111111', '5044923d-a827-5ba2-b881-32c95fd6ac40', $q$Identify the main reasons architects are reluctant to specify Maximo products.$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('94f81720-4edb-5887-84f4-8fa8067f4661', '11111111-1111-1111-1111-111111111111', '5044923d-a827-5ba2-b881-32c95fd6ac40', $q$Gather feedback from Capital Lumber and relevant market contacts.$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('344c1e86-979a-537c-abf9-983f830ad57c', '11111111-1111-1111-1111-111111111111', '5044923d-a827-5ba2-b881-32c95fd6ac40', $q$Identify possible solutions to address the concerns.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('4de0888f-3068-58fb-8ec3-e40db1891b6c', '11111111-1111-1111-1111-111111111111', '5044923d-a827-5ba2-b881-32c95fd6ac40', $q$Define an action plan to improve architect engagement.$q$, null, 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('c315132a-be5e-581c-a1a5-ec2d88a69e8b', '11111111-1111-1111-1111-111111111111', $q$Target Accounts - BFS, Sunpro and Lansing$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-06', 'd0000000-0000-0000-0000-000000000009', 'f8c5ae28-2ed1-56e5-96f2-2a7acbbc5ae8', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 null, null, 'WORKING_ON_IT', ('2026-10-22 20:46:57')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('02faca28-2d02-514f-a192-a6edc0a85320', '11111111-1111-1111-1111-111111111111', 'c315132a-be5e-581c-a1a5-ec2d88a69e8b', 'c0000000-0000-0000-0000-000000000001', $q$BFS and Sunpro remain priority accounts. Sunpro has not gained the expected commercial traction. Jerry raised concerns about negative perceptions spreading from Lansing's Heber location to other branches.$q$, ('2026-10-22 20:46:57')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('f6487c47-5995-531a-a0f8-dd4bc8901832', '11111111-1111-1111-1111-111111111111', 'c315132a-be5e-581c-a1a5-ec2d88a69e8b', $q$Evaluate opportunities with BFS.$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('cae79b41-70bc-5af9-acc5-bf6f8f89236c', '11111111-1111-1111-1111-111111111111', 'c315132a-be5e-581c-a1a5-ec2d88a69e8b', $q$Review Sunpro's commercial performance and identify opportunities for improvement.$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('e5c3b532-e921-5695-a74c-414431705050', '11111111-1111-1111-1111-111111111111', 'c315132a-be5e-581c-a1a5-ec2d88a69e8b', $q$Investigate concerns regarding negative perceptions originating from Lansing's Heber location.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('d33cfe4b-760e-5016-a586-baeef3ae693b', '11111111-1111-1111-1111-111111111111', 'c315132a-be5e-581c-a1a5-ec2d88a69e8b', $q$Define next steps for each target account.$q$, null, 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('fb04c71c-96f8-55c6-9a41-c4da3d191f39', '11111111-1111-1111-1111-111111111111', 'c315132a-be5e-581c-a1a5-ec2d88a69e8b', $q$Follow up on the agreed actions.$q$, null, 4, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('efd14ce5-a8cd-5060-8191-bd708d45159e', '11111111-1111-1111-1111-111111111111', $q$Premium Decking Opportunities$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-06', '4b4c4598-441e-5942-b154-8c5329b4e582', '75afff55-aec7-5ff1-8050-2c0a1f2f517d', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 null, null, 'WORKING_ON_IT', ('2026-10-22 20:38:28')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('3cdd0af6-0561-5a1a-a68a-7fde338a6d32', '11111111-1111-1111-1111-111111111111', 'efd14ce5-a8cd-5060-8191-bd708d45159e', 'c0000000-0000-0000-0000-000000000001', $q$Hardwoods: Ipe and Cumaru.

Thermo Ash: Decking options.

Acacia: Include in the premium decking pricing options.

Accoya: Potential addition to the product offering.

Fire-retardant options: Explore what we can offer for projects with fire-related requirements.

Provide pricing for decking options: Ipe, Cumaru, Thermo Ash, and Acacia.$q$, ('2026-10-22 20:38:28')::timestamp at time zone 'UTC', ('2026-10-22 20:38:28')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('e3256196-743a-50e9-bcef-ebddc953bf4b', '11111111-1111-1111-1111-111111111111', 'efd14ce5-a8cd-5060-8191-bd708d45159e', $q$Prepare pricing for Ipe and Cumaru decking.$q$, now(), 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('092cf67f-dd46-5ad0-8275-6dfbc8505b0c', '11111111-1111-1111-1111-111111111111', 'efd14ce5-a8cd-5060-8191-bd708d45159e', $q$Prepare pricing for Thermo Ash decking.$q$, now(), 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('93cfd4d9-a566-5aca-ad5e-3b51ada10470', '11111111-1111-1111-1111-111111111111', 'efd14ce5-a8cd-5060-8191-bd708d45159e', $q$Include Acacia in the premium decking pricing options.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('9048062e-71d4-5980-b696-21b2fd142c57', '11111111-1111-1111-1111-111111111111', 'efd14ce5-a8cd-5060-8191-bd708d45159e', $q$Evaluate Accoya as an additional product offering.$q$, null, 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('d3a67d97-7250-50db-bc78-b7b0fc834793', '11111111-1111-1111-1111-111111111111', 'efd14ce5-a8cd-5060-8191-bd708d45159e', $q$Explore fire-retardant decking options for projects with specific fire requirements.$q$, null, 4, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('000a4d92-25fb-5d5e-93e0-155843430041', '11111111-1111-1111-1111-111111111111', $q$Verify fire requirements$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-13', '4b4c4598-441e-5942-b154-8c5329b4e582', '75afff55-aec7-5ff1-8050-2c0a1f2f517d', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 $q$PLAN$q$, 22, 'WAITING', ('2026-10-22 19:52:59')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('39b96f5e-d57a-5693-8504-06dfe18b8c67', '11111111-1111-1111-1111-111111111111', '000a4d92-25fb-5d5e-93e0-155843430041', 'c0000000-0000-0000-0000-000000000001', $q$Contact Wasatch and Summit Counties to confirm requirements and pre-approved product lists.$q$, ('2026-10-22 19:52:59')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('a72dbd9c-3110-5a95-af8f-b31467eabb2b', '11111111-1111-1111-1111-111111111111', '000a4d92-25fb-5d5e-93e0-155843430041', 'c0000000-0000-0000-0000-000000000001', $q$November 5, 2026 – Bianca requested Gabi's assistance in confirming the fire protection requirements for two Utah counties: Wasatch County and Summit County. André has already provided Gabi with both county names. Awaiting Gabi's feedback by November 13, 2026.$q$, ('2026-11-05 18:58:41')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('c8713858-62d7-5ff4-ba75-6639f2c69bb4', '11111111-1111-1111-1111-111111111111', '000a4d92-25fb-5d5e-93e0-155843430041', $q$Contact Wasatch County to confirm applicable fire requirements and pre-approved product lists.$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('6c4ee142-11ce-5fa6-966c-f8195d553a57', '11111111-1111-1111-1111-111111111111', '000a4d92-25fb-5d5e-93e0-155843430041', $q$Contact Summit County to confirm applicable fire requirements and pre-approved product lists.$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('372f9b9c-119f-5252-be9a-08d4a4e5e56d', '11111111-1111-1111-1111-111111111111', '000a4d92-25fb-5d5e-93e0-155843430041', $q$Document the confirmed requirements and approved product options.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('6f4664cb-ff6e-5d94-8902-23cab4d75f90', '11111111-1111-1111-1111-111111111111', $q$Accoya – Delta Millworks$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-06', '4b4c4598-441e-5942-b154-8c5329b4e582', '75afff55-aec7-5ff1-8050-2c0a1f2f517d', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 null, null, 'WORKING_ON_IT', ('2026-10-23 14:33:53')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('e2d42969-676c-5e9d-8a40-fa02d7c53f10', '11111111-1111-1111-1111-111111111111', '6f4664cb-ff6e-5d94-8902-23cab4d75f90', 'c0000000-0000-0000-0000-000000000001', $q$Investigate Delta Millworks' Accoya offering, including how their website makes product specification easier for architects and designers. Explore matching their exact Accoya color and offering Thermo Ayous as an alternative, giving BFS both options. Review their product positioning, sales approach, colors, profiles, samples, specification process, and overall customer experience, including a potential secret-shopper exercise.$q$, ('2026-10-23 14:33:53')::timestamp at time zone 'UTC', ('2026-10-23 14:33:53')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
-- attachments not imported for 'Accoya – Delta Millworks': Delta_Millworks_BFS_Analise_Visual.pdf
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('473eea51-6032-53f1-877d-5e0769d35e1b', '11111111-1111-1111-1111-111111111111', '6f4664cb-ff6e-5d94-8902-23cab4d75f90', $q$Review Delta Millworks' Accoya product offering, colors, and profiles.$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('5e33fbdc-2c65-5213-9b74-01b00a109e9c', '11111111-1111-1111-1111-111111111111', '6f4664cb-ff6e-5d94-8902-23cab4d75f90', $q$Evaluate how Delta Millworks' website simplifies product specification for architects and designers.$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('c6aaaa0a-9a4a-5a3c-9140-5001bb17010a', '11111111-1111-1111-1111-111111111111', '6f4664cb-ff6e-5d94-8902-23cab4d75f90', $q$Investigate matching Delta Millworks' Accoya color with Thermo Ayous as an alternative for BFS.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('7b64606c-56b6-59c6-b560-73aaed9f8b20', '11111111-1111-1111-1111-111111111111', '6f4664cb-ff6e-5d94-8902-23cab4d75f90', $q$Review Delta Millworks' product positioning, sales approach, and customer experience.$q$, null, 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('786c7a3f-ed62-5564-9031-bf98dae6d6a0', '11111111-1111-1111-1111-111111111111', '6f4664cb-ff6e-5d94-8902-23cab4d75f90', $q$Evaluate a potential secret-shopper exercise to better understand their sales and specification process.$q$, null, 4, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('94cc8306-dff6-5df6-84ea-bf6515720dce', '11111111-1111-1111-1111-111111111111', '6f4664cb-ff6e-5d94-8902-23cab4d75f90', $q$Conduct preliminary research and analysis of Delta Millworks' Accoya offering, product positioning, and opportunities for BFS. Research conducted by Andre; findings documented in the attached PDF.$q$, now(), 5, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('a7109539-2b3b-50e7-ae75-e58d4a39064d', '11111111-1111-1111-1111-111111111111', $q$Samples & Profiles$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-06', '4b4c4598-441e-5942-b154-8c5329b4e582', '75afff55-aec7-5ff1-8050-2c0a1f2f517d', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 null, null, 'WORKING_ON_IT', ('2026-10-22 19:53:46')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('57d386fe-cbac-5714-a961-0a6f8290b64e', '11111111-1111-1111-1111-111111111111', 'a7109539-2b3b-50e7-ae75-e58d4a39064d', 'c0000000-0000-0000-0000-000000000001', $q$Coordinate additional samples for Dave to present to specific customers and projects, including larger-format samples for meetings, Accoya color-match samples, Thermo Ayous alternatives, and BurnBlock samples. Review Delta Millworks' wide and narrow fluted profiles and evaluate comparable Maximo options.$q$, ('2026-10-22 19:53:46')::timestamp at time zone 'UTC', ('2026-10-22 19:53:46')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('783ec3ea-6fce-5091-9681-4966c18c726a', '11111111-1111-1111-1111-111111111111', 'a7109539-2b3b-50e7-ae75-e58d4a39064d', $q$Identify the additional samples needed for Dave's customers and projects.$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('86e36564-a4d7-5ba3-bc9f-f2df85775466', '11111111-1111-1111-1111-111111111111', 'a7109539-2b3b-50e7-ae75-e58d4a39064d', $q$Coordinate larger-format samples for customer meetings.$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('aebb7dda-aeb3-50db-9932-16bf9cba1d7f', '11111111-1111-1111-1111-111111111111', 'a7109539-2b3b-50e7-ae75-e58d4a39064d', $q$Prepare Accoya color-match samples and Thermo Ayous alternatives.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('502971b5-bf4e-5052-8a02-6677e11eb33f', '11111111-1111-1111-1111-111111111111', 'a7109539-2b3b-50e7-ae75-e58d4a39064d', $q$Coordinate BurnBlock samples.$q$, now(), 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('d3270306-bc21-57aa-8493-ce30105c5084', '11111111-1111-1111-1111-111111111111', 'a7109539-2b3b-50e7-ae75-e58d4a39064d', $q$Review Delta Millworks' wide and narrow fluted profiles and evaluate comparable Maximo options.$q$, null, 4, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('6e5ec6fa-3bc0-52bb-9b67-25d357c38099', '11111111-1111-1111-1111-111111111111', $q$Complete store display wall process$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-06', '4b4c4598-441e-5942-b154-8c5329b4e582', '75afff55-aec7-5ff1-8050-2c0a1f2f517d', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 null, null, 'WAITING', ('2026-10-22 19:54:12')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('ccfe7207-1b2a-5c26-9718-955a15c667c8', '11111111-1111-1111-1111-111111111111', '6e5ec6fa-3bc0-52bb-9b67-25d357c38099', 'c0000000-0000-0000-0000-000000000001', $q$Follow up on the display wall for Dave's store location.$q$, ('2026-10-22 19:54:12')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('f1ce99f3-490f-5b7f-8efb-3e1f3b1ee090', '11111111-1111-1111-1111-111111111111', '6e5ec6fa-3bc0-52bb-9b67-25d357c38099', $q$Request Render - Arq Team$q$, now(), 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('4401b127-9fe2-5543-b636-fe9720dd43ee', '11111111-1111-1111-1111-111111111111', '6e5ec6fa-3bc0-52bb-9b67-25d357c38099', $q$Confirm any remaining requirements to complete the display wall.$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('d585b14c-0fab-5468-81b0-9466fe63d307', '11111111-1111-1111-1111-111111111111', '6e5ec6fa-3bc0-52bb-9b67-25d357c38099', $q$Complete installation$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('47412767-0e11-5827-859b-e92fbc85344a', '11111111-1111-1111-1111-111111111111', $q$New Profile – Market Opportunity$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-06', 'fa97e541-5ea7-4c8f-867a-c657b3c70f3f', 'f2b254a2-d769-54d2-a6c4-906e8f7a3c7c', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 null, null, 'WORKING_ON_IT', ('2026-10-26 21:53:48')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('dcf9df15-225b-59a7-bce2-1b6c9e05d287', '11111111-1111-1111-1111-111111111111', '47412767-0e11-5827-859b-e92fbc85344a', 'c0000000-0000-0000-0000-000000000001', $q$Evaluate production feasibility and commercial potential for a new profile with the following specifications: Dimension: 1 x 6; Profile: Nickel Gap / Nickel Gap (NG/NG); Face A: Wire Brushed; Face B: 24-Grit. The objective is to meet local market needs.$q$, ('2026-10-26 21:53:48')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('c7e5d4cb-d349-5332-aa48-d8c876230213', '11111111-1111-1111-1111-111111111111', '47412767-0e11-5827-859b-e92fbc85344a', $q$Evaluate production feasibility for the new 1 x 6 Nickel Gap / Nickel Gap (NG/NG) profile.$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('869db870-d1d7-5585-9d8d-64ace4ebe24c', '11111111-1111-1111-1111-111111111111', '47412767-0e11-5827-859b-e92fbc85344a', $q$Confirm technical feasibility of Face A (Wire Brushed) and Face B (24-Grit).$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('b13092f2-17bb-5590-810e-3c8a666f23dd', '11111111-1111-1111-1111-111111111111', '47412767-0e11-5827-859b-e92fbc85344a', $q$Evaluate commercial demand and market potential for the proposed profile.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('7b61f68b-8767-5d7f-ab6e-02b16e6b5413', '11111111-1111-1111-1111-111111111111', '47412767-0e11-5827-859b-e92fbc85344a', $q$Confirm whether to proceed with production of the new profile.$q$, null, 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('ec5e1159-07e8-58e1-925b-c2112c7718c0', '11111111-1111-1111-1111-111111111111', $q$Local Supplier Development$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-06', 'fa97e541-5ea7-4c8f-867a-c657b3c70f3f', 'f2b254a2-d769-54d2-a6c4-906e8f7a3c7c', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 null, null, 'WORKING_ON_IT', ('2026-10-26 21:56:06')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('db7207f3-5fda-5680-9b39-fbc1b1b6f940', '11111111-1111-1111-1111-111111111111', 'ec5e1159-07e8-58e1-925b-c2112c7718c0', 'c0000000-0000-0000-0000-000000000001', $q$Boise Cascade to seek a local supplier solution to meet demand for the new 1 x 6 NG/NG profile (Wire Brushed Face A, 24-Grit Face B).$q$, ('2026-10-26 21:56:06')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('679b5518-6851-5016-9afb-3647224eac3c', '11111111-1111-1111-1111-111111111111', 'ec5e1159-07e8-58e1-925b-c2112c7718c0', $q$Follow up with Boise Cascade on identifying a local supplier for the new 1 x 6 NG/NG profile.$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('4231ae17-e0e1-5372-b3fe-bcb371e03167', '11111111-1111-1111-1111-111111111111', 'ec5e1159-07e8-58e1-925b-c2112c7718c0', $q$Evaluate the proposed supplier's ability to meet the required product specifications.$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('334f7003-a1ee-5e72-afeb-103d2bb30c0e', '11111111-1111-1111-1111-111111111111', 'ec5e1159-07e8-58e1-925b-c2112c7718c0', $q$Confirm the feasibility of supplying the new profile locally.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('f21c34b3-e222-56b4-8345-aa5cecb0ffb8', '11111111-1111-1111-1111-111111111111', 'ec5e1159-07e8-58e1-925b-c2112c7718c0', $q$Define the next steps with Boise Cascade.$q$, null, 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('af9bf038-48a9-5ed3-903d-948542886489', '11111111-1111-1111-1111-111111111111', $q$Inventory Planning$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-06', 'fa97e541-5ea7-4c8f-867a-c657b3c70f3f', 'f2b254a2-d769-54d2-a6c4-906e8f7a3c7c', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 null, null, 'WORKING_ON_IT', ('2026-10-26 21:56:41')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('6a81e3bb-ef09-5ede-b2d0-3564b7c114b8', '11111111-1111-1111-1111-111111111111', 'af9bf038-48a9-5ed3-903d-948542886489', 'c0000000-0000-0000-0000-000000000001', $q$Boise Cascade to plan appropriate inventory levels to ensure product availability and efficient supply to Burton Lumber.$q$, ('2026-10-26 21:56:41')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('a8a09f23-63d0-560e-a160-b934729f7c22', '11111111-1111-1111-1111-111111111111', 'af9bf038-48a9-5ed3-903d-948542886489', $q$Coordinate with Boise Cascade to estimate demand for Burton Lumber.$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('eab443d4-b034-5cf1-84d2-267f5b0010f0', '11111111-1111-1111-1111-111111111111', 'af9bf038-48a9-5ed3-903d-948542886489', $q$Determine appropriate inventory levels for the proposed products.$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('3b3d4b6d-9435-51e6-a662-8429f9f7f6eb', '11111111-1111-1111-1111-111111111111', 'af9bf038-48a9-5ed3-903d-948542886489', $q$Confirm product availability and replenishment requirements.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('cbb42a9c-b5b3-52fe-bc8b-ac30df4a2d6e', '11111111-1111-1111-1111-111111111111', 'af9bf038-48a9-5ed3-903d-948542886489', $q$Align the inventory and supply plan with Boise Cascade and Burton Lumber.$q$, null, 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('adbd4fcd-e01b-5174-bb10-702ca47c7d89', '11111111-1111-1111-1111-111111111111', $q$Product Knowledge (PK) – Heber$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-06', 'fa97e541-5ea7-4c8f-867a-c657b3c70f3f', 'f2b254a2-d769-54d2-a6c4-906e8f7a3c7c', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 null, null, 'WAITING', ('2026-10-26 21:57:14')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('ee664ad3-6015-58f5-bc61-8b3d3058d486', '11111111-1111-1111-1111-111111111111', 'adbd4fcd-e01b-5174-bb10-702ca47c7d89', 'c0000000-0000-0000-0000-000000000001', $q$Work with Colton to organize Product Knowledge (PK) training at Burton Lumber's Heber location. Coordinate the training date with Boise Cascade and Justin Cook. Align and approve the sales incentive program for Burton Lumber's sales team.$q$, ('2026-10-26 21:57:14')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('564e8615-1ed1-59c4-a177-005f69ef912b', '11111111-1111-1111-1111-111111111111', 'adbd4fcd-e01b-5174-bb10-702ca47c7d89', 'c0000000-0000-0000-0000-000000000001', $q$Oct 29, 2026 – João sent Justin Cook the Maximo Thermo × Burton Lumber commercial strategy and proposed 90-day sales incentive program for review and approval.

Awaiting Justin's feedback and approval. Meanwhile, the requested product samples have been sent to the factory, and the new profile is being developed.

Once approved, the next steps will focus on the Heber branch, including the new profile, sales incentives, leads, and display walls.$q$, ('2026-10-29 14:43:32')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('9be2cf2d-55e0-56d3-b1a2-b7676e3420f8', '11111111-1111-1111-1111-111111111111', 'adbd4fcd-e01b-5174-bb10-702ca47c7d89', 'c0000000-0000-0000-0000-000000000001', $q$Nov 5, 2026 – João sent a follow-up email to Justin Cook regarding the commercial strategy and proposed 90-day incentive program. No response has been received yet. Awaiting Justin's feedback and approval.$q$, ('2026-11-05 17:33:06')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('733e760c-e411-50d8-8b43-3f8b0b7be2d3', '11111111-1111-1111-1111-111111111111', 'adbd4fcd-e01b-5174-bb10-702ca47c7d89', $q$Obtain Justin Cook's approval of the proposed 90-day sales incentive program$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('5c2d4bbf-d845-5d6c-b2a5-4e4ab9c77d5d', '11111111-1111-1111-1111-111111111111', 'adbd4fcd-e01b-5174-bb10-702ca47c7d89', $q$Finalize the new product profile and samples for Burton Lumber$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('e7ae73d7-de6c-520f-a755-8516986c04be', '11111111-1111-1111-1111-111111111111', 'adbd4fcd-e01b-5174-bb10-702ca47c7d89', $q$Coordinate the sales incentive program and product training for the Heber branch$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('927a0b11-cde0-5312-bc2b-16d30a3bfe73', '11111111-1111-1111-1111-111111111111', 'adbd4fcd-e01b-5174-bb10-702ca47c7d89', $q$Coordinate leads and display wall implementation at the Heber branch$q$, null, 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('4946b36a-78b2-5071-9e65-b4529dd20da1', '11111111-1111-1111-1111-111111111111', 'adbd4fcd-e01b-5174-bb10-702ca47c7d89', $q$Coordinate the Product Knowledge training date with Colton, Boise Cascade, and Justin Cook.$q$, null, 4, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('99dadf5e-1de9-5764-b3d9-3208512f3360', '11111111-1111-1111-1111-111111111111', $q$Sample Development$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-06', 'fa97e541-5ea7-4c8f-867a-c657b3c70f3f', 'f2b254a2-d769-54d2-a6c4-906e8f7a3c7c', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 null, null, 'WAITING', ('2026-10-26 21:57:49')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('418043a5-7c93-576a-b5c9-d6661ad4b416', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', 'c0000000-0000-0000-0000-000000000001', $q$Obtain a physical sample of the new profile for shipment to Turkey. Evaluate three alternatives:
1. Brenda: Request FedEx shipment of the sample Boise Cascade sent to the hotel but which was not received before departure.
2. Curt (Product Manager – Boise Cascade): Request a new sample directly.
3. Russin: Evaluate the possibility of developing the sample through Russin.$q$, ('2026-10-26 21:57:49')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('ee21dd21-8685-59d1-8034-8818b82a8c17', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', 'c0000000-0000-0000-0000-000000000001', $q$A Brenda ligou para o hotel hoje fim de tarde Oct/26 , e ainda nao tinham identificado o pacote que aguardavam. Temos prazo para decidir? Enviei um email para o Joao para saber sobre o prazo, aguardando.$q$, ('2026-10-26 22:00:01')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('270fc5df-1bc9-50cc-aa72-52b399f039e8', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', 'c0000000-0000-0000-0000-000000000001', $q$O hotel confirmou com a Brenda que encontraram. Ela fez um schedule para pick up com a Fedex: Tr. 792891899596.$q$, ('2026-10-26 23:52:43')::timestamp at time zone 'UTC', ('2026-10-26 23:52:43')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('82567d9d-dd89-5166-98c1-75d9e58d3077', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', 'c0000000-0000-0000-0000-000000000001', $q$Hoje a Fedex nao teve acesso ao local e nao pegou o pacote. A Brenda ligou para reajustar o pick up novamente.$q$, ('2026-10-28 21:03:36')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('92093b89-0ec6-54dc-b9cf-9cfb918a96c8', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', 'c0000000-0000-0000-0000-000000000001', $q$Pick up Fedex feito Hoje Oct/30$q$, ('2026-10-30 17:19:28')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('b7546f5f-d82a-5cb4-b648-afe45829f4e7', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', 'c0000000-0000-0000-0000-000000000001', $q$ETA Fedex Nov/04 Office Aventura$q$, ('2026-11-03 15:10:46')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('de2169b6-e55d-5c46-a40e-14510a079fe6', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', 'c0000000-0000-0000-0000-000000000001', $q$Fedex entregou o Sample em Aventura hoje Nov/04. Brenda enviara o sample p/ Turkia. Fotos adicionadas$q$, ('2026-11-04 17:36:42')::timestamp at time zone 'UTC', ('2026-11-04 17:36:42')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('84742980-de5e-5e03-b2de-23562a7ab245', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', 'c0000000-0000-0000-0000-000000000001', $q$November 5, 2026 – Bianca confirmed that the shipping address has already been provided to Brenda for the next step.$q$, ('2026-11-05 19:15:47')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('da60cfab-403b-53e5-a8ca-e71dd9eccbc1', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', 'c0000000-0000-0000-0000-000000000001', $q$Brenda Postou o Sample pela Fedex 879807174897$q$, ('2026-11-05 21:16:57')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
-- attachments not imported for 'Sample Development': Screenshot 2026-11-04 at 12.38.05 PM.png; Screenshot 2026-11-04 at 12.38.17 PM.png; Screenshot 2026-11-04 at 12.38.28 PM.png
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('d11c1b13-87ac-55a5-92b1-fd19f2c0d5fb', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', $q$Confirm the rescheduled FedEx pickup with Brenda.$q$, now(), 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('a72c3688-b801-5178-b95c-0df2ca79afcd', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', $q$Track FedEx shipment 792891899696 and confirm successful pickup.$q$, now(), 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('8f3760a2-f77a-5786-b2e5-6622e733ab9b', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', $q$Confirm delivery of the physical sample (Aventura).$q$, now(), 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('cc2b6936-76d5-52bb-b1b2-719050018053', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', $q$Arrange shipment of the sample to Turkey.$q$, now(), 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('fd202c23-8770-5002-96a6-4a9d06266ba4', '11111111-1111-1111-1111-111111111111', '99dadf5e-1de9-5764-b3d9-3208512f3360', $q$Confirm delivery of the physical sample (Turkey).$q$, null, 4, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('4299e223-02b0-5ec0-9966-7b835f5b8bf7', '11111111-1111-1111-1111-111111111111', $q$Architect Market Development$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-06', 'fa97e541-5ea7-4c8f-867a-c657b3c70f3f', 'f2b254a2-d769-54d2-a6c4-906e8f7a3c7c', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 null, null, 'WORKING_ON_IT', ('2026-10-26 22:00:51')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('4bd726fa-90e0-57b7-9899-ebdb43371f50', '11111111-1111-1111-1111-111111111111', '4299e223-02b0-5ec0-9966-7b835f5b8bf7', 'c0000000-0000-0000-0000-000000000001', $q$Deepen understanding of the local architect and specifier market. Identify opportunities to build relationships and increase specification of Maximo products, particularly in the Heber area.$q$, ('2026-10-26 22:00:51')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('67a42096-1a81-5cf3-a088-d28d7f5803d4', '11111111-1111-1111-1111-111111111111', '4299e223-02b0-5ec0-9966-7b835f5b8bf7', $q$Identify key architects and specifiers in the Heber market.$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('05aceb90-f562-5e8b-949b-586d34b3b475', '11111111-1111-1111-1111-111111111111', '4299e223-02b0-5ec0-9966-7b835f5b8bf7', $q$Evaluate opportunities to introduce Maximo products into local projects.$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('722b5abf-e665-5cec-8fb5-003c593b6dfb', '11111111-1111-1111-1111-111111111111', '4299e223-02b0-5ec0-9966-7b835f5b8bf7', $q$Develop an approach to establish relationships with architects and specifiers.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('821b9acf-734a-58b6-b5fa-839e53ccc84d', '11111111-1111-1111-1111-111111111111', '4299e223-02b0-5ec0-9966-7b835f5b8bf7', $q$Coordinate product presentations or meetings with potential specification partners.$q$, null, 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('2978ceb5-ffec-59f8-8bc5-2aec5c5abaf2', '11111111-1111-1111-1111-111111111111', '4299e223-02b0-5ec0-9966-7b835f5b8bf7', $q$Follow up on opportunities to increase Maximo product specifications.$q$, null, 4, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_actions (id, org_id, action, owner_id, due_date, account_id, activity_id, source, source_ref, entered_by, priority, priority_days, progress, created_at)
values ('b78174dd-b443-524d-965b-63c063f99289', '11111111-1111-1111-1111-111111111111', $q$Commercial Visit Planning – Burton & BFS$q$, 'c0000000-0000-0000-0000-000000000001', '2026-11-06', 'fa97e541-5ea7-4c8f-867a-c657b3c70f3f', 'f2b254a2-d769-54d2-a6c4-906e8f7a3c7c', 'MANUAL', 'pk-control-export-2026-11-06', 'c0000000-0000-0000-0000-000000000001',
 null, null, 'WORKING_ON_IT', ('2026-10-26 22:01:19')::timestamp at time zone 'UTC')
on conflict (id) do nothing;
insert into next_action_notes (id, org_id, next_action_id, author_id, body, created_at, edited_at)
values ('54b71f46-8ef2-5e78-b229-604d05b2cb56', '11111111-1111-1111-1111-111111111111', 'b78174dd-b443-524d-965b-63c063f99289', 'c0000000-0000-0000-0000-000000000001', $q$Coordinate upcoming Burton Lumber visits with Builders FirstSource (BFS) visits to optimize the commercial schedule. A separate email will be sent to coordinate these opportunities.$q$, ('2026-10-26 22:01:19')::timestamp at time zone 'UTC', null)
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('ccd18ed8-73fc-5764-86af-a45c4e761006', '11111111-1111-1111-1111-111111111111', 'b78174dd-b443-524d-965b-63c063f99289', $q$Identify upcoming commercial visit opportunities with Burton Lumber.$q$, null, 0, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('a9a8e155-7d45-5a8d-9bdf-9f1b9897e3fe', '11111111-1111-1111-1111-111111111111', 'b78174dd-b443-524d-965b-63c063f99289', $q$Coordinate potential visits with Builders FirstSource (BFS).$q$, null, 1, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('d4ffd6b9-f258-5e55-8518-614d41602d36', '11111111-1111-1111-1111-111111111111', 'b78174dd-b443-524d-965b-63c063f99289', $q$Send the follow-up email to align visit opportunities and availability.$q$, null, 2, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('3d1d84a2-b238-50b0-ba92-535d5f1d32ac', '11111111-1111-1111-1111-111111111111', 'b78174dd-b443-524d-965b-63c063f99289', $q$Confirm the visit schedule with the involved parties.$q$, null, 3, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
insert into next_action_subtasks (id, org_id, next_action_id, title, done_at, position, created_by)
values ('b716ad1f-2308-59de-b8a2-49ddb18a9c0b', '11111111-1111-1111-1111-111111111111', 'b78174dd-b443-524d-965b-63c063f99289', $q$Finalize the coordinated commercial visit plan.$q$, null, 4, 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;
select (select count(*) from activities where id in ('f8c5ae28-2ed1-56e5-96f2-2a7acbbc5ae8','75afff55-aec7-5ff1-8050-2c0a1f2f517d','f2b254a2-d769-54d2-a6c4-906e8f7a3c7c')) activities,
 (select count(*) from next_actions where source_ref = 'pk-control-export-2026-11-06') items,
 (select count(*) from next_action_notes n join next_actions a on a.id = n.next_action_id where a.source_ref = 'pk-control-export-2026-11-06') notes,
 (select count(*) from next_action_subtasks s join next_actions a on a.id = s.next_action_id where a.source_ref = 'pk-control-export-2026-11-06') subtasks,
 (select count(*) from next_actions where source_ref = 'pk-control-export-2026-11-06' and priority is not null) prioritised,
 (select count(*) from next_actions where source_ref = 'pk-control-export-2026-11-06' and progress = 'WAITING') waiting;
commit;
