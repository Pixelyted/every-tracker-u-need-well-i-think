const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createAuth, SCOPE } = require('../src/google/auth');

// Stand-in for Electron's safeStorage: "encrypts" by base64 + a marker.
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from('ENC:' + Buffer.from(text).toString('base64')),
  decryptString: (buf) => Buffer.from(buf.toString().slice(4), 'base64').toString(),
};

// Stand-in for google-auth-library's OAuth2Client.
class FakeOAuth2Client extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    FakeOAuth2Client.last = this;
  }
  async generateCodeVerifierAsync() {
    return { codeVerifier: 'verifier', codeChallenge: 'challenge' };
  }
  generateAuthUrl(opts) {
    FakeOAuth2Client.authOptions = opts;
    const q = new URLSearchParams({ redirect_uri: this.options.redirectUri, state: opts.state });
    return 'https://accounts.example/auth?' + q;
  }
  async getToken({ code, codeVerifier }) {
    FakeOAuth2Client.tokenRequest = { code, codeVerifier };
    return { tokens: { access_token: 'access-1', refresh_token: 'refresh-1', expiry_date: 1 } };
  }
  setCredentials(tokens) {
    this.credentials = tokens;
  }
}

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dungeon-auth-'));
  return path.join(dir, 'google-tokens.bin');
}

function makeAuth(file, extra = {}) {
  return createAuth({
    tokenFile: file,
    safeStorage: fakeSafeStorage,
    getCredentials: () => ({ clientId: 'id-123', clientSecret: 'secret-456' }),
    OAuth2Client: FakeOAuth2Client,
    log: () => {},
    ...extra,
  });
}

// Plays the browser: follows the auth URL straight back to the app's
// loopback redirect, as Google would after the user clicks "Allow".
// `browser.page` resolves to the page the app shows in the browser.
function browserThatAllows(query = (state) => ({ code: 'the-code', state })) {
  let showPage;
  const browser = (url) => {
    const params = new URL(url).searchParams;
    const back = params.get('redirect_uri') + '?' + new URLSearchParams(query(params.get('state')));
    fetch(back).then((res) => res.text()).then(showPage);
  };
  browser.page = new Promise((resolve) => { showPage = resolve; });
  return browser;
}

test('connect runs the loopback sign-in and saves encrypted tokens', async () => {
  const file = tempFile();
  const auth = makeAuth(file);
  const browser = browserThatAllows();
  await auth.connect({ openExternal: browser });
  const opts = FakeOAuth2Client.authOptions;
  assert.equal(opts.access_type, 'offline');
  assert.equal(opts.prompt, 'consent');
  assert.deepEqual(opts.scope, [SCOPE]);
  assert.equal(SCOPE, 'https://www.googleapis.com/auth/calendar.app.created');
  assert.equal(opts.code_challenge, 'challenge');
  assert.equal(opts.code_challenge_method, 'S256');
  assert.match(FakeOAuth2Client.last.options.redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.deepEqual(FakeOAuth2Client.tokenRequest, { code: 'the-code', codeVerifier: 'verifier' });
  assert.match(await browser.page, /close this tab/i);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(raw.startsWith('ENC:'));
  assert.ok(!raw.includes('refresh-1'));
  assert.equal(auth.isConnected(), true);
  const client = auth.getClient();
  assert.equal(client.credentials.refresh_token, 'refresh-1');
  assert.equal(client.options.clientId, 'id-123');
});

test('refreshed tokens are saved and keep the refresh token', async () => {
  const file = tempFile();
  const auth = makeAuth(file);
  await auth.connect({ openExternal: browserThatAllows() });
  auth.getClient().emit('tokens', { access_token: 'access-2', expiry_date: 2 });
  const again = makeAuth(file).getClient();
  assert.equal(again.credentials.access_token, 'access-2');
  assert.equal(again.credentials.refresh_token, 'refresh-1');
});

test('plain JSON when encryption is unavailable', async () => {
  const file = tempFile();
  const lines = [];
  const auth = makeAuth(file, {
    safeStorage: { isEncryptionAvailable: () => false },
    log: (line) => lines.push(line),
  });
  await auth.connect({ openExternal: browserThatAllows() });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).refresh_token, 'refresh-1');
  assert.ok(lines.some((l) => /not encrypted/i.test(l)));
  assert.equal(auth.getClient().credentials.refresh_token, 'refresh-1');
});

test('a wrong state is rejected', async () => {
  const auth = makeAuth(tempFile());
  await assert.rejects(auth.connect({ openExternal: browserThatAllows(() => ({ code: 'x', state: 'forged' })) }), /state/i);
  assert.equal(auth.isConnected(), false);
});

test('saying no in the browser is reported', async () => {
  const auth = makeAuth(tempFile());
  await assert.rejects(auth.connect({ openExternal: browserThatAllows((state) => ({ error: 'access_denied', state })) }), /access_denied/);
});

test('missing client ID or secret', async () => {
  const auth = makeAuth(tempFile(), { getCredentials: () => ({ clientId: '', clientSecret: '' }) });
  await assert.rejects(auth.connect({ openExternal: async () => {} }), /client ID and secret/);
});

test('disconnect deletes the tokens', async () => {
  const file = tempFile();
  const auth = makeAuth(file);
  await auth.connect({ openExternal: browserThatAllows() });
  auth.disconnect();
  assert.equal(fs.existsSync(file), false);
  assert.equal(auth.getClient(), null);
  assert.equal(auth.isConnected(), false);
});

test('a failed token exchange still answers the browser tab', async () => {
  class FailingClient extends FakeOAuth2Client {
    async getToken() {
      throw new Error('invalid_grant');
    }
  }
  const auth = makeAuth(tempFile(), { OAuth2Client: FailingClient });
  const browser = browserThatAllows();
  await assert.rejects(auth.connect({ openExternal: browser }), /invalid_grant/);
  assert.match(await browser.page, /did not finish/i);
  assert.equal(auth.isConnected(), false);
});
