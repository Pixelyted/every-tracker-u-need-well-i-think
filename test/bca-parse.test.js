const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMutasi, parseAmount } = require('../src/bca-parse');
const { WEEK_A, WEEK_B, NOT_BCA, row } = require('./bca-fixture');

test('period is read from the header', () => {
  assert.deepEqual(parseMutasi(WEEK_A).period, { start: '2026-11-09', end: '2026-11-16' });
});
test('every row on both pages is read, in file order', () => {
  const { rows, problems } = parseMutasi(WEEK_A);
  assert.equal(rows.length, 9);
  assert.deepEqual(problems, []);
  assert.deepEqual(rows[0], { date: '2026-11-16', amount: 5000000, direction: 'DB',
    text: 'TGL: 1116 QR 490 00000.00TOKO MAKMU', type: 'TRANSAKSI DEBIT' });
});
test('page break: furniture is never a row or part of one', () => {
  const { rows } = parseMutasi(WEEK_A);
  assert.equal(rows[4].type, 'TRSF E-BANKING CR');           // last row on page 1
  assert.ok(rows.every((r) => !/Bersambung|NO\. REKENING|CATATAN|Rekening$/.test(r.text + r.type)));
});
test('empty first line takes its meaning from the type', () => {
  const r = parseMutasi(WEEK_A).rows[6];
  assert.equal(r.text, ''); assert.equal(r.type, 'BIAYA ADM'); assert.equal(r.amount, 250000);
});
test('three description lines: the middle one joins the text', () => {
  const r = parseMutasi(WEEK_A).rows[7];
  assert.match(r.text, /NEW PLN MOBI- - 99999999999$/);
  assert.equal(r.type, 'TRSF E-BANKING DB');
});
test('parseAmount handles millions', () => assert.equal(parseAmount('3,200,000.00'), 320000000));
test('not a BCA mutasi: no period, no rows', () => {
  assert.deepEqual(parseMutasi(NOT_BCA), { period: null, rows: [], problems: [] });
});
test('an unreadable dated line becomes a problem, not a silent drop', () => {
  const broken = WEEK_B + '\n      20/11/2026            SOMETHING WITHOUT AN AMOUNT\n';
  const { rows, problems } = parseMutasi(broken);
  assert.equal(rows.length, 5);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^Couldn't read the line for 20\/11\/2026/);
});

// The last page ends with right-aligned "DB" lines (totals block); they once stuck to the last row.
const TOTALS = (' '.repeat(160) + 'DB\n\n').repeat(4);
test('trailing DB lines are page furniture, not part of the last row', () => {
  const text = WEEK_B + row('17/11/2026', 'TGL: 1117  QR 008                   00000.00KEDAI MAJU', '10,000.00', 'DB', 'TRANSAKSI DEBIT') + '\n' + TOTALS;
  const last = parseMutasi(text).rows.at(-1);
  assert.equal(last.type, 'TRANSAKSI DEBIT');
  assert.ok(!/DB$/.test(last.text));
});
test('a refund as the last row keeps its type before the totals lines', () => {
  const last = parseMutasi(WEEK_B + '\n' + TOTALS).rows.at(-1);
  assert.equal(last.type, 'KR INTERCHANGE');
});
test('a dated line at column 0 that is not a row becomes a problem', () => {
  const { problems } = parseMutasi(WEEK_B + '\n20/11/2026 SOMETHING WITHOUT AN AMOUNT\n');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^Couldn't read the line for 20\/11\/2026/);
});
