# One microphone — design

Date: 2026-11-04 · Status: draft for Andre's review · For: Bianca's delivery
Absorbs: `2026-11-03-pk-voice-debrief-design.md` (part A, PK by voice). Its §4–§6 remain the detailed reference for the PK fields, and are folded in here as phase 2.
Builds on:
- Say it (`src/lib/voice/command.ts`, `/say`);
- the voice debrief (`/record`, `/api/voice/process`, `/review`, D9 D10 D63);
- timed commitments (`2026-11-04-timed-commitments-design.md`).

Asked by Andre on 2026-11-04: "o log a visit vai ser substituído pelo say it também, não vai?", then "escreve, é isso que preciso entregar pra Bia."

## 1. Why

The add menu has two ways to talk to the system, and they split along a line the rep should never have to think about:

| Today | Says | Gets |
|---|---|---|
| **Say it** | what is going to happen | visits, calls, meetings, to-dos, a quote. It needs signal at the moment of speaking. |
| **Log a visit** (`/record`) | what happened | the visit record plus its follow-ups, confirmed later in Review. It works offline. |

A rep leaving a dealer says both in one breath: "Trained eight of them at Buffalo, they want the Maximo literature tomorrow, and call their buyer Monday at 2." Today that is two screens and two recordings, or one of them is lost.

**Goal:** one microphone, the one on Say it, that takes anything a rep says and returns one card per thing to confirm:
- what happened (the visit);
- what was promised (follow-ups);
- what to book (visits, calls, meetings, a quote).

It works with or without signal. After a PK, the follow-ups arrive already prioritised, owned and itemised for the PK board. Then Log a visit leaves the menu.

## 2. What Bianca and the reps see

**A rep in the truck, with signal.** He taps + and then Say it, speaks, and stops. In a few seconds:

> **Visit · Buffalo Lumber Co · today** — PK training · "Trained 8 of the counter staff."  [Save the visit]
> **Follow-up · from this visit** — Send the Maximo literature · Do now · tomorrow · ☐ PDF ☐ Data sheets ☐ Sample book  [part of the visit]
> **Call · Mon Nov 9 · 2:00 PM** — Call their buyer about the samples  [Put it on the agenda]

"Save the visit" writes the visit and its follow-ups together. Bookings are confirmed one by one, as today.

**Without signal.** The recording is kept on the phone: "Saved — it will be written up as soon as you're back online." When the signal returns, it is written up by itself and the cards wait for him in Review, the same Review he uses today.

**From Home.** "How did it go?" on a stop opens Say it already tied to that planned visit. Nothing else to pick.

**Bianca at the desk:**
- The PK board fills itself from what reps say after a PK: priority, alert, owner, status, checklist and the context said.
- The team calendar gets the calls and meetings booked in the same sentence.
- She can use the same microphone herself ("ask João to send the proposal Friday").

**The menu, top to bottom:** Say it · Quote · Plan a visit · Company. Log a visit is gone.

## 3. How it works

### 3.1 One capture path for every utterance

Say it stops posting audio straight to `/api/voice/command`. Every utterance, spoken or typed, becomes a `voice_capture` through the outbox, exactly as `/record` does today. That is the one path already proven offline: the blob is stored first, then the row, then the upload (D57/D59).

- **Online:** the page enqueues, drains, and calls `/api/voice/process` for that capture straight away, waiting up to about 15 s. The result renders as cards on the same screen.
- **Offline, or slower than that:** the page says it is saved and lets go. Review's existing auto-processing writes it up when the device is back, and the cards appear there.

The capture carries its context, as it already can (`account_id`, `planned_action_id`): set from `/say?visit=<id>` (Home's "How did it go?") and `/say?account=<id>` (an account page).

### 3.2 One reading of what was said

`/api/voice/process` asks for one structured object. It merges today's debrief draft and today's Say it commands:

```
{
  visit:   null | { activity_type, account_id, account_heard, what_happened,
                    outcomes[], contacts[] … }        // today's debriefDraftSchema, minus next_actions
  actions: [ {                                         // today's commands, widened
    kind: VISIT | FOLLOW_UP | QUOTE,
    from_visit: boolean,       // promised at the visit just described → its follow-up
    account_id, account_heard, due_date, time, follow_up_type,
    action, objective, owner_membership_id, teammate_membership_id,
    // PK only (phase 2, part A §4): priority, owner_name, progress, subtasks[], note
  } ]
}
```

Rules added to the prompt:
- Something said in the **past** about a business ("was at", "trained", "fui na", "they told me") is `visit`.
- Something to **do** is an `action`. It has `from_visit = true` when it came out of that visit: "they want the literature", "I'll send it". It has `from_visit = false` when it is booking something new: "and book Ganahl Thursday".
- One `visit` at most per utterance (one account per debrief, as today).
- At most 5 actions, raised from 3, because a debrief often carries four follow-ups.

Kept as they are:
- **Server-side sanitising:** ids held to what the model was shown, dates and times validated, the speaker never the teammate, a teammate matched from the action.
- **Models:** `gpt-transcribe` and `claude-sonnet-4.6` through the AI Gateway.
- **People list:** `pk_member_names`.

`/api/voice/command` stays one release for any open tab, then goes.

### 3.3 The cards

- **Visit card:** account, type, what happened, outcomes, contacts. These are today's Review fields, lifted into a component both `/say` and `/review` render. Its follow-ups (`from_visit`) sit inside it as rows, so "Save the visit" sends the activity, its follow-ups, the planned-visit link (D46) and the contact candidates in one fan-out, the existing D10 fan-out.
- **Booking cards:** today's Say it cards, unchanged: visit, call, meeting, to-do and quote, with time and type.
- **Nothing to save:** "Nothing to log or book in that — try again." The capture is closed.
- **Review:** renders a processed capture with the same components, so offline and online look the same.

### 3.4 Retiring Log a visit
- The menu entry is removed.
- `/record` redirects to `/say`, keeping `visit` and `account`, so old links and the PWA history still land.
- The Home tile and the day spine's "Talk it through" point to `/say`.
- The typed quick log on the day spine (a note against a stop, no AI) stays as it is. It is not a microphone.

## 4. Phase 2 — the PK fields (part A)

When `visit.activity_type = PK_TRAINING`, each `from_visit` action carries part A's fields:
- priority (Do now · Plan · Delegate);
- owner;
- status (To do · In progress · Waiting on dealer);
- subtasks;
- note.

Its rules are unchanged:
- owner matched on the server, and the speaker when in doubt;
- days = spoken date − PK date, or the default days when no date was said;
- the owner select only for those who may assign;
- the fan-out order item → subtasks → note through two new outbox types (`next_action_subtask`, `next_action_note`).

The PK rows in the visit card show these fields, behind a "Details" toggle on a phone. The result lands on the PK board for the rep (his PKs) and the desk (everyone).

## 5. Order of delivery

| Phase | What ships | Done when |
|---|---|---|
| **1** | Say it on the capture path (online and offline), the merged reading, the visit card, Review rendering the same, Log a visit retired | One sentence logs a visit with follow-ups and books a call; offline, it appears in Review later |
| **2** | PK fields (part A) | A PK said aloud fills the PK board with priority, alert, owner, status, checklist and note |

Each phase is published on its own, with Andre's go.

## 6. Edge cases

- **Only bookings, no visit:** today's Say it, unchanged.
- **Only a visit, no bookings:** the visit card alone.
- **A visit at an account the model cannot place:** the visit card asks which account, as Review does today.
- **"How did it go?" context, but the rep talks about another dealer:** the spoken dealer wins and the planned link is dropped, with a line on the card saying so.
- **A long ramble:** the transcript is kept on the capture, as today, so nothing said is lost even if a card is dismissed.
- **Process fails online:** the capture is already saved, so it falls back to Review, like offline.
- **Two devices:** unchanged. One capture per utterance, and the outbox's LWW rules (D61).

## 7. Checks

- **vitest:**
  - merged schema parsing, old drafts included;
  - sanitising of visit plus actions;
  - `from_visit` fan-out (activity, then follow-ups linked to it);
  - the `/record` redirect keeps its params.
- **Prompt eval on the live model, typed path:**
  - the §2 sentence;
  - a Portuguese debrief;
  - bookings only;
  - a PK with a listed checklist.
- **Browser, phone, local data, as TJ (rep) and as Bianca:**
  - online: speak, see the cards, save, then find the visit on the account and the call on the agenda;
  - offline (devtools): save, reconnect, the cards appear in Review;
  - from Home, "How did it go?" opens with the stop linked.
- **pgTAP:** nothing new in phase 1. Phase 2 per part A §8.

## 8. Open questions for Bianca

1. **What "Delegate" means** (carried from part A): someone else at GMX doing it, or the dealer doing it? The draft's priority rules depend on the answer.
2. **Who confirms a rep's PK follow-ups owned by someone else?** Today the rep saves them with the owner he picked ("João sends the proposal"), and João sees them on the board. Is that enough, or does the desk want to OK items assigned to them?
