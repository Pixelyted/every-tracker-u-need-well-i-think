const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/time');

test('parseTime accepts dot, colon and single-digit hour', () => {
  for (const s of ['7.00', '07.00', '7:00', '07:00']) assert.equal(t.parseTime(s), '07:00');
  assert.equal(t.parseTime('15.30'), '15:30');
  for (const s of ['25:00', '7.60', '', 'abc']) assert.equal(t.parseTime(s), null);
});

test('toMinutes/fromMinutes round-trip', () => {
  assert.equal(t.toMinutes('09:40'), 580);
  assert.equal(t.toMinutes('24:00'), 1440);
  assert.equal(t.fromMinutes(580), '09:40');
});

test('formatTime uses a dot', () => {
  assert.equal(t.formatTime('07:00'), '07.00');
});

test('weekdayOf is Monday-based', () => {
  assert.equal(t.weekdayOf('2026-11-23'), 1);
  assert.equal(t.weekdayOf('2026-11-29'), 7);
  assert.equal(t.weekdayOf('2026-12-05'), 6);
});

test('date math', () => {
  assert.equal(t.addDays('2026-11-30', 5), '2026-12-05');
  assert.equal(t.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(t.daysBetween('2026-08-24', '2026-11-23'), 91);
  assert.equal(t.mondayOf('2026-11-28'), '2026-11-23');
});

test('isoWeek', () => {
  assert.equal(t.isoWeek('2026-11-21'), 47);
  assert.equal(t.isoWeek('2026-11-23'), 48);
  assert.equal(t.isoWeek('2026-01-01'), 1);
  assert.equal(t.isoWeek('2026-12-31'), 53);
});

test('firstOnOrAfter', () => {
  assert.equal(t.firstOnOrAfter('2026-08-26', 1), '2026-08-31');
  assert.equal(t.firstOnOrAfter('2026-08-24', 1), '2026-08-24');
});

test('datesInRange', () => {
  assert.deepEqual(t.datesInRange('2026-11-26', '2026-11-28'), ['2026-11-26', '2026-11-27', '2026-11-28']);
  assert.deepEqual(t.datesInRange('2026-11-28', '2026-11-26'), []);
});

test('compareSlot orders by date then time', () => {
  assert.equal(t.compareSlot('2026-11-23', '09:00', '2026-11-23', '10:00'), -1);
  assert.equal(t.compareSlot('2026-11-24', '09:00', '2026-11-23', '23:00'), 1);
  assert.equal(t.compareSlot('2026-11-23', '09:00', '2026-11-23', '09:00'), 0);
});
