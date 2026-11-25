// Form validation.
//
// Every function here returns a list of error messages in plain English.
// An empty list means "all good". The forms show these messages next to
// the fields, and nothing is saved while the list is not empty.

const { parseTime, toMinutes, compareSlot } = require('./time');

const MIDNIGHT_ERROR = "End time must be after start time (quests can't run past midnight)";

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// A time is valid when parseTime understands it. ('24:00' is not accepted
// from forms; it only exists internally for "until midnight".)
function isTime(value) {
  return typeof value === 'string' && parseTime(value) === value;
}

function isBlank(text) {
  return !text || String(text).trim() === '';
}

// Checks a start/end pair on one day. Main and side quests can't cross
// midnight in v1, so end must be strictly after start.
function checkSameDayTimes(start, end) {
  if (!isTime(start)) return ['Start time is not a valid time (try 07.00)'];
  if (!isTime(end)) return ['End time is not a valid time (try 09.30)'];
  if (toMinutes(end) <= toMinutes(start)) return [MIDNIGHT_ERROR];
  return [];
}

function validateWeekly(quest, world) {
  const errors = [];
  if (!Number.isInteger(quest.weekday) || quest.weekday < 1 || quest.weekday > 7) {
    errors.push('Pick a day of the week');
  }
  if (!world || !world.semester || !world.semester.active) {
    errors.push('Set up the semester first: weekly quests only happen inside a semester');
  }
  return errors;
}

function validateOnce(quest) {
  return isDate(quest.date) ? [] : ['Pick a date'];
}

// A one-time quest that ends on a later (or earlier, by mistake) date than it
// starts. It may end earlier in the day than it starts, e.g. 20:00 to 02:00.
function isMultiDayInput(quest) {
  return quest.repeat === 'once' && Boolean(quest.endDate) && quest.endDate !== quest.date;
}

function checkMultiDayTimes(quest) {
  if (!isDate(quest.date) || !isDate(quest.endDate)) return ['Pick a start date and an end date'];
  if (!isTime(quest.start)) return ['Start time is not a valid time (try 07.00)'];
  if (!isTime(quest.end)) return ['End time is not a valid time (try 09.30)'];
  if (compareSlot(quest.date, quest.start, quest.endDate, quest.end) >= 0) {
    return ['The quest must end after it starts'];
  }
  return [];
}

function validateLimited(quest) {
  if (!isDate(quest.startDate) || !isDate(quest.endDate)) return ['Pick a start date and an end date'];
  if (!isTime(quest.start) || !isTime(quest.end)) return ['Start and end need valid times (try 09.00)'];
  if (compareSlot(quest.startDate, quest.start, quest.endDate, quest.end) >= 0) {
    return ['The event must end after it starts'];
  }
  return [];
}

function validateQuest(quest, world) {
  const errors = [];
  if (isBlank(quest.name)) errors.push('Give the quest a name');

  // Quests imported from Google are one-time only; the sync can't repeat them.
  if (quest.origin === 'google' && (quest.repeat === 'weekly' || quest.kind === 'limited')) {
    errors.push('A quest from Google stays a one-time quest');
  }

  if (quest.kind === 'limited') {
    return errors.concat(validateLimited(quest));
  }
  if (quest.kind !== 'main' && quest.kind !== 'side') {
    return errors.concat(['Pick a quest type']);
  }

  errors.push(...(isMultiDayInput(quest) ? checkMultiDayTimes(quest) : checkSameDayTimes(quest.start, quest.end)));
  if (quest.repeat === 'weekly') errors.push(...validateWeekly(quest, world));
  else if (quest.repeat === 'once') errors.push(...validateOnce(quest));
  else errors.push('Pick "Every week" or "Once"');
  return errors;
}

// A moved occurrence: new date plus start/end on that date.
function validateMove(slot) {
  const errors = [];
  if (!isDate(slot.date)) errors.push('Pick the new date');
  errors.push(...checkSameDayTimes(slot.start, slot.end));
  return errors;
}

function checkDateRange(item) {
  if (!isDate(item.startDate) || !isDate(item.endDate)) return ['Pick a start date and an end date'];
  if (item.endDate < item.startDate) return ['The end date must not be before the start date'];
  return [];
}

function validateBreak(brk, semester) {
  const errors = [];
  if (isBlank(brk.name)) errors.push('Give the break a name');
  const rangeErrors = checkDateRange(brk);
  errors.push(...rangeErrors);
  if (rangeErrors.length === 0) {
    if (!semester) errors.push('Set up the semester first');
    else if (brk.startDate < semester.startDate || brk.endDate > semester.endDate) {
      errors.push('A break must be inside the semester');
    }
  }
  return errors;
}

function validateSemester(sem) {
  const errors = [];
  if (isBlank(sem.name)) errors.push('Give the semester a name');
  errors.push(...checkDateRange(sem));
  return errors;
}

function validateDeadline(d) {
  const errors = [];
  if (isBlank(d.name)) errors.push('Give the bounty a name');
  if (!isDate(d.dueDate)) errors.push('Pick the due date');
  if (!isTime(d.dueTime)) errors.push('The due time is not a valid time (try 23.59)');
  return errors;
}

function validateHabit(h) {
  const errors = [];
  if (isBlank(h.name)) errors.push('Give the quest a name');
  if (h.kind !== 'daily' && h.kind !== 'weekly') errors.push('Pick Daily or Weekly');
  else if (h.kind === 'weekly' && !(Number.isInteger(h.target) && h.target >= 1 && h.target <= 7)) {
    errors.push('Pick a target from 1 to 7 days');
  }
  return errors;
}

module.exports = {
  validateHabit,
  MIDNIGHT_ERROR,
  validateDeadline,
  validateQuest,
  validateMove,
  validateBreak,
  validateSemester,
};
