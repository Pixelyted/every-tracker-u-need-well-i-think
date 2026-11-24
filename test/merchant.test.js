const test = require('node:test');
const assert = require('node:assert/strict');
const { stripCardNumbers, merchantKey } = require('../src/merchant');

const k = (text, type = '') => merchantKey({ text: stripCardNumbers(text), type });
test('card number removed even when glued to the name', () => {
  assert.equal(stripCardNumbers('TRN MASTERCARD DBTSpotify*ORDERABCDE1234567812345678/Y'), 'TRN MASTERCARD DBTSpotify*ORDERABCDE');
});
test('QR name', () => assert.equal(k('TGL: 1116 QR 490 00000.00TOKO MAKMU'), 'TOKO MAKMU'));
test('card payment, case folded', () => assert.equal(k('TRN MASTERCARD DBTGoPayID 1234567812345678/Y'), 'GOPAYID'));
test('card correction', () => assert.equal(k('KOR TRN MASTERCARDGoogle AB12CD34 10/24'), 'GOOGLE'));
test('e-banking transfer is the person', () => assert.equal(k('1211/FTSCY/WS00000 100000.00BUDI SANTOSO'), 'BUDI SANTOSO'));
test('BI-FAST transfer', () => assert.equal(k('TRANSFER KE 008 ANI WIJAYA M-BCA'), 'ANI WIJAYA'));
test('virtual account', () => assert.equal(k('0911/FTFVA/WS0000000000/NEW PLN MOBI- - 99999999999'), 'NEW PLN MOBI'));
test('empty text uses the type', () => assert.equal(k('', 'BIAYA ADM'), 'BIAYA ADM'));
test('unknown shape still gives a key', () => assert.equal(k('SETORAN TUNAI  ATM 01'), 'SETORAN TUNAI ATM 01'));
test('shop order code after * is dropped', () => assert.equal(k('TRN MASTERCARD DBTMusicShop*A1B2C3D4E5'), 'MUSICSHOP'));
test('card correction with a longer tail', () => assert.equal(k('KOR TRN MASTERCARDGoogle AB12CD34 10/24 KR OTOMATIS DB DB'), 'GOOGLE'));
test('transfer fee is one key whoever receives', () => assert.equal(k('BIAYA TXN KE 008 ANI WIJAYA M-BCA'), 'BIAYA TXN'));
test('masked card number is stripped too', () => {
  assert.equal(stripCardNumbers('TRN MASTERCARD DBTShop 1234xxxxxxxxxxxx/Y'), 'TRN MASTERCARD DBTShop');
});
