import { ean13Svg } from './ean13.js';
import { formatNaira } from './basket.js';
import { loadSampleProducts, getLocalProducts, saveLocalProduct, removeLocalProduct } from './catalogue.js';
import { beep, PRODUCT_FORMATS } from './scanner.js';
import { cameraPanel } from './camera-panel.js';
import { $, escapeHtml, toast } from './ui.js';

function renderMine() {
  $('#mine').innerHTML = getLocalProducts().map((p) => `
    <li data-barcode="${p.barcode}">
      <div class="line-main"><div class="line-name">${escapeHtml(p.name)}</div><div class="line-sub mono">${p.barcode}</div></div>
      <div class="line-total">${formatNaira(p.price)}</div>
      <button class="btn sm danger" type="button" data-act="remove" aria-label="Remove ${escapeHtml(p.name)}">Remove</button>
    </li>`).join('');
}

const camera = cameraPanel($('#cam'), {
  formats: PRODUCT_FORMATS,
  note: $('#cam-note'),
  onCode(code) {
    beep(true);
    $('#f-barcode').value = code;
    camera.close();
    $('#f-name').focus();
  },
});

$('#add').addEventListener('submit', (e) => {
  e.preventDefault();
  const barcode = $('#f-barcode').value.trim();
  const name = $('#f-name').value.trim();
  const naira = Number($('#f-price').value);
  if (!/^\d{6,14}$/.test(barcode)) { $('#f-barcode').focus(); return toast('The barcode must be 6 to 14 digits.', 'warn'); }
  if (!name) { $('#f-name').focus(); return toast('Enter the item name.', 'warn'); }
  if (!Number.isInteger(naira) || naira < 1) { $('#f-price').focus(); return toast('Enter a whole-naira price.', 'warn'); }
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
      <div class="line-sub num">${formatNaira(p.price)}</div>
    </div>`).join('');
} catch (err) {
  toast(err.message, 'warn');
}
