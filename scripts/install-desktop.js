// Puts every tracker u need, well i think in GNOME's app grid by writing
// ~/.local/share/applications/dungeon-planner.desktop.
// Run: npm run install-desktop

const os = require('node:os');
const path = require('node:path');
const { applyAutostart, FILE_NAME } = require('../src/autostart');

const repo = path.resolve(__dirname, '..');
const dir = path.join(os.homedir(), '.local', 'share', 'applications');

applyAutostart(true, {
  dir,
  exec: `npm --prefix "${repo}" start`,
  icon: path.join(repo, 'ui', 'assets', 'icon.png'),
});
console.log('Wrote ' + path.join(dir, FILE_NAME));
console.log('"every tracker u need, well i think" should now appear in the app grid (log out and in if it does not).');
