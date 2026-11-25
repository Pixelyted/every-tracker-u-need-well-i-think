// Works out what the "⚔ every tracker u need, well i think" Google calendar SHOULD contain.
//
// Each item is { localKey, body }: `localKey` names the thing in the app
// ('quest:<id>' or 'makeup:<changeId>'), `body` is exactly what we send to
// the Google Calendar API. src/google/push.js compares this list with what
// was pushed last time and only sends the differences.

const crypto = require('node:crypto');
const { expandDay, occurrenceDates } = require('../schedule');
const { toMinutes, fromMinutes, formatTime, addDays } = require('../time');

const TIMEZONE = 'Asia/Jakarta';
const CALENDAR_NAME = '⚔ every tracker u need, well i think';

// From 20:00 the evening before up to midnight is 4 hours (240 minutes);
// add the start time to get "minutes before the event".
const EVENING_BEFORE_OFFSET = 240;

// '2026-11-30' -> '20261130'
function compactDate(date) {
  return date.replace(/-/g, '');
}

// '07:00' -> '070000'
function compactTime(time) {
  return time.replace(':', '') + '00';
}

function googleTime(date, time) {
  return { dateTime: `${date}T${time}:00`, timeZone: TIMEZONE };
}

function remindersFor(quest, settings) {
  const overrides = [{ method: 'popup', minutes: settings.leadMinutes }];
  const isBoss = quest.kind === 'main' && quest.repeat === 'once';
  if (isBoss || quest.kind === 'limited') {
    overrides.push({ method: 'popup', minutes: EVENING_BEFORE_OFFSET + toMinutes(quest.start) });
  }
  return { useDefault: false, overrides };
}

// A small cache so each date is only worked out once per push.
function makeDayCache(world) {
  const cache = {};
  return (date) => {
    if (!cache[date]) cache[date] = expandDay(world, date);
    return cache[date];
  };
}

// Finds what a list of occurrences clashes with, across all their days.
// Returns lines like 'Potion Brewing 101 (07.00–09.30)'.
function clashLines(occurrences, dayOf) {
  const lines = [];
  const seen = new Set();
  for (const occ of occurrences) {
    for (const other of dayOf(occ.date)) {
      if (occ.clashKeys.includes(other.key) && !seen.has(other.key)) {
        seen.add(other.key);
        lines.push(`${other.name} (${formatTime(other.start)}–${formatTime(other.end)})`);
      }
    }
  }
  return lines;
}

// Single (non-recurring) events get a ⚠ in the title and a description
// listing their clashes, followed by the quest's own note.
function singleEventBody({ summary, note, start, end, reminders, clashes }) {
  const hasClash = clashes.length > 0;
  const parts = [];
  if (hasClash) parts.push(`⚠ Clashes with: ${clashes.join(', ')}`);
  if (note) parts.push(note);
  return {
    summary: (hasClash ? '⚠ ' : '') + summary,
    description: parts.join('\n\n'),
    start,
    end,
    reminders,
  };
}

// One recurring event per weekly quest. Dates where the quest isn't
// happening are listed as EXDATEs. The series is never marked ⚠, so a
// one-day clash doesn't make the whole semester look clashed.
function weeklyEvent(world, quest, settings, dayOf) {
  const dates = occurrenceDates(world, quest);
  if (dates.length === 0) return null;
  const excluded = dates.filter((date) => {
    const occ = dayOf(date).find((o) => o.key === `q${quest.id}@${date}`);
    return !occ || occ.status !== 'active';
  });
  // UNTIL is in UTC: 23:59:59 in Jakarta (UTC+7) is 16:59:59 UTC.
  const recurrence = [`RRULE:FREQ=WEEKLY;UNTIL=${compactDate(world.semester.endDate)}T165959Z`];
  if (excluded.length > 0) {
    const stamps = excluded.map((d) => compactDate(d) + 'T' + compactTime(quest.start));
    recurrence.push(`EXDATE;TZID=${TIMEZONE}:${stamps.join(',')}`);
  }
  // DTSTART must be the first real occurrence, otherwise Google would add
  // an extra event on the semester's start day.
  return {
    localKey: 'quest:' + quest.id,
    body: {
      summary: quest.name,
      description: quest.note || '',
      start: googleTime(dates[0], quest.start),
      end: googleTime(dates[0], quest.end),
      recurrence,
      reminders: remindersFor(quest, settings),
    },
  };
}

// Start and end for a quest's slot. event-time.js needs TIMEZONE from this
// file, so it is loaded on first use instead of at the top.
function slotTimes(slot) {
  return require('./event-time').slotToEventTimes(slot);
}

function onceEvent(quest, settings, dayOf) {
  const occ = dayOf(quest.date).find((o) => o.key === `q${quest.id}@${quest.date}`);
  // Cancelled by a limited event: no phone reminder for something that
  // isn't happening. The app still shows it.
  if (!occ || occ.status !== 'active') return null;
  return {
    localKey: 'quest:' + quest.id,
    body: singleEventBody({
      summary: quest.name,
      note: quest.note,
      // A multi-day once quest ends on its endDate.
      ...slotTimes({ date: quest.date, start: quest.start, endDate: quest.endDate || null, end: quest.end, allDay: false }),
      reminders: remindersFor(quest, settings),
      clashes: clashLines([occ], dayOf),
    }),
  };
}

function limitedEvent(world, quest, settings, dayOf) {
  const occurrences = occurrenceDates(world, quest)
    .map((date) => dayOf(date).find((o) => o.key === `q${quest.id}@${date}`))
    .filter(Boolean);
  return {
    localKey: 'quest:' + quest.id,
    body: singleEventBody({
      summary: quest.name,
      note: quest.note,
      start: googleTime(quest.startDate, quest.start),
      end: googleTime(quest.endDate, quest.end),
      reminders: remindersFor(quest, settings),
      clashes: clashLines(occurrences, dayOf),
    }),
  };
}

function makeupEvent(world, change, settings, dayOf) {
  const quest = world.quests.find((q) => q.id === change.questId);
  const occ = dayOf(change.newDate).find((o) => o.key === 'makeup:' + change.id);
  if (!quest || !occ || occ.status !== 'active') return null;
  return {
    localKey: 'makeup:' + change.id,
    body: singleEventBody({
      summary: `${quest.name} (make-up)`,
      note: quest.note,
      start: googleTime(change.newDate, change.newStart),
      end: googleTime(change.newDate, change.newEnd),
      reminders: remindersFor(quest, settings),
      clashes: clashLines([occ], dayOf),
    }),
  };
}

// ---------- deadlines (📜 bounties) ----------

// Google needs an event to have some length, so a bounty is a short event
// that ENDS at the due time.
const BOUNTY_EVENT_MINUTES = 15;
// The same reminders as on the laptop (src/notify-plan.js): 2 hours before
// it is due, and 20.00 the evening before.
const BOUNTY_SOON_MINUTES = 120;

// Minutes since midnight of `date`'s previous day, so moments on the day
// before and the day itself can be compared with plain numbers.
function minutesFromDayBefore(dayBefore, date, time) {
  return (date === dayBefore ? 0 : 1440) + toMinutes(time);
}

function deadlineEvent(deadline) {
  if (deadline.done) return null; // ticked: no reminders on the phone
  const dayBefore = addDays(deadline.dueDate, -1);
  const due = 1440 + toMinutes(deadline.dueTime); // counted from dayBefore 00:00
  const start = due - BOUNTY_EVENT_MINUTES;
  const startDate = start < 1440 ? dayBefore : deadline.dueDate;
  const startTime = fromMinutes(start % 1440);
  const eveningBefore = toMinutes('20:00');
  return {
    localKey: 'deadline:' + deadline.id,
    body: {
      summary: `📜 ${deadline.name} (due ${formatTime(deadline.dueTime)})`,
      description: deadline.note || '',
      start: googleTime(startDate, startTime),
      end: googleTime(deadline.dueDate, deadline.dueTime),
      // Google counts reminders from the event's START.
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: BOUNTY_SOON_MINUTES - BOUNTY_EVENT_MINUTES },
          { method: 'popup', minutes: minutesFromDayBefore(dayBefore, startDate, startTime) - eveningBefore },
        ],
      },
    },
  };
}

// `deadlines` is optional, so callers that only care about quests can
// leave it out.
function buildDesiredEvents(world, settings, deadlines = []) {
  const dayOf = makeDayCache(world);
  const desired = [];
  for (const quest of world.quests) {
    // Imported from Google: it lives there already, never copy it into ⚔.
    if (quest.origin === 'google') continue;
    let item = null;
    if (quest.kind === 'limited') item = limitedEvent(world, quest, settings, dayOf);
    else if (quest.repeat === 'once') item = onceEvent(quest, settings, dayOf);
    else if (quest.repeat === 'weekly' && world.semester) item = weeklyEvent(world, quest, settings, dayOf);
    if (item) desired.push(item);
  }
  for (const change of world.changes) {
    if (change.action !== 'move') continue;
    const item = makeupEvent(world, change, settings, dayOf);
    if (item) desired.push(item);
  }
  for (const deadline of deadlines) {
    const item = deadlineEvent(deadline);
    if (item) desired.push(item);
  }
  // The app finds its events again by this key (even if mappings are lost).
  return desired.map((item) => ({
    ...item,
    body: { ...item.body, extendedProperties: { private: { localKey: item.localKey } } },
  }));
}

// What to write back to the main calendar for quests imported from there:
// only title, note and time (no reminders, no ⚠ markers). Locked quests
// and quests that are already over are left alone.
function buildMainBodies(world, today) {
  const bodies = [];
  for (const quest of world.quests) {
    if (quest.origin !== 'google' || quest.googleLocked) continue;
    if ((quest.endDate || quest.date) < today) continue;
    bodies.push({
      localKey: 'quest:' + quest.id,
      body: {
        summary: quest.name,
        description: quest.note || '',
        ...slotTimes({ date: quest.date, start: quest.start, endDate: quest.endDate || null, end: quest.end, allDay: !!quest.allDay }),
      },
    });
  }
  return bodies;
}

// Turns any value into JSON with object keys sorted, so two bodies with the
// same content always give the same text, whatever order keys were added in.
function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

// A short fingerprint of a body. If it hasn't changed since the last push,
// there's nothing to send.
function hashBody(body) {
  return crypto.createHash('sha256').update(stableStringify(body)).digest('hex');
}

module.exports = { TIMEZONE, CALENDAR_NAME, buildDesiredEvents, buildMainBodies, hashBody };
