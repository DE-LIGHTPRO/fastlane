import { decodeBasket, codeAge, priceBasket, pickSpotChecks, checkMode, formatNaira, salesToCsv } from './basket.js';
import { loadCatalogue } from './catalogue.js';
import { startCamera, cameraProblem, beep, QR_FORMATS } from './scanner.js';
import { $, escapeHtml, show, toast } from './ui.js';

const KEY = 'fastlane.sales';
let catalogue = new Map();
let stopCamera = null;
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
  const by = (m) => paid.filter((s) => s.method === m).reduce((t, s) => t + s.total, 0);
  $('#sum-count').textContent = String(paid.length);
  $('#sum-total').textContent = formatNaira(paid.reduce((t, s) => t + s.total, 0));
  $('#sum-split').textContent = `${formatNaira(by('cash'))} / ${formatNaira(by('pos'))} / ${formatNaira(by('transfer'))}`;
  $('#sum-rejected').textContent = String(sales.filter((s) => s.status === 'rejected').length);
}

function scanError(message) {
  $('#scan-error').textContent = message;
  $('#scan-error').hidden = false;
  beep(false);
}

function count(n) { return n === 1 ? '1 item' : n + ' items'; }

function time(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function openBasket(text) {
  $('#scan-error').hidden = true;
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
      : `Basket ${basket.id} was sent to a normal till at ${time(used.at)}. Ask the shopper to make a new code.`);
  }
  const age = codeAge(basket.ts, Date.now());
  if (age === 'expired') return scanError('This code is more than 15 minutes old. Ask the shopper to tap "Change my basket", then show the code again.');
  if (age === 'future') return scanError('The time on this code is wrong. Ask the shopper to check the clock on their phone.');

  const priced = priceBasket(basket.items, catalogue);
  current = { id: basket.id, ts: basket.ts, ...priced, method: '' };
  closeCamera();
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

  const unknown = $('#r-unknown');
  unknown.hidden = current.unknown.length === 0;
  unknown.textContent = current.unknown.length
    ? `${current.unknown.length} barcode(s) are not on your product list and are not in the total: ${current.unknown.map((u) => u.barcode).join(', ')}. Send this shopper to a normal till.`
    : '';

  $('#r-instruction').textContent = mode === 'full'
    ? `Large basket. Count every item: there must be exactly ${current.units}. Then tick the box.`
    : `Find each item marked Check in the basket and tick it. Then count the whole basket: it must hold exactly ${count(current.units)}.`;

  const rows = current.lines.map((l) => {
    const check = checks.has(l.barcode);
    return `<li>
      ${check ? `<input type="checkbox" class="need" aria-label="Found ${escapeHtml(l.name)}">` : '<span style="width:24px"></span>'}
      <div class="line-main">
        <div class="line-name">${escapeHtml(l.name)}${check ? '<span class="tag">Check</span>' : ''}</div>
        <div class="line-sub">${l.qty} &times; ${formatNaira(l.price)}</div>
      </div>
      <div class="line-total">${formatNaira(l.lineTotal)}</div>
    </li>`;
  });
  rows.push(`<li>
      <input type="checkbox" class="need" id="count-ok" aria-label="Item count is right">
      <div class="line-main"><div class="line-name">I counted ${count(current.units)} in the basket</div></div>
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
  $('#d-icon').setAttribute('d', paid ? 'M5 12.5l4.5 4.5L19 7.5' : 'M6 6l12 12M18 6L6 18');
  $('#d-title').textContent = paid ? 'Paid' : 'Send to a normal till';
  $('#d-text').textContent = paid
    ? `Basket ${current.id}: ${formatNaira(current.total)} by ${current.method === 'pos' ? 'POS' : current.method}. The shopper can leave.`
    : `Basket ${current.id} did not match. A cashier must scan it again. This code can no longer be used.`;
  current = null;
  renderSummary();
  show('done');
}

async function openCamera() {
  if (stopCamera) return;
  $('#cam-note').hidden = true;
  try {
    stopCamera = await startCamera($('#video'), (text) => {
      const now = Date.now();
      if (text === lastScan.text && now - lastScan.at < 3000) return;
      lastScan = { text, at: now };
      openBasket(text);
    }, QR_FORMATS);
    $('#cam-idle').hidden = true;
    $('#aim').hidden = false;
  } catch (err) {
    $('#cam-note').textContent = cameraProblem(err);
    $('#cam-note').hidden = false;
  }
}
function closeCamera() {
  stopCamera?.();
  stopCamera = null;
  $('#cam-idle').hidden = false;
  $('#aim').hidden = true;
}

$('#cam-on').addEventListener('click', openCamera);
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
$('#reject').addEventListener('click', () => {
  if (confirm('Send this shopper to a normal till? Their code will stop working.')) finish('rejected');
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
  openCamera();
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
$('#clear').addEventListener('click', () => {
  if (!confirm('Clear every basket recorded this shift? Download the sales file first.')) return;
  localStorage.removeItem(KEY);
  renderSummary();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) closeCamera(); });

try {
  catalogue = await loadCatalogue();
} catch (err) {
  scanError(err.message);
}
renderSummary();
show('scan');
