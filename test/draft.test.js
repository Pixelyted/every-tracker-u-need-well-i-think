const test = require('node:test');
const assert = require('node:assert/strict');
const { checkDraft, checkMove } = require('../src/draft');
const { quest, makeWorld, seminar, olympiad } = require('./fixtures');

test('seminar draft lists both Monday classes', () => {
  const { id, ...draft } = seminar;
  const result = checkDraft(makeWorld(), draft);
  assert.deepEqual(result.clashes.map((o) => o.name), ['Potion Brewing 101', 'Rune Geometry']);
  assert.deepEqual(result.cancelledBy, []);
  assert.deepEqual(result.wouldCancel, []);
});

test("editing a quest doesn't clash with itself", () => {
  const world = makeWorld();
  const result = checkDraft(world, { ...world.quests[0], start: '07:30' }, { editingId: 1 });
  assert.deepEqual(result.clashes, []);
});

test('weekly draft checks every week', () => {
  const draft = quest({ kind: 'side', repeat: 'weekly', name: 'Club', weekday: 3, start: '09:00', end: '11:00', semesterId: 1 });
  const result = checkDraft(makeWorld(), draft);
  assert.ok(result.clashes.length > 1);
  assert.ok(result.clashes.every((o) => o.questId === 4));
  assert.equal(new Set(result.clashes.map((o) => o.key)).size, result.clashes.length);
});

test('limited draft previews what it cancels', () => {
  const { id, ...draft } = olympiad;
  const result = checkDraft(makeWorld(), draft);
  assert.deepEqual(result.wouldCancel.map((o) => o.name), ['Archive Keeping', 'Spellcraft Lab Assistant']);
});

test('editing a limited event previews against the world without it', () => {
  const world = makeWorld();
  world.quests.push(olympiad);
  const result = checkDraft(world, olympiad, { editingId: 20 });
  assert.equal(result.wouldCancel.length, 2);
});

test('adding on a limited day warns', () => {
  const world = makeWorld();
  world.quests.push(olympiad);
  const draft = quest({ kind: 'side', repeat: 'once', name: 'Coffee', date: '2026-11-27', start: '13:00', end: '14:00' });
  assert.deepEqual(checkDraft(world, draft).cancelledBy, ['Olympiad']);
});

test('move onto a busy slot clashes', () => {
  const result = checkMove(makeWorld(), 1, '2026-11-30', { date: '2026-12-02', start: '15:00', end: '16:00' });
  assert.ok(result.clashes.some((o) => o.name === 'Golem Mechanics'));
});

test('move onto a free slot is clean', () => {
  const result = checkMove(makeWorld(), 1, '2026-11-30', { date: '2026-12-05', start: '08:00', end: '10:30' });
  assert.deepEqual(result, { clashes: [], cancelledBy: [], cancelledDates: [], wouldCancel: [] });
});

test('a draft on a limited-event day that also clashes gets both warnings, in order', () => {
  const { warningSteps } = require('../src/draft');
  const world = makeWorld();
  world.quests.push(olympiad);
  const lab = quest({ kind: 'main', repeat: 'weekly', name: 'DB Lab', weekday: 4, start: '10:00', end: '11:00', semesterId: 1 });
  const checks = checkDraft(world, lab);
  assert.deepEqual(checks.cancelledBy, ['Olympiad']);
  assert.deepEqual(checks.cancelledDates, ['2026-11-26']);
  assert.ok(checks.clashes.length > 1);
  assert.deepEqual(warningSteps(checks), ['cancelledBy', 'clashes']);
  assert.deepEqual(warningSteps({ clashes: [], cancelledBy: [], wouldCancel: [] }), []);
  assert.deepEqual(warningSteps({ clashes: [{}], cancelledBy: [], wouldCancel: [{}] }), ['wouldCancel', 'clashes']);
});

test("moving a class to another weekday doesn't warn about make-ups the save will delete", () => {
  const world = makeWorld();
  // Potion Brewing 101 (Monday 2026-11-30) moved to Saturday, onto a seminar.
  world.changes.push({ id: 2, questId: 1, originalDate: '2026-11-30', action: 'move', newDate: '2026-12-05', newStart: '08:00', newEnd: '10:30' });
  world.quests.push(quest({ id: 11, kind: 'side', repeat: 'once', name: 'Saturday seminar', date: '2026-12-05', start: '08:00', end: '10:00' }));
  // Same weekday: the make-up stays, so its clash is listed.
  const same = checkDraft(world, { ...world.quests[0], start: '06:00', end: '07:00' }, { editingId: 1 });
  assert.deepEqual(same.clashes.map((o) => o.name), ['Saturday seminar']);
  // Moved to Thursday: saveQuest deletes the Monday make-up, so no warning.
  const moved = checkDraft(world, { ...world.quests[0], weekday: 4, start: '06:00', end: '07:00' }, { editingId: 1 });
  assert.deepEqual(moved.clashes, []);
});
