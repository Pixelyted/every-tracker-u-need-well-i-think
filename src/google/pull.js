// Two-way sync, part 1: works out what Google's changes mean for the app.
//
// planPull looks at every event listed in the "⚔ every tracker u need,
// well i think" calendar, the mappings saved at the last sync and the
// app's own data, and returns a list of ACTIONS for sync.js to carry out
// (update a quest, turn a week into a skip, re-send an event, ...).
// When main-calendar sync is on, it does the same for the user's own
// calendar ('primary'), whose events come in as side quests.
// It is pure: no store, no API calls, no clock, so it is easy to test.
//
// "Changed in Google" = the event's `updated` stamp differs from the one
// saved at the last sync. "Changed in the app" = the item's `updatedAt`
// differs from the one saved then. When both changed, the newer one wins.

const { buildDesiredEvents } = require('./payloads');
const { jakartaStamp, jakartaParts, eventToSlot, cleanTitle, cleanBountyTitle, cleanNote } = require('./event-time');

// ---------- one-week exceptions of a weekly series ----------

// The weeks a weekly series leaves out on purpose (its EXDATE line), as
// stamps like '20261130T070000' in Jakarta time.
function excludedStamps(body) {
  const line = (body.recurrence || []).find((r) => r.startsWith('EXDATE'));
  return new Set(line ? line.split(':')[1].split(',') : []);
}

// True when a one-week "exception" of a series is something the user did
// in Google (deleted or edited that week), not a week the app itself left
// out of the series.
function isChangeMadeInGoogle(exception, desiredBody) {
  if (exception.status !== 'cancelled') return true; // that week was edited
  const start = exception.originalStartTime && exception.originalStartTime.dateTime;
  return !start || !excludedStamps(desiredBody).has(jakartaStamp(start));
}

// The change a one-week exception stands for: a skip when that week was
// deleted, a move (make-up) when it was moved. null when nothing to do.
function changeFromException(quest, exception) {
  // Without its original time we can't tell which week it was; the rebuild resets it.
  if (!exception.originalStartTime || !exception.originalStartTime.dateTime) return null;
  const originalDate = jakartaParts(exception.originalStartTime.dateTime).date;
  if (exception.status === 'cancelled') {
    return { questId: quest.id, originalDate, action: 'skip', newDate: null, newStart: null, newEnd: null };
  }
  const slot = eventToSlot(exception);
  // Only its title or note changed: the rebuild resets that.
  if (slot.date === originalDate && slot.start === quest.start && slot.end === quest.end) return null;
  // A make-up lives on one day; one stretched over two dates can't be one.
  if (slot.endDate) return null;
  return { questId: quest.id, originalDate, action: 'move', newDate: slot.date, newStart: slot.start, newEnd: slot.end };
}

// ---------- small helpers ----------

// Only the fields whose value differs from what the app already has.
function changedFields(current, wanted) {
  const fields = {};
  for (const [key, value] of Object.entries(wanted)) {
    if (current[key] !== value) fields[key] = value;
  }
  return fields;
}

// What a mapping's localKey points at in the app, or null when the app no
// longer has it (then the push deletes the event, nothing to pull).
function findItem(localKey, world, deadlines) {
  const [kind, idText] = localKey.split(':');
  const id = Number(idText);
  if (kind === 'quest') {
    const quest = world.quests.find((q) => q.id === id);
    if (!quest || quest.origin === 'google') return null; // main calendar: see mainActions
    const what = quest.kind === 'limited' ? 'limited' : quest.repeat === 'weekly' ? 'weekly' : 'once';
    return { what, item: quest };
  }
  if (kind === 'makeup') {
    const change = world.changes.find((c) => c.id === id);
    return change && change.action === 'move' ? { what: 'makeup', item: change } : null;
  }
  if (kind === 'deadline') {
    const deadline = deadlines.find((d) => d.id === id);
    return deadline && !deadline.done ? { what: 'deadline', item: deadline } : null;
  }
  return null;
}

// Old rows have updatedAt null, which counts as "older than any Google edit".
function appIsNewer(item, ev) {
  return (item.updatedAt || '') > ev.updated;
}

// ---------- what each kind of item does ----------

// The event is gone (missing, or deleted in Google).
function deletedAction(what, item, localKey) {
  if (what === 'weekly') return { type: 'forget', localKey }; // weekly things are app-only: put it back
  if (what === 'once' || what === 'limited') return { type: 'deleteQuest', localKey, id: item.id };
  if (what === 'deadline') return { type: 'deleteDeadline', localKey, id: item.id };
  // A deleted make-up: that week is simply not happening.
  const change = { questId: item.questId, originalDate: item.originalDate, action: 'skip', newDate: null, newStart: null, newEnd: null };
  return { type: 'setChange', localKey, change, googleUpdated: null };
}

// Google's version of a one-time or limited quest, as an updateQuest (or a
// resend when Google tried to change what kind of quest it is).
function questUpdate(what, quest, ev, localKey) {
  const slot = eventToSlot(ev);
  const text = { name: cleanTitle(ev.summary), note: cleanNote(ev.description) };
  let wanted;
  if (what === 'limited') {
    wanted = { ...text, startDate: slot.date, start: slot.start, endDate: slot.endDate || slot.date, end: slot.end };
  } else {
    // The app's own one-day quests don't become multi-day from Google.
    if (slot.endDate && !quest.endDate) return { type: 'resend', localKey, googleUpdated: ev.updated };
    wanted = { ...text, date: slot.date, start: slot.start, endDate: slot.endDate, end: slot.end, allDay: slot.allDay };
  }
  const fields = changedFields(quest, wanted);
  if (Object.keys(fields).length === 0) return { type: 'stamp', localKey, googleUpdated: ev.updated };
  return { type: 'updateQuest', localKey, id: quest.id, fields, googleUpdated: ev.updated };
}

// Google's version of a make-up: only its date and time count.
function makeupUpdate(change, ev, localKey) {
  const slot = eventToSlot(ev);
  if (slot.endDate) return { type: 'resend', localKey, googleUpdated: ev.updated };
  const moved = { newDate: slot.date, newStart: slot.start, newEnd: slot.end };
  if (Object.keys(changedFields(change, moved)).length === 0) return { type: 'stamp', localKey, googleUpdated: ev.updated };
  const { questId, originalDate } = change;
  return { type: 'setChange', localKey, change: { questId, originalDate, action: 'move', ...moved }, googleUpdated: ev.updated };
}

// Google's version of a bounty: the event ENDS at the due time.
function deadlineUpdate(deadline, ev, localKey) {
  const slot = eventToSlot(ev);
  const wanted = { name: cleanBountyTitle(ev.summary), note: cleanNote(ev.description), dueDate: slot.endDate || slot.date, dueTime: slot.end };
  const fields = changedFields(deadline, wanted);
  if (Object.keys(fields).length === 0) return { type: 'stamp', localKey, googleUpdated: ev.updated };
  return { type: 'updateDeadline', localKey, id: deadline.id, fields, googleUpdated: ev.updated };
}

// A weekly series: one-week edits become skips/make-ups (then the series
// is rebuilt clean); any edit to the whole series is reset.
function weeklyActions(quest, ev, mapping, exceptions, desiredBody) {
  const fromGoogle = exceptions.filter((ex) => isChangeMadeInGoogle(ex, desiredBody || {}));
  if (fromGoogle.length > 0) {
    const actions = fromGoogle
      .map((ex) => changeFromException(quest, ex))
      .filter(Boolean)
      .map((change) => ({ type: 'setChange', localKey: null, change, googleUpdated: null }));
    actions.push({ type: 'rebuildSeries', localKey: mapping.localKey, googleId: mapping.googleId });
    return actions;
  }
  if (ev.updated !== mapping.googleUpdated) return [{ type: 'resend', localKey: mapping.localKey, googleUpdated: ev.updated }];
  return [];
}

// Everything one ⚔ mapping needs this sync.
function mappedActions(mapping, ev, exceptions, found, desiredBody) {
  const { localKey } = mapping;
  const { what, item } = found;
  const appChanged = (item.updatedAt || null) !== (mapping.localUpdated || null);
  const gone = !ev || ev.status === 'cancelled';

  // First sync after the upgrade: nothing to compare with yet. A gone
  // event is put back rather than deleting anything in the app.
  if (mapping.googleUpdated === null) {
    return gone ? [{ type: 'forget', localKey }] : [{ type: 'stamp', localKey, googleUpdated: ev.updated }];
  }
  if (gone) {
    // Deleted in Google, but edited in the app after that: the edit wins.
    if (ev && appChanged && appIsNewer(item, ev)) return [{ type: 'forget', localKey }];
    return [deletedAction(what, item, localKey)];
  }
  if (what === 'weekly') return weeklyActions(item, ev, mapping, exceptions, desiredBody);

  if (ev.updated === mapping.googleUpdated) return []; // the push handles app edits
  if (appChanged && appIsNewer(item, ev)) return [{ type: 'resend', localKey, googleUpdated: ev.updated }];
  if (what === 'makeup') return [makeupUpdate(item, ev, localKey)];
  if (what === 'deadline') return [deadlineUpdate(item, ev, localKey)];
  return [questUpdate(what, item, ev, localKey)];
}

// ---------- events with no mapping ----------

// Events in ⚔ that no mapping points at: lost inserts of our own (they
// carry a localKey) or events the user added by hand on the phone.
function unmappedActions(appEvents, mappings) {
  const knownIds = new Set(mappings.map((m) => m.googleId));
  const takenKeys = new Set(mappings.map((m) => m.localKey));
  const actions = [];
  for (const ev of appEvents) {
    if (knownIds.has(ev.id) || ev.status === 'cancelled') continue;
    // One week of a series: it belongs to its series, never on its own
    // (it can even carry the series' localKey).
    if (ev.recurringEventId) continue;
    if (ev.localKey && takenKeys.has(ev.localKey)) {
      actions.push({ type: 'deleteEvent', calendar: 'app', googleId: ev.id }); // a duplicate
    } else if (ev.localKey) {
      takenKeys.add(ev.localKey); // a second copy of it is a duplicate
      actions.push({ type: 'adopt', localKey: ev.localKey, googleId: ev.id, googleUpdated: ev.updated });
    } else if (!ev.recurrence) { // a repeating event made by hand is left alone
      const quest = { kind: 'side', repeat: 'once', origin: null, ...eventToSlot(ev), name: cleanTitle(ev.summary) || '(no title)', note: cleanNote(ev.description) };
      actions.push({ type: 'createQuest', quest, calendar: 'app', googleId: ev.id, googleUpdated: ev.updated });
    }
  }
  return actions;
}

// ---------- the main calendar ----------

// The imported quest a main mapping points at, or null when the app no
// longer has it (then the push deletes the event, nothing to pull).
function findImported(localKey, world) {
  const [kind, idText] = localKey.split(':');
  if (kind !== 'quest') return null;
  const quest = world.quests.find((q) => q.id === Number(idText));
  return quest && quest.origin === 'google' ? quest : null;
}

// A quest's last day is before today: it is history, never compared again.
// (A multi-day quest ending at 00:00 really ends the day before; using its
// endDate only keeps it one day longer, which is harmless.)
function hasEnded(quest, today) {
  return (quest.endDate || quest.date) < today;
}

// What an event in the main calendar says a quest is: raw title and
// description (the app never decorates main events, so nothing to clean).
function mainQuestFields(ev) {
  return { name: ev.summary || '(no title)', note: ev.description || null, ...eventToSlot(ev) };
}

// Gmail bookings, out-of-office, focus time, working location...: Google
// won't let us edit these like normal events, so they stay in Google only.
// (A missing eventType counts as a normal event.)
function isSpecialEvent(ev) {
  return Boolean(ev.eventType) && ev.eventType !== 'default';
}

// Everything one main mapping needs, given its event as listed (or looked up).
function mainMappedActions(mapping, quest, ev) {
  const { localKey } = mapping;
  // Deleted or declined in Google always wins: the app never adds events
  // to the main calendar, so it can't put one back.
  if (ev.status === 'cancelled' || ev.declined) return [{ type: 'deleteQuest', localKey, id: quest.id }];
  // Turned into a repeating event (or a special one) in Google: those are
  // never touched, so the quest stays as it is but loses its link. Otherwise
  // an app edit would move the whole series.
  if (ev.recurrence || ev.recurringEventId || isSpecialEvent(ev)) return [{ type: 'unlink', localKey }];
  if (mapping.googleUpdated === null) return [{ type: 'stamp', localKey, googleUpdated: ev.updated }];
  if (ev.updated === mapping.googleUpdated) return []; // the push handles app edits

  const appChanged = (quest.updatedAt || null) !== (mapping.localUpdated || null);
  // An invitation can't be changed from the app, so Google's version always counts.
  if (!quest.googleLocked && appChanged && appIsNewer(quest, ev)) return [{ type: 'resend', localKey, googleUpdated: ev.updated }];
  const fields = changedFields(quest, mainQuestFields(ev));
  if (Object.keys(fields).length === 0) return [{ type: 'stamp', localKey, googleUpdated: ev.updated }];
  return [{ type: 'updateQuest', localKey, id: quest.id, fields, googleUpdated: ev.updated }];
}

// The main calendar's part of the plan. mainEvents only holds upcoming
// events, so a mapped event missing from it may just have moved into the
// past: it is LOOKED UP (lookups) instead of being taken as deleted.
// lookedUp holds the answers (googleId -> event, or null when it is gone).
function mainActions({ mainEvents, mappings, world, hidden, today, lookedUp }) {
  const byId = new Map(mainEvents.map((ev) => [ev.id, ev]));
  const actions = [];
  const lookups = [];
  const mainMappings = mappings.filter((m) => m.calendar === 'main');

  for (const mapping of mainMappings) {
    if (mapping.frozen) continue;
    const quest = findImported(mapping.localKey, world);
    if (!quest || hasEnded(quest, today)) continue; // gone from the app, or history
    let ev = byId.get(mapping.googleId);
    if (!ev && lookedUp && lookedUp.has(mapping.googleId)) {
      ev = lookedUp.get(mapping.googleId);
      if (ev === null) {
        actions.push({ type: 'deleteQuest', localKey: mapping.localKey, id: quest.id });
        continue;
      }
    }
    if (!ev) {
      lookups.push({ localKey: mapping.localKey, googleId: mapping.googleId });
      continue;
    }
    actions.push(...mainMappedActions(mapping, quest, ev));
  }

  // New events: everything upcoming the user hasn't declined or hidden.
  const knownIds = new Set(mainMappings.map((m) => m.googleId));
  const hiddenIds = new Set(hidden || []);
  for (const ev of mainEvents) {
    if (knownIds.has(ev.id) || hiddenIds.has(ev.id)) continue;
    if (ev.status === 'cancelled' || ev.declined) continue;
    if (ev.recurrence || ev.recurringEventId) continue; // repeating events stay in Google only
    if (isSpecialEvent(ev)) continue;
    const fields = mainQuestFields(ev);
    if ((fields.endDate || fields.date) < today) continue; // past events never come in
    const quest = { kind: 'side', repeat: 'once', origin: 'google', googleLocked: !ev.organizerSelf, ...fields };
    actions.push({ type: 'createQuest', quest, calendar: 'main', googleId: ev.id, googleUpdated: ev.updated });
  }
  return { actions, lookups };
}

// ---------- the planner ----------

// The weekly series bodies the app would push now, to tell weeks the app
// left out (EXDATE) from weeks deleted in Google. Reminders don't matter
// here, so no real settings are needed.
function desiredBodiesByKey(world) {
  return new Map(buildDesiredEvents(world, { leadMinutes: 0 }).map((d) => [d.localKey, d.body]));
}

// mainEvents is null when main-calendar sync is off; hidden, today and
// lookedUp (optional) are only used for the main calendar.
function planPull({ appEvents, mainEvents, mappings, world, deadlines, hidden, today, lookedUp }) {
  const series = new Map(); // googleId -> the series event (or a single event)
  const exceptionsOf = new Map(); // series googleId -> its one-week exceptions
  for (const ev of appEvents) {
    if (!ev.recurringEventId) series.set(ev.id, ev);
    else exceptionsOf.set(ev.recurringEventId, (exceptionsOf.get(ev.recurringEventId) || []).concat(ev));
  }
  const desired = desiredBodiesByKey(world);

  const actions = [];
  for (const mapping of mappings) {
    if (mapping.frozen || mapping.calendar === 'main') continue; // archived, or main calendar
    const found = findItem(mapping.localKey, world, deadlines);
    if (!found) continue; // the app deleted it: the push deletes the event
    const exceptions = exceptionsOf.get(mapping.googleId) || [];
    actions.push(...mappedActions(mapping, series.get(mapping.googleId), exceptions, found, desired.get(mapping.localKey)));
  }
  actions.push(...unmappedActions(appEvents, mappings));
  if (mainEvents === null) return { actions, lookups: [] };
  const main = mainActions({ mainEvents, mappings, world, hidden, today, lookedUp });
  return { actions: actions.concat(main.actions), lookups: main.lookups };
}

// True for actions that remove something from the app (the safety rule
// holds back more than 5 of these in one sync).
function isDeletion(action) {
  if (action.type === 'deleteQuest' || action.type === 'deleteDeadline') return true;
  return action.type === 'setChange' && Boolean(action.localKey) && action.localKey.startsWith('makeup:') && action.change.action === 'skip';
}

module.exports = { planPull, isDeletion, isChangeMadeInGoogle, excludedStamps };
