// Reads the text of a BCA "mutasi rekening" statement (what `pdftotext -layout`
// gives for the PDF) and turns it into plain rows.
//
// Nothing here touches files, the database or Electron: it only turns one
// string into data, so tests can feed it made-up text.

const ROW_START = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s+(.*?)\s+([\d,]+\.\d{2})\s+(DB|CR)\s*$/;
// \s* (not \s+): a dated line at column 0 that fails ROW_START must be reported, not treated as furniture.
const DATED_LINE = /^\s*(\d{2}\/\d{2}\/\d{4})/;
const PERIOD = /PERIODE\s*:\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/;

// Description lines are indented at least this far; headers sit further left.
const CONTINUATION_INDENT = 10;

// '3,200,000.00' -> 320000000 (whole sen, so money never becomes a float).
function parseAmount(text) {
  return Number(text.replace(/,/g, '').replace('.', ''));
}

// Page furniture: repeated header/footer lines that are never part of a row.
function isFurniture(line) {
  if (/^\S/.test(line)) return true; // starts at column 0
  const trimmed = line.trim();
  // The last page ends with a few right-aligned "DB"/"CR" lines (the totals block,
  // whose numbers aren't in the text). They must not become a row's type.
  if (trimmed === 'DB' || trimmed === 'CR') return true;
  return trimmed === 'MUTASI REKENING' || trimmed.startsWith('Bersambung');
}

function squash(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// Finish the row being built: last extra line is the type, the rest join the text.
function closeRow(current, rows) {
  if (!current) return;
  const extra = current.extra;
  const type = extra.length ? extra[extra.length - 1] : '';
  const textLines = [current.first, ...extra.slice(0, -1)];
  rows.push({
    date: current.date,
    amount: current.amount,
    direction: current.direction,
    text: squash(textLines.join(' ')),
    type: squash(type),
  });
}

function parseMutasi(text) {
  const periodMatch = PERIOD.exec(text);
  if (!periodMatch) return { period: null, rows: [], problems: [] };
  const [, d1, m1, y1, d2, m2, y2] = periodMatch;
  const period = { start: `${y1}-${m1}-${d1}`, end: `${y2}-${m2}-${d2}` };

  const rows = [];
  const problems = [];
  let current = null; // the row whose description lines we are collecting

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;

    const start = ROW_START.exec(line);
    if (start) {
      closeRow(current, rows);
      current = {
        date: `${start[3]}-${start[2]}-${start[1]}`,
        amount: parseAmount(start[5]),
        direction: start[6],
        first: start[4],
        extra: [],
      };
      continue;
    }

    const dated = DATED_LINE.exec(line);
    if (dated) {
      // Looks like a transaction but we can't read it: say so, don't drop it silently.
      closeRow(current, rows);
      current = null;
      problems.push(`Couldn't read the line for ${dated[1]}: ${line.trim().slice(0, 80)}`);
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (!isFurniture(line) && indent >= CONTINUATION_INDENT && current) {
      current.extra.push(line.trim());
    } else {
      // Furniture or a column header: the current row's description is over.
      closeRow(current, rows);
      current = null;
    }
  }
  closeRow(current, rows);

  return { period, rows, problems };
}

module.exports = { parseMutasi, parseAmount };
