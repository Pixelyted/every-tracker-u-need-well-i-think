# Finances (💰 Treasury): design

24 November 2026. Agreed with the user in conversation. The screen layout
was picked from browser mockups (version 3: C's bars and balance chart plus
B's payments list, with a cycle switcher). Points marked **(builder's call)**
were not discussed and can be changed.

## 1. Intent and why

The user wants to **import the weekly BCA "mutasi rekening" PDFs** they
download from m-BCA. The app keeps track of their spending from those
files, so nothing has to be typed in by hand.

The user is about to start budgeting with the **50/30/20 rule**. Each month
there is **one big income**, the allowance (about 3,000,000), on no fixed
date. That pot is split into:

- **50% Needs**
- **30% Wants**
- **20% Save**: money that simply **stays in the BCA account**. It never
  moves anywhere.

The point of importing is to see **how much of the 50% and the 30% is
already used**, to look back at **previous months**, and to see the **total
balance** on its own, separate from the budget.

This is step 1 of the finances idea. It also fills the Profile's
"💰 MONEY · coming soon" slot (`ui/profile.js`, `renderMoney`). The planned
AI step comes later and may sort payments into Needs or Wants by itself, so
each payment must stay a plain row that code (or an AI) can label.

## 2. Goals

- A third tab, **💰 Treasury**, next to ⚔ Week and 🛡 Profile.
- **Import one or more BCA PDFs** with a button. The same file or an
  overlapping one can be imported again without anything being counted
  twice.
- **Budget cycles** that start when the big income arrives and run until the
  next one does.
- Each payment is labelled **Need**, **Want** or **Skip**. Labels are
  **learned per merchant** and can be fixed per payment.
- **Health bars** for Needs, Wants and Save, plus a small donut, for the
  shown cycle.
- A **payments list** for the shown cycle, with filter chips.
- **◀ ▶ through earlier cycles**, and a **📜 All cycles** table.
- A **balance** number and a small **balance chart**.
- The Profile money slot shows real numbers.
- README: the `pdftotext` requirement and the BCA-only limitation.

## 3. Non-goals (for now)

- Banks other than BCA, and other BCA formats (internet banking CSV,
  monthly e-statements).
- GoPay, OVO or any e-wallet's own history. A GoPay top-up is one payment
  to the merchant "GoPayID".
- Changing the 50/30/20 split, or extra categories (food, transport, ...).
- Typing in cash payments by hand.
- XP or quests for money.
- Sending any money data to Google or anywhere else.
- AI guessing labels (a later step).

## 4. Anti-goals (would count as failure even if it "works")

- **A payment counted twice** because a file was imported twice, or two
  weekly files overlap.
- **Real payments merged into one** because they look identical. On
  10/11 there were three separate 28,000 GoPayID charges on one day, and
  all three are real.
- **Real statements ending up in git**, in test fixtures, or anywhere
  outside the user's machine. Tests use made-up rows in the same layout.
- **A silent failure.** A file that isn't a BCA mutasi, a missing
  `pdftotext`, or a row the parser doesn't understand must show a clear
  message. Rows must never just disappear.
- Changing a merchant's label quietly overwriting a payment the user fixed
  by hand.

## 5. What a BCA mutasi PDF looks like

From six real files, read with `pdftotext -layout`. The values below are
made up but have the same layout.

Header, repeated on every page:

```
NO. REKENING                 : 000-0000-000
NAMA                         : SOME NAME
HALAMAN                      : 1/2
PERIODE                      : 09/11/2026 - 16/11/2026
MATA UANG                    : IDR
```

Then rows under `TANGGAL  KETERANGAN  MUTASI`. **A row starts on a line that
begins with a date** `DD/MM/YYYY` and ends with an amount `1,234.00` followed
by `DB` (money out) or `CR` (money in). The next 0–2 non-empty lines belong
to the same row. The last of them is the **type**:

```
16/11/2026  TGL: 1116  QR 490   00000.00TOKO MAKMU         50,000.00  DB
            TRANSAKSI DEBIT
16/11/2026  TRN MASTERCARD DBTGoPayID       1234xxxxxxxxxxxx/Y   58,500.00  DB
            DB INTERCHANGE
10/11/2026  TRN MASTERCARD DBTGoPayID       1234xxxxxxxxxxxx/Y   28,000.00  CR
            KR INTERCHANGE
29/10/2026  2910/FTSCY/WS00000  3200000.00SOME PERSON        3,200,000.00  CR
            TRSF E-BANKING CR
01/11/2026  TRANSFER KE 008 SOME PERSON M-BCA                   17,325.00  DB
            BI-FAST DB
04/11/2026                                                      15,000.00  DB
            BIAYA ADM
20/11/2026  2011/FTFVA/WS0000000000/NEW PLN MOBI-   -          151,750.00  DB
            99999999999
            TRSF E-BANKING DB
25/10/2026  KOR TRN MASTERCARDGoogle AB12CD34 10/24              10,312.00  CR
```

Facts the design relies on:

- Each file covers about **8 days** (`PERIODE`), and the newest rows come
  first.
- There is **no balance column**.
- Page breaks repeat the header and end with "Bersambung ke Halaman
  berikutnya". These lines are not rows.
- QRIS merchant names are **cut to 10 characters** ("IDM INDOMA").
- Card numbers appear in the text. The app must not store them (see 7.2).

## 6. Approaches considered

### Reading the PDF

| Approach | Trade-off |
| --- | --- |
| **A. `pdftotext -layout` (poppler, already on Fedora). Chosen.** | Very little code, readable, already proven on the real files. Needs `poppler-utils` installed, which the README documents. |
| B. PDF.js (`pdfjs-dist`) from npm | Nothing extra to install, but it gives loose words with x/y positions, so rows must be rebuilt by hand. Much more code, harder for a beginner, more fragile. |

The user chose **A** and asked for the requirement to be in the README.

### Other decisions the user made

- **When a cycle starts:** from one big income to the next, not calendar
  months (the allowance arrived on 29 Oct, not on the 1st).
- **How payments get labels:** learned per merchant, fixable per payment.
  The alternatives were "tag everything by hand" and "built-in keyword
  guesses".
- **Save** is whatever stays in the account. It isn't a transfer.
- **Screen:** mockup v3.

## 7. Design

### 7.1 Importing

- The **⬆ Import PDF** button opens a file picker (`dialog.showOpenDialog`,
  PDFs only, several files allowed) in the main process.
- For each file, the main process runs `pdftotext -layout <file> -`
  (`execFile`, never a shell) and gives the text to a **pure parser**,
  `src/bca-parse.js`, which has no Electron or file access and is easy to
  test.
- The parser returns `{ period: {start, end}, rows: [...], problems: [...] }`.
  Each row is `{ date, amount, direction: 'DB'|'CR', text, type }`:
  - `date` is `YYYY-MM-DD`;
  - `amount` is a whole number of **sen** (`50,000.00` → `5000000`), so no
    decimal maths is ever needed **(builder's call)**;
  - `text` is the description lines joined, with spaces squashed;
  - `type` is the last description line (`TRANSAKSI DEBIT`, `BIAYA ADM`,
    ...).
- If a line starts with a date but can't be read, it goes into `problems`
  instead of being dropped. If no `PERIODE` header is found, the file is
  **not a BCA mutasi** and is rejected.
- If `pdftotext` is missing (`ENOENT`), the import stops with: "Reading PDFs
  needs pdftotext. Install it with: sudo dnf install poppler-utils".
- After an import, a short summary appears: "Added 27 payments · 12 already
  known · 3 new merchants to sort", plus any problems, listed so the user can
  check them.

### 7.2 Merchant names

`src/merchant.js` turns a row into a short, stable **merchant key**. That
key is what the labels are learned on. Rules, tried in order:

| Row looks like | Merchant key |
| --- | --- |
| `TGL: ... QR(C) nnn  00000.00NAME` | `NAME` (the up-to-10 characters after `00000.00`) |
| `TRN MASTERCARD DBT<NAME> <card>/Y` | `<NAME>`, without the card number |
| `KOR TRN MASTERCARD<NAME> ...` | `<NAME>` (a correction, see 7.4) |
| `.../FTSCY/... <amount><NAME>` (e-banking transfer) | `<NAME>`, the person |
| `TRANSFER KE nnn <NAME> M-BCA` (BI-FAST) | `<NAME>` |
| `.../FTFVA/.../<NAME>-` (virtual-account payment) | `<NAME>` (e.g. "NEW PLN MOBI") |
| nothing on the first line | the type (`BIAYA ADM`) |
| anything else | the first line's text, squashed |

Keys are trimmed and upper-cased so "GoPayID" and "GOPAYID" match. Card
numbers (`\d{16}`) are removed from `text` **before it is saved**. The
account number and the name in the header are never saved.

Unknown shapes still produce a key, so new BCA row types work without
crashing. Their merchant key may just be clumsy. Real statements must
never be test fixtures, so fixtures use made-up names in these shapes.

### 7.3 Not counting twice

BCA rows have no ID. Two real payments can look exactly the same (three
28,000 GoPayID charges on one day). So duplicates are judged by **count**,
not by sameness:

- Two rows are "the same" when **date, amount, direction and merchant key**
  match. The full text is deliberately left out, so a different line wrap
  or page break in another file can't make a known row look new.
- When a file is imported, for each such group: if the file has `n` and the
  database already has `m` (from earlier imports), add `max(0, n − m)` new
  rows.
- Importing the identical file twice adds nothing. Two overlapping weeks
  add only the rows not seen before. Three identical charges stay three.

Each import also writes a row in an `imports` table (file name, period,
time, counts), so the app knows which dates are covered.

**Undoing an import:** a small **Imports** list (opened from the cycle
panel) shows each import with a delete button. Deleting removes exactly the
rows that import added (`import_id`) and its `imports` row. Labels learned
per merchant stay.

**Real-file check:** the importer's results on the user's own PDFs are
checked once on the user's machine during the build (row counts per file,
the totals, and re-importing a file adding 0). Nothing from those files is
saved into the repo.

### 7.4 Kinds of rows

Every saved row gets a **kind**, worked out once at import (re-runnable):

| Kind | Which rows | Counts toward |
| --- | --- | --- |
| `spend` | every `DB` that isn't refunded | Needs or Wants (by its label) |
| `refund` | a `CR` with type `KR INTERCHANGE`, or text starting `KOR TRN`, **plus** the `DB` it cancels | nothing (both shown as "Skipped · refunded") |
| `income` | every other `CR` | "Money in" and the balance |

- **Matching a refund to its payment** **(builder's call):** the newest
  unmatched `DB` with the same merchant key and amount, on the same day or
  up to 7 days before. If none is found (the payment was in a file never
  imported), only the `CR` is marked as a refund. The Google 10,312
  correction on 25/10 is like that.
- **Allowance (automatic):** an `income` row of at least **2,000,000** (a
  setting, `allowanceMin`, shown in Settings) **(builder's call: the
  threshold)**. The user said there is exactly one big income per month.
  If two arrive within 20 days, the second one doesn't start a new cycle;
  it just counts as money in **(builder's call)**.
- **Allowance (by hand), which the user asked for:** every `income` row in
  the payments list has a menu item **This is my allowance** or **Not my
  allowance**. It is stored in the `allowance` column (NULL = use the
  automatic rule, 1 = yes, 0 = no), and the cycles recompute at once. A
  row marked "yes" within 20 days of the previous allowance **adds to that
  cycle's pot** instead of starting a new cycle. That covers an allowance
  sent in two parts **(builder's call)**.

### 7.5 Cycles

- A **cycle** runs from the date of one allowance up to the day before the
  next allowance. The newest cycle is "now" and is still running.
- The **pot** is the allowance amount (3,200,000 → Needs 1,600,000, Wants
  960,000, Save 640,000). Other money in during the cycle (a friend paying
  back 250,000) shows under "Money in" but **doesn't grow the pot**
  **(builder's call)**. It does count toward the balance.
- Rows before the first allowance (24–28 Oct) form a **"Before tracking"**
  view: list only, with no bars and no pot.
- Cycles are **computed on the fly** from the saved rows. They aren't
  stored, so fixing a label in an old cycle updates its result at once.

### 7.6 Labels: Need, Want, Skip

- `merchant_labels` table: `merchant_key → 'need' | 'want' | 'skip'`.
- Each payment has an optional **override** (`label` column, NULL means
  "use the merchant's label").
- A payment's label is its override, else its merchant's label, else
  **unsorted (?)**.
- In the list, a payment with no label shows **Need / Want** buttons. A
  labelled one shows its tag, and clicking the tag opens the small menu
  from the mockup: **Need / Want / Skip**, then **only this payment** or
  **every <merchant> payment**.
  - *Only this payment* sets the override.
  - *Every <merchant> payment* sets the merchant label. It changes every
    payment of that merchant that has **no override**, in all cycles.
    Hand-fixed payments keep their label. (In the mockup this read "from
    now on". Changing old ones too keeps "a merchant has one label" simple,
    and older cycles get corrected the same way.) **(builder's call)**
  - The quick Need/Want buttons on an unsorted row set the **merchant
    label**, which is the "learn by merchant" part.
- Refunded payments are fixed as `skip` and show no menu.
- **Unsorted payments don't count toward Needs or Wants**, but the cycle
  panel shows "❓ 3 to sort · 122,000" so they aren't forgotten
  **(builder's call)**.

### 7.7 The numbers

For the shown cycle:

- `needsUsed` = sum of `spend` labelled need; same for `wantsUsed`.
- `needsLeft = 0.5 × pot − needsUsed`, `wantsLeft = 0.3 × pot − wantsUsed`.
- **Over:** when a slice goes past its limit, the extra shows in red.
- `saved = pot − every spend row of the cycle` (Needs, Wants, **Skip** and
  unsorted alike). The user chose this so Save always matches what really
  stays in the account. Skip only means "not a need or a want", and
  overspending also eats into Save. Refund pairs are `refund`, not
  `spend`, so they don't count. Shown against the goal `0.2 × pot`. While the cycle runs, this is "Save ·
  640k untouched" or "Save · 490k left". Once it is closed, it's the stamp
  "🪙 SAVED 450,000 · goal 600,000". It can be negative ("over by ...").
- Rounding: whole rupiah for display, sen inside.

### 7.8 Balance

The statements have no balance, so the user types it in once:

- **Set balance** (in the Balance panel): "My balance at the end of
  <date> was <amount>". The date defaults to the last date covered by an
  import. It is saved as a setting (`balanceAnchor: { date, amount }`).
- `net(a, b]` = CR − DB of all rows dated after `a`, up to and including
  `b`. Balance at the end of day `d` is:
  - `anchor.amount + net(anchor.date, d]` when `d` is on or after the
    anchor date;
  - `anchor.amount − net(d, anchor.date]` when `d` is before it, so the
    chart can go back before the anchor.

  Refund pairs cancel out by themselves.
- **The balance number** = the balance at the end of the last covered date,
  with "as of 24 Nov".
- **The balance chart:** one bar per covered day, or per week if there are
  many **(builder's call)**. The allowance shows as a jump.
- Before an anchor is set, the panel shows only the **Set balance** button.
- If the covered days have a gap (a week not imported), the panel says
  "missing 09/11–16/11, import it for a correct balance".

### 7.9 Screen (mockup v3)

```
[⚔ Week] [🛡 Profile] [💰 Treasury]
◀  29 Oct – now · this cycle  ▶   📜 All cycles
┌ THIS CYCLE · since 29 Oct ─[⬆ Import PDF]┐ ┌ PAYMENTS · 29 Oct – 24 Nov ────────┐
│ pot 3,200,000                            │ │ [All] [❓ To sort] [Needs] [Wants]  │
│ (donut)  Needs  ███████░░░  858k left    │ │ [Money in] [Skipped]               │
│          Wants  ██████████░ 350k left    │ │ 16/11 WARUNG SARI  72,000 [Need][Want]│
│          Save   ██████████  640k ok      │ │ 16/11 TOKO MAKMU  50,000  Need ▾   │
│ ❓ 3 to sort · 122,000                    │ │ 10/11 GoPayID     28,000  Skipped  │
└──────────────────────────────────────────┘ │ ...                                │
┌ 🏦 BALANCE · 2,104,560 · as of 24 Nov ────┐ │                                    │
│ ▁▇▇▆▅▅▄▄                                 │ │                                    │
└──────────────────────────────────────────┘ └────────────────────────────────────┘
```

- **◀ ▶** step through cycles (oldest: "Before tracking"). ▶ is greyed on
  the newest one.
- **📜 All cycles:** a table with one row per cycle: dates, pot, Needs used
  / limit, Wants used / limit, saved (or "running"), and ✓ when the goal is
  reached. Clicking a row opens that cycle.
- The payments list is newest first, with unsorted rows on top. The chips
  show counts, and "Money in" lists `income` rows.
- Colours **(builder's call)**: Needs use the camp green, Wants the legend
  purple, Save the gold, over-limit the curse red (existing CSS variables).
- Before any import: an empty state with the Import button and one line on
  how to download a mutasi from m-BCA.

### 7.10 Profile money slot

`renderMoney()` in `ui/profile.js` shows, for the current cycle: **spent**
(everything that left the account: needs + wants + skipped + unsorted), **money in** (income including the allowance), and the
**balance** (shown "as of DD Mon", the last day the imports cover), with a "→ Treasury" link. Before any import it keeps a short
"import a statement in 💰 Treasury" hint.

## 8. Data (schema version 4)

```sql
CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,        -- base name only, no folder
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  added INTEGER NOT NULL,
  known INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,        -- sen
  direction TEXT NOT NULL,        -- 'DB' | 'CR'
  text TEXT NOT NULL,             -- card numbers removed
  type TEXT NOT NULL,
  merchant TEXT NOT NULL,         -- merchant key
  kind TEXT NOT NULL,             -- 'spend' | 'refund' | 'income'
  label TEXT,                     -- per-payment override, NULL = merchant's
  allowance INTEGER,              -- NULL = automatic rule, 1 = yes, 0 = no
  import_id INTEGER REFERENCES imports(id)
);
CREATE TABLE IF NOT EXISTS merchant_labels (
  merchant TEXT PRIMARY KEY,
  label TEXT NOT NULL             -- 'need' | 'want' | 'skip'
);
```

New settings: `allowanceMin` (default 200000000 sen), `balanceAnchor`
(null).

## 9. Code layout (builder may adjust)

| File | What it does |
| --- | --- |
| `src/bca-parse.js` | pdftotext text → period + rows + problems (pure) |
| `src/merchant.js` | row → merchant key; strip card numbers (pure) |
| `src/finance.js` | kinds and refund matching, duplicate counting, cycles, numbers, balance (pure) |
| `src/pdf-text.js` | runs `pdftotext` with `execFile`, and handles ENOENT |
| `src/db.js` | the three tables and their load/save calls |
| `src/ipc.js` | `importStatements`, `getTreasury(cycleIndex)`, `setLabel`, `setMerchantLabel`, `setAllowance`, `setBalance`, `listImports`, `deleteImport` |
| `ui/treasury.js` | the tab |
| `ui/profile.js` | the money slot |
| `test/*.test.js` | parser, merchant, finance tests with made-up rows |

## 10. README additions

- Under **Requirements**: `pdftotext` for importing bank statements:
  `sudo dnf install poppler-utils`.
- New section **Finances (💰 Treasury)**: what it does, where money data
  lives (the same SQLite file, never sent anywhere), and **known
  limitations**: only BCA "mutasi rekening" PDFs downloaded from m-BCA,
  only IDR, the balance has to be set once by hand, and a week that was
  never imported leaves a gap.
- The code-layout table gains the new files.

## 11. Left to the builder

- The exact regular expressions, tested against made-up rows in every
  shape from section 5.
- How the label menu is drawn (it reuses the app's existing menu or form
  style).
- Chart drawing (plain CSS bars and a `conic-gradient` donut, as in the
  mockup, are enough).
- The empty and error states' wording.
