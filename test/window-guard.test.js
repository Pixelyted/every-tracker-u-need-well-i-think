const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { guardNavigation } = require('../src/window-guard');

function fakeWebContents() {
  const wc = new EventEmitter();
  wc.setWindowOpenHandler = (fn) => { wc.openHandler = fn; };
  return wc;
}

test('the window can never be navigated away from the app', () => {
  const wc = fakeWebContents();
  guardNavigation(wc);
  let prevented = false;
  // e.g. a link or an .html file dropped onto the window
  wc.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://example.com/');
  assert.equal(prevented, true);
});

test('pages can never open new windows', () => {
  const wc = fakeWebContents();
  guardNavigation(wc);
  assert.deepEqual(wc.openHandler({ url: 'https://example.com/' }), { action: 'deny' });
});
