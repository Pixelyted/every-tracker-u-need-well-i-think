// .desktop files: the small text files GNOME reads to know about an app.
//
// - ~/.config/autostart/dungeon-planner.desktop starts the app on login.
// - ~/.local/share/applications/dungeon-planner.desktop puts it in the
//   app grid (written by scripts/install-desktop.js).

const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'dungeon-planner.desktop';

function desktopEntry({ exec, icon }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=every tracker u need, well i think',
    'Comment=Your weekly quests, clashes and reminders',
    `Exec=${exec}`,
    `Icon=${icon}`,
    'Terminal=false',
    'Categories=Office;Calendar;',
    'StartupWMClass=dungeon-planner',
    '',
  ].join('\n');
}

// Writes the autostart file when `enabled`, deletes it otherwise.
function applyAutostart(enabled, { dir, exec, icon }) {
  const file = path.join(dir, FILE_NAME);
  if (enabled) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, desktopEntry({ exec, icon }));
  } else {
    fs.rmSync(file, { force: true });
  }
}

module.exports = { FILE_NAME, desktopEntry, applyAutostart };
