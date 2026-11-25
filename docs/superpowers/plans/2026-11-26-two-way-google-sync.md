# Two-way Google Calendar sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-way push into a two-way sync: edits in the ⚔ calendar flow back into the app, and (behind a Settings checkbox) the user's main Google calendar is imported and kept in step both ways.

**Architecture:** Each sync run lists every ⚔ event (and, if enabled, every upcoming main-calendar event), feeds them with the mappings and the app's data into a pure planner (`src/google/pull.js`) that returns a list of actions, applies those to the store, and then runs the existing push (extended with a second, partial-update push for main-calendar quests). "Who changed" is decided by comparing Google's `updated` stamp and the app item's new `updated_at` with the values stored on the mapping at the last sync.

**Tech Stack:** Node 22 (`node:test`, `node:sqlite`), Electron 45, `@googleapis/calendar`, `google-auth-library`. Plain JS, CommonJS, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-26-two-way-google-sync-design.md` — read it before any task; every row of its two tables is a requirement.

## Global Constraints

- Time zone for everything app-side: `Asia/Jakarta` (`TIMEZONE` in `src/google/payloads.js`).
- Scopes: always `https://www.googleapis.com/auth/calendar.app.created`; plus `https://www.googleapis.com/auth/calendar.events` only when the setting `googleMainSync` is true.
- The main calendar is calendar id `'primary'`.
- The app may only change or delete Google events that have a row in `mappings`. Never anything else.
- A Google list call that fails stops the sync before the store is touched.
- More than **5** deletions caused by Google in one run → none are applied; they are held until the user clicks "Sync now" within **10 minutes** of the warning.
- Main-calendar writes use `events.patch` with only `summary`, `description`, `start`, `end`. Never `update`, never reminders, never "⚠" markers.
- Quests imported from the main calendar (`origin = 'google'`) are never put into ⚔.
- Code style: beginner-readable, short comments explaining *why*, the style of the existing files. Run `node --check ui/*.js` after any `ui/` edit.
- Commits: `git -c user.name=Claude -c user.email=noreply@anthropic.com commit`, message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never put real names, timetable, calendar data or the user's email into the repo or tests.

## Review Focus

1. **Upgrading an existing database**: every old mapping has `google_updated = NULL`. The first sync must only *record* stamps for those, not treat every ⚔ event as "changed in Google" (test in Task 5: `baseline mappings only get stamped`).
2. **An upcoming imported quest whose event is missing from the main list** (moved into the past, or purged from Google's deleted list): must be checked with `getEvent` before deleting anything (test in Task 6: `missing upcoming main event is looked up, not assumed deleted`).
3. **Our own push changing `updated`**: after every insert/update/patch the sync must store the returned `updated`, or the next run sees "changed in Google" and loops (test in Task 7: `a second sync right after a push changes nothing`).
4. **Overnight events from the phone** (20:00–02:00): become a two-day side quest, cancel nothing, and only earn XP once if promoted to main (tests in Task 2).
5. **An event the user added to ⚔ by hand that has no `localKey`**: imported, never deleted (test in Task 5); one *with* a `localKey` whose mapping already exists elsewhere is a lost-insert duplicate and is deleted (test in Task 5).

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/db.js` (modify) | schema v5 columns/table, `updated_at` stamping, mapping fields, hidden events |
| `src/schedule.js` (modify) | multi-day one-time quests (`repeat 'once'` + `endDate`), never cancelling |
| `src/validate.js` (modify) | allow multi-day once quests; imported quests can't become weekly/limited |
| `src/google/event-time.js` (create) | Google event times ⇄ app slots in Jakarta; stripping the app's decorations from titles/notes |
| `src/google/api.js` (modify) | full event fields, `listMainEvents`, `getEvent`, `patchEvent`, `updated` returned from writes |
| `src/google/payloads.js` (modify) | `extendedProperties.private.localKey`, skip `origin 'google'`, multi-day once bodies, `buildMainBodies` |
| `src/google/pull.js` (create) | pure `planPull`: listed events + mappings + app data → actions |
| `src/google/sync.js` (create) | `runSync`: list → plan → safety → apply → push ⚔ → push main → stamps |
| `src/google/push.js` (modify) | keep `planPush`/`applyPlan`; drop `reconcileWithGoogle` and `runPush` (moved into sync.js) |
| `src/google/auth.js` (modify) | scopes depend on a `wide` flag; `hasWideScope()` |
| `main.js` (modify) | `runSync`, the "confirm held deletes" flag, reconnect when the checkbox changes |
| `ui/forms.js`, `ui/app.js` (modify) | checkbox, "Sync now", warning line, 📅 tag, locked/limited form for imported quests |
| `docs/google-setup.md`, `README.md` (modify) | new permission and what two-way does |

---

### Task 1: Database v5

**Files:**
- Modify: `src/db.js`
- Test: `test/db.test.js`

**Interfaces:**
- Produces:
  - Quest objects gain `origin` (`null` | `'google'`), `googleLocked` (boolean), `allDay` (boolean), `updatedAt` (ISO string | null). One-time quests may carry `endDate` (multi-day).
  - Change objects and deadline objects gain `updatedAt`.
  - Mapping objects: `{ localKey, googleId, hash, frozen, calendar: 'app'|'main', googleUpdated, localUpdated }`.
  - `saveQuest(quest)`, `saveDeadline(d)`, `setDeadlineDone(id, done)`, `setChange(change)` set `updated_at = new Date().toISOString()` on every write. `saveQuest` keeps `origin`, `google_locked`, `all_day` when the incoming quest has them `undefined` (same rule as `xp`).
  - `upsertMapping({ localKey, googleId, hash, frozen = 0, calendar = 'app', googleUpdated = null, localUpdated = null })`.
  - `listHiddenGoogleEvents(): string[]`, `hideGoogleEvent(googleId)`.
  - `deleteQuest(id)`: when the quest has `origin 'google'` and `google_locked = 1`, its mapping's `googleId` is added to the hidden list in the same transaction.
  - `getQuest(id)`, `getDeadline(id)`, `getChange(id)` (single row or `null`) — used by sync to read `updatedAt` after a write.

- [ ] **Step 1: Write the failing tests** in `test/db.test.js`:
  - `v5: an old v4 database gains the new columns and keeps its rows` — create a v4-shaped DB file (CREATE the v4 `quests`/`mappings` tables by hand in a temp file with one row each), `openStore` it, assert the quest reads back with `origin === null`, `allDay === false`, `updatedAt === null` and the mapping with `calendar === 'app'`, `googleUpdated === null`.
  - `saveQuest stamps updatedAt and keeps origin when not given` — save `{...seminar-like once quest, origin: 'google', googleLocked: true}`; save again without `origin`; assert `origin === 'google'`, `googleLocked === true`, `updatedAt` is an ISO string that changed between the two saves (stub nothing; compare `>=`).
  - `a once quest keeps its endDate` — save once quest with `date '2026-12-05'`, `endDate '2026-12-06'`; read via `getWorld()`; `endDate === '2026-12-06'`.
  - `setChange and saveDeadline stamp updatedAt`.
  - `upsertMapping stores calendar and stamps`.
  - `deleting a locked imported quest hides its Google event` — save locked google quest, `upsertMapping({ localKey: 'quest:'+id, googleId: 'g1', calendar: 'main' })`, `deleteQuest(id)`; `listHiddenGoogleEvents()` deep-equals `['g1']`.

- [ ] **Step 2: Run** `node --test test/db.test.js` — Expected: the new tests FAIL.

- [ ] **Step 3: Implement.** `SCHEMA_VERSION = 5` with a comment line `// 5: two-way Google sync (updated_at, quest origin, mapping stamps, hidden events).` Add to `SCHEMA` the table `hidden_google_events (google_id TEXT PRIMARY KEY)`. Use `addColumnIfMissing` for: `quests.updated_at TEXT`, `quests.origin TEXT`, `quests.google_locked INTEGER NOT NULL DEFAULT 0`, `quests.all_day INTEGER NOT NULL DEFAULT 0`, `deadlines.updated_at TEXT`, `changes.updated_at TEXT`, `mappings.calendar TEXT NOT NULL DEFAULT 'app'`, `mappings.google_updated TEXT`, `mappings.local_updated TEXT`. Also add them to the `CREATE TABLE` text so fresh DBs match. Update `rowToQuest`/`rowToChange`/`rowToDeadline`/`rowToMapping`.

- [ ] **Step 4: Run** `npm test` — Expected: all tests PASS (existing tests may need `updatedAt`/new fields ignored; fix those with `deepEqual` on picked fields, not by loosening db.js).

- [ ] **Step 5: Commit** `feat(db): v5 schema for two-way Google sync`.

---

### Task 2: Multi-day one-time quests

**Files:**
- Modify: `src/schedule.js`, `src/validate.js`, `src/xp.js`
- Test: `test/schedule.test.js`, `test/validate.test.js`, `test/xp.test.js`

**Interfaces:**
- Consumes: quest `endDate` on `repeat 'once'` (Task 1).
- Produces: `expandDay` returns one occurrence per day for a multi-day once quest, key `q<id>@<date>`, with `start`/`end` sliced like `limitedSliceOn` (first day from `start` to `'24:00'`, middle days `'00:00'`–`'24:00'`, last day `'00:00'` to `end`), extra fields `isFirstDay`, `isLastDay`. It **never** cancels anything. `occurrenceDates(world, quest)` returns every date it touches.

- [ ] **Step 1: Write the failing tests:**
  - schedule: `an overnight once quest shows on both days and cancels nothing` — world from `makeWorld()` plus `quest({ id: 40, kind: 'side', repeat: 'once', name: 'Concert', date: '2026-11-30', endDate: '2026-12-01', start: '20:00', end: '02:00' })`. `expandDay(world, '2026-11-30')` has a Concert occurrence `20:00–24:00` and Potion Brewing 101 still `status 'active'`; `expandDay(world, '2026-12-01')` has Concert `00:00–02:00`; `occurrenceDates` → `['2026-11-30', '2026-12-01']`.
  - schedule: `a multi-day once quest clashes like any quest` — Concert `2026-11-30 09:00` to `2026-12-01 10:00`; on 11-30 its occurrence's `clashKeys` contains `'q2@2026-11-30'` (Rune Geometry 09:40).
  - schedule: `endDate equal to date behaves as a normal once quest`.
  - validate: `once quest over two dates may end earlier in the day than it starts` — `{kind:'side', repeat:'once', name:'x', date:'2026-11-30', endDate:'2026-12-01', start:'20:00', end:'02:00'}` → `[]`; with `endDate < date` → `['The quest must end after it starts']`.
  - validate: `an imported quest cannot become weekly or limited` — `{...validOnce, origin:'google', repeat:'weekly'}` → contains `'A quest from Google stays a one-time quest'`; same for `kind:'limited'`.
  - xp: `a multi-day main once quest earns XP once, on its last day`.

- [ ] **Step 2: Run** `node --test test/schedule.test.js test/validate.test.js test/xp.test.js` — Expected: new tests FAIL.

- [ ] **Step 3: Implement.** In `schedule.js` give `onceOccurrences` a slice helper (reuse `limitedSliceOn` logic via a shared `sliceOn(startDate, start, endDate, end, date)`); `endDate` null or equal to `date` keeps today's behaviour exactly. In `validate.js`, when `repeat === 'once'` and `endDate` is set and differs from `date`, replace `checkSameDayTimes` with the `compareSlot` check and the message `'The quest must end after it starts'`; add the origin check before kind checks. In `xp.js` skip occurrences where `isLastDay === false`.

- [ ] **Step 4: Run** `npm test` — Expected: PASS.

- [ ] **Step 5: Commit** `feat: multi-day one-time quests that never cancel anything`.

---

### Task 3: Event times and title cleaning

**Files:**
- Create: `src/google/event-time.js`
- Test: `test/event-time.test.js`

**Interfaces:**
- Produces:
  - `eventToSlot(ev) → { date, start, endDate, end, allDay }` — `endDate` is `null` when the event starts and ends on the same Jakarta date. Timed events: convert `dateTime` (any offset) to Jakarta. All-day (`start.date`/`end.date`, end exclusive): `start '00:00'`, `end '23:59'`, `endDate` = last day or `null` for one day.
  - `slotToEventTimes(slot) → { start, end }` — all-day → `{ date }` objects with exclusive end; else `{ dateTime: 'YYYY-MM-DDTHH:MM:00', timeZone: 'Asia/Jakarta' }`.
  - `cleanTitle(summary)` — removes a leading `'⚠ '`.
  - `cleanBountyTitle(summary)` — `cleanTitle`, then a leading `'📜 '` and a trailing `/ \(due \d{2}\.\d{2}\)$/`.
  - `cleanNote(description)` — removes a leading `⚠ Clashes with: …` paragraph and the blank line after it; `''`/missing → `null`.
  - `jakartaToday(now: Date) → 'YYYY-MM-DD'`.

- [ ] **Step 1: Write the failing tests** — one per function, including: `'2026-11-30T13:00:00Z'` → date `'2026-11-30'`, start `'20:00'`; event `20:00 → next day 02:00` Jakarta → `endDate '2026-12-01'`; all-day one day `{date:'2026-12-03'}`→`{date:'2026-12-04'}` gives `allDay true, endDate null`; three-day all-day gives `endDate` = third day; round trip `slotToEventTimes(eventToSlot(ev))` equals the original times for timed and all-day; `cleanBountyTitle('⚠ 📜 Essay (due 23.59)') === 'Essay'`; `cleanNote('⚠ Clashes with: A (07.00–09.30)\n\nroom 3') === 'room 3'`; `cleanNote('⚠ Clashes with: A (07.00–09.30)') === null`.

- [ ] **Step 2: Run** `node --test test/event-time.test.js` — FAIL (module missing).

- [ ] **Step 3: Implement** with `Intl.DateTimeFormat` the way `jakartaStamp` in `push.js` does (move that helper here and import it back).

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** `feat(google): event time conversion and title cleaning`.

---

### Task 4: API and payloads

**Files:**
- Modify: `src/google/api.js`, `src/google/payloads.js`
- Test: `test/api.test.js`, `test/payloads.test.js`

**Interfaces:**
- Consumes: `slotToEventTimes` (Task 3); quest `origin`, `endDate`, `allDay` (Task 1).
- Produces (api):
  - A normalized event: `{ id, status, updated, summary, description, start, end, recurrence, recurringEventId, originalStartTime, localKey, organizerSelf, declined }` — `localKey` from `extendedProperties.private.localKey` (or `null`), `organizerSelf` from `organizer.self` (default `true` when missing), `declined` true when the `attendees` entry with `self: true` has `responseStatus 'declined'`.
  - `listEvents(calId) → Event[]` (all fields above, `showDeleted: true`).
  - `listMainEvents(timeMinIso) → Event[]` — `calendarId 'primary'`, `showDeleted: true`, `singleEvents: false`, `timeMin`, paged.
  - `getEvent(calId, id) → Event` (404/410 thrown as today).
  - `insertEvent(calId, body) → { id, updated }`, `updateEvent(calId, id, body) → { updated }`, `patchEvent(calId, id, body) → { updated }`.
- Produces (payloads):
  - Every ⚔ body gets `extendedProperties: { private: { localKey } }`.
  - `buildDesiredEvents` skips quests with `origin === 'google'`; `onceEvent` uses `quest.endDate || quest.date` for the end.
  - `buildMainBodies(world, today) → [{ localKey: 'quest:<id>', body: { summary, description, start, end } }]` for every `origin 'google'` quest that is not `googleLocked` and whose last day is `>= today`.

- [ ] **Step 1: Write the failing tests:** api — with a fake `calendarClient`, `listEvents` maps an item with `extendedProperties.private.localKey 'quest:3'`, organizer `{ self: false }` and a self attendee declined into the normalized shape; `insertEvent` returns `{ id, updated }`; `patchEvent` calls `events.patch` with only the given body. payloads — `every ⚔ body carries its localKey`; `imported quests are not in buildDesiredEvents`; `buildMainBodies leaves out locked and past quests and has no reminders`; `an all-day imported quest is written back as all-day`.

- [ ] **Step 2: Run** `node --test test/api.test.js test/payloads.test.js` — FAIL.

- [ ] **Step 3: Implement.** `updateEvent` keeps forcing `status: 'confirmed'` (⚔ only). Use `fields` on list calls to include the new properties.

- [ ] **Step 4: Run** `npm test` — PASS after updating `test/push.test.js`'s `fakeApi` to return `{ id, updated }` / `{ updated }` (give it a counter-based `updated` like `'2026-11-26T00:00:0' + n + 'Z'`).

- [ ] **Step 5: Commit** `feat(google): full event fields, main calendar calls, localKey on events`.

---

### Task 5: Pull planner — the ⚔ calendar

**Files:**
- Create: `src/google/pull.js`
- Test: `test/pull.test.js`

**Interfaces:**
- Consumes: normalized events (Task 4), mappings (Task 1), `eventToSlot`/`clean*` (Task 3).
- Produces: `planPull({ appEvents, mainEvents, mappings, world, deadlines, hidden, today }) → { actions, lookups }` where `mainEvents` is `null` when the main calendar is off (Task 6 fills in the main part; `lookups` is `[]` in this task). Each action is one of:

  ```js
  { type: 'updateQuest', localKey, id, fields, googleUpdated }      // fields ⊆ name, note, date, endDate, start, end, startDate, allDay
  { type: 'deleteQuest', localKey, id }
  { type: 'createQuest', quest, calendar, googleId, googleUpdated } // quest has no id
  { type: 'setChange', localKey, change, googleUpdated }           // localKey 'makeup:<id>' or null for a new skip/move
  { type: 'updateDeadline', localKey, id, fields, googleUpdated }  // fields ⊆ name, note, dueDate, dueTime
  { type: 'deleteDeadline', localKey, id }
  { type: 'resend', localKey, googleUpdated }                      // Google's edit is reset: clear mapping hash
  { type: 'rebuildSeries', localKey, googleId }                    // delete the Google series + mapping; push re-creates it
  { type: 'forget', localKey }                                     // event gone in Google, app wants it back: drop mapping
  { type: 'adopt', localKey, googleId, googleUpdated }             // a lost insert: link it
  { type: 'deleteEvent', calendar, googleId }                      // a duplicate lost insert
  { type: 'stamp', localKey, googleUpdated }                       // only record Google's stamp
  ```
  `isDeletion(action)` is exported: true for `deleteQuest`, `deleteDeadline`, and a `setChange` that turns a make-up into a skip.

Rules (for `calendar 'app'` mappings, frozen ones skipped entirely):
- *Google changed* = `ev.updated !== mapping.googleUpdated`; *app changed* = the item's `updatedAt !== mapping.localUpdated` (for weekly quests, also any of its changes). `mapping.googleUpdated === null` → `stamp` only.
- Both changed → newer ISO string wins; app wins → `resend`.
- Missing or `status 'cancelled'` event: weekly → `forget`; once/limited quest → `deleteQuest`; make-up → `setChange` to `skip`; deadline → `deleteDeadline`.
- Weekly series: exceptions (`recurringEventId === mapping.googleId`, passing today's `isChangeMadeInGoogle`) → one `setChange` each (cancelled → skip; else move with `eventToSlot` values; a move to the same date/start/end is ignored), then one `rebuildSeries`. Any other Google change to a series → `resend`.
- Once quest whose new slot spans dates → `resend` (stays as is); all-day → `00:00–23:59`.
- Bounty: due date/time = slot's `endDate || date` / `end`; title via `cleanBountyTitle`.
- Unmapped ⚔ events, not cancelled: recurring or an exception → ignore; `localKey` set with no mapping for it → `adopt`; `localKey` set but that key is already mapped to another id → `deleteEvent`; no `localKey` → `createQuest` `{ kind: 'side', repeat: 'once', origin: null, ...slot, name: cleanTitle, note: cleanNote }` with `calendar 'app'`.

- [ ] **Step 1: Write the failing tests** — one per row of the spec's ⚔ table plus: `baseline mappings only get stamped`, `newest edit wins (app newer → resend, Google newer → update)`, `frozen mappings are ignored`, `hand-made event without localKey becomes a side quest`, `event with a known localKey is a duplicate and is deleted`, `event with an unmapped localKey is adopted`, `a recurring hand-made event is left alone`, `isDeletion counts make-up→skip`. Build events with a small `ev({...})` helper in the test file; use `makeWorld()`, `moveCalc`, `seminar` fixtures.

- [ ] **Step 2: Run** `node --test test/pull.test.js` — FAIL.

- [ ] **Step 3: Implement** `planPull` and `isDeletion` (pure: no store, no API, no clock — `today` is passed in).

- [ ] **Step 4: Run** — PASS.

- [ ] **Step 5: Commit** `feat(google): plan what ⚔ calendar changes mean for the app`.

---

### Task 6: Pull planner — the main calendar

**Files:**
- Modify: `src/google/pull.js`
- Test: `test/pull.test.js`

**Interfaces:**
- Produces: the same action types with `calendar 'main'`; `lookups: [{ localKey, googleId }]` for mapped upcoming imported quests whose event is not in `mainEvents`. `planPull` accepts an optional `lookedUp: Map<googleId, Event|null>` (null = gone) and, when given, resolves those into actions.

Rules (only when `mainEvents !== null`):
- Skip events with `recurrence` or `recurringEventId`, and ids in `hidden`.
- Unmapped, not cancelled, not declined → `createQuest` `{ kind: 'side', repeat: 'once', origin: 'google', googleLocked: !ev.organizerSelf, name: ev.summary || '(no title)', note: ev.description || null, ...eventToSlot(ev) }` with `calendar 'main'`.
- Mapped, `status 'cancelled'` or `declined` → `deleteQuest`.
- Mapped, changed → same newest-wins rule as Task 5; Google wins → `updateQuest` with the slot fields (multi-day allowed), raw `summary`/`description` (no cleaning on main).
- Mapped quest whose last day is before `today` → nothing (history).
- Mapped upcoming quest missing from the list → `lookups`; resolved via `lookedUp`: `null` → `deleteQuest`, event → treated as a listed event.

- [ ] **Step 1: Write the failing tests:** `upcoming main events are imported as side quests`, `invitations are imported locked`, `declined and repeating events are skipped`, `hidden events are skipped`, `a cancelled main event deletes the quest`, `app newer than Google keeps the app's version (resend)`, `ended imported quests are left alone`, `missing upcoming main event is looked up, not assumed deleted`, `mainEvents null means the main calendar is not touched`.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** `npm test` — PASS.

- [ ] **Step 5: Commit** `feat(google): plan main calendar imports and changes`.

---

### Task 7: runSync

**Files:**
- Create: `src/google/sync.js`
- Modify: `src/google/push.js` (export `planPush`, `applyPlan`, `ensureCalendar`, `isGone`; remove `reconcileWithGoogle` and `runPush`)
- Rename/replace: `test/push.test.js` keeps the `planPush` tests; new `test/sync.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `runSync({ api, store, now = new Date(), allowManyDeletes = false }) → { ok, error, authExpired, counts: { created, updated, deleted, pulled }, heldDeletes }` and writes `settings.lastPush = { at, ok, error, authExpired, heldDeletes }` (keep the key name `lastPush` so the UI code paths survive).

Order inside `runSync`:
1. `ensureCalendar` (unchanged: a re-created ⚔ clears mappings, so nothing reads as deleted).
2. `appEvents = api.listEvents(calId)`; if `settings.googleMainSync` and `api.listMainEvents` exists: `mainEvents = api.listMainEvents(<today 00:00 Jakarta as ISO>)`, then `getEvent('primary', id)` for each lookup (404/410 → `null`). Any other error → return failure, store untouched.
3. `planPull(...)`. If more than 5 actions satisfy `isDeletion` and not `allowManyDeletes` → drop those actions and set `heldDeletes` to their count.
4. Apply actions to the store in one pass. After each app write, store the mapping with `googleUpdated` from the action and `localUpdated` = the item's fresh `updatedAt` (via `getQuest`/`getDeadline`/`getChange`). `createQuest` also `upsertMapping` with `hash: null`. `resend` sets `hash: null`. `rebuildSeries`/`deleteEvent` call `api.deleteEvent` (ignore gone).
5. ⚔ push: `buildDesiredEvents` → `planPush` over `calendar 'app'` mappings → `applyPlan`, which now saves `googleUpdated` from each write's result and `localUpdated` from the item.
6. Main push (only when enabled): `buildMainBodies` vs `calendar 'main'` mappings by hash → `patchEvent('primary', …)`; mapping whose quest no longer exists → if its googleId is hidden just drop the mapping, else `deleteEvent('primary', id)` and drop it.

- [ ] **Step 1: Write the failing tests** in `test/sync.test.js` (reuse/extend the `fakeApi` from `push.test.js`, moved to `test/fake-google.js`, with a `primary` calendar, `listMainEvents`, `getEvent`, `patchEvent`, and an `updated` counter):
  - `first sync of a fresh store pushes everything (as before)`.
  - `a second sync right after a push changes nothing` — zero API writes, zero store writes.
  - `moving one week in Google creates a make-up and rebuilds the series`.
  - `a phone event in the main calendar becomes a quest and is not copied into ⚔`.
  - `editing an imported quest in the app patches only summary/description/start/end`.
  - `deleting an imported quest in the app deletes it in Google; a locked one is only hidden`.
  - `six deletions from Google are held; allowManyDeletes applies them`.
  - `a failing list call leaves the store untouched` — snapshot `getWorld()`/`listDeadlines()`/`listMappings()` before and after.
  - `main sync off: the primary calendar is never called`.

- [ ] **Step 2: Run** `node --test test/sync.test.js` — FAIL.

- [ ] **Step 3: Implement** `sync.js`; trim `push.js`.

- [ ] **Step 4: Run** `npm test` — PASS.

- [ ] **Step 5: Commit** `feat(google): two-way sync run (pull, then push)`.

---

### Task 8: Sign-in scopes and main-process wiring

**Files:**
- Modify: `src/google/auth.js`, `main.js`, `src/db.js` (`DEFAULT_SETTINGS.googleMainSync = false`)
- Test: `test/auth.test.js`

**Interfaces:**
- Produces:
  - `SCOPES = { app: '…/calendar.app.created', events: '…/calendar.events' }` exported; `connect({ openExternal, wide })` asks for `[app]` or `[app, events]`; `include_granted_scopes: true`.
  - `hasWideScope() → boolean` — the saved tokens' `scope` string contains the events scope.
  - main.js: `pushOnce` calls `runSync({ api, store, allowManyDeletes })`; the `pushNow` handler sets `allowManyDeletes` for that one run when `lastPush.heldDeletes` is set and `lastPush.at` is under 10 minutes old. When `googleMainSync` is on but `hasWideScope()` is false, `runSync` gets a store view with `googleMainSync` treated as off and `lastPush.error` reads `'Reconnect Google to allow your main calendar'` (status stays ok for ⚔).
  - `getPushStatus` also returns `mainSync`, `needsWideScope`, `heldDeletes`.
  - New IPC `setMainSync(on)`: saves the setting; when turning on without the wide scope, runs `auth.connect({ wide: true })` (same flow as `googleConnect`). Turning off keeps quests and mappings (sync simply stops reading `primary`).

- [ ] **Step 1: Write the failing tests:** `connect asks for the events scope only when wide` (inspect the generated auth URL as the existing auth tests do), `hasWideScope reads the saved tokens`.
- [ ] **Step 2: Run** `node --test test/auth.test.js` — FAIL.
- [ ] **Step 3: Implement** auth changes, then main.js / preload wiring (expose `setMainSync` in `preload.js`, add a stub in `googleStubs` in `src/ipc.js`).
- [ ] **Step 4: Run** `npm test` and `node --check main.js preload.js` — PASS.
- [ ] **Step 5: Commit** `feat(google): wider permission for the main calendar, sync wiring`.

---

### Task 9: Screens

**Files:**
- Modify: `ui/forms.js`, `ui/app.js`, `ui/style.css`, `src/ipc.js` (pass `origin`, `googleLocked`, `endDate` through the occurrence/quest data the window gets, if not already)

**Interfaces:**
- Consumes: `getPushStatus()` fields and `setMainSync(on)` (Task 8); quest `origin`/`googleLocked`/`endDate`/`allDay`.

What to build:
- Settings: section title `'Google Calendar sync'`; checkbox `'Two-way with my main Google calendar'` with hint `'Reads and edits events in your main calendar. Asks Google for permission again.'`; button `'Sync now'` (was "Push now"); status text uses "synced" instead of "pushed"; when `needsWideScope` → `'⚠ Reconnect Google to allow your main calendar.'` with the Reconnect button; when `heldDeletes` → `` `⚠ Google says ${n} events were deleted. Nothing removed — check Google, then click Sync now to confirm.` ``.
- Week view: `blockTag` returns `'📅'` prefix tag for `origin 'google'` (combined with existing tags, e.g. `'📅 ↪ make-up'` is impossible, so simply `'📅'` when no other tag); `blockTitle` adds a line `'From your Google calendar'`.
- Quest form for `origin 'google'`: hide the "Limited event" type and the "Repeats" row; show an extra `'Until'` date input (prefilled `quest.endDate || quest.date`, sent as `endDate`, `null` when equal to the date); when `googleLocked`, disable name/date/until/time inputs and show hint `'Organised by someone else: change it in Google.'`. Delete confirmation for imported quests adds `'It is also deleted from your Google Calendar.'` (locked: `'It stays in your Google Calendar.'`).

- [ ] **Step 1: Implement** the above.
- [ ] **Step 2: Run** `node --check ui/*.js` and `npm test` — PASS.
- [ ] **Step 3: Smoke run** with a scratch profile: `node scripts/seed-dev.js <scratchpad>/profile/dev.sqlite`, then `DUNGEON_DEV=1 DUNGEON_SMOKE=1 DUNGEON_SHOT=<scratchpad>/shot.png npx electron . --user-data-dir=<scratchpad>/profile` after inserting one `origin 'google'` quest into the seed DB; check the screenshot shows the 📅 tag and the Settings text.
- [ ] **Step 4: Commit** `feat(ui): sync settings, 📅 tag and imported-quest form`.

---

### Task 10: Docs

**Files:**
- Modify: `docs/google-setup.md`, `README.md`

- [ ] **Step 1:** In `docs/google-setup.md`, add the `calendar.events` scope to the consent-screen scope list (marked "only needed for the main-calendar checkbox"), and a short "Two-way sync" section: what syncs, the 5-deletion guard, that imported quests never go into ⚔. In `README.md`, change "one-way push" wording to "two-way sync".
- [ ] **Step 2:** `npm test` — PASS.
- [ ] **Step 3: Commit** `docs: two-way Google sync setup`.
