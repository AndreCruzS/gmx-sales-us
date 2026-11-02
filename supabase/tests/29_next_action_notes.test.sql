-- PK follow-up · tests 29 (20261102130000_next_action_notes.sql).
--
-- 1. A member who can see an item adds notes; author_id is always them.
-- 2. Only the author edits; every edit keeps the old body in versions.
-- 3. Nobody deletes. A rep who cannot see the item sees none of its notes.

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

select has_table('public', 'next_action_notes', 'notes table exists');
select has_table('public', 'next_action_note_versions', 'versions table exists');

-- Fixture: an item owned by Deon (c..04). TJ (c..03) cannot see it.
insert into next_actions (id, org_id, action, owner_id, due_date) values
  ('e0000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   'Item with notes', 'c0000000-0000-0000-0000-000000000004', current_date + 3);

-- Deon adds a note and claims Bianca wrote it: the claim is ignored.
select tests.set_claims('deon@gmxgroup.com', 'gmx-us');
set local role authenticated;
insert into next_action_notes (id, org_id, next_action_id, author_id, body) values
  ('e1000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   'e0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-000000000001',
   'Called the branch');
select is(
  (select author_id from next_action_notes where id = 'e1000000-0000-0000-0000-0000000000c1'),
  'c0000000-0000-0000-0000-000000000004'::uuid, 'author_id is the signed-in member, whatever was sent');
select is(
  (select edited_at from next_action_notes where id = 'e1000000-0000-0000-0000-0000000000c1'),
  null, 'a new note is not edited');

-- Empty body is refused.
select throws_ok(
  $$ insert into next_action_notes (org_id, next_action_id, author_id, body) values
       ('11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-0000000000c1',
        'c0000000-0000-0000-0000-000000000004', '   ') $$,
  '23514', null, 'a blank body is refused');

-- Two edits by the author: two versions, edited_at set, other fields kept.
update next_action_notes set body = 'Called the branch twice'
 where id = 'e1000000-0000-0000-0000-0000000000c1';
update next_action_notes set body = 'Called the branch, they will ship Friday',
                             author_id = 'c0000000-0000-0000-0000-000000000001'
 where id = 'e1000000-0000-0000-0000-0000000000c1';
select is(
  (select body from next_action_notes where id = 'e1000000-0000-0000-0000-0000000000c1'),
  'Called the branch, they will ship Friday', 'the author edits the body');
select isnt(
  (select edited_at from next_action_notes where id = 'e1000000-0000-0000-0000-0000000000c1'),
  null, 'an edited note carries edited_at');
select is(
  (select author_id from next_action_notes where id = 'e1000000-0000-0000-0000-0000000000c1'),
  'c0000000-0000-0000-0000-000000000004'::uuid, 'an edit cannot change the author');
select is(
  (select count(*) from next_action_note_versions
    where note_id = 'e1000000-0000-0000-0000-0000000000c1'),
  2::bigint, 'two edits keep two versions');
select is(
  (select array_agg(body order by body) from next_action_note_versions
    where note_id = 'e1000000-0000-0000-0000-0000000000c1'),
  array['Called the branch', 'Called the branch twice'], 'the versions hold the replaced bodies');

-- The author cannot write versions by hand, nor delete the note.
select throws_ok(
  $$ insert into next_action_note_versions (org_id, note_id, body)
       values ('11111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-0000000000c1', 'forged') $$,
  '42501', null, 'versions cannot be written by a client');
delete from next_action_notes where id = 'e1000000-0000-0000-0000-0000000000c1';
reset role;
select is(
  (select count(*) from next_action_notes where id = 'e1000000-0000-0000-0000-0000000000c1'),
  1::bigint, 'a delete removes nothing');

-- Another member who can see the item cannot edit someone else's note.
select tests.set_claims('bianca@gmxgroup.com', 'gmx-us');
set local role authenticated;
select is(
  (select count(*) from next_action_notes where id = 'e1000000-0000-0000-0000-0000000000c1'),
  1::bigint, 'an admin reads the note');
with u as (
  update next_action_notes set body = 'rewritten'
   where id = 'e1000000-0000-0000-0000-0000000000c1' returning 1)
select is((select count(*) from u), 0::bigint, 'another member updates 0 rows');
reset role;
select is(
  (select body from next_action_notes where id = 'e1000000-0000-0000-0000-0000000000c1'),
  'Called the branch, they will ship Friday', 'the body is unchanged');

-- TJ cannot see Deon's item, so he sees none of its notes or versions, and cannot add one.
select tests.set_claims('tj@gmxgroup.com', 'gmx-us');
set local role authenticated;
select is(
  (select count(*) from next_action_notes) + (select count(*) from next_action_note_versions),
  0::bigint, 'a rep who cannot see the item reads no notes or versions');
select throws_ok(
  $$ insert into next_action_notes (org_id, next_action_id, author_id, body) values
       ('11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-0000000000c1',
        'c0000000-0000-0000-0000-000000000003', 'sneaky') $$,
  '42501', null, 'a rep who cannot see the item cannot add a note');
reset role;

select * from finish();
rollback;
