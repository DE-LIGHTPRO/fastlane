import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addItem, setQty, encodeBasket, decodeBasket, codeAge, priceBasket, pickSpotChecks, checkMode,
  formatNaira, salesToCsv, newBasketId, CODE_TTL_MS, CLOCK_SKEW_MS, MAX_LINES, MAX_QTY, FULL_CHECK_UNITS,
  encodeOrder, decodeOrder, pickupSlots, sameLocalDay, MAX_PICKUP_QTY,
  encodeReceipt, decodeReceipt, methodLabel,
} from '../js/basket.js';
import { searchProducts } from '../js/catalogue.js';
import { summarise } from '../js/sales.js';
import { ean13CheckDigit, isValidEan13, ean13Modules } from '../js/ean13.js';
import { readFileSync } from 'node:fs';

const products = JSON.parse(readFileSync(new URL('../data/products.json', import.meta.url), 'utf8'));
const catalogue = new Map(products.map((p) => [p.barcode, p]));
const [A, B, C, D] = products.map((p) => p.barcode);

test('EAN-13 check digit matches published examples', () => {
  assert.equal(ean13CheckDigit('400638133393'), '1'); // 4006381333931
  assert.equal(ean13CheckDigit('590123412345'), '7'); // 5901234123457
  assert.ok(isValidEan13('4006381333931'));
  assert.ok(!isValidEan13('4006381333932'));
  assert.ok(!isValidEan13('400638133393'));
});

test('EAN-13 module pattern is 95 wide with guards in place', () => {
  const bits = ean13Modules('5901234123457');
  assert.equal(bits.length, 95);
  assert.equal(bits.slice(0, 3), '101');
  assert.equal(bits.slice(45, 50), '01010');
  assert.equal(bits.slice(92), '101');
});

test('every sample product has a valid, unique in-store barcode and a whole-kobo price', () => {
  assert.equal(new Set(products.map((p) => p.barcode)).size, products.length);
  for (const p of products) {
    assert.ok(isValidEan13(p.barcode), p.barcode);
    assert.ok(p.barcode.startsWith(p.loose ? '299' : '200'), 'in-store prefix');
    assert.ok(Number.isInteger(p.price) && p.price > 0);
  }
});

test('adding the same barcode raises the quantity, capped at the maximum', () => {
  let items = addItem([], A);
  items = addItem(items, A);
  assert.deepEqual(items, [{ barcode: A, qty: 2 }]);
  items = addItem(items, A, 500);
  assert.equal(items[0].qty, MAX_QTY);
});

test('a basket refuses more lines than the limit', () => {
  let items = [];
  for (let i = 0; i < MAX_LINES; i++) items = addItem(items, String(10000000 + i));
  assert.throws(() => addItem(items, '99999999'), /full/);
});

test('setting quantity to zero removes the line', () => {
  const items = setQty([{ barcode: A, qty: 2 }, { barcode: B, qty: 1 }], A, 0);
  assert.deepEqual(items, [{ barcode: B, qty: 1 }]);
});

test('a code round-trips and uses only QR alphanumeric characters', () => {
  const basket = { id: 'ABCDEF', ts: 1794300000000, items: [{ barcode: A, qty: 2 }, { barcode: B, qty: 1 }] };
  const text = encodeBasket(basket);
  assert.match(text, /^[0-9A-Z $%*+\-./:]+$/);
  assert.deepEqual(decodeBasket(text), basket);
});

test('damaged or foreign codes are refused', () => {
  const good = encodeBasket({ id: 'ABCDEF', ts: 1794300000000, items: [{ barcode: A, qty: 2 }] });
  assert.throws(() => decodeBasket('https://example.com'), /not a fast-lane code/);
  assert.throws(() => decodeBasket('FL1/ABCDEF/1794300000000'), /incomplete/);
  assert.throws(() => decodeBasket(good.replace('ABCDEF', 'abcdef')), /basket id/);
  assert.throws(() => decodeBasket(good.replace('*2', '*0')), /quantity/);
  assert.throws(() => decodeBasket(good.replace('*2', '*200')), /item list/);
  assert.throws(() => decodeBasket(good + '/' + A + '*1'), /repeated/);
  assert.throws(() => decodeBasket(good + '/12AB*1'), /item list/);
  assert.throws(() => encodeBasket({ id: 'ABCDEF', ts: 1, items: [] }), /empty/);
});

test('a code is fresh for 15 minutes, then expired; far-future times are refused', () => {
  const now = 1794300000000;
  assert.equal(codeAge(now, now), 'fresh');
  assert.equal(codeAge(now - CODE_TTL_MS, now), 'fresh');
  assert.equal(codeAge(now - CODE_TTL_MS - 1, now), 'expired');
  assert.equal(codeAge(now + CLOCK_SKEW_MS, now), 'fresh');
  assert.equal(codeAge(now + CLOCK_SKEW_MS + 1, now), 'future');
});

test('the basket is priced from the catalogue, and unknown barcodes are kept out of the total', () => {
  const priced = priceBasket([{ barcode: A, qty: 3 }, { barcode: '12345678', qty: 2 }], catalogue);
  assert.equal(priced.total, catalogue.get(A).price * 3);
  assert.equal(priced.units, 5);
  assert.deepEqual(priced.unknown, [{ barcode: '12345678', qty: 2 }]);
  assert.equal(priced.lines.length, 1);
});

test('spot checks always include the dearest line and never repeat', () => {
  const { lines } = priceBasket([A, B, C, D, products[5].barcode, products[22].barcode].map((barcode) => ({ barcode, qty: 1 })), catalogue);
  const dearest = [...lines].sort((a, b) => b.price - a.price)[0].barcode;
  for (let i = 0; i < 200; i++) {
    const picks = pickSpotChecks(lines);
    assert.equal(picks.length, 3);
    assert.equal(new Set(picks).size, 3);
    assert.ok(picks.includes(dearest));
  }
  assert.deepEqual(pickSpotChecks(lines.slice(0, 2)), lines.slice(0, 2).map((l) => l.barcode));
});

test('large baskets get a full count', () => {
  assert.equal(checkMode(FULL_CHECK_UNITS), 'spot');
  assert.equal(checkMode(FULL_CHECK_UNITS + 1), 'full');
});

test('naira formatting', () => {
  assert.equal(formatNaira(0), '₦0');
  assert.equal(formatNaira(35000), '₦350');
  assert.equal(formatNaira(1350000), '₦13,500');
  assert.equal(formatNaira(123456789), '₦1,234,567.89');
  assert.equal(formatNaira(105), '₦1.05');
});

test('basket ids use the safe alphabet', () => {
  const id = newBasketId((n) => Uint8Array.from({ length: n }, (_, i) => i * 37));
  assert.match(id, /^[A-Z2-9]{6}$/);
  assert.doesNotMatch(id, /[O0I1]/);
});

test('sales export quotes commas and has one row per line', () => {
  const { lines, total, units } = priceBasket([{ barcode: A, qty: 2 }, { barcode: B, qty: 1 }], catalogue);
  const csv = salesToCsv([{ id: 'ABCDEF', at: 1794300000000, status: 'paid', method: 'cash', total, units, lines }]);
  const rows = csv.trim().split('\n');
  assert.equal(rows.length, 3);
  assert.ok(rows[1].includes('"Instant noodles, chicken 70g"'));
  assert.ok(rows[1].endsWith(',2,350.00,700.00'));
  assert.equal(rows[0], 'basket_id,time,lane,status,payment,barcode,item,qty,unit_price_naira,line_total_naira');
  assert.ok(rows[1].includes(',self-scan,paid,cash,'));
  const staff = salesToCsv([{ id: 'ABCDEF', at: 1794300000000, lane: 'staff-scan', status: 'paid', method: 'pos', total, units, lines }]);
  assert.ok(staff.includes(',staff-scan,paid,pos,'));
});

test('an order code round-trips and uses only QR alphanumeric characters', () => {
  const order = { id: 'KM4T7Q', ts: 1794300000000, slot: 1794303600000, items: [{ barcode: A, qty: 2 }, { barcode: B, qty: 5 }] };
  const text = encodeOrder(order);
  assert.match(text, /^[0-9A-Z $%*+\-./:]+$/);
  assert.deepEqual(decodeOrder(text), order);
});

test('order codes and fast-lane codes are not accepted in each other\'s place', () => {
  const order = encodeOrder({ id: 'KM4T7Q', ts: 1794300000000, slot: 1794303600000, items: [{ barcode: A, qty: 1 }] });
  const basket = encodeBasket({ id: 'ABCDEF', ts: 1794300000000, items: [{ barcode: A, qty: 1 }] });
  assert.throws(() => decodeBasket(order), /order-ahead code/);
  assert.throws(() => decodeOrder(basket), /fast-lane code/);
  assert.throws(() => decodeOrder('hello'), /not an order code/);
  assert.throws(() => decodeOrder('FP1/KM4T7Q/1794300000000/' + A + '*1'), /incomplete|time/);
  assert.throws(() => decodeOrder(order.replace('*1', '*' + (MAX_PICKUP_QTY + 1))), /quantity/);
});

test('pickup slots start after the packing lead time, on the half hour', () => {
  const at = (h, m) => new Date(2026, 10, 14, h, m).getTime();
  assert.deepEqual(pickupSlots(at(18, 10)), [at(19, 0), at(19, 30), at(20, 0), at(20, 30)]);
  assert.deepEqual(pickupSlots(at(18, 0), 1), [at(18, 30)]);
  assert.deepEqual(pickupSlots(at(6, 0), 2), [at(8, 0), at(8, 30)]);
});

test('pickup slots roll over to the next morning when the counter is closing', () => {
  const at = (d, h, m) => new Date(2026, 10, d, h, m).getTime();
  assert.deepEqual(pickupSlots(at(14, 19, 40), 3), [at(14, 20, 30), at(15, 8, 0), at(15, 8, 30)]);
  assert.deepEqual(pickupSlots(at(14, 22, 0), 2), [at(15, 8, 0), at(15, 8, 30)]);
  // The last day of a month rolls into the next month.
  assert.deepEqual(pickupSlots(new Date(2026, 10, 30, 22, 0).getTime(), 1), [new Date(2026, 11, 1, 8, 0).getTime()]);
});

test('same-day check uses the calendar day, not 24 hours', () => {
  const at = (d, h) => new Date(2026, 10, d, h, 0).getTime();
  assert.ok(sameLocalDay(at(14, 1), at(14, 23)));
  assert.ok(!sameLocalDay(at(14, 23), at(15, 1)));
});

test('eight sample products are offered for pickup, bread among them', () => {
  const offered = products.filter((p) => p.pickup);
  assert.equal(offered.length, 8);
  assert.ok(offered.some((p) => /bread/i.test(p.name)));
});

test('a receipt round-trips and uses only QR alphanumeric characters', () => {
  const receipt = { id: 'ABCDEF', at: 1794300000000, total: 2100000, units: 4, method: 'transfer' };
  const text = encodeReceipt(receipt);
  assert.match(text, /^[0-9A-Z $%*+\-./:]+$/);
  assert.deepEqual(decodeReceipt(text), receipt);
  assert.equal(methodLabel('pos'), 'POS');
});

test('passes and damaged codes are not accepted as receipts', () => {
  const good = encodeReceipt({ id: 'ABCDEF', at: 1794300000000, total: 5000, units: 1, method: 'cash' });
  assert.throws(() => decodeReceipt(encodeBasket({ id: 'ABCDEF', ts: 1794300000000, items: [{ barcode: A, qty: 1 }] })), /not a FastLane receipt/);
  assert.throws(() => decodeReceipt(good + '/EXTRA'), /incomplete/);
  assert.throws(() => decodeReceipt(good.replace('CASH', 'CHEQUE')), /damaged/);
  assert.throws(() => decodeReceipt(good.replace('/5000/', '/-5/')), /damaged/);
});

test('items without a barcode are never offered to shoppers in search', () => {
  const loose = products.filter((p) => p.loose);
  assert.equal(loose.length, 3);
  assert.deepEqual(searchProducts(catalogue, 'bakery loaf'), []);
  assert.deepEqual(searchProducts(catalogue, loose[0].barcode), []);
  assert.equal(searchProducts(catalogue, 'rice')[0].name, 'Long grain rice 5kg');
});

test('the shift summary splits takings by payment method and counts staff scans', () => {
  const sale = (extra) => ({ id: 'X', at: 1, status: 'paid', method: 'cash', total: 1000, lines: [], ...extra });
  const sum = summarise([sale({}), sale({ method: 'pos', total: 2500, lane: 'staff-scan' }), sale({ status: 'rejected', method: '', total: 9999 })]);
  assert.deepEqual(sum, { count: 2, total: 3500, cash: 1000, pos: 2500, transfer: 0, rejected: 1, staffScanned: 1 });
});
