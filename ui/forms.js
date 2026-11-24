// Forms and dialogs: new/edit quest, the quest menu, move, breaks,
// settings and first launch. Loaded after app.js, so it can use its
// helpers (el, formatTime, formatDayShort, localToday, ...).
//
// The order of warnings when saving a quest follows spec 7.4:
//   1. a limited event that would cancel quests -> cancel preview
//   2. a quest on a limited-event day           -> "will be shown as cancelled"
//   3. any clash                                -> clash dialog
// Only after every dialog is accepted is the quest saved.

const COLOURS = ['#3f7fbf', '#3fa37a', '#b8673a', '#5a6fc4', '#2f9aa8', '#8a5cc0', '#b0573f', '#c0392b', '#7a8a3a', '#6d6d7a'];
const ICONS = ['📐', '🧮', '💻', '📏', '🔌', '🗄', '⌨', '📚', '🧪', '📝', '🔬', '🎓', '🏃', '🎨', '🎵', '⚙'];
const WEEKDAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ---------- modal basics ----------

// Opens a modal panel. `content` is a DOM node; `buttons` is a list of
// { label, kind, onClick }. Returns a function that closes it.
function openModal({ title, content, buttons = [], wide = false }) {
  const backdrop = el('div', 'modal-backdrop');
  const modal = el('div', 'modal panel' + (wide ? ' wide' : ''));
  modal.setAttribute('role', 'dialog');
  modal.append(el('h2', 'panel-title', title));
  if (content) modal.append(content);
  const row = el('div', 'modal-buttons');
  function close() {
    backdrop.remove();
  }
  for (const b of buttons) {
    const btn = el('button', 'btn' + (b.kind ? ' ' + b.kind : ''), b.label);
    btn.addEventListener('click', () => b.onClick(close));
    row.append(btn);
  }
  if (buttons.length > 0) modal.append(row);
  backdrop.append(modal);
  // Clicking outside the panel or pressing Escape closes it.
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  document.getElementById('modal-root').append(backdrop);
  const first = modal.querySelector('input, select, textarea, button');
  if (first) first.focus();
  return close;
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const all = document.querySelectorAll('#modal-root .modal-backdrop');
  if (all.length > 0) all[all.length - 1].remove();
});

// A yes/no dialog. Resolves to true when the "ok" button is pressed.
function askDialog({ title, lines = [], okLabel, cancelLabel = 'Retreat', okKind = '' }) {
  return new Promise((resolve) => {
    const body = el('div', 'dialog-lines');
    for (const line of lines) body.append(el('div', line.startsWith('•') ? 'dialog-item' : 'dialog-text', line));
    openModal({
      title,
      content: body,
      buttons: [
        { label: cancelLabel, onClick: (close) => { close(); resolve(false); } },
        { label: okLabel, kind: okKind || 'btn-big', onClick: (close) => { close(); resolve(true); } },
      ],
    });
    // If the dialog is closed some other way, treat it as "Retreat".
    const observer = new MutationObserver(() => {
      if (!document.body.contains(body)) {
        observer.disconnect();
        resolve(false);
      }
    });
    observer.observe(document.getElementById('modal-root'), { childList: true });
  });
}

// ---------- small form helpers ----------

function field(labelText, input, hint) {
  const row = el('label', 'field');
  row.append(el('span', 'field-label', labelText), input);
  if (hint) row.append(el('span', 'field-hint', hint));
  return row;
}

function textInput(value, placeholder, className) {
  const input = el('input', className || '');
  input.type = 'text';
  input.value = value || '';
  if (placeholder) input.placeholder = placeholder;
  return input;
}

function dateInput(value) {
  const input = el('input');
  input.type = 'date';
  input.value = value || '';
  return input;
}

// A time box that accepts '7.00', '07.00' or '07:00'.
function timeInput(value) {
  const input = textInput(value ? formatTime(value) : '', '07.00', 'time');
  input.maxLength = 5;
  return input;
}

// Turns what was typed into 'HH:MM'. Anything unreadable is passed on as
// typed, so the validator can explain what's wrong.
function readTime(input) {
  const match = /^\s*(\d{1,2})[.:](\d{2})\s*$/.exec(input.value);
  if (!match) return input.value.trim();
  return pad2(Number(match[1])) + ':' + match[2];
}

function radioGroup(name, options, selected) {
  const box = el('div', 'radios');
  for (const [value, label] of options) {
    const wrap = el('label', 'radio');
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.checked = value === selected;
    wrap.append(input, el('span', '', label));
    box.append(wrap);
  }
  box.value = () => (box.querySelector('input:checked') || {}).value;
  return box;
}

function selectInput(options, selected) {
  const select = el('select');
  for (const [value, label] of options) {
    const opt = el('option', '', label);
    opt.value = String(value);
    opt.selected = String(value) === String(selected);
    select.append(opt);
  }
  return select;
}

// A row of swatches (colours or icons); returns a box with .value().
function swatches(items, selected, isColour) {
  const box = el('div', 'swatches');
  let current = selected || items[0];
  for (const item of items) {
    const sw = el('button', 'swatch' + (item === current ? ' picked' : ''), isColour ? '' : item);
    sw.type = 'button';
    if (isColour) sw.style.background = item;
    sw.title = item;
    sw.addEventListener('click', () => {
      current = item;
      box.querySelectorAll('.swatch').forEach((s) => s.classList.remove('picked'));
      sw.classList.add('picked');
    });
    box.append(sw);
  }
  box.value = () => current;
  return box;
}

function showErrors(box, errors) {
  box.replaceChildren(...errors.map((e) => el('div', 'error', '✖ ' + e)));
}

// ---------- the warnings before saving ----------

// 'Potion Brewing 101  Mon 23 Nov 07.00–09.30 (+3 more weeks)', one line per quest.
function clashLines(clashes) {
  const groups = new Map();
  for (const occ of clashes) {
    if (!groups.has(occ.questId)) groups.set(occ.questId, []);
    groups.get(occ.questId).push(occ);
  }
  const lines = [];
  for (const group of groups.values()) {
    const o = group[0];
    let line = `• ${o.name}  ${formatDayShort(o.date)} ${formatTime(o.start)}–${formatTime(o.end)}`;
    if (group.length > 1) line += ` (+${group.length - 1} more weeks)`;
    lines.push(line);
  }
  return lines;
}

// Shows whichever warning applies. Resolves to true when it's OK to save.
// One dialog per kind of warning. Resolves to true when accepted.
function warningDialog(step, name, checks) {
  if (step === 'wouldCancel') {
    const n = checks.wouldCancel.length;
    const lines = checks.wouldCancel.map((o) => `• ${o.name}  ${formatDayShort(o.date)} ${formatTime(o.start)}–${formatTime(o.end)}`);
    return askDialog({ title: `This will cancel ${n} quest${n === 1 ? '' : 's'}:`, lines, okLabel: 'Begin event ⭐' });
  }
  if (step === 'cancelledBy') {
    const days = checks.cancelledDates.map(formatDayShort).join(', ');
    const one = checks.cancelledDates.length === 1;
    return askDialog({
      title: '⭐ Limited event day',
      lines: [`${days} ${one ? 'is' : 'are'} ${checks.cancelledBy.join(', ')}; this quest will be shown as cancelled on ${one ? 'that day' : 'those days'}.`],
      okLabel: 'Add anyway',
    });
  }
  return askDialog({
    title: `⚠ CLASH: "${name}" overlaps`,
    lines: clashLines(checks.clashes),
    okLabel: 'Force it ⚔',
    okKind: 'btn-danger',
  });
}

// Shows every warning that applies, one after the other (the order comes
// from src/draft.js warningSteps). Resolves to true only when all of them
// were accepted; one "Retreat" stops the save.
async function confirmWarnings(name, checks) {
  for (const step of checks.steps) {
    if (!(await warningDialog(step, name, checks))) return false;
  }
  return true;
}

// ---------- new / edit quest ----------

function openNewQuest(prefill = {}) {
  openQuestForm({ kind: 'main', repeat: 'weekly', weekday: 1, date: localToday(), ...prefill }, null);
}

function openEditQuest(quest) {
  openQuestForm(quest, quest.id);
}

function openQuestForm(quest, editingId, { addAnother = false } = {}) {
  const form = el('div', 'form');
  const type = radioGroup('kind', [['main', 'Main quest'], ['side', 'Side quest'], ['limited', 'Limited event ⭐']], quest.kind);
  const name = textInput(quest.name, 'e.g. Potion Brewing 101 Midterm');
  const repeat = radioGroup('repeat', [['weekly', 'Every week'], ['once', 'Once']], quest.repeat || 'weekly');
  const weekday = selectInput(WEEKDAY_LABELS.map((l, i) => [i + 1, l]), quest.weekday || 1);
  const onceDate = dateInput(quest.date || localToday());
  const start = timeInput(quest.start);
  const end = timeInput(quest.end);
  const colour = swatches(COLOURS, quest.color, true);
  const icon = swatches(ICONS, quest.icon, false);
  const startDate = dateInput(quest.startDate || localToday());
  const startTime = timeInput(quest.kind === 'limited' ? quest.start : '');
  const endDate = dateInput(quest.endDate || localToday());
  const endTime = timeInput(quest.kind === 'limited' ? quest.end : '');
  const note = textInput(quest.note, 'optional, e.g. room 3.2');
  const errors = el('div', 'errors');

  const weeklyRow = field('Day', weekday);
  const onceRow = field('Date', onceDate);
  const regular = el('div', 'group');
  regular.append(field('Repeats', repeat), weeklyRow, onceRow);
  const timesRow = el('div', 'field');
  timesRow.append(el('span', 'field-label', 'Time'), start, el('span', 'dash', '–'), end);
  regular.append(timesRow);
  const looks = el('div', 'group');
  looks.append(field('Colour', colour), field('Icon', icon));
  const limited = el('div', 'group');
  const fromRow = el('div', 'field');
  fromRow.append(el('span', 'field-label', 'Starts'), startDate, startTime);
  const toRow = el('div', 'field');
  toRow.append(el('span', 'field-label', 'Ends'), endDate, endTime);
  limited.append(fromRow, toRow, el('div', 'field-hint', 'Every other quest on these days will be cancelled (still shown).'));

  form.append(field('Type', type), field('Name', name), regular, looks, limited, field('Note', note), errors);

  // Show only the fields that fit the chosen type.
  function updateVisibility() {
    const kind = type.value();
    const isLimited = kind === 'limited';
    regular.hidden = isLimited;
    limited.hidden = !isLimited;
    looks.hidden = kind !== 'main';
    weeklyRow.hidden = repeat.value() !== 'weekly';
    onceRow.hidden = repeat.value() !== 'once';
  }
  type.addEventListener('change', updateVisibility);
  repeat.addEventListener('change', updateVisibility);
  updateVisibility();

  // Builds the quest object from the form.
  function readQuest() {
    const kind = type.value();
    const q = { kind, name: name.value.trim(), note: note.value.trim() || null, color: null, icon: null };
    if (editingId) q.id = editingId;
    if (kind === 'limited') {
      return { ...q, repeat: null, startDate: startDate.value, start: readTime(startTime), endDate: endDate.value, end: readTime(endTime) };
    }
    if (kind === 'main') {
      q.color = colour.value();
      q.icon = icon.value();
    }
    q.repeat = repeat.value();
    q.start = readTime(start);
    q.end = readTime(end);
    if (q.repeat === 'weekly') q.weekday = Number(weekday.value);
    else q.date = onceDate.value;
    return q;
  }

  async function save(close, again) {
    const q = readQuest();
    const problems = await window.dungeon.validateQuest(q);
    if (problems.length > 0) return showErrors(errors, problems);
    const checks = await window.dungeon.checkDraft(q, { editingId });
    if (!(await confirmWarnings(q.name, checks))) return;
    const result = await window.dungeon.saveQuest(q);
    if (!result.ok) return showErrors(errors, result.errors);
    close();
    if (again) openQuestForm({ kind: q.kind, repeat: q.repeat, weekday: q.weekday, date: q.date }, null, { addAnother: true });
  }

  const buttons = [{ label: 'Cancel', onClick: (close) => close() }];
  if (addAnother) buttons.push({ label: 'Save & add another', onClick: (close) => save(close, true) });
  buttons.push({ label: editingId ? 'Save changes' : 'Save quest', kind: 'btn-big', onClick: (close) => save(close, false) });
  openModal({ title: editingId ? '✎ EDIT QUEST' : '+ NEW QUEST', content: form, buttons, wide: true });
}

// ---------- quest menu (clicking a block) ----------

function describeOccurrence(occ) {
  const lines = [`${formatDayShort(occ.date)}  ${occ.start === '00:00' && occ.end === '24:00' ? 'all day' : formatTime(occ.start) + '–' + formatTime(occ.end)}`];
  if (occ.status === 'skipped') lines.push('Skipped on this date.');
  if (occ.status === 'moved') lines.push(`Moved → ${formatDayShort(occ.movedTo.date)} ${formatTime(occ.movedTo.start)}–${formatTime(occ.movedTo.end)}`);
  if (occ.status === 'cancelled') lines.push(`Cancelled by ${occ.cancelledBy}.`);
  if (occ.status === 'break') lines.push('Off: camp (break).');
  if (occ.isMakeup) lines.push(`Make-up for ${formatDayShort(occ.movedFrom)}.`);
  if (occ.note) lines.push(occ.note);
  return lines;
}

async function confirmDelete(quest) {
  const what = quest.repeat === 'weekly' ? 'every week of this quest' : 'this quest';
  const ok = await askDialog({ title: `Delete "${quest.name}"?`, lines: [`This removes ${what}.`], cancelLabel: 'Keep it', okLabel: 'Delete', okKind: 'btn-danger' });
  if (ok) await window.dungeon.deleteQuest(quest.id);
}

async function openQuestMenu(occ) {
  const quest = await window.dungeon.getQuest(occ.questId);
  if (!quest) return;
  const body = el('div', 'dialog-lines');
  for (const line of describeOccurrence(occ)) body.append(el('div', 'dialog-text', line));
  const buttons = [];
  const isWeekly = quest.repeat === 'weekly' && !occ.isMakeup;

  if (occ.status === 'skipped') {
    buttons.push({ label: '↺ Restore', kind: 'btn-big', onClick: async (close) => { close(); await window.dungeon.removeChange(quest.id, occ.date); } });
  } else if (occ.status === 'moved') {
    buttons.push({ label: '↺ Undo move', kind: 'btn-big', onClick: async (close) => { close(); await window.dungeon.removeChange(quest.id, occ.date); } });
  } else if (occ.isMakeup) {
    buttons.push({ label: '↺ Undo move', onClick: async (close) => { close(); await window.dungeon.removeChange(quest.id, occ.movedFrom); } });
    buttons.push({ label: '↪ Move again', onClick: (close) => { close(); openMoveForm({ ...occ, date: occ.movedFrom, start: quest.start, end: quest.end }, occ); } });
  } else if (isWeekly && occ.status === 'active') {
    buttons.push({ label: '↷ Skip this date', onClick: async (close) => { close(); await window.dungeon.setChange({ questId: quest.id, originalDate: occ.date, action: 'skip' }); } });
    buttons.push({ label: '↪ Move this date', onClick: (close) => { close(); openMoveForm(occ); } });
  }
  buttons.push({ label: '✎ Edit', onClick: (close) => { close(); openEditQuest(quest); } });
  buttons.push({ label: '🗑 Delete', kind: 'btn-danger', onClick: async (close) => { close(); await confirmDelete(quest); } });
  buttons.push({ label: 'Close', onClick: (close) => close() });

  const icon = occ.kind === 'limited' ? '⭐ ' : occ.kind === 'side' ? '◆ ' : occ.isBoss ? '⚔ BOSS: ' : '';
  openModal({ title: icon + occ.name, content: body, buttons });
}

// ---------- move this date ----------

// `occ` is the original occurrence (its date is the original date).
// `current` is the existing make-up when moving again.
function openMoveForm(occ, current = null) {
  const form = el('div', 'form');
  form.append(el('div', 'dialog-text', `From: ${occ.name}  ${formatDayShort(occ.date)} ${formatTime(occ.start)}–${formatTime(occ.end)}`));
  const date = dateInput(current ? current.date : occ.date);
  const start = timeInput(current ? current.start : occ.start);
  const end = timeInput(current ? current.end : occ.end);
  const errors = el('div', 'errors');
  const timesRow = el('div', 'field');
  timesRow.append(el('span', 'field-label', 'Time'), start, el('span', 'dash', '–'), end);
  form.append(field('New date', date), timesRow, errors);

  async function save(close) {
    const slot = { date: date.value, start: readTime(start), end: readTime(end) };
    const problems = await window.dungeon.validateMove(slot);
    if (problems.length > 0) return showErrors(errors, problems);
    const checks = await window.dungeon.checkMove(occ.questId, occ.date, slot);
    if (!(await confirmWarnings(occ.name, checks))) return;
    const result = await window.dungeon.setChange({ questId: occ.questId, originalDate: occ.date, action: 'move', newDate: slot.date, newStart: slot.start, newEnd: slot.end });
    if (!result.ok) return showErrors(errors, result.errors);
    close();
  }

  openModal({
    title: '↪ MOVE THIS DATE',
    content: form,
    buttons: [
      { label: 'Cancel', onClick: (close) => close() },
      { label: 'Move it', kind: 'btn-big', onClick: save },
    ],
  });
}

// ---------- bounties (deadlines) ----------

// `bounty` is an existing one to edit, or null for a new one.
function openBountyForm(bounty) {
  const form = el('div', 'form');
  const name = textInput(bounty ? bounty.name : '', 'e.g. Potion homework 3');
  const date = dateInput(bounty ? bounty.dueDate : addDays(localToday(), 1));
  const time = timeInput(bounty ? bounty.dueTime : '23:59');
  const note = textInput(bounty ? bounty.note : '', 'optional, e.g. upload to the course page');
  const errors = el('div', 'errors');
  const dueRow = el('div', 'field');
  dueRow.append(el('span', 'field-label', 'Due'), date, time);
  form.append(field('Name', name), dueRow, field('Note', note), errors,
    el('div', 'field-hint', 'Reminders: 20.00 the evening before, and 2 hours before it is due.'));

  async function save(close) {
    const d = { name: name.value.trim(), dueDate: date.value, dueTime: readTime(time), note: note.value.trim() || null };
    if (bounty) d.id = bounty.id;
    const result = await window.dungeon.saveDeadline(d);
    if (!result.ok) return showErrors(errors, result.errors);
    close();
  }

  openModal({
    title: bounty ? '✎ EDIT BOUNTY' : '📜 NEW BOUNTY',
    content: form,
    buttons: [
      { label: 'Cancel', onClick: (close) => close() },
      { label: bounty ? 'Save changes' : 'Post bounty', kind: 'btn-big', onClick: save },
    ],
  });
}

// Clicking a bounty in the strip or the panel.
function openBountyMenu(b) {
  const body = el('div', 'dialog-lines');
  body.append(el('div', 'dialog-text', `Due ${formatDayShort(b.dueDate)} ${formatTime(b.dueTime)}`));
  if (b.status === 'overdue') body.append(el('div', 'dialog-text', '⏰ Overdue'));
  if (b.status === 'done') body.append(el('div', 'dialog-text', '✔ Claimed'));
  if (b.note) body.append(el('div', 'dialog-text', b.note));
  const done = b.status === 'done';
  openModal({
    title: '📜 ' + b.name,
    content: body,
    buttons: [
      done
        ? { label: '↺ Not done yet', onClick: async (close) => { close(); await window.dungeon.setDeadlineDone(b.id, false); } }
        : { label: '✔ Claim (done)', kind: 'btn-big', onClick: async (close) => { close(); await window.dungeon.setDeadlineDone(b.id, true); } },
      { label: '✎ Edit', onClick: (close) => { close(); openBountyForm(b); } },
      {
        label: '🗑 Delete',
        kind: 'btn-danger',
        onClick: async (close) => {
          close();
          if (await askDialog({ title: `Delete "${b.name}"?`, cancelLabel: 'Keep it', okLabel: 'Delete', okKind: 'btn-danger' })) {
            await window.dungeon.deleteDeadline(b.id);
          }
        },
      },
      { label: 'Close', onClick: (close) => close() },
    ],
  });
}

// ---------- breaks ----------

async function openBreaks() {
  const body = el('div', 'form');
  const list = el('ul', 'break-list');
  const name = textInput('', 'e.g. Midterm week');
  const start = dateInput('');
  const end = dateInput('');
  const errors = el('div', 'errors');
  let editingId = null;
  const saveBtn = el('button', 'btn btn-big', '+ Add break');

  async function reload() {
    const breaks = await window.dungeon.listBreaks();
    list.replaceChildren();
    if (breaks.length === 0) list.append(el('li', 'field-hint', 'No breaks yet.'));
    for (const b of breaks) {
      const item = el('li', 'break-item');
      item.append(el('span', 'break-name', `🏕 ${b.name}`), el('span', 'break-dates', `${formatDayShort(b.startDate)} → ${formatDayShort(b.endDate)}`));
      const edit = el('button', 'btn', '✎');
      edit.title = 'Edit';
      edit.addEventListener('click', () => {
        editingId = b.id;
        name.value = b.name;
        start.value = b.startDate;
        end.value = b.endDate;
        saveBtn.textContent = 'Save break';
      });
      const del = el('button', 'btn btn-danger', '🗑');
      del.title = 'Delete';
      del.addEventListener('click', async () => {
        if (await askDialog({ title: `Delete "${b.name}"?`, cancelLabel: 'Keep it', okLabel: 'Delete', okKind: 'btn-danger' })) {
          await window.dungeon.deleteBreak(b.id);
          reload();
        }
      });
      item.append(edit, del);
      list.append(item);
    }
  }

  saveBtn.addEventListener('click', async () => {
    const brk = { name: name.value.trim(), startDate: start.value, endDate: end.value };
    if (editingId) brk.id = editingId;
    const result = await window.dungeon.saveBreak(brk);
    if (!result.ok) return showErrors(errors, result.errors);
    editingId = null;
    name.value = '';
    start.value = '';
    end.value = '';
    saveBtn.textContent = '+ Add break';
    showErrors(errors, []);
    reload();
  });

  const datesRow = el('div', 'field');
  datesRow.append(el('span', 'field-label', 'Dates'), start, el('span', 'dash', '→'), end);
  body.append(list, el('div', 'field-hint', 'On a break every weekly main quest is off. Side quests and one-time quests still happen.'), field('Name', name), datesRow, errors, saveBtn);
  openModal({ title: '🏕 BREAKS', content: body, buttons: [{ label: 'Close', onClick: (close) => close() }], wide: true });
  reload();
}

// ---------- settings ----------

function sectionTitle(text) {
  return el('h3', 'section-title', text);
}

function checkbox(checked, label) {
  const wrap = el('label', 'check');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = Boolean(checked);
  wrap.append(input, el('span', '', label));
  wrap.input = input;
  return wrap;
}

// One line describing the Google push, from getPushStatus():
// { connected, enabled, authExpired, lastPush }.
function pushStatusText(status) {
  if (!status || !status.connected) return 'Not connected.';
  if (status.authExpired) return '⚠ Google disconnected: the sign-in expired. Click Reconnect.';
  const last = status.lastPush;
  if (!last) return 'Connected. Nothing pushed yet.';
  if (last.ok) {
    // `at` is stored in UTC; show it in the laptop's local time.
    const at = new Date(last.at);
    return `Last pushed ${pad2(at.getHours())}.${pad2(at.getMinutes())}`;
  }
  return 'Push failed, will retry: ' + last.error;
}

// Reconnect after the sign-in expired (every 7 days while the Google app is
// in Testing mode). Opens the browser; resolves with the connect result.
async function reconnectGoogle() {
  const result = await window.dungeon.googleConnect();
  // If it didn't work, Settings shows why and has the Reconnect button.
  if (!result.ok) openSettings();
  return result;
}

// The Google part of Settings. It redraws itself whenever the push status
// changes (after every push, connect or disconnect).
function googleSection(settings) {
  const box = el('div', 'form');
  const clientId = textInput(settings.googleClientId, 'Client ID');
  const clientSecret = textInput(settings.googleClientSecret, 'Client secret');
  clientSecret.type = 'password';
  const status = el('div', 'field-hint push-status');
  const buttons = el('div', 'inline-buttons');

  function button(label, kind, onClick) {
    const b = el('button', 'btn' + (kind ? ' ' + kind : ''), label);
    b.addEventListener('click', onClick);
    return b;
  }

  async function saveCredentials() {
    await window.dungeon.setSettings({ googleClientId: clientId.value.trim(), googleClientSecret: clientSecret.value.trim() });
  }

  async function connect() {
    await saveCredentials();
    status.textContent = 'Opening Google sign-in in your browser… (finish there, then come back)';
    const result = await window.dungeon.googleConnect();
    if (!result.ok) status.textContent = 'Could not connect: ' + result.error;
    else redraw();
  }

  async function redraw() {
    const s = await window.dungeon.getPushStatus();
    status.textContent = pushStatusText(s);
    status.classList.toggle('warn', Boolean(s.connected && (s.authExpired || (s.lastPush && !s.lastPush.ok))));
    buttons.replaceChildren();
    if (!s.connected) {
      buttons.append(button('Connect Google', 'btn-big', connect));
      return;
    }
    if (s.authExpired) buttons.append(button('⟳ Reconnect Google', 'btn-big', connect));
    buttons.append(button('Push now', '', async () => {
      status.textContent = 'Pushing…';
      await window.dungeon.pushNow();
      redraw();
    }));
    buttons.append(button('Disconnect', '', async () => {
      await window.dungeon.googleDisconnect();
      redraw();
      status.textContent = 'Disconnected. The ⚔ every tracker u need, well i think calendar stays in Google.';
    }));
  }

  // Every time Settings opens this adds a listener, so once Settings has
  // been closed the listener removes itself instead of piling up.
  const stopListening = window.dungeon.onPushStatus(() => {
    if (document.body.contains(box)) redraw();
    else stopListening();
  });
  box.append(
    el('div', 'field-hint', 'See docs/google-setup.md for how to get these.'),
    field('Client ID', clientId), field('Secret', clientSecret), buttons, status,
  );
  redraw();
  return box;
}

async function openSettings() {
  const [semester, settings, trayStatus] = await Promise.all([
    window.dungeon.getSemester(),
    window.dungeon.getSettings(),
    window.dungeon.getTrayStatus(),
  ]);
  const body = el('div', 'form settings');
  const semErrors = el('div', 'errors');

  // Semester
  const semName = textInput(semester ? semester.name : '', 'e.g. Autumn 2026');
  const semStart = dateInput(semester ? semester.startDate : '');
  const semEnd = dateInput(semester ? semester.endDate : '');
  const semRow = el('div', 'field');
  semRow.append(el('span', 'field-label', 'Dates'), semStart, el('span', 'dash', '→'), semEnd);
  const saveSem = el('button', 'btn', 'Save semester');
  saveSem.addEventListener('click', async () => {
    const result = await window.dungeon.saveSemester({ id: semester && semester.id, name: semName.value.trim(), startDate: semStart.value, endDate: semEnd.value });
    showErrors(semErrors, result.ok ? [] : result.errors);
    if (result.ok) saveSem.textContent = 'Saved ✔';
  });
  const newSem = el('button', 'btn btn-danger', 'Start new semester…');
  newSem.addEventListener('click', async () => {
    const ok = await askDialog({
      title: "Archive this semester's timetable?",
      lines: ['Its weekly quests stop showing up (they stay stored), and their Google series end on its last date. Then you enter the new timetable.'],
      cancelLabel: 'Keep it',
      okLabel: 'Archive',
      okKind: 'btn-danger',
    });
    if (ok) openSemesterForm({ isNew: true });
  });
  const semButtons = el('div', 'inline-buttons');
  semButtons.append(saveSem, newSem);

  // Reminders
  const lead = el('input', 'time');
  lead.type = 'number';
  lead.min = '0';
  lead.max = '240';
  lead.value = settings.leadMinutes;
  const leadRow = el('div', 'field');
  leadRow.append(el('span', 'field-label', 'Remind me'), lead, el('span', 'field-hint', 'minutes before'));
  const desktop = checkbox(settings.desktopNotifications, 'Desktop notifications');
  const login = checkbox(settings.launchOnLogin, 'Start when I log in');
  const saveReminders = el('button', 'btn', 'Save');
  saveReminders.addEventListener('click', async () => {
    const minutes = Math.max(0, Math.min(240, Math.round(Number(lead.value) || 0)));
    lead.value = minutes;
    await window.dungeon.setSettings({ leadMinutes: minutes, desktopNotifications: desktop.input.checked, launchOnLogin: login.input.checked });
    saveReminders.textContent = 'Saved ✔';
  });

  // Treasury: how big a deposit has to be to count as a new allowance.
  const allowanceMin = textInput(formatRp(settings.allowanceMin), '2,000,000', 'time');
  const treasuryRow = el('div', 'field');
  treasuryRow.append(el('span', 'field-label', 'A big income starts a new cycle when it is at least'), el('span', 'dash', 'Rp'), allowanceMin);
  const treasuryErrors = el('div', 'errors');
  const saveTreasury = el('button', 'btn', 'Save');
  saveTreasury.addEventListener('click', async () => {
    const sen = parseRupiah(allowanceMin.value);
    if (sen === null || sen <= 0) return showErrors(treasuryErrors, ['Type the amount in rupiah using digits only, for example 2.000.000.']);
    const result = await window.dungeon.setSettings({ allowanceMin: sen });
    showErrors(treasuryErrors, result && result.ok === false ? result.errors : []);
    if (!result || result.ok !== false) saveTreasury.textContent = 'Saved ✔';
  });

  body.append(
    sectionTitle('Semester'), field('Name', semName), semRow, semErrors, semButtons,
    sectionTitle('Reminders'), leadRow, desktop, login, saveReminders,
    sectionTitle('Treasury'), treasuryRow, treasuryErrors, saveTreasury,
  );
  if (trayStatus && trayStatus.hint) body.append(el('div', 'field-hint tray-hint', trayStatus.hint));
  body.append(sectionTitle('Google Calendar (one-way push)'), googleSection(settings));
  openModal({ title: '⚙ SETTINGS', content: body, buttons: [{ label: 'Close', onClick: (close) => close() }], wide: true });
}

// ---------- semester form (first launch and "start new semester") ----------

function openSemesterForm({ isNew }) {
  const form = el('div', 'form');
  const name = textInput('', 'e.g. Autumn 2026');
  const start = dateInput('');
  const end = dateInput('');
  const errors = el('div', 'errors');
  const row = el('div', 'field');
  row.append(el('span', 'field-label', 'Dates'), start, el('span', 'dash', '→'), end);
  form.append(
    el('div', 'dialog-text', isNew ? 'Enter the new semester. Your old timetable is archived.' : 'Welcome, adventurer! First, when does your semester run?'),
    field('Name', name), row, errors,
  );
  async function save(close) {
    const sem = { name: name.value.trim(), startDate: start.value, endDate: end.value };
    const result = isNew ? await window.dungeon.startNewSemester(sem) : await window.dungeon.saveSemester(sem);
    if (!result.ok) return showErrors(errors, result.errors);
    close();
    document.querySelectorAll('#modal-root .modal-backdrop').forEach((m) => m.remove());
    // Next: enter the weekly classes.
    openQuestForm({ kind: 'main', repeat: 'weekly', weekday: 1 }, null, { addAnother: true });
  }
  const buttons = [{ label: isNew ? 'Start semester' : 'Begin ⚔', kind: 'btn-big', onClick: save }];
  if (isNew) buttons.unshift({ label: 'Cancel', onClick: (close) => close() });
  openModal({ title: isNew ? '⚔ NEW SEMESTER' : '⚔ A NEW DUNGEON', content: form, buttons });
}

async function openFirstLaunch() {
  if ((await window.dungeon.getSemester()) === null) openSemesterForm({ isNew: false });
}

// ---------- hooks used by app.js ----------

window.onActionButton = (id) => {
  if (id === 'new-quest') openNewQuest();
  if (id === 'new-bounty') openBountyForm(null);
  if (id === 'open-breaks') openBreaks();
  if (id === 'open-settings') openSettings();
};

window.onAppReady = openFirstLaunch;

// Clicking the "Google disconnected" notification opens Settings.
window.dungeon.onOpenSettings(() => {
  if (!document.querySelector('#modal-root .modal-backdrop')) openSettings();
});

// The main screen's Reconnect button (only shown while the sign-in is expired).
document.getElementById('reconnect-google').addEventListener('click', reconnectGoogle);
