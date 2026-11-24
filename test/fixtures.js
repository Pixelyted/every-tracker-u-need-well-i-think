// a sample student timetable (spec section 1), used by many test files.
// Every quest carries every field (null when unused) so it matches what the
// database hands back.

function quest(fields) {
  return {
    id: null, kind: 'main', repeat: null, name: '', color: null, icon: null, note: null,
    weekday: null, date: null, start: null, end: null, startDate: null, endDate: null, semesterId: null, xp: null,
    ...fields,
  };
}

function weekly(id, name, weekday, start, end) {
  return quest({ id, kind: 'main', repeat: 'weekly', name, weekday, start, end, color: '#4a7ab8', icon: '📘', semesterId: 1 });
}

function makeWorld() {
  return {
    semester: { id: 1, name: 'Autumn 2026', startDate: '2026-08-24', endDate: '2026-12-18', active: 1 },
    quests: [
      weekly(1, 'Potion Brewing 101', 1, '07:00', '09:30'),
      weekly(2, 'Rune Geometry', 1, '09:40', '12:00'),
      weekly(3, 'Spellcraft Basics', 2, '07:00', '10:00'),
      weekly(4, 'Potion Lab Assistant', 3, '08:00', '10:00'),
      weekly(5, 'Golem Mechanics', 3, '15:30', '17:30'),
      weekly(6, 'Archive Keeping', 4, '09:40', '12:00'),
      weekly(7, 'Spellcraft Lab Assistant', 5, '15:30', '17:30'),
    ],
    changes: [],
    breaks: [],
  };
}

const seminar = quest({ id: 10, kind: 'side', repeat: 'once', name: 'Seminar', date: '2026-11-23', start: '05:00', end: '19:00' });
const olympiad = quest({ id: 20, kind: 'limited', name: 'Olympiad', startDate: '2026-11-26', start: '09:00', endDate: '2026-11-28', end: '18:00' });
const midterm = quest({ id: 30, kind: 'main', repeat: 'once', name: 'Potion Brewing 101 Midterm', date: '2026-12-09', start: '13:00', end: '15:00' });
const moveCalc = { id: 2, questId: 1, originalDate: '2026-11-30', action: 'move', newDate: '2026-12-05', newStart: '08:00', newEnd: '10:30' };
const skipCalc = { id: 1, questId: 1, originalDate: '2026-11-30', action: 'skip', newDate: null, newStart: null, newEnd: null };

module.exports = { quest, makeWorld, seminar, olympiad, midterm, moveCalc, skipCalc };
