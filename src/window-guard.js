// Keeps the app's window on the app's own page.
//
// The window has `window.dungeon` (add, delete, settings...). If a link or
// a file dropped onto the window could navigate it somewhere else, that
// other page would get the same powers. So: no navigating away, and no
// new windows.

function guardNavigation(webContents) {
  webContents.on('will-navigate', (event) => event.preventDefault());
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

module.exports = { guardNavigation };
