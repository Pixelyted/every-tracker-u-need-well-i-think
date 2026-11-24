// The Treasury screen: the cycle panel, the balance chart and the payments
// list. Like profile.js, it only draws what the main process sends
// (window.dungeon.getTreasury) and sends clicks back. No money rules live here.
//
// All money arrives as whole sen (1 rupiah = 100 sen). Only the drawing
// code turns it into rupiah.

// Which cycle is shown: its position in the oldest-first list. null = newest.
let treasuryIndex = null;
// The payments filter chip that is on. Stays when you switch cycle.
let treasuryFilter = 'all';
// The last data drawn, so the chips can redraw the list without asking again.
let lastTreasury = null;

// ---------- number and date formatting ----------

// 320000000 -> '3,200,000'
function formatRp(sen) {
  return Math.round(sen / 100).toLocaleString('en-US');
}

// 85800000 -> '858k', 320000000 -> '3.2M', 5000 -> '50'
function shortRp(sen) {
  const rp = Math.abs(Math.round(sen / 100));
  const sign = sen < 0 ? '-' : '';
  if (rp >= 1000000) return sign + String(Math.round(rp / 100000) / 10) + 'M';
  if (rp >= 1000) return sign + Math.round(rp / 1000) + 'k';
  return sign + rp;
}

// '2026-10-29' -> '29 Oct'
function formatDayMonth(date) {
  const d = parseDate(date);
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
}

// '2026-10-29' -> '29/10'
function formatSlash(date) {
  return date.slice(8, 10) + '/' + date.slice(5, 7);
}

// '29 Oct – 28 Oct' style range; a running cycle ends with "now".
function cycleRange(c) {
  if (c.beforeTracking) return 'Before tracking';
  return formatDayMonth(c.start) + ' – ' + (c.end === null ? 'now' : formatDayMonth(c.end));
}

// ---------- fixing labels, allowance, balance, imports ----------

const LABEL_CHOICES = [['need', 'Need'], ['want', 'Want'], ['skip', 'Skip']];

// Quick Need / Want buttons on an unsorted row: teach the merchant straight away.
async function setQuickLabel(txn, label) {
  const result = await window.dungeon.setMerchantLabel(txn.merchant, label);
  if (!result.ok) return showToast(result.errors.join(' '));
  await refresh();
}

// The menu for a spend row. Pick a label, and choose whether it is for this
// payment only or for every payment from the same merchant.
function openLabelMenu(txn) {
  if (txn.kind === 'refund') return; // a refund follows its payment, nothing to fix
  const body = el('div', 'dialog-lines tr-menu');
  body.append(el('div', 'dialog-text', `${txn.merchant || txn.text} · ${formatRp(txn.amount)} · ${formatSlash(txn.date)}`));
  const errors = el('div', 'errors');

  const scope = radioGroup('label-scope', [
    ['one', 'only this payment'],
    ['all', `every ${txn.merchant || 'such'} payment`],
  ], 'one');
  // A small hint: a merchant label never overrides a payment fixed by hand.
  scope.querySelectorAll('label.radio')[1].append(el('span', 'field-hint', '(not the ones you fixed by hand)'));
  let close = () => {};

  async function apply(label) {
    // A merchant label is only possible when the payment has a merchant name.
    const everyPayment = scope.value() === 'all' && txn.merchant;
    const result = everyPayment
      ? await window.dungeon.setMerchantLabel(txn.merchant, label)
      : await window.dungeon.setLabel(txn.id, label);
    if (!result.ok) return showErrors(errors, result.errors);
    // The clicked row may have its own label, which beats the merchant's. Clear
    // it so this row follows the new merchant label like the others do.
    if (everyPayment && txn.label !== null && txn.label !== undefined) {
      const cleared = await window.dungeon.setLabel(txn.id, null);
      if (!cleared.ok) return showErrors(errors, cleared.errors);
    }
    close();
    await refresh();
  }

  const picks = el('div', 'tr-menu-picks');
  for (const [label, text] of LABEL_CHOICES) {
    const mark = txn.effectiveLabel === label ? '● ' : '';
    const btn = el('button', 'pick tr-pick-' + label, mark + text);
    btn.addEventListener('click', () => apply(label));
    picks.append(btn);
  }
  body.append(el('div', 'field-hint', 'LABEL'), picks, el('div', 'field-hint', 'APPLY TO'), scope, errors);

  const buttons = [{ label: 'Close', onClick: (done) => done() }];
  // Only shown when this payment has its own label that beats the merchant's.
  if (txn.label !== null && txn.label !== undefined) {
    buttons.unshift({ label: "Use the merchant's label", onClick: () => clearOwnLabel() });
  }
  async function clearOwnLabel() {
    const result = await window.dungeon.setLabel(txn.id, null);
    if (!result.ok) return showErrors(errors, result.errors);
    close();
    await refresh();
  }
  close = openModal({ title: '🏷 FIX LABEL', content: body, buttons });
}

// The menu for a Money-in row: is it my allowance or not?
function openAllowanceMenu(txn) {
  const body = el('div', 'dialog-lines tr-menu');
  body.append(el('div', 'dialog-text', `${txn.merchant || txn.text} · +${formatRp(txn.amount)} · ${formatSlash(txn.date)}`));
  let close = () => {};
  const errors = el('div', 'errors');
  const choices = [
    [1, 'This is my allowance'],
    [0, 'Not my allowance'],
    [null, 'Decide automatically'],
  ];
  for (const [value, text] of choices) {
    const btn = el('button', 'btn tr-menu-item', (txn.allowance === value ? '● ' : '○ ') + text);
    btn.addEventListener('click', async () => {
      const result = await window.dungeon.setAllowance(txn.id, value);
      if (!result.ok) return showErrors(errors, result.errors);
      close();
      await refresh();
    });
    body.append(btn);
  }
  body.append(errors);
  close = openModal({ title: '💰 MONEY IN', content: body, buttons: [{ label: 'Close', onClick: (done) => done() }] });
}

// "3.200.000" or "3,200,000" or "3200000" -> 320000000 sen. null if unreadable.
function parseRupiah(text) {
  const t = text.trim();
  if (!/^(\d+|\d{1,3}([.,]\d{3})+)$/.test(t)) return null;
  const sen = Number(t.replace(/[.,]/g, '')) * 100;
  return Number.isSafeInteger(sen) ? sen : null;
}

function openSetBalance() {
  const anchor = lastTreasury && lastTreasury.balance.anchor;
  const asOf = lastTreasury && lastTreasury.balance.asOf;
  const date = dateInput(asOf || (anchor && anchor.date) || '');
  const amount = textInput(anchor ? formatRp(anchor.amount) : '', '3,200,000');
  const errors = el('div', 'errors');
  const row = el('div', 'field');
  row.append(el('span', 'field-label', 'My balance at the end of'), date, el('span', 'dash', 'was'), el('span', 'dash', 'Rp'), amount);
  const body = el('div', 'form');
  body.append(row, el('div', 'field-hint', 'Type rupiah, like 3.200.000. The app counts forward and back from this day.'), errors);
  openModal({
    title: '🏦 SET BALANCE',
    content: body,
    buttons: [
      { label: 'Cancel', onClick: (close) => close() },
      {
        label: 'Save',
        kind: 'btn-big',
        onClick: async (close) => {
          const sen = parseRupiah(amount.value);
          if (sen === null) return showErrors(errors, ['Type the amount in rupiah using digits only, for example 3.200.000.']);
          const result = await window.dungeon.setBalance({ date: date.value, amount: sen });
          if (!result.ok) return showErrors(errors, result.errors);
          close();
          await refresh();
        },
      },
    ],
  });
}

// Rows belong only to the import that first added them, so deleting an import
// can remove days another import also covers. These helpers name those imports.
function overlapping(imports, imp) {
  return [...new Set(imports
    .filter((o) => o.id !== imp.id && o.periodStart <= imp.periodEnd && o.periodEnd >= imp.periodStart)
    .map((o) => o.fileName))];
}

function reimportText(names) {
  return `These imports cover some of the same days: ${names.join(', ')}. Import those files again afterwards to get those days back.`;
}

async function openImportsList() {
  const imports = await window.dungeon.listImports();
  const list = el('ul', 'break-list');
  let close = () => {};
  if (imports.length === 0) list.append(el('li', 'field-hint', 'Nothing imported yet.'));
  for (const imp of imports) {
    const item = el('li', 'break-item');
    const period = imp.periodStart ? `${formatDayMonth(imp.periodStart)} – ${formatDayMonth(imp.periodEnd)}` : 'period unknown';
    item.append(el('span', 'break-name', imp.fileName), el('span', 'break-dates', `${period} · added ${imp.added}`));
    const del = el('button', 'btn btn-danger', 'Delete');
    del.addEventListener('click', async () => {
      const ok = await askDialog({
        title: `Remove "${imp.fileName}"?`,
        lines: [`Remove the ${imp.added} payments this import added? Labels you taught stay.`,
          ...(overlapping(imports, imp).length > 0 ? [reimportText(overlapping(imports, imp))] : [])],
        cancelLabel: 'Keep it',
        okLabel: 'Delete',
        okKind: 'btn-danger',
      });
      if (!ok) return;
      const result = await window.dungeon.deleteImport(imp.id);
      if (!result.ok) return showToast(result.errors.join(' '));
      close();
      await refresh();
      if (result.reimport.length > 0) showToast(reimportText(result.reimport));
      openImportsList();
    });
    item.append(del);
    list.append(item);
  }
  close = openModal({ title: '📂 IMPORTS', content: list, wide: true, buttons: [{ label: 'Close', onClick: (done) => done() }] });
}

// ---------- importing PDFs ----------

function importSummaryLines(result) {
  const box = el('div', 'dialog-lines');
  for (const f of result.files) {
    if (!f.ok) {
      box.append(el('div', 'dialog-text import-bad', `${f.fileName}: ${f.error}`));
      continue;
    }
    let line = `${f.fileName}: added ${f.added} · ${f.known} already known`;
    if (f.newMerchants.length > 0) line += ` · ${f.newMerchants.length} new merchants to sort`;
    box.append(el('div', 'dialog-text', line));
    for (const problem of f.problems) box.append(el('div', 'dialog-item', '• ' + problem));
  }
  return box;
}

async function importPdfs() {
  const paths = await window.dungeon.pickStatements();
  if (paths.length === 0) return;
  const result = await window.dungeon.importStatements(paths);
  openModal({
    title: '⬆ IMPORT RESULT',
    content: importSummaryLines(result),
    buttons: [{ label: 'OK', kind: 'btn-big', onClick: (close) => close() }],
  });
  // Redraw even if nothing was added (the change event only fires on new rows).
  await refresh();
}

function importButton() {
  const btn = el('button', 'btn btn-big', '⬆ Import PDF');
  btn.addEventListener('click', importPdfs);
  return btn;
}

// ---------- the switcher row and "All cycles" ----------

function stepCycle(treasury, step) {
  treasuryIndex = treasury.index + step;
  refresh();
}

function openAllCycles(treasury) {
  const table = el('table', 'cycle-table');
  const head = el('tr', 'muted');
  for (const h of ['Cycle', 'Pot', 'Needs', 'Wants', 'Saved', '']) head.append(el('td', h === 'Cycle' ? '' : 'n', h));
  table.append(head);
  let close = () => {};
  for (const c of [...treasury.cycles].reverse()) {
    const row = el('tr', 'cycle-row');
    row.append(el('td', '', cycleRange(c) + (c.end === null && !c.beforeTracking ? ' (this cycle)' : '')));
    if (c.beforeTracking) {
      for (let i = 0; i < 5; i++) row.append(el('td', 'n', '—'));
    } else {
      const over = (used, limit) => el('td', 'n' + (used > limit ? ' over' : ''), `${shortRp(used)} / ${shortRp(limit)}`);
      row.append(el('td', 'n', formatRp(c.pot)), over(c.used.need, c.limits.need), over(c.used.want, c.limits.want));
      row.append(el('td', 'n gold', c.end === null ? '' : formatRp(c.saved)));
      const last = el('td', 'n muted');
      if (c.end === null) last.textContent = 'running';
      else if (c.saved >= c.limits.save) last.append(el('span', 'stamp-mini', '✓ goal'));
      row.append(last);
    }
    row.addEventListener('click', () => {
      treasuryIndex = c.index;
      close();
      refresh();
    });
    table.append(row);
  }
  close = openModal({
    title: '📜 ALL CYCLES',
    content: table,
    wide: true,
    buttons: [{ label: 'Close', onClick: (done) => done() }],
  });
}

function renderSwitcher(treasury) {
  const row = el('div', 'tr-switch');
  const prev = el('button', 'btn', '◀');
  prev.disabled = treasury.index === 0;
  prev.addEventListener('click', () => stepCycle(treasury, -1));
  const next = el('button', 'btn', '▶');
  next.disabled = treasury.index === treasury.cycles.length - 1;
  next.addEventListener('click', () => stepCycle(treasury, 1));

  const c = treasury.cycle;
  const label = el('span', 'tr-cycle', cycleRange(c));
  if (!c.beforeTracking) label.append(el('span', 'muted', c.end === null ? ' · this cycle' : ' · closed'));

  const all = el('button', 'btn', '📜 All cycles');
  all.addEventListener('click', () => openAllCycles(treasury));
  row.append(prev, label, next, all);
  return row;
}

// ---------- the cycle panel ----------

// One bar: name, "858k left / 1.6M" text, and a coloured fill.
function limitBar(name, used, limit, color) {
  const over = used > limit;
  const text = over
    ? `${shortRp(used - limit)} over / ${shortRp(limit)}`
    : `${shortRp(limit - used)} left / ${shortRp(limit)}`;
  return barBlock(name, text, over, limit > 0 ? (used / limit) * 100 : 0, over ? 'var(--curse)' : color);
}

function barBlock(name, text, bad, percent, color) {
  const box = el('div', 'tr-bar');
  const legend = el('div', 'tr-leg');
  legend.append(el('span', '', name), el('span', bad ? 'bad' : 'muted', text));
  const bar = el('div', 'bar');
  const fill = el('i');
  fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
  fill.style.background = color;
  bar.append(fill);
  box.append(legend, bar);
  return box;
}

// The donut as a conic-gradient. It is always the pot, split 50/30/20:
//   Needs / Wants: the part used (bright), then what is still free (dark).
//   Save: the part kept (gold), then the part that was eaten.
// Spending past a limit has nowhere to go but the Save part, so it is drawn
// in curse red inside Save; the rest of the eaten part is faded gold.
function donutBackground(c) {
  const parts = [];
  const add = (amount, color) => { if (amount > 0) parts.push({ amount, color }); };
  const spend = (used, limit, bright, dark) => {
    add(Math.min(used, limit), bright);
    add(Math.max(0, limit - used), dark);
  };
  spend(c.used.need, c.limits.need, 'var(--camp)', 'var(--camp-dark)');
  spend(c.used.want, c.limits.want, 'var(--legend)', 'var(--legend-dark)');
  const over = Math.max(0, c.used.need - c.limits.need) + Math.max(0, c.used.want - c.limits.want);
  const kept = Math.min(Math.max(c.saved, 0), c.limits.save);
  const eaten = c.limits.save - kept;
  const red = Math.min(over, eaten);
  add(kept, 'var(--gold)');
  add(eaten - red, 'var(--gold-dark)');
  add(red, 'var(--curse)');
  const total = parts.reduce((sum, p) => sum + p.amount, 0);
  if (total === 0) return 'var(--stone-3)';
  let angle = 0;
  const stops = parts.map((p) => {
    const from = angle;
    angle += (p.amount / total) * 360;
    return `${p.color} ${from}deg ${angle}deg`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

function renderCyclePanel(treasury) {
  const c = treasury.cycle;
  const panel = el('section', 'panel tr-cycle-panel');
  const head = el('div', 'tr-head');
  const title = c.beforeTracking ? 'BEFORE TRACKING'
    : c.end === null ? 'THIS CYCLE · since ' + formatDayMonth(c.start)
      : 'CYCLE · ' + cycleRange(c);
  const imports = el('button', 'btn', '📂 Imports');
  imports.addEventListener('click', openImportsList);
  const buttons = el('div', 'tr-btns');
  buttons.append(imports, importButton());
  head.append(el('h3', 'profile-h', title), buttons);
  panel.append(head);

  if (c.beforeTracking) {
    panel.append(el('div', 'muted', 'These payments came before the first allowance, so there is no pot to measure them against.'));
    return panel;
  }

  const sub = el('div', 'muted tr-sub',
    `pot ${formatRp(c.pot)} · allowance in on ${formatSlash(c.start)}` + (c.end === null ? '' : ' · closed when the next allowance came'));
  panel.append(sub);

  // The one number that answers "how much of my allowance is left?":
  // the allowance minus every payment this cycle (Needs, Wants, Skip and
  // unsorted alike). It's the same as `saved`.
  const spent = c.pot - c.saved;
  const left = el('div', 'tr-remain' + (c.saved < 0 ? ' bad' : ''));
  left.append(
    el('span', 'tr-remain-label', c.end === null ? 'Allowance left' : 'Allowance left at the end'),
    el('b', 'tr-remain-num', formatRp(c.saved)),
    el('span', 'muted', `of ${formatRp(c.pot)} · spent ${formatRp(spent)}`),
  );
  panel.append(left);

  const body = el('div', 'tr-body');
  const donut = el('div', 'donut');
  donut.style.background = donutBackground(c);
  donut.append(el('div', 'mid', shortRp(c.pot)));

  const bars = el('div', 'tr-bars');
  bars.append(limitBar('Needs', c.used.need, c.limits.need, 'var(--camp)'));
  bars.append(limitBar('Wants', c.used.want, c.limits.want, 'var(--legend)'));
  const goal = c.limits.save;
  const saveText = c.end === null
    ? (c.saved >= goal ? `${shortRp(goal)} untouched` : `${shortRp(c.saved)} left`)
    : `${shortRp(c.saved)} of ${shortRp(goal)} kept`;
  bars.append(barBlock('Save', saveText, c.saved < 0, goal > 0 ? (c.saved / goal) * 100 : 0, 'var(--gold)'));
  body.append(donut, bars);
  panel.append(body);

  if (c.end !== null) {
    const bad = c.saved < 0;
    panel.append(el('div', 'stamp' + (bad ? ' bad' : ''),
      bad ? `🪙 OVER BY ${formatRp(-c.saved)} · goal ${formatRp(goal)}` : `🪙 SAVED ${formatRp(c.saved)} · goal ${formatRp(goal)}`));
  }
  if (c.unsorted.count > 0) {
    const sort = el('button', 'tr-unsorted', `❓ ${c.unsorted.count} to sort · ${formatRp(c.unsorted.amount)}`);
    sort.addEventListener('click', () => { treasuryFilter = 'unsorted'; drawPayments(); });
    panel.append(sort);
  }
  return panel;
}

// ---------- the balance panel ----------

// Bars to draw: one per day, or one per week (its last day) when long.
function balanceBars(series) {
  if (series.length <= 60) return series;
  const weekly = [];
  for (let i = 6; i < series.length; i += 7) weekly.push(series[i]);
  if ((series.length - 1) % 7 !== 6) weekly.push(series[series.length - 1]);
  return weekly;
}

function renderBalancePanel(balance) {
  const panel = el('section', 'panel');
  if (!balance.anchor) {
    panel.append(el('h3', 'profile-h', '🏦 BALANCE'));
    panel.append(el('div', 'muted', 'Tell the app what your balance was on one day and it will keep track from there.'));
    const btn = el('button', 'btn tr-set-balance', 'Set balance');
    btn.addEventListener('click', openSetBalance);
    panel.append(btn);
    return panel;
  }
  const head = el('div', 'tr-head');
  const asOf = balance.asOf ? ' · as of ' + formatDayMonth(balance.asOf) : '';
  head.append(el('h3', 'profile-h', `🏦 BALANCE · ${formatRp(balance.current)}${asOf}`));
  const edit = el('button', 'btn', 'Set balance');
  edit.addEventListener('click', openSetBalance);
  head.append(edit);
  panel.append(head);

  const bars = balanceBars(balance.series);
  // Scale between the lowest and highest balance, so a jump is visible
  // even when every balance is in the millions.
  const lo = Math.min(...bars.map((b) => b.balance));
  const hi = Math.max(...bars.map((b) => b.balance));
  const spark = el('div', 'spark');
  for (const b of bars) {
    const bar = el('i');
    bar.style.height = (8 + (92 * (b.balance - lo)) / Math.max(1, hi - lo)) + '%';
    bar.title = formatDayMonth(b.date) + ': ' + formatRp(b.balance);
    spark.append(bar);
  }
  panel.append(spark);
  panel.append(el('div', 'muted', series60Note(balance.series.length)));
  if (balance.gaps.length > 0) {
    const ranges = balance.gaps.map((g) => `${formatSlash(g.start)}–${formatSlash(g.end)}`).join(', ');
    panel.append(el('div', 'tr-gap', `⚠ missing ${ranges}, import it for a correct balance`));
  }
  return panel;
}

function series60Note(days) {
  return days > 60 ? 'one bar per week · big jump = allowance' : 'one bar per day · big jump = allowance';
}

// ---------- the payments list ----------

const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'unsorted', label: '❓ To sort', test: (p) => p.kind === 'spend' && p.effectiveLabel === null },
  { key: 'need', label: 'Needs', test: (p) => p.effectiveLabel === 'need' },
  { key: 'want', label: 'Wants', test: (p) => p.effectiveLabel === 'want' },
  { key: 'income', label: 'Money in', test: (p) => p.kind === 'income' },
  { key: 'skip', label: 'Skipped', test: (p) => p.effectiveLabel === 'skip' },
];

function paymentTag(p) {
  if (p.kind === 'income') {
    const tag = el('button', 'tag in', p.allowance === 1 ? 'Allowance' : 'Money in');
    tag.addEventListener('click', () => openAllowanceMenu(p));
    return tag;
  }
  if (p.effectiveLabel === 'skip') {
    const tag = el(p.kind === 'refund' ? 'span' : 'button', 'tag skip', 'Skipped' + (p.kind === 'refund' ? ' · refunded' : ''));
    if (p.kind !== 'refund') tag.addEventListener('click', () => openLabelMenu(p));
    return tag;
  }
  if (p.effectiveLabel === null) {
    const box = el('span', 'picks');
    for (const [label, text] of [['need', 'Need'], ['want', 'Want']]) {
      const pick = el('button', 'pick', text);
      pick.addEventListener('click', () => setQuickLabel(p, label));
      box.append(pick);
    }
    return box;
  }
  const tag = el('button', 'tag ' + p.effectiveLabel, p.effectiveLabel === 'need' ? 'Need' : 'Want');
  tag.addEventListener('click', () => openLabelMenu(p));
  return tag;
}

function paymentRow(p) {
  const row = el('tr');
  row.append(el('td', '', formatSlash(p.date)));
  const name = el('td', '', p.merchant || p.text);
  name.title = p.text;
  row.append(name);
  row.append(el('td', 'n' + (p.direction === 'CR' ? ' in' : ''), (p.direction === 'CR' ? '+' : '') + formatRp(p.amount)));
  const tagCell = el('td');
  tagCell.append(paymentTag(p));
  row.append(tagCell);
  return row;
}

function drawPayments() {
  const box = document.getElementById('tr-payments');
  if (!box || !lastTreasury) return;
  const payments = lastTreasury.cycle.payments;
  box.replaceChildren();

  const chips = el('div', 'chips');
  for (const f of FILTERS) {
    const count = payments.filter(f.test).length;
    const chip = el('button', 'chip' + (f.key === treasuryFilter ? ' on' : '') + (count === 0 ? ' dim' : ''), `${f.label} ${count}`);
    chip.addEventListener('click', () => { treasuryFilter = f.key; drawPayments(); });
    chips.append(chip);
  }
  box.append(chips);

  const test = (FILTERS.find((f) => f.key === treasuryFilter) || FILTERS[0]).test;
  const shown = payments.filter(test);
  if (shown.length === 0) {
    box.append(el('div', 'muted', 'Nothing here.'));
    return;
  }
  const table = el('table', 'pay-table');
  for (const p of shown) table.append(paymentRow(p));
  const scroll = el('div', 'pay-scroll');
  scroll.append(table);
  box.append(scroll);
}

function renderPaymentsPanel(treasury) {
  const c = treasury.cycle;
  const panel = el('section', 'panel tr-pay-panel');
  const end = c.end === null ? 'now' : formatDayMonth(c.end);
  panel.append(el('h3', 'profile-h', c.beforeTracking ? 'PAYMENTS · before tracking' : `PAYMENTS · ${formatDayMonth(c.start)} – ${end}`));
  const box = el('div');
  box.id = 'tr-payments';
  panel.append(box);
  return panel;
}

// ---------- the whole screen ----------

function renderTreasury(treasury) {
  lastTreasury = treasury;
  const screen = document.getElementById('treasury-screen');
  screen.replaceChildren();

  if (!treasury.hasData) {
    const panel = el('section', 'panel tr-empty');
    // Imports can exist without rows (e.g. all deleted rows), so keep the manager reachable.
    const imports = el('button', 'btn', '📂 Imports');
    imports.addEventListener('click', openImportsList);
    panel.append(el('h3', 'profile-h', '💰 TREASURY'), imports, importButton());
    panel.append(el('div', 'muted', 'In m-BCA: m-Info → Mutasi Rekening → download the PDF, then import it here.'));
    screen.append(panel);
    return;
  }
  // The shown cycle can change under us (e.g. the newest was chosen with null).
  treasuryIndex = treasury.index === treasury.cycles.length - 1 ? null : treasury.index;

  screen.append(renderSwitcher(treasury));
  const row = el('div', 'tr-row');
  const left = el('div', 'tr-left');
  left.append(renderCyclePanel(treasury));
  left.append(renderBalancePanel(treasury.balance));
  row.append(left, renderPaymentsPanel(treasury));
  screen.append(row);
  drawPayments();
}
