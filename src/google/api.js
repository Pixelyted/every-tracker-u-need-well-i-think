// The real Google Calendar API, wrapped in the small interface push.js
// uses (getCalendar, createCalendar, insertEvent, updateEvent, deleteEvent,
// listEvents). Every error is turned into { code, message, authExpired }.

// Turns any error from the Google libraries into a simple shape:
//   code         HTTP status (404, 410, 500...) or 0 for network problems
//   authExpired  true when the saved sign-in no longer works
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

// `calendarClient` can be passed in by tests; normally it's built from
// @googleapis/calendar with the signed-in auth client.
function createApi(authClient, { calendarClient } = {}) {
  const cal = calendarClient || require('@googleapis/calendar').calendar({ version: 'v3', auth: authClient });

  return {
    getCalendar: (id) => call(async () => ({ id: (await cal.calendars.get({ calendarId: id })).data.id })),
    createCalendar: ({ summary, timeZone }) => call(async () => (await cal.calendars.insert({ requestBody: { summary, timeZone } })).data.id),
    insertEvent: (calId, body) => call(async () => (await cal.events.insert({ calendarId: calId, requestBody: body })).data.id),
    // status 'confirmed' brings back an event someone deleted in Google.
    updateEvent: (calId, eventId, body) => call(() => cal.events.update({ calendarId: calId, eventId, requestBody: { ...body, status: 'confirmed' } })),
    deleteEvent: (calId, eventId) => call(() => cal.events.delete({ calendarId: calId, eventId })),
    // Every event in OUR calendar (deleted ones included): id and status,
    // plus, for one week of a series changed in Google, the series' id
    // (recurringEventId) and that week's original start.
    listEvents: (calId) => call(async () => {
      const events = [];
      let pageToken;
      do {
        const res = await cal.events.list({
          calendarId: calId, showDeleted: true, maxResults: 2500, pageToken,
          fields: 'items(id,status,recurringEventId,originalStartTime),nextPageToken',
        });
        for (const item of res.data.items || []) {
          events.push({ id: item.id, status: item.status, recurringEventId: item.recurringEventId, originalStartTime: item.originalStartTime });
        }
        pageToken = res.data.nextPageToken;
      } while (pageToken);
      return events;
    }),
  };
}

module.exports = { toApiError, createApi };
