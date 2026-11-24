const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../src/db');
const { makeWorld } = require('./fixtures');
const {
  ensureXpStart, recordClearedQuests, applyHabitTick, rejudgeWeek, applyDeadlineDone, buildProfile,
} = require('../src/xp-log');

// A store holding the fixture semester and the 7 weekly classes.
function seededStore() {
  const store = openStore(':memory:');
  const fixture = makeWorld();
  const { id, ...semester } = fixture.semester;
  store.saveSemester(semester);
  for (const q of fixture.quests) {
    const { id: _ignored, ...rest } = q;
    store.saveQuest(rest);
  }
  return store;
}

test('the start date is saved once', () => {
  const store = openStore(':memory:');
  assert.equal(ensureXpStart(store, '2026-11-24'), '2026-11-24');
  assert.equal(ensureXpStart(store, '2026-12-01'), '2026-11-24');
});

test('catch-up after the app was closed', () => {
  const store = seededStore();
  ensureXpStart(store, '2026-11-24');
  const now = { date: '2026-11-27', time: '18:00' };
  assert.equal(recordClearedQuests(store, now), 5);
  assert.equal(store.totalXp(), 50);
  assert.equal(recordClearedQuests(store, now), 0);
  // Nothing from 23 Nov, which is before the start.
  assert.ok(store.listXp().every((r) => r.date >= '2026-11-24'));
});

test('no farming', () => {
  const store = seededStore();
  const weekly = store.saveHabit({ name: 'Gym', kind: 'weekly', target: 2 }, '2026-11-24');
  const today = '2026-11-25';
  assert.deepEqual(applyHabitTick(store, weekly, '2026-11-24', true, today), []);
  assert.equal(store.totalXp(), 0);
  applyHabitTick(store, weekly, '2026-11-25', true, today);
  assert.equal(store.totalXp(), 25);
  for (let i = 0; i < 3; i++) {
    applyHabitTick(store, weekly, '2026-11-25', false, today);
    applyHabitTick(store, weekly, '2026-11-25', true, today);
  }
  assert.equal(store.totalXp(), 25);

  const daily = store.saveHabit({ name: 'Read', kind: 'daily' }, '2026-11-24');
  applyHabitTick(store, daily, today, true, today);
  applyHabitTick(store, daily, today, false, today);
  applyHabitTick(store, daily, today, true, today);
  assert.equal(store.totalXp(), 30);
});

test('ticks outside the window or for a missing habit change nothing', () => {
  const store = seededStore();
  const id = store.saveHabit({ name: 'Read', kind: 'daily' }, '2026-11-24');
  assert.deepEqual(applyHabitTick(store, id, '2026-11-01', true, '2026-11-24'),
    ['You can only tick today and the 6 days before']);
  assert.ok(applyHabitTick(store, 999, '2026-11-24', true, '2026-11-24').length > 0);
  assert.equal(store.totalXp(), 0);
  assert.deepEqual(store.listHabits()[0].ticks, []);
});

test('earned stays earned', () => {
  const store = seededStore();
  ensureXpStart(store, '2026-11-24');
  recordClearedQuests(store, { date: '2026-11-25', time: '18:00' });
  const habit = store.saveHabit({ name: 'Read', kind: 'daily' }, '2026-11-24');
  applyHabitTick(store, habit, '2026-11-24', true, '2026-11-24');
  const deadlineId = store.saveDeadline({ name: 'Report', dueDate: '2026-11-30', dueTime: '23:59', note: null });
  applyDeadlineDone(store, deadlineId, true, { date: '2026-11-25', time: '10:00' });
  const before = store.totalXp();
  assert.ok(before > 0);
  store.deleteQuest(1);
  store.deleteHabit(habit);
  store.deleteDeadline(deadlineId);
  assert.equal(store.totalXp(), before);
});

test('a target change re-judges the current week', () => {
  const store = seededStore();
  const today = '2026-11-25';
  const monday = '2026-11-23';
  const id = store.saveHabit({ name: 'Gym', kind: 'weekly', target: 2 }, today);
  applyHabitTick(store, id, '2026-11-24', true, today);
  applyHabitTick(store, id, '2026-11-25', true, today);
  assert.equal(store.totalXp(), 25);
  store.saveHabit({ id, name: 'Gym', kind: 'weekly', target: 3 }, today);
  rejudgeWeek(store, id, monday, today);
  assert.equal(store.totalXp(), 0);
  store.saveHabit({ id, name: 'Gym', kind: 'weekly', target: 2 }, today);
  rejudgeWeek(store, id, monday, today);
  assert.equal(store.totalXp(), 25);
});

test('bounty: claim, unclaim, claim late', () => {
  const store = seededStore();
  const id = store.saveDeadline({ name: 'Report', dueDate: '2026-11-30', dueTime: '12:00', note: null });
  applyDeadlineDone(store, id, true, { date: '2026-11-29', time: '10:00' });
  assert.equal(store.totalXp(), 20);
  applyDeadlineDone(store, id, false, { date: '2026-11-29', time: '10:05' });
  assert.equal(store.totalXp(), 0);
  applyDeadlineDone(store, id, true, { date: '2026-11-30', time: '13:00' });
  assert.equal(store.totalXp(), 5);
});

test('profile', () => {
  const store = seededStore();
  const now = { date: '2026-11-25', time: '18:00' };
  ensureXpStart(store, '2026-11-23');
  recordClearedQuests(store, now);
  const habit = store.saveHabit({ name: 'Read', kind: 'daily' }, now.date);
  applyHabitTick(store, habit, now.date, true, now.date);
  const profile = buildProfile(store, now);
  assert.equal(profile.level.level, 1);
  assert.equal(profile.level.total, store.totalXp());
  assert.equal(profile.gear.next.item, 'steel sword');
  assert.equal(profile.habits.length, 1);
  assert.equal(profile.xpStartDate, '2026-11-23');
  assert.equal(profile.recent[0].kind, 'daily');
  const mainRows = store.listXp().filter((r) => r.kind === 'main' || r.kind === 'boss');
  assert.equal(profile.stats.week.main + profile.stats.week.boss, mainRows.length);
  assert.ok(profile.stats.semester);
  assert.equal(buildProfile(openStore(':memory:'), now).stats.semester, null);
});

test('ticks before the XP start date are stored but earn nothing', () => {
  const store = seededStore();
  ensureXpStart(store, '2026-11-24');
  const today = '2026-11-25';
  const daily = store.saveHabit({ name: 'Read', kind: 'daily' }, '2026-11-24');
  applyHabitTick(store, daily, '2026-11-22', true, today);
  assert.equal(store.totalXp(), 0);
  assert.deepEqual(store.listHabits()[0].ticks, ['2026-11-22']);
  applyHabitTick(store, daily, '2026-11-24', true, today);
  assert.equal(store.totalXp(), 5);
});

test('a week won by a tick before the start earns nothing, on or after earns 25', () => {
  const store = seededStore();
  ensureXpStart(store, '2026-11-25');
  const today = '2026-11-26';
  const id = store.saveHabit({ name: 'Gym', kind: 'weekly', target: 1 }, today);
  applyHabitTick(store, id, '2026-11-24', true, today);
  assert.equal(store.totalXp(), 0);
  applyHabitTick(store, id, '2026-11-24', false, today);
  applyHabitTick(store, id, '2026-11-25', true, today);
  assert.equal(store.totalXp(), 25);
});

test('an award without a start date sets the start to today', () => {
  const store = seededStore();
  const id = store.saveHabit({ name: 'Read', kind: 'daily' }, '2026-11-25');
  applyHabitTick(store, id, '2026-11-25', true, '2026-11-25');
  assert.equal(store.getSettings().xpStartDate, '2026-11-25');
  assert.equal(store.totalXp(), 5);
});

test('final review: a weekly habit is not paid for the week before it existed', () => {
  const store = seededStore();
  ensureXpStart(store, '2026-11-23');
  const id = store.saveHabit({ name: 'Run', kind: 'weekly', target: 1 }, '2026-11-30');
  applyHabitTick(store, id, '2026-11-29', true, '2026-11-30');
  assert.equal(store.listXp().filter((r) => r.key.startsWith('habitweek:')).length, 0);
});

test('final review: a weekly habit row from before creation is removed', () => {
  const store = seededStore();
  ensureXpStart(store, '2026-11-23');
  const id = store.saveHabit({ name: 'Run', kind: 'weekly', target: 1 }, '2026-11-30');
  store.addXp({ key: `habitweek:${id}@2026-11-23`, kind: 'habit', date: '2026-11-29', amount: 25, label: 'x' });
  rejudgeWeek(store, id, '2026-11-23', '2026-11-29', '2026-11-30');
  assert.equal(store.listXp().filter((r) => r.key.startsWith('habitweek:')).length, 0);
});

test('final review: a daily habit is not paid for days before creation', () => {
  const store = seededStore();
  ensureXpStart(store, '2026-11-23');
  const id = store.saveHabit({ name: 'Read', kind: 'daily' }, '2026-11-30');
  assert.deepEqual(applyHabitTick(store, id, '2026-11-28', true, '2026-11-30'), []);
  assert.equal(store.listXp().length, 0);
  assert.deepEqual(store.listHabits()[0].ticks, ['2026-11-28']);
});

test('final review: a make-up class entered late still earns XP once', () => {
  const store = seededStore();
  ensureXpStart(store, '2026-11-23');
  recordClearedQuests(store, { date: '2026-12-04', time: '23:00' });
  // Potion Brewing of Mon 30 Nov moved to Tue 1 Dec (3 days before the checked date).
  store.setChange({ questId: 1, originalDate: '2026-11-30', action: 'move', newDate: '2026-12-01', newStart: '08:00', newEnd: '10:30' });
  recordClearedQuests(store, { date: '2026-12-04', time: '23:30' });
  recordClearedQuests(store, { date: '2026-12-04', time: '23:45' });
  const madeUp = store.listXp().filter((r) => r.date === '2026-12-01' && r.label.includes('Potion Brewing 101'));
  assert.equal(madeUp.length, 1);
});

test('final review: the semester bounty count includes the whole current week', () => {
  const store = seededStore();
  const now = { date: '2026-11-25', time: '10:00' };
  ensureXpStart(store, '2026-11-23');
  store.saveDeadline({ name: 'Report', dueDate: '2026-11-29', dueTime: '12:00', note: null });
  const { stats } = buildProfile(store, now);
  assert.equal(stats.week.bountiesDue, 1);
  assert.ok(stats.semester.bountiesDue >= stats.week.bountiesDue);
});
