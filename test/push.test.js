const test = require('node:test');
const assert = require('node:assert/strict');
const { planPush } = require('../src/google/push');
const { hashBody } = require('../src/google/payloads');

// The whole sync run (pull, then push) is tested in sync.test.js.

test('planPush: create, update, delete, unchanged and frozen', () => {
  const desired = [
    { localKey: 'quest:1', body: { summary: 'A' } },
    { localKey: 'quest:2', body: { summary: 'B' } },
    { localKey: 'quest:3', body: { summary: 'C' } },
  ];
  const mappings = [
    { localKey: 'quest:1', googleId: 'g1', hash: hashBody({ summary: 'A' }), frozen: 0 },
    { localKey: 'quest:2', googleId: 'g2', hash: 'old', frozen: 0 },
    { localKey: 'quest:9', googleId: 'g9', hash: 'x', frozen: 0 },
    { localKey: 'quest:8', googleId: 'g8', hash: 'x', frozen: 1 },
  ];
  const plan = planPush(desired, mappings);
  assert.deepEqual(plan.creates.map((d) => d.localKey), ['quest:3']);
  assert.deepEqual(plan.updates.map((u) => [u.desired.localKey, u.googleId]), [['quest:2', 'g2']]);
  assert.deepEqual(plan.deletes, [{ localKey: 'quest:9', googleId: 'g9' }]);
});
