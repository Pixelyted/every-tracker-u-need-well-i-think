// Decides WHEN to push to Google:
//   - on app start,
//   - 2 seconds after the last change (so typing a form doesn't push 10 times),
//   - 5 minutes after a failed push (offline, Google hiccup...),
//   - 30 minutes after the last push, even if nothing changed, so an event
//     deleted or edited in Google by mistake is put back by itself,
//   - right away when "Push now" is clicked.
// When Google says the sign-in has expired, automatic pushes stop and
// `onAuthExpired` is called once, until the user reconnects.
//
// It doesn't know about Google itself: `push` is a function that runs one
// push and returns its result ({ ok, error, authExpired }).

const DEBOUNCE_MS = 2000;
const RETRY_MS = 5 * 60 * 1000;
const REGULAR_MS = 30 * 60 * 1000;

function createPushScheduler({ push, isEnabled, onAuthExpired, debounceMs = DEBOUNCE_MS, retryMs = RETRY_MS, regularMs = REGULAR_MS }) {
  let debounceTimer = null;
  let retryTimer = null;
  let regularTimer = null; // the "every 30 minutes" push
  let running = null; // the push in progress, if any
  let pushAgain = false; // a change arrived while pushing
  let authExpired = false;

  function clear(timer) {
    if (timer) clearTimeout(timer);
    return null;
  }

  async function runOnce() {
    if (running) {
      // Don't run two pushes at the same time; do one more afterwards.
      pushAgain = true;
      return running;
    }
    retryTimer = clear(retryTimer);
    // Any push restarts the 30 minutes.
    regularTimer = clear(regularTimer);
    running = (async () => {
      let result;
      try {
        result = await push();
      } catch (err) {
        // A push that blows up (e.g. the keyring can't be read) is just a
        // failed push: it gets the normal retry instead of stopping silently.
        result = { ok: false, error: (err && err.message) || String(err), authExpired: false };
      }
      if (result.ok) {
        authExpired = false;
        regularTimer = setTimeout(automaticPush, regularMs);
      } else if (result.authExpired) {
        if (!authExpired) onAuthExpired(result);
        authExpired = true;
      } else {
        retryTimer = setTimeout(automaticPush, retryMs);
      }
      return result;
    })();
    try {
      return await running;
    } finally {
      running = null;
      if (pushAgain) {
        pushAgain = false;
        automaticPush();
      }
    }
  }

  // Pushes that happen by themselves are skipped when push is off or the
  // sign-in has expired.
  function automaticPush() {
    if (!isEnabled() || authExpired) return null;
    return runOnce();
  }

  return {
    start() {
      return automaticPush();
    },
    changed() {
      debounceTimer = clear(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        automaticPush();
      }, debounceMs);
    },
    // "Push now" always tries, even after an expired sign-in.
    pushNow() {
      return runOnce();
    },
    reconnected() {
      authExpired = false;
    },
    isAuthExpired() {
      return authExpired;
    },
    stop() {
      debounceTimer = clear(debounceTimer);
      retryTimer = clear(retryTimer);
      regularTimer = clear(regularTimer);
    },
  };
}

module.exports = { createPushScheduler };
