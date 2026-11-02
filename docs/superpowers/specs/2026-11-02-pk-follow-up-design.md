# PK follow-up — design

Date: 2026-11-02 · Status: approved by Andre (mockup) · Mockup: https://claude.ai/artifact/R1KJ8Lv95dS2XygNQb6SX2
Source: the report "Relatório: plataforma GMX Group Performance Reviews" and the PK Control board at gmxreviews.com/pk (seen live 2 Nov).

## 1. Why

Bianca and João run the follow-up of every PK (product knowledge training) on a separate board, PK Control. They like what it stores and how it looks: one band per PK, two coloured statuses per action, the latest note in the row, who has read it, and an alert when the time to act has passed. This brings that board into GMX Sales, on the items the app already has, so a PK's follow-ups live next to the dealer, the visits and the sales.

Scope is the PK follow-up only (Andre, 2 Nov: "não vamos além do que precisa"). The five features apply to items born from a PK visit; the rest of the Dealers page is unchanged.

## 2. Scope

**In**
1. Eisenhower priority per item (Do now · Plan · Delegate · Eliminate) with N days; alert = PK date + N days.
2. Append-only notes log per item (author, date and time, "edited" with the earlier text kept).
3. Per-user read receipt per item.
4. Two statuses: **Action required** (whose ball it is) and **Status** (progress).
5. Excel export grouped by PK, with priority, days and alert date, plus a Subtasks sheet.
6. Subtasks as a checklist that counts in the PK's % (decided 2 Nov).
7. A one-time import of the three October PKs from PK Control.

**Out**
- These fields on to-dos that did not come from a PK.
- Drag-to-reorder, custom columns, themes, per-group search, "New group" (a new PK is a PK visit logged in the app).
- Notifications by email or push. The alert is the date and the red mark on the board.

**Audience:** the sales desk (admins, managers, support), desktop. Same gate as the Dealers page (`seesDealersBoard`).

## 3. Where it lives

`/dealers/pk`. `/dealers` and `/dealers/pk` share two tabs at the top: **Overview · PK follow-up**. The mockup showed three segments (Overview / To-dos / PK follow-up); the app's to-dos already sit inside the overview, so it has two.

Layout as in the mockup:
- **Summary strip:** PKs open · Follow-ups · Alert passed · On us · Waiting on them · New for you.
- **Toolbar:** search, owner filter, Action required filter, "Unread only", "Show done", "Export to Excel".
- **One band per PK**, newest first: dealer, PK date, place, item count, % meter, "N alerts passed", "N new". A band folds on click.
- **Row:** action (+ subtask chip n/m) · Action required (full coloured cell) · Status (full coloured cell) · latest note (red dot if unread, two lines, note count) · priority chip + days · alert (date, "Nd passed" / "in Nd") · owner.
- **Drawer** (opens beside the board): the two status selects, priority select (resets days to the default) and days box, the alert sum in words ("PK Oct 20 + 2 days = Oct 22 · deadline passed"), subtask checklist, notes log with add-note form, "Seen" list. Opening it marks the item read.
- "+ Add action" at the foot of each band, for a follow-up that comes up after the PK.

## 4. Data

### What a PK item is
A `next_actions` row whose `activity_id` points at an `activities` row with `activity_type = 'PK_TRAINING'`. PK date = the local calendar date of `activities.occurred_at`. Visit capture already creates these rows (`sectionItems`, `source = VISIT_CAPTURE`).

### New columns on `next_actions`
- `priority` enum `next_action_priority`: `DO_NOW`, `PLAN`, `DELEGATE`, `ELIMINATE`. Null = not set.
- `priority_days` int (≥ 0), null for Eliminate and when unset.
- `action_required` enum `next_action_required`: `PENDING_ACTION` (on us), `AWAITING_RESPONSE` (waiting on them), `NONE`. Default `NONE`.
- `progress` enum `next_action_progress`: `NOT_STARTED`, `WORKING_ON_IT`, `STUCK`, `DONE`. Default `NOT_STARTED`. Named `progress` because `status` is kept for the email-AI proposals (Dealers spec, phase 4).
- `last_changed_by` (memberships) and `last_changed_at`: who last moved a status or the priority. Set by trigger.

Default days: Do now 1 · Plan 7 · Delegate 2 (decided 2 Nov). The days are editable per item.

**The alert is written into `due_date`** (PK date + days), so the home page, the agenda and `isLate` keep working with no change. The client computes it (pure function, tested) and writes `due_date` with the priority.

**Done and Eliminate both close the item** through `completed_at`, kept in sync by a trigger:
- progress → `DONE` sets `completed_at` (if empty); progress leaving `DONE` clears it unless the item is Eliminate.
- `completed_at` set by another screen (home "done") sets progress `DONE`.
- priority → `ELIMINATE` sets `completed_at` and `priority_days = null`: the item leaves home, agenda and late counts, and is not deleted. Leaving Eliminate clears `completed_at` unless progress is `DONE`.
- The board still lists Eliminate items, dimmed, outside the % and the counts.

### New tables (org-scoped; visible to whoever can see the parent item)
- `next_action_notes` (id, org_id, next_action_id, author_id, body, created_at, edited_at). Author is the signed-in member (trigger). Only the author edits; nobody deletes.
- `next_action_note_versions` (id, note_id, body, replaced_at). Filled by trigger on every edit; no client writes.
- `next_action_reads` (membership_id, next_action_id, last_read_at; primary key on the pair). A member writes only their own row; the desk reads everyone's for the "Seen" list.
- `next_action_subtasks` (id, org_id, next_action_id, title, done_at, position, created_by, created_at). Written by whoever may update the parent item.

RLS for the child tables: `exists (select 1 from next_actions n where n.id = next_action_id)`, so the parent's select policy decides.

### Computed (pure, `src/lib/domain/pk-follow-up.ts`)
- **Unread for me:** a note by someone else, or a status/priority change by someone else (`last_changed_*`), after my `last_read_at`; with no read row, any such note or change.
- **Band %:** each item that is not Eliminate counts its subtasks (done / total); an item with no subtasks counts as one unit, done when the item is done.
- **Alert passed:** open, not Eliminate, priority set, alert date before today. Due today is not passed.

## 5. Excel export

`write-excel-file`, loaded with a dynamic import on click. File `PK follow-up · <Mon D, YYYY>.xlsx`.
- Sheet **PK follow-ups:** a header row per PK (dealer · PK date · place · %), then one row per item: Action, Action required, Status, Priority, Days, Alert date, Owner, Subtasks (n/m), Notes (every note, oldest first, "Author · date: text", "(edited)" where edited).
- Sheet **Subtasks:** PK, Action, Subtask, Done (date or empty).
- It exports what the filters show.

## 6. Import of the October PKs

One-off, after the migrations are live: the three PKs on PK Control (Capital Lumber SLC, Oct 20; BFS Heber · Dave Fagg, Oct 22; Burton Lumber Utah / Heber, Oct 23) and their 17 actions, with statuses, priorities, notes and subtasks. Source: PK Control's own "Export to Excel" file, which Andre exports from Bia's browser (opening rows by hand would mark Bia's reads). Each PK becomes a `PK_TRAINING` activity on the dealer's account; a dealer with no account gets one under the `<Company> <City>` rule. Notes keep their original author and time. Run as a reviewed SQL file with `supabase db query --linked -f`.

## 7. Edge cases

- PK item with no priority: no alert shown ("Set priority"); `due_date` stays as visit capture set it.
- Days changed after the alert passed: the alert moves; the red mark goes if the new date is not past.
- A note edited twice: two versions kept, the row shows the latest text and "edited".
- A member who never opened an item sees it as new only if someone else wrote or changed something.
- PostgREST 1,000-row cap: every list read goes through `fetchAllPages`.
- `next_actions` has two FKs to `accounts`: embeds name `accounts!next_actions_account_id_fkey`.

## 8. Checks

- pgTAP: defaults; completed_at ↔ progress ↔ Eliminate sync; last_changed stamping; notes append-only (no delete, edit by author only, versions kept); reads own-row only; child-table visibility follows the parent.
- vitest: alert date, alert passed, band %, unread, summary counts, the Excel rows.
- Browser check at desktop width on local data: bands, drawer, read dot clears, export downloads.
