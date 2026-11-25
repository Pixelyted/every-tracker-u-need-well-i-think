const test = require('node:test');
const assert = require('node:assert/strict');
const { toApiError, createApi } = require('../src/google/api');

test('HTTP errors keep their status code', () => {
  assert.equal(toApiError({ response: { status: 404 }, message: 'Not Found' }).code, 404);
  assert.equal(toApiError({ status: 410, message: 'Gone' }).code, 410);
  assert.equal(toApiError({ response: { status: 404 } }).authExpired, false);
});

test('errors keep Google\'s reason (null when there is none)', () => {
  const data = { error: { code: 403, message: 'Forbidden', errors: [{ domain: 'global', reason: 'forbiddenForNonOrganizer' }] } };
  assert.equal(toApiError({ response: { status: 403, data }, message: 'Forbidden' }).reason, 'forbiddenForNonOrganizer');
  assert.equal(toApiError({ response: { status: 404 }, message: 'Not Found' }).reason, null);
  assert.equal(toApiError({ message: 'socket hang up' }).reason, null);
});

test('an expired or revoked sign-in is marked authExpired', () => {
  const expired = toApiError({ response: { status: 400, data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }, message: 'invalid_grant' });
  assert.equal(expired.authExpired, true);
  assert.equal(expired.code, 401);
  assert.equal(toApiError({ message: 'invalid_grant' }).authExpired, true);
  assert.equal(toApiError({ message: 'No refresh token is set.' }).authExpired, true);
  assert.equal(toApiError({ response: { status: 401 }, message: 'Invalid Credentials' }).authExpired, true);
});

test('network errors get code 0 and a readable message', () => {
  const err = toApiError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND www.googleapis.com' });
  assert.equal(err.code, 0);
  assert.equal(err.authExpired, false);
  assert.match(err.message, /ENOTFOUND|offline/);
});

// A fake of the @googleapis/calendar client, to check the adapter's calls.
function fakeCalendar() {
  const calls = [];
  return {
    calls,
    calendars: {
      get: async (p) => { calls.push(['calendars.get', p]); return { data: { id: p.calendarId } }; },
      insert: async (p) => { calls.push(['calendars.insert', p]); return { data: { id: 'cal-1' } }; },
    },
    events: {
      insert: async (p) => { calls.push(['events.insert', p]); return { data: { id: 'ev-1', updated: '2026-11-26T01:00:00.000Z' } }; },
      update: async (p) => { calls.push(['events.update', p]); return { data: { updated: '2026-11-26T02:00:00.000Z' } }; },
      patch: async (p) => { calls.push(['events.patch', p]); return { data: { updated: '2026-11-26T03:00:00.000Z' } }; },
      delete: async (p) => { calls.push(['events.delete', p]); throw { response: { status: 410 }, message: 'Gone' }; },
      list: async (p) => {
        calls.push(['events.list', p]);
        if (!p.pageToken) return { data: { items: [{ id: 'a', status: 'confirmed' }], nextPageToken: 'p2' } };
        return { data: { items: [{ id: 'b', status: 'cancelled', recurringEventId: 'a', originalStartTime: { dateTime: '2026-11-30T07:00:00+07:00' } }] } };
      },
    },
  };
}

test('adapter maps the push interface to Calendar API calls', async () => {
  const cal = fakeCalendar();
  const api = createApi(null, { calendarClient: cal });
  assert.deepEqual(await api.getCalendar('cal-1'), { id: 'cal-1' });
  assert.equal(await api.createCalendar({ summary: '⚔ every tracker u need, well i think', timeZone: 'Asia/Jakarta' }), 'cal-1');
  assert.deepEqual(await api.insertEvent('cal-1', { summary: 'A' }), { id: 'ev-1', updated: '2026-11-26T01:00:00.000Z' });
  await api.updateEvent('cal-1', 'ev-1', { summary: 'B' });
  const update = cal.calls.find(([n]) => n === 'events.update')[1];
  // An event deleted by hand in Google is "cancelled"; updating it with
  // status confirmed brings it back.
  assert.deepEqual(update.requestBody, { summary: 'B', status: 'confirmed' });
  await assert.rejects(api.deleteEvent('cal-1', 'ev-1'), (err) => err.code === 410);
  // 'b' is one week of series 'a' that was deleted in Google.
  const listed = await api.listEvents('cal-1');
  assert.equal(listed.length, 2);
  assert.equal(listed[1].id, 'b');
  assert.equal(listed[1].status, 'cancelled');
  assert.equal(listed[1].recurringEventId, 'a');
  assert.deepEqual(listed[1].originalStartTime, { dateTime: '2026-11-30T07:00:00+07:00' });
  const list = cal.calls.find(([n]) => n === 'events.list')[1];
  assert.equal(list.showDeleted, true);
  assert.match(list.fields, /recurringEventId/);
  assert.match(list.fields, /eventType/);
});

test('listEvents gives the full normalized shape', async () => {
  const cal = fakeCalendar();
  cal.events.list = async () => ({ data: { items: [
    {
      id: 'x', status: 'confirmed', updated: '2026-11-26T01:00:00.000Z', summary: 'Seminar', description: 'Hall B',
      start: { dateTime: '2026-11-30T07:00:00+07:00' }, end: { dateTime: '2026-11-30T09:00:00+07:00' },
      extendedProperties: { private: { localKey: 'quest:3' } },
      organizer: { self: false }, eventType: 'fromGmail',
      attendees: [{ self: false, responseStatus: 'accepted' }, { self: true, responseStatus: 'declined' }],
    },
    { id: 'y', status: 'confirmed', start: { date: '2026-12-01' }, end: { date: '2026-12-02' } },
  ] } });
  const [x, y] = await createApi(null, { calendarClient: cal }).listEvents('cal-1');
  assert.deepEqual(x, {
    id: 'x', status: 'confirmed', updated: '2026-11-26T01:00:00.000Z', summary: 'Seminar', description: 'Hall B',
    start: { dateTime: '2026-11-30T07:00:00+07:00' }, end: { dateTime: '2026-11-30T09:00:00+07:00' },
    recurrence: undefined, recurringEventId: undefined, originalStartTime: undefined,
    localKey: 'quest:3', organizerSelf: false, declined: true, eventType: 'fromGmail',
  });
  // Missing fields get safe defaults.
  assert.equal(y.localKey, null);
  assert.equal(y.description, '');
  assert.equal(y.organizerSelf, true);
  assert.equal(y.declined, false);
  assert.equal(y.eventType, 'default');
});

test('patchEvent sends only the given fields; listMainEvents and getEvent use the main calendar', async () => {
  const cal = fakeCalendar();
  cal.events.get = async (p) => { cal.calls.push(['events.get', p]); return { data: { id: p.eventId, status: 'confirmed' } }; };
  const api = createApi(null, { calendarClient: cal });
  assert.deepEqual(await api.patchEvent('primary', 'ev-9', { summary: 'New' }), { updated: '2026-11-26T03:00:00.000Z' });
  const patch = cal.calls.find(([n]) => n === 'events.patch')[1];
  assert.deepEqual(patch.requestBody, { summary: 'New' });
  assert.equal(patch.eventId, 'ev-9');
  await api.listMainEvents('2026-11-01T00:00:00Z');
  const list = cal.calls.filter(([n]) => n === 'events.list').pop()[1];
  assert.equal(list.calendarId, 'primary');
  assert.equal(list.showDeleted, true);
  assert.equal(list.singleEvents, false);
  assert.equal(list.timeMin, '2026-11-01T00:00:00Z');
  assert.equal((await api.getEvent('primary', 'ev-9')).id, 'ev-9');
});

// Uses the REAL google-auth-library and @googleapis/calendar, but points the
// token refresh at a local server that answers like Google does when a
// Testing-mode sign-in has expired. Nothing leaves this computer.
test('real libraries: an expired refresh token becomes authExpired', async () => {
  const http = require('node:http');
  const { OAuth2Client } = require('google-auth-library');
  const server = http.createServer((req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new OAuth2Client({
      clientId: 'id',
      clientSecret: 'secret',
      endpoints: { oauth2TokenUrl: `http://127.0.0.1:${server.address().port}/token` },
    });
    // An access token that has run out, so the library must refresh first.
    client.setCredentials({ access_token: 'old', refresh_token: 'expired', expiry_date: 1 });
    const api = createApi(client);
    await assert.rejects(api.getCalendar('cal-1'), (err) => err.authExpired === true && err.code === 401);
  } finally {
    server.close();
  }
});
