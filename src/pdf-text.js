// Turns a PDF into text by running the `pdftotext` program (from poppler).
// `-layout` keeps the columns where they were, which the BCA parser needs.

const { execFile } = require('node:child_process');

const MISSING_PDFTOTEXT = 'Reading PDFs needs pdftotext. Install it with: sudo dnf install poppler-utils';

// Takes `execFile` as a parameter so tests can pass a fake one.
function readPdfTextWith(execFileFn) {
  return (filePath) => new Promise((resolve, reject) => {
    execFileFn('pdftotext', ['-layout', filePath, '-'], { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      if (err.code === 'ENOENT') {
        // The program isn't installed.
        const missing = new Error(MISSING_PDFTOTEXT);
        missing.code = 'NO_PDFTOTEXT';
        return reject(missing);
      }
      reject(new Error("Couldn't read this PDF: " + (stderr || err.message)));
    });
  });
}

const readPdfText = readPdfTextWith(execFile);

module.exports = { readPdfText, readPdfTextWith, MISSING_PDFTOTEXT };
