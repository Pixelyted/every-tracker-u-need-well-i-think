const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDesiredEvents, buildMainBodies, hashBody, TIMEZONE, CALENDAR_NAME } = require('../src/google/payloads');
const { makeWorld, seminar, olympiad, midterm, moveCalc } = require('./fixtures');
const { DEFAULT_SETTINGS } = require('../src/db');

const settings = { ...DEFAULT_SETTINGS };
const event = (list, key) => (list.find((e) => e.localKey === key) || {}).body;

test('constants', () => {
  assert.equal(TIMEZONE, 'Asia/Jakarta');
  assert.equal(CALENDAR_NAME, '⚔ every tracker u need, well i think');
});

test('Potion Brewing 101 is one weekly series', () => {
  const list = buildDesiredEvents(makeWorld(), settings);
  assert.equal(list.length, 7);
  const calc = event(list, 'quest:1');
  assert.deepEqual(calc.recurrence, ['RRULE:FREQ=WEEKLY;UNTIL=20261218T165959Z']);
  assert.deepEqual(calc.start, { dateTime: '2026-08-24T07:00:00', timeZone: 'Asia/Jakarta' });
  assert.deepEqual(calc.end, { dateTime: '2026-08-24T09:30:00', timeZone: 'Asia/Jakarta' });
  assert.equal(calc.summary, 'Potion Brewing 101');
  assert.deepEqual(calc.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] });
});

test('mid-week semester start', () => {
  const world = makeWorld();
  world.semester.startDate = '2026-08-26';
  assert.ok(event(buildDesiredEvents(world, settings), 'quest:1').start.dateTime.startsWith('2026-08-31'));
});

test('skip and move exclude the date and add a make-up', () => {
  const world = makeWorld();
  world.changes.push(moveCalc);
  const list = buildDesiredEvents(world, settings);
  assert.ok(event(list, 'quest:1').recurrence.includes('EXDATE;TZID=Asia/Jakarta:20261130T070000'));
  const makeup = event(list, 'makeup:2');
  assert.equal(makeup.summary, 'Potion Brewing 101 (make-up)');
  assert.equal(makeup.start.dateTime, '2026-12-05T08:00:00');
  assert.equal(makeup.recurrence, undefined);
});

test('seminar clash marks only the side quest', () => {
  const world = makeWorld();
  world.quests.push({ ...seminar, note: 'Hall B' });
  const list = buildDesiredEvents(world, settings);
  const sem = event(list, 'quest:10');
  assert.equal(sem.summary, '⚠ Seminar');
  assert.ok(sem.description.startsWith('⚠ Clashes with: Potion Brewing 101 (07.00–09.30), Rune Geometry (09.40–12.00)'));
  assert.ok(sem.description.endsWith('Hall B'));
  assert.equal(event(list, 'quest:1').summary, 'Potion Brewing 101');
});

test('cancelled one-time quest is left out', () => {
  const world = makeWorld();
  world.quests.push(olympiad);
  world.quests.push({ ...seminar, date: '2026-11-27' });
  const list = buildDesiredEvents(world, settings);
  assert.equal(event(list, 'quest:10'), undefined);
});

test("limited event's cancelled dates excluded from DB Systems series", () => {
  const world = makeWorld();
  world.quests.push(olympiad);
  const list = buildDesiredEvents(world, settings);
  const db = event(list, 'quest:6');
  assert.ok(db.recurrence[1].startsWith('EXDATE;TZID=Asia/Jakarta:'));
  assert.ok(db.recurrence[1].includes('20261126T094000'));
  const ev = event(list, 'quest:20');
  assert.equal(ev.start.dateTime, '2026-11-26T09:00:00');
  assert.equal(ev.end.dateTime, '2026-11-28T18:00:00');
  assert.equal(ev.summary, 'Olympiad');
});

test('boss reminders', () => {
  const world = makeWorld();
  world.quests.push(midterm);
  const boss = event(buildDesiredEvents(world, settings), 'quest:30');
  assert.deepEqual(boss.reminders.overrides, [{ method: 'popup', minutes: 15 }, { method: 'popup', minutes: 1020 }]);
});

test('hashBody is key-order independent', () => {
  assert.equal(hashBody({ a: 1, b: { c: [1, 2], d: 'x' } }), hashBody({ b: { d: 'x', c: [1, 2] }, a: 1 }));
  assert.notEqual(hashBody({ a: 1 }), hashBody({ a: 2 }));
});

// ---------- deadlines (📜 bounties) ----------

const calcHw = { id: 7, name: 'Calc HW', dueDate: '2026-11-27', dueTime: '23:59', note: 'page 40', done: false };

test('a bounty is a 15-minute event ending at the due time, with the same two reminders as the laptop', () => {
  const list = buildDesiredEvents(makeWorld(), settings, [calcHw]);
  assert.equal(list.length, 8);
  assert.deepEqual(event(list, 'deadline:7'), {
    summary: '📜 Calc HW (due 23.59)',
    description: 'page 40',
    start: { dateTime: '2026-11-27T23:44:00', timeZone: 'Asia/Jakarta' },
    end: { dateTime: '2026-11-27T23:59:00', timeZone: 'Asia/Jakarta' },
    // Counted from the event's start (23.44): 2 h before 23.59 is 105 min;
    // 20.00 the evening before is 27 h 44 min = 1664 min.
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 105 }, { method: 'popup', minutes: 1664 }] },
    extendedProperties: { private: { localKey: 'deadline:7' } },
  });
});

test('a bounty due just after midnight starts the evening before', () => {
  const list = buildDesiredEvents(makeWorld(), settings, [{ ...calcHw, dueTime: '00:05', note: null }]);
  const body = event(list, 'deadline:7');
  assert.deepEqual(body.start, { dateTime: '2026-11-26T23:50:00', timeZone: 'Asia/Jakarta' });
  assert.equal(body.description, '');
  // 20.00 to 23.50 the evening before is 230 min.
  assert.deepEqual(body.reminders.overrides.map((o) => o.minutes), [105, 230]);
});

test('a ticked bounty is not in Google', () => {
  const list = buildDesiredEvents(makeWorld(), settings, [{ ...calcHw, done: true }]);
  assert.equal(event(list, 'deadline:7'), undefined);
});

test('every ⚔ body carries its localKey', () => {
  const world = makeWorld();
  world.changes.push(moveCalc);
  const list = buildDesiredEvents(world, settings);
  for (const item of list) {
    assert.deepEqual(item.body.extendedProperties, { private: { localKey: item.localKey } });
  }
});

test('imported quests are not in buildDesiredEvents', () => {
  const world = makeWorld();
  world.quests.push({ ...seminar, id: 99, origin: 'google', date: '2026-11-27' });
  assert.equal(buildDesiredEvents(world, settings).some((e) => e.localKey === 'quest:99'), false);
});

const imported = { ...seminar, id: 50, origin: 'google', googleLocked: false, name: 'Dentist', note: 'Bring card', date: '2026-12-01', start: '10:00', end: '11:00', endDate: null, allDay: false };

test('buildMainBodies leaves out locked and past quests and has no reminders', () => {
  const world = makeWorld();
  world.quests.push(
    imported,
    { ...imported, id: 51, googleLocked: true },
    { ...imported, id: 52, date: '2026-11-20' },
    { ...imported, id: 53, date: '2026-11-20', endDate: '2026-12-02' }, // still running
  );
  const list = buildMainBodies(world, '2026-11-26');
  assert.deepEqual(list.map((e) => e.localKey), ['quest:50', 'quest:53']);
  assert.deepEqual(list[0].body, {
    summary: 'Dentist', description: 'Bring card',
    start: { dateTime: '2026-12-01T10:00:00', timeZone: 'Asia/Jakarta' },
    end: { dateTime: '2026-12-01T11:00:00', timeZone: 'Asia/Jakarta' },
  });
});

test('an all-day imported quest is written back as all-day', () => {
  const world = makeWorld();
  world.quests.push({ ...imported, allDay: true, start: '00:00', end: '23:59', endDate: '2026-12-02' });
  const [item] = buildMainBodies(world, '2026-11-26');
  assert.deepEqual(item.body.start, { date: '2026-12-01' });
  assert.deepEqual(item.body.end, { date: '2026-12-03' });
});
