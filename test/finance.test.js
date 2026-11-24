const test = require('node:test');
const assert = require('node:assert/strict');
const { newRows, classifyKinds, buildCycles, effectiveLabel, summarizeCycle, balanceAt, coverage } = require('../src/finance');

const t = (id, date, amount, direction, merchant, extra = {}) =>
  ({ id, date, amount, direction, merchant, text: '', type: '', label: null, allowance: null, importId: 1, ...extra });

test('newRows: identical charges are kept by count', () => {
  const file = [t(1, '2026-11-16', 2800000, 'DB', 'GOPAYID'), t(2, '2026-11-16', 2800000, 'DB', 'GOPAYID'), t(3, '2026-11-16', 2800000, 'DB', 'GOPAYID')];
  assert.equal(newRows(file, []).length, 3);
  assert.equal(newRows(file, file.slice(0, 2)).length, 1);
  assert.equal(newRows(file, file).length, 0);
});
test('classifyKinds: a refund cancels the newest matching payment', () => {
  const rows = [t(1, '2026-11-10', 2800000, 'DB', 'GOPAYID'), t(2, '2026-11-10', 2800000, 'DB', 'GOPAYID'),
    t(3, '2026-11-10', 2800000, 'CR', 'GOPAYID', { type: 'KR INTERCHANGE' }), t(4, '2026-11-12', 10000000, 'CR', 'BUDI SANTOSO')];
  assert.deepEqual([...classifyKinds(rows)], [[1, 'spend'], [2, 'refund'], [3, 'refund'], [4, 'income']]);
});
test('classifyKinds: a refund with no payment in reach is still a refund', () => {
  const rows = [t(1, '2026-11-01', 1031200, 'DB', 'GOOGLE'), t(2, '2026-11-10', 1031200, 'CR', 'GOOGLE', { text: 'KOR TRN MASTERCARDGoogle' })];
  assert.deepEqual([...classifyKinds(rows)], [[1, 'spend'], [2, 'refund']]);   // 9 days apart: no match
});
test('newRows: keeps file order and the last copies of each key', () => {
  const a = t(1, '2026-11-01', 100, 'DB', 'A'), b = t(2, '2026-11-01', 200, 'DB', 'B'), a2 = t(3, '2026-11-01', 100, 'DB', 'A');
  assert.deepEqual(newRows([a, b, a2], [a]).map((r) => r.id), [2, 3]);
});
test('classifyKinds: does not mutate its input', () => {
  const rows = [t(1, '2026-11-10', 100, 'DB', 'X')];
  classifyKinds(rows);
  assert.equal(rows[0].kind, undefined);
});

test('classifyKinds: a payment exactly 7 days before the refund is matched', () => {
  const rows = [t(1, '2026-11-03', 100, 'DB', 'X'), t(2, '2026-11-10', 100, 'CR', 'X', { type: 'KR INTERCHANGE' })];
  assert.equal(classifyKinds(rows).get(1), 'refund');
});
test('classifyKinds: a payment dated after the refund is not matched', () => {
  const rows = [t(1, '2026-11-11', 100, 'DB', 'X'), t(2, '2026-11-10', 100, 'CR', 'X', { type: 'KR INTERCHANGE' })];
  assert.equal(classifyKinds(rows).get(1), 'spend');
});

const inc = (id, date, amount, allowance = null) => ({ ...t(id, date, amount, 'CR', 'BUDI'), kind: 'income', allowance });
const pay = (id, date, amount, merchant, label = null) => ({ ...t(id, date, amount, 'DB', merchant, { label }), kind: 'spend' });

test('buildCycles: allowance to allowance, before-tracking first', () => {
  const rows = [pay(1, '2026-10-25', 100, 'A'), inc(2, '2026-10-29', 320000000), inc(3, '2026-11-06', 25000000), inc(4, '2026-11-30', 300000000)];
  assert.deepEqual(buildCycles(rows, 200000000).map((c) => [c.start, c.end, c.pot, c.beforeTracking]), [
    ['2026-10-25', '2026-10-28', 0, true], ['2026-10-29', '2026-11-29', 320000000, false], ['2026-11-30', null, 300000000, false]]);
});
test('buildCycles: an automatic second big income within 20 days is just money in', () => {
  const rows = [inc(1, '2026-10-29', 320000000), inc(2, '2026-11-10', 250000000)];
  assert.equal(buildCycles(rows, 200000000).length, 1);
});
test('buildCycles: a hand-marked second part within 20 days adds to the pot', () => {
  const rows = [inc(1, '2026-10-29', 150000000, 1), inc(2, '2026-11-02', 150000000, 1)];
  const [c] = buildCycles(rows, 200000000);
  assert.equal(c.pot, 300000000); assert.deepEqual(c.allowanceIds, [1, 2]);
});
test('buildCycles: "not my allowance" is never a cycle start', () => {
  assert.equal(buildCycles([inc(1, '2026-10-29', 320000000, 0)], 200000000)[0].beforeTracking, true);
});
test('buildCycles: no rows, no cycles; no allowance at all is one before-tracking cycle', () => {
  assert.deepEqual(buildCycles([], 200000000), []);
  const [c] = buildCycles([pay(1, '2026-10-25', 100, 'A')], 200000000);
  assert.deepEqual([c.start, c.end, c.beforeTracking], ['2026-10-25', null, true]);
});
test('buildCycles: a candidate 21 days after the start begins a new cycle, 20 does not', () => {
  assert.equal(buildCycles([inc(1, '2026-10-01', 150000000, 1), inc(2, '2026-10-21', 150000000, 1)], 200000000).length, 1);
  assert.equal(buildCycles([inc(1, '2026-10-01', 150000000, 1), inc(2, '2026-10-22', 150000000, 1)], 200000000).length, 2);
});
test('effectiveLabel: refund is skip, income is null, spend uses override then merchant', () => {
  assert.equal(effectiveLabel({ kind: 'refund' }, {}), 'skip');
  assert.equal(effectiveLabel({ kind: 'income' }, {}), null);
  assert.equal(effectiveLabel({ kind: 'spend', label: null, merchant: 'M' }, { M: 'need' }), 'need');
  assert.equal(effectiveLabel({ kind: 'spend', label: 'want', merchant: 'M' }, { M: 'need' }), 'want');
  assert.equal(effectiveLabel({ kind: 'spend', label: null, merchant: 'Z' }, {}), null);
});
test('summarizeCycle: limits, used, unsorted and saved (skip counts against save)', () => {
  const rows = [inc(1, '2026-10-29', 320000000), pay(2, '2026-10-30', 50000000, 'IDM'), pay(3, '2026-10-31', 20000000, 'GOPAYID'),
    pay(4, '2026-11-01', 10000000, 'FRIEND'), pay(5, '2026-11-02', 1200000, 'NEW')];
  const [c] = buildCycles(rows, 200000000);
  const s = summarizeCycle(c, rows, { IDM: 'need', GOPAYID: 'want', FRIEND: 'skip' });
  assert.deepEqual(s.limits, { need: 160000000, want: 96000000, save: 64000000 });
  assert.deepEqual(s.used, { need: 50000000, want: 20000000, skip: 10000000 });
  assert.deepEqual(s.unsorted, { count: 1, amount: 1200000 });
  assert.equal(s.saved, 320000000 - 81200000);
  assert.equal(s.moneyIn, 320000000);
  assert.equal(s.payments[0].id, 5);                       // unsorted on top
  assert.deepEqual(s.payments.map((p) => p.id), [5, 4, 3, 2, 1]);
});
test('summarizeCycle: only rows inside the cycle count', () => {
  const rows = [inc(1, '2026-10-29', 320000000), pay(2, '2026-10-28', 100, 'A'), inc(3, '2026-11-30', 300000000), pay(4, '2026-11-30', 7, 'A')];
  const cycles = buildCycles(rows, 200000000);
  const s = summarizeCycle(cycles[1], rows, {});
  assert.deepEqual(s.payments.map((p) => p.id), [1]);
});
test('override beats merchant label', () => {
  const rows = [inc(1, '2026-10-29', 320000000), pay(2, '2026-10-30', 5410000, 'IDM', 'want'), pay(3, '2026-10-31', 3440000, 'IDM')];
  const s = summarizeCycle(buildCycles(rows, 200000000)[0], rows, { IDM: 'need' });
  assert.deepEqual(s.used, { need: 3440000, want: 5410000, skip: 0 });
});
test('balanceAt works forwards and backwards from the anchor', () => {
  const rows = [pay(1, '2026-11-10', 5000000, 'A'), inc(2, '2026-11-12', 10000000), pay(3, '2026-11-14', 2000000, 'B')];
  const anchor = { date: '2026-11-12', amount: 100000000 };
  assert.equal(balanceAt(rows, anchor, '2026-11-14'), 98000000);
  assert.equal(balanceAt(rows, anchor, '2026-11-11'), 90000000);
  assert.equal(balanceAt(rows, anchor, '2026-11-09'), 95000000);
});
test('coverage finds the missing week', () => {
  const c = coverage([{ periodStart: '2026-10-24', periodEnd: '2026-10-31' }, { periodStart: '2026-11-09', periodEnd: '2026-11-16' }]);
  assert.deepEqual(c, { first: '2026-10-24', last: '2026-11-16', gaps: [{ start: '2026-11-01', end: '2026-11-08' }] });
});
test('coverage: overlapping and adjacent periods leave no gap; none gives nulls', () => {
  const c = coverage([{ periodStart: '2026-10-01', periodEnd: '2026-10-10' }, { periodStart: '2026-10-08', periodEnd: '2026-10-15' }, { periodStart: '2026-10-16', periodEnd: '2026-10-20' }]);
  assert.deepEqual(c, { first: '2026-10-01', last: '2026-10-20', gaps: [] });
  assert.deepEqual(coverage([]), { first: null, last: null, gaps: [] });
});
test('classifyKinds: a correction keyed shorter than its payment still matches', () => {
  const rows = [
    t(1, '2026-11-10', 15000000, 'DB', 'GOOGLE CLAUDE BY A'),
    t(2, '2026-11-12', 15000000, 'CR', 'GOOGLE', { text: 'KOR TRN MASTERCARDGoogle', type: 'KR OTOMATIS' }),
  ];
  assert.equal(classifyKinds(rows).get(1), 'refund');
  assert.equal(classifyKinds(rows).get(2), 'refund');
});
