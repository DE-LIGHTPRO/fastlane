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
