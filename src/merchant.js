// Works out a short "who is this about?" key for each bank row, and removes
// card numbers from the row text before anything is saved.
//
// Nothing here touches files, the database or Electron: it only turns strings
// into strings, so tests can feed it made-up text.

// A card number is 16 digits, sometimes followed by "/Y" (BCA's marker).
// Masked numbers like 1234xxxxxxxxxxxx also count: 4 digits, then 12 of x/X/*/digits.
const CARD_NUMBER = /\d{4}[\dxX*]{12}(\/Y)?/g;

// WARNING: the merchant key is also part of the duplicate key (date, amount,
// direction, key). Changing a rule below changes the keys of NEW imports, so
// re-importing an old week would look like brand new rows and add them twice.
// If a rule must change, re-key the saved rows (run merchantKey over them) too.
//
// Rules for the merchant key, tried in order. Each one takes the name from
// group 1 of the match. They look at the text after card numbers are removed.
const KEY_RULES = [
  // QR payments: "QR" before the amount is what tells them apart from transfers.
  /\bQRC? \d+ 00000\.00(.+)$/,
  // Online shops add "*ORDERCODE" after the name, which changes every time.
  /^TRN MASTERCARD DBT(.+?)(\*\S+)?$/,
  // Card correction: the name is followed by an optional "AB12CD34 10/24"-style
  // tail, which may be followed by more type words ("KR OTOMATIS DB DB").
  /^KOR TRN MASTERCARD(.+?)(\s+\S+\s+\d{2}\/\d{2}\b.*)?$/,
  // The fee for a transfer carries the receiver's name, which is not a shop.
  /^(BIAYA TXN)\b/,
  // Virtual account payments.
  /\/FTFVA\/\S*?\/(.+?)-/,
  // E-banking transfers: the person's name comes after the amount.
  /\/FTSCY\/\S+\s+[\d.]+\.\d{2}(.+)$/,
  // BI-FAST transfers.
  /^TRANSFER KE \d+ (.+?) M-BCA$/,
];

// Removes card numbers, then squashes runs of spaces into one and trims.
function stripCardNumbers(text) {
  return text.replace(CARD_NUMBER, '').replace(/\s+/g, ' ').trim();
}

// Tidy a name into the form we compare with: no extra spaces, upper case.
function tidy(text) {
  return text.replace(/\s+/g, ' ').trim().toUpperCase();
}

// Some rows have no description, so the row's type stands in for the name.
function merchantKey(row) {
  if (row.text === '') return tidy(row.type);

  for (const rule of KEY_RULES) {
    const match = rule.exec(row.text);
    if (match) return tidy(match[1]);
  }

  // No rule fits: the whole text is the key.
  return tidy(row.text);
}

module.exports = { stripCardNumbers, merchantKey };
