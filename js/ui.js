export const $ = (sel, root = document) => root.querySelector(sel);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function show(id) {
  for (const el of document.querySelectorAll('[data-view]')) el.hidden = el.dataset.view !== id;
  window.scrollTo(0, 0);
}

let toastTimer = 0;
export function toast(message, kind = 'ok') {
  const el = $('#toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}
