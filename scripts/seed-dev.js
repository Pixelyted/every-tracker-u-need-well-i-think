// Dev-only: fills a SEPARATE database (dev.sqlite) with a sample timetable
// and a few examples of every case, so the screens can be checked by eye.
// Not used by the app itself. Run:
//   node scripts/seed-dev.js            (writes ~/.config/dungeon-planner/dev.sqlite)
//   DUNGEON_DEV=1 npm start             (opens the app on dev.sqlite)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../src/db');
const { nowFromDate, addDays } = require('../src/time');
const { ensureXpStart, applyHabitTick } = require('../src/xp-log');

const file = process.argv[2] || path.join(os.homedir(), '.config', 'dungeon-planner', 'dev.sqlite');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.rmSync(file, { force: true });
const store = openStore(file);

store.saveSemester({ name: 'Autumn 2026', startDate: '2026-08-24', endDate: '2026-12-18' });

const classes = [
  ['Potion Brewing 101', 1, '07:00', '09:30', '#3f7fbf', '📐'],
  ['Rune Geometry', 1, '09:40', '12:00', '#3fa37a', '🧮'],
  ['Spellcraft Basics', 2, '07:00', '10:00', '#b8673a', '💻'],
  ['Potion Lab Assistant', 3, '08:00', '10:00', '#5a6fc4', '📏'],
  ['Golem Mechanics', 3, '15:30', '17:30', '#2f9aa8', '🔌'],
  ['Archive Keeping', 4, '09:40', '12:00', '#8a5cc0', '🗄'],
  ['Spellcraft Lab Assistant', 5, '15:30', '17:30', '#b0573f', '⌨'],
];
const ids = {};
for (const [name, weekday, start, end, color, icon] of classes) {
  ids[name] = store.saveQuest({ kind: 'main', repeat: 'weekly', name, weekday, start, end, color, icon });
}

// Forced clash: the seminar overlaps both Monday classes.
store.saveQuest({ kind: 'side', repeat: 'once', name: 'Seminar', date: '2026-11-23', start: '05:00', end: '19:00', note: 'Hall B' });
// A skip and a move in the week of 30 Nov.
store.setChange({ questId: ids['Rune Geometry'], originalDate: '2026-11-30', action: 'skip' });
store.setChange({ questId: ids['Potion Brewing 101'], originalDate: '2026-11-30', action: 'move', newDate: '2026-12-05', newStart: '08:00', newEnd: '10:30' });
// A break (camp) and a boss.
store.saveBreak({ name: 'Midterm week', startDate: '2026-10-12', endDate: '2026-10-16' });
store.saveQuest({ kind: 'main', repeat: 'once', name: 'Potion Brewing 101 Midterm', date: '2026-12-09', start: '13:00', end: '15:00', color: '#c0392b', icon: '📝' });
// A weekly side quest, and the olympiad (limited event) in the week of 23 Nov.
store.saveQuest({ kind: 'side', repeat: 'weekly', name: 'Gym', weekday: 2, start: '16:00', end: '17:00' });
store.saveQuest({ kind: 'limited', name: 'Olympiad', startDate: '2026-11-26', start: '09:00', endDate: '2026-11-28', end: '18:00' });

// Bounties (deadlines): one overdue, one due today, one ticked done, two ahead.
store.saveDeadline({ name: 'Database essay', dueDate: '2026-11-20', dueTime: '12:00' });
store.saveDeadline({ name: 'Lab report 4', dueDate: '2026-11-24', dueTime: '23:59', note: 'upload to the course page' });
store.setDeadlineDone(store.saveDeadline({ name: 'Rune Geometry quiz prep', dueDate: '2026-11-25', dueTime: '08:00' }), true);
store.saveDeadline({ name: 'Potion homework 3', dueDate: '2026-11-27', dueTime: '23:59' });
store.saveDeadline({ name: 'Golem Mechanics project', dueDate: '2026-12-03', dueTime: '17:00' });

// Habits, ticked through the real XP path so the Profile shows XP.
// "Today" is the real date here, because the app checks the real clock.
const today = nowFromDate(new Date()).date;
ensureXpStart(store, addDays(today, -6));
const read = store.saveHabit({ name: 'Read literature', kind: 'daily' }, today);
const fast = store.saveHabit({ name: 'Fast', kind: 'weekly', target: 3 }, today);
for (const back of [5, 4, 3, 2, 1]) applyHabitTick(store, read, addDays(today, -back), true, today);
for (const back of [1, 2]) applyHabitTick(store, fast, addDays(today, -back), true, today);

// Treasury: import the made-up bank statements through the real handlers,
// with a fake PDF reader (the "path" is just a name for the text to return).
const { buildHandlers } = require('../src/ipc');
const { HEADER, row, WEEK_A, WEEK_B } = require('../test/bca-fixture');
// A week before the allowance, so the balance chart shows the jump and
// there is a "before tracking" cycle to look at.
const WEEK_0 = HEADER(1, 1, '02/11/2026 - 08/11/2026')
  + row('05/11/2026', 'TGL: 1105  QR 490                   00000.00TOKO MAKMU', '40,000.00', 'DB', 'TRANSAKSI DEBIT');
const statements = { 'week-0.pdf': WEEK_0, 'week-a.pdf': WEEK_A, 'week-b.pdf': WEEK_B };
const handlers = buildHandlers(store, {
  clock: () => nowFromDate(new Date()),
  readPdfText: async (name) => statements[name],
});

handlers.importStatements(['week-0.pdf', 'week-a.pdf', 'week-b.pdf']).then(() => {
  // A starting balance (in sen) so the balance chart has something to draw.
  store.setSettings({ balanceAnchor: { date: '2026-11-01', amount: 100000000 } });
  store.close();
  console.log('Seeded ' + file);
});
