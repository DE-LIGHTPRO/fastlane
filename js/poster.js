import qrcode from '../vendor/qrcode.js';
import { $, qrSvg } from './ui.js';

// The sign points shoppers at the scan page of whichever site this page is opened from.
const target = new URL('scan', location.href).href;
const qr = qrcode(0, 'M');
qr.addData(target);
qr.make();
$('#poster-qr').innerHTML = qrSvg(qr, 'Code that opens FastLane');
$('#poster-url').textContent = target.replace(/^https?:\/\//, '');
$('#local-note').hidden = !['localhost', '127.0.0.1'].includes(location.hostname);
$('#print').addEventListener('click', () => window.print());
