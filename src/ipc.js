// The bridge between the window (ui/) and the rest of the app.
//
// The window can't touch the database directly (that would be unsafe), so
// it asks the main process through IPC ("inter-process communication").
// `buildHandlers` holds one plain function per request; `registerIpc` hooks
// them up to Electron as 'dungeon:<name>' channels.
//
// Every call that changes data returns { ok: true, id } or
// { ok: false, errors: [...] } when the form input is not valid.

const { expandRange, expandDay, floorNumber, isCleared } = require('./schedule');
const { checkDraft, checkMove, warningSteps } = require('./draft');
const { layoutColumns } = require('./layout');
const { validateQuest, validateMove, validateBreak, validateSemester, validateDeadline, validateHabit } = require('./validate');
const { bountyList, deadlinesByDate } = require('./deadlines');
const { addDays, isoWeek, datesInRange, mondayOf } = require('./time');
const { DEFAULT_SETTINGS } = require('./db');
const { readPdfText: defaultReadPdfText } = require('./pdf-text');
const { parseMutasi } = require('./bca-parse');
const { stripCardNumbers, merchantKey } = require('./merchant');
const {
  newRows, classifyKinds, buildCycles, summarizeCycle, balanceAt, coverage,
} = require('./finance');
const { levelInfo } = require('./xp');
const { applyHabitTick, applyDeadlineDone, rejudgeWeek, buildProfile } = require('./xp-log');

const LABELS = ['need', 'want', 'skip'];

// A real calendar date written YYYY-MM-DD ("2026-02-31" is not one).
function isRealDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(text + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

const NOT_SET_UP = { ok: false, error: 'not set up' };

// Google stubs, replaced through `extra` once Google is set up.
const googleStubs = {
  googleConnect: async () => NOT_SET_UP,
  googleDisconnect: async () => NOT_SET_UP,
  pushNow: async () => NOT_SET_UP,
  setMainSync: async () => NOT_SET_UP,
  getPushStatus: async () => NOT_SET_UP,
};

function buildHandlers(store, { onChange = () => {}, clock, extra = {}, readPdfText = defaultReadPdfText }) {
  // Wraps a data-changing action: validate first, save, then tell the rest
  // of the app (reminders, Google push, the window) that data changed.
  function mutate(errors, save) {
    if (errors.length > 0) return { ok: false, errors };
    const id = save();
    onChange();
    return { ok: true, id: id === undefined ? null : id };
  }

  // Kinds (spend / refund / income) depend on neighbouring rows, so after
  // rows are added or removed they are worked out again from scratch.
  function reclassify() {
    store.setKinds(classifyKinds(store.listTransactions()));
  }

  // Reads one PDF and saves its new rows. Returns the result for the window.
  async function importOne(filePath) {
    const fileName = filePath.split(/[\\/]/).pop();
    const failed = (error) => ({ fileName, ok: false, added: 0, known: 0, newMerchants: [], problems: [], error });
    let parsed;
    try {
      parsed = parseMutasi(await readPdfText(filePath));
    } catch (err) {
      return failed(err.message);
    }
    if (parsed.period === null) return failed("This isn't a BCA mutasi rekening.");

    // Card numbers are removed before anything is saved or compared.
    const fileRows = parsed.rows.map((r) => {
      const text = stripCardNumbers(r.text);
      return { ...r, text, merchant: merchantKey({ text, type: r.type }) };
    });
    const saved = store.listTransactions();
    const fresh = newRows(fileRows, saved);
    const seenBefore = new Set(saved.map((r) => r.merchant));
    const labelled = store.listMerchantLabels();
    // Only payments (DB) count: people who send money are not shops to label.
    const newMerchants = [...new Set(fresh.filter((r) => r.direction === 'DB').map((r) => r.merchant))]
      .filter((m) => !seenBefore.has(m) && !(m in labelled));
    // Saved even with 0 new rows, so its period still counts as covered.
    const { date, time } = clock();
    store.addImport({
      fileName,
      periodStart: parsed.period.start,
      periodEnd: parsed.period.end,
      importedAt: `${date}T${time}`,
      known: fileRows.length - fresh.length,
    }, fresh);
    return {
      fileName, ok: true, added: fresh.length, known: fileRows.length - fresh.length,
      newMerchants, problems: parsed.problems,
    };
  }

  // The newest cycle's numbers, shared by getMoneySummary and getTreasury.
  function treasuryNumbers() {
    const rows = store.listTransactions();
    const settings = store.getSettings();
    const cycles = buildCycles(rows, settings.allowanceMin);
    const merchants = store.listMerchantLabels();
    const imports = store.listImports();
    const { first, last, gaps } = coverage(imports);
    const anchor = settings.balanceAnchor;
    return { rows, settings, cycles, merchants, first, last, gaps, anchor };
  }

  // Adds a `cleared` flag, because the window has no access to isCleared.
  function withCleared(occurrences, now) {
    return occurrences.map((occ) => ({ ...occ, cleared: isCleared(occ, now) }));
  }

  // The floor of a week: the first day of that week that is in the semester.
  function weekFloor(semester, monday) {
    for (const date of datesInRange(monday, addDays(monday, 6))) {
      const floor = floorNumber(semester, date);
      if (floor !== null) return floor;
    }
    return null;
  }

  return {
    getWeek(mondayDate) {
      const world = store.getWorld();
      const today = clock();
      const sunday = addDays(mondayDate, 6);
      const range = expandRange(world, mondayDate, sunday);
      const days = {};
      const layout = {};
      for (const [date, occurrences] of Object.entries(range)) {
        days[date] = withCleared(occurrences, today);
        layout[date] = layoutColumns(occurrences);
      }
      return {
        days,
        layout,
        week: isoWeek(mondayDate),
        floor: weekFloor(world.semester, mondayDate),
        today,
        semester: world.semester,
        breaks: world.breaks.filter((b) => b.endDate >= mondayDate && b.startDate <= sunday),
        // { date: deadline[] } for the strip under the day heads.
        deadlines: deadlinesByDate(store.listDeadlines(), mondayDate, sunday, today),
      };
    },
    getToday() {
      const today = clock();
      return withCleared(expandDay(store.getWorld(), today.date), today);
    },
    // googleLinked: the quest still has an event in the main Google
    // calendar (an imported quest whose event became repeating has none),
    // so the delete dialog can say truthfully what happens in Google.
    getQuest(id) {
      const quest = store.getWorld().quests.find((q) => q.id === id);
      if (!quest) return null;
      const googleLinked = store.listMappings().some((m) => m.calendar === 'main' && m.localKey === 'quest:' + id);
      return { ...quest, googleLinked };
    },
    // Both checks also say which warning dialogs to show, in order.
    checkDraft(draft, opts) {
      const checks = checkDraft(store.getWorld(), draft, opts || {});
      return { ...checks, steps: warningSteps(checks) };
    },
    checkMove(questId, originalDate, slot) {
      const checks = checkMove(store.getWorld(), questId, originalDate, slot);
      return { ...checks, steps: warningSteps(checks) };
    },
    // Let the forms show errors before running the clash checks.
    validateQuest(quest) {
      return validateQuest(quest, store.getWorld());
    },
    validateMove(slot) {
      return validateMove(slot);
    },
    saveQuest(quest) {
      return mutate(validateQuest(quest, store.getWorld()), () => store.saveQuest(quest));
    },
    deleteQuest(id) {
      return mutate([], () => store.deleteQuest(id));
    },
    setChange(change) {
      const errors = change.action === 'move'
        ? validateMove({ date: change.newDate, start: change.newStart, end: change.newEnd })
        : [];
      return mutate(errors, () => store.setChange(change));
    },
    removeChange(questId, originalDate) {
      return mutate([], () => store.removeChange(questId, originalDate));
    },
    listBreaks() {
      return store.getWorld().breaks;
    },
    saveBreak(brk) {
      return mutate(validateBreak(brk, store.getActiveSemester()), () => store.saveBreak(brk));
    },
    deleteBreak(id) {
      return mutate([], () => store.deleteBreak(id));
    },
    getSemester() {
      return store.getActiveSemester();
    },
    saveSemester(sem) {
      return mutate(validateSemester(sem), () => store.saveSemester(sem));
    },
    startNewSemester(sem) {
      return mutate(validateSemester(sem), () => store.startNewSemester(sem));
    },
    // ---------- deadlines (📜 bounties) ----------
    listDeadlines() {
      return store.listDeadlines();
    },
    // What the 📜 BOUNTIES panel shows: overdue first, then the next 14 days.
    getBounties() {
      return bountyList(store.listDeadlines(), clock());
    },
    saveDeadline(d) {
      return mutate(validateDeadline(d), () => store.saveDeadline(d));
    },
    setDeadlineDone(id, done) {
      return mutate([], () => applyDeadlineDone(store, id, done, clock()));
    },
    deleteDeadline(id) {
      return mutate([], () => store.deleteDeadline(id));
    },
    // ---------- profile, habits and XP ----------
    // Read-only: logging cleared quests is main.js's job (on a timer).
    getProfile() {
      return buildProfile(store, clock());
    },
    getLevel() {
      return levelInfo(store.totalXp());
    },
    saveHabit(h) {
      const errors = validateHabit(h);
      // Switching kind would double-pay or leave a stale "week won" row.
      const stored = h.id ? store.listHabits().find((x) => x.id === h.id) : null;
      if (stored && stored.kind !== h.kind) {
        errors.push("A habit can't switch between Daily and Weekly; delete it and make a new one");
      }
      return mutate(errors, () => {
        const today = clock().date;
        const id = store.saveHabit(h, today);
        // A new target can win or un-win this week.
        rejudgeWeek(store, id, mondayOf(today), today, today);
        return id;
      });
    },
    deleteHabit(id) {
      return mutate([], () => store.deleteHabit(id));
    },
    tickHabit(habitId, date, ticked) {
      return mutate(applyHabitTick(store, habitId, date, ticked, clock().date), () => {});
    },
    getSettings() {
      return store.getSettings();
    },
    // The window may only change settings that exist (see DEFAULT_SETTINGS),
    // so a typo or a bad script can't fill the table with junk keys.
    setSettings(partial) {
      const unknown = Object.keys(partial || {}).filter((key) => !(key in DEFAULT_SETTINGS));
      const errors = unknown.map((key) => `"${key}" is not a setting`);
      return mutate(errors, () => store.setSettings(partial));
    },
    // ---------- Treasury (money) ----------
    // Reads each PDF in turn; one bad file never stops the others.
    async importStatements(paths) {
      const files = [];
      for (const filePath of paths) files.push(await importOne(filePath));
      if (files.some((f) => f.added > 0)) {
        reclassify();
        onChange();
      }
      return { files };
    },
    // `index` counts the oldest-first cycles list; null or out of range = newest.
    getTreasury(index) {
      const n = treasuryNumbers();
      if (n.rows.length === 0) {
        return {
          hasData: false, allowanceMin: n.settings.allowanceMin, cycles: [], index: null, cycle: null,
          merchants: n.merchants,
          balance: { anchor: n.anchor, current: null, asOf: n.last, series: [], gaps: n.gaps },
        };
      }
      const summaries = n.cycles.map((c) => summarizeCycle(c, n.rows, n.merchants));
      const shown = Number.isInteger(index) && index >= 0 && index < summaries.length ? index : summaries.length - 1;
      let current = null;
      const series = [];
      if (n.anchor && n.last) {
        current = balanceAt(n.rows, n.anchor, n.last);
        for (const day of datesInRange(n.first, n.last)) {
          series.push({ date: day, balance: balanceAt(n.rows, n.anchor, day) });
        }
      }
      return {
        hasData: true,
        allowanceMin: n.settings.allowanceMin,
        cycles: summaries.map((s, i) => ({
          index: i, start: s.start, end: s.end, beforeTracking: s.beforeTracking,
          pot: s.pot, used: s.used, limits: s.limits, saved: s.saved,
        })),
        index: shown,
        cycle: summaries[shown],
        merchants: n.merchants,
        balance: { anchor: n.anchor, current, asOf: n.last, series, gaps: n.gaps },
      };
    },
    getMoneySummary() {
      const n = treasuryNumbers();
      if (n.rows.length === 0) return null;
      const s = summarizeCycle(n.cycles[n.cycles.length - 1], n.rows, n.merchants);
      return {
        spent: s.used.need + s.used.want + s.used.skip + s.unsorted.amount,
        // Allowance left = the allowance minus every payment this cycle
        // (`saved` is exactly that). Null before the first allowance.
        pot: s.beforeTracking ? null : s.pot,
        left: s.beforeTracking ? null : s.saved,
        moneyIn: s.moneyIn,
        balance: n.anchor && n.last ? balanceAt(n.rows, n.anchor, n.last) : null,
        asOf: n.last,
      };
    },
    setLabel(id, label) {
      const errors = label === null || LABELS.includes(label) ? [] : ['Label must be need, want or skip'];
      return mutate(errors, () => store.setTransactionLabel(id, label));
    },
    setMerchantLabel(merchant, label) {
      const errors = [];
      if (typeof merchant !== 'string' || merchant.trim() === '') errors.push('Merchant is required');
      if (!LABELS.includes(label)) errors.push('Label must be need, want or skip');
      return mutate(errors, () => store.setMerchantLabel(merchant, label));
    },
    setAllowance(id, value) {
      const errors = [1, 0, null].includes(value) ? [] : ['Allowance must be 1, 0 or empty'];
      return mutate(errors, () => store.setTransactionAllowance(id, value));
    },
    // The balance you read off your bank app on one day; everything else is counted from it.
    setBalance(input) {
      const { date, amount } = input || {};
      const errors = [];
      if (!isRealDate(date)) errors.push('Date must be a real date like 2026-11-16');
      if (!Number.isSafeInteger(amount)) errors.push('Amount must be a whole number of sen');
      return mutate(errors, () => store.setSettings({ balanceAnchor: { date, amount } }));
    },
    listImports() {
      return store.listImports();
    },
    deleteImport(id) {
      // Rows belong only to the import that first added them, so deleting one
      // can drop days that another import also covers. Tell the window which
      // files overlap, so the user can import them again to get those days back.
      const all = store.listImports();
      const gone = all.find((i) => i.id === id);
      const reimport = gone
        ? [...new Set(all
          .filter((i) => i.id !== id && i.periodStart <= gone.periodEnd && i.periodEnd >= gone.periodStart)
          .map((i) => i.fileName))]
        : [];
      const result = mutate([], () => {
        store.deleteImport(id);
        reclassify();
      });
      return { ...result, id, reimport };
    },
    ...googleStubs,
    // Handlers that need Electron (tray, Google) are passed in by main.js.
    ...extra,
  };
}

// Hooks every handler up to Electron's ipcMain as 'dungeon:<name>'.
// Returns the handlers so main.js can also call them directly.
function registerIpc(store, options) {
  const { ipcMain } = require('electron');
  const handlers = buildHandlers(store, options);
  for (const [name, fn] of Object.entries(handlers)) {
    // The first argument from Electron is the event; the window's own
    // arguments come after it.
    ipcMain.handle('dungeon:' + name, (_event, ...args) => fn(...args));
  }
  return handlers;
}

module.exports = { buildHandlers, registerIpc };
