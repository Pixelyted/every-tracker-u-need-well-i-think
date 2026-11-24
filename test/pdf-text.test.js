const test = require('node:test');
const assert = require('node:assert/strict');
const { readPdfTextWith, MISSING_PDFTOTEXT } = require('../src/pdf-text');

test('missing pdftotext gives the install message', async () => {
  const fake = (_cmd, _args, _opts, callback) => callback({ code: 'ENOENT' });
  await assert.rejects(readPdfTextWith(fake)('/x/a.pdf'), (err) => {
    assert.equal(err.code, 'NO_PDFTOTEXT');
    assert.equal(err.message, 'Reading PDFs needs pdftotext. Install it with: sudo dnf install poppler-utils');
    assert.equal(err.message, MISSING_PDFTOTEXT);
    return true;
  });
});

test('other failures say the PDF could not be read', async () => {
  const fake = (_cmd, _args, _opts, callback) => callback(new Error('boom'), '', 'Syntax Error');
  await assert.rejects(readPdfTextWith(fake)('/x/a.pdf'), /Couldn't read this PDF: Syntax Error/);
});

test('success resolves with the text and passes -layout', async () => {
  let seen;
  const fake = (cmd, args, _opts, callback) => { seen = [cmd, args]; callback(null, 'hello', ''); };
  assert.equal(await readPdfTextWith(fake)('/x/a.pdf'), 'hello');
  assert.deepEqual(seen, ['pdftotext', ['-layout', '/x/a.pdf', '-']]);
});
