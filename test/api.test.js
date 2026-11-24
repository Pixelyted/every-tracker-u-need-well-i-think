const test = require('node:test');
const assert = require('node:assert/strict');
const { toApiError, createApi } = require('../src/google/api');

test('HTTP errors keep their status code', () => {
  assert.equal(toApiError({ response: { status: 404 }, message: 'Not Found' }).code, 404);
  assert.equal(toApiError({ status: 410, message: 'Gone' }).code, 410);
  assert.equal(toApiError({ response: { status: 404 } }).authExpired, false);
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
      insert: async (p) => { calls.push(['events.insert', p]); return { data: { id: 'ev-1' } }; },
      update: async (p) => { calls.push(['events.update', p]); return { data: {} }; },
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
  assert.equal(await api.insertEvent('cal-1', { summary: 'A' }), 'ev-1');
  await api.updateEvent('cal-1', 'ev-1', { summary: 'B' });
  const update = cal.calls.find(([n]) => n === 'events.update')[1];
  // An event deleted by hand in Google is "cancelled"; updating it with
  // status confirmed brings it back.
  assert.deepEqual(update.requestBody, { summary: 'B', status: 'confirmed' });
  await assert.rejects(api.deleteEvent('cal-1', 'ev-1'), (err) => err.code === 410);
  // 'b' is one week of series 'a' that was deleted in Google.
  assert.deepEqual(await api.listEvents('cal-1'), [
    { id: 'a', status: 'confirmed', recurringEventId: undefined, originalStartTime: undefined },
    { id: 'b', status: 'cancelled', recurringEventId: 'a', originalStartTime: { dateTime: '2026-11-30T07:00:00+07:00' } },
  ]);
  const list = cal.calls.find(([n]) => n === 'events.list')[1];
  assert.equal(list.showDeleted, true);
  assert.match(list.fields, /recurringEventId/);
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
