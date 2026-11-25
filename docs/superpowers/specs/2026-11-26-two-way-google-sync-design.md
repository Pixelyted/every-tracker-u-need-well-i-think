# Two-way Google Calendar sync — design

26 November 2026. Brainstormed with the user, one question at a time.
Everything marked *(builder's call)* was proposed by Claude and not
objected to; everything else is the user's own decision.

## Intent

Today the app pushes to Google one way (src/google/push.js): the app is the
source of truth, and the ⚔ calendar is only a copy. Edits made in Google are
ignored or undone, and an event the user adds to ⚔ by hand is **deleted** as
a "leftover duplicate".

The user is often away from the laptop when a friend tells them about an
extra class, a meeting or a concert. They want to put it in Google Calendar
on their phone right away and find it in the app later. They also want to
be able to change the app's own events from Google.

Success: what's on the phone and what's in the app agree, whichever side
the change was made on.

## Goals

1. **Main calendar → app.** Every upcoming event in the user's main Google
   calendar (calendar id `primary`) becomes an app quest. New ones keep
   coming in at each sync.
2. **Main calendar ↔ app, both ways.** Changing such a quest in either
   place changes the other; deleting it in either place deletes it in the
   other.
3. **⚔ calendar ↔ app, both ways.** Changes made in the ⚔ calendar flow
   back into the app (details in "What each Google change does").
4. **Newest edit wins** when both sides changed between two syncs.

## Non-goals (for now)

- Repeating events in the main calendar are **not imported**. The user
  makes weekly things in the app only.
- A weekly class as a whole (its weekday, its time, the series itself) is
  made and edited **only in the app**. Whole-series edits made in Google
  are reset on the next sync, like today.
- Live updates (Google calling the app). They need a public server.
- Other calendars (holidays, birthdays, calendars shared with the user).
- Habits, XP, finances: untouched.

## Anti-goals

- The app must **never change or delete a Google event it didn't create
  or import**. A bug may only ever affect events linked in `mappings`.
- A failed or partial Google read must **never** delete things in the
  app. "I couldn't see it" is not "it was deleted".
- Nothing shows up twice on the phone: quests that came from the main
  calendar are **not** copied into ⚔.

## Decisions

### Permission

- The user chose the wider permission. The app asks for
  `https://www.googleapis.com/auth/calendar.events` (see and edit events
  in all calendars) in addition to the current `calendar.app.created`
  (needed to create the ⚔ calendar itself).
- The app stays in Google "Testing" mode (never published), so the
  consent screen shows the "unverified app" warning and the 7-day
  Reconnect flow is unchanged.
- *(builder's call)* The main-calendar part is a Settings checkbox,
  **"Two-way with my main Google calendar"**, off by default. Turning it on
  asks for the wider permission through the normal Connect/Reconnect
  sign-in. With it off, the app asks only for the old narrow permission
  and only ⚔ is two-way. This keeps the narrow option for people using
  the public repo. Rename the Settings section from "Google Calendar
  (one-way push)" to "Google Calendar sync".
- *(builder's call)* If the saved sign-in lacks the wider permission while
  the checkbox is on, the main-calendar part is skipped and the status
  line says to reconnect. The ⚔ part keeps working.

### How changes are found (approach 1, chosen by the user)

Each sync **lists everything** and compares, instead of using Google's
sync tokens:

- all events in ⚔ (as today, but now with full fields: summary,
  description, start, end, status, updated, recurrence, recurringEventId,
  originalStartTime);
- with the checkbox on: the main calendar's events with `timeMin` = start
  of today (Jakarta), `singleEvents=false`, `showDeleted=true`.

For each linked event, the app compares Google's `updated` stamp with the
one stored at the last sync, and the app item's own last-edit time with
the one stored at the last sync:

| Google changed? | App changed? | Result |
| --- | --- | --- |
| no | no | nothing |
| yes | no | apply Google's version to the app |
| no | yes | push the app's version (today's push) |
| yes | yes | the newer of the two wins |

Rejected: **sync tokens**. They send less data, but tokens expire, they
can't be combined with "upcoming only", and they are harder to debug. At
one person's calendar size, listing everything every 30 minutes is far
inside Google's free limits. It can be swapped in later without changing
behaviour.

Rejected: **push notifications (webhooks)**. They need a public HTTPS
server.

### When it syncs

The same moments as today's push (src/google/scheduler.js): on app start,
2 s after a change in the app, every 30 minutes, 5 min after a failure, and
on "Push now". Each run is now **pull, then push**. *(builder's call)* The
button label becomes "Sync now".

### What a main-calendar event becomes

- A **side quest** (side quests earn no XP, so nothing changes in XP),
  tagged "📅 from Google" in the app.
- Title → name, description → note, start/end → date/start/end, all
  converted to Jakarta time.
- An all-day event becomes a one-time quest from 00:00 to 23:59 *(builder's
  call)*, remembered as all-day so it is written back as all-day.
- An event that spans more than one date (a trip, a festival, a party from
  20:00 to 02:00) becomes a **multi-day side quest**: a new variant of the
  one-time quest with a start date/time and an end date/time. The user
  decided it must **never cancel anything** (unlike a `limited` event,
  which cancels every quest on the days it touches, see
  `applyCancellations` in src/schedule.js). It only shows on each day it
  covers and takes part in clash marking like any quest. How it is stored
  (e.g. a `once` quest with an extra end date) is the builder's choice.
  Only imports and their edits need it; the app's own "add quest" form does
  not have to offer it.
- When turned on, all **upcoming** events come in (the user chose this
  over "only new ones from now on"). Past events never come in.
- Skipped: repeating events and their single instances (`recurrence` or
  `recurringEventId` set), and events the user has **declined**
  *(builder's call)*.
- *(builder's call)* Also skipped: Google's **special events** (`eventType`
  other than `'default'`: Gmail bookings, out of office, focus time,
  working location), which can't be edited like normal events.
- *(builder's call)* A linked main event that later becomes **repeating or
  special** in Google is **unlinked**: its mapping goes, the quest stays as
  it is, and Google is never touched for it again.
- *(builder's call)* If Google **refuses to change one event** (a 400, or a
  403 with reason forbidden / forbiddenForNonOrganizer / invalid /
  badRequest), that event is skipped and logged instead of failing the
  sync. A refused patch isn't retried until the quest changes again; a
  refused delete also **hides** the event so it isn't imported again.
  Other 403s (rate limits, quota, missing permission) fail the sync as
  usual.
- In the app, the user can edit everything: name, date, time, note, and
  also main/side, XP, colour and icon (the last four stay app-only).
- Deleting it in the app deletes the event in Google (the user chose this
  over "only hide it"). Google keeps it in its Trash for 30 days.
- *(builder's call)* For an event someone **else** organised (an
  invitation), Google doesn't let the user change its time or title. The
  app imports it, but its name, date and time are locked in the edit form
  ("organised by someone else: change it in Google"), and deleting it in
  the app only unlinks and hides it locally.
- *(builder's call)* **What the app writes back to the main calendar:**
  only title, description, start and end, sent as a **partial update**
  (`events.patch`), never a full replace. Guests, location, Meet links,
  colours and the user's own reminders stay as they are. All-day events
  stay all-day. The app's clash markers ("⚠ ", "Clashes with: …") and its
  own reminders are **never** written to main-calendar events; they are
  for ⚔ only. The push hash for a `'main'` mapping covers just those four
  fields.
- *(builder's call)* **Imported quests keep their kind.** The edit form
  doesn't let an imported quest become weekly or limited (it stays a
  one-time or multi-day side/main quest), so it never has to move between
  calendars. Main/side may still be switched.
- *(builder's call)* In ⚔, if a one-time quest is edited on the phone into
  an all-day event it becomes 00:00–23:59; if it is stretched over several
  dates, the edit is **reset** to the app's version (the app's own quests
  don't change kind from Google).
- Once an imported quest's event has ended, the app keeps the quest as
  history and stops comparing it.

### What each Google change does in the ⚔ calendar

The app strips its own decoration before reading a title: a leading
"⚠ " (clash marker), a leading "📜 " and a trailing " (due HH.MM)" on
bounties. The clash text at the top of a description ("⚠ Clashes with: …"
plus the blank line) is stripped from the note.

| In Google (⚔) | In the app |
| --- | --- |
| One week of a weekly class moved | that week becomes a **make-up** (a `move` change) at the new date/time |
| One week of a weekly class deleted | that week becomes a **skip** |
| Whole weekly series edited (time, weekday, title) | **reset** to the app's version (non-goal) |
| Whole weekly series deleted | **put back** *(builder's call: weekly things are app-only)* |
| One-time quest / limited event edited | name, date, time, note updated |
| One-time quest / limited event deleted | quest deleted |
| Make-up edited | the make-up's date/time updated |
| Make-up deleted | the week becomes a skip (`move` → `skip`) |
| Bounty moved | due date/time = the event's **end** |
| Bounty renamed / note edited | name / note updated |
| Bounty deleted | bounty deleted |
| New single event added by hand | a new **side quest**, linked (no longer deleted) |
| New repeating event added by hand | left alone: not imported, not deleted *(builder's call)* |

After turning a one-week change into a make-up or skip, the app rebuilds
that class's series in Google (delete and re-create, as the current
reconcile already does), so Google ends up with a clean EXDATE plus a
separate make-up event.

Frozen mappings (archived semesters) are never read or changed.

### Safety rules *(builder's call)*

- A Google list call that fails stops the whole sync **before** anything
  is changed in the app (as today, a failed push touches nothing local).
- If the ⚔ calendar itself is gone (deleted in Google), it is re-created
  and filled from the app, as today. That is **not** read as "every event
  was deleted".
- If one sync would delete more than **5** app items because of Google
  deletions, it deletes none of them, and the status line shows a warning:
  "Google says N events were deleted. Nothing removed — check Google, then
  click Sync now to confirm." Clicking Sync now within the next 10 minutes
  allows it once.
- Turning the checkbox off, or disconnecting Google, keeps imported quests
  as normal app quests (unlinked). Nothing is deleted.

## Data changes

- `quests`, `deadlines`, `changes` get an `updated_at` column (ISO time),
  set on every save from the app. Old rows start with NULL, which means
  "older than any Google edit".
- `quests` gets `origin` (`NULL` = made in the app, `'google'` = imported
  from the main calendar), `google_locked` (1 for invitations), an
  all-day flag, and whatever the multi-day side quest needs (e.g. an end
  date for `once` quests).
- `mappings` gets `calendar` (`'app'` = ⚔, `'main'`), `google_updated`
  (Google's `updated` stamp at the last sync) and `local_updated` (the
  item's `updated_at` at the last sync). The existing `hash` keeps
  telling "does the app's version differ from what we sent".
- A hidden list of main-calendar event ids the user removed locally
  (invitations): a `hidden_google_events` table or a setting
  *(builder's choice)*.

## Code shape *(builder's call)*

- `src/google/pull.js`: pure functions that take the listed events, the
  mappings and the app's data, and return a list of changes to make in
  the app (`createQuest`, `updateQuest`, `deleteQuest`, `setChange`,
  `updateDeadline`, …) plus the mappings to save. No API calls inside, so
  it is fully unit-testable like `planPush`.
- `src/google/push.js`: `runPush` becomes `runSync`: list → pull plan →
  safety checks → apply to the app → today's push plan (now also covering
  `'main'` mappings for app-side edits and deletes of imported quests).
- `src/google/api.js`: `listEvents` returns the full fields; new
  `listMainEvents(timeMin)`, and insert/update/delete take the calendar id
  as they already do.
- `src/google/auth.js`: the scope list depends on the setting.
- The UI: the "📅 from Google" tag in the week view and edit form, locked
  fields for invitations, the checkbox, and the warning line.
- The `reconcileWithGoogle` "delete unknown events" step goes away; its
  job (a lost insert answer leaving a duplicate) is covered by putting
  the app's local key in each inserted event's
  `extendedProperties.private.localKey`, so an unknown event with that
  property is recognised as ours instead of imported as new.

## Left to the builder

Exact UI wording and placement, table vs setting for hidden ids, test
layout. Tests should cover every row of the two tables above, the safety
rules, the title/description stripping, all-day and multi-day events, and
time-zone conversion.
