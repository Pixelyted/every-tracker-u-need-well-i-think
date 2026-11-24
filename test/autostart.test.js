const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { desktopEntry, applyAutostart } = require('../src/autostart');

test('desktop entry has name, exec and icon', () => {
  const text = desktopEntry({ exec: '"/opt/electron" "/repo" --hidden', icon: '/repo/ui/assets/icon.png' });
  assert.ok(text.startsWith('[Desktop Entry]\n'));
  assert.ok(text.includes('\nName=every tracker u need, well i think\n'));
  assert.ok(text.includes('\nExec="/opt/electron" "/repo" --hidden\n'));
  assert.ok(text.includes('\nIcon=/repo/ui/assets/icon.png\n'));
  assert.ok(text.includes('\nType=Application\n'));
});

test('autostart file appears and disappears', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dungeon-autostart-'));
  const file = path.join(dir, 'autostart', 'dungeon-planner.desktop');
  applyAutostart(true, { dir: path.join(dir, 'autostart'), exec: 'x --hidden', icon: 'i.png' });
  assert.ok(fs.readFileSync(file, 'utf8').includes('Exec=x --hidden'));
  applyAutostart(false, { dir: path.join(dir, 'autostart'), exec: 'x --hidden', icon: 'i.png' });
  assert.equal(fs.existsSync(file), false);
  applyAutostart(false, { dir: path.join(dir, 'autostart'), exec: 'x', icon: 'i.png' }); // already gone: no error
  fs.rmSync(dir, { recursive: true });
});
