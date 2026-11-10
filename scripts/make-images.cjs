// Renders the app icons and the social preview image. Run with: npm run images (needs Playwright).
const { chromium } = require('playwright');
const { join } = require('node:path');
const out = (name) => join(__dirname, '..', 'img', name);

const mark = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${24 + pad * 2} ${24 + pad * 2}" width="100%" height="100%">
  <rect x="${-pad}" y="${-pad}" width="${24 + pad * 2}" height="${24 + pad * 2}" fill="#001cdd"/>
  <path d="M7 7.5l4.5 4.5L7 16.5M12.5 7.5L17 12l-4.5 4.5" fill="none" stroke="#ffee05" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
  <rect x="1" y="1" width="22" height="22" rx="6" fill="#001cdd"/>
  <path d="M7 7.5l4.5 4.5L7 16.5M12.5 7.5L17 12l-4.500 4.500" fill="none" stroke="#ffee05" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

(async () => {
  const browser = await chromium.launch();
  const shot = async (html, width, height, name, transparent = false) => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(`<style>html,body{margin:0;height:100%;background:${transparent ? 'transparent' : '#001cdd'}}</style>${html}`);
    await page.screenshot({ path: out(name), omitBackground: transparent });
    await page.close();
  };
  await shot(rounded, 192, 192, 'icon-192.png', true);
  await shot(rounded, 512, 512, 'icon-512.png', true);
  await shot(mark(5), 512, 512, 'icon-maskable-512.png');
  await shot(mark(2), 180, 180, 'apple-touch-icon.png');

  const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await og.setContent(`<style>
    html,body{margin:0;height:100%}
    body{background:#001cdd;color:#fff;border-bottom:18px solid #ffee05;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box}
    .logo{display:flex;align-items:center;gap:18px;font-size:40px;font-weight:700;letter-spacing:-0.02em}
    .logo div{width:64px;height:64px}
    h1{font-size:84px;line-height:1.02;letter-spacing:-0.04em;margin:44px 0 26px;font-weight:700;max-width:940px}
    p{font-size:32px;color:#d6dbff;margin:0;max-width:900px;line-height:1.35}
  </style>
  <div class="logo"><div>${rounded}</div>FastLane</div>
  <h1>Skip the checkout queue. Scan while you wait.</h1>
  <p>Shoppers scan their own basket in line, then pay at the fast lane.</p>`);
  await og.screenshot({ path: out('og.png') });
  await browser.close();
  console.log('images written');
})();
