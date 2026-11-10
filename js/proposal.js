import qrcode from '../vendor/qrcode.js';
import { CONTACT } from './config.js';
import { $, qrSvg } from './ui.js';

const home = new URL('./', location.href).href;
$('#doc-url').textContent = home.replace(/^https?:\/\//, '').replace(/\/$/, '');
$('#doc-date').textContent = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
if (CONTACT.name) $('#doc-by').textContent = [CONTACT.name, CONTACT.role].filter(Boolean).join(', ');

const contact = [CONTACT.name, CONTACT.role, CONTACT.email, CONTACT.phone].filter(Boolean).join(' \u00b7 ');
if (CONTACT.email || CONTACT.phone) {
  $('#doc-contact-text').textContent = contact;
  $('#doc-contact').hidden = false;
}

// A code that opens the demo, so a printed copy still leads somewhere.
const qr = qrcode(0, 'M');
qr.addData(home);
qr.make();
$('#doc-qr').innerHTML = qrSvg(qr, 'Code that opens the FastLane demo');

$('#print').addEventListener('click', () => window.print());
