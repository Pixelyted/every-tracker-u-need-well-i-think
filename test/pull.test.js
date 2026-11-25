const test = require('node:test');
const assert = require('node:assert/strict');
const { planPull, isDeletion, isChangeMadeInGoogle } = require('../src/google/pull');
const { quest, makeWorld, seminar, olympiad, moveCalc, skipCalc } = require('./fixtures');

// Stamps: OLD is the last sync, then the app or Google edited after it.
const OLD = '2026-11-20T00:00:00.000Z';
const EARLIER = '2026-11-21T00:00:00.000Z';
const LATER = '2026-11-22T00:00:00.000Z';
const TODAY = '2026-11-26';

// A normalized ⚔ event as api.js hands it over (times in Jakarta).
function ev(fields) {
  return {
    id: 'g?', status: 'confirmed', updated: OLD, summary: '', description: '',
    start: { dateTime: '2026-11-23T05:00:00+07:00' }, end: { dateTime: '2026-11-23T19:00:00+07:00' },
    recurrence: undefined, recurringEventId: undefined, originalStartTime: undefined,
    localKey: null, organizerSelf: true, declined: false, eventType: 'default',
    ...fields,
  };
}

function at(date, time) {
  return { dateTime: `${date}T${time}:00+07:00` };
}

// A mapping as it stands after the last sync, both sides unchanged since.
function mapping(localKey, googleId, fields = {}) {
  return { localKey, googleId, hash: 'h', frozen: false, calendar: 'app', googleUpdated: OLD, localUpdated: OLD, ...fields };
}

// The world with one-time quests stamped like store rows.
function world({ quests = [], changes = [] } = {}) {
  const w = makeWorld();
  w.quests = w.quests.map((q) => ({ ...q, updatedAt: OLD, origin: null, allDay: false })).concat(quests);
  w.changes = changes;
  return w;
}

const seminarRow = { ...seminar, updatedAt: OLD, origin: null, allDay: false };
const olympiadRow = { ...olympiad, updatedAt: OLD, origin: null, allDay: false };
const moveRow = { ...moveCalc, updatedAt: OLD };
const bounty = { id: 7, name: 'Essay', dueDate: '2026-12-01', dueTime: '23:59', note: 'two pages', done: false, xp: 30, updatedAt: OLD };

function plan({ appEvents = [], mappings = [], w = world(), deadlines = [] }) {
  return planPull({ appEvents, mainEvents: null, mappings, world: w, deadlines, hidden: [], today: TODAY });
}

// The weekly series of quest 1 (Potion Brewing 101, Mondays 07:00–09:30).
const series = ev({
  id: 'g1', summary: 'Potion Brewing 101', start: at('2026-08-24', '07:00'), end: at('2026-08-24', '09:30'),
  recurrence: ['RRULE:FREQ=WEEKLY;UNTIL=20261218T165959Z'], localKey: 'quest:1',
});
const seriesMapping = mapping('quest:1', 'g1');

// ONE week of that series, as Google stores it after an edit on the phone.
function weekException(fields) {
  return ev({ id: 'g1_x', recurringEventId: 'g1', originalStartTime: at('2026-11-30', '07:00'), updated: LATER, ...fields });
}

// ---------- the spec's ⚔ table ----------

test('one week of a weekly class moved becomes a make-up, then the series is rebuilt', () => {
  const moved = weekException({ start: at('2026-12-02', '13:00'), end: at('2026-12-02', '15:30') });
  const { actions } = plan({ appEvents: [series, moved], mappings: [seriesMapping] });
  assert.deepEqual(actions, [
    { type: 'setChange', localKey: null, googleUpdated: null,
      change: { questId: 1, originalDate: '2026-11-30', action: 'move', newDate: '2026-12-02', newStart: '13:00', newEnd: '15:30' } },
    { type: 'rebuildSeries', localKey: 'quest:1', googleId: 'g1' },
  ]);
});

test('one week of a weekly class deleted becomes a skip', () => {
  const deleted = weekException({ status: 'cancelled' });
  const { actions } = plan({ appEvents: [series, deleted], mappings: [seriesMapping] });
  assert.deepEqual(actions, [
    { type: 'setChange', localKey: null, googleUpdated: null,
      change: { questId: 1, originalDate: '2026-11-30', action: 'skip', newDate: null, newStart: null, newEnd: null } },
    { type: 'rebuildSeries', localKey: 'quest:1', googleId: 'g1' },
  ]);
});

test('a week edited without moving it (same date and time) adds no change, but still rebuilds', () => {
  const renamed = weekException({ summary: 'Renamed', start: at('2026-11-30', '07:00'), end: at('2026-11-30', '09:30') });
  const { actions } = plan({ appEvents: [series, renamed], mappings: [seriesMapping] });
  assert.deepEqual(actions, [{ type: 'rebuildSeries', localKey: 'quest:1', googleId: 'g1' }]);
});

test('a week the app itself left out (EXDATE) is not read as a Google change', () => {
  const w = world({ changes: [{ ...skipCalc, updatedAt: OLD }] });
  const leftOut = weekException({ status: 'cancelled', originalStartTime: { dateTime: '2026-11-30T00:00:00Z' } });
  assert.equal(isChangeMadeInGoogle(leftOut, { recurrence: ['EXDATE;TZID=Asia/Jakarta:20261130T070000'] }), false);
  const { actions } = plan({ appEvents: [series, leftOut], mappings: [seriesMapping], w });
  assert.deepEqual(actions, []);
});

test('whole weekly series edited in Google is reset to the app version', () => {
  const edited = { ...series, summary: 'Changed', updated: LATER };
  const { actions } = plan({ appEvents: [edited], mappings: [seriesMapping] });
  assert.deepEqual(actions, [{ type: 'resend', localKey: 'quest:1', googleUpdated: LATER }]);
});

test('whole weekly series deleted is put back', () => {
  const missing = plan({ appEvents: [], mappings: [seriesMapping] }).actions;
  assert.deepEqual(missing, [{ type: 'forget', localKey: 'quest:1' }]);
  const cancelled = plan({ appEvents: [{ ...series, status: 'cancelled', updated: LATER }], mappings: [seriesMapping] }).actions;
  assert.deepEqual(cancelled, [{ type: 'forget', localKey: 'quest:1' }]);
});

test('one-time quest edited in Google updates name, date, time and note', () => {
  const edited = ev({
    id: 'g10', updated: LATER, summary: '⚠ Seminar on runes',
    description: '⚠ Clashes with: Rune Geometry (09.40–12.00)\n\nbring notes',
    start: at('2026-11-24', '08:00'), end: at('2026-11-24', '10:00'),
  });
  const { actions } = plan({ appEvents: [edited], mappings: [mapping('quest:10', 'g10')], w: world({ quests: [seminarRow] }) });
  assert.deepEqual(actions, [{
    type: 'updateQuest', localKey: 'quest:10', id: 10, googleUpdated: LATER,
    fields: { name: 'Seminar on runes', note: 'bring notes', date: '2026-11-24', start: '08:00', end: '10:00' },
  }]);
});

test('one-time quest made all-day in Google becomes 00:00–23:59', () => {
  const allDay = ev({ id: 'g10', updated: LATER, summary: 'Seminar', start: { date: '2026-11-25' }, end: { date: '2026-11-26' } });
  const { actions } = plan({ appEvents: [allDay], mappings: [mapping('quest:10', 'g10')], w: world({ quests: [seminarRow] }) });
  assert.deepEqual(actions, [{
    type: 'updateQuest', localKey: 'quest:10', id: 10, googleUpdated: LATER,
    fields: { date: '2026-11-25', start: '00:00', end: '23:59', allDay: true },
  }]);
});

test('one-time quest stretched over several dates in Google is reset', () => {
  const stretched = ev({ id: 'g10', updated: LATER, summary: 'Seminar', start: at('2026-11-23', '20:00'), end: at('2026-11-24', '02:00') });
  const { actions } = plan({ appEvents: [stretched], mappings: [mapping('quest:10', 'g10')], w: world({ quests: [seminarRow] }) });
  assert.deepEqual(actions, [{ type: 'resend', localKey: 'quest:10', googleUpdated: LATER }]);
});

test('limited event edited in Google updates its start and end', () => {
  const edited = ev({ id: 'g20', updated: LATER, summary: 'Olympiad', start: at('2026-11-27', '10:00'), end: at('2026-11-29', '17:00') });
  const { actions } = plan({ appEvents: [edited], mappings: [mapping('quest:20', 'g20')], w: world({ quests: [olympiadRow] }) });
  assert.deepEqual(actions, [{
    type: 'updateQuest', localKey: 'quest:20', id: 20, googleUpdated: LATER,
    fields: { startDate: '2026-11-27', start: '10:00', endDate: '2026-11-29', end: '17:00' },
  }]);
});

test('one-time quest / limited event deleted in Google deletes the quest', () => {
  const w = world({ quests: [seminarRow, olympiadRow] });
  const mappings = [mapping('quest:10', 'g10'), mapping('quest:20', 'g20')];
  const cancelled = ev({ id: 'g20', status: 'cancelled', updated: LATER });
  const { actions } = plan({ appEvents: [cancelled], mappings, w });
  assert.deepEqual(actions, [
    { type: 'deleteQuest', localKey: 'quest:10', id: 10 },
    { type: 'deleteQuest', localKey: 'quest:20', id: 20 },
  ]);
});

test('make-up edited in Google updates its date and time', () => {
  const edited = ev({ id: 'g2', updated: LATER, summary: 'Potion Brewing 101 (make-up)', start: at('2026-12-06', '09:00'), end: at('2026-12-06', '11:30') });
  const { actions } = plan({ appEvents: [edited], mappings: [mapping('makeup:2', 'g2')], w: world({ changes: [moveRow] }) });
  assert.deepEqual(actions, [{
    type: 'setChange', localKey: 'makeup:2', googleUpdated: LATER,
    change: { questId: 1, originalDate: '2026-11-30', action: 'move', newDate: '2026-12-06', newStart: '09:00', newEnd: '11:30' },
  }]);
});

test('make-up deleted in Google turns the week into a skip', () => {
  const { actions } = plan({ appEvents: [], mappings: [mapping('makeup:2', 'g2')], w: world({ changes: [moveRow] }) });
  assert.deepEqual(actions, [{
    type: 'setChange', localKey: 'makeup:2', googleUpdated: null,
    change: { questId: 1, originalDate: '2026-11-30', action: 'skip', newDate: null, newStart: null, newEnd: null },
  }]);
});

test('bounty moved in Google: due date/time is the event end', () => {
  const moved = ev({ id: 'g7', updated: LATER, summary: '📜 Essay (due 23.59)', description: 'two pages', start: at('2026-12-02', '17:45'), end: at('2026-12-02', '18:00') });
  const { actions } = plan({ appEvents: [moved], mappings: [mapping('deadline:7', 'g7')], deadlines: [bounty] });
  assert.deepEqual(actions, [{
    type: 'updateDeadline', localKey: 'deadline:7', id: 7, googleUpdated: LATER,
    fields: { dueDate: '2026-12-02', dueTime: '18:00' },
  }]);
});

test('bounty renamed / note edited in Google updates name and note', () => {
  const renamed = ev({ id: 'g7', updated: LATER, summary: '📜 Long essay (due 23.59)', description: 'three pages', start: at('2026-12-01', '23:44'), end: at('2026-12-01', '23:59') });
  const { actions } = plan({ appEvents: [renamed], mappings: [mapping('deadline:7', 'g7')], deadlines: [bounty] });
  assert.deepEqual(actions, [{
    type: 'updateDeadline', localKey: 'deadline:7', id: 7, googleUpdated: LATER,
    fields: { name: 'Long essay', note: 'three pages' },
  }]);
});

test('bounty deleted in Google deletes the bounty', () => {
  const { actions } = plan({ appEvents: [ev({ id: 'g7', status: 'cancelled', updated: LATER })], mappings: [mapping('deadline:7', 'g7')], deadlines: [bounty] });
  assert.deepEqual(actions, [{ type: 'deleteDeadline', localKey: 'deadline:7', id: 7 }]);
});

test('hand-made event without localKey becomes a side quest', () => {
  const handMade = ev({ id: 'gNew', updated: LATER, summary: 'Dentist', description: 'bring card', start: at('2026-12-03', '20:00'), end: at('2026-12-04', '02:00') });
  const { actions } = plan({ appEvents: [handMade] });
  assert.deepEqual(actions, [{
    type: 'createQuest', calendar: 'app', googleId: 'gNew', googleUpdated: LATER,
    quest: { kind: 'side', repeat: 'once', origin: null, name: 'Dentist', note: 'bring card', date: '2026-12-03', start: '20:00', endDate: '2026-12-04', end: '02:00', allDay: false },
  }]);
});

test('a recurring hand-made event is left alone', () => {
  const repeating = ev({ id: 'gRep', summary: 'Gym', recurrence: ['RRULE:FREQ=WEEKLY'] });
  const instance = ev({ id: 'gRep_1', summary: 'Gym', recurringEventId: 'gRep', originalStartTime: at('2026-11-23', '05:00') });
  assert.deepEqual(plan({ appEvents: [repeating, instance] }).actions, []);
});

// ---------- linking, baselines, newest-wins ----------

test('event with a known localKey is a duplicate and is deleted', () => {
  const duplicate = ev({ id: 'gDup', localKey: 'quest:10', summary: 'Seminar' });
  const original = ev({ id: 'g10', localKey: 'quest:10', summary: 'Seminar' });
  const { actions } = plan({ appEvents: [original, duplicate], mappings: [mapping('quest:10', 'g10')], w: world({ quests: [seminarRow] }) });
  assert.deepEqual(actions, [{ type: 'deleteEvent', calendar: 'app', googleId: 'gDup' }]);
});

test('event with an unmapped localKey is adopted', () => {
  const lost = ev({ id: 'gLost', localKey: 'quest:10', updated: LATER, summary: 'Seminar' });
  const again = ev({ id: 'gLost2', localKey: 'quest:10', updated: LATER, summary: 'Seminar' });
  const { actions } = plan({ appEvents: [lost, again], w: world({ quests: [seminarRow] }) });
  assert.deepEqual(actions, [
    { type: 'adopt', localKey: 'quest:10', googleId: 'gLost', googleUpdated: LATER },
    { type: 'deleteEvent', calendar: 'app', googleId: 'gLost2' },
  ]);
});

test('a lost insert of our own weekly series is adopted; a second copy is deleted', () => {
  const lostSeries = { ...series, id: 'gLostSeries', updated: LATER };
  assert.deepEqual(plan({ appEvents: [lostSeries] }).actions, [
    { type: 'adopt', localKey: 'quest:1', googleId: 'gLostSeries', googleUpdated: LATER },
  ]);
  const { actions } = plan({ appEvents: [series, lostSeries], mappings: [seriesMapping] });
  assert.deepEqual(actions, [{ type: 'deleteEvent', calendar: 'app', googleId: 'gLostSeries' }]);
});

test('a one-time quest missing from Google is deleted even if the app edited it', () => {
  const { actions } = plan({ appEvents: [], mappings: [mapping('quest:10', 'g10')], w: world({ quests: [{ ...seminarRow, updatedAt: LATER }] }) });
  assert.deepEqual(actions, [{ type: 'deleteQuest', localKey: 'quest:10', id: 10 }]);
});

test('a make-up stretched over two dates in Google is reset', () => {
  const stretched = ev({ id: 'g2', updated: LATER, start: at('2026-12-05', '22:00'), end: at('2026-12-06', '01:00') });
  const { actions } = plan({ appEvents: [stretched], mappings: [mapping('makeup:2', 'g2')], w: world({ changes: [moveRow] }) });
  assert.deepEqual(actions, [{ type: 'resend', localKey: 'makeup:2', googleUpdated: LATER }]);
});

test('a week moved onto a span of two dates adds no change, but still rebuilds', () => {
  const stretched = weekException({ start: at('2026-12-02', '22:00'), end: at('2026-12-03', '01:00') });
  const { actions } = plan({ appEvents: [series, stretched], mappings: [seriesMapping] });
  assert.deepEqual(actions, [{ type: 'rebuildSeries', localKey: 'quest:1', googleId: 'g1' }]);
});

test('baseline mappings only get stamped', () => {
  // Mappings from before two-way sync have no stamps yet.
  const fresh = { googleUpdated: null, localUpdated: null };
  const moved = weekException({ status: 'cancelled' });
  const edited = ev({ id: 'g10', updated: LATER, summary: 'Totally different' });
  const { actions } = plan({
    appEvents: [series, moved, edited],
    mappings: [mapping('quest:1', 'g1', fresh), mapping('quest:10', 'g10', fresh)],
    w: world({ quests: [seminarRow] }),
  });
  assert.deepEqual(actions, [
    { type: 'stamp', localKey: 'quest:1', googleUpdated: OLD },
    { type: 'stamp', localKey: 'quest:10', googleUpdated: LATER },
  ]);
});

test('newest edit wins (app newer → resend, Google newer → update)', () => {
  const edited = ev({ id: 'g10', updated: EARLIER, summary: 'Seminar (phone)' });
  const appNewer = plan({ appEvents: [edited], mappings: [mapping('quest:10', 'g10')], w: world({ quests: [{ ...seminarRow, updatedAt: LATER }] }) });
  assert.deepEqual(appNewer.actions, [{ type: 'resend', localKey: 'quest:10', googleUpdated: EARLIER }]);

  const googleNewer = { ...edited, updated: LATER };
  const appOlder = plan({ appEvents: [googleNewer], mappings: [mapping('quest:10', 'g10')], w: world({ quests: [{ ...seminarRow, updatedAt: EARLIER }] }) });
  assert.deepEqual(appOlder.actions, [{ type: 'updateQuest', localKey: 'quest:10', id: 10, googleUpdated: LATER, fields: { name: 'Seminar (phone)' } }]);
});

test('a delete in Google older than an app edit puts the item back', () => {
  const cancelled = ev({ id: 'g10', status: 'cancelled', updated: EARLIER });
  const { actions } = plan({ appEvents: [cancelled], mappings: [mapping('quest:10', 'g10')], w: world({ quests: [{ ...seminarRow, updatedAt: LATER }] }) });
  assert.deepEqual(actions, [{ type: 'forget', localKey: 'quest:10' }]);
});

test('a Google change that touches no app field is only stamped', () => {
  const same = ev({ id: 'g10', updated: LATER, summary: 'Seminar' });
  const { actions } = plan({ appEvents: [same], mappings: [mapping('quest:10', 'g10')], w: world({ quests: [seminarRow] }) });
  assert.deepEqual(actions, [{ type: 'stamp', localKey: 'quest:10', googleUpdated: LATER }]);
});

test('frozen mappings are ignored', () => {
  const frozen = mapping('quest:10', 'g10', { frozen: true });
  const archived = ev({ id: 'g10', localKey: 'quest:10', updated: LATER, summary: 'Changed' });
  const { actions } = plan({ appEvents: [archived], mappings: [frozen], w: world({ quests: [seminarRow] }) });
  assert.deepEqual(actions, []);
  assert.deepEqual(plan({ appEvents: [], mappings: [frozen], w: world({ quests: [seminarRow] }) }).actions, []);
});

test('items the app no longer has are left to the push', () => {
  const edited = ev({ id: 'g10', updated: LATER, summary: 'Changed' });
  assert.deepEqual(plan({ appEvents: [edited], mappings: [mapping('quest:10', 'g10')] }).actions, []);
});

// ---------- the main calendar ----------

// An imported quest as the store returns it (one-time side quest from Google).
const tripRow = quest({
  id: 40, kind: 'side', repeat: 'once', name: 'Trip', note: null, date: '2026-12-10', start: '08:00', end: '09:00',
  origin: 'google', googleLocked: false, allDay: false, updatedAt: OLD,
});
const tripEvent = ev({ id: 'm40', summary: 'Trip', start: at('2026-12-10', '08:00'), end: at('2026-12-10', '09:00') });
const tripMapping = mapping('quest:40', 'm40', { calendar: 'main' });
// A main event: ev() but on an upcoming day (the main list holds only upcoming events).
function mainEv(fields) {
  return ev({ start: at('2026-12-01', '10:00'), end: at('2026-12-01', '11:00'), ...fields });
}

function planMain({ mainEvents = [], mappings = [], w = world(), hidden = [], lookedUp }) {
  return planPull({ appEvents: [], mainEvents, mappings, world: w, deadlines: [], hidden, today: TODAY, lookedUp });
}

test('upcoming main events are imported as side quests', () => {
  const party = ev({ id: 'm1', updated: LATER, summary: 'Party', description: 'bring snacks', start: at('2026-12-05', '20:00'), end: at('2026-12-06', '02:00') });
  const holiday = ev({ id: 'm2', updated: LATER, summary: '', start: { date: '2026-12-24' }, end: { date: '2026-12-27' } });
  const { actions, lookups } = planMain({ mainEvents: [party, holiday] });
  assert.deepEqual(actions, [
    { type: 'createQuest', calendar: 'main', googleId: 'm1', googleUpdated: LATER,
      quest: { kind: 'side', repeat: 'once', origin: 'google', googleLocked: false, name: 'Party', note: 'bring snacks',
        date: '2026-12-05', start: '20:00', endDate: '2026-12-06', end: '02:00', allDay: false } },
    { type: 'createQuest', calendar: 'main', googleId: 'm2', googleUpdated: LATER,
      quest: { kind: 'side', repeat: 'once', origin: 'google', googleLocked: false, name: '(no title)', note: null,
        date: '2026-12-24', start: '00:00', endDate: '2026-12-26', end: '23:59', allDay: true } },
  ]);
  assert.deepEqual(lookups, []);
});

test('main titles and notes are taken as they are (no ⚔ cleaning)', () => {
  const marked = mainEv({ id: 'm1', summary: '⚠ Big day', description: '⚠ Clashes with: x\n\nnote' });
  const { actions } = planMain({ mainEvents: [marked] });
  assert.equal(actions[0].quest.name, '⚠ Big day');
  assert.equal(actions[0].quest.note, '⚠ Clashes with: x\n\nnote');
});

test('invitations are imported locked', () => {
  const invite = mainEv({ id: 'm3', summary: 'Meeting', organizerSelf: false });
  const { actions } = planMain({ mainEvents: [invite] });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].quest.googleLocked, true);
});

test('declined, repeating and past events are skipped', () => {
  const declined = mainEv({ id: 'm4', summary: 'No thanks', organizerSelf: false, declined: true });
  const repeating = mainEv({ id: 'm5', summary: 'Gym', recurrence: ['RRULE:FREQ=WEEKLY'] });
  const instance = mainEv({ id: 'm5_1', summary: 'Gym', recurringEventId: 'm5', originalStartTime: at('2026-12-01', '05:00') });
  const cancelled = mainEv({ id: 'm6', status: 'cancelled' });
  const past = ev({ id: 'm8', summary: 'Last week', start: at('2026-11-20', '08:00'), end: at('2026-11-20', '09:00') });
  assert.deepEqual(planMain({ mainEvents: [declined, repeating, instance, cancelled, past] }).actions, []);
});

test('hidden events are skipped', () => {
  const unlinked = mainEv({ id: 'm7', summary: 'Someone else\'s party', organizerSelf: false });
  assert.deepEqual(planMain({ mainEvents: [unlinked], hidden: ['m7'] }).actions, []);
});

test('a cancelled main event deletes the quest', () => {
  const w = world({ quests: [tripRow] });
  const cancelled = planMain({ mainEvents: [{ ...tripEvent, status: 'cancelled', updated: LATER }], mappings: [tripMapping], w });
  assert.deepEqual(cancelled.actions, [{ type: 'deleteQuest', localKey: 'quest:40', id: 40 }]);
  // Even when the app edited it after that: the app never re-creates main events.
  const edited = world({ quests: [{ ...tripRow, updatedAt: LATER }] });
  const declined = planMain({ mainEvents: [{ ...tripEvent, declined: true, updated: EARLIER }], mappings: [tripMapping], w: edited });
  assert.deepEqual(declined.actions, [{ type: 'deleteQuest', localKey: 'quest:40', id: 40 }]);
  assert.equal(isDeletion(declined.actions[0]), true);
});

test('a main event edited in Google updates the quest (multi-day allowed, no cleaning)', () => {
  const moved = { ...tripEvent, updated: LATER, summary: '⚠ Long trip', description: 'pack', start: at('2026-12-10', '20:00'), end: at('2026-12-12', '10:00') };
  const { actions } = planMain({ mainEvents: [moved], mappings: [tripMapping], w: world({ quests: [tripRow] }) });
  assert.deepEqual(actions, [{
    type: 'updateQuest', localKey: 'quest:40', id: 40, googleUpdated: LATER,
    fields: { name: '⚠ Long trip', note: 'pack', start: '20:00', endDate: '2026-12-12', end: '10:00' },
  }]);
});

test('app newer than Google keeps the app\'s version (resend)', () => {
  const edited = { ...tripEvent, updated: EARLIER, summary: 'Trip (phone)' };
  const { actions } = planMain({ mainEvents: [edited], mappings: [tripMapping], w: world({ quests: [{ ...tripRow, updatedAt: LATER }] }) });
  assert.deepEqual(actions, [{ type: 'resend', localKey: 'quest:40', googleUpdated: EARLIER }]);
});

test('an invitation changed in Google always takes Google\'s version', () => {
  const locked = { ...tripRow, googleLocked: true, updatedAt: LATER };
  const edited = { ...tripEvent, updated: EARLIER, summary: 'Trip (moved)', organizerSelf: false };
  const { actions } = planMain({ mainEvents: [edited], mappings: [tripMapping], w: world({ quests: [locked] }) });
  assert.deepEqual(actions, [{ type: 'updateQuest', localKey: 'quest:40', id: 40, googleUpdated: EARLIER, fields: { name: 'Trip (moved)' } }]);
});

test('main mappings: unchanged → nothing, untouched fields → stamp, baseline → stamp', () => {
  const w = world({ quests: [tripRow] });
  assert.deepEqual(planMain({ mainEvents: [tripEvent], mappings: [tripMapping], w }).actions, []);
  const touched = { ...tripEvent, updated: LATER };
  assert.deepEqual(planMain({ mainEvents: [touched], mappings: [tripMapping], w }).actions,
    [{ type: 'stamp', localKey: 'quest:40', googleUpdated: LATER }]);
  const baseline = { ...tripMapping, googleUpdated: null, localUpdated: null };
  const renamed = { ...touched, summary: 'Other' };
  assert.deepEqual(planMain({ mainEvents: [renamed], mappings: [baseline], w }).actions,
    [{ type: 'stamp', localKey: 'quest:40', googleUpdated: LATER }]);
});

test('a mapped main event turned into a series in Google is unlinked, the quest kept', () => {
  const w = world({ quests: [tripRow] });
  const series = { ...tripEvent, updated: LATER, recurrence: ['RRULE:FREQ=WEEKLY'], start: at('2026-12-03', '08:00'), end: at('2026-12-03', '09:00') };
  assert.deepEqual(planMain({ mainEvents: [series], mappings: [tripMapping], w }).actions, [{ type: 'unlink', localKey: 'quest:40' }]);
  // Same when the app edited it later: repeating events are never touched.
  const edited = world({ quests: [{ ...tripRow, updatedAt: '2099-01-01T00:00:00.000Z' }] });
  assert.deepEqual(planMain({ mainEvents: [series], mappings: [tripMapping], w: edited }).actions, [{ type: 'unlink', localKey: 'quest:40' }]);
  // A series that is deleted still deletes the quest.
  const gone = { ...series, status: 'cancelled' };
  assert.deepEqual(planMain({ mainEvents: [gone], mappings: [tripMapping], w }).actions, [{ type: 'deleteQuest', localKey: 'quest:40', id: 40 }]);
});

test('special main events (Gmail bookings, out of office, ...) are not imported; a mapped one is unlinked', () => {
  const booking = mainEv({ id: 'm9', summary: 'Flight', eventType: 'fromGmail' });
  const away = mainEv({ id: 'm10', summary: 'Away', eventType: 'outOfOffice' });
  assert.deepEqual(planMain({ mainEvents: [booking, away] }).actions, []);
  const normal = mainEv({ id: 'm11', summary: 'Lunch', eventType: 'default' });
  assert.equal(planMain({ mainEvents: [normal] }).actions.length, 1);
  const w = world({ quests: [tripRow] });
  const focus = { ...tripEvent, eventType: 'focusTime' };
  assert.deepEqual(planMain({ mainEvents: [focus], mappings: [tripMapping], w }).actions, [{ type: 'unlink', localKey: 'quest:40' }]);
});

test('ended imported quests are left alone', () => {
  const past = { ...tripRow, date: '2026-11-20' };
  const w = world({ quests: [past] });
  const edited = { ...tripEvent, updated: LATER, summary: 'Changed', start: at('2026-11-20', '08:00'), end: at('2026-11-20', '09:00') };
  assert.deepEqual(planMain({ mainEvents: [edited], mappings: [tripMapping], w }), { actions: [], lookups: [] });
  assert.deepEqual(planMain({ mainEvents: [], mappings: [tripMapping], w }), { actions: [], lookups: [] });
  // A multi-day one that is still going counts as upcoming.
  const ongoing = world({ quests: [{ ...past, endDate: '2026-11-28' }] });
  assert.deepEqual(planMain({ mainEvents: [], mappings: [tripMapping], w: ongoing }).lookups, [{ localKey: 'quest:40', googleId: 'm40' }]);
});

test('missing upcoming main event is looked up, not assumed deleted', () => {
  const w = world({ quests: [tripRow] });
  const first = planMain({ mainEvents: [], mappings: [tripMapping], w });
  assert.deepEqual(first, { actions: [], lookups: [{ localKey: 'quest:40', googleId: 'm40' }] });

  const gone = planMain({ mainEvents: [], mappings: [tripMapping], w, lookedUp: new Map([['m40', null]]) });
  assert.deepEqual(gone, { actions: [{ type: 'deleteQuest', localKey: 'quest:40', id: 40 }], lookups: [] });

  // Moved to the past (outside the list's time window): handled like a listed event.
  const movedBack = { ...tripEvent, updated: LATER, start: at('2026-11-01', '08:00'), end: at('2026-11-01', '09:00') };
  const found = planMain({ mainEvents: [], mappings: [tripMapping], w, lookedUp: new Map([['m40', movedBack]]) });
  assert.deepEqual(found, {
    actions: [{ type: 'updateQuest', localKey: 'quest:40', id: 40, googleUpdated: LATER, fields: { date: '2026-11-01' } }],
    lookups: [],
  });
});

test('mainEvents null means the main calendar is not touched', () => {
  const result = plan({ appEvents: [], mappings: [tripMapping], w: world({ quests: [tripRow] }) });
  assert.deepEqual(result, { actions: [], lookups: [] });
});

test('imported quests in the main calendar are never mixed into ⚔', () => {
  // A main mapping's event is not in ⚔; the ⚔ pass must not read it as missing.
  const result = planPull({ appEvents: [], mainEvents: [tripEvent], mappings: [tripMapping], world: world({ quests: [tripRow] }), deadlines: [], hidden: [], today: TODAY });
  assert.deepEqual(result, { actions: [], lookups: [] });
});

test('isDeletion counts make-up→skip', () => {
  const skip = { questId: 1, originalDate: '2026-11-30', action: 'skip', newDate: null, newStart: null, newEnd: null };
  assert.equal(isDeletion({ type: 'deleteQuest', localKey: 'quest:10', id: 10 }), true);
  assert.equal(isDeletion({ type: 'deleteDeadline', localKey: 'deadline:7', id: 7 }), true);
  assert.equal(isDeletion({ type: 'setChange', localKey: 'makeup:2', change: skip, googleUpdated: null }), true);
  // A skip from a one-week delete in the series is not an app item deleted.
  assert.equal(isDeletion({ type: 'setChange', localKey: null, change: skip, googleUpdated: null }), false);
  assert.equal(isDeletion({ type: 'unlink', localKey: 'quest:40' }), false);
  assert.equal(isDeletion({ type: 'forget', localKey: 'quest:1' }), false);
});
