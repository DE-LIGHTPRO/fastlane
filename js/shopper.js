import qrcode from '../vendor/qrcode.js';
import { addItem, setQty, encodeBasket, priceBasket, newBasketId, formatNaira, codeAge, CODE_TTL_MS, MAX_QTY } from './basket.js';
import { loadCatalogue, searchProducts } from './catalogue.js';
import { beep, PRODUCT_FORMATS } from './scanner.js';
import { cameraPanel } from './camera-panel.js';
import { $, escapeHtml, icon, show, setProgress, toast, confirmDialog, plural, qrSvg, keepAwake } from './ui.js';

const KEY = 'fastlane.basket';
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

let catalogue = new Map();
let state = load();
let last = { code: '', at: 0 };
let countdown = 0;
let releaseWake = () => {};

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && Array.isArray(s.items)) return s;
  } catch { /* start clean */ }
  return { id: '', ts: 0, items: [], locked: false, started: false };
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

function renderBasket(flash = '') {
  const { lines, total, units } = priceBasket(state.items, catalogue);
  $('#empty').hidden = lines.length > 0;
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
  renderBasket(barcode);
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

const camera = cameraPanel($('#cam'), { formats: PRODUCT_FORMATS, onCode: onScan, note: $('#cam-note') });

function leaveCode() {
  clearInterval(countdown);
  releaseWake();
  releaseWake = () => {};
}

function showShop() {
  leaveCode();
  state.locked = false;
  state.started = true;
  save();
  setProgress(0);
  show('shop');
  $('#bar').hidden = false;
  renderBasket();
}

function tickTimer() {
  const left = state.ts + CODE_TTL_MS - Date.now();
  const expired = left <= 0;
  $('#expired').hidden = !expired;
  $('#renew').hidden = !expired;
  if (expired) {
    $('#code-timer').textContent = 'Expired';
    clearInterval(countdown);
    return;
  }
  const s = Math.ceil(left / 1000);
  $('#code-timer').textContent = `Valid for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// renew = true makes a new pass even if the current one is still valid.
async function showCode(renew = false) {
  const { total, units } = renderBasket();
  camera.close();
  // A pass keeps its id while the basket is unchanged and the pass is still valid,
  // so a page reload shows the same code. Any edit or expiry makes a new one.
  if (renew || !state.locked || !state.id || codeAge(state.ts, Date.now()) !== 'fresh') {
    state.id = newBasketId(randomBytes);
    state.ts = Date.now();
  }
  state.locked = true;
  save();
  const known = state.items.filter((i) => catalogue.has(i.barcode));
  const qr = qrcode(0, 'M');
  qr.addData(encodeBasket({ id: state.id, ts: state.ts, items: known }), 'Alphanumeric');
  qr.make();
  $('#qr').innerHTML = qrSvg(qr, 'Your fast-lane pass');
  $('#code-id').textContent = state.id;
  $('#code-units').textContent = String(units);
  $('#code-total').textContent = formatNaira(total);
  $('#bar').hidden = true;
  setProgress(1);
  show('code');
  clearInterval(countdown);
  tickTimer();
  countdown = setInterval(tickTimer, 1000);
  releaseWake();
  releaseWake = await keepAwake();
}

$('#start').addEventListener('click', () => { showShop(); camera.open(); });
$('#done').addEventListener('click', () => showCode());
$('#renew').addEventListener('click', () => showCode(true));
$('#edit').addEventListener('click', showShop);
$('#fresh').addEventListener('click', async () => {
  const ok = await confirmDialog({ title: 'Start again?', body: 'This clears your basket and your pass.', confirm: 'Clear basket', danger: true });
  if (!ok) return;
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
  // Rendering replaced the button that was pressed; put focus back on its twin.
  $(`#lines li[data-barcode="${barcode}"] button[data-act="${btn.dataset.act}"]:not(:disabled)`)?.focus();
});

$('#search').addEventListener('input', (e) => {
  const found = searchProducts(catalogue, e.target.value);
  $('#results').innerHTML = found.map((p) =>
    `<button type="button" data-barcode="${p.barcode}"><span>${escapeHtml(p.name)}</span><b class="num">${formatNaira(p.price)}</b></button>`).join('');
});
$('#results').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-barcode]');
  if (!btn) return;
  add(btn.dataset.barcode);
  $('#search').value = '';
  $('#results').innerHTML = '';
});

try {
  catalogue = await loadCatalogue();
} catch (err) {
  toast(err.message, 'warn');
}
if (state.locked && state.items.length) showCode();
else if (state.started) showShop();
else { setProgress(0); show('welcome'); }
