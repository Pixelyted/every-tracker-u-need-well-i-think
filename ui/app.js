// The main screen: the week grid and Today's Quests.
//
// All schedule rules live in src/ (the main process). This file only asks
// for data through `window.dungeon` (see preload.js) and draws it.
// Forms and dialogs live in forms.js, which is loaded after this file.

// ---------- small date helpers (the window can't load src/time.js) ----------

const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 'YYYY-MM-DD' -> a Date at UTC midnight (so time zones can't shift it).
function parseDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toDateString(d) {
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

function addDays(date, n) {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateString(d);
}

// 1 = Monday ... 7 = Sunday.
function weekdayOf(date) {
  const day = parseDate(date).getUTCDay();
  return day === 0 ? 7 : day;
}

function mondayOf(date) {
  return addDays(date, 1 - weekdayOf(date));
}

// Today's date from the laptop clock.
function localToday() {
  const now = new Date();
  return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
}

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// '07:00' -> '07.00'
function formatTime(time) {
  return time.replace(':', '.');
}

// '2026-12-05' -> 'Sat 5 Dec'
function formatDayShort(date) {
  const d = parseDate(date);
  return DAY_SHORT[weekdayOf(date) - 1] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
}

// Shortcut for building elements: el('div', 'class names', 'text').
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- state ----------

let currentMonday = mondayOf(localToday());
let lastWeek = null;
let currentScreen = 'week';
// The level we saw on the last refresh. null until the first load, so
// opening the app never shows a level-up message.
let lastLevel = null;

// ---------- week header ----------

function renderTitle(weekData) {
  const floor = weekData.floor === null ? '–' : weekData.floor;
  document.getElementById('week-title').textContent = `⚔ WEEK ${weekData.week} · FLOOR ${floor} ⚔`;
}

function renderDayHeads(dates, today) {
  const heads = document.getElementById('day-heads');
  heads.replaceChildren();
  dates.forEach((date, i) => {
    const head = el('div', 'day-head' + (date === today.date ? ' is-today' : ''));
    head.append(el('div', 'dow', DAY_NAMES[i]), el('div', 'dnum', String(parseDate(date).getUTCDate()) + ' ' + MONTHS[parseDate(date).getUTCMonth()]));
    heads.append(head);
  });
}

// ---------- banners: limited events and camps ----------

// Groups each limited event's occurrences in this week, so one banner can
// stretch across all of its days.
function limitedEventsInWeek(dates, days) {
  const events = new Map();
  dates.forEach((date, index) => {
    for (const occ of days[date]) {
      if (occ.kind !== 'limited') continue;
      if (!events.has(occ.questId)) events.set(occ.questId, { first: occ, firstCol: index, lastCol: index, last: occ, clash: false });
      const ev = events.get(occ.questId);
      ev.lastCol = index;
      ev.last = occ;
      if (occ.clashKeys.length > 0) ev.clash = true;
    }
  });
  return [...events.values()];
}

function eventBannerText(ev) {
  const from = ev.first.start === '00:00' ? '' : ' ' + formatTime(ev.first.start);
  const to = ev.last.end === '24:00' ? '' : ' until ' + formatTime(ev.last.end);
  return `⭐ ${ev.first.name.toUpperCase()} ⭐${from}${to}`;
}

function renderBanners(dates, weekData) {
  const box = document.getElementById('banners');
  box.replaceChildren();
  for (const ev of limitedEventsInWeek(dates, weekData.days)) {
    const banner = el('div', 'banner legend' + (ev.clash ? ' clash' : ''), (ev.clash ? '⚠ ' : '') + eventBannerText(ev));
    banner.style.gridColumn = `${ev.firstCol + 1} / ${ev.lastCol + 2}`;
    banner.title = `${ev.first.name}: limited event. Every other quest on these days is cancelled.`;
    banner.addEventListener('click', () => openQuestMenu(ev.first));
    box.append(banner);
  }
  for (const brk of weekData.breaks) {
    const cols = dates.map((d, i) => (d >= brk.startDate && d <= brk.endDate ? i : -1)).filter((i) => i >= 0);
    if (cols.length === 0) continue;
    const banner = el('div', 'banner camp', `🏕 CAMP: ${brk.name}`);
    banner.style.gridColumn = `${cols[0] + 1} / ${cols[cols.length - 1] + 2}`;
    box.append(banner);
  }
}

// ---------- bounties (deadlines) ----------

// 'today 23.59', 'tomorrow 23.59', 'in 3 days · Fri 27 Nov', '⏰ 2 days late'.
function bountyWhen(b) {
  const time = formatTime(b.dueTime);
  if (b.status === 'overdue') {
    if (b.daysLeft === 0) return `⏰ late (was due ${time})`;
    const days = -b.daysLeft;
    return `⏰ ${days} day${days === 1 ? '' : 's'} late`;
  }
  if (b.daysLeft === 0) return `today ${time}`;
  if (b.daysLeft === 1) return `tomorrow ${time}`;
  return `in ${b.daysLeft} days · ${formatDayShort(b.dueDate)} ${time}`;
}

// A row under the day heads with the bounties due on each day.
function renderBountyStrip(dates, deadlines) {
  const strip = document.getElementById('bounty-strip');
  strip.replaceChildren();
  const any = dates.some((d) => deadlines[d]);
  strip.hidden = !any;
  if (!any) return;
  for (const date of dates) {
    const cell = el('div', 'bounty-cell');
    for (const b of deadlines[date] || []) {
      const chip = el('div', 'bounty-chip ' + b.status, `📜 ${formatTime(b.dueTime)} ${b.name}`);
      chip.title = `${b.name}\nDue ${formatDayShort(b.dueDate)} ${formatTime(b.dueTime)}`
        + (b.status === 'done' ? '\n✔ Claimed' : '') + (b.note ? `\n${b.note}` : '');
      chip.addEventListener('click', () => openBountyMenu(b));
      cell.append(chip);
    }
    strip.append(cell);
  }
}

// The 📜 BOUNTIES panel: overdue first, then the next 14 days.
function renderBounties(bounties) {
  const list = document.getElementById('bounty-list');
  list.replaceChildren();
  if (bounties.length === 0) {
    list.append(el('li', 'field-hint', 'No bounties on the board.'));
    return;
  }
  for (const b of bounties) {
    const item = el('li', 'bounty-item ' + b.status);
    const tick = el('button', 'tick', '☐');
    tick.title = 'Claim it (mark as done)';
    tick.addEventListener('click', (e) => {
      e.stopPropagation(); // don't open the menu as well
      window.dungeon.setDeadlineDone(b.id, true);
    });
    item.append(tick, el('span', 'b-name', b.name), el('span', 'b-when', bountyWhen(b)));
    item.addEventListener('click', () => openBountyMenu(b));
    list.append(item);
  }
}

// ---------- the time grid ----------

// Occurrences drawn as blocks in the grid. Limited events are banners, and
// weekly main quests on a break are hidden (the camp banner says why).
function isGridBlock(occ) {
  return occ.kind !== 'limited' && occ.status !== 'break';
}

// The visible hours: from the week's earliest start to its latest end,
// rounded to whole hours, or 07–18 when the week is empty.
function timeRange(dates, days) {
  let first = Infinity;
  let last = -Infinity;
  for (const date of dates) {
    for (const occ of days[date].filter(isGridBlock)) {
      first = Math.min(first, toMinutes(occ.start));
      last = Math.max(last, toMinutes(occ.end));
    }
  }
  if (first === Infinity) return { from: 7 * 60, to: 18 * 60 };
  let from = Math.floor(first / 60) * 60;
  let to = Math.ceil(last / 60) * 60;
  // Show at least 8 hours, so a quiet week doesn't blow one quest up to
  // fill the whole screen. Grow downwards first, then upwards.
  const MIN_SPAN = 8 * 60;
  if (to - from < MIN_SPAN) {
    to = Math.min(24 * 60, from + MIN_SPAN);
    from = Math.max(0, to - MIN_SPAN);
  }
  return { from, to };
}

function renderAxis(range) {
  const axis = document.getElementById('time-axis');
  axis.replaceChildren();
  const span = range.to - range.from;
  for (let m = range.from; m <= range.to; m += 60) {
    const tick = el('div', 'tick', pad2(m / 60) + '.00');
    tick.style.top = ((m - range.from) / span) * 100 + '%';
    axis.append(tick);
  }
}

function blockClasses(occ) {
  const classes = ['quest', occ.kind];
  if (occ.isBoss) classes.push('boss');
  if (occ.status !== 'active') classes.push('ghost', occ.status);
  if (occ.status === 'active' && occ.clashKeys.length > 0) classes.push('clash');
  if (occ.cleared) classes.push('cleared');
  return classes.join(' ');
}

// The little label in front of the name, if any.
function blockTag(occ) {
  if (occ.status === 'skipped') return 'SKIPPED';
  if (occ.status === 'moved') return 'moved → ' + formatDayShort(occ.movedTo.date);
  if (occ.status === 'cancelled') return '✖ CANCELLED';
  if (occ.isMakeup) return '↪ make-up';
  if (occ.origin === 'google') return '📅';
  return null;
}

function blockTitle(occ) {
  let text = `${occ.name}\n${formatDayShort(occ.date)} ${formatTime(occ.start)}–${formatTime(occ.end)}`;
  if (occ.status === 'moved') text += `\nMoved to ${formatDayShort(occ.movedTo.date)} ${formatTime(occ.movedTo.start)}`;
  if (occ.isMakeup) text += `\nMake-up for ${formatDayShort(occ.movedFrom)}`;
  if (occ.cancelledBy) text += `\nCancelled by ${occ.cancelledBy}`;
  if (occ.origin === 'google') text += '\nFrom your Google calendar';
  if (occ.note) text += `\n${occ.note}`;
  return text;
}

function renderBlock(occ, place, range) {
  const span = range.to - range.from;
  const block = el('div', blockClasses(occ));
  const start = toMinutes(occ.start);
  const end = toMinutes(occ.end);
  block.style.top = ((start - range.from) / span) * 100 + '%';
  block.style.height = `calc(${((end - start) / span) * 100}% - 2px)`;
  block.style.left = `calc(${(place.col / place.cols) * 100}% + 2px)`;
  block.style.width = `calc(${100 / place.cols}% - 4px)`;
  if (occ.color && occ.kind === 'main') block.style.setProperty('--q', occ.color);
  if (end - start <= 60) block.classList.add('short');
  if (place.cols > 1) block.classList.add('narrow');

  const tag = blockTag(occ);
  const name = el('div', 'q-name');
  // The ⚠ sits in the text flow (not on top of it) so it never hides the name.
  if (occ.status === 'active' && occ.clashKeys.length > 0) name.append(el('span', 'clash-tag', '⚠'));
  if (tag) name.append(el('span', 'q-tag' + (occ.isMakeup ? ' makeup-tag' : ''), tag));
  const marker = occ.kind === 'side' ? '◆ ' : occ.icon ? occ.icon + ' ' : '';
  name.append(document.createTextNode(marker + occ.name));
  block.append(name, el('div', 'q-time', `${formatTime(occ.start)}–${formatTime(occ.end)}`));
  if (occ.cleared) block.append(el('span', 'stamp', '✔'));
  block.title = blockTitle(occ);
  block.addEventListener('click', () => openQuestMenu(occ));
  return block;
}

function isBreakDay(date, breaks) {
  return breaks.some((b) => date >= b.startDate && date <= b.endDate);
}

function renderGrid(dates, weekData, range) {
  const grid = document.getElementById('grid');
  grid.replaceChildren();
  const span = range.to - range.from;
  for (const date of dates) {
    const col = el('div', 'day-col' + (date === weekData.today.date ? ' is-today' : ''));
    if (isBreakDay(date, weekData.breaks)) col.append(el('div', 'camp-fill', '🏕'));
    for (let m = range.from; m <= range.to; m += 60) {
      const line = el('div', 'hour-line');
      line.style.top = ((m - range.from) / span) * 100 + '%';
      col.append(line);
    }
    for (const occ of weekData.days[date].filter(isGridBlock)) {
      col.append(renderBlock(occ, weekData.layout[date][occ.key], range));
    }
    const nowMin = toMinutes(weekData.today.time);
    if (date === weekData.today.date && nowMin >= range.from && nowMin <= range.to) {
      const now = el('div', 'now-line');
      now.style.top = ((nowMin - range.from) / span) * 100 + '%';
      col.append(now);
    }
    grid.append(col);
  }
}

function renderWeek(weekData) {
  lastWeek = weekData;
  const dates = Object.keys(weekData.days).sort();
  renderTitle(weekData);
  renderDayHeads(dates, weekData.today);
  renderBanners(dates, weekData);
  renderBountyStrip(dates, weekData.deadlines);
  const range = timeRange(dates, weekData.days);
  renderAxis(range);
  renderGrid(dates, weekData, range);
}

// ---------- Today's Quests ----------

// The first active quest that hasn't finished yet is "next up".
function nextUpKey(occurrences) {
  const next = occurrences.find((o) => o.status === 'active' && !o.cleared);
  return next ? next.key : null;
}

function todayMark(occ, isNext) {
  if (isNext) return '▶';
  if (occ.cleared) return '✔';
  return { skipped: '↷', moved: '↪', cancelled: '✖', break: '🏕' }[occ.status] || '·';
}

function todayNote(occ, all) {
  if (occ.status === 'skipped') return 'skipped today';
  if (occ.status === 'moved') return `moved → ${formatDayShort(occ.movedTo.date)} ${formatTime(occ.movedTo.start)}`;
  if (occ.status === 'cancelled') return `cancelled by ${occ.cancelledBy}`;
  if (occ.status === 'break') return 'at camp (break)';
  if (occ.clashKeys.length > 0) {
    const names = all.filter((o) => occ.clashKeys.includes(o.key)).map((o) => o.name);
    return '⚠ clashes with ' + names.join(', ');
  }
  if (occ.isMakeup) return `↪ make-up for ${formatDayShort(occ.movedFrom)}`;
  return occ.note || '';
}

function todayTime(occ) {
  if (occ.start === '00:00' && occ.end === '24:00') return 'all day';
  return formatTime(occ.start);
}

function renderToday(occurrences) {
  const today = localToday();
  document.getElementById('today-title').textContent = `▶ TODAY'S QUESTS (${formatDayShort(today)})`;
  const list = document.getElementById('today-list');
  list.replaceChildren();
  const nextKey = nextUpKey(occurrences);
  for (const occ of occurrences) {
    const isNext = occ.key === nextKey;
    const item = el('li', ['today-item', occ.kind, occ.status !== 'active' ? 'faded' : '', isNext ? 'next' : ''].join(' ').trim());
    if (occ.color && occ.kind === 'main') item.style.setProperty('--q', occ.color);
    const marker = occ.kind === 'limited' ? '⭐ ' : occ.kind === 'side' ? '◆ ' : '';
    item.append(el('span', 't-mark', todayMark(occ, isNext)), el('span', 't-time', todayTime(occ)), el('span', 't-name', marker + occ.name));
    const note = todayNote(occ, occurrences);
    if (note) item.append(el('span', 't-note', note));
    item.addEventListener('click', () => openQuestMenu(occ));
    list.append(item);
  }
  if (!occurrences.some((o) => o.status === 'active' && !o.cleared)) {
    list.append(el('li', 'rest', 'Rest at camp 🔥'));
  }
}

// ---------- the quest menu (filled in by forms.js) ----------

function openQuestMenu(occurrence) {
  console.log('quest menu', occurrence.key);
}

function openBountyMenu(bounty) {
  console.log('bounty menu', bounty.id);
}

// ---------- loading and navigation ----------

// Shows the Reconnect button only while the Google sign-in is expired.
async function renderGoogleWarning() {
  const status = await window.dungeon.getPushStatus();
  document.getElementById('reconnect-google').hidden = !(status.connected && status.authExpired);
}

// ---------- level-up message ----------

let toastTimer = null;

function showToast(text) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = el('div', 'toast');
    toast.id = 'toast';
    document.body.append(toast);
  }
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

// Shows "LEVEL UP" when the level is higher than at the last refresh.
function checkLevelUp(info) {
  if (lastLevel !== null && info.level > lastLevel) {
    // Gear that unlocked on the way up (GEAR is from avatar.js).
    const unlocked = GEAR.filter((g) => g.level > lastLevel && g.level <= info.level).map((g) => g.item);
    showToast(`⬆ LEVEL ${info.level}!` + (unlocked.length > 0 ? ' New gear: ' + unlocked.join(', ') : ''));
  }
  lastLevel = info.level;
}

// ---------- the three screens ----------

// Switches between the Week, Profile and Treasury screens.
function showScreen(name) {
  currentScreen = name;
  document.getElementById('week-screen').hidden = name !== 'week';
  document.getElementById('profile-screen').hidden = name !== 'profile';
  document.getElementById('treasury-screen').hidden = name !== 'treasury';
  document.getElementById('tab-week').classList.toggle('on', name === 'week');
  document.getElementById('tab-profile').classList.toggle('on', name === 'profile');
  document.getElementById('tab-treasury').classList.toggle('on', name === 'treasury');
  // The week arrows only mean something on the Week screen.
  document.querySelector('.nav').hidden = name !== 'week';
  return refresh();
}

async function refresh() {
  const [weekData, today, bounties, level] = await Promise.all([
    window.dungeon.getWeek(currentMonday), window.dungeon.getToday(), window.dungeon.getBounties(),
    window.dungeon.getLevel(),
  ]);
  renderWeek(weekData);
  renderToday(today);
  renderBounties(bounties);
  checkLevelUp(level);
  if (currentScreen === 'profile') {
    const [profile, money] = await Promise.all([window.dungeon.getProfile(), window.dungeon.getMoneySummary()]);
    renderProfile(profile, money);
  }
  if (currentScreen === 'treasury') renderTreasury(await window.dungeon.getTreasury(treasuryIndex));
  await renderGoogleWarning();
}

function showWeek(monday) {
  currentMonday = mondayOf(monday);
  return refresh();
}

function setUpNavigation() {
  document.getElementById('tab-week').addEventListener('click', () => showScreen('week'));
  document.getElementById('tab-profile').addEventListener('click', () => showScreen('profile'));
  document.getElementById('tab-treasury').addEventListener('click', () => showScreen('treasury'));
  document.getElementById('prev-week').addEventListener('click', () => showWeek(addDays(currentMonday, -7)));
  document.getElementById('next-week').addEventListener('click', () => showWeek(addDays(currentMonday, 7)));
  document.getElementById('this-week').addEventListener('click', () => showWeek(localToday()));
  // Placeholders until forms.js takes over.
  for (const id of ['new-quest', 'new-bounty', 'open-breaks', 'open-settings']) {
    document.getElementById(id).addEventListener('click', () => {
      if (typeof window.onActionButton === 'function') window.onActionButton(id);
    });
  }
  window.addEventListener('keydown', (e) => {
    if (document.querySelector('.modal') || currentScreen !== 'week') return;
    if (e.key === 'ArrowLeft') showWeek(addDays(currentMonday, -7));
    if (e.key === 'ArrowRight') showWeek(addDays(currentMonday, 7));
  });
}

async function start() {
  setUpNavigation();
  window.dungeon.onDataChanged(refresh);
  window.dungeon.onPushStatus(renderGoogleWarning);
  // Redraw every minute so "cleared", "next up" and the now-line move on.
  setInterval(refresh, 60 * 1000);
  await refresh();
  if (typeof window.onAppReady === 'function') await window.onAppReady();
}

start();
