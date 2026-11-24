// Works out WHICH reminders should fire and WHEN. It doesn't show anything:
// src/notifier.js takes this list and turns it into desktop notifications.
//
// Only active occurrences get reminders, so nothing fires for a class that
// is skipped, moved away, on a break or cancelled by a limited event.

const { expandRange, expandDay, occurrenceDates } = require('./schedule');
const { toMinutes, fromMinutes, formatTime, addDays, daysBetween, compareSlot } = require('./time');

const EVENING_TIME = '20:00';

// Minutes from moment a to moment b (both { date, time }).
function minutesBetween(a, b) {
  return daysBetween(a.date, b.date) * 1440 + toMinutes(b.time) - toMinutes(a.time);
}

// A moment `minutes` before (date, time). Can land on the previous day.
function minutesBefore(date, time, minutes) {
  let total = toMinutes(time) - minutes;
  let day = date;
  while (total < 0) {
    total += 1440;
    day = addDays(day, -1);
  }
  return { date: day, time: fromMinutes(total) };
}

function isBefore(a, b) {
  return compareSlot(a.date, a.time, b.date, b.time) < 0;
}

function clashNames(occ, day) {
  return day.filter((o) => occ.clashKeys.includes(o.key)).map((o) => o.name);
}

// "starts in N min" reminder.
function leadReminder(occ, day, now, leadMinutes) {
  const start = { date: occ.date, time: occ.start };
  if (!isBefore(now, start)) return null; // already started: never remind
  let fireAt = minutesBefore(occ.date, occ.start, leadMinutes);
  // Opened late (or woke from sleep) inside the window: fire right away.
  if (isBefore(fireAt, now)) fireAt = { ...now };
  const minutesLeft = minutesBetween(fireAt, start);
  const names = clashNames(occ, day);
  return {
    id: occ.key + ':lead',
    fireAt,
    title: `⚔ ${occ.name} starts in ${minutesLeft} min (${formatTime(occ.start)})`,
    body: names.length > 0 ? `⚠ clashes with ${names.join(', ')}` : '',
  };
}

// How many quests a limited event cancels across all of its days.
function countCancelled(world, questId) {
  const quest = world.quests.find((q) => q.id === questId);
  let count = 0;
  for (const date of occurrenceDates(world, quest)) {
    count += expandDay(world, date).filter((o) => o.status === 'cancelled').length;
  }
  return count;
}

// 20:00-the-evening-before reminder, for bosses and limited events.
function eveningReminder(world, occ, now) {
  if (!isBefore(now, { date: occ.date, time: occ.start })) return null;
  let fireAt = { date: addDays(occ.date, -1), time: EVENING_TIME };
  if (isBefore(fireAt, now)) {
    // Still that evening? Then fire now; otherwise it's too late to matter.
    if (now.date !== fireAt.date) return null;
    fireAt = { ...now };
  }
  const isEvent = occ.kind === 'limited';
  let body = formatTime(occ.start);
  if (isEvent) body += ` · cancels ${countCancelled(world, occ.questId)} quests`;
  return {
    id: occ.key + ':eve',
    fireAt,
    title: isEvent ? `⭐ Event tomorrow: ${occ.name}` : `⚔ BOSS tomorrow: ${occ.name}`,
    body,
  };
}

function byFireAt(a, b) {
  return compareSlot(a.fireAt.date, a.fireAt.time, b.fireAt.date, b.fireAt.time) || a.id.localeCompare(b.id);
}

// ---------- deadlines (📜 bounties) ----------

const BOUNTY_SOON_MINUTES = 120;

// '2 h' for whole hours, otherwise '45 min'.
function formatMinutesLeft(minutes) {
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
}

// A bounty reminds twice: at 20.00 the evening before, and 2 hours before
// it is due. Ticked or already-due bounties never remind.
function bountyReminders(deadline, now) {
  const due = { date: deadline.dueDate, time: deadline.dueTime };
  if (deadline.done || !isBefore(now, due)) return [];
  const result = [];

  let eveAt = { date: addDays(deadline.dueDate, -1), time: EVENING_TIME };
  if (isBefore(eveAt, now) && now.date === eveAt.date) eveAt = { ...now }; // still that evening
  if (!isBefore(eveAt, now)) {
    result.push({
      id: `deadline:${deadline.id}:eve`,
      fireAt: eveAt,
      title: `📜 Bounty due tomorrow: ${deadline.name}`,
      body: 'due ' + formatTime(deadline.dueTime),
    });
  }

  let soonAt = minutesBefore(deadline.dueDate, deadline.dueTime, BOUNTY_SOON_MINUTES);
  if (isBefore(soonAt, now)) soonAt = { ...now }; // opened late: remind right away
  result.push({
    id: `deadline:${deadline.id}:soon`,
    fireAt: soonAt,
    title: `📜 ${deadline.name} due in ${formatMinutesLeft(minutesBetween(soonAt, due))} (${formatTime(deadline.dueTime)})`,
    body: '',
  });
  return result;
}

// `deadlines` is optional, so callers that only care about quests can
// leave it out.
function planReminders(world, now, settings, { horizonDays = 2, deadlines = [] } = {}) {
  const lastDate = addDays(now.date, horizonDays);
  const days = expandRange(world, now.date, lastDate);
  const reminders = [];
  for (const day of Object.values(days)) {
    for (const occ of day) {
      if (occ.status !== 'active') continue;
      // A limited event spanning days is reminded about once, on day one.
      if (occ.kind === 'limited' && !occ.isFirstDay) continue;
      const lead = leadReminder(occ, day, now, settings.leadMinutes);
      if (lead) reminders.push(lead);
      if (occ.isBoss || occ.kind === 'limited') {
        const eve = eveningReminder(world, occ, now);
        if (eve) reminders.push(eve);
      }
    }
  }
  for (const deadline of deadlines) {
    for (const r of bountyReminders(deadline, now)) {
      if (r.fireAt.date <= lastDate) reminders.push(r);
    }
  }
  return reminders.sort(byFireAt);
}

module.exports = { planReminders };
