// Habits: things you want to do again and again, ticked off day by day.
//
// A "daily" habit is ticked once a day and builds a streak of days in a row.
// A "weekly" habit has a target ("3 times a week"); a week is "won" when you
// reach it, and the streak counts weeks won in a row. Like schedule.js,
// nothing here touches the database, Electron or the clock: today is always
// passed in, so every rule can be tested with fixed dates.
//
// A habit looks like:
// { id, name, kind: 'daily'|'weekly', createdDate, xp,
//   targets: [{ fromMonday, target }]  (sorted by fromMonday),
//   ticks: ['YYYY-MM-DD', ...] }

const { addDays, mondayOf, daysBetween } = require('./time');

// You may tick today and the 6 days before it, no further back.
const TICK_WINDOW_DAYS = 7;

// The 7 dates you can tick, oldest first, ending today.
function tickWindow(today) {
  const dates = [];
  for (let i = TICK_WINDOW_DAYS - 1; i >= 0; i--) {
    dates.push(addDays(today, -i));
  }
  return dates;
}

function canTick(date, today) {
  return tickWindow(today).includes(date);
}

// The weekly target that applies to the week starting on `monday`: the
// latest row that started on or before it. Changing a target only affects
// weeks from then on, so past weeks keep the goal they were played under.
// If every row starts later (the habit was made after this week), use the
// first row so the number is still sensible.
function targetForWeek(habit, monday) {
  let target = habit.targets[0].target;
  for (const row of habit.targets) {
    if (row.fromMonday <= monday) target = row.target;
  }
  return target;
}

// How many ticks fall in the week starting on `monday`, and was it won?
function weekProgress(habit, monday) {
  const sunday = addDays(monday, 6);
  const count = habit.ticks.filter((t) => t >= monday && t <= sunday).length;
  const target = targetForWeek(habit, monday);
  return { count, target, won: count >= target };
}

// Daily streak. `current` walks back from today, but an unticked today
// doesn't break it (the day isn't over yet), so then it starts at yesterday.
// `best` is the longest run of ticked days ever.
function dailyStreak(habit, today) {
  const ticked = new Set(habit.ticks);

  let day = ticked.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (ticked.has(day)) {
    current++;
    day = addDays(day, -1);
  }

  let best = 0;
  let run = 0;
  let previous = null;
  for (const date of [...ticked].sort()) {
    run = previous !== null && daysBetween(previous, date) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return { current, best };
}

// Weekly streak, the same idea with weeks. The current week may still be
// unwon without breaking it. Weeks before the habit was created are never
// judged, so a new habit doesn't start with a failure.
function weeklyStreak(habit, today) {
  const thisMonday = mondayOf(today);
  const firstMonday = mondayOf(habit.createdDate);

  let monday = weekProgress(habit, thisMonday).won ? thisMonday : addDays(thisMonday, -7);
  let current = 0;
  while (monday >= firstMonday && weekProgress(habit, monday).won) {
    current++;
    monday = addDays(monday, -7);
  }

  let best = 0;
  let run = 0;
  for (let m = firstMonday; m <= thisMonday; m = addDays(m, 7)) {
    run = weekProgress(habit, m).won ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return { current, best };
}

// Everything the Profile screen shows for one habit. `week` is only there
// for weekly habits.
function habitSummary(habit, today) {
  const ticked = new Set(habit.ticks);
  const weekly = habit.kind === 'weekly';
  return {
    id: habit.id,
    name: habit.name,
    kind: habit.kind,
    strip: tickWindow(today).map((date) => ({ date, ticked: ticked.has(date) })),
    streak: weekly ? weeklyStreak(habit, today) : dailyStreak(habit, today),
    week: weekly ? weekProgress(habit, mondayOf(today)) : null,
  };
}

module.exports = {
  TICK_WINDOW_DAYS,
  tickWindow,
  canTick,
  targetForWeek,
  weekProgress,
  dailyStreak,
  weeklyStreak,
  habitSummary,
};
