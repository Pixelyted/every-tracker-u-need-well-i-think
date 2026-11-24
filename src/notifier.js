// Turns the reminder plan (notify-plan.js) into real notifications.
//
// It doesn't know about Electron: main.js passes in `notify` (which shows a
// desktop notification) and `clock` (which returns { date, time }). That
// keeps this file testable with fake timers.
//
// Every replan throws away the pending timers and schedules everything due
// in the next 24 hours again, so edits, deletes and waking from sleep are
// always picked up. Ids of reminders that already fired are remembered, so
// a replan never shows the same reminder twice.

const { planReminders } = require('./notify-plan');
const { toMinutes, daysBetween } = require('./time');

const REPLAN_EVERY_MS = 60 * 1000;
const LOOK_AHEAD_MINUTES = 24 * 60;

// Whole minutes from moment a to moment b (both { date, time }).
function minutesUntil(a, b) {
  return daysBetween(a.date, b.date) * 1440 + toMinutes(b.time) - toMinutes(a.time);
}

function startNotifier({ store, notify, clock }) {
  const fired = new Set();
  let timers = [];

  function clearTimers() {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  }

  function fire(reminder) {
    if (fired.has(reminder.id)) return;
    fired.add(reminder.id);
    notify({ title: reminder.title, body: reminder.body });
  }

  function replan() {
    clearTimers();
    const settings = store.getSettings();
    if (!settings.desktopNotifications) return;
    const now = clock();
    for (const reminder of planReminders(store.getWorld(), now, settings, { deadlines: store.listDeadlines() })) {
      if (fired.has(reminder.id)) continue;
      const minutes = minutesUntil(now, reminder.fireAt);
      if (minutes > LOOK_AHEAD_MINUTES) continue;
      // Due now (or overdue but still useful): setTimeout with 0 fires it
      // right away.
      timers.push(setTimeout(() => fire(reminder), Math.max(0, minutes) * 60 * 1000));
    }
  }

  // Replan every minute as well, so a slow or sleeping clock catches up.
  const interval = setInterval(replan, REPLAN_EVERY_MS);
  replan();

  function stop() {
    clearTimers();
    clearInterval(interval);
  }

  return { replan, stop };
}

module.exports = { startNotifier };
