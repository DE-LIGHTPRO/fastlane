import qrcode from '../vendor/qrcode.js';
import { encodeOrder, priceBasket, newBasketId, pickupSlots, formatNaira, MAX_PICKUP_QTY } from './basket.js';
import { loadCatalogue } from './catalogue.js';
import { saveOrder, findOrder, slotLabel, slotParts } from './orders.js';
import { liveMode, takePayment } from './payments.js';
import { $, escapeHtml, icon, show, setProgress, toast, plural, qrSvg, keepAwake } from './ui.js';

const DRAFT = 'fastlane.order.draft';
const LAST = 'fastlane.order.last';
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

let catalogue = new Map();
let offered = [];
let items = loadDraft();
let slot = 0;
let method = '';
let releaseWake = () => {};

function loadDraft() {
  try {
    const list = JSON.parse(localStorage.getItem(DRAFT) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function saveDraft() { localStorage.setItem(DRAFT, JSON.stringify(items)); }
function qtyOf(barcode) { return items.find((i) => i.barcode === barcode)?.qty || 0; }

function renderBrowse() {
  $('#list').innerHTML = offered.map((p) => {
    const qty = qtyOf(p.barcode);
    return `<li data-barcode="${p.barcode}">
      <div class="line-main">
        <div class="line-name">${escapeHtml(p.name)}</div>
        <div class="line-sub num">${formatNaira(p.price)}</div>
      </div>
      <div class="qty">
        <button type="button" data-act="less" aria-label="One less ${escapeHtml(p.name)}"${qty ? '' : ' disabled'}>${icon('minus')}</button>
        <output aria-label="Quantity">${qty}</output>
        <button type="button" data-act="more" aria-label="One more ${escapeHtml(p.name)}"${qty >= MAX_PICKUP_QTY ? ' disabled' : ''}>${icon('plus')}</button>
      </div>
    </li>`;
  }).join('');
  const { total, units } = priceBasket(items, catalogue);
  $('#total').textContent = formatNaira(total);
  $('#units').textContent = plural(units);
  $('#next').disabled = units === 0;
}

function linesHtml(lines) {
  return lines.map((l) => `<li>
      <div class="line-main"><div class="line-name">${escapeHtml(l.name)}</div><div class="line-sub num">${l.qty} &times; ${formatNaira(l.price)}</div></div>
      <div class="line-total">${formatNaira(l.lineTotal)}</div>
    </li>`).join('');
}

function showBrowse() {
  releaseWake();
  setProgress(0);
  show('browse');
  $('#bar').hidden = false;
  renderBrowse();
}

function showTime() {
  const { lines, total } = priceBasket(items, catalogue);
  slot = 0;
  $('#slots').innerHTML = pickupSlots(Date.now()).map((s) => {
    const { day, range } = slotParts(s);
    return `<button class="btn" type="button" data-slot="${s}" aria-pressed="false"><span>${range}</span><small>${day}</small></button>`;
  }).join('');
  $('#summary').innerHTML = linesHtml(lines);
  $('#t-total').textContent = formatNaira(total);
  $('#to-pay').disabled = true;
  $('#bar').hidden = true;
  setProgress(1);
  show('time');
}

async function showCode(order) {
  const { lines } = priceBasket(order.items, catalogue);
  const qr = qrcode(0, 'M');
  qr.addData(encodeOrder(order), 'Alphanumeric');
  qr.make();
  $('#qr').innerHTML = qrSvg(qr, 'Your pickup pass');
  $('#c-id').textContent = order.id;
  $('#c-slot').textContent = slotLabel(order.slot);
  $('#c-total').textContent = formatNaira(order.total);
  $('#c-lines').innerHTML = linesHtml(lines);
  $('#bar').hidden = true;
  $('#c-method').textContent = order.payment ? (order.payment.method === 'card' ? 'Card' : 'Bank transfer') : 'Demo';
  setProgress(4);
  show('code');
  releaseWake();
  releaseWake = await keepAwake();
}

$('#list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const barcode = btn.closest('li').dataset.barcode;
  const qty = Math.max(0, Math.min(MAX_PICKUP_QTY, qtyOf(barcode) + (btn.dataset.act === 'more' ? 1 : -1)));
  items = items.filter((i) => i.barcode !== barcode);
  if (qty) items.push({ barcode, qty });
  // Keep the order in shelf-list order so the packing list reads the same way every time.
  items.sort((a, b) => offered.findIndex((p) => p.barcode === a.barcode) - offered.findIndex((p) => p.barcode === b.barcode));
  saveDraft();
  renderBrowse();
  const row = $(`#list li[data-barcode="${barcode}"]`);
  (row.querySelector(`button[data-act="${btn.dataset.act}"]:not(:disabled)`) || row.querySelector('button:not(:disabled)'))?.focus();
});

$('#next').addEventListener('click', showTime);
$('#back').addEventListener('click', showBrowse);
$('#slots').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-slot]');
  if (!btn) return;
  slot = Number(btn.dataset.slot);
  for (const b of document.querySelectorAll('#slots .btn')) b.setAttribute('aria-pressed', String(b === btn));
  $('#to-pay').disabled = false;
});

// ---- Payment ---------------------------------------------------------------
function showPay() {
  const { total } = priceBasket(items, catalogue);
  method = '';
  $('#pay-total').textContent = formatNaira(total);
  $('#pay-slot').textContent = 'Pickup ' + slotLabel(slot);
  $('#transfer-amount').textContent = formatNaira(total);
  for (const b of document.querySelectorAll('#pm .btn')) b.setAttribute('aria-pressed', 'false');
  $('#transfer-box').hidden = true;
  $('#email-field').hidden = !liveMode;
  $('#demo-note').hidden = liveMode;
  $('#live-note').hidden = !liveMode;
  $('#pay').textContent = 'Pay ' + formatNaira(total);
  $('#pay').disabled = true;
  setProgress(2);
  show('pay');
}

$('#to-pay').addEventListener('click', showPay);
$('#pay-back').addEventListener('click', showTime);
$('#pm').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-method]');
  if (!btn) return;
  method = btn.dataset.method;
  for (const b of document.querySelectorAll('#pm .btn')) b.setAttribute('aria-pressed', String(b === btn));
  // In demo mode the transfer option shows where the money would go. With a payment
  // provider connected, the provider shows its own account details instead.
  $('#transfer-box').hidden = liveMode || method !== 'transfer';
  const { total } = priceBasket(items, catalogue);
  $('#pay').textContent = !liveMode && method === 'transfer' ? 'I have sent ' + formatNaira(total) : 'Pay ' + formatNaira(total);
  $('#pay').disabled = false;
});

$('#pay').addEventListener('click', async () => {
  const { total, units } = priceBasket(items, catalogue);
  const email = $('#email').value.trim();
  if (liveMode && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    $('#email').focus();
    return toast('Enter your email address for the receipt.', 'warn');
  }
  const id = newBasketId(randomBytes);
  $('#paying-text').textContent = method === 'transfer' ? 'Waiting for your transfer to arrive. Keep this page open.' : 'This takes a moment. Keep this page open.';
  show('paying');
  let payment;
  try {
    payment = await takePayment({ amount: total, email, reference: `FL-${id}-${Date.now()}`, method });
  } catch (err) {
    showPay();
    return toast(err.message, 'warn');
  }
  if (!payment) { // the shopper closed the payment window
    showPay();
    return toast('Payment was cancelled. Nothing was charged.', 'warn');
  }
  const order = { id, ts: Date.now(), slot, items, total, units, status: 'paid', payment };
  saveOrder(order);
  localStorage.setItem(LAST, order.id);
  items = [];
  saveDraft();
  showCode(order);
});

$('#again').addEventListener('click', () => {
  localStorage.removeItem(LAST);
  showBrowse();
});

try {
  catalogue = await loadCatalogue();
  offered = [...catalogue.values()].filter((p) => p.pickup);
  items = items.filter((i) => catalogue.get(i.barcode)?.pickup);
} catch (err) {
  toast(err.message, 'warn');
}
const last = findOrder(localStorage.getItem(LAST) || '');
if (last && last.status !== 'collected') showCode(last);
else showBrowse();
