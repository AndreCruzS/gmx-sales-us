# PK follow-up for reps — design

Date: 2026-11-03 · Status: draft for Andre's review
Builds on: `docs/superpowers/specs/2026-11-02-pk-follow-up-design.md`.
Decided by Andre on 2026-11-03: "o pk follow up não é algo apenas para os admins ok? o rep deve estar ciente do follow up do pk dele, o lance é que os admin veem de todos." Then he chose:
- a rep sees **his PKs in full**;
- he reaches the board from **a card on Home and a tab in the Agenda**.

## 1. Why

The board built on 2 Nov is desk-only (`seesDealersBoard`), so the rep who ran a PK has no way to see what was promised there. The desk supervises every PK, but the rep is the one in front of the dealer. He has to know what is still open, who has it, and when the alert passes.

## 2. Who sees what

| Role | Sees on the board |
|---|---|
| Admin, desk | Every PK, as today. |
| Manager | The PKs their team can see (`visible_membership_ids()`), and the items in them. |
| Rep | (a) Every PK he ran, with **all** its items, including the ones João or Bia own. (b) Any PK item someone else assigned to him, inside its PK band, even when the PK is not his. |

What he may do:

| | His own item | Someone else's item in his PK |
|---|---|---|
| Status, priority, days | edit | read only |
| Subtasks | tick, add, remove | read only |
| Notes | read and add | read and add |
| "Seen" | his own read receipt | his own read receipt |

So the rep can answer on João's item ("the dealer called me about it") without changing João's status. Editing someone else's item stays with its owner and the desk, under the same update rule as today.

## 3. Data access (RLS)

Today a rep reads `activities` and `next_actions` only where he is the owner. Two widenings, PK only:

1. **`next_actions` select** also lets a member read an item whose `activity_id` is a PK (`PK_TRAINING`) owned by someone they can see. That makes the rep's PK whole.
2. **`activities` select** also lets a member read a PK activity that has an item they own. That gives an assigned item its band (dealer, date, place).

Both conditions go through one `security definer` function, `private.visible_pk_activity_ids()`, with `set search_path = ''`. It returns the ids of PK activities whose owner is visible to the caller, or that carry a next action owned by someone visible to the caller. Because each policy reads that function and not the other table, the two policies do not loop into each other.

- **Child tables** (`next_action_notes`, `next_action_subtasks`, `next_action_reads`) already defer to "can see the parent", so they widen with it. Notes insert keeps its rule: anyone who can see the item may add one, and the author is stamped.
- **Subtasks write** follows the parent's **update** rule, which already gives "read only on someone else's item".
- **Updating, inserting and deleting `next_actions`** stays exactly as it is.
- **Non-PK activities and items** are not widened at all. A rep still cannot read a colleague's dealer visits or to-dos.

## 4. Where the rep reaches it

- **Home:** a card **"Your PKs"**, which appears only when the rep has an open PK item. It reads "3 PKs open · 7 follow-ups · 1 alert passed · 2 new" and opens the board. It sits with the day's other cards; the exact position follows Home's existing order (late first).
- **Agenda (`/visits`):** a tab row at the top, **"Day · PK follow-up"**, in the same style as the "Overview · PK follow-up" tabs on Dealers. The PK tab shows the same board.
- **Route:** the board stays one component, `PkBoard`. The page moves its gate from `seesDealersBoard` to "any active member". It is reached at `/dealers/pk` by the desk and at `/visits/pk` by a rep. Each route shows its own tabs and the same content.
- **Bar:** the rep's bar does not change (Home · Agenda · Add · Quotes · Accounts).

## 5. The board for a rep

It is the same board, with these differences:

- **Owner filter:** "Everyone · Mine". There are no other names, because there is nobody else for him to filter by.
- **Summary strip:** the same six figures, counted over what he sees.
- **Drawer on someone else's item:** status, priority and days show as text with "Owned by João". Subtasks show without checkboxes. The notes log and "add a note" work as usual.
- **"+ Add action" on his own PK band:** stays, and the new item is his.
- **Excel export:** stays, and exports what he sees.
- **On a phone:** cards, as already built.

## 6. Edge cases

- **A rep with no PKs:** no Home card. The Agenda tab shows "No PKs yet. A PK you log as a visit shows up here with its follow-ups."
- **An item reassigned from the rep to João:** he still sees it, because it is in his PK.
- **A PK João ran, with one item assigned to the rep:** he sees that PK's band with only the items he can read, which are his own. The band's % and counts cover only what he sees, and the band says "Some follow-ups here are João's".
- **A rep who becomes inactive:** nothing changes, the existing membership rules apply.
- **The PostgREST cap and the two FKs to `accounts`:** reads still go through `fetchAllPages`, and embeds name `accounts!next_actions_account_id_fkey`.

## 7. Checks

- **pgTAP:**
  - a rep reads every item of his PK, including João's;
  - a rep reads the PK band of an item assigned to him;
  - a rep still cannot read a colleague's non-PK visit or to-do;
  - a rep cannot update João's item, but can add a note to it and mark it read;
  - subtasks on João's item are read-only for the rep;
  - a manager sees their team's PKs.
- **vitest:** the board's owner filter and the read-only drawer state for someone else's item.
- **Browser, local data, phone width, logged in as TJ (rep):** Home card, then Agenda tab, then his PK band shows João's item read-only, then a note is added. As Bianca, she sees every PK, as today.

## 8. Order with the other PK work

This comes **before** part A (PK by voice), because part A's items will be owned by the person who spoke, often a rep. Part A's spec does not change: its owner rule already follows `next_actions_insert`.
