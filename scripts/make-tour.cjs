// Captures the real app screens shown in the landing page's slide tour (img/tour/*.jpg).
// Needs the site running: npm run serve, then npm run tour.
const { chromium } = require('playwright');
const { readFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.env.BASE || 'http://localhost:4173';
const root = join(__dirname, '..');
const dir = join(root, 'img', 'tour');
const products = JSON.parse(readFileSync(join(root, 'data', 'products.json'), 'utf8'));
const pick = (part) => products.find((p) => p.name.includes(part));
const basket = [{ ...pick('rice'), qty: 1 }, { ...pick('Sliced bread'), qty: 2 }, { ...pick('Evaporated milk'), qty: 3 }];

// The camera shows a product barcode, as it would in a shopper's hand.
function fakeCamera() {
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 480;
  const g = canvas.getContext('2d');
  let img = null;
  (function draw() {
    g.fillStyle = '#c9ccd9';
    g.fillRect(0, 0, 640, 480);
    if (img) {
      const s = Math.min(480 / img.width, 300 / img.height);
      const w = img.width * s, h = img.height * s;
      g.fillStyle = '#fff';
      g.fillRect((640 - w) / 2 - 18, (480 - h) / 2 - 18, w + 36, h + 36);
      g.drawImage(img, (640 - w) / 2, (480 - h) / 2, w, h);
    }
    requestAnimationFrame(draw);
  })();
  window.__feed = async (svg) => {
    if (!svg) { img = null; return; }
    const next = new Image();
    next.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await next.decode();
    img = next;
  };
  navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(15);
  window.AudioContext = undefined;
  window.webkitAudioContext = undefined;
}

(async () => {
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, colorScheme: 'light', permissions: ['camera'], serviceWorkers: 'block' });
  await ctx.clock.install({ time: new Date(2026, 10, 14, 18, 10) });
  await ctx.addInitScript(fakeCamera);
  const p = await ctx.newPage();
  const shot = async (name) => { await p.waitForTimeout(3100); await p.screenshot({ path: join(dir, name + '.jpg'), type: 'jpeg', quality: 80 }); };

  // 1. Scanning
  await p.goto(BASE + '/scan');
  await p.getByRole('button', { name: 'Start scanning' }).click();
  for (const item of basket) {
    const svg = await p.evaluate(async (c) => (await import('/js/ean13.js')).ean13Svg(c), item.barcode);
    await p.evaluate((s) => window.__feed(s), svg);
    await p.locator(`#lines li[data-barcode="${item.barcode}"]`).waitFor();
    for (let i = 1; i < item.qty; i++) await p.locator(`#lines li[data-barcode="${item.barcode}"]`).getByRole('button', { name: /One more/ }).click();
  }
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot('scan');

  // 2. The pass
  await p.getByRole('button', { name: 'I am at the fast lane' }).click();
  await p.locator('#qr svg').waitFor();
  const state = JSON.parse(await p.evaluate(() => localStorage.getItem('fastlane.basket')));
  const pass = ['FL1', state.id, state.ts, ...state.items.map((i) => `${i.barcode}*${i.qty}`)].join('/');
  await shot('pass');

  // 3. The check, and 4. payment
  await p.goto(BASE + '/checker');
  await p.locator('details.fallback summary').click();
  await p.locator('#paste').fill(pass);
  await p.getByRole('button', { name: 'Open basket' }).click();
  await p.locator('#r-lines input.need').first().check();
  await shot('check');
  for (const box of await p.locator('#r-lines input.need').all()) await box.check();
  await p.getByRole('button', { name: 'Basket is correct' }).click();
  await p.getByRole('button', { name: 'POS', exact: true }).click();
  await shot('pay');

  // 5. The receipt on the shopper's phone
  const total = basket.reduce((t, i) => t + i.price * i.qty, 0);
  const units = basket.reduce((t, i) => t + i.qty, 0);
  await p.evaluate((paid) => {
    const s = JSON.parse(localStorage.getItem('fastlane.basket'));
    s.paid = { ...paid, at: Date.now() }; // the page's clock, which is fixed to a Saturday evening
    localStorage.setItem('fastlane.basket', JSON.stringify(s));
  }, { total, units, method: 'pos' });
  await p.goto(BASE + '/scan');
  await p.getByRole('heading', { name: 'Paid' }).waitFor();
  await shot('receipt');

  // 6. Order ahead, at the payment step
  await p.goto(BASE + '/order');
  const more = async (name, n) => { for (let i = 0; i < n; i++) await p.locator('#list li', { hasText: name }).getByRole('button', { name: /One more/ }).click(); };
  await more('Sliced bread', 2); await more('Bottled water', 3); await more('Evaporated milk', 1);
  await p.getByRole('button', { name: 'Choose pickup time' }).click();
  await p.locator('#slots button').first().click();
  await p.getByRole('button', { name: 'Continue to payment' }).click();
  await p.getByRole('button', { name: 'Card', exact: true }).click();
  await shot('order');
  await p.locator('#pay').click();
  await p.locator('#qr svg').waitFor();

  // 7. The pickup counter's packing list
  await p.goto(BASE + '/pickup');
  await p.locator('#to-pack .card').first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot('pickup');

  await browser.close();
  console.log('tour screens written');
})();
