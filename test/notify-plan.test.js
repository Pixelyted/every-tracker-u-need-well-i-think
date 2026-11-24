const test = require('node:test');
const assert = require('node:assert/strict');
const { planReminders } = require('../src/notify-plan');
const { makeWorld, midterm, olympiad, seminar } = require('./fixtures');
const { DEFAULT_SETTINGS } = require('../src/db');

const settings = { ...DEFAULT_SETTINGS };
const find = (list, id) => list.find((r) => r.id === id);

test('lead reminder 15 min before Golem Mechanics', () => {
  const list = planReminders(makeWorld(), { date: '2026-11-25', time: '08:00' }, settings);
  assert.deepEqual(find(list, 'q5@2026-11-25:lead'), {
    id: 'q5@2026-11-25:lead',
    fireAt: { date: '2026-11-25', time: '15:15' },
    title: '⚔ Golem Mechanics starts in 15 min (15.30)',
    body: '',
  });
});

test('reminders are sorted by fireAt', () => {
  const list = planReminders(makeWorld(), { date: '2026-11-25', time: '07:00' }, settings);
  const stamps = list.map((r) => r.fireAt.date + ' ' + r.fireAt.time);
  assert.deepEqual(stamps, [...stamps].sort());
  assert.equal(list[0].id, 'q4@2026-11-25:lead');
});

test('late open fires once, immediately', () => {
  const late = planReminders(makeWorld(), { date: '2026-11-25', time: '15:24' }, settings);
  const r = find(late, 'q5@2026-11-25:lead');
  assert.deepEqual(r.fireAt, { date: '2026-11-25', time: '15:24' });
  assert.equal(r.title, '⚔ Golem Mechanics starts in 6 min (15.30)');
  // Potion Lab Assistant (08:00) already started: nothing stale for it.
  assert.equal(find(late, 'q4@2026-11-25:lead'), undefined);
  const tooLate = planReminders(makeWorld(), { date: '2026-11-25', time: '15:31' }, settings);
  assert.equal(find(tooLate, 'q5@2026-11-25:lead'), undefined);
});

test('skipped and cancelled get nothing', () => {
  const world = makeWorld();
  world.changes.push({ id: 1, questId: 5, originalDate: '2026-11-25', action: 'skip', newDate: null, newStart: null, newEnd: null });
  const list = planReminders(world, { date: '2026-11-25', time: '08:00' }, settings);
  assert.equal(list.filter((r) => r.id.startsWith('q5@2026-11-25')).length, 0);
  const w2 = makeWorld();
  w2.quests.push(olympiad);
  const list2 = planReminders(w2, { date: '2026-11-26', time: '06:00' }, settings);
  assert.equal(find(list2, 'q6@2026-11-26:lead'), undefined);
});

test('clash is mentioned in the body', () => {
  const world = makeWorld();
  world.quests.push(seminar);
  const list = planReminders(world, { date: '2026-11-23', time: '00:00' }, settings);
  assert.equal(find(list, 'q10@2026-11-23:lead').body, '⚠ clashes with Potion Brewing 101, Rune Geometry');
});

test('boss gets an evening-before reminder', () => {
  const world = makeWorld();
  world.quests.push(midterm);
  const list = planReminders(world, { date: '2026-12-08', time: '10:00' }, settings);
  assert.deepEqual(find(list, 'q30@2026-12-09:eve'), {
    id: 'q30@2026-12-09:eve',
    fireAt: { date: '2026-12-08', time: '20:00' },
    title: '⚔ BOSS tomorrow: Potion Brewing 101 Midterm',
    body: '13.00',
  });
});

test('evening reminder opened late still fires that evening', () => {
  const world = makeWorld();
  world.quests.push(midterm);
  const list = planReminders(world, { date: '2026-12-08', time: '21:10' }, settings);
  assert.deepEqual(find(list, 'q30@2026-12-09:eve').fireAt, { date: '2026-12-08', time: '21:10' });
});

test('limited event reminder mentions cancellations', () => {
  const world = makeWorld();
  world.quests.push(olympiad);
  const list = planReminders(world, { date: '2026-11-25', time: '10:00' }, settings);
  const eve = find(list, 'q20@2026-11-26:eve');
  assert.equal(eve.title, '⭐ Event tomorrow: Olympiad');
  assert.equal(eve.body, '09.00 · cancels 2 quests');
  assert.equal(list.filter((r) => r.id.startsWith('q20@2026-11-27')).length, 0);
});

test('respects leadMinutes', () => {
  const list = planReminders(makeWorld(), { date: '2026-11-25', time: '08:00' }, { ...settings, leadMinutes: 30 });
  assert.deepEqual(find(list, 'q5@2026-11-25:lead').fireAt, { date: '2026-11-25', time: '15:00' });
});

// ---------- deadlines (📜 bounties) ----------

const calcHw = { id: 7, name: 'Calc HW', dueDate: '2026-11-27', dueTime: '23:59', note: null, done: false };

test('a bounty reminds at 20.00 the evening before and 2 hours before', () => {
  const list = planReminders(makeWorld(), { date: '2026-11-26', time: '09:00' }, settings, { deadlines: [calcHw] });
  assert.deepEqual(find(list, 'deadline:7:eve'), {
    id: 'deadline:7:eve',
    fireAt: { date: '2026-11-26', time: '20:00' },
    title: '📜 Bounty due tomorrow: Calc HW',
    body: 'due 23.59',
  });
  assert.deepEqual(find(list, 'deadline:7:soon'), {
    id: 'deadline:7:soon',
    fireAt: { date: '2026-11-27', time: '21:59' },
    title: '📜 Calc HW due in 2 h (23.59)',
    body: '',
  });
});

test('a bounty opened late inside the 2 hours reminds right away with the real time left', () => {
  const list = planReminders(makeWorld(), { date: '2026-11-27', time: '23:14' }, settings, { deadlines: [calcHw] });
  assert.equal(find(list, 'deadline:7:eve'), undefined);
  const soon = find(list, 'deadline:7:soon');
  assert.deepEqual(soon.fireAt, { date: '2026-11-27', time: '23:14' });
  assert.equal(soon.title, '📜 Calc HW due in 45 min (23.59)');
});

test('ticked, overdue and far-away bounties never remind', () => {
  const deadlines = [
    { ...calcHw, id: 1, done: true },
    { ...calcHw, id: 2, dueDate: '2026-11-20' },
    { ...calcHw, id: 3, dueDate: '2026-12-20' },
  ];
  const list = planReminders(makeWorld(), { date: '2026-11-26', time: '09:00' }, settings, { deadlines });
  assert.deepEqual(list.filter((r) => r.id.startsWith('deadline:')), []);
});
