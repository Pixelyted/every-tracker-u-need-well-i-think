const test = require('node:test');
const assert = require('node:assert/strict');
const { expandDay, expandRange, occurrenceDates, isCleared, floorNumber } = require('../src/schedule');
const { quest, makeWorld, seminar, olympiad, midterm, moveCalc, skipCalc } = require('./fixtures');

const byName = (occs, name) => occs.find((o) => o.name === name);

test('Monday has Potion Brewing then Rune Geometry, no clash', () => {
  const day = expandDay(makeWorld(), '2026-11-23');
  assert.deepEqual(day.map((o) => o.name), ['Potion Brewing 101', 'Rune Geometry']);
  for (const o of day) {
    assert.equal(o.status, 'active');
    assert.deepEqual(o.clashKeys, []);
  }
  assert.equal(day[0].key, 'q1@2026-11-23');
});

test('Saturday is empty', () => {
  assert.deepEqual(expandDay(makeWorld(), '2026-11-28'), []);
});

test('no classes outside the semester', () => {
  assert.deepEqual(expandDay(makeWorld(), '2026-12-21'), []);
});

test('forced seminar clashes with both Monday classes', () => {
  const world = makeWorld();
  world.quests.push(seminar);
  const day = expandDay(world, '2026-11-23');
  assert.equal(byName(day, 'Seminar').clashKeys.length, 2);
  assert.deepEqual(byName(day, 'Potion Brewing 101').clashKeys, ['q10@2026-11-23']);
});

test('exactly touching is not a clash', () => {
  const world = makeWorld();
  world.quests.push(quest({ id: 11, kind: 'side', repeat: 'once', name: 'A', date: '2026-11-28', start: '08:00', end: '09:30' }));
  world.quests.push(quest({ id: 12, kind: 'side', repeat: 'once', name: 'B', date: '2026-11-28', start: '09:30', end: '10:00' }));
  const day = expandDay(world, '2026-11-28');
  assert.deepEqual(byName(day, 'A').clashKeys, []);
  assert.deepEqual(byName(day, 'B').clashKeys, []);
});

test('skip', () => {
  const world = makeWorld();
  world.changes.push(skipCalc);
  const calc = byName(expandDay(world, '2026-11-30'), 'Potion Brewing 101');
  assert.equal(calc.status, 'skipped');
  assert.deepEqual(calc.clashKeys, []);
});

test('move to Saturday make-up', () => {
  const world = makeWorld();
  world.changes.push(moveCalc);
  const calc = byName(expandDay(world, '2026-11-30'), 'Potion Brewing 101');
  assert.equal(calc.status, 'moved');
  assert.equal(calc.movedTo.date, '2026-12-05');
  const sat = expandDay(world, '2026-12-05');
  assert.equal(sat.length, 1);
  assert.equal(sat[0].key, 'makeup:2');
  assert.equal(sat[0].isMakeup, true);
  assert.equal(sat[0].movedFrom, '2026-11-30');
  assert.equal(sat[0].status, 'active');
  assert.equal(sat[0].isBoss, false);
  assert.equal(sat[0].start, '08:00');
  assert.equal(sat[0].end, '10:30');
});

test('break hides weekly main quests only', () => {
  const world = makeWorld();
  world.breaks.push({ id: 1, name: 'Midterm week', startDate: '2026-11-23', endDate: '2026-11-27', semesterId: 1 });
  world.quests.push(quest({ id: 13, kind: 'side', repeat: 'once', name: 'Gym', date: '2026-11-24', start: '16:00', end: '17:00' }));
  const mon = expandDay(world, '2026-11-23');
  assert.deepEqual(mon.map((o) => o.status), ['break', 'break']);
  assert.equal(byName(expandDay(world, '2026-11-24'), 'Gym').status, 'active');
});

test('limited event cancels everything on its days, still listed', () => {
  const world = makeWorld();
  world.quests.push(olympiad);
  const thu = expandDay(world, '2026-11-26');
  const db = byName(thu, 'Archive Keeping');
  assert.equal(db.status, 'cancelled');
  assert.equal(db.cancelledBy, 'Olympiad');
  const ev = byName(thu, 'Olympiad');
  assert.equal(ev.status, 'active');
  assert.equal(ev.start, '09:00');
  assert.equal(ev.end, '24:00');
  assert.equal(ev.isFirstDay, true);
  const fri = expandDay(world, '2026-11-27');
  const evFri = byName(fri, 'Olympiad');
  assert.equal(evFri.start, '00:00');
  assert.equal(evFri.end, '24:00');
  assert.equal(evFri.isFirstDay, false);
  assert.equal(byName(fri, 'Spellcraft Lab Assistant').status, 'cancelled');
});

test('two limited events clash instead of cancelling each other', () => {
  const world = makeWorld();
  world.quests.push(olympiad);
  world.quests.push(quest({ id: 21, kind: 'limited', name: 'Hackathon', startDate: '2026-11-27', start: '08:00', endDate: '2026-11-27', end: '12:00' }));
  const fri = expandDay(world, '2026-11-27');
  const a = byName(fri, 'Olympiad');
  const b = byName(fri, 'Hackathon');
  assert.equal(a.status, 'active');
  assert.equal(b.status, 'active');
  assert.ok(a.clashKeys.includes(b.key));
  assert.ok(b.clashKeys.includes(a.key));
});

test('limited event ending at 00:00 does not touch the next day', () => {
  const world = makeWorld();
  world.quests.push({ ...olympiad, endDate: '2026-11-29', end: '00:00' });
  assert.equal(byName(expandDay(world, '2026-11-29'), 'Olympiad'), undefined);
  assert.ok(byName(expandDay(world, '2026-11-28'), 'Olympiad'));
});

test('one-time main quest is a boss', () => {
  const world = makeWorld();
  world.quests.push(midterm);
  assert.equal(byName(expandDay(world, '2026-12-09'), 'Potion Brewing 101 Midterm').isBoss, true);
});

test('semester starting mid-week', () => {
  const world = makeWorld();
  world.semester.startDate = '2026-08-26';
  assert.equal(occurrenceDates(world, world.quests[0])[0], '2026-08-31');
  assert.deepEqual(expandDay(world, '2026-08-24'), []);
});

test('occurrenceDates for once and limited', () => {
  const world = makeWorld();
  assert.deepEqual(occurrenceDates(world, seminar), ['2026-11-23']);
  assert.deepEqual(occurrenceDates(world, { ...olympiad, endDate: '2026-11-29', end: '00:00' }), ['2026-11-26', '2026-11-27', '2026-11-28']);
});

test('expandRange covers each date', () => {
  const range = expandRange(makeWorld(), '2026-11-23', '2026-11-29');
  assert.equal(Object.keys(range).length, 7);
  assert.equal(range['2026-11-25'].length, 2);
});

test('floorNumber', () => {
  const sem = makeWorld().semester;
  assert.equal(floorNumber(sem, '2026-08-24'), 1);
  assert.equal(floorNumber(sem, '2026-11-23'), 14);
  assert.equal(floorNumber(sem, '2026-11-28'), 14);
  assert.equal(floorNumber(sem, '2026-12-21'), null);
});

test('isCleared', () => {
  const calc = byName(expandDay(makeWorld(), '2026-11-23'), 'Potion Brewing 101');
  assert.equal(isCleared(calc, { date: '2026-11-23', time: '09:30' }), true);
  assert.equal(isCleared(calc, { date: '2026-11-23', time: '09:29' }), false);
  const tue = expandDay(makeWorld(), '2026-11-24')[0];
  assert.equal(isCleared(tue, { date: '2026-11-23', time: '09:30' }), false);
});

test('a make-up disappears when its original class is no longer in the semester', () => {
  const world = makeWorld();
  world.changes.push(moveCalc); // Potion Brewing 101 on 2026-11-30 moved to 2026-12-05
  assert.equal(expandDay(world, '2026-12-05').length, 1);
  world.semester.endDate = '2026-11-27'; // semester shortened: 11-30 is gone
  assert.deepEqual(expandDay(world, '2026-12-05'), []);
});
