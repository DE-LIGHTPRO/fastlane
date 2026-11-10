import qrcode from '../vendor/qrcode.js';
import { addItem, setQty, encodeBasket, priceBasket, newBasketId, formatNaira, MAX_QTY } from './basket.js';
import { loadCatalogue, searchProducts } from './catalogue.js';
import { startCamera, cameraProblem, beep, PRODUCT_FORMATS } from './scanner.js';
import { $, escapeHtml, show, toast } from './ui.js';

const KEY = 'fastlane.basket';
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

let catalogue = new Map();
let state = load();
let stopCamera = null;
let last = { code: '', at: 0 };

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && Array.isArray(s.items)) return s;
  } catch { /* start clean */ }
  return { id: '', ts: 0, items: [], locked: false, started: false };
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

function plural(n) { return n === 1 ? '1 item' : n + ' items'; }

function renderBasket() {
  const { lines, total, units } = priceBasket(state.items, catalogue);
  $('#empty').hidden = lines.length > 0;
  $('#lines').innerHTML = lines.map((l) => `
    <li data-barcode="${l.barcode}">
      <div class="line-main">
        <div class="line-name">${escapeHtml(l.name)}</div>
        <div class="line-sub">${formatNaira(l.price)} each</div>
      </div>
      <div class="qty">
        <button data-act="less" aria-label="One less ${escapeHtml(l.name)}">&minus;</button>
        <output>${l.qty}</output>
        <button data-act="more" aria-label="One more ${escapeHtml(l.name)}">+</button>
      </div>
      <div class="line-total">${formatNaira(l.lineTotal)}</div>
    </li>`).join('');
  $('#total').textContent = formatNaira(total);
  $('#units').textContent = plural(units);
  $('#done').disabled = lines.length === 0;
  return { total, units };
}

function add(barcode) {
  const product = catalogue.get(barcode);
  if (!product) {
    beep(false);
    toast(`Barcode ${barcode} is not on the list. Keep that item for the checker.`, 'warn');
    return;
  }
  try {
    state.items = addItem(state.items, barcode);
  } catch (err) {
    beep(false);
    toast(err.message, 'warn');
    return;
  }
  save();
  renderBasket();
  beep(true);
  toast(`Added ${product.name}, ${formatNaira(product.price)}`);
}

function onScan(code) {
  const now = Date.now();
  // The camera sees a barcode many times a second while it is held in view.
  // Count it once, and only accept the same barcode again after it has left the picture.
  const stillInView = code === last.code && now - last.at < 1200;
  last = { code, at: now };
  if (!stillInView) add(code);
}

async function openCamera() {
  if (stopCamera) return;
  $('#cam-note').hidden = true;
  try {
    stopCamera = await startCamera($('#video'), onScan, PRODUCT_FORMATS);
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

function showShop() {
  state.locked = false;
  state.started = true;
  save();
  show('shop');
  $('#bar').hidden = false;
  renderBasket();
}

function showCode() {
  const { total, units } = renderBasket();
  // A new id and time every time the code is shown, so an edited basket never reuses an old code.
  state.id = newBasketId(randomBytes);
  state.ts = Date.now();
  state.locked = true;
  save();
  closeCamera();
  const known = state.items.filter((i) => catalogue.has(i.barcode));
  const qr = qrcode(0, 'M');
  qr.addData(encodeBasket({ id: state.id, ts: state.ts, items: known }), 'Alphanumeric');
  qr.make();
  $('#qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  $('#code-id').textContent = state.id;
  $('#code-units').textContent = String(units);
  $('#code-total').textContent = formatNaira(total);
  $('#bar').hidden = true;
  show('code');
}

$('#start').addEventListener('click', () => { showShop(); openCamera(); });
$('#cam-on').addEventListener('click', openCamera);
$('#done').addEventListener('click', showCode);
$('#edit').addEventListener('click', showShop);
$('#fresh').addEventListener('click', () => {
  if (!confirm('Clear this basket and start again?')) return;
  state = { id: '', ts: 0, items: [], locked: false, started: true };
  showShop();
});

$('#lines').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const barcode = btn.closest('li').dataset.barcode;
  const item = state.items.find((i) => i.barcode === barcode);
  if (!item) return;
  const qty = btn.dataset.act === 'more' ? Math.min(MAX_QTY, item.qty + 1) : item.qty - 1;
  state.items = setQty(state.items, barcode, qty);
  save();
  renderBasket();
});

$('#search').addEventListener('input', (e) => {
  const found = searchProducts(catalogue, e.target.value);
  $('#results').innerHTML = found.map((p) =>
    `<button type="button" data-barcode="${p.barcode}"><span>${escapeHtml(p.name)}</span><b>${formatNaira(p.price)}</b></button>`).join('');
});
$('#results').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-barcode]');
  if (!btn) return;
  add(btn.dataset.barcode);
  $('#search').value = '';
  $('#results').innerHTML = '';
});

document.addEventListener('visibilitychange', () => { if (document.hidden) closeCamera(); });

try {
  catalogue = await loadCatalogue();
} catch (err) {
  toast(err.message, 'warn');
}
if (state.locked && state.items.length) showCode();
else if (state.started) showShop();
else show('welcome');
