// XP: the points you earn for clearing quests, claiming bounties and
// ticking habits, and the levels and gear they unlock.
//
// Like schedule.js, nothing here touches the database, Electron or the
// clock: "now" and "today" are passed in, so every rule can be tested with
// fixed dates. The functions only work out WHAT was earned. Saving each
// award once (by its `key`) is the job of the caller.
//
// An XP row (one line of the log) looks like:
// { key, date, label, amount, kind: 'daily'|'weekly'|'bounty'|'main'|'boss' }
// Bounty rows also have `onTime: true|false`.

const { expandRange, isCleared } = require('./schedule');
const { addDays, mondayOf, compareSlot } = require('./time');
const { weekProgress } = require('./habits');

// What each thing is worth when it has no XP of its own.
const DEFAULT_XP = { daily: 5, weekly: 25, bountyOnTime: 20, bountyLate: 5, main: 10, boss: 30 };

// Total XP needed to reach a level. Going from level L to L+1 costs
// 50 * (L + 1), so each level is a bit harder than the last:
// 100, 150, 200, ... which adds up to 25 * (L - 1) * (L + 2).
function xpToReach(level) {
  return 25 * (level - 1) * (level + 2);
}

// Where a total sits: the level, how far into it, and how much it takes
// to reach the next one.
function levelInfo(total) {
  let level = 1;
  while (xpToReach(level + 1) <= total) level++;
  return {
    level,
    total,
    intoLevel: total - xpToReach(level),
    needed: xpToReach(level + 1) - xpToReach(level),
  };
}

const GEAR = [
  { level: 1, item: 'wooden sword' },
  { level: 3, item: 'steel sword' },
  { level: 5, item: 'cape' },
  { level: 8, item: 'shield' },
  { level: 12, item: 'crown' },
];

// The gear you own at this level, and the next piece to look forward to
// (null once you have everything).
function gearFor(level) {
  return {
    owned: GEAR.filter((g) => g.level <= level).map((g) => g.item),
    next: GEAR.find((g) => g.level > level) || null,
  };
}

// XP for every main quest (or boss) that has ended, from fromDate up to now.
// Side and limited quests, skipped, moved and cancelled ones earn nothing.
// A quest's own `xp` wins over the default (undefined and null both mean
// "use the default").
function clearedAwards(world, fromDate, now) {
  const rows = [];
  const days = expandRange(world, fromDate, now.date);
  for (const date of Object.keys(days).sort()) {
    for (const occ of days[date]) {
      if (occ.kind !== 'main' || occ.status !== 'active' || !isCleared(occ, now)) continue;
      const quest = world.quests.find((q) => q.id === occ.questId);
      const type = occ.isBoss ? 'boss' : 'main';
      rows.push({
        key: `occ:${occ.key}`,
        date: occ.date,
        label: `${occ.isBoss ? '⚔' : '✔'} ${occ.name}`,
        amount: (quest && quest.xp) ?? DEFAULT_XP[type],
        kind: type,
      });
    }
  }
  return rows;
}

// XP for a ticked deadline. Claimed before the due moment is "on time"
// (worth more); the row is dated the day it was claimed.
function bountyAward(deadline, now) {
  const onTime = compareSlot(now.date, now.time, deadline.dueDate, deadline.dueTime) < 0;
  return {
    key: `bounty:${deadline.id}`,
    date: now.date,
    label: `📜 ${deadline.name} (${onTime ? 'on time' : 'late'})`,
    amount: deadline.xp ?? (onTime ? DEFAULT_XP.bountyOnTime : DEFAULT_XP.bountyLate),
    kind: 'bounty',
    onTime,
  };
}

// XP for ticking a daily habit on `date`.
function dailyAward(habit, date) {
  return {
    key: `habit:${habit.id}@${date}`,
    date,
    label: `🌅 ${habit.name}`,
    amount: habit.xp ?? DEFAULT_XP.daily,
    kind: 'daily',
  };
}

// XP for winning the week that starts on `monday`, dated the day the
// target was reached.
function weeklyAward(habit, monday, date) {
  return {
    key: `habitweek:${habit.id}@${monday}`,
    date,
    label: `📅 ${habit.name}: week won`,
    amount: habit.xp ?? DEFAULT_XP.weekly,
    kind: 'weekly',
  };
}

// How many weekly-habit weeks in the period were "judged": the week is
// over (its Sunday is before today) or it is already won. Weeks before the
// habit was created don't count.
function countWeeksJudged(habits, fromDate, toDate, today) {
  let judged = 0;
  for (const habit of habits) {
    if (habit.kind !== 'weekly') continue;
    const first = fromDate > mondayOf(habit.createdDate) ? fromDate : mondayOf(habit.createdDate);
    for (let monday = mondayOf(first); monday <= toDate; monday = addDays(monday, 7)) {
      const finished = addDays(monday, 6) < today;
      if (finished || weekProgress(habit, monday).won) judged++;
    }
  }
  return judged;
}

// The numbers behind the Profile's "this week / this month" summary.
function periodStats(rows, deadlines, habits, fromDate, toDate, today) {
  const inPeriod = rows.filter((r) => r.date >= fromDate && r.date <= toDate);
  const count = (kind) => inPeriod.filter((r) => r.kind === kind).length;
  return {
    main: count('main'),
    boss: count('boss'),
    bountiesOnTime: inPeriod.filter((r) => r.kind === 'bounty' && r.onTime).length,
    bountiesDue: deadlines.filter((d) => d.dueDate >= fromDate && d.dueDate <= toDate).length,
    weeksWon: count('weekly'),
    weeksJudged: countWeeksJudged(habits, fromDate, toDate, today),
  };
}

module.exports = {
  DEFAULT_XP, xpToReach, levelInfo, GEAR, gearFor,
  clearedAwards, bountyAward, dailyAward, weeklyAward, periodStats,
};
