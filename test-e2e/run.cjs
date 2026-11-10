// End-to-end check in a real browser, including the real camera path:
// the barcode and the passes are rendered by the app, turned into a fake
// camera feed, and read back by the app's own scanner.
//   npm run test:e2e
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { writeFileSync, mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');

const PORT = 4199;
const BASE = `http://localhost:${PORT}`;
const PAGES = ['index.html', 'scan.html', 'order.html', 'checker.html', 'pickup.html', 'products.html', 'poster.html'];
const products = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'products.json'), 'utf8'));
const byName = (part) => products.find((p) => p.name.includes(part));
const noodles = products[0];
const rice = byName('rice');
const naira = (kobo) => '₦' + String(kobo / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const phone = { width: 375, height: 760 };

let passed = 0;
async function step(name, fn) {
  await fn();
  passed++;
  console.log('ok', passed, '-', name);
}

// Runs the app's own scanner on a PNG, inside the page.
function scanPng(page, png, formatsName) {
  return page.evaluate(async ({ b64, formatsName }) => {
    const scanner = await import('/js/scanner.js');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return scanner.detectIn(await createImageBitmap(new Blob([bytes], { type: 'image/png' })), scanner[formatsName]);
  }, { b64: png.toString('base64'), formatsName });
}

// PNG -> uncompressed .y4m clip, which Chromium can play as a fake camera.
async function pngToY4m(page, pngBuffer, file) {
  const W = 640, H = 480;
  const rgba = await page.evaluate(async ({ b64, W, H }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    const scale = Math.min((W * 0.8) / img.width, (H * 0.8) / img.height);
    const w = img.width * scale, h = img.height * scale;
    g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    return Array.from(g.getImageData(0, 0, W, H).data);
  }, { b64: pngBuffer.toString('base64'), W, H });
  const y = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) y[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  const chroma = Buffer.alloc((W / 2) * (H / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, chroma, chroma]);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)]));
}

function watch(page, errors) {
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
}

const camera = (file) => ({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${file}`],
});
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

(async () => {
  const server = spawn(process.execPath, [join(__dirname, '..', 'scripts', 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => server.stdout.once('data', r));
  const dir = mkdtempSync(join(tmpdir(), 'fastlane-'));
  const errors = [];
  const browsers = [];
  try {
    const plain = await chromium.launch();
    browsers.push(plain);

    // ---- 1. The site as a whole
    await step('every page loads with the security headers and a title', async () => {
      const page = await plain.newPage();
      watch(page, errors);
      for (const name of PAGES) {
        const res = await page.goto(`${BASE}/${name}`);
        assert.equal(res.status(), 200, name);
        assert.match(res.headers()['content-security-policy'], /default-src 'self'/, name);
        assert.match(await page.title(), /FastLane/, name);
        await page.waitForLoadState('networkidle');
      }
      await page.close();
    });

    await step('the landing page links to every part of the demo', async () => {
      const page = await plain.newPage({ viewport: { width: 1440, height: 900 } });
      watch(page, errors);
      await page.goto(BASE + '/');
      await page.getByRole('heading', { level: 1 }).waitFor();
      const hrefs = await page.locator('a[href$=".html"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute('href')))]);
      for (const name of PAGES) assert.ok(hrefs.includes(name), name);
      await page.close();
    });

    await step('an unknown address shows the not-found page', async () => {
      const page = await plain.newPage();
      watch(page, []); // a 404 logs a console error by design
      const res = await page.goto(BASE + '/nope/missing.html');
      assert.equal(res.status(), 404);
      await page.getByRole('heading', { name: 'This page does not exist' }).waitFor();
      await page.close();
    });

    await step('no page scrolls sideways at 375px or 1440px', async () => {
      for (const viewport of [phone, { width: 1440, height: 900 }]) {
        const page = await plain.newPage({ viewport });
        for (const name of PAGES) {
          await page.goto(`${BASE}/${name}`);
          await page.waitForLoadState('networkidle');
          assert.ok(await noSideScroll(page), `${name} at ${viewport.width}px`);
        }
        await page.close();
      }
    });

    // ---- 2. Barcode sheet, and a camera clip of one barcode
    const sheet = await plain.newPage({ viewport: { width: 1280, height: 900 } });
    watch(sheet, errors);
    await sheet.goto(BASE + '/products.html');
    await sheet.waitForSelector(`#sheet [data-barcode="${noodles.barcode}"] svg`);

    await step('the sheet shows a barcode for every sample product', async () => {
      assert.equal(await sheet.locator('#sheet .card').count(), products.length);
    });

    const barcodePng = await sheet.locator(`#sheet [data-barcode="${noodles.barcode}"] svg`).screenshot();
    await step('the app\'s scanner reads the barcodes the app draws', async () => {
      assert.deepEqual(await scanPng(sheet, barcodePng, 'PRODUCT_FORMATS'), [noodles.barcode]);
    });
    const barcodeClip = join(dir, 'barcode.y4m');
    await pngToY4m(sheet, barcodePng, barcodeClip);

    await step('the queue sign carries a code that opens the shopper page', async () => {
      const page = await plain.newPage();
      watch(page, errors);
      await page.goto(BASE + '/poster.html');
      const png = await page.locator('#poster-qr svg').screenshot();
      assert.deepEqual(await scanPng(page, png, 'QR_FORMATS'), [BASE + '/scan.html']);
      assert.ok(await page.locator('#local-note').isVisible());
      await page.close();
    });

    // ---- 3. Shopper, on a phone-sized screen, scanning with the camera
    const shopBrowser = await chromium.launch(camera(barcodeClip));
    browsers.push(shopBrowser);
    const shopCtx = await shopBrowser.newContext({ viewport: phone, permissions: ['camera'] });
    const shop = await shopCtx.newPage();
    watch(shop, errors);
    await shop.goto(BASE + '/scan.html');

    await step('the welcome screen explains the three steps', async () => {
      await shop.getByRole('heading', { name: 'Scan while you wait' }).waitFor();
      assert.equal(await shop.locator('[data-view="welcome"] .plain-list li').count(), 3);
    });

    await step('the camera scans a barcode and adds the item exactly once', async () => {
      await shop.getByRole('button', { name: 'Start scanning' }).click();
      await shop.locator(`#lines li[data-barcode="${noodles.barcode}"]`).waitFor({ timeout: 20000 });
      await shop.waitForTimeout(3500); // the camera keeps seeing the same barcode the whole time
      assert.equal(await shop.locator('#lines li').count(), 1);
      assert.equal(await shop.locator('#lines li output').textContent(), '1');
      assert.equal(await shop.locator('#total').textContent(), naira(noodles.price));
    });

    await step('an item can be added by typing its name', async () => {
      await shop.locator('#search').fill('rice');
      await shop.locator(`#results button[data-barcode="${rice.barcode}"]`).click();
      await shop.locator(`#lines li[data-barcode="${rice.barcode}"]`).waitFor();
    });

    await step('quantity buttons change the total and keep keyboard focus', async () => {
      const row = shop.locator(`#lines li[data-barcode="${rice.barcode}"]`);
      await row.getByRole('button', { name: /One more/ }).click();
      assert.equal(await row.locator('output').textContent(), '2');
      assert.equal(await shop.locator('#total').textContent(), naira(noodles.price + rice.price * 2));
      assert.match(await shop.evaluate(() => document.activeElement.getAttribute('aria-label')), /One more Long grain rice/);
    });

    let passId = '';
    let codeText = '';
    await step('the pass shows a code, the basket id, the total and a countdown', async () => {
      await shop.getByRole('button', { name: 'I am at the fast lane' }).click();
      await shop.locator('#qr svg').waitFor();
      passId = await shop.locator('#code-id').textContent();
      assert.match(passId, /^[A-Z2-9]{6}$/);
      assert.equal(await shop.locator('#code-total').textContent(), naira(noodles.price + rice.price * 2));
      assert.match(await shop.locator('#code-timer').textContent(), /^Valid for 1[45]:\d\d$/);
      assert.ok(await shop.locator('#renew').isHidden());
      assert.ok(await noSideScroll(shop));
    });

    const qrPng = await shop.locator('#qr svg').screenshot();
    await step('the code on screen decodes to the basket', async () => {
      const read = await scanPng(shop, qrPng, 'QR_FORMATS');
      assert.equal(read.length, 1);
      codeText = read[0];
      assert.match(codeText, new RegExp(`^FL1/${passId}/\\d{13}/${noodles.barcode}\\*1/${rice.barcode}\\*2$`));
    });

    await step('a reload keeps the same pass, and editing the basket makes a new one', async () => {
      await shop.reload();
      await shop.locator('#qr svg').waitFor();
      assert.equal(await shop.locator('#code-id').textContent(), passId);
      await shop.getByRole('button', { name: 'Change my basket' }).click();
      assert.equal(await shop.locator('#lines li').count(), 2);
      await shop.getByRole('button', { name: 'I am at the fast lane' }).click();
      await shop.locator('#qr svg').waitFor();
      assert.notEqual(await shop.locator('#code-id').textContent(), passId);
    });
    const qrClip = join(dir, 'qr.y4m');
    await pngToY4m(shop, qrPng, qrClip);
    const expectedTotal = noodles.price + rice.price * 2;

    await step('an expired pass says so and can be renewed', async () => {
      const ctx = await plain.newContext({ viewport: phone });
      await ctx.clock.install({ time: new Date(2026, 10, 14, 20, 0) });
      const page = await ctx.newPage();
      watch(page, errors);
      await page.goto(BASE + '/scan.html');
      await page.getByRole('button', { name: 'Start scanning' }).click();
      await page.locator('#search').fill('rice');
      await page.locator('#results button').first().click();
      await page.getByRole('button', { name: 'I am at the fast lane' }).click();
      const first = await page.locator('#code-id').textContent();
      await ctx.clock.fastForward('16:00');
      await page.getByRole('button', { name: 'Get a new pass' }).waitFor();
      assert.equal(await page.locator('#code-timer').textContent(), 'Expired');
      await page.getByRole('button', { name: 'Get a new pass' }).click();
      assert.notEqual(await page.locator('#code-id').textContent(), first);
      assert.match(await page.locator('#code-timer').textContent(), /^Valid for/);
      await ctx.close();
    });

    await step('starting again asks first, then clears the basket', async () => {
      const page = await plain.newPage({ viewport: phone });
      watch(page, errors);
      await page.goto(BASE + '/scan.html');
      await page.getByRole('button', { name: 'Start scanning' }).click();
      await page.locator('#search').fill('rice');
      await page.locator('#results button').first().click();
      await page.getByRole('button', { name: 'I am at the fast lane' }).click();
      await page.getByRole('button', { name: 'Start again' }).click();
      await page.getByRole('button', { name: 'Cancel' }).click();
      await page.locator('#qr svg').waitFor();
      await page.getByRole('button', { name: 'Start again' }).click();
      await page.getByRole('button', { name: 'Clear basket' }).click();
      await page.getByText('Your basket is empty').waitFor();
      await page.close();
    });

    // ---- 4. Checker, scanning the shopper's pass with the camera
    const checkBrowser = await chromium.launch(camera(qrClip));
    browsers.push(checkBrowser);
    const checkCtx = await checkBrowser.newContext({ viewport: phone, permissions: ['camera'] });
    const check = await checkCtx.newPage();
    watch(check, errors);
    await check.goto(BASE + '/checker.html');

    await step('the checker camera reads the pass and shows the priced basket', async () => {
      await check.getByRole('button', { name: 'Open camera' }).click();
      await check.getByRole('heading', { name: 'Check the basket' }).waitFor({ timeout: 20000 });
      assert.equal(await check.locator('#r-id').textContent(), passId);
      assert.equal(await check.locator('#r-total').textContent(), naira(expectedTotal));
      assert.equal(await check.locator('#r-units').textContent(), '3');
    });

    await step('the basket cannot be accepted until every check is ticked', async () => {
      const accept = check.getByRole('button', { name: 'Basket is correct' });
      assert.ok(await accept.isDisabled());
      const boxes = check.locator('#r-lines input.need');
      const n = await boxes.count();
      assert.equal(n, 3); // two lines to find, plus the count
      for (let i = 0; i < n - 1; i++) await boxes.nth(i).check();
      assert.ok(await accept.isDisabled());
      await check.getByLabel('I counted 3 items in the basket').check();
      assert.ok(await accept.isEnabled());
      await accept.click();
    });

    await step('payment needs a method, then the basket is marked paid', async () => {
      assert.equal(await check.locator('#p-total').textContent(), naira(expectedTotal));
      const paid = check.getByRole('button', { name: 'Payment received' });
      assert.ok(await paid.isDisabled());
      await check.getByRole('button', { name: 'POS', exact: true }).click();
      await paid.click();
      await check.getByRole('heading', { name: 'Paid' }).waitFor();
    });

    await step('the same pass is refused a second time', async () => {
      await check.getByRole('button', { name: 'Next shopper' }).click(); // camera still sees the same pass
      await check.locator('#scan-error:not([hidden])').waitFor({ timeout: 20000 });
      assert.match(await check.locator('#scan-error').textContent(), /already paid/);
      assert.equal(await check.locator('#sum-count').textContent(), '1');
      assert.equal(await check.locator('#sum-total').textContent(), naira(expectedTotal));
      assert.equal(await check.locator('#sum-pos').textContent(), naira(expectedTotal));
    });

    // ---- 5. Refusals, using the paste box so each case is exact
    await check.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await check.locator('details.fallback summary').click();
    const toScan = () => check.evaluate(() => {
      for (const el of document.querySelectorAll('[data-view]')) el.hidden = el.dataset.view !== 'scan';
    });
    const paste = async (text) => {
      await check.locator('#paste').fill(text);
      await check.getByRole('button', { name: 'Open basket' }).click();
    };
    const now = Date.now();

    await step('a QR code from somewhere else is refused', async () => {
      await paste('https://example.com/pay');
      assert.match(await check.locator('#scan-error').textContent(), /not a fast-lane code/);
    });

    await step('a pass older than 15 minutes is refused', async () => {
      await paste(`FL1/QQQQQQ/${now - 16 * 60 * 1000}/${rice.barcode}*1`);
      assert.match(await check.locator('#scan-error').textContent(), /more than 15 minutes old/);
    });

    await step('a basket with a barcode missing from the product list cannot be accepted', async () => {
      await paste(`FL1/WWWWWW/${now}/${rice.barcode}*1/5000000000005*1`);
      await check.getByRole('heading', { name: 'Check the basket' }).waitFor();
      assert.match(await check.locator('#r-unknown').textContent(), /5000000000005/);
      for (const box of await check.locator('#r-lines input.need').all()) await box.check();
      assert.ok(await check.getByRole('button', { name: 'Basket is correct' }).isDisabled());
    });

    await step('a mismatched basket is sent to a normal till and its pass stops working', async () => {
      await check.getByRole('button', { name: 'Does not match' }).click();
      await check.getByRole('button', { name: 'Send to till' }).click();
      await check.getByRole('heading', { name: 'Send to a normal till' }).waitFor();
      await toScan();
      await paste(`FL1/WWWWWW/${now}/${rice.barcode}*1`);
      assert.match(await check.locator('#scan-error').textContent(), /sent to a normal till/);
      assert.equal(await check.locator('#sum-rejected').textContent(), '1');
    });

    await step('a large basket asks for a full count', async () => {
      await paste(`FL1/ZZZZZZ/${now}/${noodles.barcode}*30`);
      await check.getByRole('heading', { name: 'Check the basket' }).waitFor();
      assert.match(await check.locator('#r-instruction').textContent(), /Count every item: there must be exactly 30/);
      assert.equal(await check.locator('#r-lines input.need').count(), 1);
    });

    await step('the sales file downloads with one row per item line', async () => {
      await toScan();
      const [download] = await Promise.all([check.waitForEvent('download'), check.getByRole('button', { name: 'Sales file' }).click()]);
      const csv = readFileSync(await download.path(), 'utf8').trim().split('\n');
      assert.equal(csv[0], 'basket_id,time,status,payment,barcode,item,qty,unit_price_naira,line_total_naira');
      assert.equal(csv.filter((r) => r.startsWith(passId + ',')).length, 2);
      assert.ok(csv.some((r) => r.includes(',paid,pos,')));
      assert.ok(csv.some((r) => r.includes(',rejected,,')));
    });

    await step('ending the shift asks first, then clears the totals', async () => {
      await check.getByRole('button', { name: 'End shift' }).click();
      await check.locator('dialog').getByRole('button', { name: 'Cancel' }).click();
      assert.equal(await check.locator('#sum-count').textContent(), '1');
      await check.getByRole('button', { name: 'End shift' }).click();
      await check.locator('dialog').getByRole('button', { name: 'End shift' }).click();
      await check.getByText('Shift cleared').waitFor();
      assert.equal(await check.locator('#sum-count').textContent(), '0');
      assert.equal(await check.locator('#sum-total').textContent(), naira(0));
    });

    // ---- 6. Adding a real product on the Products page
    await step('a product added on this device can be found by the shopper', async () => {
      const page = await shopCtx.newPage();
      watch(page, errors);
      await page.goto(BASE + '/products.html');
      await page.getByRole('button', { name: 'Save product' }).click();
      await page.getByText('The barcode must be 6 to 14 digits.').waitFor();
      await page.locator('#f-barcode').fill('6151234567890');
      await page.locator('#f-name').fill('Test biscuit');
      await page.locator('#f-price').fill('500');
      await page.getByRole('button', { name: 'Save product' }).click();
      await page.locator('#mine li[data-barcode="6151234567890"]').waitFor();
      await page.goto(BASE + '/scan.html');
      await page.getByRole('button', { name: 'Change my basket' }).click();
      await page.locator('#search').fill('biscuit');
      await page.locator('#results button[data-barcode="6151234567890"]').click();
      await page.locator('#lines li[data-barcode="6151234567890"]').waitFor();
      await page.close();
    });

    // ---- 7. Order ahead, then the pickup counter
    const bread = byName('bread');
    const water = byName('water');
    const saturdayEvening = new Date(2026, 10, 14, 18, 10);
    const orderCtx = await plain.newContext({ viewport: phone });
    await orderCtx.clock.install({ time: saturdayEvening });
    const order = await orderCtx.newPage();
    watch(order, errors);
    await order.goto(BASE + '/order.html');
    let orderId = '';
    let orderText = '';
    const orderTotal = bread.price * 2 + water.price;

    await step('the order page offers the short pickup list and caps each item at 5', async () => {
      await order.locator('#list li').first().waitFor();
      assert.equal(await order.locator('#list li').count(), 8);
      const breadRow = order.locator(`#list li[data-barcode="${bread.barcode}"]`);
      for (let i = 0; i < 5; i++) await breadRow.getByRole('button', { name: /One more/ }).click();
      assert.ok(await breadRow.getByRole('button', { name: /One more/ }).isDisabled());
      for (let i = 0; i < 3; i++) await breadRow.getByRole('button', { name: /One less/ }).click();
      await order.locator(`#list li[data-barcode="${water.barcode}"]`).getByRole('button', { name: /One more/ }).click();
      assert.equal(await order.locator('#total').textContent(), naira(orderTotal));
      assert.equal(await order.locator('#units').textContent(), '3 items');
    });

    await step('pickup times start after the packing lead time and one must be chosen before paying', async () => {
      await order.getByRole('button', { name: 'Choose pickup time' }).click();
      assert.equal(await order.locator('#slots button').count(), 4);
      const firstSlot = await order.locator('#slots button').first().textContent();
      assert.match(firstSlot, /^7:00/);
      assert.match(firstSlot, /Today/);
      const pay = order.locator('#pay');
      assert.ok(await pay.isDisabled());
      assert.equal(await pay.textContent(), 'Pay ' + naira(orderTotal));
      await order.locator('#slots button').first().click();
      await pay.click();
    });

    await step('a confirmed order shows a pickup pass that decodes to the order', async () => {
      await order.getByRole('heading', { name: 'Order confirmed' }).waitFor();
      orderId = await order.locator('#c-id').textContent();
      assert.match(orderId, /^[A-Z2-9]{6}$/);
      assert.equal(await order.locator('#c-total').textContent(), naira(orderTotal));
      assert.match(await order.locator('#c-slot').textContent(), /^Today, 7:00/);
      const png = await order.locator('#qr svg').screenshot();
      orderText = (await scanPng(order, png, 'QR_FORMATS'))[0];
      const slot = saturdayEvening.getTime() + 50 * 60 * 1000;
      assert.equal(orderText, `FP1/${orderId}/${orderText.split('/')[2]}/${slot}/${bread.barcode}*2/${water.barcode}*1`);
      assert.ok(await noSideScroll(order));
    });

    await step('the pickup pass is still there after a reload', async () => {
      await order.reload();
      await order.getByRole('heading', { name: 'Order confirmed' }).waitFor();
      assert.equal(await order.locator('#c-id').textContent(), orderId);
    });

    const counter = await orderCtx.newPage();
    watch(counter, errors);
    await counter.goto(BASE + '/pickup.html');

    await step('the order appears on the staff packing list and can be marked packed', async () => {
      const card = counter.locator(`#to-pack [data-order="${orderId}"]`);
      await card.waitFor();
      assert.match(await card.textContent(), /2 ×\s+Sliced bread/);
      assert.equal(await counter.locator('#n-pack').textContent(), '1');
      await card.getByRole('button', { name: 'Mark as packed' }).click();
      await counter.locator(`#ready [data-order="${orderId}"]`).waitFor();
      assert.equal(await counter.locator('#to-pack .card').count(), 0);
      assert.equal(await counter.locator('#n-ready').textContent(), '1');
    });

    await step('a packed order is handed over by its order number', async () => {
      await counter.locator('#find-id').fill(orderId.toLowerCase());
      await counter.getByRole('button', { name: 'Find order' }).click();
      await counter.getByRole('heading', { name: 'Hand over' }).waitFor();
      assert.ok(await counter.locator('#h-note').isHidden());
      assert.equal(await counter.locator('#h-total').textContent(), naira(orderTotal));
      await counter.getByRole('button', { name: 'Handed to the shopper' }).click();
      await counter.getByRole('heading', { name: 'Collected' }).waitFor();
      await counter.getByRole('button', { name: 'Next order' }).click();
      assert.equal(await counter.locator('#n-done').textContent(), '1');
    });

    await step('a collected order is refused a second time', async () => {
      await counter.locator('#find-id').fill(orderText);
      await counter.getByRole('button', { name: 'Find order' }).click();
      assert.match(await counter.locator('#find-error').textContent(), /already collected/);
    });

    // A second staff phone that has never seen the order.
    const otherCtx = await plain.newContext({ viewport: phone });
    await otherCtx.clock.install({ time: saturdayEvening });
    const other = await otherCtx.newPage();
    watch(other, errors);
    await other.goto(BASE + '/pickup.html');
    const find = async (text) => {
      await other.locator('#find-id').fill(text);
      await other.getByRole('button', { name: 'Find order' }).click();
    };

    await step('on another device the pass brings the order with it, flagged as not packed', async () => {
      await find(orderId);
      assert.match(await other.locator('#find-error').textContent(), /not on this device/);
      await find(orderText);
      await other.getByRole('heading', { name: 'Hand over' }).waitFor();
      assert.match(await other.locator('#h-note').textContent(), /not packed yet/);
      assert.equal(await other.locator('#h-total').textContent(), naira(orderTotal));
      await other.getByRole('button', { name: 'Back' }).click();
      await other.locator(`#to-pack [data-order="${orderId}"]`).waitFor();
    });

    await step('an order for another day is refused', async () => {
      const tomorrow = new Date(2026, 10, 15, 9, 0).getTime();
      await find(`FP1/TTTTTT/${saturdayEvening.getTime()}/${tomorrow}/${bread.barcode}*1`);
      assert.match(await other.locator('#find-error').textContent(), /not today/);
    });

    await step('fast-lane and pickup passes are refused at the wrong counter', async () => {
      await find(`FL1/ABCDEF/${saturdayEvening.getTime()}/${bread.barcode}*1`);
      assert.match(await other.locator('#find-error').textContent(), /fast-lane code/);
      await toScan();
      await paste(orderText);
      assert.match(await check.locator('#scan-error').textContent(), /order-ahead code/);
    });

    // ---- 8. Offline, accessibility
    await step('pages keep working with no network after the first visit', async () => {
      const ctx = await plain.newContext({ viewport: phone });
      const page = await ctx.newPage();
      await page.goto(BASE + '/scan.html');
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      await ctx.setOffline(true);
      await page.goto(BASE + '/scan.html');
      await page.getByRole('button', { name: 'Start scanning' }).click();
      await page.locator('#search').fill('bread');
      await page.locator('#results button').first().click();
      await page.locator('#lines li').waitFor();
      await page.goto(BASE + '/checker.html');
      await page.getByRole('heading', { name: 'Scan the shopper\'s pass' }).waitFor();
      await ctx.close();
    });

    await step('no page has an accessibility violation, in light or dark mode', async () => {
      const axe = require.resolve('axe-core/axe.min.js');
      const fresh = Date.now();
      // Screens that only appear part-way through a flow, reached by seeding the browser's storage.
      const seeded = {
        'scan.html#shop': { 'fastlane.basket': { id: '', ts: 0, items: [{ barcode: rice.barcode, qty: 2 }], locked: false, started: true } },
        'scan.html#pass': { 'fastlane.basket': { id: 'ABCDEF', ts: fresh, items: [{ barcode: rice.barcode, qty: 2 }], locked: true, started: true } },
        'pickup.html#orders': { 'fastlane.orders': [{ id: 'KM4T7Q', ts: fresh, slot: fresh, items: [{ barcode: bread.barcode, qty: 2 }], total: bread.price * 2, units: 2, status: 'paid' }] },
      };
      for (const colorScheme of ['light', 'dark']) {
        for (const target of [...PAGES, ...Object.keys(seeded)]) {
          const ctx = await plain.newContext({ viewport: phone, colorScheme, bypassCSP: true });
          const [name] = target.split('#');
          if (seeded[target]) {
            await ctx.addInitScript((data) => { for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v)); }, seeded[target]);
          }
          const page = await ctx.newPage();
          await page.goto(`${BASE}/${name}`);
          await page.waitForLoadState('networkidle');
          await page.addScriptTag({ path: axe });
          const violations = await page.evaluate(async () => (await window.axe.run()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`));
          assert.deepEqual(violations, [], `${target} (${colorScheme})`);
          await ctx.close();
        }
      }
    });

    await step('no page logged an error', async () => {
      assert.deepEqual(errors, []);
    });

    console.log(`\n${passed} browser checks passed`);
  } finally {
    for (const b of browsers) await b.close().catch(() => {});
    server.kill();
  }
})().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
