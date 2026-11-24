const test = require('node:test');
const assert = require('node:assert/strict');
const { deadlineStatus, bountyList, deadlinesByDate } = require('../src/deadlines');

const now = { date: '2026-11-24', time: '10:00' };

function bounty(id, name, dueDate, dueTime = '23:59', done = false) {
  return { id, name, dueDate, dueTime, note: null, done };
}

test('status: open, overdue at the due minute, done wins', () => {
  assert.equal(deadlineStatus(bounty(1, 'A', '2026-11-24', '10:01'), now), 'open');
  assert.equal(deadlineStatus(bounty(1, 'A', '2026-11-24', '10:00'), now), 'overdue');
  assert.equal(deadlineStatus(bounty(1, 'A', '2026-11-20'), now), 'overdue');
  assert.equal(deadlineStatus(bounty(1, 'A', '2026-11-20', '23:59', true), now), 'done');
});

test('the panel: overdue first, then the next 14 days, by due moment; done and far ones left out', () => {
  const list = bountyList([
    bounty(1, 'Far away', '2026-12-09'), // 15 days ahead
    bounty(2, 'Report', '2026-11-27', '08:00'),
    bounty(3, 'Late essay', '2026-11-22'),
    bounty(4, 'Done already', '2026-11-25', '23:59', true),
    bounty(5, 'Lab', '2026-11-27', '07:00'),
    bounty(6, 'Edge', '2026-12-08'), // exactly 14 days ahead
  ], now);
  assert.deepEqual(list.map((b) => b.name), ['Late essay', 'Lab', 'Report', 'Edge']);
  assert.deepEqual(list.map((b) => b.status), ['overdue', 'open', 'open', 'open']);
  assert.deepEqual(list.map((b) => b.daysLeft), [-2, 3, 3, 14]);
});

test("the week's bounties by date, done ones included, sorted by time", () => {
  const days = deadlinesByDate([
    bounty(1, 'Late', '2026-11-23', '23:59'),
    bounty(2, 'Quiz prep', '2026-11-25', '12:00', true),
    bounty(3, 'Homework', '2026-11-25', '08:00'),
    bounty(4, 'Next week', '2026-12-01'),
  ], '2026-11-23', '2026-11-29', now);
  assert.deepEqual(Object.keys(days).sort(), ['2026-11-23', '2026-11-25']);
  assert.equal(days['2026-11-23'][0].status, 'overdue');
  assert.deepEqual(days['2026-11-25'].map((b) => [b.name, b.status]), [['Homework', 'open'], ['Quiz prep', 'done']]);
});
