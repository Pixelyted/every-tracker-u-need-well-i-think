// Money rules for the finances panel (Treasury). Pure functions only: no
// files, no database, no window. Money is always an integer number of sen.
//
// Sections:
//   1. Duplicates   - dupKey, newRows
//   2. Row kinds    - classifyKinds (spend / refund / income)
//   3. Cycles       - buildCycles, effectiveLabel, summarizeCycle
//   4. Balance      - balanceAt, coverage
const { daysBetween, addDays } = require('./time');

// A refund matches a payment made up to this many days before it.
const REFUND_DAYS = 7;
// An allowance-sized income this many days (or fewer) after a cycle's start
// belongs to that cycle instead of starting a new one.
const MERGE_DAYS = 20;
// How a cycle's pot is divided, in percent.
const SPLIT = { need: 50, want: 30, save: 20 };

// ---------- 1. Duplicates ----------

// Two rows are "the same" when these four things match.
function dupKey(row) {
  return [row.date, row.amount, row.direction, row.merchant].join('|');
}

// Which rows of a re-imported file are not saved yet? Identical charges on
// one day are real (three GoPay top-ups), so we count instead of dropping
// every repeat: if the file has 3 of a key and 2 are saved, 1 is new. The
// newest ones (last in the file) are taken as the new ones.
function newRows(fileRows, savedRows) {
  const saved = new Map();
  for (const row of savedRows) {
    saved.set(dupKey(row), (saved.get(dupKey(row)) || 0) + 1);
  }
  const inFile = new Map();
  for (const row of fileRows) {
    inFile.set(dupKey(row), (inFile.get(dupKey(row)) || 0) + 1);
  }
  // Walk the file in order and skip the first `m` copies of each key, so
  // exactly the last max(0, n - m) copies remain, still in file order.
  const skipped = new Map();
  return fileRows.filter((row) => {
    const key = dupKey(row);
    const toSkip = Math.min(inFile.get(key), saved.get(key) || 0);
    const done = skipped.get(key) || 0;
    if (done < toSkip) {
      skipped.set(key, done + 1);
      return false;
    }
    return true;
  });
}

// ---------- 2. Row kinds ----------

// A credit is a refund when the bank says so: type KR INTERCHANGE, or the
// text starts with KOR TRN (a card correction).
function isRefundCredit(row) {
  return row.direction === 'CR' &&
    (row.type === 'KR INTERCHANGE' || row.text.startsWith('KOR TRN'));
}

// Decide for every row whether it is spend, refund or income.
// Each refund credit (oldest first) cancels the newest payment that has the
// same merchant and amount and happened 0-7 days before it. Returns a Map
// of id -> kind, in the same order as the input rows.
function classifyKinds(rows) {
  const kinds = new Map();
  for (const row of rows) {
    kinds.set(row.id, row.direction === 'DB' ? 'spend' : isRefundCredit(row) ? 'refund' : 'income');
  }

  const refunds = rows.filter(isRefundCredit).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);

  for (const refund of refunds) {
    let best = null;
    for (const row of rows) {
      if (row.direction !== 'DB' || kinds.get(row.id) !== 'spend') continue;
      // A correction can key shorter than its payment ("GOOGLE" vs "GOOGLE CLAUDE BY A"),
      // so a payment whose key starts with the refund's key plus a space also counts.
      const sameShop = row.merchant === refund.merchant || row.merchant.startsWith(refund.merchant + ' ');
      if (!sameShop || row.amount !== refund.amount) continue;
      const gap = daysBetween(row.date, refund.date);
      if (gap < 0 || gap > REFUND_DAYS) continue;
      // Newest wins: later date, then larger id.
      if (!best || row.date > best.date || (row.date === best.date && row.id > best.id)) best = row;
    }
    if (best) kinds.set(best.id, 'refund');
  }
  return kinds;
}

// ---------- 3. Cycles ----------

// Newest first: later date, then larger id.
function newestFirst(a, b) {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id;
}

// A cycle runs from one allowance to the day before the next. Oldest first.
function buildCycles(rows, allowanceMin) {
  if (rows.length === 0) return [];

  // Marked "my allowance" (1) always counts; unmarked counts if big enough;
  // marked "not mine" (0) never does.
  const candidates = rows
    .filter((r) => r.kind === 'income' &&
      (r.allowance === 1 || (r.allowance === null && r.amount >= allowanceMin)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));

  const cycles = [];
  for (const c of candidates) {
    const current = cycles[cycles.length - 1];
    if (!current || daysBetween(current.start, c.date) > MERGE_DAYS) {
      cycles.push({ start: c.date, end: null, pot: c.amount, allowanceIds: [c.id], beforeTracking: false });
    } else if (c.allowance === 1) {
      // Hand-marked second part: it joins the pot. Automatic ones are just money in.
      current.pot += c.amount;
      current.allowanceIds.push(c.id);
    }
  }
  for (let i = 0; i + 1 < cycles.length; i++) {
    cycles[i].end = addDays(cycles[i + 1].start, -1);
  }

  // Anything older than the first allowance goes in a "before tracking" cycle.
  const earliest = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);
  if (cycles.length === 0 || earliest < cycles[0].start) {
    cycles.unshift({
      start: earliest,
      end: cycles.length ? addDays(cycles[0].start, -1) : null,
      pot: 0,
      allowanceIds: [],
      beforeTracking: true,
    });
  }
  return cycles;
}

// The label that counts for a row: refunds cancel out, income has none,
// spending uses the row's own label first, then its merchant's.
function effectiveLabel(row, merchantLabels) {
  if (row.kind === 'refund') return 'skip';
  if (row.kind === 'income') return null;
  return row.label ?? merchantLabels[row.merchant] ?? null;
}

// Everything the cycle card needs: limits, what is used, what is saved.
function summarizeCycle(cycle, rows, merchantLabels) {
  const inCycle = rows.filter((r) => r.date >= cycle.start && (cycle.end === null || r.date <= cycle.end));
  const payments = inCycle.map((r) => ({ ...r, effectiveLabel: effectiveLabel(r, merchantLabels) }));

  const used = { need: 0, want: 0, skip: 0 };
  const unsorted = { count: 0, amount: 0 };
  let spent = 0;
  let moneyIn = 0;
  for (const p of payments) {
    if (p.kind === 'income') moneyIn += p.amount;
    if (p.kind !== 'spend') continue;
    spent += p.amount;
    if (p.effectiveLabel === null) {
      unsorted.count += 1;
      unsorted.amount += p.amount;
    } else {
      used[p.effectiveLabel] += p.amount;
    }
  }

  const need = Math.round((cycle.pot * SPLIT.need) / 100);
  const want = Math.round((cycle.pot * SPLIT.want) / 100);
  const isUnsorted = (p) => p.kind === 'spend' && p.effectiveLabel === null;
  payments.sort((a, b) => (isUnsorted(b) - isUnsorted(a)) || newestFirst(a, b));

  return {
    start: cycle.start, end: cycle.end, beforeTracking: cycle.beforeTracking, pot: cycle.pot,
    limits: { need, want, save: cycle.pot - need - want },
    used, unsorted, saved: cycle.pot - spent, moneyIn, payments,
  };
}

// ---------- 4. Balance and coverage ----------

// Money in minus money out for rows dated after `from`, up to and including `to`.
function net(rows, from, to) {
  let sum = 0;
  for (const r of rows) {
    if (r.date > from && r.date <= to) sum += r.direction === 'CR' ? r.amount : -r.amount;
  }
  return sum;
}

// The anchor is a known balance at the end of its date. Go forwards by adding
// later rows, or backwards by undoing the rows after `day`.
function balanceAt(rows, anchor, day) {
  if (day >= anchor.date) return anchor.amount + net(rows, anchor.date, day);
  return anchor.amount - net(rows, day, anchor.date);
}

// Which days between the first and last imported day are in no import?
function coverage(imports) {
  if (imports.length === 0) return { first: null, last: null, gaps: [] };
  const sorted = [...imports].sort((a, b) => (a.periodStart < b.periodStart ? -1 : a.periodStart > b.periodStart ? 1 : 0));
  const gaps = [];
  let reach = sorted[0].periodEnd;           // last day covered so far
  for (const imp of sorted.slice(1)) {
    // A gap exists only if there is a whole day between reach and this start.
    if (imp.periodStart > addDays(reach, 1)) {
      gaps.push({ start: addDays(reach, 1), end: addDays(imp.periodStart, -1) });
    }
    if (imp.periodEnd > reach) reach = imp.periodEnd;
  }
  return { first: sorted[0].periodStart, last: reach, gaps };
}

module.exports = {
  REFUND_DAYS, MERGE_DAYS, SPLIT,
  dupKey, newRows, classifyKinds,
  buildCycles, effectiveLabel, summarizeCycle, balanceAt, coverage,
};
