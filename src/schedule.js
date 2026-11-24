// The schedule engine: works out what happens on a given day.
//
// Nothing here touches the database, Electron or the clock. Every function
// takes a plain `world` object ({ semester, quests, changes, breaks }) and
// returns plain data, which makes it easy to test and to reuse later (for
// example by the future AI input).
//
// Clashes and cancellations are never stored. They are worked out fresh
// every time from the data, so any edit, delete, skip or move updates them
// automatically.

const { toMinutes, addDays, daysBetween, weekdayOf, mondayOf, datesInRange, firstOnOrAfter, compareSlot } = require('./time');

// ---------- small helpers ----------

function isInsideSemester(semester, date) {
  return Boolean(semester) && date >= semester.startDate && date <= semester.endDate;
}

// A skip or move belongs to one weekly occurrence: its quest's weekday on
// `originalDate`. If the quest is edited to another weekday (or stops being
// weekly) the change points at nothing any more. db.js deletes such changes
// when saving, and draft.js uses the same rule so its warnings match.
function changeFitsQuest(change, quest) {
  return quest.repeat === 'weekly' && weekdayOf(change.originalDate) === quest.weekday;
}

// Builds an Occurrence object with every field filled in, so the UI and the
// other modules never have to guess whether a field exists.
function makeOccurrence(quest, date, start, end, extra = {}) {
  return {
    key: 'q' + quest.id + '@' + date,
    questId: quest.id,
    changeId: null,
    kind: quest.kind,
    repeat: quest.repeat,
    name: quest.name,
    color: quest.color,
    icon: quest.icon,
    note: quest.note,
    date,
    start,
    end,
    status: 'active',
    isBoss: quest.kind === 'main' && quest.repeat === 'once',
    isMakeup: false,
    movedTo: null,
    movedFrom: null,
    cancelledBy: null,
    isFirstDay: false,
    clashKeys: [],
    ...extra,
  };
}

// The part of a limited event that falls on `date`, as { start, end }, or
// null when the event doesn't touch that day. Days in the middle of the
// event run from '00:00' to '24:00'. An event ending at exactly 00:00 on a
// day has zero length on that day, so it does not touch it.
function limitedSliceOn(quest, date) {
  if (date < quest.startDate || date > quest.endDate) return null;
  const start = date === quest.startDate ? quest.start : '00:00';
  const end = date === quest.endDate ? quest.end : '24:00';
  if (toMinutes(end) <= toMinutes(start)) return null;
  return { start, end };
}

function overlaps(a, b) {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

function byStartThenName(a, b) {
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return a.name.localeCompare(b.name);
}

// ---------- the steps of spec 7.3 ----------

// Step 1: weekly quests that fall on this date, inside the semester.
function weeklyOccurrences(world, date) {
  if (!isInsideSemester(world.semester, date)) return [];
  return world.quests
    .filter((q) => q.repeat === 'weekly' && q.weekday === weekdayOf(date))
    .map((q) => makeOccurrence(q, date, q.start, q.end));
}

// Step 2a: a skip or move whose original date is today changes the status
// of today's weekly occurrence.
function applyChanges(world, date, occurrences) {
  for (const change of world.changes) {
    if (change.originalDate !== date) continue;
    const occ = occurrences.find((o) => o.questId === change.questId);
    if (!occ) continue;
    if (change.action === 'skip') {
      occ.status = 'skipped';
    } else if (change.action === 'move') {
      occ.status = 'moved';
      occ.movedTo = { date: change.newDate, start: change.newStart, end: change.newEnd };
    }
  }
}

// Step 2b: a move whose new date is today adds a make-up occurrence, but
// only while the class it replaces still exists. If the semester is
// shortened so the original date falls outside it, the make-up is hidden
// too (and comes back if the semester is lengthened again).
function makeupOccurrences(world, date) {
  const result = [];
  for (const change of world.changes) {
    if (change.action !== 'move' || change.newDate !== date) continue;
    const quest = world.quests.find((q) => q.id === change.questId);
    if (!quest || !changeFitsQuest(change, quest)) continue;
    if (!isInsideSemester(world.semester, change.originalDate)) continue;
    result.push(makeOccurrence(quest, date, change.newStart, change.newEnd, {
      key: 'makeup:' + change.id,
      changeId: change.id,
      isMakeup: true,
      movedFrom: change.originalDate,
    }));
  }
  return result;
}

// Step 3: on a break day weekly MAIN quests are off. Make-ups, side quests
// and one-time quests still happen: a break means "no classes", not "no life".
function applyBreaks(world, date, occurrences) {
  const onBreak = world.breaks.some((b) => date >= b.startDate && date <= b.endDate);
  if (!onBreak) return;
  for (const occ of occurrences) {
    if (occ.status === 'active' && occ.kind === 'main' && occ.repeat === 'weekly' && !occ.isMakeup) {
      occ.status = 'break';
    }
  }
}

// Step 4: one-time quests on this date.
function onceOccurrences(world, date) {
  return world.quests
    .filter((q) => q.repeat === 'once' && q.date === date)
    .map((q) => makeOccurrence(q, date, q.start, q.end));
}

// Step 5: limited events touching this date.
function limitedOccurrences(world, date) {
  const result = [];
  for (const quest of world.quests) {
    if (quest.kind !== 'limited') continue;
    const slice = limitedSliceOn(quest, date);
    if (!slice) continue;
    result.push(makeOccurrence(quest, date, slice.start, slice.end, { isFirstDay: date === quest.startDate }));
  }
  return result;
}

// Step 5 (continued): a limited event cancels every other quest on the whole
// day, not just the overlapping hours. Cancelled quests stay in the list so
// the UI can still show them.
function applyCancellations(occurrences, events) {
  if (events.length === 0) return;
  for (const occ of occurrences) {
    if (occ.status === 'active') {
      occ.status = 'cancelled';
      occ.cancelledBy = events[0].name;
    }
  }
}

// Step 6: only active occurrences can clash with each other.
function markClashes(occurrences) {
  const active = occurrences.filter((o) => o.status === 'active');
  for (const a of active) {
    for (const b of active) {
      if (a !== b && overlaps(a, b)) a.clashKeys.push(b.key);
    }
  }
}

// ---------- public functions ----------

// Everything on one date, sorted by start time and then name.
function expandDay(world, date) {
  const regular = weeklyOccurrences(world, date);
  applyChanges(world, date, regular);
  regular.push(...makeupOccurrences(world, date));
  applyBreaks(world, date, regular);
  regular.push(...onceOccurrences(world, date));

  const events = limitedOccurrences(world, date);
  applyCancellations(regular, events);

  const all = regular.concat(events).sort(byStartThenName);
  markClashes(all);
  return all;
}

// { date: Occurrence[] } for every date from startDate to endDate.
function expandRange(world, startDate, endDate) {
  const days = {};
  for (const date of datesInRange(startDate, endDate)) {
    days[date] = expandDay(world, date);
  }
  return days;
}

// Every date a quest ORIGINALLY lands on (before skips, moves and so on).
function occurrenceDates(world, quest) {
  if (quest.kind === 'limited') {
    return datesInRange(quest.startDate, quest.endDate).filter((d) => limitedSliceOn(quest, d));
  }
  if (quest.repeat === 'once') return [quest.date];
  if (!world.semester) return [];
  const dates = [];
  const first = firstOnOrAfter(world.semester.startDate, quest.weekday);
  for (let d = first; d <= world.semester.endDate; d = addDays(d, 7)) {
    dates.push(d);
  }
  return dates;
}

// An active occurrence is "cleared" once its end time has passed.
function isCleared(occ, now) {
  if (occ.status !== 'active') return false;
  return compareSlot(occ.date, occ.end, now.date, now.time) <= 0;
}

// The "floor" is the calendar week number since the semester started
// (break weeks included). Floor 1 is the week containing the start date.
function floorNumber(semester, date) {
  if (!isInsideSemester(semester, date)) return null;
  return daysBetween(mondayOf(semester.startDate), mondayOf(date)) / 7 + 1;
}

module.exports = { expandDay, expandRange, occurrenceDates, isCleared, floorNumber, changeFitsQuest };
