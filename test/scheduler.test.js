const test = require('node:test');
const assert = require('node:assert/strict');
const { createPushScheduler } = require('../src/google/scheduler');

// Lets pending promises (the fake push) finish.
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(results) {
  const calls = { push: 0, expired: 0 };
  const queue = [...results];
  const scheduler = createPushScheduler({
    push: async () => {
      calls.push += 1;
      return queue.length > 0 ? queue.shift() : { ok: true };
    },
    isEnabled: () => setup.enabled,
    onAuthExpired: () => { calls.expired += 1; },
  });
  return { scheduler, calls };
}
setup.enabled = true;

test('changes are pushed 2 s after the last one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { scheduler, calls } = setup([]);
  scheduler.changed();
  t.mock.timers.tick(1500);
  scheduler.changed();
  t.mock.timers.tick(1500);
  assert.equal(calls.push, 0);
  t.mock.timers.tick(500);
  await flush();
  assert.equal(calls.push, 1);
  scheduler.stop();
});

test('a failed push is retried after 5 minutes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { scheduler, calls } = setup([{ ok: false, error: 'offline', authExpired: false }]);
  await scheduler.pushNow();
  assert.equal(calls.push, 1);
  t.mock.timers.tick(4 * 60 * 1000);
  await flush();
  assert.equal(calls.push, 1);
  t.mock.timers.tick(60 * 1000);
  await flush();
  assert.equal(calls.push, 2);
  scheduler.stop();
});

test('expired sign-in notifies once and stops automatic pushes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const expired = { ok: false, error: 'invalid_grant', authExpired: true };
  const { scheduler, calls } = setup([expired, expired]);
  await scheduler.pushNow();
  assert.equal(calls.expired, 1);
  assert.equal(scheduler.isAuthExpired(), true);
  // No retry loop and no pushes on changes while the sign-in is expired.
  scheduler.changed();
  t.mock.timers.tick(10 * 60 * 1000);
  await flush();
  assert.equal(calls.push, 1);
  // "Push now" still tries, but doesn't notify a second time.
  await scheduler.pushNow();
  assert.equal(calls.push, 2);
  assert.equal(calls.expired, 1);
  // After reconnecting, pushes work again.
  scheduler.reconnected();
  assert.equal(scheduler.isAuthExpired(), false);
  scheduler.changed();
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(calls.push, 3);
  scheduler.stop();
});

test('nothing is pushed while Google push is off', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  setup.enabled = false;
  const { scheduler, calls } = setup([]);
  scheduler.start();
  scheduler.changed();
  t.mock.timers.tick(10000);
  await flush();
  assert.equal(calls.push, 0);
  setup.enabled = true;
  scheduler.stop();
});

test('a change during a push triggers one more push afterwards', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release;
  let count = 0;
  const scheduler = createPushScheduler({
    push: () => { count += 1; return new Promise((resolve) => { release = () => resolve({ ok: true }); }); },
    isEnabled: () => true,
    onAuthExpired: () => {},
  });
  const first = scheduler.pushNow();
  scheduler.changed();
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(count, 1); // still busy
  release();
  await first;
  await flush();
  assert.equal(count, 2);
  release();
  await flush();
  scheduler.stop();
});

test('a push that throws is treated as a failure and retried', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const scheduler = createPushScheduler({
    push: async () => {
      count += 1;
      if (count === 1) throw new Error('keyring locked');
      return { ok: true };
    },
    isEnabled: () => true,
    onAuthExpired: () => {},
  });
  const result = await scheduler.pushNow();
  assert.deepEqual(result, { ok: false, error: 'keyring locked', authExpired: false });
  t.mock.timers.tick(5 * 60 * 1000);
  await flush();
  assert.equal(count, 2);
  scheduler.stop();
});

test('pushes again by itself 30 minutes after the last push', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { scheduler, calls } = setup([]);
  await scheduler.pushNow();
  t.mock.timers.tick(29 * 60 * 1000);
  await flush();
  assert.equal(calls.push, 1);
  t.mock.timers.tick(60 * 1000);
  await flush();
  assert.equal(calls.push, 2);
  // ...and keeps doing so.
  t.mock.timers.tick(30 * 60 * 1000);
  await flush();
  assert.equal(calls.push, 3);
  // A push in between (after a change) restarts the 30 minutes.
  t.mock.timers.tick(20 * 60 * 1000);
  scheduler.changed();
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(calls.push, 4);
  t.mock.timers.tick(20 * 60 * 1000);
  await flush();
  assert.equal(calls.push, 4);
  scheduler.stop();
});

test('the 30-minute push is skipped while push is turned off', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { scheduler, calls } = setup([]);
  await scheduler.pushNow();
  setup.enabled = false;
  t.mock.timers.tick(60 * 60 * 1000);
  await flush();
  setup.enabled = true;
  assert.equal(calls.push, 1);
  scheduler.stop();
});
