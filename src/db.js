// The data store: loads and saves everything in one SQLite file.
//
// We use Node's built-in `node:sqlite` module and only the methods `exec`
// and `prepare(...).run / get / all`. `better-sqlite3` has the same method
// names, so switching library would be a one-line change.
//
// SQLite columns use snake_case (start_date); the rest of the app uses
// camelCase (startDate). The `rowTo...` functions below translate.

const { DatabaseSync } = require('node:sqlite');
const { changeFitsQuest } = require('./schedule');
const { mondayOf } = require('./time');

// 2: the deadlines table was added (existing databases just gain it).
// 3: habits, the XP log and the xp columns were added.
// 4: imports, transactions and merchant labels (finances) were added.
const SCHEMA_VERSION = 4;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS semesters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,            -- 'main' | 'side' | 'limited'
    repeat TEXT,                   -- 'weekly' | 'once' | NULL for limited
    name TEXT NOT NULL,
    color TEXT,
    icon TEXT,
    note TEXT,
    weekday INTEGER,               -- 1 = Mon ... 7 = Sun (weekly only)
    date TEXT,                     -- once only
    start_time TEXT,               -- 'HH:MM'
    end_time TEXT,
    start_date TEXT,               -- limited only
    end_date TEXT,
    semester_id INTEGER REFERENCES semesters(id),
    xp INTEGER                     -- NULL = the default amount
  );
  CREATE TABLE IF NOT EXISTS changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quest_id INTEGER NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
    original_date TEXT NOT NULL,
    action TEXT NOT NULL,          -- 'skip' | 'move'
    new_date TEXT,
    new_start TEXT,
    new_end TEXT,
    UNIQUE (quest_id, original_date)
  );
  CREATE TABLE IF NOT EXISTS breaks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    semester_id INTEGER NOT NULL REFERENCES semesters(id)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT                     -- stored as JSON
  );
  CREATE TABLE IF NOT EXISTS deadlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    due_date TEXT NOT NULL,        -- 'YYYY-MM-DD'
    due_time TEXT NOT NULL,        -- 'HH:MM'
    note TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    xp INTEGER                     -- NULL = the default amount
  );
  CREATE TABLE IF NOT EXISTS mappings (
    local_key TEXT PRIMARY KEY,    -- 'quest:<id>', 'makeup:<changeId>' or 'deadline:<id>'
    google_id TEXT NOT NULL,
    hash TEXT,
    frozen INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,            -- 'daily' | 'weekly'
    created_date TEXT NOT NULL,
    xp INTEGER                     -- NULL = the default amount
  );
  CREATE TABLE IF NOT EXISTS habit_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    from_monday TEXT NOT NULL,     -- the target counts from this Monday on
    target INTEGER NOT NULL,
    UNIQUE (habit_id, from_monday)
  );
  CREATE TABLE IF NOT EXISTS habit_ticks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    UNIQUE (habit_id, date)
  );
  CREATE TABLE IF NOT EXISTS xp_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,      -- stops the same award being written twice
    date TEXT NOT NULL,
    label TEXT NOT NULL,
    amount INTEGER NOT NULL,
    kind TEXT NOT NULL,
    on_time INTEGER                -- bounties only: 1 / 0, otherwise NULL
  );
  CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,        -- base name only, no folder
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    added INTEGER NOT NULL,
    known INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL,        -- sen
    direction TEXT NOT NULL,        -- 'DB' | 'CR'
    text TEXT NOT NULL,             -- card numbers removed
    type TEXT NOT NULL,
    merchant TEXT NOT NULL,         -- merchant key
    kind TEXT NOT NULL,             -- 'spend' | 'refund' | 'income'
    label TEXT,                     -- per-payment override, NULL = merchant's
    allowance INTEGER,              -- NULL = automatic rule, 1 = yes, 0 = no
    import_id INTEGER REFERENCES imports(id)
  );
  CREATE INDEX IF NOT EXISTS transactions_date ON transactions(date);
  CREATE TABLE IF NOT EXISTS merchant_labels (
    merchant TEXT PRIMARY KEY,
    label TEXT NOT NULL             -- 'need' | 'want' | 'skip'
  );
`;

const DEFAULT_SETTINGS = {
  leadMinutes: 15,
  desktopNotifications: true,
  launchOnLogin: true,
  googlePush: false,
  googleCalendarId: null,
  googleClientId: '',
  googleClientSecret: '',
  lastPush: null,
  xpStartDate: null,
  xpCheckedDate: null,
  allowanceMin: 200000000,   // sen: a deposit this big counts as allowance
  balanceAnchor: null,       // { date, amount } once the user sets it
};

// ---------- row translation ----------

function rowToSemester(row) {
  return { id: row.id, name: row.name, startDate: row.start_date, endDate: row.end_date, active: row.active };
}

function rowToQuest(row) {
  return {
    id: row.id,
    kind: row.kind,
    repeat: row.repeat,
    name: row.name,
    color: row.color,
    icon: row.icon,
    note: row.note,
    weekday: row.weekday,
    date: row.date,
    start: row.start_time,
    end: row.end_time,
    startDate: row.start_date,
    endDate: row.end_date,
    semesterId: row.semester_id,
    xp: row.xp,
  };
}

function rowToChange(row) {
  return {
    id: row.id,
    questId: row.quest_id,
    originalDate: row.original_date,
    action: row.action,
    newDate: row.new_date,
    newStart: row.new_start,
    newEnd: row.new_end,
  };
}

function rowToBreak(row) {
  return { id: row.id, name: row.name, startDate: row.start_date, endDate: row.end_date, semesterId: row.semester_id };
}

// SQLite has no true/false, so `done` is stored as 0 or 1.
function rowToDeadline(row) {
  return { id: row.id, name: row.name, dueDate: row.due_date, dueTime: row.due_time, note: row.note, done: row.done === 1, xp: row.xp };
}

function rowToMapping(row) {
  return { localKey: row.local_key, googleId: row.google_id, hash: row.hash, frozen: row.frozen };
}

function rowToXp(row) {
  return {
    key: row.key,
    date: row.date,
    label: row.label,
    amount: row.amount,
    kind: row.kind,
    onTime: row.on_time === null ? null : row.on_time === 1,
  };
}

function rowToTxn(row) {
  return {
    id: row.id,
    date: row.date,
    amount: row.amount,
    direction: row.direction,
    text: row.text,
    type: row.type,
    merchant: row.merchant,
    kind: row.kind,
    label: row.label,
    allowance: row.allowance,
    importId: row.import_id,
  };
}

function rowToImport(row) {
  return {
    id: row.id,
    fileName: row.file_name,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    importedAt: row.imported_at,
    added: row.added,
    known: row.known,
  };
}

// SQLite can't store `undefined`, so missing fields become NULL.
function orNull(value) {
  return value === undefined ? null : value;
}

// ---------- the store ----------

function openStore(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  // CREATE TABLE IF NOT EXISTS skips tables that already exist, so databases
  // made before version 3 need the new columns added by hand.
  addColumnIfMissing('quests', 'xp', 'INTEGER');
  addColumnIfMissing('deadlines', 'xp', 'INTEGER');
  db.exec('PRAGMA user_version = ' + SCHEMA_VERSION);

  function addColumnIfMissing(table, column, type) {
    const columns = db.prepare('PRAGMA table_info(' + table + ')').all();
    if (!columns.some((c) => c.name === column)) {
      db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + type);
    }
  }

  // Runs `fn` inside a transaction: either all of its changes are saved,
  // or (if it throws) none of them.
  function inTransaction(fn) {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function getActiveSemester() {
    const row = db.prepare('SELECT * FROM semesters WHERE active = 1').get();
    return row ? rowToSemester(row) : null;
  }

  // Everything the schedule engine needs: the active semester, its weekly
  // quests, every one-time quest and limited event, their changes, and the
  // active semester's breaks. Weekly quests of archived semesters are left out.
  function getWorld() {
    const semester = getActiveSemester();
    const semesterId = semester ? semester.id : -1;
    const quests = db
      .prepare("SELECT * FROM quests WHERE repeat IS NOT 'weekly' OR semester_id = ? ORDER BY id")
      .all(semesterId)
      .map(rowToQuest);
    const questIds = new Set(quests.map((q) => q.id));
    const changes = db
      .prepare('SELECT * FROM changes ORDER BY id')
      .all()
      .map(rowToChange)
      .filter((c) => questIds.has(c.questId));
    const breaks = db
      .prepare('SELECT * FROM breaks WHERE semester_id = ? ORDER BY start_date, id')
      .all(semesterId)
      .map(rowToBreak);
    return { semester, quests, changes, breaks };
  }

  // Updates a semester, or inserts one. A newly inserted semester becomes
  // active when there isn't an active one yet (the first launch).
  function saveSemester(sem) {
    if (sem.id) {
      db.prepare('UPDATE semesters SET name = ?, start_date = ?, end_date = ? WHERE id = ?')
        .run(sem.name, sem.startDate, sem.endDate, sem.id);
      return sem.id;
    }
    const active = getActiveSemester() ? 0 : 1;
    const info = db.prepare('INSERT INTO semesters (name, start_date, end_date, active) VALUES (?, ?, ?, ?)')
      .run(sem.name, sem.startDate, sem.endDate, active);
    return Number(info.lastInsertRowid);
  }

  // Archives the current semester and starts a fresh one. The old weekly
  // quests stay in the database but stop showing up. Their Google mappings
  // are "frozen" so the push leaves those Google series alone, ending on
  // the old semester's last date.
  function startNewSemester({ name, startDate, endDate }) {
    return inTransaction(() => {
      const old = getActiveSemester();
      if (old) {
        const weeklyIds = db.prepare("SELECT id FROM quests WHERE repeat = 'weekly' AND semester_id = ?").all(old.id).map((r) => r.id);
        const freeze = db.prepare('UPDATE mappings SET frozen = 1 WHERE local_key = ?');
        for (const id of weeklyIds) {
          freeze.run('quest:' + id);
          for (const c of db.prepare('SELECT id FROM changes WHERE quest_id = ?').all(id)) {
            freeze.run('makeup:' + c.id);
          }
        }
        db.prepare('UPDATE semesters SET active = 0').run();
      }
      const info = db.prepare('INSERT INTO semesters (name, start_date, end_date, active) VALUES (?, ?, ?, 1)')
        .run(name, startDate, endDate);
      return Number(info.lastInsertRowid);
    });
  }

  // Inserts a quest (no id) or updates one. When a weekly quest moves to a
  // different weekday, its skips and moves for the old weekday no longer
  // point at a real occurrence, so they are deleted in the same transaction
  // instead of lingering as invisible ghosts.
  function saveQuest(quest) {
    return inTransaction(() => {
      let semesterId = orNull(quest.semesterId);
      if (quest.repeat === 'weekly' && !semesterId) {
        const active = getActiveSemester();
        semesterId = active ? active.id : null;
      }
      const values = [
        quest.kind, orNull(quest.repeat), quest.name, orNull(quest.color), orNull(quest.icon), orNull(quest.note),
        orNull(quest.weekday), orNull(quest.date), orNull(quest.start), orNull(quest.end),
        orNull(quest.startDate), orNull(quest.endDate), semesterId,
      ];
      let id = quest.id;
      if (id) {
        db.prepare(`UPDATE quests SET kind = ?, repeat = ?, name = ?, color = ?, icon = ?, note = ?, weekday = ?,
          date = ?, start_time = ?, end_time = ?, start_date = ?, end_date = ?, semester_id = ? WHERE id = ?`)
          .run(...values, id);
        // Forms don't know about xp, so an edit without one keeps the stored
        // value. An explicit null clears it back to the default.
        if (quest.xp !== undefined) db.prepare('UPDATE quests SET xp = ? WHERE id = ?').run(quest.xp, id);
      } else {
        const info = db.prepare(`INSERT INTO quests (kind, repeat, name, color, icon, note, weekday, date,
          start_time, end_time, start_date, end_date, semester_id, xp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(...values, orNull(quest.xp));
        id = Number(info.lastInsertRowid);
      }
      dropChangesThatNoLongerFit(id, quest);
      return id;
    });
  }

  function dropChangesThatNoLongerFit(questId, quest) {
    const changes = db.prepare('SELECT * FROM changes WHERE quest_id = ?').all(questId).map(rowToChange);
    for (const change of changes) {
      if (!changeFitsQuest(change, quest)) {
        db.prepare('DELETE FROM changes WHERE id = ?').run(change.id);
      }
    }
  }

  function deleteQuest(id) {
    // ON DELETE CASCADE removes the quest's changes too.
    db.prepare('DELETE FROM quests WHERE id = ?').run(id);
  }

  // One skip or move per (quest, original date): setting a new one replaces
  // the old one but keeps its id, so its Google make-up mapping stays valid.
  function setChange(change) {
    db.prepare(`INSERT INTO changes (quest_id, original_date, action, new_date, new_start, new_end)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (quest_id, original_date) DO UPDATE SET
        action = excluded.action, new_date = excluded.new_date,
        new_start = excluded.new_start, new_end = excluded.new_end`)
      .run(change.questId, change.originalDate, change.action, orNull(change.newDate), orNull(change.newStart), orNull(change.newEnd));
    const row = db.prepare('SELECT id FROM changes WHERE quest_id = ? AND original_date = ?').get(change.questId, change.originalDate);
    return row.id;
  }

  function removeChange(questId, originalDate) {
    db.prepare('DELETE FROM changes WHERE quest_id = ? AND original_date = ?').run(questId, originalDate);
  }

  // Breaks always belong to the active semester unless told otherwise.
  function saveBreak(brk) {
    const active = getActiveSemester();
    const semesterId = brk.semesterId || (active ? active.id : null);
    if (brk.id) {
      db.prepare('UPDATE breaks SET name = ?, start_date = ?, end_date = ?, semester_id = ? WHERE id = ?')
        .run(brk.name, brk.startDate, brk.endDate, semesterId, brk.id);
      return brk.id;
    }
    const info = db.prepare('INSERT INTO breaks (name, start_date, end_date, semester_id) VALUES (?, ?, ?, ?)')
      .run(brk.name, brk.startDate, brk.endDate, semesterId);
    return Number(info.lastInsertRowid);
  }

  function deleteBreak(id) {
    db.prepare('DELETE FROM breaks WHERE id = ?').run(id);
  }

  function listDeadlines() {
    return db.prepare('SELECT * FROM deadlines ORDER BY due_date, due_time, id').all().map(rowToDeadline);
  }

  // Inserts a deadline (no id) or updates one. Editing never changes
  // whether it is ticked done: that's setDeadlineDone's job.
  function saveDeadline(d) {
    if (d.id) {
      db.prepare('UPDATE deadlines SET name = ?, due_date = ?, due_time = ?, note = ? WHERE id = ?')
        .run(d.name, d.dueDate, d.dueTime, orNull(d.note), d.id);
      // Same rule as quests: an edit without xp keeps it, null clears it.
      if (d.xp !== undefined) db.prepare('UPDATE deadlines SET xp = ? WHERE id = ?').run(d.xp, d.id);
      return d.id;
    }
    const info = db.prepare('INSERT INTO deadlines (name, due_date, due_time, note, xp) VALUES (?, ?, ?, ?, ?)')
      .run(d.name, d.dueDate, d.dueTime, orNull(d.note), orNull(d.xp));
    return Number(info.lastInsertRowid);
  }

  function setDeadlineDone(id, done) {
    db.prepare('UPDATE deadlines SET done = ? WHERE id = ?').run(done ? 1 : 0, id);
  }

  function deleteDeadline(id) {
    db.prepare('DELETE FROM deadlines WHERE id = ?').run(id);
  }

  function listHabits() {
    const targets = db.prepare('SELECT * FROM habit_targets ORDER BY from_monday').all();
    const ticks = db.prepare('SELECT * FROM habit_ticks ORDER BY date').all();
    return db.prepare('SELECT * FROM habits ORDER BY id').all().map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      createdDate: row.created_date,
      xp: row.xp,
      targets: targets.filter((t) => t.habit_id === row.id).map((t) => ({ fromMonday: t.from_monday, target: t.target })),
      ticks: ticks.filter((t) => t.habit_id === row.id).map((t) => t.date),
    }));
  }

  // Inserts a habit (no id) or updates one. Targets are history: a changed
  // target is written for this week's Monday, so earlier weeks keep theirs.
  function saveHabit(habit, today) {
    return inTransaction(() => {
      const target = habit.kind === 'daily' ? 1 : habit.target;
      let id = habit.id;
      if (id) {
        db.prepare('UPDATE habits SET name = ?, kind = ? WHERE id = ?')
          .run(habit.name, habit.kind, id);
        // The habit form never sends xp, so only touch it when one is given.
        if (habit.xp !== undefined) {
          db.prepare('UPDATE habits SET xp = ? WHERE id = ?').run(orNull(habit.xp), id);
        }
      } else {
        const info = db.prepare('INSERT INTO habits (name, kind, created_date, xp) VALUES (?, ?, ?, ?)')
          .run(habit.name, habit.kind, today, orNull(habit.xp));
        id = Number(info.lastInsertRowid);
      }
      db.prepare(`INSERT INTO habit_targets (habit_id, from_monday, target) VALUES (?, ?, ?)
        ON CONFLICT (habit_id, from_monday) DO UPDATE SET target = excluded.target`)
        .run(id, mondayOf(today), target);
      return id;
    });
  }

  function deleteHabit(id) {
    // ON DELETE CASCADE removes the habit's ticks and targets too.
    db.prepare('DELETE FROM habits WHERE id = ?').run(id);
  }

  function setHabitTick(habitId, date, ticked) {
    if (ticked) {
      db.prepare('INSERT INTO habit_ticks (habit_id, date) VALUES (?, ?) ON CONFLICT (habit_id, date) DO NOTHING')
        .run(habitId, date);
    } else {
      db.prepare('DELETE FROM habit_ticks WHERE habit_id = ? AND date = ?').run(habitId, date);
    }
  }

  // Returns true when the row was new. A key already in the log is ignored,
  // so awarding the same thing twice can never pay out twice.
  function addXp(row) {
    const onTime = row.onTime === undefined || row.onTime === null ? null : (row.onTime ? 1 : 0);
    const info = db.prepare(`INSERT INTO xp_log (key, date, label, amount, kind, on_time) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (key) DO NOTHING`)
      .run(row.key, row.date, row.label, row.amount, row.kind, onTime);
    return Number(info.changes) > 0;
  }

  function removeXp(key) {
    db.prepare('DELETE FROM xp_log WHERE key = ?').run(key);
  }

  // Newest first: by date, then by the order they were written.
  function listXp({ limit } = {}) {
    const sql = 'SELECT * FROM xp_log ORDER BY date DESC, id DESC' + (limit ? ' LIMIT ?' : '');
    const rows = limit ? db.prepare(sql).all(limit) : db.prepare(sql).all();
    return rows.map(rowToXp);
  }

  function totalXp() {
    return db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM xp_log').get().total;
  }

  // Settings are stored one row per key, as JSON. Anything not stored yet
  // falls back to DEFAULT_SETTINGS.
  function getSettings() {
    const settings = { ...DEFAULT_SETTINGS };
    for (const row of db.prepare('SELECT key, value FROM settings').all()) {
      settings[row.key] = JSON.parse(row.value);
    }
    return settings;
  }

  function setSettings(partial) {
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
    inTransaction(() => {
      for (const [key, value] of Object.entries(partial)) {
        upsert.run(key, JSON.stringify(value));
      }
    });
  }

  function listMappings() {
    return db.prepare('SELECT * FROM mappings ORDER BY local_key').all().map(rowToMapping);
  }

  function upsertMapping({ localKey, googleId, hash, frozen = 0 }) {
    db.prepare(`INSERT INTO mappings (local_key, google_id, hash, frozen) VALUES (?, ?, ?, ?)
      ON CONFLICT (local_key) DO UPDATE SET google_id = excluded.google_id, hash = excluded.hash, frozen = excluded.frozen`)
      .run(localKey, googleId, orNull(hash), frozen ? 1 : 0);
  }

  function deleteMapping(localKey) {
    db.prepare('DELETE FROM mappings WHERE local_key = ?').run(localKey);
  }

  function clearMappings({ includeFrozen = false } = {}) {
    if (includeFrozen) db.prepare('DELETE FROM mappings').run();
    else db.prepare('DELETE FROM mappings WHERE frozen = 0').run();
  }

  // ---------- finances ----------

  // Saves one import and its rows together. The kind is only a placeholder
  // (money out = spend, money in = income); finance.js works out refunds later.
  function addImport(info, rows) {
    return inTransaction(() => {
      const result = db.prepare(
        'INSERT INTO imports (file_name, period_start, period_end, imported_at, added, known) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(info.fileName, info.periodStart, info.periodEnd, info.importedAt, rows.length, info.known);
      const importId = Number(result.lastInsertRowid);
      const insert = db.prepare(
        'INSERT INTO transactions (date, amount, direction, text, type, merchant, kind, import_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const r of rows) {
        insert.run(r.date, r.amount, r.direction, r.text, r.type, r.merchant, r.direction === 'DB' ? 'spend' : 'income', importId);
      }
      return importId;
    });
  }

  function listTransactions() {
    return db.prepare('SELECT * FROM transactions ORDER BY date, id').all().map(rowToTxn);
  }

  // `kinds` is a Map of id -> kind. Only rows whose kind really changed are written.
  function setKinds(kinds) {
    inTransaction(() => {
      const update = db.prepare('UPDATE transactions SET kind = ? WHERE id = ? AND kind != ?');
      for (const [id, kind] of kinds) update.run(kind, id, kind);
    });
  }

  function setTransactionLabel(id, label) {
    db.prepare('UPDATE transactions SET label = ? WHERE id = ?').run(label, id);
  }

  function setTransactionAllowance(id, allowance) {
    db.prepare('UPDATE transactions SET allowance = ? WHERE id = ?').run(allowance, id);
  }

  function listMerchantLabels() {
    const labels = {};
    for (const row of db.prepare('SELECT merchant, label FROM merchant_labels').all()) {
      labels[row.merchant] = row.label;
    }
    return labels;
  }

  function setMerchantLabel(merchant, label) {
    db.prepare('INSERT INTO merchant_labels (merchant, label) VALUES (?, ?) ON CONFLICT (merchant) DO UPDATE SET label = excluded.label')
      .run(merchant, label);
  }

  function listImports() {
    return db.prepare('SELECT * FROM imports ORDER BY id DESC').all().map(rowToImport);
  }

  // The rows go first because they point at the import (foreign key).
  function deleteImport(id) {
    inTransaction(() => {
      db.prepare('DELETE FROM transactions WHERE import_id = ?').run(id);
      db.prepare('DELETE FROM imports WHERE id = ?').run(id);
    });
  }

  function close() {
    db.close();
  }

  return {
    getWorld, getActiveSemester, saveSemester, startNewSemester,
    saveQuest, deleteQuest, setChange, removeChange,
    saveBreak, deleteBreak, getSettings, setSettings,
    listDeadlines, saveDeadline, setDeadlineDone, deleteDeadline,
    listHabits, saveHabit, deleteHabit, setHabitTick,
    addXp, removeXp, listXp, totalXp,
    addImport, listTransactions, setKinds, setTransactionLabel, setTransactionAllowance,
    listMerchantLabels, setMerchantLabel, listImports, deleteImport,
    listMappings, upsertMapping, deleteMapping, clearMappings, close,
  };
}

module.exports = { openStore, DEFAULT_SETTINGS };
