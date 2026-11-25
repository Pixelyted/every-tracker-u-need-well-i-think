const test = require('node:test');
const assert = require('node:assert/strict');
const {
  jakartaToday, eventToSlot, slotToEventTimes, cleanTitle, cleanBountyTitle, cleanNote,
} = require('../src/google/event-time');

test('a UTC dateTime becomes Jakarta date and time', () => {
  const slot = eventToSlot({
    start: { dateTime: '2026-11-30T13:00:00Z' }, end: { dateTime: '2026-11-30T14:30:00Z' },
  });
  assert.deepEqual(slot, {
    date: '2026-11-30', start: '20:00', endDate: null, end: '21:30', allDay: false,
  });
});

test('an offset dateTime is converted to Jakarta too', () => {
  const slot = eventToSlot({
    start: { dateTime: '2026-11-30T20:00:00+09:00' }, end: { dateTime: '2026-11-30T21:00:00+09:00' },
  });
  assert.equal(slot.start, '18:00');
});

test('an event running past midnight gets an endDate', () => {
  const slot = eventToSlot({
    start: { dateTime: '2026-11-30T20:00:00+07:00' }, end: { dateTime: '2026-12-01T02:00:00+07:00' },
  });
  assert.equal(slot.endDate, '2026-12-01');
  assert.equal(slot.end, '02:00');
});

test('an event ending exactly at midnight keeps endDate next day and end 00:00', () => {
  const ev = {
    start: { dateTime: '2026-11-30T20:00:00', timeZone: 'Asia/Jakarta' },
    end: { dateTime: '2026-12-01T00:00:00', timeZone: 'Asia/Jakarta' },
  };
  const slot = eventToSlot(ev);
  assert.equal(slot.endDate, '2026-12-01');
  assert.equal(slot.end, '00:00');
  assert.deepEqual(slotToEventTimes(slot), ev);
});

test('a one-day all-day event has no endDate', () => {
  const slot = eventToSlot({ start: { date: '2026-12-03' }, end: { date: '2026-12-04' } });
  assert.deepEqual(slot, {
    date: '2026-12-03', start: '00:00', endDate: null, end: '23:59', allDay: true,
  });
});

test('a three-day all-day event ends on the third day', () => {
  const slot = eventToSlot({ start: { date: '2026-12-03' }, end: { date: '2026-12-06' } });
  assert.equal(slot.endDate, '2026-12-05');
});

test('all-day end rolls over month and year', () => {
  const times = slotToEventTimes({
    date: '2026-12-31', start: '00:00', endDate: null, end: '23:59', allDay: true,
  });
  assert.deepEqual(times.end, { date: '2027-01-01' });
});

test('round trip gives back the original times', () => {
  const timed = {
    start: { dateTime: '2026-11-30T20:00:00', timeZone: 'Asia/Jakarta' },
    end: { dateTime: '2026-12-01T02:00:00', timeZone: 'Asia/Jakarta' },
  };
  assert.deepEqual(slotToEventTimes(eventToSlot(timed)), timed);
  const allDay = { start: { date: '2026-12-03' }, end: { date: '2026-12-06' } };
  assert.deepEqual(slotToEventTimes(eventToSlot(allDay)), allDay);
});

test('jakartaToday uses the Jakarta date, not the UTC one', () => {
  assert.equal(jakartaToday(new Date('2026-11-30T20:00:00Z')), '2026-12-01');
});

test('cleanTitle removes only a leading warning sign', () => {
  assert.equal(cleanTitle('⚠ Seminar'), 'Seminar');
  assert.equal(cleanTitle('Seminar'), 'Seminar');
});

test('cleanBountyTitle removes warning, scroll and due time', () => {
  assert.equal(cleanBountyTitle('⚠ 📜 Essay (due 23.59)'), 'Essay');
  assert.equal(cleanBountyTitle('📜 Essay (due 09.00)'), 'Essay');
  assert.equal(cleanBountyTitle('Essay'), 'Essay');
});

test('cleanNote removes the clash paragraph', () => {
  assert.equal(cleanNote('⚠ Clashes with: A (07.00–09.30)\n\nroom 3'), 'room 3');
  assert.equal(cleanNote('⚠ Clashes with: A (07.00–09.30)'), null);
  assert.equal(cleanNote('room 3'), 'room 3');
  assert.equal(cleanNote(''), null);
  assert.equal(cleanNote(undefined), null);
});

test('an offset-less dateTime is read as Jakarta wall time', () => {
  const slot = eventToSlot({
    start: { dateTime: '2026-11-30T20:00:00', timeZone: 'Asia/Jakarta' },
    end: { dateTime: '2026-11-30T21:00:00', timeZone: 'Asia/Jakarta' },
  });
  assert.equal(slot.date, '2026-11-30');
  assert.equal(slot.start, '20:00');
  assert.equal(slot.end, '21:00');
});
