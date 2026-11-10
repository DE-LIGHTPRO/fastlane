import qrcode from '../vendor/qrcode.js';
import { decodeBasket, codeAge, priceBasket, pickSpotChecks, checkMode, formatNaira, salesToCsv, encodeReceipt, methodLabel, MAX_QTY } from './basket.js';
import { loadSales, recordSale, clearSales, summarise } from './sales.js';
import { loadCatalogue } from './catalogue.js';
import { beep, QR_FORMATS } from './scanner.js';
import { cameraPanel } from './camera-panel.js';
import { $, escapeHtml, icon, show, toast, confirmDialog, plural, qrSvg } from './ui.js';

let catalogue = new Map();
let current = null; // { id, ts, items, extras, checks, ticked, lines, unknown, total, units, method }
let lastScan = { text: '', at: 0 };

function renderSummary() {
  const sum = summarise(loadSales());
  $('#sum-count').textContent = String(sum.count);
  $('#sum-total').textContent = formatNaira(sum.total);
  $('#sum-cash').textContent = formatNaira(sum.cash);
  $('#sum-pos').textContent = formatNaira(sum.pos);
  $('#sum-transfer').textContent = formatNaira(sum.transfer);
  $('#sum-rejected').textContent = String(sum.rejected);
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

  current = { id: basket.id, ts: basket.ts, items: basket.items, extras: [], checks: null, ticked: new Set(), method: '' };
  price();
  camera.close();
  beep(true);
  renderReview();
  show('review');
}

// Prices the shopper's items plus anything the checker added by hand.
function price() {
  const scanned = priceBasket(current.items, catalogue);
  const added = priceBasket(current.extras, catalogue);
  current.lines = [...scanned.lines, ...added.lines.map((l) => ({ ...l, added: true }))];
  current.unknown = scanned.unknown;
  current.total = scanned.total + added.total;
  current.units = scanned.units + added.units;
  // The spot checks are chosen once, from what the shopper scanned, and do not change as items are added.
  current.checks ||= new Set(checkMode(scanned.units) === 'spot' ? pickSpotChecks(scanned.lines) : []);
  current.mode = checkMode(scanned.units);
}

function renderReview() {
  const { mode, checks } = current;
  $('#r-id').textContent = current.id;
  $('#r-units').textContent = String(current.units);
  $('#r-total').textContent = formatNaira(current.total);

  setNote($('#r-unknown'), current.unknown.length
    ? `${plural(current.unknown.length, 'barcode')} not on your product list, so not in the total: ${current.unknown.map((u) => u.barcode).join(', ')}. Send this shopper to a normal till.`
    : '');

  setNote($('#r-instruction'), mode === 'full'
    ? `Large basket. Count every item: there must be exactly ${current.units}. Then tick the box.`
    : `Find each item marked Check in the basket and tick it. Then count the whole basket: it must hold exactly ${plural(current.units)}.`);

  const rows = current.lines.map((l) => {
    const check = !l.added && checks.has(l.barcode);
    const id = `chk-${l.barcode}`;
    const chip = l.added ? ' <span class="chip">Added here</span>' : check ? ' <span class="chip warn">Check</span>' : '';
    const name = escapeHtml(l.name) + chip;
    return `<li data-barcode="${l.barcode}">
      ${check ? `<input type="checkbox" class="need" id="${id}"${current.ticked.has(id) ? ' checked' : ''}>` : '<span class="gap"></span>'}
      <div class="line-main">
        <div class="line-name">${check ? `<label for="${id}">${name}</label>` : name}</div>
        <div class="line-sub num">${l.qty} &times; ${formatNaira(l.price)}</div>
      </div>
      ${l.added ? `<button class="btn sm" type="button" data-act="remove-extra" aria-label="Remove one ${escapeHtml(l.name)}">Remove</button>` : ''}
      <div class="line-total">${formatNaira(l.lineTotal)}</div>
    </li>`;
  });
  // Adding or removing an item changes the count, so the count box always starts unticked.
  rows.push(`<li>
      <input type="checkbox" class="need" id="chk-count">
      <div class="line-main"><div class="line-name"><label for="chk-count">I counted ${plural(current.units)} in the basket</label></div></div>
    </li>`);
  $('#r-lines').innerHTML = rows.join('');

  $('#extras').innerHTML = [...catalogue.values()].filter((p) => p.loose).map((p) =>
    `<button type="button" data-barcode="${p.barcode}"><span>${icon('plus')} ${escapeHtml(p.name)}</span><b class="num">${formatNaira(p.price)}</b></button>`).join('');
  updateAccept();
}

function changeExtra(barcode, delta) {
  const found = current.extras.find((e) => e.barcode === barcode);
  const qty = Math.min(MAX_QTY, (found?.qty || 0) + delta);
  current.extras = current.extras.filter((e) => e.barcode !== barcode);
  if (qty > 0) current.extras.push({ barcode, qty });
  price();
  renderReview();
}

function updateAccept() {
  const boxes = [...document.querySelectorAll('#r-lines input.need')];
  $('#accept').disabled = current.unknown.length > 0 || current.lines.length === 0 || !boxes.every((b) => b.checked);
}

function finish(status) {
  const at = Date.now();
  const paid = status === 'paid';
  recordSale({ id: current.id, at, lane: 'self-scan', status, method: paid ? current.method : '', total: current.total, units: current.units, lines: current.lines });
  $('#d-tick').classList.toggle('bad', !paid);
  $('#d-tick').innerHTML = icon(paid ? 'check' : 'x');
  $('#d-title').textContent = paid ? 'Paid' : 'Send to a normal till';
  $('#d-text').textContent = paid
    ? `Basket ${current.id}: ${formatNaira(current.total)} by ${methodLabel(current.method)}.`
    : `Basket ${current.id} did not match. A cashier must scan it again. This pass can no longer be used.`;
  $('#receipt-card').hidden = !paid;
  if (paid) {
    const qr = qrcode(0, 'M');
    qr.addData(encodeReceipt({ id: current.id, at, total: current.total, units: current.units, method: current.method }), 'Alphanumeric');
    qr.make();
    $('#rc-qr').innerHTML = qrSvg(qr, 'Receipt code for the shopper');
    $('#rc-time').textContent = time(at);
  }
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
$('#r-lines').addEventListener('change', (e) => {
  if (e.target.id && e.target.id !== 'chk-count') {
    if (e.target.checked) current.ticked.add(e.target.id);
    else current.ticked.delete(e.target.id);
  }
  updateAccept();
});
$('#r-lines').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act="remove-extra"]');
  if (btn) changeExtra(btn.closest('li').dataset.barcode, -1);
});
$('#extras').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-barcode]');
  if (!btn) return;
  changeExtra(btn.dataset.barcode, 1);
  toast(`Added ${catalogue.get(btn.dataset.barcode).name}`);
});
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
  clearSales();
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
