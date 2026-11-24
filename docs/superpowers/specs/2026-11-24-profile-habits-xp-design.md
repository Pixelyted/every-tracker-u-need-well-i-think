# Profile, habits and XP — design

24 November 2026. Agreed with the user in conversation; the layout was picked
from browser mockups (version 3). Points marked **(builder's call)** were
not discussed and can be changed.

## 1. Intent and why

The user wants a **Profile** that is about *them*, not their timetable: a
character sheet with their level, their habits and their stats, and later a money
summary. It is the first of three steps:

1. **This design:** the Profile screen, habits (Daily and Weekly quests),
   XP and levels.
2. Next: **finances**, its own panel, which then fills the Profile's money
   slot.
3. Later: the **AI input** decides how much XP each thing is worth, and
   brings a bigger version of deadlines.

Why: ticking habits and watching a character level up should make the app
motivating to open every day, like the game skin already does for the
schedule.

His habits right now: **read a literature every day** and **fast at least
3 days this week**.

## 2. Goals

- A **🛡 Profile** screen, switched with **⚔ Week / 🛡 Profile** at the top.
  The week screen stays exactly as it is.
- **Daily quests**: tick once a day; streak = days in a row.
- **Weekly quests**: a target per week (Mon–Sun), tick the days you did it;
  the week is *won* when the target is reached; streak = weeks won in a row.
- **XP and levels**, from a permanent **XP log**.
- A **pixel avatar** whose gear changes with level.
- **Stats** for this week and this semester, and a "coming soon" money slot.

## 3. Non-goals (for now)

- Reminders for habits (the user: not needed).
- Pushing habits to Google.
- Habits on the week screen or in Today's Quests.
- Choosing or customising the character.
- Losing XP for missed things.
- Editing XP values by hand (the future AI will set them).
- Finances, other than the empty slot.

## 4. Anti-goals (would count as failure even if it "works")

- XP that disappears or changes after it was earned because something was
  edited, deleted or archived.
- Farming XP by ticking and unticking the same thing.
- Starting at a high level from the semester's past classes (24 Aug until
  now) the first time the feature runs.
- Classes they skipped, moved away, had on a break or that a limited event
  cancelled giving XP.
- Anything here slowing down or changing the week screen.

## 5. Vocabulary

| Real thing | In the app |
| --- | --- |
| Class (weekly main quest) | **Main quest** (unchanged) |
| Daily habit | **🌅 Daily quest** |
| Habit with a weekly target | **📅 Weekly quest** |
| Reaching a weekly target | the week is **won** 🏆 |
| Days / weeks in a row | **🔥 streak** (daily), **🏆 streak** (weekly) |

## 6. Approaches considered (for XP)

| Approach | Trade-off |
| --- | --- |
| A. Work XP out fresh from the data every time | Less code, always consistent, but deleting a class or archiving a semester erases XP already earned, and changing an XP value rewrites the past. |
| **B. A permanent XP log (chosen)** | Each award is one row, written when it happens. Earned stays earned. More code: awards must be written and removed at the right moments, and cleared classes need a catch-up when the app starts. |
| Mix: log the ticks, compute the classes | Keeps the main flaw of A for classes. |

The user chose **B**.

## 7. Design

### 7.1 Habits

A habit has: name, kind (`daily` or `weekly`), and for weekly ones a target
of 1–7 days per week.

- **Ticks:** one tick per habit per date. The tick box covers **today and
  the 6 days before** (so a forgotten tick can be fixed), never the future
  and never further back. Both kinds use the same "last 7 days" strip of
  squares, so last Sunday can still be fixed on Monday.
- **Daily streak:** days in a row ending today. If today isn't ticked yet,
  the streak ends yesterday: today doesn't break it until the day is over.
  Also shown: the best streak ever.
- **Weekly progress:** ticks in the current Mon–Sun week vs the target
  ("2 / 3 this week").
- **Weekly streak:** weeks won in a row. The current week counts only once
  it is won; until then the streak ends last week. Best streak shown too.
- **Changing a target** applies from the current week; past weeks keep the
  target they had. So targets are stored with the week they start from.
  The current week is judged again with the new target, which can add or
  remove its "won" XP **(builder's call)**.
- **Deleting a habit** deletes its ticks. Its rows in the XP log stay
  (earned stays earned).
- A habit created mid-week: weeks before its creation week are not judged
  (no broken streak from before it existed).

### 7.2 XP: what earns how much

Each thing that can earn XP carries an optional **xp value**. Empty means
"use the default for its type". The future AI will fill it in; no form edits
it for now.

| Thing | Default XP | Written to the log when | Removed from the log when |
| --- | --- | --- | --- |
| 🌅 Daily quest ticked | 5 | ticked | unticked |
| 📅 Weekly quest won | 25 | a tick makes that week reach its target | an untick drops that week below its target |
| 📜 Bounty claimed on time | 20 | ticked done before its due moment | unticked |
| 📜 Bounty claimed late | 5 | ticked done at or after its due moment | unticked |
| ✔ Main quest cleared | 10 | its end time passes (automatic) | never (see below) |
| ⚔ Boss cleared | 30 | its end time passes (automatic) | never |

- **Automatic for classes:** The user doesn't always have the laptop in class,
  so cleared main quests give XP by themselves. Only **active** occurrences
  count: skipped, moved-away, break and cancelled ones give nothing. A
  make-up class gives XP when it is cleared.
- **Side quests and limited events give no XP** for now
  **(builder's call)**: they weren't in the agreed table.
- **Once a class's XP is logged it stays**, even if that date is skipped
  afterwards or the quest is deleted **(builder's call)**: it keeps "earned
  stays earned" simple, and mistakes are rare.
- **No farming:** every row has a unique key (below), so ticking twice can
  never log twice, and unticking removes exactly that row.
- **Bounty on time vs late** is decided at the moment it is claimed.
  Unclaiming and claiming again re-decides it.

### 7.3 The XP log

One row per award: a unique **key**, the **date** it was earned, a
**label** for the Recent XP list, the **amount**, and its **kind**
(`daily`, `weekly`, `bounty`, `main`, `boss`) for the stats.

| Key | Meaning |
| --- | --- |
| `habit:<habitId>@<date>` | a daily quest ticked on that date |
| `habitweek:<habitId>@<monday>` | a weekly quest won in the week of that Monday |
| `bounty:<deadlineId>` | a bounty claimed |
| `occ:<occurrence key>` | a cleared main quest or boss (e.g. `occ:q1@2026-11-30`, `occ:makeup:5`) |

- **Start date:** the first time the app runs with this feature it saves
  today as the XP start date. Nothing before it earns XP.
- **Cleared classes:** every minute (the same timer the reminders use) and
  once at start-up, the app looks at the days from the last check (or the
  start date) up to now, and logs every newly cleared active main quest or
  boss. Writing a key that already exists does nothing, so re-checking is
  safe. This also catches up on classes that finished while the app was
  closed.
- **Level:** your total XP. Reaching level L takes 25 × (L − 1) × (L + 2)
  XP in total: level 2 at 100, 3 at 250, 4 at 450, 5 at 700, 6 at 1000.
  Each level needs 50 more than the one before **(builder's call)**.
- **Level up:** a small in-window message, "⬆ LEVEL 5! New gear: cape"
  **(builder's call)**. No desktop notification.

### 7.4 The avatar

A pixel knight drawn in the app (no image files needed), with gear layers
that unlock by level. Gear above the current level is shown faded in the
Gear row.

| Level | Gear |
| --- | --- |
| 1 | wooden sword |
| 3 | steel sword |
| 5 | + cape |
| 8 | + shield |
| 12 | + crown |

The levels and items are placeholders to tune.

### 7.5 The Profile screen (mockup v3)

```
[⚔ Week] [🛡 Profile]
┌ left, a bit wider ───────────────────┐ ┌ right ─────────────────────┐
│ [knight]  🛡 ADVENTURER  LV 4         │ │ 🌅 DAILY QUESTS            │
│           ████████░░ 320/450 XP       │ │  ☑ Read literature 🔥 6    │
│           Total 1 270 · next: cape    │ │  ■■□■■■■ last 7 days · best│
├──────────────────────────────────────┤ │ 📅 WEEKLY QUESTS           │
│ 🗡 GEAR  LV1 LV3 (LV5 LV8 LV12 faded) │ │  Fast 2/3 this week · 🏆 3 │
├──────────────────────────────────────┤ │  + New daily / weekly quest│
│ 📖 RECENT XP                          │ ├────────────────────────────┤
│  Today · 🌅 Read literature    +5     │ │ 📊 STATS   week · semester │
│  Today · ✔ Fund. Programming  +10     │ │  Main quests cleared 9·131 │
│  Mon · 📜 Lab report 4         +20    │ │  ⚔ Bosses cleared     0·2  │
└──────────────────────────────────────┘ │  📜 Bounties on time  …    │
                                         │  📅 Weekly quests won …    │
                                         ├────────────────────────────┤
                                         │ 💰 MONEY  coming soon      │
                                         └────────────────────────────┘
```

- **Daily / Weekly quests:** the 7 squares (today and the 6 days before)
  are the tick boxes; click one to tick or untick that day. Clicking a
  habit's name opens edit / delete. "+ New daily / weekly quest" opens a
  form: name, Daily or Weekly, and the target for Weekly.
- **Stats** come from the XP log, for this week (Mon–Sun) and this
  semester (from the semester start or the XP start date, whichever is
  later):
  - main quests cleared, bosses cleared (`main` / `boss` rows);
  - bounties on time: claimed on time / all bounties due in that period;
  - weekly quests won: won weeks / weeks judged in that period.
- **Recent XP:** the latest log rows, newest first (about 20).
- **Money:** an empty "coming soon" slot until finances are built.

## 8. Constraints

- Same app, same database, same style: plain CommonJS, no frameworks, and
  "why" comments a beginner can follow.
- New tables only, so existing databases just gain them.
- Pure logic (streaks, levels, which occurrences earn XP, stats) in plain
  modules with no database or Electron, tested test-first like
  `src/schedule.js`. Keep them callable without the forms, for the future
  AI (spec section 9).
- Nothing in the reminder or Google push behaviour changes.

## 9. Left to the builder

- Table and column names, file layout, and how the tabs swap the screen.
- How the knight and its gear are drawn (SVG squares, as in the mockup, is
  fine).
- Exact colours, spacing and how many Recent XP rows fit.
- Wording of empty states ("No habits yet").
