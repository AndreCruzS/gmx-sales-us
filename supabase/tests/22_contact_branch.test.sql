-- Contact branch · tests 22 (20261012200000_contact_branch.sql).
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);
select has_column('public', 'contacts', 'branch_id', 'a contact may sit in a branch');
select col_is_null('public', 'contacts', 'branch_id', 'and most do not');
select * from finish();
rollback;
