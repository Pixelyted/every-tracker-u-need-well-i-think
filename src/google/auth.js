// Google sign-in for a desktop app ("loopback" flow):
//   1. start a tiny web server on 127.0.0.1 at a free port,
//   2. open Google's sign-in page in the browser,
//   3. Google sends the browser back to our little server with a code,
//   4. swap the code for tokens and save them.
// PKCE (a one-time secret made for each sign-in) means a stolen code alone
// is useless.
//
// Tokens are saved in one file, encrypted with Electron's safeStorage (it
// uses the GNOME keyring). Electron bits are passed in, so this file can be
// tested with plain Node.

const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');

// The narrowest scope: the app may only see and change calendars it created
// itself (the "⚔ every tracker u need, well i think" calendar), never your other calendars.
const SCOPES = {
  app: 'https://www.googleapis.com/auth/calendar.app.created',
  // Only asked for when the user turns on syncing with their main calendar.
  events: 'https://www.googleapis.com/auth/calendar.events',
};
const SCOPE = SCOPES.app;
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>every tracker u need, well i think</title>
<body style="background:#14110f;color:#efe6d8;font-family:sans-serif;text-align:center;padding-top:80px">
<h1 style="color:#f0a830">⚔ Connected!</h1><p>You can close this tab and go back to the app.</p></body>`;

const FAIL_PAGE = `<!doctype html><meta charset="utf-8"><title>every tracker u need, well i think</title>
<body style="background:#14110f;color:#efe6d8;font-family:sans-serif;text-align:center;padding-top:80px">
<h1 style="color:#e0473e">Sign-in did not finish</h1><p>Close this tab and try Connect again in the app.</p></body>`;

function createAuth({ tokenFile, safeStorage, getCredentials, OAuth2Client = require('google-auth-library').OAuth2Client, log = console.log }) {
  // ---------- token file ----------

  function saveTokens(tokens) {
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
    const json = JSON.stringify(tokens);
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(tokenFile, safeStorage.encryptString(json), { mode: 0o600 });
    } else {
      log('Google tokens saved NOT encrypted (no keyring available): ' + tokenFile);
      fs.writeFileSync(tokenFile, json, { mode: 0o600 });
    }
  }

  function loadTokens() {
    if (!fs.existsSync(tokenFile)) return null;
    const raw = fs.readFileSync(tokenFile);
    // A plain JSON file starts with '{'; anything else is encrypted.
    if (raw[0] === '{'.charCodeAt(0)) return JSON.parse(raw.toString('utf8'));
    return JSON.parse(safeStorage.decryptString(raw));
  }

  // ---------- the loopback server ----------

  // Starts the server and resolves with its port plus a promise for the
  // query string Google sends back.
  function startLoopback() {
    return new Promise((resolveStart, rejectStart) => {
      let deliver;
      let fail;
      const result = new Promise((resolve, reject) => {
        deliver = resolve;
        fail = reject;
      });
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
          res.writeHead(404).end();
          return;
        }
        deliver({ params: url.searchParams, res });
      });
      const timer = setTimeout(() => fail(new Error('Sign-in timed out after 5 minutes')), SIGN_IN_TIMEOUT_MS);
      server.on('error', rejectStart);
      server.listen(0, '127.0.0.1', () => {
        const close = () => {
          clearTimeout(timer);
          server.close();
        };
        resolveStart({ port: server.address().port, result, close, fail });
      });
    });
  }

  function reply(res, page) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
    res.end(page);
  }

  // ---------- public ----------

  async function connect({ openExternal, wide = false }) {
    const { clientId, clientSecret } = getCredentials();
    if (!clientId || !clientSecret) throw new Error('Enter the client ID and secret first');

    const loopback = await startLoopback();
    try {
      const redirectUri = `http://127.0.0.1:${loopback.port}`;
      const client = new OAuth2Client({ clientId, clientSecret, redirectUri });
      const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
      const state = crypto.randomBytes(16).toString('hex');
      const url = client.generateAuthUrl({
        access_type: 'offline', // gives a refresh token, so we stay signed in
        prompt: 'consent', // always ask, so Google always sends a refresh token
        scope: wide ? [SCOPES.app, SCOPES.events] : [SCOPES.app],
        include_granted_scopes: true, // keep what was allowed before
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      // Wait for Google's answer while the browser opens; if the browser
      // can't be opened at all, stop waiting straight away.
      Promise.resolve(openExternal(url)).catch((err) => loopback.fail(err));

      const { params, res } = await loopback.result;
      if (params.get('state') !== state) {
        reply(res, FAIL_PAGE);
        throw new Error('Sign-in answer had the wrong state; please try again');
      }
      if (params.get('error')) {
        reply(res, FAIL_PAGE);
        throw new Error('Google sign-in was not allowed: ' + params.get('error'));
      }
      // If swapping the code fails (network down, code expired), still
      // answer the browser tab, or it keeps spinning forever.
      let tokens;
      try {
        ({ tokens } = await client.getToken({ code: params.get('code'), codeVerifier }));
      } catch (err) {
        reply(res, FAIL_PAGE);
        throw err;
      }
      saveTokens(tokens);
      reply(res, DONE_PAGE);
    } finally {
      loopback.close();
    }
  }

  // A ready-to-use client, or null when not connected.
  function getClient() {
    const tokens = loadTokens();
    if (!tokens) return null;
    const { clientId, clientSecret } = getCredentials();
    const client = new OAuth2Client({ clientId, clientSecret });
    client.setCredentials(tokens);
    // Google hands out a fresh access token every hour. Save it, keeping
    // the refresh token (Google usually doesn't send it again).
    client.on('tokens', (fresh) => {
      const merged = { ...(loadTokens() || {}), ...fresh };
      saveTokens(merged);
      client.setCredentials(merged);
    });
    return client;
  }

  function isConnected() {
    return fs.existsSync(tokenFile);
  }

  // True when the saved sign-in was allowed to edit the main calendar.
  // Google lists what it granted in the tokens' `scope` text.
  function hasWideScope() {
    try {
      const tokens = loadTokens();
      return Boolean(tokens && typeof tokens.scope === 'string' && tokens.scope.split(' ').includes(SCOPES.events));
    } catch (err) {
      return false; // unreadable sign-in: treat as not allowed
    }
  }

  // Forgets the sign-in. The "⚔ every tracker u need, well i think" calendar stays in Google.
  function disconnect() {
    fs.rmSync(tokenFile, { force: true });
  }

  return { connect, getClient, isConnected, hasWideScope, disconnect };
}

module.exports = { createAuth, SCOPE, SCOPES };
