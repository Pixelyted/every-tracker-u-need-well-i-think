// Date and time helpers.
//
// Inside the app a date is always a 'YYYY-MM-DD' string and a time is always
// a zero-padded 24-hour 'HH:MM' string. Strings are easy to compare, store in
// SQLite and print, and they never carry a hidden time zone.
//
// When we need real date math we build a Date with Date.UTC(...) and read it
// back with getUTC*(). Working in UTC means the laptop's time zone setting can
// never shift a date by one day by accident.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Put a leading zero on numbers below 10: 7 -> '07'.
function pad2(n) {
  return String(n).padStart(2, '0');
}

// Accepts what a person might type: '7.00', '07.00', '7:00', '07:00'.
// Returns the clean 'HH:MM' form, or null if it isn't a real time of day.
function parseTime(str) {
  const match = /^\s*(\d{1,2})[.:](\d{2})\s*$/.exec(String(str || ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return pad2(hours) + ':' + pad2(minutes);
}

// 'HH:MM' -> minutes since midnight. '24:00' gives 1440 (end of the day),
// which we use when a multi-day event runs until midnight.
function toMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Minutes since midnight -> 'HH:MM'.
function fromMinutes(total) {
  return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
}

// How times are shown to the user: '07:00' -> '07.00'.
function formatTime(time) {
  return time.replace(':', '.');
}

// 'YYYY-MM-DD' -> milliseconds at UTC midnight of that day.
function dateToMs(date) {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

// Milliseconds -> 'YYYY-MM-DD', read in UTC.
function msToDate(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

function addDays(date, n) {
  return msToDate(dateToMs(date) + n * MS_PER_DAY);
}

// How many days from a to b (positive when b is later).
function daysBetween(a, b) {
  return Math.round((dateToMs(b) - dateToMs(a)) / MS_PER_DAY);
}

// 1 = Monday ... 7 = Sunday. JavaScript's getUTCDay() uses 0 = Sunday,
// so Sunday is turned into 7.
function weekdayOf(date) {
  const day = new Date(dateToMs(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

// The Monday of the week that contains this date.
function mondayOf(date) {
  return addDays(date, 1 - weekdayOf(date));
}

// ISO week number: weeks start on Monday, and week 1 is the week that
// contains the year's first Thursday. So we look at this week's Thursday
// and count which week of *its* year it is.
function isoWeek(date) {
  const thursday = addDays(date, 4 - weekdayOf(date));
  const yearStart = thursday.slice(0, 4) + '-01-01';
  return Math.floor(daysBetween(yearStart, thursday) / 7) + 1;
}

// Every date from start to end, both included. Empty if end is before start.
function datesInRange(start, end) {
  const dates = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    dates.push(d);
  }
  return dates;
}

// The first date on or after `date` that falls on `weekday` (1..7).
function firstOnOrAfter(date, weekday) {
  const ahead = (weekday - weekdayOf(date) + 7) % 7;
  return addDays(date, ahead);
}

// Compare two moments given as (date, time). Returns -1, 0 or 1.
// Plain string comparison works because both formats are zero-padded.
function compareSlot(aDate, aTime, bDate, bTime) {
  const a = aDate + ' ' + aTime;
  const b = bDate + ' ' + bTime;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// Turns a JavaScript Date (read in the LAPTOP's local time zone, which is
// Asia/Jakarta) into the { date, time } shape the pure modules expect.
// Only main.js calls this, with `new Date()`.
function nowFromDate(d) {
  return {
    date: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()),
    time: pad2(d.getHours()) + ':' + pad2(d.getMinutes()),
  };
}

module.exports = {
  pad2,
  nowFromDate,
  parseTime,
  toMinutes,
  fromMinutes,
  formatTime,
  addDays,
  daysBetween,
  weekdayOf,
  mondayOf,
  isoWeek,
  datesInRange,
  firstOnOrAfter,
  compareSlot,
};
