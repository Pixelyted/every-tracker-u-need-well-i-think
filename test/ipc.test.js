const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHandlers } = require('../src/ipc');
const { openStore } = require('../src/db');
const { makeWorld, seminar } = require('./fixtures');
const { nowFromDate } = require('../src/time');
const { HEADER, row, WEEK_A, WEEK_B, NOT_BCA } = require('./bca-fixture');

function setup() {
  const store = openStore(':memory:');
  let changes = 0;
  const h = buildHandlers(store, {
    onChange: () => { changes += 1; },
    clock: () => ({ date: '2026-11-23', time: '10:00' }),
  });
  return { store, h, changeCount: () => changes };
}

function seed(h) {
  const { id, ...semester } = makeWorld().semester;
  assert.equal(h.saveSemester(semester).ok, true);
  for (const { id: _i, ...q } of makeWorld().quests) assert.equal(h.saveQuest(q).ok, true);
}

test('getSemester is null before first launch', () => {
  assert.equal(setup().h.getSemester(), null);
});

test('saveQuest validates and notifies', () => {
  const { h, changeCount } = setup();
  seed(h);
  const bad = h.saveQuest({ kind: 'side', repeat: 'once', name: 'Late', date: '2026-11-24', start: '19:00', end: '05:00' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length > 0);
  const before = changeCount();
  const good = h.saveQuest({ ...seminar, id: undefined });
  assert.equal(good.ok, true);
  assert.equal(typeof good.id, 'number');
  assert.equal(changeCount(), before + 1);
});

test('getWeek returns days, layout, week, floor, today and cleared flags', () => {
  const { h } = setup();
  seed(h);
  const week = h.getWeek('2026-11-23');
  assert.deepEqual(Object.keys(week.days).length, 7);
  assert.equal(week.week, 48);
  assert.equal(week.floor, 14);
  assert.deepEqual(week.today, { date: '2026-11-23', time: '10:00' });
  const calc = week.days['2026-11-23'][0];
  assert.equal(calc.cleared, true);
  assert.deepEqual(week.layout['2026-11-23'][calc.key], { col: 0, cols: 1 });
  assert.equal(h.getToday().length, 2);
});

test('setChange validates a move', () => {
  const { h } = setup();
  seed(h);
  const bad = h.setChange({ questId: 1, originalDate: '2026-11-30', action: 'move', newDate: '2026-12-05', newStart: '10:30', newEnd: '08:00' });
  assert.equal(bad.ok, false);
  assert.equal(h.setChange({ questId: 1, originalDate: '2026-11-30', action: 'skip' }).ok, true);
});

test('google calls are stubs for now', async () => {
  const { h } = setup();
  assert.deepEqual(await h.pushNow(), { ok: false, error: 'not set up' });
});

test('nowFromDate reads the local clock', () => {
  assert.deepEqual(nowFromDate(new Date(2026, 10, 23, 7, 5)), { date: '2026-11-23', time: '07:05' });
});

test('forms can validate before checking clashes', () => {
  const { h } = setup();
  seed(h);
  assert.deepEqual(h.validateQuest({ ...seminar, id: undefined }), []);
  assert.ok(h.validateQuest({ ...seminar, start: '19:00', end: '05:00' }).length > 0);
  assert.deepEqual(h.validateMove({ date: '2026-12-05', start: '08:00', end: '10:30' }), []);
  assert.ok(h.validateMove({ date: '', start: '08:00', end: '10:30' }).length > 0);
});

test('checkDraft over IPC includes the ordered warning steps', () => {
  const { h } = setup();
  seed(h);
  const result = h.checkDraft({ ...seminar, id: undefined });
  assert.deepEqual(result.steps, ['clashes']);
  assert.deepEqual(h.checkMove(1, '2026-11-30', { date: '2026-12-05', start: '08:00', end: '10:30' }).steps, []);
});

test('setSettings refuses keys that are not settings', () => {
  const { h, store } = setup();
  const bad = h.setSettings({ leadMinutes: 5, hacked: true });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /hacked/);
  assert.equal(store.getSettings().leadMinutes, 15);
  assert.equal('hacked' in store.getSettings(), false);
  assert.equal(h.setSettings({ leadMinutes: 5 }).ok, true);
  assert.equal(store.getSettings().leadMinutes, 5);
});

test('deadlines through IPC: validate, save, list, tick, week strip, delete', () => {
  const { h, changeCount } = setup();
  assert.equal(h.saveDeadline({ name: '', dueDate: '2026-11-27', dueTime: '23:59' }).ok, false);
  const before = changeCount();
  const saved = h.saveDeadline({ name: 'Calc HW', dueDate: '2026-11-27', dueTime: '23:59' });
  assert.equal(saved.ok, true);
  assert.equal(changeCount(), before + 1);
  h.saveDeadline({ name: 'Late essay', dueDate: '2026-11-20', dueTime: '12:00' });
  // The clock in setup() says Mon 23 Nov, 10:00.
  assert.deepEqual(h.getBounties().map((b) => [b.name, b.status]), [['Late essay', 'overdue'], ['Calc HW', 'open']]);
  assert.deepEqual(Object.keys(h.getWeek('2026-11-23').deadlines), ['2026-11-27']);
  assert.equal(h.setDeadlineDone(saved.id, true).ok, true);
  assert.deepEqual(h.getBounties().map((b) => b.name), ['Late essay']);
  assert.equal(h.getWeek('2026-11-23').deadlines['2026-11-27'][0].status, 'done');
  assert.equal(h.listDeadlines().length, 2);
  assert.equal(h.deleteDeadline(saved.id).ok, true);
  assert.equal(h.listDeadlines().length, 1);
});

test('habits through IPC: validate, save, tick inside the window only, profile', () => {
  const { h } = setup();
  seed(h);
  assert.equal(h.saveHabit({ name: 'Gym', kind: 'weekly', target: 9 }).ok, false);
  const saved = h.saveHabit({ name: 'Read', kind: 'daily' });
  assert.equal(saved.ok, true);
  const old = h.tickHabit(saved.id, '2026-11-13', true);
  assert.equal(old.ok, false);
  assert.deepEqual(old.errors, ['You can only tick today and the 6 days before']);
  assert.equal(h.tickHabit(saved.id, '2026-11-23', true).ok, true);
  assert.equal(h.getLevel().total, 5);
  assert.equal(h.getProfile().habits.length, 1);
  assert.equal(h.deleteHabit(saved.id).ok, true);
  assert.equal(h.getLevel().total, 5);
});

test('claiming a bounty pays XP', () => {
  const { h } = setup();
  const id = h.saveDeadline({ name: 'Report', dueDate: '2026-11-30', dueTime: '12:00' }).id;
  h.setDeadlineDone(id, true);
  assert.equal(h.getLevel().total, 20);
  h.setDeadlineDone(id, false);
  assert.equal(h.getLevel().total, 0);
});

test('a habit cannot switch kind after creation', () => {
  const { h } = setup();
  const id = h.saveHabit({ name: 'Read', kind: 'daily' }).id;
  const res = h.saveHabit({ id, name: 'Read', kind: 'weekly', target: 3 });
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors, ["A habit can't switch between Daily and Weekly; delete it and make a new one"]);
  assert.equal(h.getProfile().habits[0].kind, 'daily');
  assert.equal(h.saveHabit({ id, name: 'Reading', kind: 'daily' }).ok, true);
});

// ---------- Treasury ----------

const D1 = HEADER(1, 1, '16/11/2026 - 16/11/2026') +
  row('16/11/2026', 'TRN MASTERCARD DBTGoPayID                          1234567812345678/Y', '28,000.00', 'DB', 'DB INTERCHANGE');
const D2 = HEADER(1, 1, '17/11/2026 - 17/11/2026') +
  row('17/11/2026', 'TRN MASTERCARD DBTGoPayID                          1234567812345678/Y', '28,000.00', 'CR', 'KR INTERCHANGE');

function treasurySetup() {
  const store = openStore(':memory:');
  const texts = { 'a.pdf': WEEK_A, 'b.pdf': WEEK_B, 'x.pdf': NOT_BCA, 'd1.pdf': D1, 'd2.pdf': D2 };
  const h = buildHandlers(store, {
    clock: () => ({ date: '2026-11-23', time: '10:00' }),
    readPdfText: async (p) => texts[p.split('/').pop()],
  });
  return { store, h };
}
const A = '/home/u/Downloads/a.pdf';

test('importStatements: first import adds every row and lists new merchants', async () => {
  const { h } = treasurySetup();
  const { files } = await h.importStatements([A]);
  assert.equal(files[0].fileName, 'a.pdf');
  assert.equal(files[0].ok, true);
  assert.equal(files[0].added, 9);
  assert.equal(files[0].known, 0);
  assert.ok(files[0].newMerchants.includes('TOKO MAKMU'));
  assert.ok(files[0].newMerchants.includes('GOPAYID'));
  // Income senders are not shops, so they are not offered for labelling.
  assert.ok(!files[0].newMerchants.includes('BUDI SANTOSO'));
});

test('re-import adds nothing', async () => {
  const { h, store } = treasurySetup();
  await h.importStatements([A]);
  const { files } = await h.importStatements([A]);
  assert.equal(files[0].added, 0);
  assert.equal(files[0].known, 9);
  assert.equal(store.listTransactions().length, 9);
  assert.equal(store.listImports().length, 2);
});

test('overlapping week adds only the new day', async () => {
  const { h } = treasurySetup();
  await h.importStatements([A]);
  const { files } = await h.importStatements(['/home/u/Downloads/b.pdf']);
  assert.equal(files[0].added, 1);
  assert.equal(files[0].known, 4);
});

test('no card number is saved', async () => {
  const { h, store } = treasurySetup();
  await h.importStatements([A]);
  assert.ok(store.listTransactions().every((r) => !/1234567812345678/.test(r.text)));
});

test('bad file does not block others', async () => {
  const { h } = treasurySetup();
  const { files } = await h.importStatements(['/x/x.pdf', '/x/a.pdf']);
  assert.equal(files[0].ok, false);
  assert.equal(files[0].error, "This isn't a BCA mutasi rekening.");
  assert.deepEqual(files[0].problems, []);
  assert.equal(files[1].added, 9);
});

test('a read error (like missing pdftotext) is reported per file', async () => {
  const store = openStore(':memory:');
  const h = buildHandlers(store, {
    clock: () => ({ date: '2026-11-23', time: '10:00' }),
    readPdfText: async () => { throw new Error('no pdftotext here'); },
  });
  const { files } = await h.importStatements(['/x/a.pdf', '/x/b.pdf']);
  assert.deepEqual(files.map((f) => [f.ok, f.error]), [[false, 'no pdftotext here'], [false, 'no pdftotext here']]);
});

test('kinds are classified after import', async () => {
  const { h, store } = treasurySetup();
  await h.importStatements([A]);
  const rows = store.listTransactions();
  const gopay = rows.filter((r) => r.merchant === 'GOPAYID');
  const kinds = gopay.map((r) => `${r.direction}:${r.kind}`).sort();
  assert.deepEqual(kinds, ['CR:refund', 'DB:refund', 'DB:spend']);
  assert.equal(rows.find((r) => r.amount === 320000000).kind, 'income');
});

test('getTreasury: no data', () => {
  const t = treasurySetup().h.getTreasury(null);
  assert.equal(t.hasData, false);
  assert.deepEqual(t.cycles, []);
  assert.equal(t.index, null);
  assert.equal(t.cycle, null);
  assert.equal(treasurySetup().h.getMoneySummary(), null);
});

test('getTreasury: newest cycle by default', async () => {
  const { h } = treasurySetup();
  await h.importStatements([A]);
  const t = h.getTreasury(null);
  assert.equal(t.hasData, true);
  assert.equal(t.cycles.length, 1);
  assert.equal(t.cycle.pot, 320000000);
  assert.equal(t.index, 0);
  assert.equal(h.getTreasury(99).index, 0);
  assert.equal(t.balance.current, null);
});

test('getMoneySummary: allowance left = allowance - every payment this cycle', async () => {
  const { h } = treasurySetup();
  await h.importStatements([A]);
  const m = h.getMoneySummary();
  // WEEK_A spends 50,000 + 28,000 + 17,325 + 2,500 + 151,750 (the refunded
  // 28,000 GoPay charge doesn't count), out of a 3,200,000 allowance.
  assert.equal(m.pot, 320000000);
  assert.equal(m.spent, 24957500);
  assert.equal(m.left, 320000000 - 24957500);
});

test('deleting an import reclassifies', async () => {
  const { h, store } = treasurySetup();
  await h.importStatements(['/x/d1.pdf', '/x/d2.pdf']);
  assert.deepEqual(store.listTransactions().map((r) => r.kind), ['refund', 'refund']);
  const d2 = store.listImports().find((i) => i.fileName === 'd2.pdf');
  assert.equal(h.deleteImport(d2.id).ok, true);
  assert.deepEqual(store.listTransactions().map((r) => r.kind), ['spend']);
  assert.ok(h.getMoneySummary());
});

test('setLabel rejects unknown labels', async () => {
  const { h, store } = treasurySetup();
  await h.importStatements([A]);
  const id = store.listTransactions()[0].id;
  assert.equal(h.setLabel(id, 'food').ok, false);
  assert.equal(h.setLabel(id, 'need').ok, true);
  assert.equal(store.listTransactions()[0].label, 'need');
  assert.equal(h.setLabel(id, null).ok, true);
  assert.equal(h.setMerchantLabel('TOKO MAKMU', null).ok, false);
  assert.equal(h.setMerchantLabel('', 'want').ok, false);
  assert.equal(h.setMerchantLabel('TOKO MAKMU', 'want').ok, true);
  assert.equal(h.setAllowance(id, 2).ok, false);
  assert.equal(h.setAllowance(id, 1).ok, true);
});

test('setBalance validates', () => {
  const { h } = treasurySetup();
  assert.equal(h.setBalance({ date: '16-11-2026', amount: 5 }).ok, false);
  assert.equal(h.setBalance({ date: '2026-13-40', amount: 5 }).ok, false);
  assert.equal(h.setBalance({ date: '2026-11-16', amount: 1.5 }).ok, false);
  assert.equal(h.setBalance({ date: '2026-11-16', amount: -5 }).ok, true);
});

test('setBalance stores the anchor and getTreasury uses it', async () => {
  const { h } = treasurySetup();
  await h.importStatements([A]);
  assert.equal(h.setBalance({ date: '2026-11-16', amount: 100000000 }).ok, true);
  const t = h.getTreasury(null);
  assert.equal(t.balance.current, 100000000);
  assert.equal(t.balance.asOf, '2026-11-16');
  assert.equal(t.balance.series.length, 8);
  assert.equal(t.balance.series[7].balance, 100000000);
});

test('deleteImport lists overlapping imports; importing them again restores the rows', async () => {
  const { h, store } = treasurySetup();
  await h.importStatements([A]);
  await h.importStatements([A]);   // "added 0": the rows still belong to the first import
  const first = store.listImports().sort((x, y) => x.id - y.id)[0];
  const result = h.deleteImport(first.id);
  assert.equal(result.ok, true);
  assert.equal(result.id, first.id);
  assert.ok(result.reimport.includes('a.pdf'));
  assert.equal(store.listTransactions().length, 0);
  await h.importStatements([A]);
  assert.equal(store.listTransactions().length, 9);
});

test('deleteImport with no overlap has nothing to re-import', async () => {
  const { h, store } = treasurySetup();
  await h.importStatements([A]);
  const only = store.listImports()[0];
  assert.deepEqual(h.deleteImport(only.id).reimport, []);
});

test('setBalance(null) reports errors instead of throwing', () => {
  const { h } = treasurySetup();
  assert.equal(h.setBalance(null).ok, false);
});
