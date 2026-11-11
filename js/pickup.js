import { decodeOrder, priceBasket, sameLocalDay, formatNaira } from './basket.js';
import { loadCatalogue } from './catalogue.js';
import { loadOrders, saveOrder, findOrder, slotLabel } from './orders.js';
import { beep, QR_FORMATS } from './scanner.js';
import { cameraPanel } from './camera-panel.js';
import { $, escapeHtml, show, toast } from './ui.js';

let catalogue = new Map();
let current = null;
let lastScan = { text: '', at: 0 };

function time(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function itemsHtml(order) {
  const { lines, unknown } = priceBasket(order.items, catalogue);
  return lines.map((l) => `<li>
      <div class="line-main"><div class="line-name"><span class="num">${l.qty} &times;</span> ${escapeHtml(l.name)}</div></div>
      <div class="line-total">${formatNaira(l.lineTotal)}</div>
    </li>`).join('') + unknown.map((u) => `<li><div class="line-main"><div class="line-name">${u.qty} &times; barcode ${u.barcode} <span class="chip bad">Not on list</span></div></div></li>`).join('');
}

function card(order, action) {
  return `<div class="card order-card" data-order="${order.id}">
    <div class="order-head"><b>${order.id}</b><span class="chip neutral">${slotLabel(order.slot)}</span></div>
    ${order.payment ? `<p class="small muted">Paid by ${order.payment.method === 'card' ? 'card' : 'bank transfer'}${order.payment.mode === 'demo' ? ' (demo)' : ''}</p>` : ''}
    <ul class="lines">${itemsHtml(order)}</ul>
    <button class="btn block ${action.primary ? 'primary' : ''}" type="button" data-act="${action.act}">${action.label}</button>
  </div>`;
}

function renderBoard() {
  const orders = loadOrders().sort((a, b) => a.slot - b.slot);
  const toPack = orders.filter((o) => o.status === 'paid');
  const ready = orders.filter((o) => o.status === 'packed');
  $('#to-pack').innerHTML = toPack.map((o) => card(o, { act: 'pack', label: 'Mark as packed', primary: true })).join('');
  $('#ready').innerHTML = ready.map((o) => card(o, { act: 'open', label: 'Hand over' })).join('');
  $('#none-pack').hidden = toPack.length > 0;
  $('#none-ready').hidden = ready.length > 0;
  $('#n-pack').textContent = String(toPack.length);
  $('#n-ready').textContent = String(ready.length);
  $('#n-done').textContent = String(orders.filter((o) => o.status === 'collected' && sameLocalDay(o.collectedAt, Date.now())).length);
}

function findError(message) {
  const el = $('#find-error');
  el.querySelector('span').textContent = message;
  el.hidden = !message;
  if (message) beep(false);
}

// Accepts a scanned pass, pasted code text, or a typed order number.
function lookUp(input) {
  findError('');
  const text = String(input).trim().toUpperCase();
  if (!text) return findError('Type the order number or scan the pass.');
  let order;
  if (/^[A-Z2-9]{6}$/.test(text)) {
    order = findOrder(text);
    if (!order) return findError(`Order ${text} is not on this device. Scan the shopper's pass instead.`);
  } else {
    let decoded;
    try {
      decoded = decodeOrder(text);
    } catch (err) {
      return findError(err.message);
    }
    order = findOrder(decoded.id);
    if (!order) {
      // First time this device has seen the order: take it from the pass.
      const { total, units } = priceBasket(decoded.items, catalogue);
      order = { ...decoded, total, units, status: 'paid' };
      saveOrder(order);
    }
  }
  if (order.status === 'collected') {
    return findError(`Order ${order.id} was already collected at ${time(order.collectedAt)}. Do not hand it over again.`);
  }
  if (!sameLocalDay(order.slot, Date.now())) {
    return findError(`Order ${order.id} is for ${slotLabel(order.slot)}, not today. Send the shopper to customer service.`);
  }
  camera.close();
  beep(true);
  openHandover(order);
}

function openHandover(order) {
  current = order;
  $('#h-id').textContent = order.id;
  $('#h-slot').textContent = slotLabel(order.slot);
  $('#h-total').textContent = formatNaira(order.total);
  $('#h-lines').innerHTML = itemsHtml(order);
  $('#h-note').hidden = order.status === 'packed';
  show('handover');
}

const camera = cameraPanel($('#cam'), {
  formats: QR_FORMATS,
  note: $('#cam-note'),
  onCode(text) {
    const now = Date.now();
    if (text === lastScan.text && now - lastScan.at < 3000) return;
    lastScan = { text, at: now };
    lookUp(text);
  },
});

function board() {
  current = null;
  $('#find-id').value = '';
  renderBoard();
  show('board');
}

$('#find').addEventListener('click', () => lookUp($('#find-id').value));
$('#find-id').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookUp(e.target.value); });

for (const id of ['#to-pack', '#ready']) {
  $(id).addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const order = findOrder(btn.closest('[data-order]').dataset.order);
    if (!order) return;
    if (btn.dataset.act === 'pack') {
      saveOrder({ ...order, status: 'packed', packedAt: Date.now() });
      renderBoard();
      toast(`Order ${order.id} packed`);
    } else {
      lookUp(order.id);
    }
  });
}

$('#h-done').addEventListener('click', () => {
  saveOrder({ ...current, status: 'collected', collectedAt: Date.now() });
  $('#d-text').textContent = `Order ${current.id}, ${formatNaira(current.total)}. This pass can no longer be used.`;
  show('done');
});
$('#h-back').addEventListener('click', board);
$('#d-next').addEventListener('click', board);
// Another tab on this device may have just placed an order.
window.addEventListener('storage', () => { if (!current) renderBoard(); });

try {
  catalogue = await loadCatalogue();
} catch (err) {
  findError(err.message);
}
board();
