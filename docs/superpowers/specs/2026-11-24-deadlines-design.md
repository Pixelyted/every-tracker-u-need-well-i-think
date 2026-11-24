# Deadlines ("Bounties") — short design

24 November 2026. The user asked for deadlines and said "just dive in": a
bigger version (planning work around deadlines, LLM input) comes later.
So this is the small version, and every choice below is the builder's call.

## Intent

Never forget a due date. A deadline is a moment ("hand in by Fri 23.59"),
not a block of time, so it is its own item type next to quests.

## Goals

- Add, edit, delete a deadline: name, due date, due time (default 23.59), note.
- Tick it done (and untick it).
- See it: a strip under the day heads of the week view, and a 📜 BOUNTIES
  panel listing overdue ones first, then those due in the next 14 days.
- Desktop reminders: 20.00 the evening before, and 2 hours before.
- Google push: a 15-minute event ending at the due time with the same two
  reminders; removed from Google once ticked done.

## Non-goals (for now)

Work estimates, study sessions, linking a deadline to a class, priorities,
recurring deadlines, LLM input. The functions stay independent of the forms
so the future AI can call them (spec section 9).

## Anti-goals

- A deadline must never affect quests: no clashes, no cancellations.
- A ticked deadline must never remind, on the laptop or the phone.

## Game vocabulary

| Real thing | In-app |
| --- | --- |
| Deadline | **📜 Bounty** |
| Past due, not done | **⏰ Overdue**, red |
| Done | **✔ Claimed**, struck through |

## How it's built

- `deadlines` table (id, name, due_date, due_time, note, done). New table
  only, so existing databases just gain it (`CREATE TABLE IF NOT EXISTS`).
- `src/deadlines.js`: pure functions (status, the panel list, the week's
  bounties), tested like the schedule engine.
- `validateDeadline` in `src/validate.js`.
- IPC: listDeadlines, getBounties, saveDeadline, deleteDeadline,
  setDeadlineDone; getWeek also returns the week's deadlines.
- Reminders in `src/notify-plan.js`, Google events in
  `src/google/payloads.js` with local key `deadline:<id>`.

## Approaches considered

1. **Own item type (chosen).** Clean: nothing in the quest rules changes.
2. A deadline as a zero-length one-time side quest. Less code, but it would
   clash with classes and show as a block, which is wrong for a moment.
3. Google Tasks instead of Calendar events. Needs another API and scope;
   the app already only manages its own calendar.

## Left open / check with real Google

The 15-minute event length is the builder's call (a zero-length event may
be refused, which would stop the whole push).
