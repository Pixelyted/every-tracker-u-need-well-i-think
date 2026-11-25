const test = require('node:test');
const assert = require('node:assert/strict');
const { validateQuest, validateMove, validateBreak, validateSemester } = require('../src/validate');

const semester = { id: 1, name: 'Autumn 2026', startDate: '2026-08-24', endDate: '2026-12-18', active: 1 };
const world = { semester, quests: [], changes: [], breaks: [] };
const MIDNIGHT = "End time must be after start time (quests can't run past midnight)";

test('rejects end before or equal to start', () => {
  const base = { kind: 'side', repeat: 'once', name: 'X', date: '2026-11-23' };
  assert.ok(validateQuest({ ...base, start: '19:00', end: '05:00' }, world).includes(MIDNIGHT));
  assert.ok(validateQuest({ ...base, start: '07:00', end: '07:00' }, world).includes(MIDNIGHT));
});

test("accepts the spec's seminar", () => {
  const seminar = { kind: 'side', repeat: 'once', name: 'Seminar', date: '2026-11-23', start: '05:00', end: '19:00' };
  assert.deepEqual(validateQuest(seminar, world), []);
});

test('limited event may span days', () => {
  const olympiad = { kind: 'limited', name: 'Olympiad', startDate: '2026-11-26', start: '09:00', endDate: '2026-11-29', end: '00:00' };
  assert.deepEqual(validateQuest(olympiad, world), []);
  assert.notDeepEqual(validateQuest({ ...olympiad, endDate: '2026-11-25' }, world), []);
});

test('weekly quest without active semester', () => {
  const weekly = { kind: 'main', repeat: 'weekly', name: 'Potion Brewing 101', weekday: 1, start: '07:00', end: '09:30' };
  assert.deepEqual(validateQuest(weekly, world), []);
  assert.notDeepEqual(validateQuest(weekly, { ...world, semester: null }), []);
});

test('break outside semester; blank name', () => {
  assert.deepEqual(validateBreak({ name: 'Midterms', startDate: '2026-10-12', endDate: '2026-10-16' }, semester), []);
  assert.notDeepEqual(validateBreak({ name: 'Holiday', startDate: '2026-12-20', endDate: '2026-12-31' }, semester), []);
  assert.notDeepEqual(validateQuest({ kind: 'side', repeat: 'once', name: '  ', date: '2026-11-23', start: '05:00', end: '19:00' }, world), []);
});

test('move slot and semester checks', () => {
  assert.deepEqual(validateMove({ date: '2026-12-05', start: '08:00', end: '10:30' }), []);
  assert.ok(validateMove({ date: '2026-12-05', start: '10:30', end: '08:00' }).includes(MIDNIGHT));
  assert.deepEqual(validateSemester(semester), []);
  assert.notDeepEqual(validateSemester({ ...semester, endDate: '2026-08-01' }), []);
});

test('validateDeadline', () => {
  const { validateDeadline } = require('../src/validate');
  assert.deepEqual(validateDeadline({ name: 'HW', dueDate: '2026-11-27', dueTime: '23:59' }), []);
  assert.deepEqual(validateDeadline({ name: ' ', dueDate: '', dueTime: '25:00' }), [
    'Give the bounty a name', 'Pick the due date', 'The due time is not a valid time (try 23.59)',
  ]);
});

test('validateHabit', () => {
  const { validateHabit } = require('../src/validate');
  assert.deepEqual(validateHabit({ name: 'Read', kind: 'daily' }), []);
  assert.deepEqual(validateHabit({ name: 'Gym', kind: 'weekly', target: 3 }), []);
  assert.ok(validateHabit({ name: ' ', kind: 'daily' }).includes('Give the quest a name'));
  assert.ok(validateHabit({ name: 'X', kind: 'monthly' }).includes('Pick Daily or Weekly'));
  for (const target of [0, 8, 1.5, undefined]) {
    assert.ok(validateHabit({ name: 'X', kind: 'weekly', target }).includes('Pick a target from 1 to 7 days'));
  }
});

const validOnce = { kind: 'side', repeat: 'once', name: 'x', date: '2026-11-30', endDate: null, start: '20:00', end: '21:00' };

test('once quest over two dates may end earlier in the day than it starts', () => {
  const overnight = { ...validOnce, endDate: '2026-12-01', end: '02:00' };
  assert.deepEqual(validateQuest(overnight, world), []);
  assert.deepEqual(validateQuest({ ...overnight, endDate: '2026-11-29' }, world), ['The quest must end after it starts']);
});

test('an imported quest cannot become weekly or limited', () => {
  const msg = 'A quest from Google stays a one-time quest';
  assert.ok(validateQuest({ ...validOnce, origin: 'google', repeat: 'weekly', weekday: 1 }, world).includes(msg));
  assert.ok(validateQuest({ ...validOnce, origin: 'google', kind: 'limited' }, world).includes(msg));
  assert.deepEqual(validateQuest({ ...validOnce, origin: 'google' }, world), []);
});
