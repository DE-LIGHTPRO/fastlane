import { ean13Svg } from './ean13.js';
import { formatNaira } from './basket.js';
import { loadSampleProducts, getLocalProducts, saveLocalProduct, removeLocalProduct } from './catalogue.js';
import { startCamera, cameraProblem, beep, PRODUCT_FORMATS } from './scanner.js';
import { $, escapeHtml, toast } from './ui.js';

let stopCamera = null;

function renderMine() {
  $('#mine').innerHTML = getLocalProducts().map((p) => `
    <li data-barcode="${p.barcode}">
      <div class="line-main"><div class="line-name">${escapeHtml(p.name)}</div><div class="line-sub">${p.barcode}</div></div>
      <div class="line-total">${formatNaira(p.price)}</div>
      <button class="btn danger" data-act="remove" aria-label="Remove ${escapeHtml(p.name)}">Remove</button>
    </li>`).join('');
}

function closeCamera() {
  stopCamera?.();
  stopCamera = null;
  $('#cam-box').hidden = true;
  $('#cam-on').hidden = false;
}

$('#cam-on').addEventListener('click', async () => {
  $('#cam-note').hidden = true;
  $('#cam-box').hidden = false;
  try {
    stopCamera = await startCamera($('#video'), (code) => {
      beep(true);
      $('#f-barcode').value = code;
      closeCamera();
      $('#f-name').focus();
    }, PRODUCT_FORMATS);
    $('#cam-on').hidden = true;
  } catch (err) {
    $('#cam-box').hidden = true;
    $('#cam-note').textContent = cameraProblem(err);
    $('#cam-note').hidden = false;
  }
});

$('#add').addEventListener('submit', (e) => {
  e.preventDefault();
  const barcode = $('#f-barcode').value.trim();
  const name = $('#f-name').value.trim();
  const naira = Number($('#f-price').value);
  if (!/^\d{6,14}$/.test(barcode)) return toast('The barcode must be 6 to 14 digits.', 'warn');
  if (!name || !Number.isInteger(naira) || naira < 1) return toast('Enter a name and a whole-naira price.', 'warn');
  saveLocalProduct({ barcode, name, price: naira * 100 });
  e.target.reset();
  renderMine();
  toast(`Saved ${name}`);
});

$('#mine').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act="remove"]');
  if (!btn) return;
  removeLocalProduct(btn.closest('li').dataset.barcode);
  renderMine();
});

$('#print').addEventListener('click', () => window.print());

renderMine();
try {
  const products = await loadSampleProducts();
  $('#sheet').innerHTML = products.map((p) => `
    <div class="card" data-barcode="${p.barcode}">
      ${ean13Svg(p.barcode)}
      <div class="line-name">${escapeHtml(p.name)}</div>
      <div class="muted small">${formatNaira(p.price)}</div>
    </div>`).join('');
} catch (err) {
  toast(err.message, 'warn');
}
