const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutColumns } = require('../src/layout');
const { expandDay } = require('../src/schedule');
const { quest, makeWorld, seminar, olympiad, moveCalc } = require('./fixtures');

test('clashing occurrences share the slot side by side', () => {
  const world = makeWorld();
  world.quests.push(seminar);
  const day = expandDay(world, '2026-11-23');
  const layout = layoutColumns(day);
  const calc = layout['q1@2026-11-23'];
  const sem = layout['q10@2026-11-23'];
  assert.equal(calc.cols, 2);
  assert.equal(sem.cols, 2);
  assert.notEqual(calc.col, sem.col);
  // Potion Brewing and Rune Geometry don't overlap, so they share a column.
  assert.equal(layout['q2@2026-11-23'].col, calc.col);
});

test('a lone occurrence gets the full width', () => {
  const day = expandDay(makeWorld(), '2026-11-24');
  assert.deepEqual(layoutColumns(day)['q3@2026-11-24'], { col: 0, cols: 1 });
});

test('a ghost overlapping a new quest sits beside it, not under it', () => {
  const world = makeWorld();
  world.changes.push(moveCalc);
  // The natural thing after a move: book the freed slot.
  world.quests.push(quest({ id: 40, kind: 'side', repeat: 'once', name: 'Study', date: '2026-11-30', start: '07:00', end: '09:00' }));
  const layout = layoutColumns(expandDay(world, '2026-11-30'));
  const ghost = layout['q1@2026-11-30'];
  const study = layout['q40@2026-11-30'];
  assert.equal(ghost.cols, 2);
  assert.equal(study.cols, 2);
  assert.notEqual(ghost.col, study.col);
});

test('two overlapping cancelled ghosts are split, not printed on top of each other', () => {
  const world = makeWorld();
  world.quests.push(olympiad);
  world.quests.push(quest({ id: 41, kind: 'side', repeat: 'once', name: 'Club', date: '2026-11-26', start: '09:40', end: '10:30' }));
  const layout = layoutColumns(expandDay(world, '2026-11-26'));
  assert.equal(layout['q6@2026-11-26'].cols, 2);
  assert.notEqual(layout['q6@2026-11-26'].col, layout['q41@2026-11-26'].col);
  // The limited event itself is a banner, not a grid block.
  assert.deepEqual(layout['q20@2026-11-26'], { col: 0, cols: 1 });
});

test('break-day quests are hidden, so they take no column', () => {
  const world = makeWorld();
  world.breaks.push({ id: 1, name: 'Camp', startDate: '2026-11-23', endDate: '2026-11-23', semesterId: 1 });
  world.quests.push(seminar);
  const layout = layoutColumns(expandDay(world, '2026-11-23'));
  assert.deepEqual(layout['q10@2026-11-23'], { col: 0, cols: 1 });
});
