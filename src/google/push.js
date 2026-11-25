// The push half of a sync (sync.js runs the whole thing).
//
// Each push:
//   1. makes sure the "⚔ every tracker u need, well i think" calendar exists,
//   2. works out what Google SHOULD contain (payloads.js),
//   3. compares that with what we pushed last time (the mappings table),
//   4. sends only the differences.
// Each mapping is saved right after its API call succeeds, so if the
// network drops halfway, the next sync simply finishes the job.

const { hashBody, CALENDAR_NAME, TIMEZONE } = require('./payloads');

// "Not found" (404) or "gone" (410): the thing was deleted on Google's side.
function isGone(err) {
  return Boolean(err) && (err.code === 404 || err.code === 410);
}

// Compares desired events with the mappings from the last push.
// Frozen mappings (archived semesters) are left completely alone.
function planPush(desired, mappings) {
  const live = mappings.filter((m) => !m.frozen);
  const frozenKeys = new Set(mappings.filter((m) => m.frozen).map((m) => m.localKey));
  const byKey = new Map(live.map((m) => [m.localKey, m]));
  const desiredKeys = new Set(desired.map((d) => d.localKey));

  const creates = [];
  const updates = [];
  for (const item of desired) {
    if (frozenKeys.has(item.localKey)) continue;
    const mapping = byKey.get(item.localKey);
    if (!mapping) creates.push(item);
    else if (mapping.hash !== hashBody(item.body)) updates.push({ desired: item, googleId: mapping.googleId });
  }
  const deletes = live
    .filter((m) => !desiredKeys.has(m.localKey))
    .map((m) => ({ localKey: m.localKey, googleId: m.googleId }));
  return { creates, updates, deletes };
}

// Returns the calendar id to push into, creating the calendar when it
// doesn't exist yet or was deleted in Google.
async function ensureCalendar(api, store) {
  const storedId = store.getSettings().googleCalendarId;
  if (storedId) {
    try {
      await api.getCalendar(storedId);
      return storedId;
    } catch (err) {
      if (!isGone(err)) throw err;
    }
  }
  const id = await api.createCalendar({ summary: CALENDAR_NAME, timeZone: TIMEZONE });
  store.setSettings({ googleCalendarId: id });
  // A brand-new calendar is empty, so the old ⚔ mappings point at nothing.
  // Main-calendar mappings stay: those events are still there.
  store.clearMappings({ calendar: 'app' });
  return id;
}

// The `updatedAt` of the app item a localKey points at (null when it is
// gone). Saved in the mapping, so the next sync can tell whether the app
// changed the item since.
function localUpdatedOf(store, localKey) {
  const [kind, idText] = localKey.split(':');
  const id = Number(idText);
  let item = null;
  if (kind === 'quest') item = store.getQuest(id);
  else if (kind === 'makeup') item = store.getChange(id);
  else if (kind === 'deadline') item = store.getDeadline(id);
  return item ? item.updatedAt : null;
}

// Remembers what we just sent: its fingerprint, Google's `updated` stamp
// and the item's own stamp, so the next sync sees nothing changed.
function saveSent(store, localKey, googleId, body, googleUpdated) {
  store.upsertMapping({ localKey, googleId, hash: hashBody(body), calendar: 'app', googleUpdated, localUpdated: localUpdatedOf(store, localKey) });
}

async function applyPlan(api, store, calId, plan, counts) {
  for (const del of plan.deletes) {
    try {
      await api.deleteEvent(calId, del.googleId);
    } catch (err) {
      if (!isGone(err)) throw err; // already gone in Google: fine
    }
    store.deleteMapping(del.localKey);
    counts.deleted += 1;
  }
  for (const upd of plan.updates) {
    const { localKey, body } = upd.desired;
    let googleId = upd.googleId;
    let written;
    try {
      written = await api.updateEvent(calId, googleId, body);
    } catch (err) {
      if (!isGone(err)) throw err;
      // Someone deleted it in Google for good: put it back.
      written = await api.insertEvent(calId, body);
      googleId = written.id;
    }
    saveSent(store, localKey, googleId, body, written.updated);
    counts.updated += 1;
  }
  for (const item of plan.creates) {
    const written = await api.insertEvent(calId, item.body);
    saveSent(store, item.localKey, written.id, item.body, written.updated);
    counts.created += 1;
  }
}

module.exports = { planPush, applyPlan, ensureCalendar, isGone, localUpdatedOf };
