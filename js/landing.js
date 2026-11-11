import './ui.js';
import { CONTACT } from './config.js';
import { $, escapeHtml, icon } from './ui.js';

// The contact section only appears once config.js has an email or a phone number.
if (CONTACT.email || CONTACT.phone) {
  $('#contact-who').textContent = [CONTACT.name, CONTACT.role].filter(Boolean).join(', ');
  const actions = [];
  if (CONTACT.email) actions.push(`<a class="btn primary" href="mailto:${encodeURIComponent(CONTACT.email)}">${icon('arrow')}${escapeHtml(CONTACT.email)}</a>`);
  if (CONTACT.phone) actions.push(`<a class="btn" href="tel:${escapeHtml(CONTACT.phone.replace(/[^\d+]/g, ''))}">${icon('phone')}${escapeHtml(CONTACT.phone)}</a>`);
  $('#contact-actions').innerHTML = actions.join('');
  $('#contact').hidden = false;
}

// Section links scroll the page without adding "#section" to the address,
// so the address a visitor copies or shares is always the clean one.
function goTo(id) {
  const target = document.getElementById(id);
  if (!target) return false;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  return true;
}
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#"]');
  if (link && goTo(link.getAttribute('href').slice(1))) e.preventDefault();
});
// An address that arrives with "#section" (an old link, or one typed by hand) still lands on
// the section, then the "#section" is removed.
function tidyHash() {
  if (!location.hash) return;
  goTo(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
}
window.addEventListener('hashchange', tidyHash);
tidyHash();

// ---- Motion ---------------------------------------------------------------
// Everything below is decoration. With reduced motion switched on, or without
// JavaScript, the page shows complete and still.
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!calm && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('js-motion');

  // Blocks rise into place as they scroll into view, each a beat after its neighbour.
  const targets = document.querySelectorAll('.band-head, .fact, .compare > div, .step-card, .feature, .guard, .tile, .tour, .cta .wrap > *');
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      seen.unobserve(el);
      el.classList.add('in');
      // Once it has arrived, hand the element back to its own styles (hover effects and so on).
      setTimeout(() => { el.classList.remove('reveal', 'in'); el.style.removeProperty('--d'); }, 1300);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  for (const el of targets) {
    const place = [...el.parentElement.children].indexOf(el);
    el.style.setProperty('--d', Math.min(place, 5) * 80 + 'ms');
    el.classList.add('reveal');
    seen.observe(el);
  }

  // The hero phone plays the product in miniature: items arrive one by one and the total counts up.
  const totalEl = $('#hero-total');
  const naira = (n) => '\u20A6' + Math.round(n).toLocaleString('en-NG');
  const countTo = (from, to) => {
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / 500);
      totalEl.textContent = naira(from + (to - from) * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  totalEl.textContent = naira(0);
  [[900, 0, 9800], [1900, 9800, 13000], [2900, 13000, 15700]].forEach(([at, from, to]) => setTimeout(() => countTo(from, to), at));
}

// ---- Slide tour -------------------------------------------------------------
const tabs = [...document.querySelectorAll('.tour-tab')];
if (tabs.length) {
  const img = $('#tour-img');
  const root = $('#tour-root');
  const SLIDE_MS = 5000;
  let current = 0;
  let timer = 0;
  let playing = !calm;
  let visible = false;
  let hovering = false;

  const select = (index, focus = false) => {
    current = (index + tabs.length) % tabs.length;
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === current));
      tab.tabIndex = i === current ? 0 : -1;
    });
    const tab = tabs[current];
    $('#tour-panel').setAttribute('aria-labelledby', tab.id);
    $('#tour-count').textContent = `${current + 1} of ${tabs.length}`;
    if (focus) tab.focus();
    // Fade the old screen out, swap it, and fade the new one in once it has loaded.
    img.classList.add('swap');
    const next = new Image();
    next.onload = next.onerror = () => {
      img.src = tab.dataset.img;
      img.alt = tab.dataset.alt;
      img.classList.remove('swap');
    };
    next.src = tab.dataset.img;
    schedule();
  };

  function schedule() {
    clearTimeout(timer);
    const run = playing && visible && !hovering;
    root.classList.toggle('playing', run);
    // Restart the progress bar on the active tab.
    for (const bar of root.querySelectorAll('.tour-bar')) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
    if (run) timer = setTimeout(() => select(current + 1), SLIDE_MS);
  }

  const stop = () => {
    playing = false;
    $('#tour-play').setAttribute('aria-pressed', 'false');
    $('#tour-play').textContent = 'Play';
    schedule();
  };

  tabs.forEach((tab, i) => tab.addEventListener('click', () => { stop(); select(i); }));
  $('.tour-tabs').addEventListener('keydown', (e) => {
    const move = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!move) return;
    e.preventDefault();
    stop();
    select(current + move, true);
  });
  $('#tour-prev').addEventListener('click', () => { stop(); select(current - 1); });
  $('#tour-next').addEventListener('click', () => { stop(); select(current + 1); });
  $('#tour-play').addEventListener('click', () => {
    if (playing) return stop();
    playing = true;
    $('#tour-play').setAttribute('aria-pressed', 'true');
    $('#tour-play').textContent = 'Pause';
    schedule();
  });
  root.addEventListener('pointerenter', () => { hovering = true; schedule(); });
  root.addEventListener('pointerleave', () => { hovering = false; schedule(); });
  root.addEventListener('focusin', () => { hovering = true; schedule(); });
  root.addEventListener('focusout', () => { hovering = false; schedule(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); }, { threshold: 0.35 }).observe(root);
  }
  if (calm) stop();
}
