import { decodeBasket, codeAge, priceBasket, pickSpotChecks, checkMode, formatNaira, salesToCsv } from './basket.js';
import { loadCatalogue } from './catalogue.js';
import { beep, QR_FORMATS } from './scanner.js';
import { cameraPanel } from './camera-panel.js';
import { $, escapeHtml, icon, show, toast, confirmDialog, plural } from './ui.js';

const KEY = 'fastlane.sales';
let catalogue = new Map();
let current = null; // { id, ts, lines, unknown, total, units, method }
let lastScan = { text: '', at: 0 };

function loadSales() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function recordSale(status) {
  const sales = loadSales();
  sales.push({ id: current.id, at: Date.now(), status, method: status === 'paid' ? current.method : '', total: current.total, units: current.units, lines: current.lines });
  localStorage.setItem(KEY, JSON.stringify(sales));
}

function renderSummary() {
  const sales = loadSales();
  const paid = sales.filter((s) => s.status === 'paid');
  const by = (m) => formatNaira(paid.filter((s) => s.method === m).reduce((t, s) => t + s.total, 0));
  $('#sum-count').textContent = String(paid.length);
  $('#sum-total').textContent = formatNaira(paid.reduce((t, s) => t + s.total, 0));
  $('#sum-cash').textContent = by('cash');
  $('#sum-pos').textContent = by('pos');
  $('#sum-transfer').textContent = by('transfer');
  $('#sum-rejected').textContent = String(sales.filter((s) => s.status === 'rejected').length);
}

function setNote(el, message) {
  el.querySelector('span').textContent = message;
  el.hidden = !message;
}
function scanError(message) {
  setNote($('#scan-error'), message);
  beep(false);
}

function time(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function openBasket(text) {
  setNote($('#scan-error'), '');
  let basket;
  try {
    basket = decodeBasket(text);
  } catch (err) {
    return scanError(err.message);
  }
  const used = loadSales().find((s) => s.id === basket.id);
  if (used) {
    return scanError(used.status === 'paid'
      ? `Basket ${basket.id} was already paid at ${time(used.at)}. Do not accept it again.`
      : `Basket ${basket.id} was sent to a normal till at ${time(used.at)}. Ask the shopper to make a new pass.`);
  }
  const age = codeAge(basket.ts, Date.now());
  if (age === 'expired') return scanError('This pass is more than 15 minutes old. Ask the shopper to tap "Get a new pass".');
  if (age === 'future') return scanError('The time on this pass is wrong. Ask the shopper to check the clock on their phone.');

  const priced = priceBasket(basket.items, catalogue);
  current = { id: basket.id, ts: basket.ts, ...priced, method: '' };
  camera.close();
  beep(true);
  renderReview();
  show('review');
}

function renderReview() {
  const mode = checkMode(current.units);
  const checks = new Set(mode === 'spot' ? pickSpotChecks(current.lines) : []);
  $('#r-id').textContent = current.id;
  $('#r-units').textContent = String(current.units);
  $('#r-total').textContent = formatNaira(current.total);

  setNote($('#r-unknown'), current.unknown.length
    ? `${plural(current.unknown.length, 'barcode')} not on your product list, so not in the total: ${current.unknown.map((u) => u.barcode).join(', ')}. Send this shopper to a normal till.`
    : '');

  setNote($('#r-instruction'), mode === 'full'
    ? `Large basket. Count every item: there must be exactly ${current.units}. Then tick the box.`
    : `Find each item marked Check in the basket and tick it. Then count the whole basket: it must hold exactly ${plural(current.units)}.`);

  const rows = current.lines.map((l, i) => {
    const check = checks.has(l.barcode);
    const name = `${escapeHtml(l.name)}${check ? ' <span class="chip warn">Check</span>' : ''}`;
    return `<li>
      ${check ? `<input type="checkbox" class="need" id="chk-${i}">` : '<span class="gap"></span>'}
      <div class="line-main">
        <div class="line-name">${check ? `<label for="chk-${i}">${name}</label>` : name}</div>
        <div class="line-sub num">${l.qty} &times; ${formatNaira(l.price)}</div>
      </div>
      <div class="line-total">${formatNaira(l.lineTotal)}</div>
    </li>`;
  });
  rows.push(`<li>
      <input type="checkbox" class="need" id="chk-count">
      <div class="line-main"><div class="line-name"><label for="chk-count">I counted ${plural(current.units)} in the basket</label></div></div>
    </li>`);
  $('#r-lines').innerHTML = rows.join('');
  updateAccept();
}

function updateAccept() {
  const boxes = [...document.querySelectorAll('#r-lines input.need')];
  $('#accept').disabled = current.unknown.length > 0 || current.lines.length === 0 || !boxes.every((b) => b.checked);
}

function finish(status) {
  recordSale(status);
  const paid = status === 'paid';
  $('#d-tick').classList.toggle('bad', !paid);
  $('#d-tick').innerHTML = icon(paid ? 'check' : 'x');
  $('#d-title').textContent = paid ? 'Paid' : 'Send to a normal till';
  $('#d-text').textContent = paid
    ? `Basket ${current.id}: ${formatNaira(current.total)} by ${current.method === 'pos' ? 'POS' : current.method}. The shopper can leave.`
    : `Basket ${current.id} did not match. A cashier must scan it again. This pass can no longer be used.`;
  current = null;
  renderSummary();
  show('done');
}

const camera = cameraPanel($('#cam'), {
  formats: QR_FORMATS,
  note: $('#cam-note'),
  onCode(text) {
    const now = Date.now();
    if (text === lastScan.text && now - lastScan.at < 3000) return;
    lastScan = { text, at: now };
    openBasket(text);
  },
});

$('#paste-go').addEventListener('click', () => openBasket($('#paste').value));
$('#r-lines').addEventListener('change', updateAccept);
$('#accept').addEventListener('click', () => {
  $('#p-id').textContent = current.id;
  $('#p-total').textContent = formatNaira(current.total);
  for (const b of document.querySelectorAll('#methods .btn')) b.setAttribute('aria-pressed', 'false');
  current.method = '';
  $('#paid').disabled = true;
  show('pay');
});
$('#reject').addEventListener('click', async () => {
  const ok = await confirmDialog({ title: 'Send to a normal till?', body: 'The shopper\'s pass will stop working and a cashier must scan the basket.', confirm: 'Send to till', danger: true });
  if (ok) finish('rejected');
});
$('#methods').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-method]');
  if (!btn) return;
  current.method = btn.dataset.method;
  for (const b of document.querySelectorAll('#methods .btn')) b.setAttribute('aria-pressed', String(b === btn));
  $('#paid').disabled = false;
});
$('#paid').addEventListener('click', () => finish('paid'));
$('#back').addEventListener('click', () => show('review'));
$('#next').addEventListener('click', () => {
  $('#paste').value = '';
  lastScan = { text: '', at: 0 };
  show('scan');
  camera.open();
});
$('#export').addEventListener('click', () => {
  const sales = loadSales();
  if (!sales.length) return toast('No baskets yet this shift.', 'warn');
  const url = URL.createObjectURL(new Blob([salesToCsv(sales)], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `fastlane-sales-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
$('#clear').addEventListener('click', async () => {
  const ok = await confirmDialog({ title: 'End this shift?', body: 'Every basket recorded on this device is cleared. Download the sales file first.', confirm: 'End shift', danger: true });
  if (!ok) return;
  localStorage.removeItem(KEY);
  renderSummary();
  toast('Shift cleared');
});

try {
  catalogue = await loadCatalogue();
} catch (err) {
  scanError(err.message);
}
renderSummary();
show('scan');
