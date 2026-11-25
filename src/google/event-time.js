// Converts between Google event times and the app's quest slot fields
// (date, start, endDate, end, allDay), plus helpers that undo the
// decorations payloads.js adds when pushing (⚠ and 📜 titles, clash notes).
// Everything app-side is in Jakarta time.

const { TIMEZONE } = require('./payloads');
const { addDays } = require('../time');

// Formats any moment as Jakarta time: '2026-11-30 20:00:00'.
const jakartaFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

// Any moment from Google ('2026-11-30T00:00:00Z', or with +07:00) as a
// Jakarta-time stamp like '20261130T070000'.
function jakartaStamp(dateTime) {
  const { date, time } = jakartaParts(dateTime);
  return `${date}T${time}:00`.replace(/[-:]/g, '');
}

// The Jakarta date and time of a moment: { date: '2026-11-30', time: '20:00' }.
function jakartaParts(dateTime) {
  // No 'Z' or +hh:mm offset: it is already Jakarta wall time (what we write
  // ourselves). Read it literally; Date would use the computer's own zone.
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(dateTime)) {
    return { date: dateTime.slice(0, 10), time: dateTime.slice(11, 16) };
  }
  const [date, time] = jakartaFormat.format(new Date(dateTime)).split(' ');
  return { date, time: time.slice(0, 5) };
}

// Today's date in Jakarta, however the computer's own clock is set.
function jakartaToday(now) {
  return jakartaParts(now.toISOString()).date;
}

// A Google event -> the slot fields of a quest.
// endDate is null when the event starts and ends on the same Jakarta day.
function eventToSlot(ev) {
  if (ev.start.date) {
    // All-day: Google's end date is exclusive, so the last day is one earlier.
    const lastDay = addDays(ev.end.date, -1);
    return {
      date: ev.start.date,
      start: '00:00',
      endDate: lastDay === ev.start.date ? null : lastDay,
      end: '23:59',
      allDay: true,
    };
  }
  const from = jakartaParts(ev.start.dateTime);
  const to = jakartaParts(ev.end.dateTime);
  return {
    date: from.date,
    start: from.time,
    endDate: to.date === from.date ? null : to.date,
    end: to.time,
    allDay: false,
  };
}

// A quest slot -> Google's start and end objects.
function slotToEventTimes(slot) {
  const lastDay = slot.endDate || slot.date;
  if (slot.allDay) {
    return { start: { date: slot.date }, end: { date: addDays(lastDay, 1) } };
  }
  return {
    start: { dateTime: `${slot.date}T${slot.start}:00`, timeZone: TIMEZONE },
    end: { dateTime: `${lastDay}T${slot.end}:00`, timeZone: TIMEZONE },
  };
}

// Removes the '⚠ ' the app adds to clashing events.
function cleanTitle(summary) {
  return (summary || '').replace(/^⚠ /, '');
}

// Same, and also the '📜 ' and ' (due 23.59)' decorations of bounties.
function cleanBountyTitle(summary) {
  return cleanTitle(summary).replace(/^📜 /, '').replace(/ \(due \d{2}\.\d{2}\)$/, '');
}

// Removes the '⚠ Clashes with: ...' paragraph (and the blank line after it),
// leaving only the quest's own note. Nothing left -> null.
function cleanNote(description) {
  const note = (description || '').replace(/^⚠ Clashes with: [^\n]*(\n\n|$)/, '');
  return note === '' ? null : note;
}

module.exports = {
  jakartaStamp, jakartaParts, jakartaToday, eventToSlot, slotToEventTimes,
  cleanTitle, cleanBountyTitle, cleanNote,
};
