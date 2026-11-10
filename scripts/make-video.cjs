// Records docs/fastlane-demo.mp4: a captioned walkthrough of the real app on two phone screens.
// Nothing is faked on screen. The "camera" in each phone is fed the barcode or pass that the
// other screen is showing, and the app's own scanner reads it.
//   npm run video      (needs Playwright and ffmpeg)
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const PORT = 4197;
const BASE = `http://localhost:${PORT}`;
const root = join(__dirname, '..');
const products = JSON.parse(readFileSync(join(root, 'data', 'products.json'), 'utf8'));
const pick = (part) => products.find((p) => p.name.includes(part));
const basket = [pick('rice'), pick('Sliced bread'), pick('Evaporated milk'), pick('detergent')];

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
h1 { font-family: "Bricolage Grotesque", sans-serif; font-size: 82px; font-weight: 750; letter-spacing: -0.045em; line-height: 1; margin: 22px 0 26px; text-wrap: balance; }
p { font-size: 32px; line-height: 1.4; color: #e3e7ff; margin: 0; max-width: 22em; }
.copy > * { transition: opacity .35s; }
.copy.swap > :not(.logo) { opacity: 0; }
.phones { display: flex; gap: 44px; align-items: center; }
.phone { transition: opacity .4s, transform .4s; }
.phone.dim { opacity: .38; transform: scale(.97); }
.phone .label { font-size: 22px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; text-align: center; margin-bottom: 16px; color: #dfe3ff; }
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
  <div class="phone" id="p-shopper"><div class="label">Shopper's phone</div><div class="shell"><iframe name="shopper" allow="camera" src="/scan"></iframe></div></div>
  <div class="phone" id="p-checker"><div class="label">Checker's phone</div><div class="shell"><iframe name="checker" allow="camera" src="/checker"></iframe></div></div>
</div>
<script>
window.caption = (step, title, sub, active) => new Promise((done) => {
  const copy = document.getElementById('copy');
  copy.classList.add('swap');
  setTimeout(() => {
    document.getElementById('step').textContent = step;
    document.getElementById('title').textContent = title;
    document.getElementById('sub').textContent = sub;
    for (const who of ['shopper', 'checker']) {
      const el = document.getElementById('p-' + who);
      el.classList.toggle('on', active === who);
      el.classList.toggle('dim', active !== 'both' && active !== who);
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
  // The clip is silent, so the scanner's beep is switched off.
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
    await context.addInitScript(inFrame);
    await context.route('**/__stage', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: STAGE }));
    const started = Date.now();
    const page = await context.newPage();
    await page.goto(BASE + '/__stage');
    const shop = page.frame({ name: 'shopper' });
    const check = page.frame({ name: 'checker' });
    await shop.getByRole('button', { name: 'Start scanning' }).waitFor();
    await check.getByRole('button', { name: 'Open camera' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const caption = (...args) => page.evaluate((a) => window.caption(...a), args);
    const lead = Date.now() - started; // blank loading time, trimmed off the front later

    await caption('', 'Skip the checkout queue.', 'A one-minute walkthrough of FastLane, on two real phone screens.', 'both');
    await wait(3600);

    await caption('Step 1 of 5', 'The shopper scans each item while they wait.', 'The phone camera reads the barcode. The total adds up as they go.', 'shopper');
    await wait(900);
    await shop.getByRole('button', { name: 'Start scanning' }).click();
    await wait(1300);
    for (const product of basket) {
      const svg = await shop.evaluate(async (code) => (await import('/js/ean13.js')).ean13Svg(code), product.barcode);
      await shop.evaluate((s) => window.__feed(s), svg);
      await shop.locator(`#lines li[data-barcode="${product.barcode}"]`).waitFor({ timeout: 15000 });
      await wait(1150);
      await shop.evaluate(() => window.__feed(null));
      await wait(650);
    }
    await shop.locator(`#lines li[data-barcode="${basket[1].barcode}"]`).getByRole('button', { name: /One more/ }).click();
    await wait(1700);

    await caption('Step 2 of 5', 'One tap turns the basket into a pass.', 'It works once and expires after 15 minutes.', 'shopper');
    await wait(1000);
    await shop.getByRole('button', { name: 'I am at the fast lane' }).click();
    await shop.locator('#qr svg').waitFor();
    await wait(3400);

    await caption('Step 3 of 5', 'At the fast lane, the checker scans the pass.', 'One scan brings up the whole basket, priced from the store list.', 'checker');
    await wait(900);
    await check.getByRole('button', { name: 'Open camera' }).click();
    await wait(1100);
    await check.evaluate((s) => window.__feed(s), sized(await shop.locator('#qr svg').evaluate((el) => el.outerHTML)));
    await check.getByRole('heading', { name: 'Check the basket' }).waitFor({ timeout: 15000 });
    await wait(3000);

    await caption('Step 4 of 5', 'A guided spot check, then payment as usual.', 'The checker finds the named items, counts the basket, and takes cash, POS or transfer.', 'checker');
    await wait(900);
    for (const box of await check.locator('#r-lines input.need').all()) {
      await box.scrollIntoViewIfNeeded();
      await box.check();
      await wait(750);
    }
    await wait(500);
    await check.getByRole('button', { name: 'Basket is correct' }).click();
    await wait(1500);
    await check.getByRole('button', { name: 'POS', exact: true }).click();
    await wait(900);
    await check.getByRole('button', { name: 'Payment received' }).click();
    await check.getByRole('heading', { name: 'Paid' }).waitFor();
    await check.locator('#rc-qr svg').scrollIntoViewIfNeeded();
    await wait(2600);

    await caption('Step 5 of 5', 'The shopper gets a receipt for the door.', 'They scan the code on the checker\'s phone, and their pass becomes a paid receipt.', 'shopper');
    await wait(900);
    await shop.getByRole('button', { name: /I have paid/ }).click();
    await wait(1200);
    await shop.evaluate((s) => window.__feed(s), sized(await check.locator('#rc-qr svg').evaluate((el) => el.outerHTML)));
    await shop.getByRole('heading', { name: 'Paid' }).waitFor({ timeout: 15000 });
    await wait(3800);

    await caption('', 'One branch. Four weekends. A shorter queue.', 'No app to install. No new hardware. Payment stays the way the store takes it today.', 'both');
    await wait(5200);

    const video = page.video();
    await context.close();
    const webm = await video.path();
    mkdirSync(join(root, 'docs'), { recursive: true });
    const out = join(root, 'docs', 'fastlane-demo.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', (lead / 1000 + 0.3).toFixed(2), '-i', webm,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', '25', '-movflags', '+faststart', '-an', out]);
    console.log('video written:', out);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
