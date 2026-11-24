const test = require('node:test');
const assert = require('node:assert/strict');
const { planPush, runPush } = require('../src/google/push');
const { openStore } = require('../src/db');
const { makeWorld, seminar } = require('./fixtures');

function seededStore() {
  const store = openStore(':memory:');
  const { id, ...semester } = makeWorld().semester;
  store.saveSemester(semester);
  for (const { id: _i, ...q } of makeWorld().quests) store.saveQuest(q);
  return store;
}

// An in-memory stand-in for the Google Calendar API. It records every call
// and can be told to fail.
function fakeApi() {
  let nextId = 1;
  const api = {
    calendars: new Set(),
    events: new Map(),
    calls: [],
    failInsertAt: null, // throw {code:500} on this insert number (1-based)
    insertCount: 0,
    async getCalendar(id) {
      api.calls.push(['getCalendar', id]);
      if (!api.calendars.has(id)) throw { code: 404 };
      return { id };
    },
    async createCalendar(body) {
      api.calls.push(['createCalendar', body]);
      const id = 'cal' + nextId++;
      api.calendars.add(id);
      return id;
    },
    async insertEvent(calId, body) {
      api.calls.push(['insertEvent', calId]);
      api.insertCount += 1;
      if (api.insertCount === api.failInsertAt) throw { code: 500, message: 'boom' };
      const id = 'ev' + nextId++;
      api.events.set(id, body);
      return id;
    },
    async updateEvent(calId, eventId, body) {
      api.calls.push(['updateEvent', eventId]);
      if (!api.events.has(eventId)) throw { code: 404 };
      api.events.set(eventId, body);
    },
    async deleteEvent(calId, eventId) {
      api.calls.push(['deleteEvent', eventId]);
      if (!api.events.has(eventId)) throw { code: 410 };
      api.events.delete(eventId);
    },
  };
  return api;
}

const eventCalls = (api) => api.calls.filter(([name]) => name.endsWith('Event'));

test('planPush: create, update, delete, unchanged and frozen', () => {
  const desired = [
    { localKey: 'quest:1', body: { summary: 'A' } },
    { localKey: 'quest:2', body: { summary: 'B' } },
    { localKey: 'quest:3', body: { summary: 'C' } },
  ];
  const { hashBody } = require('../src/google/payloads');
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

test('first push creates calendar and all events', async () => {
  const store = seededStore();
  const api = fakeApi();
  const result = await runPush({ api, store });
  assert.equal(result.ok, true);
  const creates = api.calls.filter(([n]) => n === 'createCalendar');
  assert.deepEqual(creates, [['createCalendar', { summary: '⚔ every tracker u need, well i think', timeZone: 'Asia/Jakarta' }]]);
  assert.equal(api.calls.filter(([n]) => n === 'insertEvent').length, 7);
  assert.equal(store.listMappings().length, 7);
  assert.equal(store.getSettings().googleCalendarId, 'cal1');
  assert.equal(store.getSettings().lastPush.ok, true);
});

test('second push with no changes does nothing', async () => {
  const store = seededStore();
  const api = fakeApi();
  await runPush({ api, store });
  api.calls = [];
  const result = await runPush({ api, store });
  assert.equal(result.ok, true);
  assert.deepEqual(eventCalls(api), []);
  assert.equal(api.events.size, 7);
});

test('edit → update, delete → delete', async () => {
  const store = seededStore();
  const api = fakeApi();
  await runPush({ api, store });
  const q1 = store.getWorld().quests[0];
  store.saveQuest({ ...q1, name: 'Potion Brewing I' });
  store.deleteQuest(2);
  api.calls = [];
  const result = await runPush({ api, store });
  assert.deepEqual(result.counts, { created: 0, updated: 1, deleted: 1 });
  assert.equal(api.calls.filter(([n]) => n === 'updateEvent').length, 1);
  assert.equal(api.calls.filter(([n]) => n === 'deleteEvent').length, 1);
  assert.equal(api.events.size, 6);
  assert.equal(store.listMappings().length, 6);
});

test('event deleted in Google is recreated', async () => {
  const store = seededStore();
  const api = fakeApi();
  await runPush({ api, store });
  const oldId = store.listMappings().find((m) => m.localKey === 'quest:1').googleId;
  api.events.delete(oldId);
  store.saveQuest({ ...store.getWorld().quests[0], note: 'room 3.2' });
  await runPush({ api, store });
  const newId = store.listMappings().find((m) => m.localKey === 'quest:1').googleId;
  assert.notEqual(newId, oldId);
  assert.ok(api.events.has(newId));
});

test('calendar deleted in Google', async () => {
  const store = seededStore();
  const api = fakeApi();
  await runPush({ api, store });
  api.calendars.clear();
  api.events.clear();
  api.calls = [];
  const result = await runPush({ api, store });
  assert.equal(result.ok, true);
  assert.equal(api.calls.filter(([n]) => n === 'createCalendar').length, 1);
  assert.equal(api.calls.filter(([n]) => n === 'insertEvent').length, 7);
  assert.equal(store.getSettings().googleCalendarId, 'cal9');
});

test('failure keeps progress', async () => {
  const store = seededStore();
  const api = fakeApi();
  api.failInsertAt = 4;
  const result = await runPush({ api, store });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'boom');
  assert.equal(store.listMappings().length, 3);
  assert.equal(store.getSettings().lastPush.ok, false);
  api.calls = [];
  const again = await runPush({ api, store });
  assert.equal(again.ok, true);
  assert.equal(api.calls.filter(([n]) => n === 'insertEvent').length, 4);
  assert.equal(store.listMappings().length, 7);
});

test('frozen mappings are never touched', async () => {
  const store = seededStore();
  // On a Saturday, so archiving the classes doesn't change its clash text.
  store.saveQuest({ ...seminar, id: undefined, date: '2026-11-28' });
  const api = fakeApi();
  await runPush({ api, store });
  store.startNewSemester({ name: 'Genap 2027', startDate: '2027-02-01', endDate: '2027-06-11' });
  api.calls = [];
  const result = await runPush({ api, store });
  assert.equal(result.ok, true);
  assert.deepEqual(eventCalls(api), []);
  assert.equal(api.events.size, 8);
  assert.equal(store.listMappings().filter((m) => m.frozen === 1).length, 7);
});

test('expired sign-in is reported separately', async () => {
  const store = seededStore();
  const api = fakeApi();
  api.createCalendar = async () => { throw { code: 401, authExpired: true, message: 'invalid_grant' }; };
  const result = await runPush({ api, store });
  assert.equal(result.ok, false);
  assert.equal(result.authExpired, true);
  assert.equal(store.getSettings().lastPush.authExpired, true);
  // A normal failure is not an expired sign-in.
  api.createCalendar = async () => { throw { code: 500, message: 'boom' }; };
  const other = await runPush({ api, store });
  assert.equal(other.authExpired, false);
  assert.equal(store.getSettings().lastPush.authExpired, false);
});

test('event deleted in Google comes back even when nothing changed locally', async () => {
  const store = seededStore();
  const api = fakeApi();
  // The real API can list the ids in OUR calendar; deleted ones show as cancelled.
  api.listEvents = async () => [...api.events.keys()].map((id) => ({ id, status: api.cancelled && api.cancelled.has(id) ? 'cancelled' : 'confirmed' }));
  await runPush({ api, store });
  const gone = store.listMappings().find((m) => m.localKey === 'quest:3').googleId;
  api.cancelled = new Set([gone]);
  api.calls = [];
  const result = await runPush({ api, store });
  assert.equal(result.ok, true);
  assert.equal(api.calls.filter(([n]) => n === 'insertEvent').length, 1);
  assert.notEqual(store.listMappings().find((m) => m.localKey === 'quest:3').googleId, gone);
  // Next push: everything is in place, nothing to send.
  api.calls = [];
  await runPush({ api, store });
  assert.deepEqual(eventCalls(api), []);
});

// A fake whose listEvents works like the real API's.
function listingApi() {
  const api = fakeApi();
  api.listEvents = async () => [...api.events.keys()].map((id) => ({ id, status: 'confirmed' }));
  return api;
}

test('an insert whose answer got lost does not leave a duplicate', async () => {
  const store = seededStore();
  const api = listingApi();
  // Google stores the 2nd event, but the answer never reaches the app.
  const realInsert = api.insertEvent;
  let n = 0;
  api.insertEvent = async (calId, body) => {
    n += 1;
    const id = await realInsert(calId, body);
    if (n === 2) throw { code: 0, message: 'socket hang up' };
    return id;
  };
  assert.equal((await runPush({ api, store })).ok, false);
  assert.equal(api.events.size, 2); // one of them has no mapping
  assert.equal((await runPush({ api, store })).ok, true);
  assert.equal(api.events.size, 7);
  const mapped = new Set(store.listMappings().map((m) => m.googleId));
  assert.deepEqual([...api.events.keys()].filter((id) => !mapped.has(id)), []);
});

test('the sweep never deletes events of an archived semester', async () => {
  const store = seededStore();
  const api = listingApi();
  await runPush({ api, store });
  store.startNewSemester({ name: 'Genap 2027', startDate: '2027-02-01', endDate: '2027-06-11' });
  api.calls = [];
  await runPush({ api, store });
  assert.equal(api.calls.filter(([n]) => n === 'deleteEvent').length, 0);
  assert.equal(api.events.size, 7);
});

// Like listingApi, plus "exceptions": what Google stores when ONE week of a
// recurring series is deleted ('cancelled') or edited ('confirmed') there.
function exceptionApi() {
  const api = listingApi();
  api.exceptions = [];
  const listSeries = api.listEvents;
  api.listEvents = async () => (await listSeries()).concat(api.exceptions);
  return api;
}

// What Google lists after one week of a series is deleted or edited there.
function weekChangedInGoogle(seriesId, startDateTime, status) {
  return { id: seriesId + '_x', status, recurringEventId: seriesId, originalStartTime: { dateTime: startDateTime } };
}

test('one week of a weekly class deleted in Google comes back', async () => {
  const store = seededStore();
  const api = exceptionApi();
  await runPush({ api, store });
  const series = store.listMappings().find((m) => m.localKey === 'quest:1').googleId;
  // Potion Brewing 101 on Monday 2026-11-30, 07:00 Jakarta = 00:00 UTC.
  api.exceptions.push(weekChangedInGoogle(series, '2026-11-30T00:00:00Z', 'cancelled'));
  api.calls = [];
  assert.equal((await runPush({ api, store })).ok, true);
  // The whole series is replaced by a fresh copy without the deletion.
  assert.deepEqual(eventCalls(api).map(([n]) => n), ['deleteEvent', 'insertEvent']);
  assert.ok(!api.events.has(series));
  assert.notEqual(store.listMappings().find((m) => m.localKey === 'quest:1').googleId, series);
  // The old exception belongs to the deleted series: nothing more to do.
  api.calls = [];
  await runPush({ api, store });
  assert.deepEqual(eventCalls(api), []);
});

test('one week of a weekly class edited in Google is put back, not deleted', async () => {
  const store = seededStore();
  const api = exceptionApi();
  await runPush({ api, store });
  const series = store.listMappings().find((m) => m.localKey === 'quest:1').googleId;
  api.exceptions.push(weekChangedInGoogle(series, '2026-11-30T07:00:00+07:00', 'confirmed'));
  api.calls = [];
  await runPush({ api, store });
  // The edited week is not deleted on its own (that would cancel that week).
  assert.ok(!api.calls.some(([n, id]) => n === 'deleteEvent' && id === series + '_x'));
  assert.deepEqual(eventCalls(api).map(([n]) => n), ['deleteEvent', 'insertEvent']);
});

test("a week the app itself left out of a series doesn't count as a change", async () => {
  const store = seededStore();
  store.setChange({ questId: 1, originalDate: '2026-11-30', action: 'skip' }); // EXDATE in the series
  const api = exceptionApi();
  await runPush({ api, store });
  const series = store.listMappings().find((m) => m.localKey === 'quest:1').googleId;
  api.exceptions.push(weekChangedInGoogle(series, '2026-11-30T07:00:00+07:00', 'cancelled'));
  api.calls = [];
  await runPush({ api, store });
  assert.deepEqual(eventCalls(api), []);
});

test('ticking a bounty done removes it from Google; unticking puts it back', async () => {
  const store = seededStore();
  const api = listingApi();
  const id = store.saveDeadline({ name: 'Calc HW', dueDate: '2026-11-27', dueTime: '23:59' });
  await runPush({ api, store });
  assert.equal(api.events.size, 8);
  store.setDeadlineDone(id, true);
  await runPush({ api, store });
  assert.equal(api.events.size, 7);
  assert.equal(store.listMappings().some((m) => m.localKey === 'deadline:' + id), false);
  store.setDeadlineDone(id, false);
  await runPush({ api, store });
  assert.equal(api.events.size, 8);
});
