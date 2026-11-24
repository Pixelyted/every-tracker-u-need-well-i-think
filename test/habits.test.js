const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TICK_WINDOW_DAYS, tickWindow, canTick, targetForWeek, weekProgress,
  dailyStreak, weeklyStreak, habitSummary,
} = require('../src/habits');

const TODAY = '2026-11-25'; // a Wednesday

// A habit with sensible defaults; each test overrides what it cares about.
function habit(fields) {
  return {
    id: 1,
    name: 'Read',
    kind: 'daily',
    createdDate: '2026-11-01',
    xp: null,
    targets: [{ fromMonday: '2026-10-26', target: 3 }],
    ticks: [],
    ...fields,
  };
}

test('tick window is today and the 6 days before', () => {
  assert.equal(TICK_WINDOW_DAYS, 7);
  assert.deepEqual(tickWindow(TODAY), [
    '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22',
    '2026-11-23', '2026-11-24', '2026-11-25',
  ]);
  assert.equal(canTick('2026-11-19', TODAY), true);
  assert.equal(canTick('2026-11-18', TODAY), false);
  assert.equal(canTick('2026-11-26', TODAY), false);
});

test("daily streak: an unticked today doesn't break it", () => {
  const ticks = ['2026-11-22', '2026-11-23', '2026-11-24'];
  assert.deepEqual(dailyStreak(habit({ ticks }), TODAY), { current: 3, best: 3 });
  assert.equal(dailyStreak(habit({ ticks: [...ticks, '2026-11-25'] }), TODAY).current, 4);
});

test('daily streak: a missed day resets it, best remembers', () => {
  const ticks = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-23', '2026-11-24'];
  assert.deepEqual(dailyStreak(habit({ ticks }), TODAY), { current: 2, best: 4 });
  assert.equal(dailyStreak(habit({ ticks: ['2026-11-22'] }), TODAY).current, 0);
});

test('weekly progress and a target change from this week on', () => {
  const h = habit({
    kind: 'weekly',
    targets: [{ fromMonday: '2026-10-26', target: 3 }, { fromMonday: '2026-11-23', target: 4 }],
    ticks: ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-23', '2026-11-24'],
  });
  assert.deepEqual(weekProgress(h, '2026-11-16'), { count: 3, target: 3, won: true });
  assert.deepEqual(weekProgress(h, '2026-11-23'), { count: 2, target: 4, won: false });
});

test('target falls back to the first row when every row starts later', () => {
  const h = habit({ targets: [{ fromMonday: '2026-11-23', target: 5 }] });
  assert.equal(targetForWeek(h, '2026-11-02'), 5);
});

test("weekly streak: an unwon current week doesn't break it; weeks before creation aren't judged", () => {
  const weeks = [
    ['2026-11-02', '2026-11-03', '2026-11-04'],
    ['2026-11-09', '2026-11-10', '2026-11-11'],
    ['2026-11-16', '2026-11-17', '2026-11-18'],
  ];
  const h = habit({
    kind: 'weekly',
    createdDate: '2026-11-04',
    // One tick in the week before creation, which must not be judged.
    ticks: ['2026-10-27', ...weeks.flat(), '2026-11-23'],
  });
  assert.deepEqual(weeklyStreak(h, TODAY), { current: 3, best: 3 });

  const missed = habit({
    kind: 'weekly',
    createdDate: '2026-11-04',
    ticks: [...weeks[0], weeks[1][0], weeks[1][1], ...weeks[2], '2026-11-23'],
  });
  assert.deepEqual(weeklyStreak(missed, TODAY), { current: 1, best: 1 });
});

test('summary', () => {
  const daily = habit({ ticks: ['2026-11-20', '2026-11-25'] });
  const s = habitSummary(daily, TODAY);
  assert.equal(s.strip.length, 7);
  assert.deepEqual(s.strip.filter((d) => d.ticked).map((d) => d.date), ['2026-11-20', '2026-11-25']);
  assert.equal(s.week, null);
  assert.deepEqual(s.streak, dailyStreak(daily, TODAY));

  const weekly = habit({ kind: 'weekly', ticks: ['2026-11-23'] });
  const w = habitSummary(weekly, TODAY);
  assert.deepEqual(w.week, weekProgress(weekly, '2026-11-23'));
  assert.deepEqual(w.streak, weeklyStreak(weekly, TODAY));
});
