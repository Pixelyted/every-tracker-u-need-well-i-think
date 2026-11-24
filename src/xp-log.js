// Writing the XP log: the glue between the pure rules (habits.js, xp.js)
// and the store. Every award has a unique `key`, and the store ignores a
// key it already has, so doing any of these twice never pays twice.

const { mondayOf, addDays } = require('./time');
const { canTick, weekProgress, habitSummary } = require('./habits');
const {
  clearedAwards, bountyAward, dailyAward, weeklyAward, periodStats, levelInfo, gearFor,
} = require('./xp');

const WINDOW_ERROR = 'You can only tick today and the 6 days before';

// XP only counts from the day it was first switched on, so installing the
// update doesn't pay out for every class of the past semester.
function ensureXpStart(store, today) {
  const saved = store.getSettings().xpStartDate;
  if (saved) return saved;
  store.setSettings({ xpStartDate: today });
  return today;
}

// Writes an award unless it was earned before XP started. The tick window
// reaches 6 days back, so in the first week it can reach before the start
// date. A missing start date is set to today first, so an award is never
// written without one.
function addAward(store, row, today) {
  const start = ensureXpStart(store, today);
  if (row.date < start) return false;
  return store.addXp(row);
}

// Logs every main quest that has ended since the last check. Returns how
// many rows were new. Re-scanning the same day is safe (keys dedupe).
function recordClearedQuests(store, now) {
  const start = ensureXpStart(store, now.date);
  const checked = store.getSettings().xpCheckedDate;
  // 'YYYY-MM-DD' strings sort like dates, so plain comparison works.
  // Start a week before the last check: a make-up class entered after it
  // happened lands on a day already scanned. Keys dedupe, so this is safe.
  const rescan = checked ? addDays(checked, -7) : start;
  const from = rescan > start ? rescan : start;
  let added = 0;
  if (from <= now.date) {
    for (const row of clearedAwards(store.getWorld(), from, now)) {
      if (store.addXp(row)) added++;
    }
  }
  store.setSettings({ xpCheckedDate: now.date });
  return added;
}

// Adds or removes the "week won" row of a weekly habit, so it always
// matches the ticks and the target. Daily habits never have one.
function rejudgeWeek(store, habitId, monday, date, today = date) {
  const habit = store.listHabits().find((h) => h.id === habitId);
  if (!habit || habit.kind !== 'weekly') return;
  // A week that ended before the habit was made can't be won: take back
  // any pay for it and stop.
  if (monday < mondayOf(habit.createdDate)) {
    store.removeXp(`habitweek:${habitId}@${monday}`);
    return;
  }
  if (weekProgress(habit, monday).won) {
    addAward(store, weeklyAward(habit, monday, date), today);
  } else {
    store.removeXp(`habitweek:${habitId}@${monday}`);
  }
}

// Ticks or unticks a day. Returns errors (and changes nothing) when the
// date is outside the window or the habit doesn't exist.
function applyHabitTick(store, habitId, date, ticked, today) {
  const habit = store.listHabits().find((h) => h.id === habitId);
  if (!habit) return ['That habit does not exist'];
  if (!canTick(date, today)) return [WINDOW_ERROR];
  store.setHabitTick(habitId, date, ticked);
  if (habit.kind === 'daily') {
    // The tick is kept, but days before the habit existed earn nothing.
    if (ticked) {
      if (date >= habit.createdDate) addAward(store, dailyAward(habit, date), today);
    } else store.removeXp(dailyAward(habit, date).key);
  } else {
    rejudgeWeek(store, habitId, mondayOf(date), date, today);
  }
  return [];
}

// Ticks or unticks a deadline and pays or takes back its bounty.
function applyDeadlineDone(store, id, done, now) {
  store.setDeadlineDone(id, done);
  if (done) {
    const deadline = store.listDeadlines().find((d) => d.id === id);
    if (deadline) store.addXp(bountyAward(deadline, now));
  } else {
    store.removeXp(`bounty:${id}`);
  }
}

// Everything the Profile screen shows, in one object.
function buildProfile(store, now) {
  const rows = store.listXp();
  const level = levelInfo(store.totalXp());
  const habits = store.listHabits();
  const deadlines = store.listDeadlines();
  const xpStartDate = store.getSettings().xpStartDate;

  const monday = mondayOf(now.date);
  const week = periodStats(rows, deadlines, habits, monday, addDays(monday, 6), now.date);

  // The semester period starts at the later of the semester start and the
  // XP start (nothing was logged before that). It ends on this week's Sunday
  // so it always contains the whole week shown beside it.
  const semester = store.getActiveSemester();
  let semesterStats = null;
  if (semester) {
    const from = xpStartDate && xpStartDate > semester.startDate ? xpStartDate : semester.startDate;
    semesterStats = periodStats(rows, deadlines, habits, from, addDays(monday, 6), now.date);
  }

  return {
    level,
    gear: gearFor(level.level),
    habits: habits.map((h) => habitSummary(h, now.date)),
    stats: { week, semester: semesterStats },
    recent: rows.slice(0, 20),
    xpStartDate,
  };
}

module.exports = {
  ensureXpStart, recordClearedQuests, applyHabitTick, rejudgeWeek, applyDeadlineDone, buildProfile,
};
