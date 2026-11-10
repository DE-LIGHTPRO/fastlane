// Small shared UI helpers: icons, view switching, toast, confirm dialog, page shell.

export const $ = (sel, root = document) => root.querySelector(sel);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" aria-hidden="true"><use href="img/icons.svg#${name}"/></svg>`;
}

export function show(id) {
  for (const el of document.querySelectorAll('[data-view]')) el.hidden = el.dataset.view !== id;
  // A message about the last screen must not sit on top of the new one (it once covered the pass).
  $('#toast')?.classList.remove('on');
  window.scrollTo(0, 0);
  const heading = $(`[data-view="${id}"] h1`);
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

// Marks the steps of a <ol class="progress"> as done / current.
export function setProgress(index) {
  document.querySelectorAll('.progress li').forEach((li, i) => {
    li.classList.toggle('done', i < index);
    li.classList.toggle('on', i === index);
    if (i === index) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });
}

let toastTimer = 0;
export function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2800);
}

// A styled replacement for window.confirm. Resolves true when confirmed.
export function confirmDialog({ title, body, confirm = 'Confirm', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>
      <div class="dialog-actions">
        <button class="btn" value="cancel">${escapeHtml(cancel)}</button>
        <button class="btn ${danger ? 'danger-solid' : 'primary'}" value="ok">${escapeHtml(confirm)}</button>
      </div>`;
    document.body.append(dialog);
    dialog.addEventListener('click', (e) => {
      const btn = e.target.closest('button[value]');
      if (btn) dialog.close(btn.value);
    });
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    dialog.showModal();
  });
}

export function plural(n, word = 'item') {
  return n === 1 ? `1 ${word}` : `${n} ${word}s`;
}

// Draws a QR code as one crisp SVG path. `qr` is a made qrcode-generator object.
export function qrSvg(qr, label) {
  const n = qr.getModuleCount();
  const quiet = 4;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  }
  const size = n + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(label)}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// Keeps the screen awake while a code is on show. Returns a release function.
export async function keepAwake() {
  try {
    const lock = await navigator.wakeLock?.request('screen');
    return () => lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}

// ---- Page shell: menu behaviour and offline support ----------------------
const menu = $('.menu');
if (menu) {
  document.addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.open) { menu.open = false; $('summary', menu).focus(); } });
}
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}
