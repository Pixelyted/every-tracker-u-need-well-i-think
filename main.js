// Electron's main process: opens the window and connects the database,
// reminders, the tray icon and Google push. The window itself lives in ui/.

const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow, dialog, Notification, Tray, Menu, powerMonitor, safeStorage, shell } = require('electron');
const { openStore } = require('./src/db');
const { registerIpc } = require('./src/ipc');
const { nowFromDate } = require('./src/time');
const { startNotifier } = require('./src/notifier');
const { recordClearedQuests } = require('./src/xp-log');
const { applyAutostart } = require('./src/autostart');
const { guardNavigation } = require('./src/window-guard');
const { createAuth } = require('./src/google/auth');
const { createApi } = require('./src/google/api');
const { runSync } = require('./src/google/sync');
const { createPushScheduler } = require('./src/google/scheduler');

const ICON = path.join(__dirname, 'ui', 'assets', 'icon.png');
const TRAY_ICON = path.join(__dirname, 'ui', 'assets', 'tray.png');
const TRAY_HINT = 'Install the "AppIndicator and KStatusNotifierItem Support" GNOME extension to get the top-bar icon.';

const isDev = process.env.DUNGEON_DEV === '1';
const startHidden = process.argv.includes('--hidden');

let mainWindow = null;
let store = null;
let tray = null;
let notifier = null;
let isQuitting = false;
let lastLaunchOnLogin = null;
let auth = null;
let pushScheduler = null;
let xpTimer = null;

// "Now" from the laptop's clock, as { date, time }.
function clock() {
  return nowFromDate(new Date());
}

// Logs quests that have ended since the last check, and redraws the window
// if there was anything new.
// A failure here must never stop start-up or crash the timer, so it is
// only logged.
function checkClearedQuests() {
  try {
    if (recordClearedQuests(store, clock()) > 0) notifyWindow();
  } catch (err) {
    console.error('[xp] ' + err.message);
  }
}

// DUNGEON_DEV=1 uses a separate test database (see scripts/seed-dev.js),
// so trying things out never touches the real one.
function databasePath() {
  const file = isDev ? 'dev.sqlite' : 'dungeon.sqlite';
  return path.join(app.getPath('userData'), file);
}

// ---------- window ----------

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Tells the window that data changed, so it redraws.
function notifyWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('dungeon:changed');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'every tracker u need, well i think',
    icon: ICON,
    show: !startHidden,
    autoHideMenuBar: true, // Ctrl+Q still quits
    backgroundColor: '#14110f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  guardNavigation(mainWindow.webContents);
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  // Without a tray, "start hidden" means "start minimized".
  if (startHidden && !tray) {
    mainWindow.once('ready-to-show', () => {
      mainWindow.showInactive();
      mainWindow.minimize();
    });
  }

  // Closing the window keeps the app running so reminders still fire:
  // hide it to the tray, or minimize when there is no tray.
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (tray) mainWindow.hide();
    else mainWindow.minimize();
  });

  // If the window is destroyed anyway (not just hidden), don't leave an
  // invisible app behind: without a tray, quit; with one, the tray's
  // "Open" makes a new window.
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (!tray) app.quit();
  });

  // Show errors from the window in the terminal too: easier to debug.
  mainWindow.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') {
      console.log(`[window ${event.level}] ${event.message}`);
    }
  });

  if (process.env.DUNGEON_SMOKE === '1') runSmokeCheck();
}

// ---------- tray ----------

// Stock GNOME has no tray. The AppIndicator extension provides a
// "StatusNotifierWatcher" on D-Bus; without it a tray icon would be invisible.
function hasStatusNotifierHost() {
  try {
    const answer = execFileSync('gdbus', [
      'call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus',
      '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.kde.StatusNotifierWatcher',
    ], { timeout: 2000, encoding: 'utf8' });
    return answer.includes('true');
  } catch {
    return false;
  }
}

function createTray() {
  if (!hasStatusNotifierHost()) return null;
  try {
    const t = new Tray(TRAY_ICON);
    t.setToolTip('every tracker u need, well i think');
    t.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
    t.on('click', showWindow);
    return t;
  } catch (err) {
    console.log('Tray not available: ' + err.message);
    return null;
  }
}

// ---------- reminders ----------

// Notifications still on screen. If nothing in JavaScript points at a
// Notification, the garbage collector may throw it away while it is still
// showing, and then clicking it does nothing. Keeping it in this set until
// it is clicked or closed prevents that.
const liveNotifications = new Set();

// `onClick` runs when the notification is clicked (default: show the window).
function showNotification({ title, body }, onClick = showWindow) {
  console.log(`[notification] ${title}${body ? ' | ' + body : ''}`);
  const n = new Notification({ title, body, icon: ICON });
  liveNotifications.add(n);
  n.on('click', () => {
    liveNotifications.delete(n);
    onClick();
  });
  n.on('close', () => liveNotifications.delete(n));
  n.show();
}

// ---------- Google push ----------

const HELD_DELETES_WINDOW_MS = 10 * 60 * 1000;

function sendToWindow(channel) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel);
}

// Set by "Sync now" for exactly one run, to let held deletions through.
let allowManyDeletesOnce = false;

// One push with the saved sign-in. Local data is never changed by a failure.
async function pushOnce() {
  let client;
  try {
    client = auth.getClient();
  } catch (err) {
    // The saved sign-in couldn't be read (keyring locked, damaged file).
    // Record it so Settings shows why; the scheduler retries later.
    const error = 'Could not read the Google sign-in: ' + err.message;
    store.setSettings({ lastPush: { at: new Date().toISOString(), ok: false, error, authExpired: false } });
    sendToWindow('dungeon:push-status');
    return { ok: false, error, authExpired: false };
  }
  if (!client) return { ok: false, error: 'Not connected to Google', authExpired: false };
  // Main calendar wanted but the sign-in lacks permission: sync ⚔ only and
  // say why, instead of failing the whole run.
  const wantsMain = Boolean(store.getSettings().googleMainSync);
  const needsWide = wantsMain && !auth.hasWideScope();
  const allowManyDeletes = allowManyDeletesOnce;
  allowManyDeletesOnce = false;
  const result = await runSync({ api: createApi(client), store, allowManyDeletes, mainSync: wantsMain && !needsWide });
  if (needsWide && result.ok) {
    const last = store.getSettings().lastPush;
    store.setSettings({ lastPush: { ...last, error: 'Reconnect Google to allow your main calendar' } });
  }
  if (!result.ok) console.log('[google] push failed: ' + result.error);
  // Changes came in from Google: redraw the window and re-plan reminders.
  // Not onChange(): that would ask the scheduler for yet another sync.
  if (result.counts && result.counts.pulled > 0) {
    notifyWindow();
    if (notifier) notifier.replan();
  }
  sendToWindow('dungeon:push-status');
  return result;
}

// The Google sign-in no longer works (every 7 days while the Google app is
// in Testing mode). Say so once; the window shows a Reconnect button.
function onGoogleAuthExpired() {
  showNotification({ title: 'Google disconnected, reconnect in Settings', body: '' }, () => {
    showWindow();
    sendToWindow('dungeon:open-settings');
  });
  sendToWindow('dungeon:push-status');
}

function setUpGoogle() {
  auth = createAuth({
    // Dev runs keep their own sign-in, so they never push test data with
    // the real one.
    tokenFile: path.join(app.getPath('userData'), isDev ? 'google-tokens-dev.bin' : 'google-tokens.bin'),
    safeStorage,
    getCredentials: () => {
      const s = store.getSettings();
      return { clientId: s.googleClientId, clientSecret: s.googleClientSecret };
    },
  });
  pushScheduler = createPushScheduler({
    push: pushOnce,
    isEnabled: () => store.getSettings().googlePush && auth.isConnected(),
    onAuthExpired: onGoogleAuthExpired,
  });
}

// The window's Google calls (they replace the "not set up" stubs in ipc.js).
const googleHandlers = {
  async googleConnect() {
    try {
      // Reconnecting (every 7 days) keeps the main calendar working.
      await auth.connect({ openExternal: (url) => shell.openExternal(url), wide: Boolean(store.getSettings().googleMainSync) });
    } catch (err) {
      return { ok: false, error: err.message };
    }
    store.setSettings({ googlePush: true });
    pushScheduler.reconnected();
    sendToWindow('dungeon:push-status');
    const push = await pushScheduler.pushNow();
    return { ok: true, push };
  },
  async googleDisconnect() {
    auth.disconnect();
    store.setSettings({ googlePush: false });
    pushScheduler.reconnected();
    sendToWindow('dungeon:push-status');
    return { ok: true };
  },
  async pushNow() {
    if (!auth.isConnected()) return { ok: false, error: 'Not connected to Google' };
    // Held deletions may go through if this "Sync now" follows the hold closely.
    const last = store.getSettings().lastPush;
    const fresh = last && Date.now() - new Date(last.at).getTime() < HELD_DELETES_WINDOW_MS;
    allowManyDeletesOnce = Boolean(last && last.heldDeletes && fresh);
    try {
      return await pushScheduler.pushNow();
    } finally {
      allowManyDeletesOnce = false;
    }
  },
  // Turns main calendar sync on or off. Off keeps imported quests and their
  // mappings; sync just stops reading the main calendar.
  async setMainSync(on) {
    on = Boolean(on);
    if (on && !(auth.isConnected() && auth.hasWideScope())) {
      try {
        await auth.connect({ openExternal: (url) => shell.openExternal(url), wide: true });
      } catch (err) {
        store.setSettings({ googleMainSync: false });
        return { ok: false, error: err.message };
      }
      store.setSettings({ googlePush: true });
      pushScheduler.reconnected();
    }
    store.setSettings({ googleMainSync: on });
    sendToWindow('dungeon:push-status');
    if (on) {
      const push = await pushScheduler.pushNow();
      return { ok: true, push };
    }
    return { ok: true };
  },
  async getPushStatus() {
    const settings = store.getSettings();
    const last = settings.lastPush;
    return {
      connected: auth.isConnected(),
      enabled: settings.googlePush,
      authExpired: auth.isConnected() && (pushScheduler.isAuthExpired() || Boolean(last && last.authExpired)),
      lastPush: last,
      mainSync: Boolean(settings.googleMainSync),
      needsWideScope: Boolean(settings.googleMainSync) && auth.isConnected() && !auth.hasWideScope(),
      heldDeletes: (last && last.heldDeletes) || null,
    };
  },
};

// ---------- launch on login ----------

// The command GNOME runs on login: this Electron with this app, hidden.
function launchCommand() {
  return `"${process.execPath}" "${app.getAppPath()}" --hidden`;
}

function syncAutostart() {
  // Dev runs (DUNGEON_DEV=1) never touch the real autostart entry.
  if (isDev) return;
  const enabled = store.getSettings().launchOnLogin;
  if (enabled === lastLaunchOnLogin) return;
  lastLaunchOnLogin = enabled;
  applyAutostart(enabled, {
    dir: path.join(app.getPath('home') || os.homedir(), '.config', 'autostart'),
    exec: launchCommand(),
    icon: ICON,
  });
}

// ---------- wiring ----------

// Runs after every change made through the window.
function onChange() {
  notifyWindow();
  if (notifier) notifier.replan();
  if (pushScheduler) pushScheduler.changed();
  syncAutostart();
}

// DUNGEON_SMOKE=1 is a quick self-check for developers: it prints what the
// window shows, then quits. Optional extras:
//   DUNGEON_SMOKE_JS='showWeek("2026-11-23")'  runs that first
//   DUNGEON_SHOT=docs/screenshots/week.png     saves a screenshot
//   DUNGEON_SMOKE_CLOSE=1                      closes the window first
function runSmokeCheck() {
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      const contents = mainWindow.webContents;
      // DUNGEON_SMOKE_CLOSE=1 presses the window's close button.
      if (process.env.DUNGEON_SMOKE_CLOSE === '1') {
        mainWindow.close();
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      if (process.env.DUNGEON_SMOKE_JS) {
        const answer = await contents.executeJavaScript(process.env.DUNGEON_SMOKE_JS);
        if (typeof answer === 'string') console.log('[smoke-js] ' + answer);
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      console.log(`[smoke] tray: ${tray ? 'yes' : 'no'}, window visible: ${mainWindow.isVisible()}, minimized: ${mainWindow.isMinimized()}`);
      const text = await contents.executeJavaScript('document.body.innerText');
      console.log('[smoke] ' + text.replace(/\s+/g, ' ').slice(0, 600));
      if (process.env.DUNGEON_SHOT) {
        const image = await contents.capturePage();
        require('node:fs').writeFileSync(process.env.DUNGEON_SHOT, image.toPNG());
        console.log('[smoke] screenshot saved to ' + process.env.DUNGEON_SHOT);
      }
      app.quit();
    }, 1500);
  });
}

// Only one copy of the app runs; starting it again just shows the window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    store = openStore(databasePath());
    tray = createTray();
    setUpGoogle();
    registerIpc(store, {
      onChange,
      clock,
      extra: {
        ...googleHandlers,
        // Lets the user choose bank statement PDFs; [] when cancelled.
        pickStatements: async () => {
          const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Import BCA mutasi rekening',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
          });
          return result.canceled ? [] : result.filePaths;
        },
        getTrayStatus: () => ({ hasTray: Boolean(tray), hint: tray ? null : TRAY_HINT }),
      },
    });
    createWindow();
    notifier = startNotifier({ store, notify: showNotification, clock });
    // Classes end by themselves, so look for new ones every minute (and
    // on wake, when the timer may have been asleep).
    checkClearedQuests();
    xpTimer = setInterval(checkClearedQuests, 60 * 1000);
    // After sleep the timers are stale: plan again on wake.
    powerMonitor.on('resume', () => {
      checkClearedQuests();
      notifier.replan();
      pushScheduler.start();
    });
    syncAutostart();
    // Push whatever changed while the app was closed.
    pushScheduler.start();
  });
}

// Quitting for real (tray "Quit", Ctrl+Q, logging out).
app.on('before-quit', () => {
  isQuitting = true;
});

// Keep running in the background when the window is closed.
app.on('window-all-closed', () => {});

app.on('will-quit', () => {
  if (notifier) notifier.stop();
  if (xpTimer) clearInterval(xpTimer);
  if (pushScheduler) pushScheduler.stop();
  if (store) store.close();
});
