// Records docs/fastlane-demo.mp4: a captioned tour of the whole app on two phone screens,
// with a quiet music bed, a beep for each scan and a chime for each payment.
// Nothing on screen is faked. The "camera" in each phone is fed the barcode or pass that the
// other screen is showing, and the app's own scanner reads it.
// It also writes docs/voiceover-script.txt: one line to speak per caption, with its time.
//   npm run video      (needs Playwright, ffmpeg and Python with numpy)
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const PORT = 4197;
const BASE = `http://localhost:${PORT}`;
const root = join(__dirname, '..');
const products = JSON.parse(readFileSync(join(root, 'data', 'products.json'), 'utf8'));
const pick = (part) => products.find((p) => p.name.includes(part));
const basket = [pick('rice'), pick('Sliced bread'), pick('Evaporated milk'), pick('detergent')];
const staffBasket = [pick('Spaghetti'), pick('Vegetable oil')];

const STAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FastLane walkthrough</title>
<style>
@font-face { font-family: "Bricolage Grotesque"; font-weight: 200 800; src: url("/vendor/fonts/bricolage-latin-wght-normal.woff2") format("woff2-variations"); }
@font-face { font-family: "Inter Variable"; font-weight: 100 900; src: url("/vendor/fonts/inter-latin-wght-normal.woff2") format("woff2-variations"); }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; }
body { color: #fff; font-family: "Inter Variable", system-ui, sans-serif;
  background-color: #0016b8;
  background-image: radial-gradient(rgba(255,255,255,.09) 1.5px, transparent 2px), linear-gradient(180deg, #001cdd 0%, #00129a 100%);
  background-size: 32px 32px, 100% 100%;
  border-bottom: 14px solid #ffee05; display: grid; grid-template-columns: 1fr auto; gap: 60px; padding: 70px 90px 60px; }
.copy { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.logo { display: flex; align-items: center; gap: 16px; font-weight: 700; font-size: 38px; letter-spacing: -0.02em; position: absolute; top: 64px; left: 90px; }
.logo svg { width: 54px; height: 54px; }
.step { font-size: 24px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #ffee05; min-height: 34px; }
h1 { font-family: "Bricolage Grotesque", sans-serif; font-size: 78px; font-weight: 750; letter-spacing: -0.045em; line-height: 1.01; margin: 22px 0 26px; text-wrap: balance; }
p { font-size: 31px; line-height: 1.4; color: #e3e7ff; margin: 0; max-width: 22em; }
.copy > * { transition: opacity .35s; }
.copy.swap > :not(.logo) { opacity: 0; }
.phones { display: flex; gap: 44px; align-items: center; }
.phone { transition: opacity .4s, transform .4s; }
.phone.dim { opacity: .38; transform: scale(.97); }
.phone .label { font-size: 22px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; text-align: center; margin-bottom: 16px; color: #dfe3ff; white-space: nowrap; }
.phone.on .label { color: #ffee05; }
.shell { width: 409px; height: 862px; border: 11px solid #050b3d; border-radius: 52px; overflow: hidden; background: #050b3d; box-shadow: 0 40px 100px rgba(2,6,45,.6); }
.phone.on .shell { box-shadow: 0 0 0 5px #ffee05, 0 40px 100px rgba(2,6,45,.6); }
iframe { width: 375px; height: 814px; border: 0; transform: scale(1.032); transform-origin: 0 0; background: #f5f6fb; display: block; }
</style></head><body>
<div class="copy" id="copy">
  <div class="logo"><svg viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="6" fill="#ffee05"/><path d="M7 7.5l4.5 4.5L7 16.5M12.5 7.5L17 12l-4.5 4.5" fill="none" stroke="#001cdd" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>FastLane</div>
  <div class="step" id="step"></div>
  <h1 id="title"></h1>
  <p id="sub"></p>
</div>
<div class="phones">
  <div class="phone" id="p-left"><div class="label" id="l-left">Shopper's phone</div><div class="shell"><iframe name="left" allow="camera" src="/scan"></iframe></div></div>
  <div class="phone" id="p-right"><div class="label" id="l-right">Checker's phone</div><div class="shell"><iframe name="right" allow="camera" src="/checker"></iframe></div></div>
</div>
<script>
window.caption = (step, title, sub, active, labels) => new Promise((done) => {
  const copy = document.getElementById('copy');
  copy.classList.add('swap');
  setTimeout(() => {
    document.getElementById('step').textContent = step;
    document.getElementById('title').textContent = title;
    document.getElementById('sub').textContent = sub;
    if (labels) {
      document.getElementById('l-left').textContent = labels[0];
      document.getElementById('l-right').textContent = labels[1];
    }
    for (const side of ['left', 'right']) {
      const el = document.getElementById('p-' + side);
      el.classList.toggle('on', active === side);
      el.classList.toggle('dim', active !== 'both' && active !== side);
    }
    copy.classList.remove('swap');
    done();
  }, 380);
});
</script></body></html>`;

// Runs in every frame before the app loads: a controllable camera feed, and a visible tap mark.
function inFrame() {
  if (window === window.top) return;
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 480;
  const g = canvas.getContext('2d');
  let img = null;
  let t = 0;
  (function draw() {
    t += 1;
    g.fillStyle = '#c9ccd9';
    g.fillRect(0, 0, 640, 480);
    if (img) {
      const s = Math.min(500 / img.width, 360 / img.height);
      const w = img.width * s, h = img.height * s;
      const dx = Math.sin(t / 22) * 5, dy = Math.cos(t / 31) * 4; // a hand is never perfectly still
      g.fillStyle = '#fff';
      g.fillRect((640 - w) / 2 - 18 + dx, (480 - h) / 2 - 18 + dy, w + 36, h + 36);
      g.drawImage(img, (640 - w) / 2 + dx, (480 - h) / 2 + dy, w, h);
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
  // The soundtrack is added afterwards, so the app's own beep is switched off.
  window.AudioContext = undefined;
  window.webkitAudioContext = undefined;
  document.addEventListener('pointerdown', (e) => {
    const dot = document.createElement('div');
    Object.assign(dot.style, { position: 'fixed', left: e.clientX - 22 + 'px', top: e.clientY - 22 + 'px', width: '44px', height: '44px', borderRadius: '50%', background: 'rgba(255, 238, 5, 0.75)', border: '2px solid #001cdd', pointerEvents: 'none', zIndex: 9999 });
    document.documentElement.append(dot);
    dot.animate([{ transform: 'scale(0.4)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 520, easing: 'ease-out' }).onfinish = () => dot.remove();
  }, true);
}

const sized = (svg) => svg.replace('<svg ', '<svg width="600" height="600" ');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

(async () => {
  const server = spawn(process.execPath, [join(root, 'scripts', 'serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => server.stdout.once('data', r));
  const dir = mkdtempSync(join(tmpdir(), 'fastlane-video-'));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir, size: { width: 1920, height: 1080 } },
      colorScheme: 'light',
      permissions: ['camera'],
      serviceWorkers: 'block',
    });
    // A fixed Saturday evening, so pickup times and receipts read the same on every recording.
    await context.clock.install({ time: new Date(2026, 10, 14, 18, 10) });
    await context.addInitScript(inFrame);
    await context.route('**/__stage', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: STAGE }));
    const started = Date.now();
    const page = await context.newPage();
    await page.goto(BASE + '/__stage');
    const left = page.frame({ name: 'left' });
    const right = page.frame({ name: 'right' });
    await left.getByRole('button', { name: 'Start scanning' }).waitFor();
    await right.getByRole('button', { name: 'Open camera' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const TRIM = Date.now() - started + 300; // blank loading time, cut off the front later
    const now = () => (Date.now() - started - TRIM) / 1000;
    const events = []; // moments that get a sound
    const sound = (type) => events.push({ t: now(), type });
    const script = []; // one spoken line per caption
    const caption = async (step, title, sub, active, say, labels) => {
      await page.evaluate((a) => window.caption(...a), [step, title, sub, active, labels || null]);
      script.push({ t: now(), step, say });
    };
    const feed = (frame, svg) => frame.evaluate((s) => window.__feed(s), svg);
    const barcodeOf = (code) => left.evaluate(async (c) => (await import('/js/ean13.js')).ean13Svg(c), code);
    const scanItems = async (frame, items) => {
      for (const product of items) {
        await feed(frame, await barcodeOf(product.barcode));
        await frame.locator(`#lines li[data-barcode="${product.barcode}"]`).waitFor({ timeout: 15000 });
        sound('scan');
        await wait(1100);
        await feed(frame, null);
        await wait(600);
      }
    };

    // ---- Opening
    await caption('', 'Skip the checkout queue.', 'A two-minute tour of FastLane, on real phone screens.', 'both',
      'This is FastLane: a way to skip the checkout queue.');
    await wait(3600);
    await caption('The problem', 'Every item is scanned at the till.', 'A few cashiers do all the scanning while a long queue waits. FastLane moves that work into the queue.', 'both',
      'A few cashiers scan every item while a long queue waits.');
    await wait(5600);

    // ---- Scan while you wait
    await caption('Scan while you wait · 1 of 6', 'The shopper scans each item while they wait.', 'The phone camera reads the barcode. The total adds up as they go. Nothing to install.', 'left',
      'While they wait, the shopper scans each item with their own phone. The total adds up as they go, and there is nothing to install.');
    await wait(900);
    await left.getByRole('button', { name: 'Start scanning' }).click();
    await wait(1300);
    await scanItems(left, basket);
    await left.locator(`#lines li[data-barcode="${basket[1].barcode}"]`).getByRole('button', { name: /One more/ }).click();
    await wait(1600);

    await caption('Scan while you wait · 2 of 6', 'One tap turns the basket into a pass.', 'It works once and expires after 15 minutes.', 'left',
      'One tap turns the basket into a pass that works only once.');
    await wait(1000);
    await left.getByRole('button', { name: 'I am at the fast lane' }).click();
    await left.locator('#qr svg').waitFor();
    const passSvg = sized(await left.locator('#qr svg').evaluate((el) => el.outerHTML));
    await wait(3600);

    await caption('Scan while you wait · 3 of 6', 'At the fast lane, the checker scans the pass.', 'One scan brings up the whole basket, priced from the store list, never from the shopper\'s phone.', 'right',
      'At the fast lane, the checker scans the pass and sees the whole basket.');
    await wait(900);
    await right.getByRole('button', { name: 'Open camera' }).click();
    await wait(1100);
    await feed(right, passSvg);
    await right.getByRole('heading', { name: 'Check the basket' }).waitFor({ timeout: 15000 });
    sound('scan');
    await feed(right, null);
    await wait(3400);

    await caption('Scan while you wait · 4 of 6', 'A guided spot check.', 'The checker finds the named items and counts the basket. Items with no barcode, like a bakery loaf, are added here.', 'right',
      'The app tells the checker which items to find. Items with no barcode are added here.');
    await wait(1200);
    await right.locator('#extras button').first().scrollIntoViewIfNeeded();
    await wait(700);
    await right.locator('#extras button').first().click();
    await wait(1700);
    for (const box of await right.locator('#r-lines input.need').all()) {
      await box.scrollIntoViewIfNeeded();
      await box.check();
      await wait(750);
    }
    await wait(700);

    await caption('Scan while you wait · 5 of 6', 'Payment stays the way it is today.', 'Cash, POS or transfer, taken by a member of staff. Nobody has to trust a new payment app.', 'right',
      'Payment stays as it is today: cash, P O S or transfer.');
    await wait(900);
    await right.getByRole('button', { name: 'Basket is correct' }).click();
    await wait(1700);
    await right.getByRole('button', { name: 'POS', exact: true }).click();
    await wait(1000);
    await right.getByRole('button', { name: 'Payment received' }).click();
    await right.getByRole('heading', { name: 'Paid' }).waitFor();
    sound('paid');
    await right.locator('#rc-qr svg').scrollIntoViewIfNeeded();
    await wait(2600);

    await caption('Scan while you wait · 6 of 6', 'The shopper gets a receipt for the door.', 'They scan the code on the checker\'s phone, and their pass becomes a paid receipt.', 'left',
      'The shopper scans the checker\'s phone, and gets a paid receipt for the door.');
    await wait(900);
    await left.getByRole('button', { name: /I have paid/ }).click();
    await wait(1200);
    await feed(left, sized(await right.locator('#rc-qr svg').evaluate((el) => el.outerHTML)));
    await left.getByRole('heading', { name: 'Paid' }).waitFor({ timeout: 15000 });
    sound('scan');
    sound('paid');
    await feed(left, null);
    await wait(3800);

    // ---- Safeguard
    await caption('Safeguard', 'A pass only works once.', 'Shown a second time, it is refused. Every pass also expires, and big baskets get a full count.', 'right',
      'A pass only works once. If someone shows it again, the checker\'s phone refuses it.');
    await wait(900);
    await right.getByRole('button', { name: 'Next shopper' }).click();
    await wait(1000);
    await feed(right, passSvg);
    await right.locator('#scan-error:not([hidden])').waitFor({ timeout: 15000 });
    await feed(right, null);
    await right.locator('#scan-error').scrollIntoViewIfNeeded();
    await wait(4200);

    // ---- Staff scan
    await left.goto(BASE + '/assist');
    await caption('No phone? No problem', 'Staff can scan a basket in the queue.', 'For shoppers without a smartphone. A member of staff scans, then takes payment on the spot.', 'left',
      'For shoppers without a smartphone, a member of staff scans the basket in the queue and takes payment on the spot.',
      ['Staff phone', 'Checker\'s phone']);
    await wait(1000);
    await left.getByRole('button', { name: 'Open camera' }).click();
    await wait(1100);
    await scanItems(left, staffBasket);
    await left.getByRole('button', { name: 'Take payment' }).click();
    await wait(1400);
    await left.getByRole('button', { name: 'Cash', exact: true }).click();
    await wait(900);
    await left.getByRole('button', { name: 'Payment received' }).click();
    await left.getByRole('heading', { name: 'Paid' }).waitFor();
    sound('paid');
    await wait(3000);

    // ---- Order ahead
    await left.goto(BASE + '/order');
    await right.goto(BASE + '/pickup');
    await left.locator('#list li').first().waitFor();
    await caption('Order ahead · 1 of 3', 'Bread and essentials, reserved from home.', 'A short list of fast sellers. The shopper picks a half-hour pickup time and pays.', 'left',
      'There is a second way to skip the queue. From home, the shopper reserves bread and other essentials, picks a pickup time, and pays.',
      ['Shopper, at home', 'Pickup counter']);
    await wait(900);
    const more = async (name, times) => {
      const row = left.locator('#list li', { hasText: name });
      await row.scrollIntoViewIfNeeded();
      for (let i = 0; i < times; i++) { await row.getByRole('button', { name: /One more/ }).click(); await wait(480); }
    };
    await more('Sliced bread', 2);
    await more('Bottled water', 3);
    await more('Evaporated milk', 1);
    await wait(700);
    await left.getByRole('button', { name: 'Choose pickup time' }).click();
    await wait(1500);
    await left.locator('#slots button').first().click();
    await wait(1000);
    await left.getByRole('button', { name: 'Continue to payment' }).scrollIntoViewIfNeeded();
    await wait(600);
    await left.getByRole('button', { name: 'Continue to payment' }).click();
    await wait(1400);
    await left.getByRole('button', { name: 'Card', exact: true }).click();
    await wait(1000);
    await left.locator('#pay').click();
    await left.locator('#qr svg').waitFor();
    sound('paid');
    await wait(3000);

    await caption('Order ahead · 2 of 3', 'Staff pack it before the pickup time.', 'The order appears on the counter\'s packing list the moment it is paid.', 'right',
      'The order appears on the pickup counter\'s packing list, and staff pack it before the pickup time.');
    await right.locator('#to-pack .card').first().waitFor({ timeout: 10000 }); // arrives through the browser's storage event
    await right.locator('#to-pack .card').first().scrollIntoViewIfNeeded();
    await wait(2600);
    await right.locator('#to-pack').getByRole('button', { name: 'Mark as packed' }).click();
    await wait(1300);
    await right.locator('#ready .card').first().scrollIntoViewIfNeeded();
    await wait(2200);

    await caption('Order ahead · 3 of 3', 'One scan, and it is handed over.', 'No queue at all for the things people buy most. An order can only be collected once.', 'right',
      'When the shopper arrives, one scan at the counter and the order is handed over. No queue at all.');
    await right.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await wait(900);
    await right.getByRole('button', { name: 'Scan a pass' }).click();
    await wait(1100);
    await feed(right, sized(await left.locator('#qr svg').evaluate((el) => el.outerHTML)));
    await right.getByRole('heading', { name: 'Hand over' }).waitFor({ timeout: 15000 });
    sound('scan');
    await feed(right, null);
    await wait(2400);
    await right.getByRole('button', { name: 'Handed to the shopper' }).click();
    await right.getByRole('heading', { name: 'Collected' }).waitFor();
    sound('paid');
    await wait(3000);

    // ---- For the store
    await left.goto(BASE + '/checker');
    await right.goto(BASE + '/poster');
    await left.locator('.stats').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    // The sign warns when it is opened from a local address; that note is not part of the product tour.
    await right.locator('#local-note').evaluate((el) => { el.hidden = true; });
    await right.locator('.poster').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await caption('For the store', 'Every basket is recorded.', 'Takings by payment method and a sales file for reconciliation. A printed sign at the queue starts it all.', 'both',
      'For the store, every basket is recorded, with takings by payment method and a sales file.',
      ['Checker\'s phone', 'Queue sign']);
    await wait(6200);

    // ---- Close
    await caption('', 'One branch. Four weekends. A shorter queue.', 'No app to install. No new hardware. Payment stays the way the store takes it today.', 'both',
      'No app to install, no new hardware. One branch, four weekends, and a shorter queue.');
    await wait(6000);

    const video = page.video();
    await context.close();
    const webm = await video.path();
    mkdirSync(join(root, 'docs'), { recursive: true });
    const out = join(root, 'docs', 'fastlane-demo.mp4');
    const silent = join(dir, 'silent.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', (TRIM / 1000).toFixed(2), '-i', webm,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-pix_fmt', 'yuv420p', '-r', '25', '-an', silent]);
    const seconds = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', silent]).toString().trim();
    const eventsFile = join(dir, 'events.json');
    const wav = join(dir, 'sound.wav');
    writeFileSync(eventsFile, JSON.stringify(events));
    execFileSync('python3', [join(root, 'scripts', 'make-audio.py'), eventsFile, seconds, wav], { stdio: 'inherit' });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out]);

    const lines = ['FastLane walkthrough: voiceover script', `Video length ${clock(Number(seconds))}. Start each line at the time shown; each has about the gap to the next line to be spoken in.`, ''];
    for (const line of script) lines.push(`[${clock(Math.max(0, line.t))}]${line.step ? ' (' + line.step + ')' : ''}`, line.say, '');
    writeFileSync(join(root, 'docs', 'voiceover-script.txt'), lines.join('\n'));
    console.log('video written:', out, `(${clock(Number(seconds))})`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
