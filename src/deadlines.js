// Deadlines ("📜 Bounties"): due dates you must not forget.
//
// A deadline is a moment (due date + due time), not a block of time, so it
// is kept apart from quests: it never clashes with them and never cancels
// anything. Like schedule.js, nothing here touches the database, Electron
// or the clock, so the future AI input can call it too.
//
// A deadline looks like { id, name, dueDate, dueTime, note, done }.

const { daysBetween, compareSlot } = require('./time');

// How far ahead the 📜 BOUNTIES panel looks.
const PANEL_DAYS = 14;

// 'done' when ticked, 'overdue' once the due minute has come, else 'open'.
function deadlineStatus(deadline, now) {
  if (deadline.done) return 'done';
  return compareSlot(now.date, now.time, deadline.dueDate, deadline.dueTime) >= 0 ? 'overdue' : 'open';
}

function byDue(a, b) {
  return compareSlot(a.dueDate, a.dueTime, b.dueDate, b.dueTime) || a.name.localeCompare(b.name);
}

// The same deadline plus `status` and `daysLeft` (negative when late),
// so the window doesn't have to work them out.
function withStatus(deadline, now) {
  return { ...deadline, status: deadlineStatus(deadline, now), daysLeft: daysBetween(now.date, deadline.dueDate) };
}

// What the 📜 BOUNTIES panel lists: every overdue deadline (so a late one
// can't hide), then the ones due in the next `days` days. Ticked ones are
// left out. Sorted by due moment, so overdue ones come first.
function bountyList(deadlines, now, { days = PANEL_DAYS } = {}) {
  return deadlines
    .filter((d) => !d.done && daysBetween(now.date, d.dueDate) <= days)
    .sort(byDue)
    .map((d) => withStatus(d, now));
}

// { date: deadline[] } for the dates from startDate to endDate that have
// any, ticked ones included (the week view shows them struck through).
function deadlinesByDate(deadlines, startDate, endDate, now) {
  const days = {};
  for (const d of [...deadlines].sort(byDue)) {
    if (d.dueDate < startDate || d.dueDate > endDate) continue;
    if (!days[d.dueDate]) days[d.dueDate] = [];
    days[d.dueDate].push(withStatus(d, now));
  }
  return days;
}

module.exports = { deadlineStatus, bountyList, deadlinesByDate, PANEL_DAYS };
