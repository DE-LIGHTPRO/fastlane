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
