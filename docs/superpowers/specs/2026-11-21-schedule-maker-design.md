# Dungeon Planner: Schedule Maker (v1) Design

Date: 2026-11-21
Owner: the developer
Status: approved by the user (2026-11-21)

## 1. Intent and why

The user is a college student who wants a personal desktop "workspace" app that
will eventually manage deadlines, events, routines, finances and personal
goals, with a cloud LLM that turns plain sentences into entries. **This
document covers only the first piece: the schedule maker.** The AI and the
other features come later.

Why it exists:
- His week is a fixed **weekly class timetable** plus **one-off things**
  (practicums, exams outside class hours, competitions such as an olympiad,
  and extras), and plans change without warning (a lecturer can't come, a
  make-up class moves to Saturday). He wants one place that shows all of it,
  warns them about clashes, copes with changes, and reminds them before things
  start, including on their phone when the laptop is closed.
- He wants it **game-themed** (2D dungeon / roguelike look) so opening it feels
  motivating rather than like another dull calendar. He chose a **game skin**
  only: the look and the language are a game, the mechanics are a planner.

His current timetable, which v1 must handle on day one (all weekly main quests):

| Day | Time | Class |
|-----|------|-------|
| Mon | 07.00–09.30 | Potion Brewing 101 |
| Mon | 09.40–12.00 | Rune Geometry |
| Tue | 07.00–10.00 | Spellcraft Basics |
| Wed | 08.00–10.00 | Potion Lab Assistant |
| Wed | 15.30–17.30 | Golem Mechanics |
| Thu | 09.40–12.00 | Archive Keeping |
| Fri | 15.30–17.30 | Spellcraft Lab Assistant |

## 2. Goals (v1)

1. **One "+ New Quest" form** with three kinds of quest (the user's design):
   - **Main quest:** an important commitment they must attend: classes,
     practicums, exams, etc. Can **repeat weekly** or happen **once**.
   - **Side quest:** extras. Can also repeat weekly or happen once.
   - **Limited event:** the top priority, e.g. an olympiad. Can **span
     several days**. **Every other quest on those days is cancelled but still
     shown.**
2. **Clash handling (the user's design):** when a new or edited quest overlaps
   anything, show a warning naming exactly what it clashes with; they can
   **Retreat** or **Force it**; a forced clash stays visible with a special
   clash look.
3. **Coping with changes (the user's choice):**
   - **Skip** one occurrence of a weekly quest on one date.
   - **Move this date:** move one occurrence of a weekly quest to another
     date/time (e.g. Monday Potion Brewing moved to a Saturday make-up).
   - **Break:** a named date range (exam week, public holiday) when all
     **weekly main quests** are off.
4. **Week view + Today's Quests** as the main screen.
5. **Edit and delete** any quest.
6. **Desktop notifications** on Fedora while the app is running.
7. **One-way push to Google Calendar** so Google sends reminders to their phone.
8. **Pixel dungeon game skin** throughout.

## 3. Non-goals (v1)

- AI / LLM input (planned later; see section 9).
- Deadlines (as due-dates/to-dos), routines, finances, goals.
- Two-way Google sync (no reading events back from Google).
- Windows or macOS support. **Fedora only.**
- Real game mechanics: XP economy, character, dungeon runs, loot.
- "Change this quest from this week on" (timetable versions mid-semester).
  Editing a weekly quest changes it for the whole semester; skip / move /
  break cover one-off changes.
- Repeat patterns other than weekly (every other week, monthly). Off weeks
  are handled with skips. (My call: nothing they described needs more.)
- Multi-day main or side quests. Only limited events span days.
- Multiple users, cloud storage of the app's own data, mobile app.

## 4. Anti-goals (would count as failure even if it "works")

- It looks like a generic calendar with a pixel font slapped on.
- A forced clash or a cancelled quest ends up **hidden** or unreadable. The user
  explicitly wants cancelled quests still shown.
- Reminders fire for something that isn't happening (skipped, moved, on a
  break, cancelled by a limited event), on the laptop or the phone.
- Google push creates **duplicate** events on repeated syncs, or touches any of
  their **other** Google calendars.
- Data silently lost (e.g. a failed push or crash wipes local entries).
- The code is too clever for a beginner to read. The user knows a little JS,
  Python, HTML and CSS, and is most confident in C. He should be able to open
  a file and follow it.

## 5. Constraints

- **Platform:** Fedora Linux (Fedora 45, GNOME desktop) on their laptop only.
- **Stack (decided):** Electron + **plain JavaScript** (no TypeScript) +
  HTML/CSS. **No front-end framework** (no React/Vue); vanilla DOM code with
  small, clearly named modules. (No framework: my call, for readability.)
- **Local data:** everything stored on the laptop in a single SQLite database
  file in the app's user-data folder. The app works fully offline; Google
  push is an add-on.
- **Time zone:** all times are local, Asia/Jakarta (WIB, UTC+7). No DST.
  Events pushed to Google carry `Asia/Jakarta`.
- **Time display:** 24-hour. (Dot vs colon separator: builder's call; The user
  writes "07.00".)
- **GNOME tray caveat:** stock GNOME does not show tray icons. Fedora needs the
  "AppIndicator and KStatusNotifierItem Support" extension for the top-bar
  icon. The app must still work without it (see 7.7).
- **Google OAuth caveat:** a Google Cloud OAuth app left in "Testing" status
  issues refresh tokens that expire after 7 days, forcing a weekly re-login.
  Setup instructions must have them set the consent screen to **"In
  production"** (unverified is fine for one personal user; they click through
  an "unverified app" warning once).
- **Assets:** fonts, sprites and icons bundled locally (no CDN), with licenses
  that allow personal use.

## 6. Approaches considered

**App framework**

| Option | Trade-off | Outcome |
|--------|-----------|---------|
| Tauri + TypeScript + SQLite | Small and light, but needs Rust and TypeScript, two new things for a beginner | Rejected: not beginner-friendly |
| **Electron + plain JS + HTML/CSS + SQLite** | Heavier on disk/RAM, but one language they already know, most tutorials, built-in notifications and tray | **Chosen** by the user |
| Python + pywebview | Python logic, easy Google login, but two languages glued together, few tutorials | Rejected |
| Python + Qt (PySide6) | Native look, hard to style into a convincing dungeon | Rejected |
| C + GTK | His strongest language, but heavy low-level plumbing (HTTP, JSON, OAuth, styling) | Rejected |
| Godot game engine | Great visuals, painful forms / date pickers / Google login | Rejected |

**Notifications / Google**

| Option | Trade-off | Outcome |
|--------|-----------|---------|
| **One-way push** to a dedicated Google calendar | Simple and reliable; edits must be made in the app | **Chosen** by the user |
| Two-way sync | Add events from phone, but conflict / recurrence-exception bugs | Rejected for now; maybe later |
| Laptop-only notifications | Simplest, but no reminders when laptop is off | Kept as a complement |

**Schedule changes**

| Option | Outcome |
|--------|---------|
| No exceptions: every weekly quest every week | Rejected: false reminders on holidays |
| **Skips + breaks (+ move this date)** | **Chosen** by the user ("way better for unexpected change of schedule") |
| Also "change from this week on" | Left out of v1 |

## 7. Design

### 7.1 Concepts and game vocabulary

| Real thing | In-app name / look |
|------------|--------------------|
| Important commitment (class, practicum, exam…) | **Main quest**: coloured block with an icon (colour/icon chosen per quest) |
| One-time main quest (exam, one-off practicum, make-up class) | **⚔ BOSS** look: crown/skull frame. My call. |
| Extra / optional thing | **Side quest**: gold, ◆ diamond marker |
| Top-priority multi-day thing (olympiad) | **Limited event**: a distinct "legendary" style (e.g. purple/star banner across its days) |
| Overlap | **Clash**: cursed red/hatched border, ⚠ tag |
| Quest whose end time has passed | **Cleared** ✔ |
| Skipped occurrence | **Skipped**: faded ghost block |
| Moved occurrence | ghost "moved → Sat 5 Dec" at the old slot; block with ↪ "make-up" tag at the new one |
| Cancelled by a limited event | **Cancelled**: struck-through ghost with ✖ |
| Break | **Camp** ("🏕 CAMP: Midterm week") |
| Today's list | **Today's Quests** |
| Semester week number | **Floor** ("FLOOR 3" = 3rd calendar week since semester start, break weeks included). My call. |
| Nothing today | "Rest at camp 🔥" |

### 7.2 Data model

- **Semester:** table of semesters, exactly one active; name, start date, end
  date. Weekly quests only occur on dates inside their semester. Set up on
  first launch; name/dates editable in Settings. **"Start new semester"**
  (my call) archives the current one: its weekly quests stay stored but stop
  appearing, their Google series are left ending on the old semester's last
  date, and they enter the new timetable. Archived semesters are read-only.
- **Quest:** id, kind (`main` | `side` | `limited`), name, colour, icon,
  optional note, and timing:
  - weekly (main/side only): weekday, start time, end time, semester id;
  - once (main/side): date, start time, end time;
  - limited event: start date + start time, end date + end time (may span
    several days).
- **Occurrence change:** quest id, original date, action (`skip` | `move`),
  and for `move` the new date, start time, end time. Unique per (quest,
  original date). Can be undone.
- **Break:** id, name, start date, end date (inclusive), semester id.
- **Settings:** notification lead time (default 15 min), desktop
  notifications on/off, Google push on/off, Google calendar id,
  launch-on-login on/off.
- **Google mapping:** local item (quest, or a moved occurrence) → Google
  event id, last pushed state, so pushes update rather than duplicate.

Rules:
- Main/side quests: end after start on the same day; no crossing midnight in
  v1 (form rejects with a clear message). My call.
- Clashes and cancellations are **computed** from the data, never stored as
  flags, so any edit / delete / skip / move automatically updates them.

### 7.3 How a day is worked out (the core logic)

For any date, the schedule module produces the list of occurrences with a
status. In order:
1. Expand weekly quests that fall on that date (inside the semester).
2. Apply occurrence changes: `skip` → status Skipped; `move` → status Moved
   at the old slot, plus a new occurrence at the new date/time (keeps the
   quest's kind, colour and icon, tagged make-up).
3. Apply breaks: weekly **main** quests on break days → hidden from the grid
   (the Camp banner shows instead). Side quests and one-time quests are not
   affected. My call: a break means "no classes", not "no life".
4. Add one-time main/side quests on that date.
5. Apply limited events: **every other occurrence on any day a limited event
   touches is Cancelled** (whole calendar day, not only the overlapping
   hours). Cancelled occurrences stay visible.
6. Mark clashes among the remaining **active** occurrences, and mark
   Cleared for those whose end time has passed.

Only active occurrences (not skipped, moved-away, on break, or cancelled)
count for clashes, Today's Quests "next up", notifications and Google.

### 7.4 Clash and cancel warnings

- Two active occurrences clash when `startA < endB && startB < endA` on the
  same date. Touching boundaries is **not** a clash.
- Checked when creating/editing any quest, when moving an occurrence, and
  when undoing a skip/move/break (undo doesn't re-prompt; a returning clash
  just shows with the clash look).
- Clash dialog lists every clashing item (name, date, time) with
  **[Retreat]** / **[Force it ⚔]**:

```
 ┌────────────────────────────────────────────────┐
 │ ⚠ CLASH: "Potion Brewing 101 Midterm" overlaps          │
 │   • Golem Mechanics  Wed 9 Dec 15.30–17.30      │
 │              [ Retreat ]   [ Force it ⚔ ]       │
 └────────────────────────────────────────────────┘
```

- **Creating/editing a limited event** shows a cancel preview instead
  (my call): "This will cancel 6 quests: …" with **[Retreat]** /
  **[Begin event ⭐]**.
- **Adding a quest on a limited-event day** (my call): warning "That day is
  <event>; this quest will be shown as cancelled" with **[Retreat]** /
  **[Add anyway]**.
- Two limited events overlapping each other: treated as a normal clash
  between them (both active, clash look). My call.

### 7.5 Screens

**Main screen: Week view + Today's Quests**

```
╔══════════ ⚔  WEEK 47 · FLOOR 3  ⚔ ══════════════╗  [◀ prev] [today] [next ▶]
║ MON      TUE      WED       THU      FRI    SAT   SUN ║
║ 07.00    07.00    08.00     ⭐ OLYMPIAD ⭐ (Thu–Sat)    ║
║ Calc 1   FundPro  Calc      ✖ Database  ✖ FundPro     ║
║ ─────             Assist      System      Assist      ║
║ 09.40             15.30                               ║
║ LinAlg            DigSys                              ║
╚═══════════════════════════════════════════════════════╝
  ▶ TODAY'S QUESTS (Mon 23 Nov)
     ✔ 07.00 Potion Brewing 101
     ▶ 09.40 Rune Geometry               ← next up, highlighted
  [ + New Quest ]  [ 🏕 Breaks ]  [ ⚙ Settings ]
```

- 7-day grid with a vertical time axis, scaled to the week's earliest/latest
  occurrence (sensible default range).
- **Clashing items sit side by side in the same slot** (column split), both
  with the cursed border and ⚠, fully readable.
- Limited events: a banner across their days; cancelled quests under it as
  struck-through ghosts.
- Clicking a block: edit / delete; for a weekly quest occurrence also
  **Skip this date** and **Move this date**; on a ghost, **Restore / Undo
  move**.
- Today's Quests lists today's occurrences in time order, including
  skipped/cancelled ones shown faded (my call, so they aren't confused about
  where a class went), with "next up" highlighted among active ones.

**+ New Quest form:**

```
 + NEW QUEST
   Type:    (•) Main quest   ( ) Side quest   ( ) Limited event ⭐
   Name:    Potion Brewing 101 Midterm
   Repeats: ( ) Every week   (•) Once → Wed 9 Dec        (main/side)
   Time:    13.00 – 15.00
   Colour / icon:  [■] [📐]                               (main/side)
   Note:    room 3.2
```

For a limited event, "Repeats" is replaced by start date/time and end
date/time. Delete has a confirm step.

**Move this date form:** shows the original occurrence; pick new date, start,
end. Runs the clash check on the new slot.

**Breaks panel:** list to add / edit / delete breaks (name, start, end).

**Settings:** semester name/dates, "Start new semester", notification lead
time, desktop notifications toggle, launch-on-login toggle, Google connect /
disconnect / "push now" with last push status.

**First launch:** set semester dates, then add the weekly main quests.

### 7.6 Game skin

- Dark dungeon palette (stone greys, torch amber; gold for side quests, red
  for clashes, a legendary colour for limited events), pixel-style
  borders/panels, a **readable** pixel font for headings and a clean readable
  font for times and names. Small, tasteful animations (torch flicker, a
  "cleared" stamp).
- Legibility beats decoration at normal laptop size.
- Specific font, sprites and palette values: builder's call (use the
  frontend-design skill).

### 7.7 Desktop notifications and background running

- While running, a Fedora desktop notification fires **N minutes before**
  each active occurrence (N from Settings, default 15), e.g. "⚔ Digital
  Systems starts in 15 min (15.30)". Clashing items say so.
- **Boss quests and limited events** also get a reminder **the evening
  before at 20.00** (my call). A limited event's evening-before reminder
  mentions how many quests it cancels.
- No notifications for skipped, moved-away, break-day or cancelled
  occurrences.
- Closing the window hides it to the tray (Open / Quit). Without a tray
  (GNOME without the AppIndicator extension), closing minimizes instead and
  Settings shows a one-line hint about the extension.
- Launch-on-login (my call: offered, default **on**) via an XDG autostart
  entry.
- Notifications re-planned whenever data changes or the laptop wakes.

### 7.8 Google Calendar one-way push

- One-time guided setup: create a Google Cloud project, enable the Calendar
  API, create an OAuth client of type **Desktop app**, set the consent screen
  to **In production**, then "Connect Google" in the app (browser sign-in via
  local loopback redirect). Tokens stored locally.
- Use the narrowest scope that lets the app manage **only its own calendar**
  (Google's `calendar.app.created` scope is meant for this; fall back to
  broader scopes only if it proves unusable). Never read or write their other
  calendars.
- First push creates a secondary calendar **"⚔ Dungeon"** and remembers it.
- **Weekly quests** → one recurring weekly Google event each, semester start
  to end. Dates that are skipped, moved away, on a break (main only), or
  cancelled by a limited event are **excluded** from the series (e.g.
  excluded dates in the recurrence, rebuilt on each push of that quest).
- **Moved occurrences** → their own single event, title "<name> (make-up)".
- **One-time quests** → single events. **Limited events** → one event
  spanning their start to end.
- **One-time quests cancelled by a limited event** → removed from Google
  (my call: no phone reminders for things that aren't happening; the app
  still shows them).
- Reminders: popup at the app's lead time; boss quests and limited events
  also get the evening-before reminder.
- **Clashes in Google (my call):** only one-time quests and limited events
  get "⚠ " in the title plus a description listing what they clash with.
  Recurring weekly series are never marked, so a one-day clash doesn't make
  the whole series look clashed. Weekly-vs-weekly clashes show in the app
  only.
- Push runs on app start and after every change; deletes delete the Google
  event. Offline or failed pushes are queued and retried; local data is
  never lost because of a push failure. Status visible in Settings.
- The app is the source of truth: edits made in Google are overwritten on
  the next push. Disconnecting stops pushes; it doesn't delete the calendar.

## 8. Code structure guidance

Keep a clear split so the logic is readable and testable on its own:
- a **data** module (SQLite access for semesters, quests, occurrence changes,
  breaks, settings),
- a **schedule** module of pure functions: "work out a day/week" (7.3),
  clash detection, cancel preview, cleared, floor number. No Electron or DB
  code in it,
- a **notifications** module and a **google push** module, both fed by the
  schedule module's output,
- **UI** files (HTML/CSS/vanilla JS) that call the above through Electron's
  standard preload / IPC bridge.

The schedule module gets unit tests first (test-driven): weekly expansion,
skip/move/break/limited-event precedence, clashes, boundaries. Comments
explain *why*, in plain English, for a beginner reader.

## 9. Room for later features

v1 doesn't build these, but must not block them:
- **AI input:** future AI will call the same "create quest / skip / move /
  check clash / cancel preview" functions the forms use, then show a confirm
  card. Keep those functions independent of the forms.
- Deadlines, routines, finances, goals become new item types / screens in the
  same app and database.

## 10. Left to the builder

- SQLite library, project layout, build/packaging (an AppImage or a
  `.desktop` launcher is enough; it only runs on their laptop).
- Exact palette, fonts, sprites, icons, animations, colour/icon presets.
- Time-axis default range.
- Exact wording of in-app game text, within the vocabulary in 7.1.
- Test framework.
