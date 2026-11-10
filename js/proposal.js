import { CONTACT } from './config.js';
import { $ } from './ui.js';

$('#doc-url').textContent = new URL('./', location.href).href.replace(/^https?:\/\//, '').replace(/\/$/, '');
const contact = [CONTACT.name, CONTACT.role, CONTACT.email, CONTACT.phone].filter(Boolean).join(' · ');
if (CONTACT.email || CONTACT.phone) {
  $('#doc-contact-text').textContent = contact;
  $('#doc-contact').hidden = false;
}
$('#print').addEventListener('click', () => window.print());
