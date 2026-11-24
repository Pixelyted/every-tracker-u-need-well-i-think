// The Profile screen: the knight, level, gear, recent XP, habits and stats.
//
// Like app.js, this file only draws what the main process sends
// (window.dungeon.getProfile) and sends clicks back. No rules live here.

// 'Today' or e.g. 'Mon 23 Nov', for the Recent XP list.
function xpWhen(date) {
  return date === localToday() ? 'Today' : formatDayShort(date);
}

function xpBar(level) {
  const bar = el('div', 'xp-bar');
  const fill = el('i');
  fill.style.width = Math.min(100, (level.intoLevel / level.needed) * 100) + '%';
  bar.append(fill);
  return bar;
}

// ---------- left column ----------

function renderHero(profile) {
  const { level, gear } = profile;
  const hero = el('section', 'panel hero');
  const art = el('div', 'hero-art');
  art.append(drawKnight(level.level, { size: 144 }));
  hero.append(art);

  const info = el('div', 'hero-info');
  info.append(
    el('h3', 'profile-h', '🛡 ADVENTURER'),
    el('div', 'hero-level', 'LV ' + level.level),
    xpBar(level),
    el('div', 'muted', `${level.intoLevel} / ${level.needed} XP to LV ${level.level + 1}`),
    el('div', 'muted', `Total ${level.total} XP`),
    el('div', 'muted next-gear', gear.next ? `Next gear: ${gear.next.item} at LV ${gear.next.level}` : 'All gear unlocked'),
  );
  hero.append(info);
  return hero;
}

// One little knight per gear stage. Stages you haven't reached are faded.
function renderGear(profile) {
  const panel = el('section', 'panel');
  panel.append(el('h3', 'profile-h', '🗡 GEAR'));
  const row = el('div', 'gear-row');
  for (const g of GEAR) {
    const owned = profile.gear.owned.includes(g.item);
    const cell = el('div', 'gear-cell' + (owned ? '' : ' locked'));
    cell.title = owned ? g.item : `${g.item} (unlocks at LV ${g.level})`;
    cell.append(drawKnight(g.level, { size: 48 }), el('div', 'muted', g.item), el('div', 'muted', 'LV ' + g.level));
    row.append(cell);
  }
  panel.append(row);
  return panel;
}

function renderRecent(profile) {
  const panel = el('section', 'panel');
  panel.append(el('h3', 'profile-h', '📖 RECENT XP'));
  if (profile.recent.length === 0) {
    panel.append(el('div', 'muted', 'No XP yet. Clear a quest or tick a habit.'));
  }
  for (const r of profile.recent) {
    const row = el('div', 'stat-row');
    row.append(el('span', '', `${xpWhen(r.date)} · ${r.label}`), el('span', 'xp', '+' + r.amount));
    panel.append(row);
  }
  return panel;
}

// ---------- right column ----------

function streakText(habit) {
  const { current, best } = habit.streak;
  if (habit.kind === 'daily') return `🔥 ${current} day${current === 1 ? '' : 's'} · best ${best}`;
  return `${habit.week.count} / ${habit.week.target} this week · 🏆 ${current} · best ${best}`;
}

function renderHabit(habit) {
  const box = el('div', 'habit');
  const head = el('div', 'stat-row');
  const name = el('button', 'habit-name', habit.name);
  name.title = 'Edit or delete this quest';
  name.addEventListener('click', () => openHabitMenu(habit));
  head.append(name, el('span', '', streakText(habit)));

  const squares = el('div', 'habit-squares');
  const thisMonday = mondayOf(habit.strip[habit.strip.length - 1].date);
  habit.strip.forEach((day, i) => {
    const sq = el('button', 'sq' + (day.ticked ? ' on' : '') + (i === habit.strip.length - 1 ? ' is-today' : ''));
    sq.title = formatDayShort(day.date) + (day.ticked ? ' · done' : '');
    // Weekly habits count per Monday-to-Sunday week, so mark where this
    // week begins (the squares to its left belong to last week).
    if (habit.kind === 'weekly' && day.date === thisMonday) {
      sq.classList.add('week-start');
      sq.title += ' · this week starts here';
    }
    // Clicking flips the square. The main process sends dungeon:changed
    // afterwards, which redraws the screen.
    sq.addEventListener('click', async () => {
      const result = await window.dungeon.tickHabit(habit.id, day.date, !day.ticked);
      if (!result.ok) openModal({ title: 'Cannot tick that day', content: el('div', 'dialog-text', (result.errors || []).join('\n')), buttons: [{ label: 'Close', onClick: (close) => close() }] });
    });
    squares.append(sq);
  });
  box.append(head, squares);
  return box;
}

function renderHabits(profile) {
  const panel = el('section', 'panel');
  for (const [kind, title] of [['daily', '🌅 DAILY QUESTS'], ['weekly', '📅 WEEKLY QUESTS']]) {
    panel.append(el('h3', 'profile-h', title));
    const habits = profile.habits.filter((h) => h.kind === kind);
    if (habits.length === 0) panel.append(el('div', 'muted', 'None yet.'));
    for (const h of habits) panel.append(renderHabit(h));
    const add = el('button', 'btn add-habit', '+ New ' + kind + ' quest');
    add.addEventListener('click', () => openHabitForm(null, kind));
    panel.append(add);
  }
  return panel;
}

// "9 · 131": this week, then this semester.
function pair(week, semester) {
  return `${week} · ${semester === null ? '–' : semester}`;
}

function renderStats(profile) {
  const { week, semester } = profile.stats;
  const panel = el('section', 'panel');
  const title = el('h3', 'profile-h', '📊 STATS ');
  title.append(el('span', 'muted stats-note', 'week · semester'));
  panel.append(title);
  const rows = [
    ['Main quests cleared', pair(week.main, semester && semester.main)],
    ['⚔ Bosses cleared', pair(week.boss, semester && semester.boss)],
    ['📜 Bounties on time', pair(`${week.bountiesOnTime}/${week.bountiesDue}`, semester && `${semester.bountiesOnTime}/${semester.bountiesDue}`)],
    ['📅 Weekly quests won', pair(`${week.weeksWon}/${week.weeksJudged}`, semester && `${semester.weeksWon}/${semester.weeksJudged}`)],
  ];
  for (const [label, value] of rows) {
    const row = el('div', 'stat-row');
    row.append(el('span', '', label), el('b', '', value));
    panel.append(row);
  }
  return panel;
}

// `money` is getMoneySummary() (newest cycle) or null when nothing is imported yet.
function renderMoney(money) {
  const panel = el('section', 'panel');
  panel.append(el('h3', 'profile-h', '💰 MONEY'));
  if (!money) {
    panel.append(el('div', 'soon', 'Import a statement in 💰 Treasury'));
    return panel;
  }
  const rows = [
    // Before the first allowance there's no pot to count down from.
    ['Allowance left', money.left === null ? 'no allowance yet' : `${formatRp(money.left)} of ${formatRp(money.pot)}`],
    ['Spent', formatRp(money.spent)],
    ['Money in', formatRp(money.moneyIn)],
    // No balance until the user has set the anchor once in Treasury.
    // formatDayMonth lives in treasury.js (all UI scripts share one global scope).
    ['Balance', money.balance === null ? 'set it in Treasury' : formatRp(money.balance) + ' as of ' + formatDayMonth(money.asOf)],
  ];
  for (const [label, value] of rows) {
    const row = el('div', 'stat-row');
    row.append(el('span', '', label), el('b', '', value));
    panel.append(row);
  }
  const go = el('button', '', '→ Treasury');
  go.addEventListener('click', () => showScreen('treasury'));
  panel.append(go);
  return panel;
}

// Draws the whole screen from a getProfile() result plus the money summary.
function renderProfile(profile, money) {
  const screen = document.getElementById('profile-screen');
  const left = el('div', 'profile-col');
  left.append(renderHero(profile), renderGear(profile), renderRecent(profile));
  const right = el('div', 'profile-col');
  right.append(renderHabits(profile), renderStats(profile), renderMoney(money));
  screen.replaceChildren(left, right);
}

// ---------- habit form and menu ----------

// `habit` is an existing one (from the profile) or null for a new one.
// `startKind` only pre-selects Daily/Weekly for a new one.
function openHabitForm(habit, startKind = 'daily') {
  const form = el('div', 'form');
  const name = textInput(habit ? habit.name : '', 'e.g. Read literature');
  const kind = radioGroup('habit-kind', [['daily', 'Daily'], ['weekly', 'Weekly']], startKind);
  const target = el('input');
  target.type = 'number';
  target.min = 1;
  target.max = 7;
  target.value = habit && habit.week ? habit.week.target : 3;
  const targetField = field('Days per week', target, 'Win the week by ticking this many days (1 to 7)');
  const errors = el('div', 'errors');

  form.append(field('Name', name));
  if (habit) {
    // The main process refuses a kind change, so an existing habit just shows its kind.
    form.append(el('div', 'field-hint', habit.kind === 'daily' ? 'Daily quest' : 'Weekly quest'));
  } else {
    form.append(field('Kind', kind));
  }
  form.append(targetField, errors);

  const currentKind = () => (habit ? habit.kind : kind.value());
  function showTarget() {
    targetField.hidden = currentKind() !== 'weekly';
  }
  kind.addEventListener('change', showTarget);
  showTarget();

  async function save(close) {
    const data = { name: name.value.trim(), kind: currentKind() };
    if (data.kind === 'weekly') data.target = Number(target.value);
    if (habit) data.id = habit.id;
    const result = await window.dungeon.saveHabit(data);
    if (!result.ok) return showErrors(errors, result.errors);
    close();
  }

  openModal({
    title: habit ? '✎ EDIT QUEST' : (startKind === 'weekly' ? '📅 NEW WEEKLY QUEST' : '🌅 NEW DAILY QUEST'),
    content: form,
    buttons: [
      { label: 'Cancel', onClick: (close) => close() },
      { label: habit ? 'Save changes' : 'Add quest', kind: 'btn-big', onClick: save },
    ],
  });
}

// Clicking a habit's name.
function openHabitMenu(habit) {
  openModal({
    title: (habit.kind === 'daily' ? '🌅 ' : '📅 ') + habit.name,
    content: el('div', 'dialog-text', streakText(habit)),
    buttons: [
      { label: '✎ Edit', onClick: (close) => { close(); openHabitForm(habit); } },
      {
        label: '🗑 Delete',
        kind: 'btn-danger',
        onClick: async (close) => {
          close();
          const sure = await askDialog({
            title: `Delete "${habit.name}"?`,
            lines: ['Its XP stays earned.'],
            cancelLabel: 'Keep it',
            okLabel: 'Delete',
            okKind: 'btn-danger',
          });
          if (sure) await window.dungeon.deleteHabit(habit.id);
        },
      },
      { label: 'Close', onClick: (close) => close() },
    ],
  });
}
