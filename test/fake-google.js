// An in-memory stand-in for the Google Calendar API (src/google/api.js).
// It keeps real calendars and events, records every call and can be told
// to fail. Events are stored in the normalized shape api.js hands over.

// Turns a body we send (insert/update/patch) into a stored event.
function toEvent(id, body, updated) {
  const priv = body.extendedProperties && body.extendedProperties.private;
  return {
    id, status: 'confirmed', updated,
    summary: body.summary, description: body.description || '',
    start: body.start, end: body.end,
    recurrence: body.recurrence, recurringEventId: undefined, originalStartTime: undefined,
    localKey: (priv && priv.localKey) || null,
    organizerSelf: true, declined: false, eventType: 'default',
  };
}

function fakeGoogle() {
  let nextId = 1;
  let clock = 0;
  const api = {
    calendars: new Map([['primary', new Map()]]), // calId -> Map(eventId -> event)
    calls: [],
    failInsertAt: null, // throw {code:500} on this insert number (1-based)
    insertCount: 0,
    failList: null, // 'listEvents' or 'listMainEvents': that call throws {code:500}
    failWrite: new Map(), // eventId -> error: patch/delete of that event throws it

    // Google's `updated` stamps: strictly increasing, one second apart.
    stamp() {
      clock += 1;
      return new Date(Date.UTC(2026, 0, 1) + clock * 1000).toISOString();
    },

    // The events of one calendar (a test can change them directly).
    eventsOf(calId) {
      return api.calendars.get(calId);
    },
    // How many events in a calendar are not deleted.
    liveCount(calId) {
      return [...api.calendars.get(calId).values()].filter((ev) => ev.status !== 'cancelled').length;
    },
    // Adds an event "made on the phone" and returns it.
    addEvent(calId, fields) {
      const id = 'ph' + nextId++;
      const ev = { ...toEvent(id, { summary: '', start: null, end: null }, api.stamp()), ...fields, id };
      api.calendars.get(calId).set(id, ev);
      return ev;
    },
    // An edit made in Google: changes fields and gives a new `updated`.
    editInGoogle(calId, eventId, fields) {
      const ev = api.calendars.get(calId).get(eventId);
      Object.assign(ev, fields, { updated: api.stamp() });
    },

    async getCalendar(id) {
      api.calls.push(['getCalendar', id]);
      if (!api.calendars.has(id)) throw { code: 404 };
      return { id };
    },
    async createCalendar(body) {
      api.calls.push(['createCalendar', body]);
      const id = 'cal' + nextId++;
      api.calendars.set(id, new Map());
      return id;
    },
    async insertEvent(calId, body) {
      api.calls.push(['insertEvent', calId]);
      api.insertCount += 1;
      if (api.insertCount === api.failInsertAt) throw { code: 500, message: 'boom' };
      const id = 'ev' + nextId++;
      const ev = toEvent(id, body, api.stamp());
      api.calendars.get(calId).set(id, ev);
      return { id, updated: ev.updated };
    },
    async updateEvent(calId, eventId, body) {
      api.calls.push(['updateEvent', calId, eventId]);
      const events = api.calendars.get(calId);
      if (!events.has(eventId)) throw { code: 404 };
      const ev = toEvent(eventId, body, api.stamp()); // status 'confirmed' brings it back
      events.set(eventId, ev);
      return { updated: ev.updated };
    },
    async patchEvent(calId, eventId, body) {
      api.calls.push(['patchEvent', calId, eventId, body]);
      if (api.failWrite.has(eventId)) throw api.failWrite.get(eventId);
      const ev = api.calendars.get(calId).get(eventId);
      if (!ev || ev.status === 'cancelled') throw { code: 404 };
      Object.assign(ev, body, { updated: api.stamp() });
      return { updated: ev.updated };
    },
    // Like Google: a deleted event stays listed as 'cancelled'.
    async deleteEvent(calId, eventId) {
      api.calls.push(['deleteEvent', calId, eventId]);
      if (api.failWrite.has(eventId)) throw api.failWrite.get(eventId);
      const ev = api.calendars.get(calId).get(eventId);
      if (!ev || ev.status === 'cancelled') throw { code: 410 };
      ev.status = 'cancelled';
      ev.updated = api.stamp();
    },
    async getEvent(calId, eventId) {
      api.calls.push(['getEvent', calId, eventId]);
      const ev = api.calendars.get(calId).get(eventId);
      if (!ev) throw { code: 404 };
      return structuredClone(ev);
    },
    async listEvents(calId) {
      api.calls.push(['listEvents', calId]);
      if (api.failList === 'listEvents') throw { code: 500, message: 'boom' };
      if (!api.calendars.has(calId)) throw { code: 404 };
      return [...api.calendars.get(calId).values()].map((ev) => structuredClone(ev));
    },
    // Only events that end at or after timeMin, like the real call.
    async listMainEvents(timeMinIso) {
      api.calls.push(['listMainEvents', timeMinIso]);
      if (api.failList === 'listMainEvents') throw { code: 500, message: 'boom' };
      const from = new Date(timeMinIso);
      return [...api.calendars.get('primary').values()]
        .filter((ev) => new Date(ev.end.dateTime || ev.end.date) >= from)
        .map((ev) => structuredClone(ev));
    },
  };
  return api;
}

// The calls that write to Google.
function writeCalls(api) {
  return api.calls.filter(([name]) => ['insertEvent', 'updateEvent', 'patchEvent', 'deleteEvent'].includes(name));
}

module.exports = { fakeGoogle, writeCalls };
