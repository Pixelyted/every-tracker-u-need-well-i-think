const test = require('node:test');
const assert = require('node:assert/strict');
const { startNotifier } = require('../src/notifier');
const { openStore } = require('../src/db');
const { nowFromDate } = require('../src/time');
const { makeWorld } = require('./fixtures');

function seededStore() {
  const store = openStore(':memory:');
  const { id, ...semester } = makeWorld().semester;
  store.saveSemester(semester);
  for (const { id: _i, ...q } of makeWorld().quests) store.saveQuest(q);
  return store;
}

// The fake clock reads the mocked Date, so it moves when timers are advanced.
const clock = () => nowFromDate(new Date());

test('fires Golem Mechanics at 15:15 once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: new Date(2026, 10, 25, 15, 14).getTime() });
  const calls = [];
  const notifier = startNotifier({ store: seededStore(), notify: (n) => calls.push(n), clock });
  assert.equal(calls.length, 0);
  t.mock.timers.tick(60 * 1000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, '⚔ Golem Mechanics starts in 15 min (15.30)');
  notifier.replan();
  t.mock.timers.tick(60 * 1000);
  assert.equal(calls.length, 1);
  notifier.stop();
});

test('a reminder already due fires right away', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: new Date(2026, 10, 25, 15, 24).getTime() });
  const calls = [];
  const notifier = startNotifier({ store: seededStore(), notify: (n) => calls.push(n), clock });
  t.mock.timers.tick(0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].title, '⚔ Golem Mechanics starts in 6 min (15.30)');
  notifier.stop();
});

test('no notifications when disabled', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: new Date(2026, 10, 25, 15, 14).getTime() });
  const store = seededStore();
  store.setSettings({ desktopNotifications: false });
  const calls = [];
  const notifier = startNotifier({ store, notify: (n) => calls.push(n), clock });
  t.mock.timers.tick(5 * 60 * 1000);
  assert.equal(calls.length, 0);
  notifier.stop();
});
