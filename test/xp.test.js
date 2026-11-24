const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_XP, xpToReach, levelInfo, GEAR, gearFor,
  clearedAwards, bountyAward, dailyAward, weeklyAward, periodStats,
} = require('../src/xp');
const { makeWorld, seminar, midterm, moveCalc, skipCalc } = require('./fixtures');

test('levels', () => {
  assert.equal(xpToReach(1), 0);
  assert.equal(xpToReach(2), 100);
  assert.equal(xpToReach(3), 250);
  assert.equal(xpToReach(5), 700);
  assert.deepEqual(levelInfo(320), { level: 3, total: 320, intoLevel: 70, needed: 200 });
  assert.equal(levelInfo(0).level, 1);
});

test('gear', () => {
  assert.deepEqual(gearFor(4), { owned: ['wooden sword', 'steel sword'], next: { level: 5, item: 'cape' } });
  assert.equal(gearFor(12).next, null);
});

function worldWith(...extra) {
  const world = makeWorld();
  world.quests.push(...extra.filter((e) => e.kind));
  world.changes.push(...extra.filter((e) => e.action));
  return world;
}

test("cleared main quests and bosses earn XP; side, limited, skipped and not-yet-ended don't", () => {
  const world = worldWith(seminar, midterm, skipCalc);
  const rows = clearedAwards(world, '2026-11-23', { date: '2026-11-23', time: '12:30' });
  assert.deepEqual(rows.map((r) => r.key), ['occ:q1@2026-11-23', 'occ:q2@2026-11-23']);
  assert.deepEqual(rows[0], { key: 'occ:q1@2026-11-23', date: '2026-11-23', label: '✔ Potion Brewing 101', amount: 10, kind: 'main' });
  assert.equal(rows[1].label, '✔ Rune Geometry');

  const boss = clearedAwards(world, '2026-12-09', { date: '2026-12-09', time: '16:00' });
  const row = boss.find((r) => r.key === 'occ:q30@2026-12-09');
  assert.equal(row.amount, 30);
  assert.equal(row.kind, 'boss');
  assert.equal(row.label, '⚔ Potion Brewing 101 Midterm');

  const skipped = clearedAwards(world, '2026-11-30', { date: '2026-11-30', time: '23:00' });
  assert.ok(!skipped.some((r) => r.key === 'occ:q1@2026-11-30'));
});

test('a make-up class earns XP when cleared', () => {
  const world = worldWith(moveCalc);
  const rows = clearedAwards(world, '2026-12-05', { date: '2026-12-05', time: '11:00' });
  assert.ok(rows.some((r) => r.key === 'occ:makeup:2'));
});

test("a quest's own xp overrides the default", () => {
  const world = makeWorld();
  world.quests[0].xp = 40;
  const rows = clearedAwards(world, '2026-11-23', { date: '2026-11-23', time: '12:30' });
  assert.equal(rows[0].amount, 40);
  assert.equal(rows[1].amount, DEFAULT_XP.main);
});

test('bounty on time vs late', () => {
  const d = { id: 7, name: 'Lab report 4', dueDate: '2026-11-24', dueTime: '23:59', done: true, xp: null };
  assert.deepEqual(bountyAward(d, { date: '2026-11-24', time: '20:00' }), {
    key: 'bounty:7', date: '2026-11-24', label: '📜 Lab report 4 (on time)', amount: 20, kind: 'bounty', onTime: true,
  });
  const late = bountyAward(d, { date: '2026-11-25', time: '08:00' });
  assert.equal(late.label, '📜 Lab report 4 (late)');
  assert.equal(late.amount, 5);
  assert.equal(late.onTime, false);
  assert.equal(late.date, '2026-11-25');
});

test('habit rows', () => {
  const daily = { id: 3, name: 'Read literature', kind: 'daily', xp: null };
  assert.deepEqual(dailyAward(daily, '2026-11-25'), {
    key: 'habit:3@2026-11-25', date: '2026-11-25', label: '🌅 Read literature', amount: 5, kind: 'daily',
  });
  const weekly = { id: 3, name: 'Fast', kind: 'weekly', xp: null };
  assert.deepEqual(weeklyAward(weekly, '2026-11-23', '2026-11-25'), {
    key: 'habitweek:3@2026-11-23', date: '2026-11-25', label: '📅 Fast: week won', amount: 25, kind: 'weekly',
  });
  assert.equal(dailyAward({ ...daily, xp: 8 }, '2026-11-25').amount, 8);
});

test('period stats', () => {
  const rows = [
    { key: 'a', date: '2026-11-17', kind: 'main', amount: 10 },
    { key: 'b', date: '2026-11-18', kind: 'main', amount: 10 },
    { key: 'c', date: '2026-11-19', kind: 'boss', amount: 30 },
    { key: 'd', date: '2026-11-20', kind: 'bounty', amount: 20, onTime: true },
    { key: 'e', date: '2026-11-23', kind: 'weekly', amount: 25 },
    { key: 'f', date: '2026-10-01', kind: 'main', amount: 10 }, // outside the period
  ];
  const deadlines = [
    { id: 1, name: 'A', dueDate: '2026-11-20', dueTime: '12:00', done: true },
    { id: 2, name: 'B', dueDate: '2026-11-22', dueTime: '12:00', done: false },
    { id: 3, name: 'C', dueDate: '2026-12-30', dueTime: '12:00', done: false },
  ];
  const habits = [
    { id: 1, name: 'Fast', kind: 'weekly', createdDate: '2026-11-10', xp: null, targets: [{ fromMonday: '2026-11-09', target: 3 }], ticks: [] },
    { id: 2, name: 'Read', kind: 'daily', createdDate: '2026-11-10', xp: null, targets: [{ fromMonday: '2026-11-09', target: 1 }], ticks: [] },
  ];
  // Weeks of 9 and 16 Nov are finished by 25 Nov; the week of 23 Nov isn't.
  assert.deepEqual(periodStats(rows, deadlines, habits, '2026-11-01', '2026-11-29', '2026-11-25'), {
    main: 2, boss: 1, bountiesOnTime: 1, bountiesDue: 2, weeksWon: 1, weeksJudged: 2,
  });
});
