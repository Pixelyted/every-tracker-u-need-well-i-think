// Two-way Google Calendar sync: first pull, then push.
//
// One sync:
//   1. makes sure the ⚔ calendar exists (push.js),
//   2. lists what Google has: the ⚔ calendar, and the user's main calendar
//      when that is switched on,
//   3. works out what Google's changes mean for the app (pull.js),
//   4. holds back a suspicious number of deletions,
//   5. applies the changes to the app,
//   6. pushes the app's own changes to ⚔, then to the main calendar.
// A failing list call (step 2) stops everything before the app is touched.
// After that, each change is saved on its own together with its mapping,
// so a sync cut off halfway just carries on next time.

const { buildDesiredEvents, buildMainBodies, hashBody } = require('./payloads');
const { planPull, isDeletion } = require('./pull');
const { planPush, applyPlan, ensureCalendar, isGone, localUpdatedOf } = require('./push');
const { jakartaToday } = require('./event-time');

// More Google-caused deletions than this in one sync are held back.
const MAX_DELETES = 5;

// Kinds of action that change the app's own data (counted as "pulled").
const APP_CHANGES = ['createQuest', 'updateQuest', 'deleteQuest', 'setChange', 'updateDeadline', 'deleteDeadline'];

// ---------- step 2: list ----------

// Everything Google has. mainEvents is null when main sync is off.
async function listGoogle(api, calId, mainOn, today) {
  const appEvents = await api.listEvents(calId);
  // The main calendar is only read from today 00:00 (Jakarta) on.
  const mainEvents = mainOn ? await api.listMainEvents(`${today}T00:00:00+07:00`) : null;
  return { appEvents, mainEvents };
}

// ---------- step 3: plan ----------

// An event fetched on its own; null when Google says it is gone.
async function lookUp(api, googleId) {
  try {
    return await api.getEvent('primary', googleId);
  } catch (err) {
    if (isGone(err)) return null;
    throw err;
  }
}

// The pull plan. Imported quests whose event wasn't listed (it may have
// moved into the past) are looked up one by one, then planned again.
async function planChanges(api, store, listed, today) {
  const input = {
    ...listed,
    mappings: store.listMappings(),
    world: store.getWorld(),
    deadlines: store.listDeadlines(),
    hidden: store.listHiddenGoogleEvents(),
    today,
  };
  const first = planPull(input);
  if (first.lookups.length === 0) return first.actions;
  const lookedUp = new Map();
  for (const { googleId } of first.lookups) lookedUp.set(googleId, await lookUp(api, googleId));
  return planPull({ ...input, lookedUp }).actions;
}

// ---------- step 4: the safety rule ----------

// Too many deletions at once is more likely a mistake (or a Google hiccup)
// than the user's wish: drop them all. Their mappings stay as they are, so
// the next sync plans them again (and "Sync now" can allow them).
// heldKeys: the items held back, which the push must leave alone too (an
// app edit would otherwise bring back the event Google deleted).
function holdManyDeletes(actions, allowManyDeletes) {
  const deletions = actions.filter(isDeletion);
  if (deletions.length <= MAX_DELETES || allowManyDeletes) return { actions, heldDeletes: null, heldKeys: new Set() };
  return {
    actions: actions.filter((a) => !isDeletion(a)),
    heldDeletes: deletions.length,
    heldKeys: new Set(deletions.map((a) => a.localKey)),
  };
}

// ---------- step 5: apply ----------

// The fingerprint of what the main-calendar push would send for a quest,
// so a quest just copied FROM Google isn't patched straight back.
function mainHash(store, questId, today) {
  const found = buildMainBodies(store.getWorld(), today).find((b) => b.localKey === 'quest:' + questId);
  return found ? hashBody(found.body) : null;
}

// Changes some fields of a saved mapping, keeping the rest.
function updateMapping(store, localKey, fields) {
  const mapping = store.listMappings().find((m) => m.localKey === localKey);
  if (mapping) store.upsertMapping({ ...mapping, ...fields });
}

// After an app item took over Google's version: remember both stamps, so
// the next sync sees neither side as changed.
function stampBoth(store, localKey, googleUpdated, extra = {}) {
  updateMapping(store, localKey, { googleUpdated, localUpdated: localUpdatedOf(store, localKey), ...extra });
}

// Deletes an event in Google; one that is already gone is fine.
async function deleteInGoogle(api, calId, googleId) {
  try {
    await api.deleteEvent(calId, googleId);
  } catch (err) {
    if (!isGone(err)) throw err;
  }
}

async function applyAction(api, store, calId, today, action) {
  const { localKey, googleUpdated } = action;
  switch (action.type) {
    case 'createQuest': {
      const id = store.saveQuest(action.quest);
      const key = 'quest:' + id;
      // hash null: the push sends ⚔ events again in the app's own style.
      const hash = action.calendar === 'main' ? mainHash(store, id, today) : null;
      store.upsertMapping({ localKey: key, googleId: action.googleId, hash, calendar: action.calendar, googleUpdated, localUpdated: localUpdatedOf(store, key) });
      break;
    }
    case 'updateQuest': {
      const quest = store.getQuest(action.id);
      store.saveQuest({ ...quest, ...action.fields });
      const extra = quest.origin === 'google' ? { hash: mainHash(store, action.id, today) } : {};
      stampBoth(store, localKey, googleUpdated, extra);
      break;
    }
    case 'updateDeadline':
      store.saveDeadline({ ...store.getDeadline(action.id), ...action.fields });
      stampBoth(store, localKey, googleUpdated);
      break;
    case 'setChange':
      store.setChange(action.change);
      // localKey null: a new skip/move from one week of a series, no event of its own yet.
      if (localKey) stampBoth(store, localKey, googleUpdated);
      break;
    // Gone in Google: the mapping goes too, so the push doesn't try to
    // delete the event again (or, for the main calendar, a declined one).
    case 'deleteQuest':
      store.deleteQuest(action.id); // reads the mapping first (to hide invitations)
      store.deleteMapping(localKey);
      break;
    case 'deleteDeadline':
      store.deleteDeadline(action.id);
      store.deleteMapping(localKey);
      break;
    case 'stamp':
      updateMapping(store, localKey, { googleUpdated });
      break;
    case 'resend': // hash null: the push sends the app's version again
      updateMapping(store, localKey, { hash: null, googleUpdated });
      break;
    case 'forget':
      store.deleteMapping(localKey);
      break;
    // A main event Google turned into something we never touch (a series,
    // a Gmail booking...): the quest stays, only the link to it goes.
    case 'unlink':
      store.deleteMapping(localKey);
      break;
    case 'adopt': // our own lost insert: link it, the push brings it up to date
      store.upsertMapping({ localKey, googleId: action.googleId, hash: null, calendar: 'app', googleUpdated, localUpdated: localUpdatedOf(store, localKey) });
      break;
    case 'rebuildSeries': // any error but "gone" fails the sync
      await deleteInGoogle(api, calId, action.googleId);
      store.deleteMapping(localKey);
      break;
    case 'deleteEvent':
      // Only a duplicate of our own in ⚔. An event in the user's main
      // calendar without a mapping must never be deleted.
      if (action.calendar !== 'app') throw new Error('Refusing to delete an unmapped event outside the ⚔ calendar');
      await deleteInGoogle(api, calId, action.googleId);
      break;
    default:
      throw new Error('Unknown sync action: ' + action.type);
  }
}

// One by one, in order: saveQuest and deleteQuest use their own
// transactions, so this can't be one big transaction.
async function applyActions(api, store, calId, today, actions, counts) {
  for (const action of actions) {
    await applyAction(api, store, calId, today, action);
    if (APP_CHANGES.includes(action.type)) counts.pulled += 1;
  }
}

// ---------- step 6: push ----------

// heldKeys are skipped on both sides, so they are neither updated,
// re-created nor deleted until the deletions are allowed.
async function pushApp(api, store, calId, heldKeys, counts) {
  const desired = buildDesiredEvents(store.getWorld(), store.getSettings(), store.listDeadlines())
    .filter((d) => !heldKeys.has(d.localKey));
  const mappings = store.listMappings().filter((m) => m.calendar === 'app' && !heldKeys.has(m.localKey));
  await applyPlan(api, store, calId, planPush(desired, mappings), counts);
}

// The 403 reasons that mean "never for this event" (a Gmail booking, or
// someone else's event we may not edit).
const REFUSED_REASONS = ['forbidden', 'forbiddenForNonOrganizer', 'invalid', 'badRequest'];

// True when Google refuses to change ONE event for good. Trying again
// won't help, so that event is skipped instead of failing every sync.
// Other 403s (rate limits, quota, missing permission) fail the sync as
// usual: they are worth retrying later.
function isRefused(err) {
  if (!err) return false;
  if (err.code === 400) return true;
  return err.code === 403 && REFUSED_REASONS.includes(err.reason);
}

// The main calendar only ever gets patches of title, note and time for
// imported quests edited here, and deletes of imported quests deleted here.
async function pushMain(api, store, today, heldKeys, counts) {
  const bodies = new Map(buildMainBodies(store.getWorld(), today).map((b) => [b.localKey, b.body]));
  const hidden = new Set(store.listHiddenGoogleEvents());
  const mappings = store.listMappings().filter((m) => m.calendar === 'main' && !m.frozen && !heldKeys.has(m.localKey));
  for (const mapping of mappings) {
    const { localKey, googleId } = mapping;
    if (!store.getQuest(Number(localKey.split(':')[1]))) {
      // Deleted here. An invitation is only hidden: it isn't ours to delete.
      if (!hidden.has(googleId)) {
        try {
          await deleteInGoogle(api, 'primary', googleId);
          counts.deleted += 1;
        } catch (err) {
          if (!isRefused(err)) throw err;
          console.log(`[google] main calendar refused to delete ${googleId}: ${err.message}`);
          // It stays in Google: hide it, or the next pull would import it again.
          store.hideGoogleEvent(googleId);
        }
      }
      store.deleteMapping(localKey);
      continue;
    }
    const body = bodies.get(localKey); // none for invitations and past quests
    if (!body || mapping.hash === hashBody(body)) continue;
    let written;
    try {
      written = await api.patchEvent('primary', googleId, body);
    } catch (err) {
      if (isGone(err)) continue; // deleted in Google meanwhile: the next pull removes the quest
      if (!isRefused(err)) throw err;
      // Remember this version as "sent" so it isn't tried again every run.
      console.log(`[google] main calendar refused to change ${googleId}: ${err.message}`);
      store.upsertMapping({ ...mapping, hash: hashBody(body), localUpdated: localUpdatedOf(store, localKey) });
      continue;
    }
    store.upsertMapping({ ...mapping, hash: hashBody(body), googleUpdated: written.updated, localUpdated: localUpdatedOf(store, localKey) });
    counts.updated += 1;
  }
}

// ---------- the whole run ----------

function errorText(err) {
  if (err && err.message) return err.message;
  if (err && err.code) return 'error ' + err.code;
  return String(err);
}

// mainSync: true/false forces the main calendar on/off for this run;
// undefined follows the googleMainSync setting.
async function runSync({ api, store, now = new Date(), allowManyDeletes = false, mainSync }) {
  const counts = { created: 0, updated: 0, deleted: 0, pulled: 0 };
  let heldDeletes = null;
  let result;
  try {
    const calId = await ensureCalendar(api, store);
    const today = jakartaToday(now);
    const wanted = mainSync === undefined ? store.getSettings().googleMainSync : mainSync;
    const mainOn = Boolean(wanted) && typeof api.listMainEvents === 'function';
    const listed = await listGoogle(api, calId, mainOn, today);
    const planned = await planChanges(api, store, listed, today);
    const safe = holdManyDeletes(planned, allowManyDeletes);
    heldDeletes = safe.heldDeletes;
    await applyActions(api, store, calId, today, safe.actions, counts);
    await pushApp(api, store, calId, safe.heldKeys, counts);
    if (mainOn) await pushMain(api, store, today, safe.heldKeys, counts);
    result = { ok: true, error: null, authExpired: false, counts, heldDeletes };
  } catch (err) {
    // authExpired: Google no longer accepts the saved sign-in (for an app in
    // "Testing" mode that happens every 7 days). Retrying won't help; the
    // user has to reconnect in Settings.
    result = { ok: false, error: errorText(err), authExpired: Boolean(err && err.authExpired), counts, heldDeletes };
  }
  // Still called lastPush, so the Settings screen keeps finding it.
  store.setSettings({
    lastPush: { at: new Date().toISOString(), ok: result.ok, error: result.error, authExpired: result.authExpired, heldDeletes: result.heldDeletes },
  });
  return result;
}

module.exports = { runSync, applyAction };
