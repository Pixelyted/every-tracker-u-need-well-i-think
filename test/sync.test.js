const test = require('node:test');
const assert = require('node:assert/strict');
const { runSync } = require('../src/google/sync');
const { openStore } = require('../src/db');
const { makeWorld, seminar } = require('./fixtures');
const { fakeGoogle, writeCalls } = require('./fake-google');

// "Now" for every sync: Thursday 2026-11-26, 10:00 in Jakarta.
const NOW = new Date('2026-11-26T03:00:00Z');

function seededStore() {
  const store = openStore(':memory:');
  const { id, ...semester } = makeWorld().semester;
  store.saveSemester(semester);
  for (const { id: _i, ...q } of makeWorld().quests) store.saveQuest(q);
  return store;
}

function sync(api, store, options = {}) {
  return runSync({ api, store, now: NOW, ...options });
}

const calIdOf = (store) => store.getSettings().googleCalendarId;
const mappingOf = (store, localKey) => store.listMappings().find((m) => m.localKey === localKey);
const named = (api, name) => api.calls.filter(([n]) => n === name);

// Everything the app keeps, to check a sync changed nothing.
function snapshot(store) {
  return { world: store.getWorld(), deadlines: store.listDeadlines(), mappings: store.listMappings() };
}

function at(date, time) {
  return { dateTime: `${date}T${time}:00+07:00` };
}

// ---------- the ⚔ calendar (as the old one-way push) ----------

test('first sync of a fresh store pushes everything (as before)', async () => {
  const store = seededStore();
  const api = fakeGoogle();
  const result = await sync(api, store);
  assert.equal(result.ok, true);
  assert.deepEqual(named(api, 'createCalendar'), [['createCalendar', { summary: '⚔ every tracker u need, well i think', timeZone: 'Asia/Jakarta' }]]);
  assert.equal(named(api, 'insertEvent').length, 7);
  assert.deepEqual(result.counts, { created: 7, updated: 0, deleted: 0, pulled: 0 });
  assert.equal(result.heldDeletes, null);
  assert.equal(store.listMappings().length, 7);
  assert.equal(store.getSettings().lastPush.ok, true);
  assert.equal(store.getSettings().lastPush.heldDeletes, null);
});

test('a second sync right after a push changes nothing', async () => {
  const store = seededStore();
  store.saveQuest({ ...seminar, id: undefined, date: '2026-11-28' });
  store.saveDeadline({ name: 'Calc HW', dueDate: '2026-11-27', dueTime: '23:59' });
  store.setChange({ questId: 1, originalDate: '2026-11-30', action: 'move', newDate: '2026-12-05', newStart: '08:00', newEnd: '10:30' });
  const api = fakeGoogle();
  await sync(api, store);
  const before = snapshot(store);
  api.calls = [];
  const result = await sync(api, store);
  assert.equal(result.ok, true);
  assert.deepEqual(writeCalls(api), []);
  assert.deepEqual(snapshot(store), before);
});

test('edit → update, delete → delete', async () => {
  const store = seededStore();
  const api = fakeGoogle();
  await sync(api, store);
  store.saveQuest({ ...store.getQuest(1), name: 'Potion Brewing I' });
  store.deleteQuest(2);
  const result = await sync(api, store);
  assert.deepEqual(result.counts, { created: 0, updated: 1, deleted: 1, pulled: 0 });
  assert.equal(api.liveCount(calIdOf(store)), 6);
  assert.equal(store.listMappings().length, 6);
});

test('a weekly class deleted in Google comes back', async () => {
  const store = seededStore();
  const api = fakeGoogle();
  await sync(api, store);
  const oldId = mappingOf(store, 'quest:3').googleId;
  await api.deleteEvent(calIdOf(store), oldId);
  api.calls = [];
  assert.equal((await sync(api, store)).ok, true);
  assert.equal(named(api, 'insertEvent').length, 1);
  assert.notEqual(mappingOf(store, 'quest:3').googleId, oldId);
  api.calls = [];
  await sync(api, store);
  assert.deepEqual(writeCalls(api), []);
});

test('calendar deleted in Google is re-created and filled', async () => {
  const store = seededStore();
  const api = fakeGoogle();
  await sync(api, store);
  api.calendars.delete(calIdOf(store));
  api.calls = [];
  const result = await sync(api, store);
  assert.equal(result.ok, true);
  assert.equal(named(api, 'createCalendar').length, 1);
  assert.equal(named(api, 'insertEvent').length, 7);
  assert.equal(store.getWorld().quests.length, 7); // nothing read as deleted
});

test('failure keeps progress', async () => {
  const store = seededStore();
  const api = fakeGoogle();
  api.failInsertAt = 4;
  const result = await sync(api, store);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'boom');
  assert.equal(store.listMappings().length, 3);
  assert.equal(store.getSettings().lastPush.ok, false);
  api.calls = [];
  assert.equal((await sync(api, store)).ok, true);
  assert.equal(named(api, 'insertEvent').length, 4);
  assert.equal(store.listMappings().length, 7);
});

test('frozen mappings are never touched', async () => {
  const store = seededStore();
  store.saveQuest({ ...seminar, id: undefined, date: '2026-11-28' });
  const api = fakeGoogle();
  await sync(api, store);
  store.startNewSemester({ name: 'Genap 2027', startDate: '2027-02-01', endDate: '2027-06-11' });
  api.calls = [];
  assert.equal((await sync(api, store)).ok, true);
  assert.deepEqual(writeCalls(api), []);
  assert.equal(store.listMappings().filter((m) => m.frozen === 1).length, 7);
});

test('expired sign-in is reported separately', async () => {
  const store = seededStore();
  const api = fakeGoogle();
  api.createCalendar = async () => { throw { code: 401, authExpired: true, message: 'invalid_grant' }; };
  const result = await sync(api, store);
  assert.equal(result.ok, false);
  assert.equal(result.authExpired, true);
  assert.equal(store.getSettings().lastPush.authExpired, true);
  api.createCalendar = async () => { throw { code: 500, message: 'boom' }; };
  assert.equal((await sync(api, store)).authExpired, false);
});

test('an insert whose answer got lost is adopted, not duplicated', async () => {
  const store = seededStore();
  const api = fakeGoogle();
  const realInsert = api.insertEvent;
  let n = 0;
  api.insertEvent = async (calId, body) => {
    n += 1;
    const written = await realInsert(calId, body);
    if (n === 2) throw { code: 0, message: 'socket hang up' };
    return written;
  };
  assert.equal((await sync(api, store)).ok, false);
  assert.equal((await sync(api, store)).ok, true);
  assert.equal(api.liveCount(calIdOf(store)), 7);
  const mapped = new Set(store.listMappings().map((m) => m.googleId));
  assert.deepEqual([...api.eventsOf(calIdOf(store)).keys()].filter((id) => !mapped.has(id)), []);
});

test('ticking a bounty done removes it from Google; unticking puts it back', async () => {
  const store = seededStore();
  const api = fakeGoogle();
  const id = store.saveDeadline({ name: 'Calc HW', dueDate: '2026-11-27', dueTime: '23:59' });
  await sync(api, store);
  assert.equal(api.liveCount(calIdOf(store)), 8);
  store.setDeadlineDone(id, true);
  await sync(api, store);
  assert.equal(api.liveCount(calIdOf(store)), 7);
  store.setDeadlineDone(id, false);
  await sync(api, store);
  assert.equal(api.liveCount(calIdOf(store)), 8);
});

// ---------- changes made in Google ----------

test('moving one week in Google creates a make-up and rebuilds the series', async () => {
  const store = seededStore();
  const api = fakeGoogle();
  await sync(api, store);
  const calId = calIdOf(store);
  const series = mappingOf(store, 'quest:1').googleId;
  // Potion Brewing 101 of Monday 2026-11-30 moved to Tuesday 13:00 on the phone.
  api.addEvent(calId, {
    recurringEventId: series, originalStartTime: at('2026-11-30', '07:00'),
    start: at('2026-12-01', '13:00'), end: at('2026-12-01', '15:30'), summary: 'Potion Brewing 101', localKey: 'quest:1',
  });
  api.calls = [];
  const result = await sync(api, store);
  assert.equal(result.ok, true);
  assert.equal(result.counts.pulled, 1);
  const change = store.getWorld().changes[0];
  assert.deepEqual([change.action, change.originalDate, change.newDate, change.newStart, change.newEnd], ['move', '2026-11-30', '2026-12-01', '13:00', '15:30']);
  assert.ok(api.calls.some(([n, c, id]) => n === 'deleteEvent' && c === calId && id === series));
  assert.notEqual(mappingOf(store, 'quest:1').googleId, series);
  assert.ok(mappingOf(store, 'makeup:' + change.id));
  // Done: the next sync has nothing to do.
  api.calls = [];
  await sync(api, store);
  assert.deepEqual(writeCalls(api), []);
});

test('a failing series rebuild fails the whole sync', async () => {
  const store = seededStore();
  const api = fakeGoogle();
  await sync(api, store);
  const series = mappingOf(store, 'quest:1').googleId;
  api.addEvent(calIdOf(store), { recurringEventId: series, originalStartTime: at('2026-11-30', '07:00'), status: 'cancelled', start: at('2026-11-30', '07:00'), end: at('2026-11-30', '09:30') });
  api.deleteEvent = async () => { throw { code: 500, message: 'boom' }; };
  const result = await sync(api, store);
  assert.equal(result.ok, false);
  assert.equal(mappingOf(store, 'quest:1').googleId, series);
});

test('six deletions from Google are held; allowManyDeletes applies them', async () => {
  const store = seededStore();
  for (let day = 1; day <= 6; day += 1) {
    store.saveQuest({ kind: 'side', repeat: 'once', name: 'Errand ' + day, date: `2026-12-0${day}`, start: '19:00', end: '20:00' });
  }
  const api = fakeGoogle();
  await sync(api, store);
  const calId = calIdOf(store);
  for (const m of store.listMappings().filter((m) => Number(m.localKey.split(':')[1]) > 7)) {
    await api.deleteEvent(calId, m.googleId);
  }
  api.calls = [];
  const held = await sync(api, store);
  assert.equal(held.ok, true);
  assert.equal(held.heldDeletes, 6);
  assert.equal(store.getSettings().lastPush.heldDeletes, 6);
  assert.equal(store.getWorld().quests.length, 13);
  assert.deepEqual(writeCalls(api), []); // nothing re-created either
  const allowed = await sync(api, store, { allowManyDeletes: true });
  assert.equal(allowed.heldDeletes, null);
  assert.equal(allowed.counts.pulled, 6);
  assert.equal(store.getWorld().quests.length, 7);
  assert.equal(store.listMappings().length, 7);
});

test('a failing list call leaves the store untouched', async () => {
  for (const failing of ['listEvents', 'listMainEvents']) {
    const store = seededStore();
    store.setSettings({ googleMainSync: true });
    const api = fakeGoogle();
    await sync(api, store);
    // Google has changes waiting: one class deleted, a new phone event.
    await api.deleteEvent(calIdOf(store), mappingOf(store, 'quest:2').googleId);
    api.addEvent('primary', { summary: 'Dentist', start: at('2026-12-02', '10:00'), end: at('2026-12-02', '11:00') });
    const before = snapshot(store);
    api.failList = failing;
    api.calls = [];
    const result = await sync(api, store);
    assert.equal(result.ok, false, failing);
    assert.deepEqual(writeCalls(api), []);
    assert.deepEqual(snapshot(store), before);
  }
});

// ---------- the main calendar ----------

function mainStore() {
  const store = seededStore();
  store.setSettings({ googleMainSync: true });
  return store;
}

test('a phone event in the main calendar becomes a quest and is not copied into ⚔', async () => {
  const store = mainStore();
  const api = fakeGoogle();
  const ev = api.addEvent('primary', { summary: 'Dentist', description: 'bring card', start: at('2026-12-02', '10:00'), end: at('2026-12-02', '11:00') });
  const result = await sync(api, store);
  assert.equal(result.ok, true);
  const quest = store.getWorld().quests.find((q) => q.origin === 'google');
  assert.deepEqual([quest.name, quest.note, quest.date, quest.start, quest.end, quest.googleLocked], ['Dentist', 'bring card', '2026-12-02', '10:00', '11:00', false]);
  const m = mappingOf(store, 'quest:' + quest.id);
  assert.deepEqual([m.calendar, m.googleId, m.googleUpdated], ['main', ev.id, ev.updated]);
  assert.equal(named(api, 'insertEvent').length, 7); // only the classes
  assert.deepEqual(named(api, 'patchEvent'), []); // nothing echoed back
  api.calls = [];
  await sync(api, store);
  assert.deepEqual(writeCalls(api), []);
});

test('editing an imported quest in the app patches only summary/description/start/end', async () => {
  const store = mainStore();
  const api = fakeGoogle();
  const ev = api.addEvent('primary', { summary: 'Dentist', start: at('2026-12-02', '10:00'), end: at('2026-12-02', '11:00') });
  await sync(api, store);
  const quest = store.getWorld().quests.find((q) => q.origin === 'google');
  store.saveQuest({ ...quest, name: 'Dentist (moved)', start: '14:00', end: '15:00' });
  api.calls = [];
  const result = await sync(api, store);
  assert.equal(result.counts.updated, 1);
  const writes = writeCalls(api);
  assert.equal(writes.length, 1);
  const [name, calId, eventId, body] = writes[0];
  assert.deepEqual([name, calId, eventId], ['patchEvent', 'primary', ev.id]);
  assert.deepEqual(Object.keys(body).sort(), ['description', 'end', 'start', 'summary']);
  assert.equal(body.summary, 'Dentist (moved)');
  assert.equal(api.eventsOf('primary').get(ev.id).start.dateTime, '2026-12-02T14:00:00');
  api.calls = [];
  await sync(api, store);
  assert.deepEqual(writeCalls(api), []);
});

test('deleting an imported quest in the app deletes it in Google; a locked one is only hidden', async () => {
  const store = mainStore();
  const api = fakeGoogle();
  const own = api.addEvent('primary', { summary: 'Dentist', start: at('2026-12-02', '10:00'), end: at('2026-12-02', '11:00') });
  const invite = api.addEvent('primary', { summary: 'Team meeting', organizerSelf: false, start: at('2026-12-03', '10:00'), end: at('2026-12-03', '11:00') });
  await sync(api, store);
  const imported = store.getWorld().quests.filter((q) => q.origin === 'google');
  assert.equal(imported.length, 2);
  for (const q of imported) store.deleteQuest(q.id);
  api.calls = [];
  const result = await sync(api, store);
  assert.equal(result.ok, true);
  assert.deepEqual(writeCalls(api), [['deleteEvent', 'primary', own.id]]);
  assert.equal(api.eventsOf('primary').get(invite.id).status, 'confirmed');
  assert.deepEqual(store.listHiddenGoogleEvents(), [invite.id]);
  assert.equal(store.listMappings().filter((m) => m.calendar === 'main').length, 0);
  // Neither comes back.
  await sync(api, store);
  assert.equal(store.getWorld().quests.filter((q) => q.origin === 'google').length, 0);
});

test('main sync off: the primary calendar is never called', async () => {
  const store = seededStore();
  const api = fakeGoogle();
  api.addEvent('primary', { summary: 'Dentist', start: at('2026-12-02', '10:00'), end: at('2026-12-02', '11:00') });
  await sync(api, store);
  assert.ok(!api.calls.some(([n, calId]) => n === 'listMainEvents' || calId === 'primary'));
  assert.equal(store.getWorld().quests.length, 7);
});

test('an imported quest whose event is no longer listed is looked up; gone → removed', async () => {
  const store = mainStore();
  const api = fakeGoogle();
  const ev = api.addEvent('primary', { summary: 'Dentist', start: at('2026-12-02', '10:00'), end: at('2026-12-02', '11:00') });
  await sync(api, store);
  api.eventsOf('primary').delete(ev.id); // not even listed as cancelled
  api.calls = [];
  const result = await sync(api, store);
  assert.equal(result.ok, true);
  assert.deepEqual(named(api, 'getEvent'), [['getEvent', 'primary', ev.id]]);
  assert.equal(store.getWorld().quests.filter((q) => q.origin === 'google').length, 0);
  assert.deepEqual(writeCalls(api), []);
});

test('a one-time quest edited in Google is pulled into the app', async () => {
  const store = seededStore();
  const id = store.saveQuest({ ...seminar, id: undefined, date: '2026-11-28' });
  const api = fakeGoogle();
  await sync(api, store);
  const calId = calIdOf(store);
  api.editInGoogle(calId, mappingOf(store, 'quest:' + id).googleId, { summary: 'Seminar (room 4)', start: at('2026-11-28', '06:00') });
  api.calls = [];
  const result = await sync(api, store);
  assert.equal(result.counts.pulled, 1);
  assert.deepEqual([store.getQuest(id).name, store.getQuest(id).start], ['Seminar (room 4)', '06:00']);
  api.calls = [];
  await sync(api, store);
  assert.deepEqual(writeCalls(api), []);
});

test('an event added by hand to ⚔ becomes a quest and gets the app style', async () => {
  const store = seededStore();
  const api = fakeGoogle();
  await sync(api, store);
  const calId = calIdOf(store);
  const ev = api.addEvent(calId, { summary: 'Gym', start: at('2026-11-29', '08:00'), end: at('2026-11-29', '09:00') });
  api.calls = [];
  await sync(api, store);
  const quest = store.getWorld().quests.find((q) => q.name === 'Gym');
  assert.equal(quest.origin, null);
  assert.equal(mappingOf(store, 'quest:' + quest.id).googleId, ev.id);
  assert.deepEqual(writeCalls(api), [['updateEvent', calId, ev.id]]); // re-sent with its localKey
  assert.equal(api.eventsOf(calId).get(ev.id).localKey, 'quest:' + quest.id);
  api.calls = [];
  await sync(api, store);
  assert.deepEqual(writeCalls(api), []);
});

test('calendar re-created with main sync on → no new imported quests, main mappings kept', async () => {
  const store = mainStore();
  const api = fakeGoogle();
  const ev = api.addEvent('primary', { summary: 'Dentist', start: at('2026-12-02', '10:00'), end: at('2026-12-02', '11:00') });
  await sync(api, store);
  api.calendars.delete(calIdOf(store));
  api.calls = [];
  const result = await sync(api, store);
  assert.equal(result.ok, true);
  assert.equal(store.getWorld().quests.filter((q) => q.origin === 'google').length, 1);
  const main = store.listMappings().filter((m) => m.calendar === 'main');
  assert.deepEqual(main.map((m) => m.googleId), [ev.id]);
  assert.equal(named(api, 'insertEvent').length, 7); // ⚔ refilled with the classes only
  assert.deepEqual(writeCalls(api).filter(([, calId]) => calId === 'primary'), []);
});

test('an unmapped event outside ⚔ is never deleted', async () => {
  const { applyAction } = require('../src/google/sync');
  const api = fakeGoogle();
  const ev = api.addEvent('primary', { summary: 'Dentist', start: at('2026-12-02', '10:00'), end: at('2026-12-02', '11:00') });
  await assert.rejects(applyAction(api, seededStore(), 'cal1', '2026-11-26', { type: 'deleteEvent', calendar: 'main', googleId: ev.id }));
  assert.deepEqual(writeCalls(api), []);
});

test('mainSync false skips the main calendar even when the setting is on', async () => {
  const store = mainStore();
  const api = fakeGoogle();
  api.addEvent('primary', { summary: 'Dentist', start: at('2026-12-02', '10:00'), end: at('2026-12-02', '11:00') });
  const result = await sync(api, store, { mainSync: false });
  assert.equal(result.ok, true);
  assert.equal(named(api, 'listMainEvents').length, 0);
  assert.equal(store.getWorld().quests.some((q) => q.origin === 'google'), false);
});

test('an imported event turned into a series in Google is unlinked; app edits never reach the series', async () => {
  const store = mainStore();
  const api = fakeGoogle();
  const ev = api.addEvent('primary', { summary: 'Dentist', start: at('2026-12-02', '10:00'), end: at('2026-12-02', '11:00') });
  await sync(api, store);
  const quest = store.getWorld().quests.find((q) => q.origin === 'google');
  api.editInGoogle('primary', ev.id, { recurrence: ['RRULE:FREQ=WEEKLY'] });
  const result = await sync(api, store);
  assert.equal(result.ok, true);
  assert.equal(mappingOf(store, 'quest:' + quest.id), undefined);
  assert.deepEqual(store.getQuest(quest.id).name, 'Dentist'); // the quest stays
  store.saveQuest({ ...store.getQuest(quest.id), start: '14:00', end: '15:00' });
  api.calls = [];
  await sync(api, store);
  assert.deepEqual(writeCalls(api), []); // the series is never patched
  assert.equal(store.getWorld().quests.filter((q) => q.origin === 'google').length, 1); // not imported again
});

test('one main event Google refuses to change (400/403) is skipped, not retried, and the sync goes on', async () => {
  const store = mainStore();
  const api = fakeGoogle();
  const stuck = api.addEvent('primary', { summary: 'Booking', start: at('2026-12-02', '10:00'), end: at('2026-12-02', '11:00') });
  const fine = api.addEvent('primary', { summary: 'Lunch', start: at('2026-12-03', '12:00'), end: at('2026-12-03', '13:00') });
  const gone = api.addEvent('primary', { summary: 'Old plan', start: at('2026-12-04', '12:00'), end: at('2026-12-04', '13:00') });
  await sync(api, store);
  const byName = (n) => store.getWorld().quests.find((q) => q.name === n);
  for (const n of ['Booking', 'Lunch']) store.saveQuest({ ...byName(n), start: '15:00', end: '16:00' });
  const goneId = byName('Old plan').id;
  store.deleteQuest(goneId);
  api.failWrite.set(stuck.id, { code: 403, reason: 'forbiddenForNonOrganizer', message: 'Forbidden' });
  api.failWrite.set(gone.id, { code: 400, reason: null, message: 'Bad request' });
  const logged = [];
  const realLog = console.log;
  console.log = (line) => logged.push(line);
  let result;
  try {
    result = await sync(api, store);
  } finally {
    console.log = realLog;
  }
  assert.equal(result.ok, true);
  assert.equal(api.eventsOf('primary').get(fine.id).start.dateTime, '2026-12-03T15:00:00');
  assert.equal(logged.length, 2);
  assert.equal(mappingOf(store, 'quest:' + goneId), undefined); // nothing left to delete
  api.calls = [];
  await sync(api, store);
  assert.deepEqual(writeCalls(api), []); // not retried every run
  // The refused delete is hidden, so the event isn't imported again.
  await sync(api, store);
  const imported = store.getWorld().quests.filter((q) => q.origin === 'google');
  assert.deepEqual(imported.map((q) => q.name).sort(), ['Booking', 'Lunch']);
});

test('other 403s (rate limits, missing permission...) still fail the sync and are retried later', async () => {
  for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'insufficientPermissions', null]) {
    const store = mainStore();
    const api = fakeGoogle();
    const ev = api.addEvent('primary', { summary: 'Dentist', start: at('2026-12-02', '10:00'), end: at('2026-12-02', '11:00') });
    await sync(api, store);
    const quest = store.getWorld().quests.find((q) => q.origin === 'google');
    store.saveQuest({ ...quest, start: '14:00', end: '15:00' });
    api.failWrite.set(ev.id, { code: 403, reason, message: 'Forbidden' });
    const result = await sync(api, store);
    assert.equal(result.ok, false, String(reason));
    api.failWrite.clear();
    await sync(api, store);
    assert.equal(api.eventsOf('primary').get(ev.id).start.dateTime, '2026-12-02T14:00:00', String(reason));
  }
});

test('held deletions are left alone by the push, even when edited in the app', async () => {
  const store = seededStore();
  for (let day = 1; day <= 6; day += 1) {
    store.saveQuest({ kind: 'side', repeat: 'once', name: 'Errand ' + day, date: `2026-12-0${day}`, start: '19:00', end: '20:00' });
  }
  const api = fakeGoogle();
  await sync(api, store);
  const calId = calIdOf(store);
  const errands = store.listMappings().filter((m) => Number(m.localKey.split(':')[1]) > 7);
  // Edited in the app, then deleted in Google after that (Google is newer).
  const edited = store.getQuest(Number(errands[0].localKey.split(':')[1]));
  store.saveQuest({ ...edited, name: 'Errand (renamed)' });
  for (const m of errands) {
    await api.deleteEvent(calId, m.googleId);
    api.eventsOf(calId).get(m.googleId).updated = '2099-01-01T00:00:00.000Z';
  }
  api.calls = [];
  const held = await sync(api, store);
  assert.equal(held.heldDeletes, 6);
  assert.deepEqual(writeCalls(api), []); // the renamed one is not brought back
  assert.equal(api.eventsOf(calId).get(errands[0].googleId).status, 'cancelled');
  const allowed = await sync(api, store, { allowManyDeletes: true });
  assert.equal(allowed.counts.pulled, 6);
  assert.equal(store.getQuest(edited.id), null);
});

test('held deletions of imported quests are not patched either', async () => {
  const store = mainStore();
  const api = fakeGoogle();
  const events = [];
  for (let day = 1; day <= 6; day += 1) {
    events.push(api.addEvent('primary', { summary: 'Plan ' + day, start: at(`2026-12-0${day}`, '10:00'), end: at(`2026-12-0${day}`, '11:00') }));
  }
  await sync(api, store);
  const first = store.getWorld().quests.find((q) => q.name === 'Plan 1');
  store.saveQuest({ ...first, start: '14:00', end: '15:00' });
  for (const ev of events) api.editInGoogle('primary', ev.id, { status: 'cancelled', updated: '2099-01-01T00:00:00.000Z' });
  api.calls = [];
  const held = await sync(api, store);
  assert.equal(held.heldDeletes, 6);
  assert.deepEqual(writeCalls(api), []);
});
