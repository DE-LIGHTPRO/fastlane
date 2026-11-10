// Basket rules shared by the shopper and checker pages. Pure functions, no DOM,
// so the same file runs under `node --test`.
//
// The fast-lane code carries only the basket id, the time it was made and
// barcode*quantity pairs. Prices are never read from the shopper's phone:
// the checker prices the basket from its own product list.

export const CODE_PREFIX = 'FL1';
export const CODE_TTL_MS = 15 * 60 * 1000;
export const CLOCK_SKEW_MS = 2 * 60 * 1000;
export const MAX_LINES = 80;
export const MAX_QTY = 99;
export const FULL_CHECK_UNITS = 25; // baskets above this get a full count, not a spot check
export const SPOT_CHECKS = 3;

// No 0/O or 1/I, and uppercase only so the QR code can use its compact alphanumeric mode.
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newBasketId(randomBytes) {
  let id = '';
  for (const b of randomBytes(6)) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return id;
}

export function addItem(items, barcode, qty = 1) {
  const next = items.map((i) => ({ ...i }));
  const found = next.find((i) => i.barcode === barcode);
  if (found) found.qty = Math.min(MAX_QTY, found.qty + qty);
  else {
    if (next.length >= MAX_LINES) throw new Error('This basket is full. Please use a normal till.');
    next.push({ barcode, qty: Math.min(MAX_QTY, qty) });
  }
  return next;
}

export function setQty(items, barcode, qty) {
  if (qty <= 0) return items.filter((i) => i.barcode !== barcode);
  return items.map((i) => (i.barcode === barcode ? { ...i, qty: Math.min(MAX_QTY, qty) } : { ...i }));
}

export function encodeBasket({ id, ts, items }) {
  if (!items.length) throw new Error('Basket is empty');
  return [CODE_PREFIX, id, String(ts), ...items.map((i) => `${i.barcode}*${i.qty}`)].join('/');
}

function parsePairs(pairs) {
  if (pairs.length > MAX_LINES) throw new Error('This basket is too large for the fast lane.');
  const seen = new Set();
  return pairs.map((p) => {
    const m = /^(\d{6,14})\*(\d{1,2})$/.exec(p);
    if (!m) throw new Error('This code is damaged (item list).');
    const qty = Number(m[2]);
    if (qty < 1 || qty > MAX_QTY) throw new Error('This code is damaged (quantity).');
    if (seen.has(m[1])) throw new Error('This code is damaged (repeated item).');
    seen.add(m[1]);
    return { barcode: m[1], qty };
  });
}

export function decodeBasket(text) {
  const parts = String(text).trim().split('/');
  if (parts[0] === ORDER_PREFIX) throw new Error('This is an order-ahead code. Scan it on the Pickup page.');
  if (parts[0] !== CODE_PREFIX) throw new Error('This is not a fast-lane code.');
  if (parts.length < 4) throw new Error('This code is incomplete.');
  const [, id, tsText, ...pairs] = parts;
  if (!/^[A-Z2-9]{6}$/.test(id)) throw new Error('This code is damaged (basket id).');
  if (!/^\d{12,14}$/.test(tsText)) throw new Error('This code is damaged (time).');
  return { id, ts: Number(tsText), items: parsePairs(pairs) };
}

// ---- Order ahead -------------------------------------------------------
// An order code is FP1/id/time ordered/pickup slot start/barcode*qty/...

export const ORDER_PREFIX = 'FP1';
export const MAX_PICKUP_QTY = 5; // per item, per order
export const PICKUP_OPEN_MIN = 8 * 60; // sample counter hours, not any store's real hours
export const PICKUP_CLOSE_MIN = 21 * 60;
export const SLOT_MIN = 30;
export const PACKING_LEAD_MIN = 30; // staff need this long before the first slot offered

export function encodeOrder({ id, ts, slot, items }) {
  if (!items.length) throw new Error('Order is empty');
  return [ORDER_PREFIX, id, String(ts), String(slot), ...items.map((i) => `${i.barcode}*${i.qty}`)].join('/');
}

export function decodeOrder(text) {
  const parts = String(text).trim().split('/');
  if (parts[0] === CODE_PREFIX) throw new Error('This is a fast-lane code. Scan it on the Checker page.');
  if (parts[0] !== ORDER_PREFIX) throw new Error('This is not an order code.');
  if (parts.length < 5) throw new Error('This code is incomplete.');
  const [, id, tsText, slotText, ...pairs] = parts;
  if (!/^[A-Z2-9]{6}$/.test(id)) throw new Error('This code is damaged (order id).');
  if (!/^\d{12,14}$/.test(tsText) || !/^\d{12,14}$/.test(slotText)) throw new Error('This code is damaged (time).');
  const items = parsePairs(pairs);
  if (items.some((i) => i.qty > MAX_PICKUP_QTY)) throw new Error('This code is damaged (quantity).');
  return { id, ts: Number(tsText), slot: Number(slotText), items };
}

// The next pickup slots, as start times in ms. Uses the device's local time.
export function pickupSlots(now, count = 4) {
  const slots = [];
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const minutesNow = Math.floor((now - day.getTime()) / 60000);
  let minute = Math.max(PICKUP_OPEN_MIN, Math.ceil((minutesNow + PACKING_LEAD_MIN) / SLOT_MIN) * SLOT_MIN);
  for (let guard = 0; slots.length < count && guard < 200; guard++) {
    if (minute + SLOT_MIN > PICKUP_CLOSE_MIN) {
      day.setDate(day.getDate() + 1);
      minute = PICKUP_OPEN_MIN;
    }
    const slot = new Date(day);
    slot.setMinutes(minute);
    slots.push(slot.getTime());
    minute += SLOT_MIN;
  }
  return slots;
}

export function sameLocalDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

// 'fresh' | 'expired' | 'future'
export function codeAge(ts, now) {
  if (ts - now > CLOCK_SKEW_MS) return 'future';
  if (now - ts > CODE_TTL_MS) return 'expired';
  return 'fresh';
}

// catalogue: Map barcode -> { name, price } with price in kobo.
export function priceBasket(items, catalogue) {
  const lines = [];
  const unknown = [];
  let total = 0;
  let units = 0;
  for (const item of items) {
    units += item.qty;
    const product = catalogue.get(item.barcode);
    if (!product) { unknown.push({ ...item }); continue; }
    const lineTotal = product.price * item.qty;
    total += lineTotal;
    lines.push({ barcode: item.barcode, qty: item.qty, name: product.name, price: product.price, lineTotal });
  }
  return { lines, unknown, total, units };
}

// Which lines the checker must find in the basket. The dearest line is always
// checked, because swapping a cheap barcode onto a dear item is the trick that
// pays best. The rest are random so a shopper cannot predict them.
export function pickSpotChecks(lines, random = Math.random) {
  if (lines.length <= SPOT_CHECKS) return lines.map((l) => l.barcode);
  const byPrice = [...lines].sort((a, b) => b.price - a.price);
  const picked = [byPrice[0].barcode];
  const pool = lines.map((l) => l.barcode).filter((b) => b !== picked[0]);
  while (picked.length < SPOT_CHECKS && pool.length) {
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return picked;
}

export function checkMode(units) {
  return units > FULL_CHECK_UNITS ? 'full' : 'spot';
}

export function formatNaira(kobo) {
  const naira = Math.floor(kobo / 100);
  const rest = kobo % 100;
  const whole = String(naira).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '₦' + whole + (rest ? '.' + String(rest).padStart(2, '0') : '');
}

export function salesToCsv(sales) {
  const esc = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  const rows = [['basket_id', 'time', 'lane', 'status', 'payment', 'barcode', 'item', 'qty', 'unit_price_naira', 'line_total_naira']];
  for (const s of sales) {
    for (const l of s.lines) {
      rows.push([s.id, new Date(s.at).toISOString(), s.lane || 'self-scan', s.status, s.method || '', l.barcode, l.name, l.qty, (l.price / 100).toFixed(2), (l.lineTotal / 100).toFixed(2)]);
    }
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
}

// ---- Receipts ------------------------------------------------------------
// After payment the checker's phone shows FR1/basket id/time paid/total in kobo/items/method.
// The shopper scans it to turn their pass into a receipt they can show at the door.

export const RECEIPT_PREFIX = 'FR1';
export const METHODS = ['cash', 'pos', 'transfer'];

export function encodeReceipt({ id, at, total, units, method }) {
  return [RECEIPT_PREFIX, id, String(at), String(total), String(units), method.toUpperCase()].join('/');
}

export function decodeReceipt(text) {
  const parts = String(text).trim().split('/');
  if (parts[0] !== RECEIPT_PREFIX) throw new Error('This is not a FastLane receipt.');
  if (parts.length !== 6) throw new Error('This receipt is incomplete.');
  const [, id, atText, totalText, unitsText, methodText] = parts;
  const method = methodText.toLowerCase();
  if (!/^[A-Z2-9]{6}$/.test(id) || !/^\d{12,14}$/.test(atText) || !/^\d{1,12}$/.test(totalText) || !/^\d{1,4}$/.test(unitsText) || !METHODS.includes(method)) {
    throw new Error('This receipt is damaged.');
  }
  return { id, at: Number(atText), total: Number(totalText), units: Number(unitsText), method };
}

export function methodLabel(method) {
  return { cash: 'Cash', pos: 'POS', transfer: 'Transfer' }[method] || method;
}
