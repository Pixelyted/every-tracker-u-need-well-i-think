// One-way push to Google Calendar.
//
// The app is the source of truth. Each push:
//   1. makes sure the "⚔ every tracker u need, well i think" calendar exists,
//   2. works out what Google SHOULD contain (payloads.js),
//   3. compares that with what we pushed last time (the mappings table),
//   4. sends only the differences.
// Each mapping is saved right after its API call succeeds, so if the
// network drops halfway, the next push simply finishes the job. Local data
// is never touched by a failed push.

const { buildDesiredEvents, hashBody, CALENDAR_NAME, TIMEZONE } = require('./payloads');

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
  // A brand-new calendar is empty, so the old mappings point at nothing.
  store.clearMappings();
  return id;
}

// The weeks a weekly series leaves out on purpose (its EXDATE line), as
// stamps like '20261130T070000' in Jakarta time.
function excludedStamps(body) {
  const line = (body.recurrence || []).find((r) => r.startsWith('EXDATE'));
  return new Set(line ? line.split(':')[1].split(',') : []);
}

// Any moment from Google ('2026-11-30T00:00:00Z', or with +07:00) as a
// Jakarta-time stamp like '20261130T070000'.
const jakartaFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function jakartaStamp(dateTime) {
  return jakartaFormat.format(new Date(dateTime)).replace(/[-:]/g, '').replace(' ', 'T');
}

// True when a one-week "exception" of a series is something the user did
// in Google (deleted or edited that week), not a week the app itself left
// out of the series.
function isChangeMadeInGoogle(exception, desiredBody) {
  if (exception.status !== 'cancelled') return true; // that week was edited
  const start = exception.originalStartTime && exception.originalStartTime.dateTime;
  return !start || !excludedStamps(desiredBody).has(jakartaStamp(start));
}

// Makes our records match what is really in the app's OWN calendar (this
// only ever reads the "⚔ every tracker u need, well i think" calendar):
//   - an event someone deleted in Google by hand: forget its mapping, so
//     this push creates it again;
//   - ONE week of a weekly series deleted or edited in Google: Google keeps
//     the series and stores that week separately as an "exception" (it has
//     a recurringEventId). We delete the whole series and forget it, so
//     this push creates a clean copy of it;
//   - an event Google has but we have no record of (an insert whose answer
//     got lost on a bad connection, or the app quit mid-push): delete it,
//     otherwise the next insert would leave a duplicate forever.
// Events of archived semesters (frozen mappings) are always left alone.
async function reconcileWithGoogle(api, store, calId, desired) {
  if (typeof api.listEvents !== 'function') return;
  const alive = new Set();
  const exceptions = [];
  for (const ev of await api.listEvents(calId)) {
    if (ev.recurringEventId) exceptions.push(ev);
    else if (ev.status !== 'cancelled') alive.add(ev.id);
  }
  const desiredByKey = new Map(desired.map((d) => [d.localKey, d]));
  const mappings = store.listMappings();
  for (const mapping of mappings) {
    if (mapping.frozen) continue;
    if (!alive.has(mapping.googleId)) {
      store.deleteMapping(mapping.localKey);
      continue;
    }
    const item = desiredByKey.get(mapping.localKey);
    if (!item) continue; // not wanted any more: the plan deletes it anyway
    const changedInGoogle = exceptions.some((ex) => ex.recurringEventId === mapping.googleId && isChangeMadeInGoogle(ex, item.body));
    if (changedInGoogle) {
      try {
        await api.deleteEvent(calId, mapping.googleId);
      } catch (err) {
        if (!isGone(err)) throw err;
      }
      store.deleteMapping(mapping.localKey);
    }
  }
  // Exceptions are never in `alive`, so this never deletes a single week.
  const known = new Set(mappings.map((m) => m.googleId));
  for (const id of alive) {
    if (known.has(id)) continue;
    try {
      await api.deleteEvent(calId, id);
    } catch (err) {
      if (!isGone(err)) throw err;
    }
  }
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
    try {
      await api.updateEvent(calId, googleId, body);
    } catch (err) {
      if (!isGone(err)) throw err;
      // Someone deleted it in Google: put it back.
      googleId = await api.insertEvent(calId, body);
    }
    store.upsertMapping({ localKey, googleId, hash: hashBody(body) });
    counts.updated += 1;
  }
  for (const item of plan.creates) {
    const googleId = await api.insertEvent(calId, item.body);
    store.upsertMapping({ localKey: item.localKey, googleId, hash: hashBody(item.body) });
    counts.created += 1;
  }
}

function errorText(err) {
  if (err && err.message) return err.message;
  if (err && err.code) return 'error ' + err.code;
  return String(err);
}

async function runPush({ api, store }) {
  const counts = { created: 0, updated: 0, deleted: 0 };
  let result;
  try {
    const calId = await ensureCalendar(api, store);
    const desired = buildDesiredEvents(store.getWorld(), store.getSettings(), store.listDeadlines());
    await reconcileWithGoogle(api, store, calId, desired);
    const plan = planPush(desired, store.listMappings());
    await applyPlan(api, store, calId, plan, counts);
    result = { ok: true, authExpired: false, counts };
  } catch (err) {
    // authExpired: Google no longer accepts the saved sign-in (for an app in
    // "Testing" mode that happens every 7 days). Retrying won't help; the
    // user has to reconnect in Settings.
    result = { ok: false, error: errorText(err), authExpired: Boolean(err && err.authExpired), counts };
  }
  store.setSettings({
    lastPush: { at: new Date().toISOString(), ok: result.ok, error: result.error || null, authExpired: result.authExpired },
  });
  return result;
}

module.exports = { planPush, runPush };
