const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openStore } = require('../src/db');
const { makeWorld, seminar } = require('./fixtures');

// A store holding the fixture semester and the 7 weekly classes.
function seededStore() {
  const store = openStore(':memory:');
  const fixture = makeWorld();
  const { id, ...semester } = fixture.semester;
  store.saveSemester(semester);
  for (const q of fixture.quests) {
    const { id: _ignored, ...rest } = q;
    store.saveQuest(rest);
  }
  return store;
}

test('round-trips the fixture world', () => {
  const store = seededStore();
  assert.deepEqual(store.getWorld(), makeWorld());
  assert.deepEqual(store.getActiveSemester(), makeWorld().semester);
});

test('empty store has no semester', () => {
  const store = openStore(':memory:');
  assert.deepEqual(store.getWorld(), { semester: null, quests: [], changes: [], breaks: [] });
});

test('setChange upserts', () => {
  const store = seededStore();
  store.setChange({ questId: 1, originalDate: '2026-11-30', action: 'skip' });
  store.setChange({ questId: 1, originalDate: '2026-11-30', action: 'move', newDate: '2026-12-05', newStart: '08:00', newEnd: '10:30' });
  const { changes } = store.getWorld();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'move');
  assert.equal(changes[0].newDate, '2026-12-05');
  store.removeChange(1, '2026-11-30');
  assert.deepEqual(store.getWorld().changes, []);
});

test('deleteQuest removes its changes', () => {
  const store = seededStore();
  store.setChange({ questId: 1, originalDate: '2026-11-30', action: 'skip' });
  store.deleteQuest(1);
  const world = store.getWorld();
  assert.equal(world.quests.length, 6);
  assert.deepEqual(world.changes, []);
});

test("editing a weekly quest's weekday drops changes that no longer fit", () => {
  const store = seededStore();
  store.setChange({ questId: 1, originalDate: '2026-11-30', action: 'skip' });
  const q1 = store.getWorld().quests[0];
  store.saveQuest({ ...q1, start: '07:15' });
  assert.equal(store.getWorld().changes.length, 1);
  store.saveQuest({ ...q1, weekday: 2 });
  assert.deepEqual(store.getWorld().changes, []);
});

test('startNewSemester archives old weekly quests and freezes their mappings', () => {
  const store = seededStore();
  const sid = store.saveQuest({ ...seminar, id: undefined });
  store.upsertMapping({ localKey: 'quest:1', googleId: 'g1', hash: 'h1' });
  store.upsertMapping({ localKey: 'quest:' + sid, googleId: 'g2', hash: 'h2' });
  store.startNewSemester({ name: 'Genap 2027', startDate: '2027-02-01', endDate: '2027-06-11' });
  const world = store.getWorld();
  assert.equal(world.semester.name, 'Genap 2027');
  assert.equal(world.quests.filter((q) => q.repeat === 'weekly').length, 0);
  assert.equal(world.quests.filter((q) => q.repeat === 'once').length, 1);
  const maps = store.listMappings();
  assert.equal(maps.find((m) => m.localKey === 'quest:1').frozen, 1);
  assert.equal(maps.find((m) => m.localKey === 'quest:' + sid).frozen, 0);
  store.clearMappings();
  assert.deepEqual(store.listMappings().map((m) => m.localKey), ['quest:1']);
  store.clearMappings({ includeFrozen: true });
  assert.deepEqual(store.listMappings(), []);
});

test('breaks belong to the active semester', () => {
  const store = seededStore();
  const id = store.saveBreak({ name: 'Midterm week', startDate: '2026-10-12', endDate: '2026-10-16' });
  assert.deepEqual(store.getWorld().breaks, [{ id, name: 'Midterm week', startDate: '2026-10-12', endDate: '2026-10-16', semesterId: 1 }]);
  store.deleteBreak(id);
  assert.deepEqual(store.getWorld().breaks, []);
});

test('settings defaults and partial update', () => {
  const store = openStore(':memory:');
  assert.equal(store.getSettings().leadMinutes, 15);
  assert.equal(store.getSettings().launchOnLogin, true);
  store.setSettings({ leadMinutes: 30 });
  const s = store.getSettings();
  assert.equal(s.leadMinutes, 30);
  assert.equal(s.desktopNotifications, true);
  assert.equal(s.googleCalendarId, null);
});

test('mappings upsert and delete', () => {
  const store = openStore(':memory:');
  store.upsertMapping({ localKey: 'quest:1', googleId: 'g1', hash: 'h1' });
  store.upsertMapping({ localKey: 'quest:1', googleId: 'g1', hash: 'h2' });
  assert.deepEqual(store.listMappings(), [{ localKey: 'quest:1', googleId: 'g1', hash: 'h2', frozen: 0 }]);
  store.deleteMapping('quest:1');
  assert.deepEqual(store.listMappings(), []);
});

test('deadlines: save, update, tick done, delete', () => {
  const store = openStore(':memory:');
  const id = store.saveDeadline({ name: 'Calc HW', dueDate: '2026-11-27', dueTime: '23:59' });
  assert.deepEqual(store.listDeadlines(), [{ id, name: 'Calc HW', dueDate: '2026-11-27', dueTime: '23:59', note: null, done: false, xp: null }]);
  store.saveDeadline({ id, name: 'Calc HW 3', dueDate: '2026-11-28', dueTime: '12:00', note: 'page 40' });
  store.setDeadlineDone(id, true);
  assert.deepEqual(store.listDeadlines(), [{ id, name: 'Calc HW 3', dueDate: '2026-11-28', dueTime: '12:00', note: 'page 40', done: true, xp: null }]);
  // Editing a ticked deadline keeps it ticked.
  store.saveDeadline({ id, name: 'Calc HW 3', dueDate: '2026-11-28', dueTime: '12:00' });
  assert.equal(store.listDeadlines()[0].done, true);
  store.deleteDeadline(id);
  assert.deepEqual(store.listDeadlines(), []);
});

test('habits: save, change the target from this week, tick, delete', () => {
  const store = openStore(':memory:');
  const id = store.saveHabit({ name: 'Fast', kind: 'weekly', target: 3 }, '2026-11-18');
  store.saveHabit({ id, name: 'Fast', kind: 'weekly', target: 4 }, '2026-11-25');
  const habit = store.listHabits()[0];
  assert.equal(habit.createdDate, '2026-11-18');
  assert.equal(habit.xp, null);
  assert.deepEqual(habit.targets, [{ fromMonday: '2026-11-16', target: 3 }, { fromMonday: '2026-11-23', target: 4 }]);
  store.setHabitTick(id, '2026-11-24', true);
  store.setHabitTick(id, '2026-11-24', true);
  store.setHabitTick(id, '2026-11-20', true);
  assert.deepEqual(store.listHabits()[0].ticks, ['2026-11-20', '2026-11-24']);
  store.setHabitTick(id, '2026-11-24', false);
  assert.deepEqual(store.listHabits()[0].ticks, ['2026-11-20']);
  store.deleteHabit(id);
  assert.deepEqual(store.listHabits(), []);
});

test('XP log: a key is only written once, total adds up, newest first', () => {
  const store = openStore(':memory:');
  const row = (key, date, amount, extra) => ({ key, date, label: key, amount, kind: 'quest', ...extra });
  assert.equal(store.addXp(row('a', '2026-11-20', 10)), true);
  assert.equal(store.addXp(row('a', '2026-11-20', 10)), false);
  store.addXp(row('c', '2026-11-22', 30, { kind: 'bounty', onTime: true }));
  store.addXp(row('b', '2026-11-21', 20, { kind: 'bounty', onTime: false }));
  const rows = store.listXp();
  assert.deepEqual(rows.map((r) => r.key), ['c', 'b', 'a']);
  assert.equal(rows[0].onTime, true);
  assert.equal(rows[1].onTime, false);
  assert.equal(rows[2].onTime, null);
  assert.equal(store.listXp({ limit: 2 }).length, 2);
  assert.equal(store.totalXp(), 60);
  store.removeXp('b');
  assert.equal(store.totalXp(), 40);
  assert.equal(openStore(':memory:').totalXp(), 0);
});

test('upgrades a version-2 database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dungeon-db-'));
  const file = path.join(dir, 'old.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE IF NOT EXISTS semesters (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, start_date TEXT NOT NULL,
      end_date TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, repeat TEXT, name TEXT NOT NULL,
      color TEXT, icon TEXT, note TEXT, weekday INTEGER, date TEXT, start_time TEXT, end_time TEXT,
      start_date TEXT, end_date TEXT, semester_id INTEGER REFERENCES semesters(id)
    );
    CREATE TABLE IF NOT EXISTS deadlines (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, due_date TEXT NOT NULL,
      due_time TEXT NOT NULL, note TEXT, done INTEGER NOT NULL DEFAULT 0
    );
    PRAGMA user_version = 2;
  `);
  old.prepare("INSERT INTO quests (kind, repeat, name, date, start_time, end_time) VALUES ('side', 'once', 'Seminar', '2026-11-23', '05:00', '19:00')").run();
  old.prepare("INSERT INTO deadlines (name, due_date, due_time) VALUES ('Calc HW', '2026-11-27', '23:59')").run();
  old.close();

  const store = openStore(file);
  assert.equal(store.getWorld().quests[0].xp, null);
  assert.equal(store.getWorld().quests[0].name, 'Seminar');
  assert.equal(store.listDeadlines()[0].xp, null);
  assert.deepEqual(store.listHabits(), []);
  store.close();
  fs.rmSync(dir, { recursive: true });
});

test('editing a quest or deadline without xp keeps it; null clears it', () => {
  const store = openStore(':memory:');
  const q = { kind: 'side', repeat: 'once', name: 'Seminar', date: '2026-11-23', start: '05:00', end: '19:00' };
  const qid = store.saveQuest({ ...q, xp: 50 });
  const questXp = () => store.getWorld().quests.find((x) => x.id === qid).xp;
  assert.equal(questXp(), 50);
  store.saveQuest({ ...q, id: qid });
  assert.equal(questXp(), 50);
  store.saveQuest({ ...q, id: qid, xp: null });
  assert.equal(questXp(), null);

  const d = { name: 'Calc HW', dueDate: '2026-11-27', dueTime: '23:59' };
  const did = store.saveDeadline({ ...d, xp: 50 });
  assert.equal(store.listDeadlines()[0].xp, 50);
  store.saveDeadline({ ...d, id: did });
  assert.equal(store.listDeadlines()[0].xp, 50);
  store.saveDeadline({ ...d, id: did, xp: null });
  assert.equal(store.listDeadlines()[0].xp, null);
});

test('final review: re-saving a habit without xp keeps the stored xp', () => {
  const store = openStore(':memory:');
  const id = store.saveHabit({ name: 'Read', kind: 'daily', xp: 50 }, '2026-11-24');
  store.saveHabit({ id, name: 'Read', kind: 'daily' }, '2026-11-24');
  assert.equal(store.listHabits()[0].xp, 50);
  store.saveHabit({ id, name: 'Read', kind: 'daily', xp: null }, '2026-11-24');
  assert.equal(store.listHabits()[0].xp, null);
});

// ---------- finances ----------

const rowA = { date: '2026-11-03', amount: 5000000, direction: 'DB', text: 'QRIS TOKO KOPI', type: 'QRIS', merchant: 'TOKO KOPI' };
const rowB = { date: '2026-11-01', amount: 300000000, direction: 'CR', text: 'TRANSFER MASUK', type: 'TRSF', merchant: 'PARENT' };
const importInfo = (fileName) => ({ fileName, periodStart: '2026-11-01', periodEnd: '2026-11-30', importedAt: '2026-11-24T10:00:00', known: 0 });

test('finance: addImport stores rows and lists them in date order', () => {
  const store = openStore(':memory:');
  const importId = store.addImport(importInfo('nov.pdf'), [rowA, rowB]);
  const txns = store.listTransactions();
  assert.equal(txns.length, 2);
  assert.deepEqual(txns.map((t) => t.date), ['2026-11-01', '2026-11-03']);
  assert.equal(txns[0].kind, 'income');
  assert.equal(txns[1].kind, 'spend');
  assert.equal(txns[0].label, null);
  assert.equal(txns[0].allowance, null);
  assert.equal(txns[1].importId, importId);
  assert.equal(txns[1].merchant, 'TOKO KOPI');
  assert.equal(store.listImports()[0].added, 2);
  store.close();
});

test('finance: labels, allowance and kinds update', () => {
  const store = openStore(':memory:');
  store.addImport(importInfo('nov.pdf'), [rowA]);
  const id = store.listTransactions()[0].id;
  store.setTransactionLabel(id, 'want');
  store.setTransactionAllowance(id, 0);
  store.setKinds(new Map([[id, 'refund']]));
  store.setMerchantLabel('IDM', 'need');
  const t = store.listTransactions()[0];
  assert.equal(t.label, 'want');
  assert.equal(t.allowance, 0);
  assert.equal(t.kind, 'refund');
  assert.deepEqual(store.listMerchantLabels(), { IDM: 'need' });
  store.setMerchantLabel('IDM', 'skip');
  assert.deepEqual(store.listMerchantLabels(), { IDM: 'skip' });
  store.setTransactionLabel(id, null);
  assert.equal(store.listTransactions()[0].label, null);
  store.close();
});

test('finance: listMerchantLabels is an empty object when nothing is set', () => {
  const store = openStore(':memory:');
  assert.deepEqual(store.listMerchantLabels(), {});
  store.close();
});

test('finance: deleteImport removes only its rows', () => {
  const store = openStore(':memory:');
  const first = store.addImport(importInfo('a.pdf'), [rowA]);
  const second = store.addImport(importInfo('b.pdf'), [rowB]);
  store.deleteImport(first);
  const txns = store.listTransactions();
  assert.equal(txns.length, 1);
  assert.equal(txns[0].importId, second);
  assert.equal(store.listImports().length, 1);
  store.close();
});

test('finance: a version-3 database gains the new tables', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-'));
  const file = path.join(dir, 'v3.db');
  const first = openStore(file);
  first.close();
  const old = new DatabaseSync(file);
  old.exec('DROP TABLE transactions; DROP TABLE imports; DROP TABLE merchant_labels; PRAGMA user_version = 3;');
  old.close();

  const store = openStore(file);
  assert.deepEqual(store.listTransactions(), []);
  store.close();
  const check = new DatabaseSync(file);
  assert.equal(check.prepare('PRAGMA user_version').get().user_version, 4);
  check.close();
  fs.rmSync(dir, { recursive: true });
});
