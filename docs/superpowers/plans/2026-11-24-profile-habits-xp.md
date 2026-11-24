# Profile, Habits and XP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 🛡 Profile screen with Daily and Weekly quests (habits), a permanent XP log, levels and a pixel knight whose gear changes with level.

**Architecture:** Pure logic in two new modules, `src/habits.js` (streaks, weekly progress, the 7-day tick window) and `src/xp.js` (XP amounts, levels, gear, which cleared quests earn XP, stats). `src/xp-log.js` is the only place that writes the XP log: it joins the pure modules to the store. IPC exposes it to a new `ui/profile.js` screen, which the header tabs swap in for the week screen.

**Tech Stack:** Electron 45, Node 22 `node:sqlite`, `node --test`, plain CommonJS and DOM (no frameworks).

**Spec:** `docs/superpowers/specs/2026-11-24-profile-habits-xp-design.md`

## Global Constraints

- Plain CommonJS, no frameworks, "why" comments a beginner can follow (spec §8).
- New tables only. Existing databases must just gain them; data already stored must survive.
- Default XP: daily tick 5 · weekly won 25 · bounty on time 20 · bounty late 5 · main quest cleared 10 · boss cleared 30. Side quests and limited events: 0 (no row).
- Level L needs 25 × (L − 1) × (L + 2) XP in total (L2 = 100, L3 = 250, L4 = 450, L5 = 700, L6 = 1000).
- Gear: LV1 wooden sword, LV3 steel sword, LV5 cape, LV8 shield, LV12 crown.
- Tick window: today and the 6 days before, for both kinds. Never the future.
- Weekly target 1–7. Weeks run Monday–Sunday.
- XP keys: `habit:<habitId>@<date>`, `habitweek:<habitId>@<monday>`, `bounty:<deadlineId>`, `occ:<occurrence key>`.
- Nothing before the XP start date (saved the first time the feature runs) earns XP.
- No habit reminders, no Google push of habits, no change to reminders or push behaviour.
- Vocabulary: classes stay "main quest"; habits are "🌅 Daily quest" and "📅 Weekly quest".

## Review Focus

- **App closed for days, then opened:** every class cleared meanwhile is logged exactly once, and nothing before the XP start date is. Tested in Task 4 (`catch-up after the app was closed`).
- **Ticking and unticking repeatedly** (including toggling the tick that reaches a weekly target) leaves the total exactly where it started. Tested in Task 4 (`no farming`).
- **Crossing midnight or Monday:** the 7-day strip moves on. An unticked today doesn't break the daily streak. An unwon current week doesn't break the weekly streak. Tested in Task 1.
- **Deleting a habit, quest or bounty after earning from it** keeps the total. Tested in Task 4 (`earned stays earned`).
- **Opening an existing v2 database** (no `xp` columns, no new tables) keeps every quest and bounty, and gains the columns. Tested in Task 3 (`upgrades a version-2 database`).

---

### Task 1: Habit rules (`src/habits.js`)

**Files:**
- Create: `src/habits.js`
- Test: `test/habits.test.js`

**Interfaces:**
- Consumes: `addDays`, `mondayOf`, `daysBetween` from `src/time.js`.
- Produces (habit shape used everywhere): `{ id, name, kind: 'daily'|'weekly', createdDate: 'YYYY-MM-DD', xp: number|null, targets: [{ fromMonday, target }] (sorted by fromMonday), ticks: ['YYYY-MM-DD', ...] }`
  - `TICK_WINDOW_DAYS = 7`
  - `tickWindow(today) -> string[]` — the 7 dates, oldest first, ending today.
  - `canTick(date, today) -> boolean`
  - `targetForWeek(habit, monday) -> number` — target of the latest `targets` row with `fromMonday <= monday` (or the first row's target when all are later).
  - `weekProgress(habit, monday) -> { count, target, won }`
  - `dailyStreak(habit, today) -> { current, best }`
  - `weeklyStreak(habit, today) -> { current, best }`
  - `habitSummary(habit, today) -> { id, name, kind, strip: [{ date, ticked }], streak: { current, best }, week: { count, target, won } | null }` (`week` only for weekly habits).

- [ ] **Step 1: Write the failing tests** in `test/habits.test.js`, using today = `'2026-11-25'` (a Wednesday) and a helper `habit(fields)` that fills the shape above (`createdDate: '2026-11-01'`, `targets: [{ fromMonday: '2026-10-26', target: 3 }]`, `xp: null`, `ticks: []`):
  - `tick window is today and the 6 days before`: `tickWindow('2026-11-25')` equals `['2026-11-19', …, '2026-11-25']` (7 dates); `canTick('2026-11-19', today) === true`, `canTick('2026-11-18', today) === false`, `canTick('2026-11-26', today) === false`.
  - `daily streak: an unticked today doesn't break it`: ticks `['2026-11-22','2026-11-23','2026-11-24']` → `{ current: 3, best: 3 }`; add `'2026-11-25'` → `current: 4`.
  - `daily streak: a missed day resets it, best remembers`: ticks `['2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-23','2026-11-24']` → `{ current: 2, best: 4 }`; ticks ending `'2026-11-22'` only → `current: 0`.
  - `weekly progress and a target change from this week on`: kind weekly; targets `[{ fromMonday: '2026-10-26', target: 3 }, { fromMonday: '2026-11-23', target: 4 }]`; ticks `['2026-11-17','2026-11-18','2026-11-19','2026-11-23','2026-11-24']` → `weekProgress(h, '2026-11-16')` = `{ count: 3, target: 3, won: true }`, `weekProgress(h, '2026-11-23')` = `{ count: 2, target: 4, won: false }`.
  - `weekly streak: an unwon current week doesn't break it; weeks before creation aren't judged`: createdDate `'2026-11-04'`, target 3, three ticks in each of the weeks of 2 Nov, 9 Nov and 16 Nov, one tick this week → `{ current: 3, best: 3 }`; the week of 26 Oct (before creation) isn't counted. With the week of 9 Nov having only 2 ticks → `{ current: 1, best: 1 }`.
  - `summary`: daily habit → `strip` has 7 items with `ticked` flags matching the ticks, `week === null`; weekly habit → `week` equals `weekProgress(h, mondayOf(today))`.

- [ ] **Step 2: Run, expect failure**

Run: `node --test test/habits.test.js`
Expected: FAIL with `Cannot find module '../src/habits'`.

- [ ] **Step 3: Implement `src/habits.js`** with the signatures above. Streaks walk backwards: daily from today (or from yesterday when today isn't ticked), weekly from this Monday (or last Monday when this week isn't won), stopping at the first miss. Weekly judging never goes before `mondayOf(createdDate)`. `best` is the longest run over all judged days or weeks up to today.

- [ ] **Step 4: Run, expect pass**

Run: `node --test test/habits.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/habits.js test/habits.test.js
git commit -m "feat: habit rules (streaks, weekly targets, tick window)"
```

---

### Task 2: XP rules (`src/xp.js`)

**Files:**
- Create: `src/xp.js`
- Test: `test/xp.test.js`

**Interfaces:**
- Consumes: `expandRange`, `isCleared` from `src/schedule.js`; `weekProgress`, `mondayOf`-style helpers from Task 1 and `src/time.js`; `compareSlot`, `addDays`, `datesInRange` from `src/time.js`.
- Produces (XP row shape used by the log): `{ key, date, label, amount, kind: 'daily'|'weekly'|'bounty'|'main'|'boss' }`, plus `onTime: boolean` on bounty rows only
  - `DEFAULT_XP = { daily: 5, weekly: 25, bountyOnTime: 20, bountyLate: 5, main: 10, boss: 30 }`
  - `xpToReach(level) -> number`
  - `levelInfo(total) -> { level, total, intoLevel, needed }` (`needed` = XP between this level and the next)
  - `GEAR = [{ level: 1, item: 'wooden sword' }, { level: 3, item: 'steel sword' }, { level: 5, item: 'cape' }, { level: 8, item: 'shield' }, { level: 12, item: 'crown' }]`
  - `gearFor(level) -> { owned: string[], next: { level, item } | null }`
  - `clearedAwards(world, fromDate, now) -> row[]`
  - `bountyAward(deadline, now) -> row`
  - `dailyAward(habit, date) -> row`, `weeklyAward(habit, monday, date) -> row`
  - `periodStats(rows, deadlines, habits, fromDate, toDate, today) -> { main, boss, bountiesOnTime, bountiesDue, weeksWon, weeksJudged }`

- [ ] **Step 1: Write the failing tests** in `test/xp.test.js` (fixtures from `test/fixtures.js`):
  - `levels`: `xpToReach(1) === 0`, `xpToReach(2) === 100`, `xpToReach(3) === 250`, `xpToReach(5) === 700`; `levelInfo(320)` equals `{ level: 3, total: 320, intoLevel: 70, needed: 200 }`; `levelInfo(0).level === 1`.
  - `gear`: `gearFor(4)` equals `{ owned: ['wooden sword', 'steel sword'], next: { level: 5, item: 'cape' } }`; `gearFor(12).next === null`.
  - `cleared main quests and bosses earn XP; side, limited, skipped and not-yet-ended don't`: world = `makeWorld()` plus `seminar` (side, 23 Nov), `midterm` (boss, 9 Dec) and `skipCalc`; `clearedAwards(world, '2026-11-23', { date: '2026-11-23', time: '12:30' })` has exactly the keys `['occ:q1@2026-11-23', 'occ:q2@2026-11-23']`, each `{ amount: 10, kind: 'main', date: '2026-11-23', label: '✔ Potion Brewing 101' }` (and `'✔ Rune Geometry'`). With now `{ date: '2026-12-09', time: '16:00' }` and fromDate `'2026-12-09'` it includes `{ key: 'occ:q30@2026-12-09', amount: 30, kind: 'boss', label: '⚔ Potion Brewing 101 Midterm' }`. With `skipCalc` and fromDate `'2026-11-30'`, there's no `occ:q1@2026-11-30`.
  - `a make-up class earns XP when cleared`: world with `moveCalc` → `clearedAwards(world, '2026-12-05', { date: '2026-12-05', time: '11:00' })` contains key `'occ:makeup:2'`.
  - `a quest's own xp overrides the default`: quest 1 with `xp: 40` → its row has `amount: 40`.
  - `bounty on time vs late`: deadline `{ id: 7, name: 'Lab report 4', dueDate: '2026-11-24', dueTime: '23:59', done: true, xp: null }` claimed at `{ date: '2026-11-24', time: '20:00' }` → `{ key: 'bounty:7', date: '2026-11-24', label: '📜 Lab report 4 (on time)', amount: 20, kind: 'bounty', onTime: true }`; claimed at `{ date: '2026-11-25', time: '08:00' }` → `label: '📜 Lab report 4 (late)'`, `amount: 5`, `onTime: false`.
  - `habit rows`: `dailyAward(h, '2026-11-25')` → `{ key: 'habit:3@2026-11-25', date: '2026-11-25', label: '🌅 Read literature', amount: 5, kind: 'daily' }`; `weeklyAward(h, '2026-11-23', '2026-11-25')` → `{ key: 'habitweek:3@2026-11-23', date: '2026-11-25', label: '📅 Fast: week won', amount: 25, kind: 'weekly' }`.
  - `period stats`: from a hand-made list of rows (two `main`, one `boss`, one `bounty` with `onTime: true`, one `weekly`) plus deadlines due in the period (2, one of them claimed on time) and one weekly habit judged for 2 finished weeks → `{ main: 2, boss: 1, bountiesOnTime: 1, bountiesDue: 2, weeksWon: 1, weeksJudged: 2 }`.

- [ ] **Step 2: Run, expect failure**

Run: `node --test test/xp.test.js`
Expected: FAIL with `Cannot find module '../src/xp'`.

- [ ] **Step 3: Implement `src/xp.js`.**
  - `clearedAwards`: `expandRange(world, fromDate, now.date)`. Keep occurrences with `kind === 'main'`, `status === 'active'` and `isCleared(occ, now)`. Kind is `boss` when `occ.isBoss`, otherwise `main`. The amount is the quest's `xp` (looked up in `world.quests` by `occ.questId`), else the default.
  - The label wording is the copy above.
  - `weeksJudged`: for each weekly habit, the weeks from `max(fromDate, mondayOf(createdDate))` to `toDate` that are finished (their Sunday is before `today`) or already won.

- [ ] **Step 4: Run, expect pass**

Run: `node --test test/xp.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/xp.js test/xp.test.js
git commit -m "feat: XP rules (levels, gear, awards, stats)"
```

---

### Task 3: Database (habits, ticks, targets, XP log, xp columns)

**Files:**
- Modify: `src/db.js`
- Modify: `test/fixtures.js` (`quest()` gains `xp: null`)
- Test: `test/db.test.js` (the existing deadlines test's expected object gains `xp: null`)

**Interfaces:**
- Consumes: `mondayOf` from `src/time.js`.
- Produces (new store methods):
  - `listHabits() -> habit[]` (Task 1 shape, ticks sorted)
  - `saveHabit({ id?, name, kind, target? }, today) -> id`. A new habit gets `createdDate = today` and one target row `{ fromMonday: mondayOf(today), target }` (target 1 for daily). An update whose target differs writes or replaces the row for `mondayOf(today)`.
  - `deleteHabit(id)` (its ticks and targets go too, via `ON DELETE CASCADE`)
  - `setHabitTick(habitId, date, ticked)`
  - `addXp(row) -> boolean` (true when inserted; an existing key is ignored)
  - `removeXp(key)`
  - `listXp({ limit }?) -> row[]` (newest first by date, then insert order; `onTime` read back as a boolean or null)
  - `totalXp() -> number`
  - Settings gain `xpStartDate: null` and `xpCheckedDate: null` in `DEFAULT_SETTINGS`.
  - Quests and deadlines gain `xp` (INTEGER, NULL = default), returned as `xp` by `rowToQuest` / `rowToDeadline`. Habits have `xp` too.

- [ ] **Step 1: Write the failing tests** in `test/db.test.js`:
  - `habits: save, change the target from this week, tick, delete`: `saveHabit({ name: 'Fast', kind: 'weekly', target: 3 }, '2026-11-18')`; then `saveHabit({ id, name: 'Fast', kind: 'weekly', target: 4 }, '2026-11-25')` → `listHabits()[0].targets` equals `[{ fromMonday: '2026-11-16', target: 3 }, { fromMonday: '2026-11-23', target: 4 }]`; ticking `'2026-11-24'` twice keeps one tick; unticking removes it; `deleteHabit` leaves `listHabits()` empty.
  - `XP log: a key is only written once, total adds up, newest first`: `addXp` the same key twice → first `true`, second `false`; three rows on different dates → `listXp()` newest date first and `totalXp()` is their sum; `removeXp(key)` lowers the total.
  - `upgrades a version-2 database`: create a file DB in `os.tmpdir()` with the old schema text (the SCHEMA from git tag/commit `c1e9646` without `xp` columns; copy its `quests` and `deadlines` CREATE statements into the test), insert one quest and one deadline, close; `openStore(file)` → `getWorld().quests[0].xp === null`, `listDeadlines()[0].xp === null`, `listHabits()` is `[]`, and the quest's name is unchanged.
  - Update `round-trips the fixture world` by giving `quest()` in `test/fixtures.js` the field `xp: null`.

- [ ] **Step 2: Run, expect failure**

Run: `node --test test/db.test.js`
Expected: the three new tests FAIL (`store.saveHabit is not a function`, missing `xp`).

- [ ] **Step 3: Implement in `src/db.js`.**
  - Tables: `habits` (id, name, kind, created_date, xp), `habit_targets` (habit_id → habits ON DELETE CASCADE, from_monday, target, UNIQUE(habit_id, from_monday)), `habit_ticks` (habit_id → habits ON DELETE CASCADE, date, UNIQUE(habit_id, date)), `xp_log` (id AUTOINCREMENT, key TEXT UNIQUE, date, label, amount, kind, on_time INTEGER NULL).
  - `xp INTEGER` goes in the CREATE statements for quests and deadlines, plus `addColumnIfMissing(table, column, type)` (checks `PRAGMA table_info`, then `ALTER TABLE … ADD COLUMN`) for databases made before. `SCHEMA_VERSION = 3`.
  - `addXp` uses `INSERT … ON CONFLICT (key) DO NOTHING` and returns whether a row changed.

- [ ] **Step 4: Run all tests, expect pass**

Run: `npm test`
Expected: all pass (earlier tests unchanged apart from the added `xp: null`).

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js test/fixtures.js
git commit -m "feat: store habits, ticks, targets and the XP log"
```

---

### Task 4: Writing the XP log, and the IPC calls

**Files:**
- Create: `src/xp-log.js`
- Modify: `src/ipc.js`, `src/validate.js`, `preload.js`, `main.js`
- Test: `test/xp-log.test.js`, `test/ipc.test.js`, `test/validate.test.js`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `src/xp-log.js`:
    - `ensureXpStart(store, today) -> string` (saves `today` when `xpStartDate` is null; returns the start date)
    - `recordClearedQuests(store, now) -> number` (rows added; scans from `max(xpStartDate, xpCheckedDate)` to `now.date`, then saves `xpCheckedDate = now.date`)
    - `applyHabitTick(store, habitId, date, ticked, today) -> string[]` (errors; `['You can only tick today and the 6 days before']` outside the window)
    - `rejudgeWeek(store, habitId, monday, date)` (adds or removes `habitweek:` for that week)
    - `applyDeadlineDone(store, id, done, now)`
    - `buildProfile(store, now) -> { level: levelInfo, gear, habits: habitSummary[], stats: { week, semester }, recent: row[] (20), xpStartDate }`
  - `validateHabit(h) -> string[]` in `src/validate.js`: `'Give the quest a name'`, `'Pick Daily or Weekly'`, `'Pick a target from 1 to 7 days'` (weekly only).
  - New IPC handlers: `getProfile()`, `getLevel() -> levelInfo`, `saveHabit(h)` (validate, save with `clock().date`, then `rejudgeWeek` for the current week), `deleteHabit(id)`, `tickHabit(habitId, date, ticked)`. `setDeadlineDone(id, done)` now also calls `applyDeadlineDone`. All the changing ones go through `mutate`.
  - `preload.js` exposes `getProfile`, `getLevel`, `saveHabit`, `deleteHabit`, `tickHabit`.
  - `main.js`: after `openStore`, call `recordClearedQuests(store, clock())`. Then every 60 s, and on `powerMonitor` resume, call it again, plus `notifyWindow()` when it returns > 0.

- [ ] **Step 1: Write the failing tests** in `test/xp-log.test.js` (store seeded like `test/db.test.js`'s `seededStore()`):
  - `the start date is saved once`: `ensureXpStart(store, '2026-11-24')` then `ensureXpStart(store, '2026-12-01')` → both return `'2026-11-24'`.
  - `catch-up after the app was closed`: start on `'2026-11-24'`; `recordClearedQuests(store, { date: '2026-11-27', time: '18:00' })` logs Tue–Fri's cleared classes once (FundPro 24th, Calc Assist + DigSys 25th, Database 26th, FundPro Assist 27th: 5 rows, 50 XP); running it again adds 0. Nothing on 23 Nov (before the start) is logged.
  - `no farming`: weekly habit target 2; ticking `'2026-11-24'` (+0), `'2026-11-25'` (+25 won, plus nothing daily), then unticking and re-ticking `'2026-11-25'` three times → `totalXp()` is 25. Daily habit: tick, untick, tick the same day → 5.
  - `earned stays earned`: after logging classes, a daily tick and a claimed bounty, `deleteQuest`, `deleteHabit` and `deleteDeadline` don't change `totalXp()`.
  - `a target change re-judges the current week`: weekly target 2 with 2 ticks this week (won, 25) → `saveHabit` with target 3 removes the 25; back to 2 adds it again.
  - `bounty: claim, unclaim, claim late`: 20, then 0, then 5 when claimed after the due moment.
  - `profile`: `buildProfile` returns `level.level`, `gear.next`, one summary per habit, `recent` newest first, and `stats.week.main` equal to the classes logged this week.
- In `test/ipc.test.js`: `habits through IPC: validate, save, tick inside the window only, profile` (a bad weekly target → `ok: false`; tick 10 days ago → `ok: false` with the window message; tick today → `ok: true` and `getLevel().total === 5`).
- In `test/validate.test.js`: `validateHabit` with the three messages above.

- [ ] **Step 2: Run, expect failure**

Run: `node --test test/xp-log.test.js test/ipc.test.js test/validate.test.js`
Expected: FAIL (`Cannot find module '../src/xp-log'`, missing handlers).

- [ ] **Step 3: Implement** `src/xp-log.js`, `validateHabit`, the handlers, the preload calls and the `main.js` timer as listed in Interfaces. `applyHabitTick` writes or removes the daily row for daily habits. For weekly habits it calls `rejudgeWeek(store, habitId, mondayOf(date), date)`.

- [ ] **Step 4: Run all tests, expect pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/xp-log.js src/ipc.js src/validate.js preload.js main.js test/xp-log.test.js test/ipc.test.js test/validate.test.js
git commit -m "feat: XP log writing and profile IPC"
```

---

### Task 5: The Profile screen, avatar and level-up message

**Files:**
- Create: `ui/avatar.js`, `ui/profile.js`
- Modify: `ui/index.html`, `ui/app.js`, `ui/style.css`, `scripts/seed-dev.js`

**Interfaces:**
- Consumes: the Task 4 IPC calls; `el`, `formatDayShort`, `localToday`, `addDays` from `ui/app.js`; `openModal`, `askDialog`, `field`, `textInput`, `radioGroup`, `showErrors` from `ui/forms.js`.
- Produces:
  - `drawKnight(level, { size }) -> SVGElement` in `ui/avatar.js`: SVG squares (as in the v3 mockup) plus a gear layer for each item in `gearFor(level).owned`. The window can't `require`, so the GEAR levels are copied into `avatar.js` with a comment pointing at `src/xp.js`.
  - `renderProfile(profile)`, `openHabitForm(habit | null)` and `openHabitMenu(habit)` in `ui/profile.js`.
  - `showScreen('week' | 'profile')` in `ui/app.js`.

- [ ] **Step 1: Header tabs and screen swap.** In `ui/index.html`, put a `<div class="tabs">` in `.top` with `#tab-week` "⚔ Week" and `#tab-profile` "🛡 Profile". Give the existing `<main class="layout">` `id="week-screen"` and add a sibling `<main id="profile-screen" class="profile" hidden>`. Load `avatar.js` and `profile.js` after `forms.js`. `showScreen` toggles `hidden`, the tabs' `on` class, and the prev/today/next nav (week only). `refresh()` also calls `renderProfile(await getProfile())` while the profile is shown.

- [ ] **Step 2: Profile layout** (`renderProfile`), following mockup v3 and spec §7.5:
  - Left column (`1.15fr`): hero card (knight, "🛡 ADVENTURER", "LV n", XP bar `intoLevel / needed`, "Total N XP", "Next gear: <item> at LV n" or "All gear unlocked"), a 🗡 GEAR row (owned items normal, the rest faded), and 📖 RECENT XP ("Today · label +N", using `formatDayShort` for other dates; "No XP yet. Clear a quest or tick a habit." when empty).
  - Right column (`1fr`): 🌅 DAILY QUESTS and 📅 WEEKLY QUESTS rows with 7 clickable squares (title = that date; click → `tickHabit(id, date, !ticked)`), the streak ("🔥 6 days · best 11" / "2 / 3 this week · 🏆 3 · best 5"), and "+ New daily / weekly quest". Then 📊 STATS (week · semester) and 💰 MONEY "coming soon".

- [ ] **Step 3: Habit form and menu.** `openHabitForm`: name, `radioGroup` Daily/Weekly, a target number input shown for Weekly (1–7, default 3). Save calls `saveHabit` and shows errors. Clicking a habit name opens `openHabitMenu` (✎ Edit, 🗑 Delete with `askDialog` "Delete "<name>"? Its XP stays earned.", Close).

- [ ] **Step 4: Level-up message.** In `ui/app.js`, `refresh()` calls `getLevel()`. When the level is higher than the last one seen this session (and it isn't the first load), show a toast for 5 s: "⬆ LEVEL 5! New gear: cape", or just "⬆ LEVEL 4!" when nothing unlocks.

- [ ] **Step 5: Seed and check in the real window.** Add to `scripts/seed-dev.js` the daily quest "Read literature" and the weekly quest "Fast" (target 3), each with a few ticks this week. Then run, with D = the scratchpad profile folder:

```bash
node scripts/seed-dev.js $D/dev.sqlite
DUNGEON_DEV=1 DUNGEON_SMOKE=1 DUNGEON_SMOKE_JS='showScreen("profile")' DUNGEON_SHOT=$D/../profile.png npx electron . --user-data-dir=$D
```

Expected: no `[window error]` lines; the screenshot shows the v3 layout with the knight, both habits with their squares, the stats and the money slot. A second run with `DUNGEON_SMOKE_JS` that clicks today's square and reads `#profile-screen` text shows the streak going up by one.

- [ ] **Step 6: Run all tests, then commit**

Run: `npm test` → all pass.

```bash
git add ui/ scripts/seed-dev.js
git commit -m "feat: profile screen with habits, avatar and level-up message"
```
