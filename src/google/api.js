// The real Google Calendar API, wrapped in the small interface push.js
// uses (getCalendar, createCalendar, insertEvent, updateEvent, deleteEvent,
// listEvents, patchEvent, getEvent, listMainEvents). Every error is turned into { code, message, authExpired }.

// Turns any error from the Google libraries into a simple shape:
//   code         HTTP status (404, 410, 500...) or 0 for network problems
//   authExpired  true when the saved sign-in no longer works
//   reason       Google's own word for what went wrong ('forbidden',
//                'rateLimitExceeded'...), or null when it gave none
function toApiError(err) {
  const status = (err && err.response && err.response.status) || (err && typeof err.status === 'number' && err.status) || 0;
  const data = (err && err.response && err.response.data) || {};
  const message = (err && err.message) || String(err);
  // invalid_grant: the refresh token expired (every 7 days in Testing mode)
  // or was revoked. 401: Google rejected the credentials.
  const authExpired = data.error === 'invalid_grant'
    || /invalid_grant|No refresh token/i.test(message)
    || status === 401;
  const result = new Error(status === 0 && !authExpired ? `${message} (offline?)` : message);
  result.code = authExpired ? 401 : status;
  result.authExpired = authExpired;
  const details = data.error && Array.isArray(data.error.errors) ? data.error.errors[0] : null;
  result.reason = (details && details.reason) || null;
  return result;
}

// Runs one API call and converts its error.
async function call(fn) {
  try {
    return await fn();
  } catch (err) {
    throw toApiError(err);
  }
}

// The event fields we ask Google for (smaller answers than the full event).
const EVENT_FIELDS = 'id,status,updated,summary,description,start,end,recurrence,recurringEventId,originalStartTime,extendedProperties/private/localKey,organizer/self,attendees(self,responseStatus),eventType';

// Google's event -> the plain shape the sync code works with.
function normalizeEvent(item) {
  const attendees = item.attendees || [];
  return {
    id: item.id,
    status: item.status,
    updated: item.updated,
    summary: item.summary,
    description: item.description || '',
    start: item.start,
    end: item.end,
    recurrence: item.recurrence,
    recurringEventId: item.recurringEventId,
    originalStartTime: item.originalStartTime,
    localKey: (item.extendedProperties && item.extendedProperties.private && item.extendedProperties.private.localKey) || null,
    // Missing means the event is on our own calendar: treat as ours.
    organizerSelf: item.organizer && typeof item.organizer.self === 'boolean' ? item.organizer.self : true,
    declined: attendees.some((a) => a.self === true && a.responseStatus === 'declined'),
    // 'default' for normal events; others (Gmail bookings, out of office,
    // focus time...) can't be edited like normal ones, so the sync skips them.
    eventType: item.eventType || 'default',
  };
}

// `calendarClient` can be passed in by tests; normally it's built from
// @googleapis/calendar with the signed-in auth client.
function createApi(authClient, { calendarClient } = {}) {
  const cal = calendarClient || require('@googleapis/calendar').calendar({ version: 'v3', auth: authClient });

  // Lists every page of events for the given list parameters.
  async function listAll(params) {
    const events = [];
    let pageToken;
    do {
      const res = await cal.events.list({
        ...params, maxResults: 2500, pageToken,
        fields: `items(${EVENT_FIELDS}),nextPageToken`,
      });
      for (const item of res.data.items || []) events.push(normalizeEvent(item));
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    return events;
  }

  return {
    getCalendar: (id) => call(async () => ({ id: (await cal.calendars.get({ calendarId: id })).data.id })),
    createCalendar: ({ summary, timeZone }) => call(async () => (await cal.calendars.insert({ requestBody: { summary, timeZone } })).data.id),
    // insert/update/patch answer with Google's `updated` stamp, so the sync
    // can later tell its own writes apart from edits made in Google.
    insertEvent: (calId, body) => call(async () => {
      const { data } = await cal.events.insert({ calendarId: calId, requestBody: body });
      return { id: data.id, updated: data.updated };
    }),
    // status 'confirmed' brings back an event someone deleted in Google
    // (only for ⚔ events; main-calendar events use patchEvent).
    updateEvent: (calId, eventId, body) => call(async () => {
      const { data } = await cal.events.update({ calendarId: calId, eventId, requestBody: { ...body, status: 'confirmed' } });
      return { updated: data.updated };
    }),
    // Changes only the fields in `body`; everything else stays as it is.
    patchEvent: (calId, eventId, body) => call(async () => {
      const { data } = await cal.events.patch({ calendarId: calId, eventId, requestBody: body });
      return { updated: data.updated };
    }),
    deleteEvent: (calId, eventId) => call(() => cal.events.delete({ calendarId: calId, eventId })),
    getEvent: (calId, eventId) => call(async () => normalizeEvent((await cal.events.get({ calendarId: calId, eventId, fields: EVENT_FIELDS })).data)),
    // Every event in OUR calendar (deleted ones included).
    listEvents: (calId) => call(() => listAll({ calendarId: calId, showDeleted: true })),
    // The main calendar: series stay as one event (singleEvents false), and
    // deleted ones are included so we notice removals.
    listMainEvents: (timeMinIso) => call(() => listAll({ calendarId: 'primary', showDeleted: true, singleEvents: false, timeMin: timeMinIso })),
  };
}

module.exports = { toApiError, createApi };
