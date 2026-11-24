# Manual test script

Run these on a fresh database. For a throw-away one:

```sh
rm -f ~/.config/dungeon-planner/dev.sqlite
DUNGEON_DEV=1 npm start
```

(`DUNGEON_DEV=1` uses `dev.sqlite`, so your real `dungeon.sqlite` is never touched.
`node scripts/seed-dev.js` fills `dev.sqlite` with ready-made examples instead.)

| Step | Do this | Expected |
|------|---------|----------|
| a | First launch: enter semester **Autumn 2026**, 2026-08-24 → 2026-12-18, click **Begin ⚔** | The New Quest form opens, set to weekly main quest, with a **Save & add another** button |
| b | Enter the 7 classes with `7.00`-style times (Potion Brewing 101 Mon 7.00–9.30, Rune Geometry Mon 9.40–12.00, Spellcraft Basics Tue 7.00–10.00, Potion Lab Assistant Wed 8.00–10.00, Golem Mechanics Wed 15.30–17.30, Archive Keeping Thu 9.40–12.00, Spellcraft Lab Assistant Fri 15.30–17.30) | Each saves with no error; the week grid shows all seven, times shown as `07.00` |
| c | **+ New Quest** → Side quest, Once, Mon 23 Nov 2026, 5.00–19.00, name Seminar → Save | Dialog `⚠ CLASH: "Seminar" overlaps` listing *Potion Brewing 101 Mon 23 Nov 07.00–09.30* and *Rune Geometry Mon 23 Nov 09.40–12.00*. **Force it ⚔** → Seminar and the classes sit side by side, both with the red hatched border and ⚠ |
| d | Week of 30 Nov: click Potion Brewing 101 → **Skip this date** | A faded ghost reading `SKIPPED`. Click it → **Restore** brings it back |
| e | Click Potion Brewing 101 (30 Nov) → **Move this date** → Sat 5 Dec, 8.00–10.30 → Move it | Ghost `moved → Sat 5 Dec` at the old slot, a `↪ make-up` block on Sat 5 Dec. Click the ghost → **Undo move** restores it |
| f | **+ New Quest** → Limited event ⭐ Olympiad, Thu 26 Nov 9.00 → Sat 28 Nov 18.00 → Save | Dialog `This will cancel 2 quests:` listing Archive Keeping and Spellcraft Lab Assistant → **Begin event ⭐** → purple banner across Thu–Sat, both classes shown as struck-through `✖ CANCELLED` ghosts |
| g | **+ New Quest** with 19.00–05.00 | Inline error `End time must be after start time (quests can't run past midnight)`; nothing saved |

## Results

- 2026-11-21, Task 11: steps a–g driven through the real window by a script
  (`DUNGEON_SMOKE_JS`) on a fresh `dev.sqlite`. Every step behaved as written
  (dialog texts and block states read back from the page).
- 2026-11-21, Task 14: steps a–g re-run on a **fresh, non-dev profile**
  (temporary HOME, real `dungeon.sqlite` code path). All matched; the
  launch-on-login entry was created by default.
- 2026-11-21, Task 13 (by the developer, real Google account): connected; on the
  phone ⚔ Dungeon showed the weekly series, the make-up and `⚠ Seminar`;
  Push now twice gave no duplicates; an event deleted in Google came back;
  a quest added offline appeared after Wi-Fi returned. All passed.

## Anti-goals check (spec section 4), 2026-11-21

| Anti-goal (counts as failure) | Result | Evidence |
|-------------------------------|--------|----------|
| Looks like a generic calendar with a pixel font slapped on | **Pass** (your call to confirm) | Stone-framed panels, flickering torches, crown and skull boss frame, cursed hatched clash border, purple legendary banner, 🏕 camp banners, ✔ cleared stamps, game wording throughout (`docs/screenshots/week.png`) |
| A forced clash or cancelled quest hidden or unreadable | **Pass, with two caveats** | Clashes sit side by side with ⚠ (step c); cancelled quests stay as struck-through `✖ CANCELLED` ghosts (step f). Caveats: in a 2-way split, long names wrap mid-word ("Calcul·us 1"); hover shows the full text. A skipped or moved ghost can be partly covered if a forced clash sits on the same slot; Today's Quests still lists it |
| Reminders for something that isn't happening (laptop or phone) | **Pass** | Laptop: no reminders for skipped, moved-away, break-day or cancelled occurrences; the make-up gets its own (unit tests plus a check on a break + move + olympiad world). Phone: those dates are EXDATEs in the weekly series; cancelled one-time quests are left out of Google |
| Google duplicates events, or touches other calendars | **Pass** | Second push sends nothing (unit test; the developer's real check). Scope `calendar.app.created` only reaches calendars the app made |
| Data silently lost (failed push, crash) | **Pass** | A failed push never writes quests and keeps its progress (unit tests). A quest saved through the window survived `kill -9` of the app |
| Code too clever for a beginner | **Pass, with one note** | Plain CommonJS, no framework, small named functions with "why" comments; rules live in `src/` and are tested separately. Note: `ui/forms.js` is the longest file (~660 lines, one section per form); it could be split per form later |

Launcher: `npm run install-desktop` wrote
`~/.local/share/applications/dungeon-planner.desktop`; `desktop-file-validate`
is clean and GNOME lists "Dungeon Planner" as a visible app.
