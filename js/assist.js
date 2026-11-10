// Staff-scan mode: a member of staff scans a shopper's basket in the queue and takes payment.
// Because staff do the scanning, there is no spot check.
import { addItem, setQty, priceBasket, newBasketId, formatNaira, methodLabel, MAX_QTY } from './basket.js';
import { loadCatalogue, searchProducts } from './catalogue.js';
import { recordSale } from './sales.js';
import { beep, PRODUCT_FORMATS } from './scanner.js';
import { cameraPanel } from './camera-panel.js';
import { $, escapeHtml, icon, show, toast, confirmDialog, plural } from './ui.js';

const KEY = 'fastlane.assist';
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

let catalogue = new Map();
let items = load();
let method = '';
let last = { code: '', at: 0 };

function load() {
  try {
    const list = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function save() { sessionStorage.setItem(KEY, JSON.stringify(items)); }

function render(flash = '') {
  const { lines, total, units } = priceBasket(items, catalogue);
  $('#empty').hidden = lines.length > 0;
  $('#clear').hidden = lines.length === 0;
  $('#lines').innerHTML = lines.map((l) => `
    <li data-barcode="${l.barcode}"${l.barcode === flash ? ' class="flash"' : ''}>
      <div class="line-main">
        <div class="line-name">${escapeHtml(l.name)}</div>
        <div class="line-sub num">${formatNaira(l.price)} each</div>
      </div>
      <div class="qty">
        <button type="button" data-act="less" aria-label="One less ${escapeHtml(l.name)}">${icon('minus')}</button>
        <output aria-label="Quantity">${l.qty}</output>
        <button type="button" data-act="more" aria-label="One more ${escapeHtml(l.name)}"${l.qty >= MAX_QTY ? ' disabled' : ''}>${icon('plus')}</button>
      </div>
      <div class="line-total">${formatNaira(l.lineTotal)}</div>
    </li>`).join('');
  $('#total').textContent = formatNaira(total);
  $('#units').textContent = plural(units);
  $('#basket-count').textContent = plural(units);
  $('#done').disabled = lines.length === 0;
  return { lines, total, units };
}

function add(barcode) {
  const product = catalogue.get(barcode);
  if (!product) {
    beep(false);
    toast(`Barcode ${barcode} is not on the product list. Take this item to a normal till.`, 'warn');
    return;
  }
  try {
    items = addItem(items, barcode);
  } catch (err) {
    beep(false);
    toast(err.message, 'warn');
    return;
  }
  save();
  render(barcode);
  beep(true);
  toast(`Added ${product.name}, ${formatNaira(product.price)}`);
}

const camera = cameraPanel($('#cam'), {
  formats: PRODUCT_FORMATS,
  note: $('#cam-note'),
  onCode(code) {
    const now = Date.now();
    // Count a barcode once while it stays in view.
    const stillInView = code === last.code && now - last.at < 1200;
    last = { code, at: now };
    if (!stillInView) add(code);
  },
});

function showScan() {
  show('scan');
  $('#bar').hidden = false;
  render();
}

$('#lines').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const barcode = btn.closest('li').dataset.barcode;
  const item = items.find((i) => i.barcode === barcode);
  if (!item) return;
  items = setQty(items, barcode, btn.dataset.act === 'more' ? Math.min(MAX_QTY, item.qty + 1) : item.qty - 1);
  save();
  render();
  $(`#lines li[data-barcode="${barcode}"] button[data-act="${btn.dataset.act}"]:not(:disabled)`)?.focus();
});

$('#search').addEventListener('input', (e) => {
  $('#results').innerHTML = searchProducts(catalogue, e.target.value).map((p) =>
    `<button type="button" data-barcode="${p.barcode}"><span>${escapeHtml(p.name)}</span><b class="num">${formatNaira(p.price)}</b></button>`).join('');
});
$('#results').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-barcode]');
  if (!btn) return;
  add(btn.dataset.barcode);
  $('#search').value = '';
  $('#results').innerHTML = '';
});
$('#extras').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-barcode]');
  if (btn) add(btn.dataset.barcode);
});

$('#clear').addEventListener('click', async () => {
  const ok = await confirmDialog({ title: 'Clear this basket?', body: 'Every item scanned for this shopper is removed.', confirm: 'Clear basket', danger: true });
  if (!ok) return;
  items = [];
  save();
  render();
});

$('#done').addEventListener('click', () => {
  const { total, units } = render();
  camera.close();
  method = '';
  for (const b of document.querySelectorAll('#methods .btn')) b.setAttribute('aria-pressed', 'false');
  $('#paid').disabled = true;
  $('#p-total').textContent = formatNaira(total);
  $('#p-units').textContent = plural(units);
  $('#bar').hidden = true;
  show('pay');
});
$('#methods').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-method]');
  if (!btn) return;
  method = btn.dataset.method;
  for (const b of document.querySelectorAll('#methods .btn')) b.setAttribute('aria-pressed', String(b === btn));
  $('#paid').disabled = false;
});
$('#back').addEventListener('click', showScan);
$('#paid').addEventListener('click', () => {
  const { lines, total, units } = priceBasket(items, catalogue);
  const sale = { id: newBasketId(randomBytes), at: Date.now(), lane: 'staff-scan', status: 'paid', method, total, units, lines };
  recordSale(sale);
  $('#d-text').textContent = `${plural(units)}, paid by ${methodLabel(method)}.`;
  $('#d-id').textContent = sale.id;
  $('#d-time').textContent = new Date(sale.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#d-total').textContent = formatNaira(total);
  items = [];
  save();
  show('done');
});
$('#next').addEventListener('click', () => { showScan(); camera.open(); });

try {
  catalogue = await loadCatalogue();
} catch (err) {
  toast(err.message, 'warn');
}
$('#extras').innerHTML = [...catalogue.values()].filter((p) => p.loose).map((p) =>
  `<button type="button" data-barcode="${p.barcode}"><span>${icon('plus')} ${escapeHtml(p.name)}</span><b class="num">${formatNaira(p.price)}</b></button>`).join('');
showScan();
