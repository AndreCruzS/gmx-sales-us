# PK by voice — design (part A)

Date: 2026-11-03 · Status: draft for Andre's review
Builds on: `docs/superpowers/specs/2026-11-02-pk-follow-up-design.md` (the PK follow-up board) and the voice debrief (`docs/superpowers/plans/2026-07-22-phase4-voice-debrief.md`, decisions D9, D10, D63).

## 1. Why

After a PK, the person who ran it records a voice note. Today that note becomes a visit plus a list of "what happens next", and each item reaches the PK follow-up board bare: no priority (so no alert), owned by whoever recorded it, no checklist, no note. Then someone has to sit at the board and fill in every item by hand, which is exactly the work the voice note was meant to save.

Part A makes one voice note after a PK produce a board that is already filled in: each follow-up arrives with its priority, owner, status, checklist and the context that was said. The person still confirms everything on the review screen before anything is saved (D9).

Part B, changing an existing item by voice ("Capital Lumber replied, we're waiting on them"), is a separate spec.

## 2. Scope

**In**
1. The draft recognizes a PK: the activity type becomes `PK_TRAINING` when the note describes one.
2. For each follow-up the draft proposes a **priority** (Do now · Plan · Delegate), an **owner**, a **status**, **subtasks** and a **note**.
3. The review screen shows and edits those fields, but only when the activity type is PK training.
4. Sending writes them: the item with its priority, days, alert and status, then its subtasks and its first note, through the offline outbox like the rest of the debrief.

**Out**
- Changing items that already exist (part B).
- Any change to non-PK debriefs. Their draft and review screen stay exactly as they are.
- New models or keys. Same path as today (D63): AI Gateway, `openai/gpt-4o-mini-transcribe` for transcription with the Gemini audio fallback, and `anthropic/claude-sonnet-4.6` for extraction.
- The Eliminate priority. Nobody dictates a follow-up in order to drop it.

## 3. What the person says, and what comes out

Example note (in any of the rep's languages; output is in English, D-language rule unchanged):

> "Did the PK at Capital Lumber in Salt Lake today, eight guys from the counter. They want the Maximo literature — the PDF, the data sheets and a printed sample book — that's urgent, I'll send it tomorrow. João is going to send them the price proposal this week. And we're waiting on them to confirm a date for the display install."

Draft:

| Action | Priority | Owner | Status | Subtasks | Note |
|---|---|---|---|---|---|
| Send the Maximo literature | Do now | the recorder | To do | PDF · Data sheets · Printed sample book | "Eight people from the counter attended; they asked for it." |
| Send the price proposal | Delegate | João | To do | — | — |
| Confirm the display install date | Plan | the recorder | Waiting on dealer | — | "Waiting on them to confirm a date." |

## 4. The draft (`src/lib/voice/draft.ts`)

### Recognizing a PK
The extraction prompt gains one rule: a note describing a product-knowledge training, a "PK", a "treinamento", or a training session given to a dealer's staff is `activity_type = PK_TRAINING`. Nothing else in the type choice changes.

### New optional fields on each `next_actions` entry
All are nullable or empty-by-default, so a non-PK draft and every draft already stored still parse.

- `priority`: `DO_NOW` | `PLAN` | `DELEGATE` | null.
  - `DO_NOW` when the note says the item is urgent or due within a day ("tomorrow", "right away").
  - `DELEGATE` when someone other than the speaker will do it.
  - `PLAN` otherwise, when the note gives a date further out.
  - null when the note gives no sense of urgency.
- `owner_name`: string | null. The person who will do it, exactly as spoken ("João", "Deon"). null means the speaker.
- `progress`: `NOT_STARTED` | `WORKING_ON_IT` | `WAITING`. Default `NOT_STARTED`. `WAITING` when the note says the ball is with the dealer. `STUCK` and `DONE` are never drafted.
- `subtasks`: string[]. Use it only when the speaker lists the parts of one follow-up; a list of separate follow-ups stays separate actions. Empty by default.
- `note`: string | null. Context said about this item that is not the action itself, at most two sentences. Never invented.

### People the model may name
The prompt is given the org's members as "id — name" (desk and reps, the list the PK board already uses). `owner_name` is matched to that list on the server after extraction, not by the model. An exact or unambiguous first-name match gives an `owner_id`. Anything else leaves the owner as the speaker and keeps the spoken name in the note ("João to send it", for example). A wrong owner moves someone's work silently; the speaker is the safe default.

### Dates
The model keeps giving a concrete `due_date` for every action, as today. On a PK item, the review screen turns it into priority days: `days = max(0, due_date − PK date)`, where the PK date is the visit's date. The alert then equals the spoken date, and the board's rule (alert = PK date + days, written into `due_date`) holds.

When the note gives a priority but no date, `due_date` comes from the default days: Do now 1, Plan 7, Delegate 2.

## 5. The review screen (`src/app/review/page.tsx`)

When the activity type is PK training, each row of "What happens next" shows, under the action and its date:

- **Priority:** a select (Do now · Plan · Delegate · none). Changing it resets the date to PK date + the default days, as on the board.
- **Owner:** a select. It is shown only to a member who may assign work to others: an admin, or an assistant for the reps they support. This mirrors the `next_actions_insert` policy. A rep sees "You" as plain text, and the spoken name stays in the note.
- **Status:** a select (To do · In progress · Waiting on dealer).
- **Subtasks:** the list, each one removable, plus "+ Add a subtask".
- **Note:** a text box.

The row stays compact. On a phone, the five fields sit behind a "Details" toggle that opens on its own when the draft filled any of them. Removing a row, adding a row and switching the activity type away from PK training keep working as they do today. Switching away hides the PK fields, which are not saved.

The copy stays in English (mockups-in-English rule).

## 6. Sending

For each PK row, in this order, through the outbox:
1. `next_action` create, with `priority`, `priority_days`, `due_date` (= the alert), `progress`, `owner_id` (the picked owner, else the speaker), `entered_by` (the speaker, when the owner is someone else), `activity_id` (the visit), `account_id`, and `source = VISIT_CAPTURE` (the value the typed visit sections already use).
2. One `next_action_subtask` create per subtask, with `position` in order.
3. One `next_action_note` create when the note is not empty. The author is the speaker; the stamp trigger sets it.

The outbox does not write subtasks or notes yet, and voice review has to work offline. So this adds two entity types, `next_action_subtask` and `next_action_note`, create only, each with a zod schema in `src/lib/domain/schemas.ts`. `nextActionCreateSchema` gains `priority`, `priority_days` and `progress`, which only the update schema has today. The outbox already sends in order, so a subtask or note never reaches the server before its item.

Non-PK rows and non-PK debriefs use today's path, unchanged.

## 7. Edge cases

- **The note names no PK:** no PK fields, today's behaviour.
- **A PK note with no follow-ups:** the visit is saved, and the board shows the PK band with "No follow-ups from this PK yet."
- **Several dealers named in one note:** the account rule is unchanged, one account per debrief. Follow-ups about another dealer stay in this PK; the note says which dealer.
- **The owner is named, but the speaker cannot assign:** the item is the speaker's, and the name is kept in the note.
- **A spoken date before the PK date** (a slip): days = 0, the alert is the PK date, and the review screen shows it.
- **Old drafts, saved before this change:** the new fields are missing and read as null or empty, so the screen shows a PK row with priority unset, as today.
- **Subtasks and note are optional:** an item with none is still a full PK item.
- **Offline:** recording, review and send already work offline. The new outbox types keep that true.

## 8. Checks

- **vitest, schema:** the draft parses with and without the new fields, and `STUCK`/`DONE` are rejected as drafted progress.
- **vitest, owner match:** exact name, first-name-only, ambiguous (two Joãos), unknown, and "me".
- **vitest, dates:** spoken date to days, priority with no date to default days, a date before the PK to 0.
- **vitest, fan-out:** order and contents for a PK debrief (item, then subtasks, then note); a non-PK debrief's ops unchanged.
- **vitest, outbox:** the two new entity types validate, and a bad one is refused.
- **Prompt eval:** the example in §3, plus a Portuguese note and a note with no PK, run against the live extraction model on the typed-debrief path (no audio). The output is checked by hand.
- **Browser, phone width, local data:** record (typed path) → review shows the PK fields → send → the PK board shows the items with priority, alert, owner, status, checklist and note.
- **pgTAP:** nothing new. The tables, triggers and RLS from 2026-11-02 already cover these writes.

## 9. Open question for Andre

The draft decides the **priority** from words ("urgent", "this week", "João will"). If the team uses the priorities differently, these rules belong in the prompt, so it is worth confirming with Bia. For example, if Delegate means "someone else in the company" rather than "the dealer does it".
