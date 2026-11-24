// Made-up BCA "mutasi rekening" text in the same layout `pdftotext -layout`
// gives for real statements. All names and numbers are invented.
const HEADER = (page, pages, period) => `                                                                         MUTASI REKENING
NO. REKENING                 : 000-0000-000
NAMA                         : TEST PERSON
HALAMAN                      : ${page}/${pages}
JENIS TRANSAKSI              : SEMUA
PERIODE                      : ${period}
MATA UANG                    : IDR


CATATAN:
Apabila nasabah tidak melakukan sanggahan atas Laporan Mutasi Rekening ini sampai   BCA berhak setiap saat melakukan koreksi apabila ada kesalahan pada Laporan Mutasi
dengan akhir bulan berikutnya, nasabah dianggap telah menyetujui segala data yang   Rekening
tercantum pada Laporan Mutasi Rekening ini.


      TANGGAL                                                      KETERANGAN                                                               MUTASI
`;
const row = (date, desc, amount, dir, ...more) =>
  `\n      ${date}            ${desc.padEnd(90)}${amount.padStart(14)}          ${dir}\n` +
  more.map((l) => `                            ${l}\n`).join('') + '\n';

const WEEK_A =
  HEADER(1, 2, '09/11/2026 - 16/11/2026') +
  row('16/11/2026', 'TGL: 1116  QR 490                   00000.00TOKO MAKMU', '50,000.00', 'DB', 'TRANSAKSI DEBIT') +
  row('16/11/2026', 'TRN MASTERCARD DBTGoPayID                          1234567812345678/Y', '28,000.00', 'DB', 'DB INTERCHANGE') +
  row('16/11/2026', 'TRN MASTERCARD DBTGoPayID                          1234567812345678/Y', '28,000.00', 'DB', 'DB INTERCHANGE') +
  row('16/11/2026', 'TRN MASTERCARD DBTGoPayID                          1234567812345678/Y', '28,000.00', 'CR', 'KR INTERCHANGE') +
  row('12/11/2026', '1211/FTSCY/WS00000                  100000.00BUDI SANTOSO', '100,000.00', 'CR', 'TRSF E-BANKING CR') +
  '\n                                                                                                                                 Bersambung ke Halaman berikutnya\n' +
  HEADER(2, 2, '09/11/2026 - 16/11/2026') +
  row('10/11/2026', 'TRANSFER KE 008 ANI WIJAYA M-BCA', '17,325.00', 'DB', 'BI-FAST DB') +
  row('10/11/2026', '', '2,500.00', 'DB', 'BIAYA ADM') +
  row('09/11/2026', '0911/FTFVA/WS0000000000/NEW PLN MOBI-                                -', '151,750.00', 'DB', '99999999999', 'TRSF E-BANKING DB') +
  row('09/11/2026', '0911/FTSCY/WS00000                  3200000.00BUDI SANTOSO', '3,200,000.00', 'CR', 'TRSF E-BANKING CR');

const WEEK_B =
  HEADER(1, 1, '16/11/2026 - 23/11/2026') +
  row('23/11/2026', 'TGL: 1123  QRC 014                   00000.00IDM INDOMA', '22,900.00', 'DB', 'TRANSAKSI DEBIT') +
  row('16/11/2026', 'TGL: 1116  QR 490                   00000.00TOKO MAKMU', '50,000.00', 'DB', 'TRANSAKSI DEBIT') +
  row('16/11/2026', 'TRN MASTERCARD DBTGoPayID                          1234567812345678/Y', '28,000.00', 'DB', 'DB INTERCHANGE') +
  row('16/11/2026', 'TRN MASTERCARD DBTGoPayID                          1234567812345678/Y', '28,000.00', 'DB', 'DB INTERCHANGE') +
  row('16/11/2026', 'TRN MASTERCARD DBTGoPayID                          1234567812345678/Y', '28,000.00', 'CR', 'KR INTERCHANGE');

const NOT_BCA = 'Invoice\nTotal: 50,000.00\n';

module.exports = { HEADER, row, WEEK_A, WEEK_B, NOT_BCA };
