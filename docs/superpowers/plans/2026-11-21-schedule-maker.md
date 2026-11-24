# Dungeon Planner: Schedule Maker (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Fedora desktop app (Electron, plain JS) with a pixel-dungeon look that shows a student's weekly timetable plus one-off quests and multi-day limited events. It handles clashes, skips, moves and breaks, sends desktop reminders, and pushes one-way to a Google calendar.

**Architecture:** All schedule rules live in pure, Node-testable modules under `src/` that take a plain `World` object and return plain data. `src/db.js` loads and saves the `World` in SQLite. The Electron main process (`main.js`) wires the database, reminders and Google push together and exposes one API to the vanilla-JS UI in `ui/` through `preload.js`.

**Tech Stack:** Electron (current stable), plain JavaScript (CommonJS), HTML/CSS, `node:sqlite` (`DatabaseSync`), `node:test` + `node:assert/strict` for tests (no test framework install), `google-auth-library` + `@googleapis/calendar`.

**Spec:** `docs/superpowers/specs/2026-11-21-schedule-maker-design.md`

## Global Constraints

- Fedora 45 (GNOME) only. No Windows/macOS code paths.
- Plain JavaScript, CommonJS (`require`), **no TypeScript, no front-end framework**, no bundler.
- Comments explain *why*, in plain English, for a beginner reader. Prefer small named functions over clever one-liners.
- Internal formats: dates are `'YYYY-MM-DD'` strings, times are zero-padded 24-hour `'HH:MM'` strings, weekdays are `1` = Mon … `7` = Sun. Times are **displayed** as `HH.MM` (e.g. `07.00`).
- Time zone `Asia/Jakarta` (UTC+7, no DST). Pure modules never call `new Date()` for "now"; callers pass `now = { date, time }` from the local clock.
- All data in one SQLite file at `app.getPath('userData')/dungeon.sqlite`. The app works fully offline.
- Google: one-way push only, to a secondary calendar named exactly `⚔ Dungeon`, scope `https://www.googleapis.com/auth/calendar.app.created`. Never read or write other calendars.
- Notification lead time default **15** minutes; boss/limited evening-before reminder at **20:00**.
- Fonts, sprites and icons are bundled in `ui/assets/` (no CDN), with licenses that allow personal use.
- Run tests with `npm test` (= `node --test test/`). Node ≥ 22.13, so `node:sqlite` needs no flag.

## Review Focus

1. **Semester starts mid-week.** A Monday class in a semester starting Wednesday 26 Aug must first occur Mon 31 Aug, both in the app and as Google's `DTSTART`. Otherwise Google invents an extra occurrence on the start day. → Task 3 and Task 7 tests.
2. **App opened late or laptop wakes from sleep inside a reminder window.** The expected reminder fires once, immediately ("starts in 6 min"). No burst of stale reminders for things already started or past. → Task 6 test.
3. **Editing a weekly quest's weekday or time when it has skips or moves.** Changes whose `originalDate` no longer falls on the quest's weekday are deleted with the edit instead of lingering as invisible ghosts. → Task 5 test.
4. **Event deleted in Google, or the `⚔ Dungeon` calendar deleted.** The next push recreates it instead of failing forever. → Task 8 test.
5. **Limited event ending at exactly 00:00.** An olympiad Thu 09:00 → Sun 00:00 cancels Thu–Sat only, not Sunday's quests. → Task 3 test.

---

## Shared data shapes (referenced by every task)

```js
// Semester
{ id, name, startDate, endDate, active }            // active: 1 or 0

// Quest
{ id, kind,              // 'main' | 'side' | 'limited'
  repeat,                // 'weekly' | 'once' | null (null for limited)
  name, color, icon, note,
  weekday,               // 1..7, weekly only
  date,                  // once only
  start, end,            // 'HH:MM'; for limited: start time on startDate, end time on endDate
  startDate, endDate,    // limited only
  semesterId }           // weekly only

// Change (one occurrence of a weekly quest)
{ id, questId, originalDate, action,   // 'skip' | 'move'
  newDate, newStart, newEnd }          // move only

// Break
{ id, name, startDate, endDate, semesterId }   // inclusive dates

// World: everything the pure modules need
{ semester, quests, changes, breaks }

// Occurrence: one quest on one date, produced by expandDay
{ key,            // 'q<questId>@<date>' or 'makeup:<changeId>'
  questId, changeId,                    // changeId only for make-ups
  kind, repeat, name, color, icon, note,
  date, start, end,                     // limited: clipped to that day ('00:00'..'24:00')
  status,         // 'active' | 'skipped' | 'moved' | 'break' | 'cancelled'
  isBoss,         // kind==='main' && repeat==='once'
  isMakeup,
  movedTo,        // {date,start,end} when status==='moved', else null
  movedFrom,      // originalDate for make-ups, else null
  cancelledBy,    // limited event name when status==='cancelled', else null
  isFirstDay,     // limited only: true on startDate
  clashKeys }     // keys of other ACTIVE occurrences it overlaps
```

## File map

```
package.json                 scripts: start, test, install-desktop
main.js                      Electron main: window, tray, wiring           (Task 9, 12, 13)
preload.js                   exposes window.dungeon API                    (Task 9)
src/time.js                  date/time helpers                             (Task 1)
src/validate.js              form validation                               (Task 2)
src/schedule.js              expandDay / expandRange / floor / cleared     (Task 3)
src/draft.js                 checkDraft / checkMove (warnings)             (Task 4)
src/layout.js                side-by-side clash columns                    (Task 4)
src/db.js                    SQLite store                                  (Task 5)
src/notify-plan.js           which reminders to fire                       (Task 6)
src/google/payloads.js       desired Google events                         (Task 7)
src/google/push.js           diff + run push                               (Task 8)
src/google/api.js            real Calendar API adapter                     (Task 13)
src/google/auth.js           OAuth loopback login + token storage          (Task 13)
src/ipc.js                   IPC handlers                                  (Task 9)
src/notifier.js              Electron notifications scheduler              (Task 12)
ui/index.html, ui/style.css, ui/app.js, ui/forms.js, ui/assets/  (Tasks 10, 11)
scripts/install-desktop.js   writes ~/.local/share/applications launcher   (Task 12)
docs/google-setup.md         step-by-step Google setup for a new user           (Task 13)
README.md                    how to install, run, test                     (Task 9)
test/*.test.js               one file per src module
```

---

### Task 1: Project skeleton + time helpers

**Files:**
- Create: `package.json`, `.gitignore` (`node_modules/`, `*.sqlite`), `src/time.js`
- Test: `test/time.test.js`

**Interfaces:**
- Produces (`src/time.js`):
  `parseTime(str) -> 'HH:MM' | null`, `toMinutes('HH:MM') -> number` (`'24:00'` → 1440),
  `fromMinutes(n) -> 'HH:MM'`, `formatTime('HH:MM') -> 'HH.MM'`,
  `addDays(date, n) -> date`, `daysBetween(a, b) -> number` (b − a),
  `weekdayOf(date) -> 1..7`, `mondayOf(date) -> date`, `isoWeek(date) -> number`,
  `datesInRange(start, end) -> date[]` (inclusive; `[]` if end < start),
  `firstOnOrAfter(date, weekday) -> date`, `compareSlot(aDate, aTime, bDate, bTime) -> -1|0|1`.

- [ ] **Step 1:** `git init` (if not already a repo). Create `package.json`: `"name": "dungeon-planner"`, `"main": "main.js"`, `"scripts": { "test": "node --test test/", "start": "electron ." }`, `"engines": { "node": ">=22.13" }`. No dependencies yet.
- [ ] **Step 2: Write the failing tests** in `test/time.test.js`:
  - `parseTime accepts dot, colon and single-digit hour`: `'7.00'`, `'07.00'`, `'7:00'`, `'07:00'` → `'07:00'`; `'15.30'` → `'15:30'`; `'25:00'`, `'7.60'`, `''`, `'abc'` → `null`.
  - `toMinutes/fromMinutes round-trip`: `toMinutes('09:40') === 580`, `toMinutes('24:00') === 1440`, `fromMinutes(580) === '09:40'`.
  - `formatTime uses a dot`: `formatTime('07:00') === '07.00'`.
  - `weekdayOf is Monday-based`: `'2026-11-23'` → 1, `'2026-11-29'` → 7, `'2026-12-05'` → 6.
  - `date math`: `addDays('2026-11-30', 5) === '2026-12-05'`, `addDays('2026-12-31', 1) === '2027-01-01'`, `daysBetween('2026-08-24', '2026-11-23') === 91`, `mondayOf('2026-11-28') === '2026-11-23'`.
  - `isoWeek`: `'2026-11-21'` → 47, `'2026-11-23'` → 48, `'2026-01-01'` → 1, `'2026-12-31'` → 53.
  - `firstOnOrAfter`: `('2026-08-26', 1) === '2026-08-31'`, `('2026-08-24', 1) === '2026-08-24'`.
  - `datesInRange`: `('2026-11-26','2026-11-28')` → 3 dates; reversed → `[]`.
- [ ] **Step 3:** Run `npm test`. Expected: FAIL (`Cannot find module '../src/time'`).
- [ ] **Step 4:** Implement `src/time.js`. Do all date math with `Date.UTC(...)` and `getUTC*` so the machine's time zone can never shift a date.
- [ ] **Step 5:** Run `npm test`. Expected: all PASS.
- [ ] **Step 6:** Commit `feat: project skeleton and time helpers`.

---

### Task 2: Validation

**Files:** Create `src/validate.js`; Test `test/validate.test.js`

**Interfaces:**
- Consumes: `time.js`.
- Produces: `validateQuest(quest, world) -> string[]`, `validateMove(slot) -> string[]` (slot `{date,start,end}`), `validateBreak(brk, semester) -> string[]`, `validateSemester(sem) -> string[]`. Empty array = valid.

Rules (spec 7.2): name not blank; main/side need valid `start` < `end` on the same day; weekly needs `weekday` 1–7 and an active semester; once needs `date`; limited needs `startDate`+`start` strictly before `endDate`+`end`; break/semester need `startDate <= endDate`; a break must lie inside its semester.

- [ ] **Step 1: Write failing tests:**
  - `rejects end before or equal to start` → result includes exactly `'End time must be after start time (quests can\'t run past midnight)'` for `start '19:00', end '05:00'` and for `start '07:00', end '07:00'`.
  - `accepts the spec's seminar` `{kind:'side', repeat:'once', name:'Seminar', date:'2026-11-23', start:'05:00', end:'19:00'}` → `[]`.
  - `limited event may span days` `{kind:'limited', name:'Olympiad', startDate:'2026-11-26', start:'09:00', endDate:'2026-11-29', end:'00:00'}` → `[]`; with `endDate` before `startDate` → non-empty.
  - `weekly quest without active semester` → non-empty.
  - `break outside semester` → non-empty; `blank name` → non-empty.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement. Other message wording is the implementer's call (short, plain English).
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: quest, break and semester validation`.

---

### Task 3: Schedule engine (`expandDay`)

**Files:** Create `src/schedule.js`; Test `test/schedule.test.js` (+ `test/fixtures.js` holding the world below)

**Interfaces:**
- Consumes: `time.js`.
- Produces: `expandDay(world, date) -> Occurrence[]` (sorted by `start`, then `name`), `expandRange(world, startDate, endDate) -> { [date]: Occurrence[] }`, `occurrenceDates(world, quest) -> date[]` (every date a quest *originally* lands on: weekly → its weekday inside the semester; once → `[date]`; limited → days it touches), `isCleared(occ, now) -> boolean`, `floorNumber(semester, date) -> number | null`.

Fixture `world` (a sample student timetable; semester `{id:1, name:'Autumn 2026', startDate:'2026-08-24', endDate:'2026-12-18', active:1}`): the seven weekly **main** quests from spec section 1 with ids 1–7 in table order (1 = Potion Brewing 101, Mon 07:00–09:30; 2 = Rune Geometry, Mon 09:40–12:00; … 5 = Golem Mechanics, Wed 15:30–17:30; 6 = Archive Keeping, Thu 09:40–12:00; 7 = Spellcraft Lab Assistant, Fri 15:30–17:30). `changes: []`, `breaks: []`.

Algorithm for one date (spec 7.3, in this order):
1. Weekly quests whose weekday matches and date is inside the semester → `active`.
2. Changes with `originalDate === date`: `skip` → `skipped`; `move` → `moved` with `movedTo`. Changes with `newDate === date` add a make-up occurrence (`key 'makeup:<changeId>'`, `isMakeup: true`, `movedFrom`, the quest's kind/colour/icon, status `active`).
3. Breaks covering the date: weekly **main** occurrences still `active` → `break`. Make-ups, side quests and one-time quests are untouched.
4. One-time quests on that date → `active`.
5. Limited events touching the date (positive duration on that day; clip `start`/`end` to `'00:00'`/`'24:00'`) → `active`. Then every *non-limited* occurrence still `active` that day → `cancelled`, with `cancelledBy` = the event name (first one if several). Limited events never cancel each other; if two overlap they clash in step 6 (spec 7.4).
6. Fill `clashKeys` among `active` occurrences only: `toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end)`.

- [ ] **Step 1: Write failing tests** (dates from the spec):
  - `Monday has Potion Brewing then Rune Geometry, no clash`: `expandDay(world,'2026-11-23')` → names `['Potion Brewing 101','Rune Geometry']`, all `active`, all `clashKeys` empty (touching/gapped boundaries).
  - `Saturday is empty`: `'2026-11-28'` → `[]`.
  - `no classes outside the semester`: `'2026-12-21'` (Mon) → `[]`.
  - `forced seminar clashes with both Monday classes`: add once side quest id 10 Seminar 2026-11-23 05:00–19:00 → seminar's `clashKeys` has 2 entries; Potion Brewing 101's has `['q10@2026-11-23']`.
  - `exactly touching is not a clash`: once quest 08:00–09:30 vs a once quest 09:30–10:00 on the same day → both `clashKeys` empty.
  - `skip`: change `{id:1, questId:1, originalDate:'2026-11-30', action:'skip'}` → Potion Brewing on 2026-11-30 has status `skipped`, `clashKeys: []`.
  - `move to Saturday make-up`: change `{id:2, questId:1, originalDate:'2026-11-30', action:'move', newDate:'2026-12-05', newStart:'08:00', newEnd:'10:30'}` → on 11-30 Potion Brewing `moved` with `movedTo.date === '2026-12-05'`; on 12-05 one occurrence `key 'makeup:2'`, `isMakeup`, `movedFrom '2026-11-30'`, `active`, `isBoss: false`.
  - `break hides weekly main quests only`: break 2026-11-23..2026-11-27 + once side quest on 11-24 → Mon classes `break`; the side quest `active`.
  - `limited event cancels everything on its days, still listed`: limited id 20 Olympiad 2026-11-26 09:00 → 2026-11-28 18:00 → on Thu 11-26 Archive Keeping `cancelled`, `cancelledBy 'Olympiad'`; the olympiad occurrence `active`, `start '09:00'`, `end '24:00'`, `isFirstDay: true`; on Fri 11-27 it is `'00:00'`–`'24:00'`, `isFirstDay: false`, FP Assistance `cancelled`.
  - `two limited events clash instead of cancelling each other`: a second limited event 2026-11-27 08:00–12:00 → both `active` on 11-27, each in the other's `clashKeys`.
  - `limited event ending at 00:00 does not touch the next day` (Review Focus 5): Olympiad 2026-11-26 09:00 → 2026-11-29 00:00 → `expandDay(world,'2026-11-29')` contains no olympiad occurrence.
  - `one-time main quest is a boss`: once main Potion Brewing 101 Midterm 2026-12-09 13:00–15:00 → `isBoss: true`.
  - `semester starting mid-week` (Review Focus 1): semester start `'2026-08-26'` → `occurrenceDates(world, quest1)[0] === '2026-08-31'`.
  - `floorNumber`: `('2026-08-24') === 1`, `('2026-11-23') === 14`, `('2026-11-28') === 14`, `('2026-12-21') === null`.
  - `isCleared`: Potion Brewing on 11-23 with `now {date:'2026-11-23', time:'09:30'}` → `true`; `'09:29'` → `false`; any occurrence on 11-24 with that now → `false`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/schedule.js` following the algorithm above. `floorNumber` = `daysBetween(mondayOf(sem.startDate), mondayOf(date)) / 7 + 1`, or `null` when the date is outside the semester.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: schedule engine for weekly, one-time and limited quests`.

---

### Task 4: Warnings (`checkDraft`, `checkMove`) + clash layout

**Files:** Create `src/draft.js`, `src/layout.js`; Test `test/draft.test.js`, `test/layout.test.js`

**Interfaces:**
- Consumes: `expandDay`, `occurrenceDates` from Task 3.
- Produces:
  `checkDraft(world, draft, { editingId = null } = {}) -> { clashes: Occurrence[], cancelledBy: string[], wouldCancel: Occurrence[] }`;
  `checkMove(world, questId, originalDate, slot) -> same shape`;
  `layoutColumns(occurrences) -> { [key]: { col, cols } }`.

Approach: build a copy of the world with the draft inserted under id `'draft'` (replacing `editingId` if set), or with a temporary move change. Expand every date from `occurrenceDates` and collect:
- `clashes`: the occurrences listed in the draft's `clashKeys`, de-duplicated by key.
- `cancelledBy`: names of limited events that cancel the draft on any of its dates.
- `wouldCancel`: only for a limited draft; the occurrences that are `active` in the original world and `cancelled` in the new one.

The UI groups `clashes` by `questId` for display. `layoutColumns` greedily assigns overlapping **active** occurrences to columns: occurrences that clash share one slot side by side, and `cols` is the size of the overlapping group. Non-active occurrences get `{col:0, cols:1}`.

- [ ] **Step 1: Write failing tests:**
  - `seminar draft lists both Monday classes` (spec 7.4 dialog): `checkDraft(world, seminar)` → `clashes.map(o=>o.name)` deep-equals `['Potion Brewing 101','Rune Geometry']`.
  - `editing a quest doesn't clash with itself`: `checkDraft(world, {...quest1, start:'07:30'}, {editingId:1})` → `clashes` empty.
  - `weekly draft checks every week`: weekly Wed 09:00–11:00 → `clashes` contains Potion Lab Assistant occurrences (all with questId 4).
  - `limited draft previews what it cancels`: Olympiad 11-26 09:00 → 11-28 18:00 → `wouldCancel.map(o=>o.name)` deep-equals `['Archive Keeping','Spellcraft Lab Assistant']`.
  - `adding on a limited day warns`: with that olympiad saved, a once side quest on 11-27 → `cancelledBy` deep-equals `['Olympiad']`.
  - `move onto a busy slot clashes`: `checkMove(world, 1, '2026-11-30', {date:'2026-12-02', start:'15:00', end:'16:00'})` → clashes contains Golem Mechanics.
  - `layoutColumns`: Potion Brewing + Seminar on 11-23 → both `cols: 2`, with different `col`; a lone occurrence → `{col:0, cols:1}`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: clash and cancel warnings, side-by-side layout`.

---

### Task 5: SQLite store

**Files:** Create `src/db.js`; Test `test/db.test.js` (uses `':memory:'`)

**Interfaces:**
- Produces: `openStore(filePath) -> store` with:
  `getWorld() -> World` (active semester; its weekly quests; **all** once and limited quests; changes for those quests; breaks of the active semester),
  `getActiveSemester()`, `saveSemester(sem) -> id`, `startNewSemester({name,startDate,endDate}) -> id`,
  `saveQuest(quest) -> id` (insert when no `id`), `deleteQuest(id)`,
  `setChange(change) -> id` (upsert on `(questId, originalDate)`), `removeChange(questId, originalDate)`,
  `saveBreak(brk) -> id`, `deleteBreak(id)`,
  `getSettings() -> Settings`, `setSettings(partial)`,
  `listMappings()`, `upsertMapping({localKey, googleId, hash, frozen})`, `deleteMapping(localKey)`, `clearMappings({ includeFrozen = false })`,
  `close()`.
- Settings defaults: `{ leadMinutes: 15, desktopNotifications: true, launchOnLogin: true, googlePush: false, googleCalendarId: null, googleClientId: '', googleClientSecret: '', lastPush: null }`.

Use `const { DatabaseSync } = require('node:sqlite')` and only `exec`, `prepare(...).run/get/all`. That keeps a swap to `better-sqlite3` (same method names) a one-line change if Task 9 finds `node:sqlite` missing in Electron. Tables: `semesters`, `quests`, `changes` (UNIQUE quest_id, original_date; ON DELETE CASCADE), `breaks`, `settings(key PRIMARY KEY, value TEXT JSON)`, `mappings(local_key PRIMARY KEY, google_id, hash, frozen INTEGER DEFAULT 0)`. Create tables on open with `CREATE TABLE IF NOT EXISTS` and a `user_version` pragma for future migrations. Map snake_case columns to the camelCase shapes above.

- [ ] **Step 1: Write failing tests:**
  - `round-trips the fixture world`: insert semester + 7 quests → `getWorld()` deep-equals the Task 3 fixture (ids ignored or matched).
  - `setChange upserts`: skip then move for the same `(1,'2026-11-30')` → one change, action `move`.
  - `deleteQuest removes its changes`.
  - `editing a weekly quest's weekday drops changes that no longer fit` (Review Focus 3): quest 1 with skip on `'2026-11-30'`, `saveQuest({...q1, weekday: 2})` → `getWorld().changes` empty. Editing only `start` keeps the change.
  - `startNewSemester archives old weekly quests and freezes their mappings`: mapping `quest:1` exists → after `startNewSemester(...)`, `getWorld().quests` has no weekly quests, `listMappings()` shows `quest:1` with `frozen: 1`, and once quests are still present.
  - `settings defaults and partial update`: `getSettings().leadMinutes === 15`; `setSettings({leadMinutes:30})` keeps other defaults.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/db.js`. `saveQuest` deletes, in the same transaction, changes whose `originalDate` weekday ≠ the new weekday.
- [ ] **Step 4:** `npm test`. Expected: PASS (an `ExperimentalWarning` line is fine).
- [ ] **Step 5:** Commit `feat: SQLite store`.

---

### Task 6: Reminder planning

**Files:** Create `src/notify-plan.js`; Test `test/notify-plan.test.js`

**Interfaces:**
- Consumes: `expandRange`, `time.js`.
- Produces: `planReminders(world, now, settings, { horizonDays = 2 } = {}) -> Reminder[]`, where `Reminder = { id, fireAt: {date,time}, title, body }`, sorted by `fireAt`.

Rules (spec 7.7): only `active` occurrences; limited events only on `isFirstDay`.
- **Lead** reminder: `id '<key>:lead'`, `fireAt` = start − `leadMinutes`, title `` `⚔ ${name} starts in ${m} min (${formatTime(start)})` ``, where `m` = minutes from `fireAt` (or from `now` if later) to start. If it clashes, body `` `⚠ clashes with ${names joined ', '}` ``, else `''`.
- **Evening-before** reminder, for `isBoss` and limited events: `id '<key>:eve'`, `fireAt` = previous date 20:00, title `` `⚔ BOSS tomorrow: ${name}` `` or `` `⭐ Event tomorrow: ${name}` ``, body `` `${formatTime(start)}` ``. For limited events append `` ` · cancels ${n} quests` `` (n = cancelled occurrences across the event's days).
- **Window:** include a reminder when `fireAt >= now` (within horizon), **or** when it is overdue but still useful: a lead reminder with `fireAt < now < start` gets `fireAt = now`; an eve reminder with `now.date === fireAt.date` and `now >= 20:00` gets `fireAt = now`. Never include reminders for occurrences that already started.

- [ ] **Step 1: Write failing tests:**
  - `lead reminder 15 min before Golem Mechanics`: now Wed 2026-11-25 08:00 → contains `{id:'q5@2026-11-25:lead', fireAt:{date:'2026-11-25', time:'15:15'}, title:'⚔ Golem Mechanics starts in 15 min (15.30)'}`.
  - `late open fires once, immediately` (Review Focus 2): now 15:24 → that reminder has `fireAt.time '15:24'` and title `...starts in 6 min (15.30)`; now 15:31 → no reminder for it.
  - `skipped and cancelled get nothing`: skip DigSys on 11-25 → no `q5@2026-11-25` ids.
  - `boss gets an evening-before reminder`: midterm 2026-12-09 13:00, now 2026-12-08 10:00 → contains `{id:'q30@2026-12-09:eve', fireAt:{date:'2026-12-08', time:'20:00'}, title:'⚔ BOSS tomorrow: Potion Brewing 101 Midterm', body:'13.00'}`.
  - `limited event reminder mentions cancellations`: olympiad from Task 4 → eve body `'09.00 · cancels 2 quests'`; no lead reminders for its 11-27 occurrence.
  - `respects leadMinutes`: `leadMinutes 30` → DigSys fireAt `'15:00'`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: reminder planning`.

---

### Task 7: Google event payloads

**Files:** Create `src/google/payloads.js`; Test `test/payloads.test.js`

**Interfaces:**
- Consumes: `expandRange`, `occurrenceDates`, `time.js`.
- Produces: `TIMEZONE = 'Asia/Jakarta'`, `CALENDAR_NAME = '⚔ Dungeon'`, `buildDesiredEvents(world, settings) -> { localKey, body }[]`, `hashBody(body) -> string` (stable: sort object keys before `JSON.stringify`).

Rules (spec 7.8):
- **Weekly quest** → `localKey 'quest:<id>'`, `DTSTART` = first occurrence date (`firstOnOrAfter(semester.startDate, weekday)`). `recurrence` holds `` `RRULE:FREQ=WEEKLY;UNTIL=${YYYYMMDD(semester.endDate)}T165959Z` `` (23:59:59 WIB in UTC). When any dates are not `active`, it also holds `` `EXDATE;TZID=Asia/Jakarta:${dates.map(d => YYYYMMDD(d)+'T'+HHMM00(start)).join(',')}` ``. Never prefix ⚠.
- **Make-up** → `localKey 'makeup:<changeId>'`, summary `` `${name} (make-up)` ``.
- **One-time quest** → `'quest:<id>'`. Left out entirely when its occurrence is `cancelled`.
- **Limited event** → `'quest:<id>'`, one event from `startDate start` to `endDate end`.
- Non-recurring events that clash: summary prefixed `'⚠ '`. Description starts `` `⚠ Clashes with: ${list of "Name (HH.MM–HH.MM)" joined ', '}` ``, then the note.
- `start/end` are `{ dateTime: 'YYYY-MM-DDTHH:MM:00', timeZone: TIMEZONE }`. `reminders: { useDefault: false, overrides: [{method:'popup', minutes: leadMinutes}] }`. Boss and limited events add `{method:'popup', minutes: 240 + toMinutes(start)}` (20:00 the evening before).

- [ ] **Step 1: Write failing tests:**
  - `Potion Brewing 101 is one weekly series`: recurrence deep-equals `['RRULE:FREQ=WEEKLY;UNTIL=20261218T165959Z']`, start `{dateTime:'2026-08-24T07:00:00', timeZone:'Asia/Jakarta'}`, summary `'Potion Brewing 101'`.
  - `mid-week semester start` (Review Focus 1): semester start `'2026-08-26'` → Potion Brewing `start.dateTime` starts with `'2026-08-31'`.
  - `skip and move exclude the date and add a make-up`: Task 3's move change → Potion Brewing recurrence includes `'EXDATE;TZID=Asia/Jakarta:20261130T070000'`, plus an event `makeup:2` with summary `'Potion Brewing 101 (make-up)'` starting `'2026-12-05T08:00:00'`.
  - `seminar clash marks only the side quest`: seminar summary `'⚠ Seminar'`, description starts `'⚠ Clashes with: Potion Brewing 101 (07.00–09.30), Rune Geometry (09.40–12.00)'`; Potion Brewing summary has no ⚠.
  - `cancelled one-time quest is left out`; `limited event's cancelled dates excluded from DB Systems series`: EXDATE contains `20261126T094000`.
  - `boss reminders`: midterm 13:00 → overrides deep-equal `[{method:'popup',minutes:15},{method:'popup',minutes:1020}]`.
  - `hashBody is key-order independent`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: build Google event payloads`.

---

### Task 8: Push planner and runner

**Files:** Create `src/google/push.js`; Test `test/push.test.js` (with an in-memory fake API)

**Interfaces:**
- Consumes: `buildDesiredEvents`, `hashBody`, `CALENDAR_NAME`, `TIMEZONE`, store methods from Task 5.
- Produces:
  `planPush(desired, mappings) -> { creates: Desired[], updates: {desired, googleId}[], deletes: {localKey, googleId}[] }`. Frozen mappings are ignored entirely; unchanged hashes produce nothing.
  `runPush({ api, store }) -> Promise<{ ok: boolean, error?: string, counts }>`.
- The `api` interface (the real one comes in Task 13): `getCalendar(id) -> {id} | throws {code:404}`, `createCalendar({summary, timeZone}) -> id`, `insertEvent(calId, body) -> id`, `updateEvent(calId, eventId, body)`, `deleteEvent(calId, eventId)`. Errors carry a numeric `code`.

`runPush` steps:
1. Get or create the calendar. If the stored id 404s, create a new one, save it, and `clearMappings()` (non-frozen only).
2. Build the desired events from `store.getWorld()` and `store.getSettings()`, then plan.
3. Run deletes (ignore 404/410), updates (on 404/410 insert instead and save the new id), then creates. Save each mapping right after its call succeeds, so a failure halfway leaves a correct partial state that the next push finishes.
4. Save `lastPush = { at: ISO string, ok, error }` in settings.

- [ ] **Step 1: Write failing tests:**
  - `first push creates calendar and all events`: fake API → `createCalendar` called once with `{summary:'⚔ Dungeon', timeZone:'Asia/Jakarta'}`, 7 inserts, 7 mappings.
  - `second push with no changes does nothing` (no duplicates): 0 API event calls.
  - `edit → update, delete → delete`.
  - `event deleted in Google is recreated` (Review Focus 4): fake `updateEvent` throws `{code:404}` → `insertEvent` called and mapping updated to the new id.
  - `calendar deleted in Google`: `getCalendar` throws `{code:404}` → a new calendar, all 7 events re-inserted.
  - `failure keeps progress`: fake throws `{code:500}` on the 4th insert → `ok:false`, 3 mappings saved, `lastPush.ok === false`. A second run inserts the remaining 4.
  - `frozen mappings are never touched` after `startNewSemester`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: idempotent one-way Google push`.

---

### Task 9: Electron shell, IPC bridge, README

**Files:** Create `main.js`, `preload.js`, `src/ipc.js`, `ui/index.html` (placeholder), `README.md`; Modify `package.json` (devDependency `electron`).

**Interfaces:**
- Consumes: `openStore`, `expandRange`, `floorNumber`, `checkDraft`, `checkMove`, `layoutColumns`, `validate*`.
- Produces `window.dungeon` (each call is `ipcRenderer.invoke('dungeon:<name>', …)`; mutating calls return `{ ok: true, id }` or `{ ok: false, errors: string[] }` from validation):
  `getWeek(mondayDate) -> { days: {[date]: Occurrence[]}, layout: {[date]: layoutColumns}, week, floor, today: {date,time} }`,
  `getToday() -> Occurrence[]`,
  `checkDraft(draft, opts)`, `checkMove(questId, originalDate, slot)`,
  `saveQuest(q)`, `deleteQuest(id)`, `setChange(c)`, `removeChange(questId, originalDate)`,
  `listBreaks()`, `saveBreak(b)`, `deleteBreak(id)`,
  `getSemester()`, `saveSemester(s)`, `startNewSemester(s)`,
  `getSettings()`, `setSettings(partial)`,
  `googleConnect()`, `googleDisconnect()`, `pushNow()`, `getPushStatus()` (stubs returning `{ok:false, error:'not set up'}` until Task 13),
  `onDataChanged(callback)` (main sends `'dungeon:changed'` after every mutation).
- Also exported from `src/ipc.js`: `registerIpc(store, { onChange })`, where `onChange` is called after every successful mutation (Tasks 12 and 13 hook in here).

- [ ] **Step 1:** `npm install --save-dev electron`. Run `npx electron -e "require('node:sqlite'); console.log('sqlite ok')"` via `ELECTRON_RUN_AS_NODE=1`. Expected: `sqlite ok`. **If it fails:** `npm install better-sqlite3 @electron/rebuild`, add `"postinstall": "electron-rebuild"`, and change the one `require` in `src/db.js`. Keep tests on `node:sqlite` only if the API stays identical, otherwise run them with `ELECTRON_RUN_AS_NODE=1 npx electron --test test/`. Record the outcome in README.
- [ ] **Step 2:** Implement `main.js`: a single `BrowserWindow` (1200×800, `contextIsolation: true`, `nodeIntegration: false`, preload) loading `ui/index.html`; the store opened at `userData/dungeon.sqlite`; `registerIpc`. `now` comes from the local clock as `{date, time}`.
- [ ] **Step 3:** Implement `preload.js` with `contextBridge.exposeInMainWorld('dungeon', …)` exactly as listed.
- [ ] **Step 4:** Placeholder `ui/index.html` prints `JSON.stringify(await dungeon.getSemester())`.
- [ ] **Step 5:** Run `npm start`. Expected: the window opens and shows `null` (no semester yet) with no console errors. Run `npm test`: all still PASS.
- [ ] **Step 6:** Write `README.md`: requirements (Fedora, `sudo dnf install nodejs`), `npm install`, `npm start`, `npm test`, where data lives, and the sqlite outcome from Step 1.
- [ ] **Step 7:** Commit `feat: Electron shell and IPC bridge`.

---

### Task 10: Main screen + game skin

**Files:** Create `ui/style.css`, `ui/app.js`, `ui/assets/` (fonts, sprites, icons + `ui/assets/LICENSES.md`); Modify `ui/index.html`.

**Interfaces:** Consumes `window.dungeon.getWeek`, `getToday`, `onDataChanged`. Produces in `ui/app.js`: `renderWeek(weekData)`, `renderToday(occurrences)`, `openQuestMenu(occurrence)`. The last one is a hook Task 11 fills; until then it logs.

**REQUIRED SUB-SKILL:** use frontend-design for the look. Spec 7.1, 7.5 and 7.6 fix the vocabulary and these visual rules:
- Header `⚔ WEEK <isoWeek> · FLOOR <floor> ⚔` with ◀ prev / today / next ▶.
- A 7-column grid with a vertical time axis scaled to the week's earliest and latest occurrence (default 07:00–18:00 when empty).
- Main quests use their own colour and icon. Boss quests get a crown/skull frame. Side quests are gold with ◆. Limited events are a legendary-colour banner across their days.
- Clashes: placed with `layoutColumns`, red/hatched "cursed" border and a ⚠ tag, both readable.
- Skipped: faded ghost. Moved: ghost reading `moved → Sat 5 Dec` at the old slot, ↪ "make-up" tag at the new one. Cancelled: struck-through ghost with ✖. Break days: `🏕 CAMP: <name>` banner, break-status quests hidden.
- Cleared ✔ stamp on past occurrences. Times shown with `formatTime`.
- Today's Quests: time-ordered, faded skipped/cancelled, the next active one highlighted; `Rest at camp 🔥` when empty.
- Buttons: `+ New Quest`, `🏕 Breaks`, `⚙ Settings`. Readable at 1200×800; legibility beats decoration.

- [ ] **Step 1:** Temporarily seed data: a dev-only script `scripts/seed-dev.js` (not wired into the app) that writes the spec's timetable, the seminar, a skip, a move, a break and the olympiad into a separate `dev.sqlite`. `main.js` uses `dev.sqlite` when `DUNGEON_DEV=1`.
- [ ] **Step 2:** Implement the screen.
- [ ] **Step 3:** Run `DUNGEON_DEV=1 npm start`. Check visually: week of 2026-11-23 shows the seminar clash side by side with both classes; week of 2026-11-30 shows Potion Brewing moved and the make-up on Sat 5 Dec; the olympiad week shows a banner and ✖ ghosts. Take a screenshot into `docs/screenshots/week.png`.
- [ ] **Step 4:** Commit `feat: main screen and dungeon skin`.

---

### Task 11: Forms and dialogs

**Files:** Create `ui/forms.js`; Modify `ui/app.js`, `ui/index.html`, `ui/style.css`.

**Interfaces:** Consumes all `window.dungeon` mutation and check calls. Produces `openNewQuest(prefill?)`, `openEditQuest(quest)`, `openMoveForm(occurrence)`, `openBreaks()`, `openSettings()`, `openFirstLaunch()`, and the implementation of `openQuestMenu(occurrence)`.

Behaviour (spec 7.4, 7.5):
- **New/Edit Quest form:** type radio Main / Side / Limited event ⭐. For Main/Side: Repeats (Every week + weekday, or Once + date), start/end, colour/icon. For Limited: start date/time and end date/time. Then note. Time inputs accept `7.00` (via `parseTime`). Validation errors are shown inline.
- **On save:** call `checkDraft`.
  - `wouldCancel` non-empty → dialog `This will cancel N quests:` + list, buttons **[Retreat]** / **[Begin event ⭐]**.
  - Else `cancelledBy` non-empty → `That day is <name>; this quest will be shown as cancelled`, buttons **[Retreat]** / **[Add anyway]**.
  - Else `clashes` non-empty → `⚠ CLASH: "<name>" overlaps` + one line per clashing quest (group by `questId`: `Name  Mon 23 Nov 07.00–09.30`, plus ` (+N more weeks)` when grouped), buttons **[Retreat]** / **[Force it ⚔]**.
  - Only then `saveQuest`.
- **Quest menu (click a block):** Edit, Delete (confirm). For weekly occurrences also **Skip this date** and **Move this date**. On ghosts: **Restore** (skip) / **Undo move** (both = `removeChange`).
- **Move form:** shows the original slot and asks for the new date/start/end. Runs `checkMove` with the same clash dialog, then `setChange({action:'move', …})`.
- **Breaks panel:** list plus add/edit/delete (name, start, end).
- **Settings:** semester name/dates; **Start new semester** (confirm: "Archive this semester's timetable?"); lead minutes; desktop notifications toggle; launch-on-login toggle; Google section (buttons call stubs until Task 13).
- **First launch:** when `getSemester()` is `null`, show the semester form, then `openNewQuest` prefilled as weekly main.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Manual check against a fresh `dev.sqlite`, steps in `docs/manual-test.md` (write this file now):
  (a) first launch, enter the semester 2026-08-24 → 2026-12-18;
  (b) enter the 7 classes using `7.00`-style times;
  (c) add the seminar on Mon 23 Nov 05.00–19.00 → the clash dialog names both classes, Force it → side by side;
  (d) skip Potion Brewing on 30 Nov → ghost, Restore works;
  (e) move it to Sat 5 Dec 08.00–10.30 → ghost plus make-up, Undo move works;
  (f) add a limited Olympiad Thu 26 → Sat 28 Nov → preview lists 2 quests, both show ✖;
  (g) try `19.00`–`05.00` → midnight error.
  Expected: every step behaves as written.
- [ ] **Step 3:** Commit `feat: quest forms, warnings, breaks and settings`.

---

### Task 12: Desktop notifications, tray, launch on login

**Files:** Create `src/notifier.js`, `scripts/install-desktop.js`; Modify `main.js`, `package.json` (`"install-desktop": "node scripts/install-desktop.js"`).

**Interfaces:**
- Consumes `planReminders`, `store`, the `onChange` hook from Task 9.
- Produces `startNotifier({ store, notify, clock })` with methods `replan()` and `stop()`. Here `notify({title, body})` wraps Electron `Notification`, and `clock()` returns `{date, time}`. Fired ids are kept in a `Set` so `replan()` never repeats a reminder.

Behaviour (spec 7.7): replan on start, after every data change, on `powerMonitor` `'resume'`, and every 60 s. Each replan clears pending timers and schedules everything with `fireAt` within the next 24 h via `setTimeout`. A reminder whose `fireAt` is now fires right away. Nothing fires when `desktopNotifications` is off.
- **Tray:** `new Tray(icon)` with Open / Quit. Closing the window hides it. If tray creation fails or no StatusNotifier host is present, closing minimizes instead and the Settings hint reads `Install the "AppIndicator and KStatusNotifierItem Support" GNOME extension to get the top-bar icon.`
- **Launch on login:** when `launchOnLogin` is true, write `~/.config/autostart/dungeon-planner.desktop` (`Exec=` pointing to the app's launch command, plus `--hidden`); when false, delete it. Re-apply on settings change. `--hidden` starts the app straight to the tray or minimized.
- `scripts/install-desktop.js` writes `~/.local/share/applications/dungeon-planner.desktop` with `Exec=` = `npm --prefix <repo> start` and the app icon.

- [ ] **Step 1: Write failing test** `test/notifier.test.js` with a fake `notify`, a fake `clock`, and `node:test` mock timers (`mock.timers.enable({ apis: ['setTimeout','setInterval'] })`):
  - `fires Golem Mechanics at 15:15 once`: clock 15:14, advance 60 s → `notify` called once with title `'⚔ Golem Mechanics starts in 15 min (15.30)'`. `replan()` again → not called again.
  - `no notifications when disabled`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/notifier.js`, then the tray/autostart wiring in `main.js`.
- [ ] **Step 4:** `npm test`. Expected: PASS. Manual: add a once quest starting in 16 min → a GNOME notification arrives about 1 min later. Close the window → the app stays in the tray (or minimized). Toggle launch-on-login → the autostart file appears or disappears.
- [ ] **Step 5:** Commit `feat: desktop reminders, tray and launch on login`.

---

### Task 13: Google connect + push wiring + setup guide

**Files:** Create `src/google/auth.js`, `src/google/api.js`, `docs/google-setup.md`; Modify `main.js`, `src/ipc.js` (replace stubs), `ui/forms.js` (Google section), `package.json` (deps `google-auth-library`, `@googleapis/calendar`).

**Interfaces:**
- Consumes `runPush` (Task 8), store.
- Produces:
  `auth.connect({ clientId, clientSecret, openExternal }) -> Promise<void>`: loopback redirect on `http://127.0.0.1:<random free port>`, PKCE, scope from Global Constraints, `access_type: 'offline'`, `prompt: 'consent'`. Tokens are saved to `userData/google-tokens.bin`, encrypted with Electron `safeStorage` (plain JSON if `safeStorage.isEncryptionAvailable()` is false, with a log line).
  `auth.getClient() -> OAuth2Client | null` (saves refreshed tokens on the `'tokens'` event), `auth.disconnect()` (deletes the token file and keeps the Google calendar).
  `api.createApi(authClient)` returns the exact `api` interface from Task 8, mapping errors to `{ code }`.
- Push scheduling in `main.js`: if `googlePush` is on and a client exists, push on start, 2 s after the last change (debounced), and retry 5 min after a failure. `pushNow` pushes immediately. `getPushStatus` returns `settings.lastPush`.

- [ ] **Step 1:** Write `docs/google-setup.md` for a beginner, with numbered steps:
  1. Create a Google Cloud project.
  2. Enable the Google Calendar API.
  3. Set up the OAuth consent screen: External, their own email as test user, then **Publish app → In production**, with the reason that Testing tokens expire after 7 days.
  4. Create an OAuth client ID of type **Desktop app**.
  5. Paste the client ID and secret into ⚙ Settings → Google.
  6. Click Connect, and click through the "unverified app" warning (Advanced → Go to app).
  7. Expect the `⚔ Dungeon` calendar in Google Calendar on their phone. Turn on its notifications there.
- [ ] **Step 2:** Implement `auth.js`, `api.js`, and the wiring. Settings UI: client ID/secret fields, Connect/Disconnect, Push now, and status text (`last pushed HH.MM` / `push failed, will retry: <error>`).
- [ ] **Step 3:** `npm test`. Expected: all PASS (the Task 8 tests still cover the logic).
- [ ] **Step 4:** Manual, on the developer's laptop with their own account, following `docs/google-setup.md`:
  - Connect, then check the phone: `⚔ Dungeon` shows 7 weekly series, no event on a skipped date, `Potion Brewing 101 (make-up)` on Sat 5 Dec, and `⚠ Seminar`.
  - Push now twice → no duplicates.
  - Delete one event in Google, then make any change in the app → it comes back.
  - Turn Wi-Fi off, add a quest, turn Wi-Fi on → it appears within about 5 min.
- [ ] **Step 5:** Commit `feat: Google Calendar one-way push`.

---

### Task 14: Final pass

- [ ] **Step 1:** `npm test`. Expected: all PASS.
- [ ] **Step 2:** Run all of `docs/manual-test.md` (Task 11) on a fresh profile with the real timetable.
- [ ] **Step 3:** Check spec section 4 (anti-goals) item by item against the running app, and note the results in `docs/manual-test.md`.
- [ ] **Step 4:** `npm run install-desktop` → the app appears in GNOME's app grid.
- [ ] **Step 5:** Commit `chore: v1 verification`.
