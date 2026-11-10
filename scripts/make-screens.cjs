// Captures the screenshots in docs/screens. Needs the site running: npm run serve, then npm run screens.
const { chromium } = require('playwright');
const { join } = require('node:path');
const BASE = process.env.BASE || 'http://localhost:4173';
const out = (name) => join(__dirname, '..', 'docs', 'screens', name);

(async () => {
  const browser = await chromium.launch();
  const when = new Date(2026, 10, 14, 18, 10);

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const land = await desktop.newPage();
  await land.goto(BASE + '/');
  await land.waitForLoadState('networkidle');
  await land.screenshot({ path: out('landing-desktop.png') });
  await land.screenshot({ path: out('landing-desktop-full.png'), fullPage: true });
  await land.goto(BASE + '/products.html');
  await land.waitForSelector('#sheet svg');
  await land.screenshot({ path: out('products-desktop.png') });

  for (const colorScheme of ['light', 'dark']) {
    const tag = colorScheme === 'dark' ? '-dark' : '';
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme });
    await ctx.clock.install({ time: when });
    const p = await ctx.newPage();
    const add = async (q) => { await p.locator('#search').fill(q); await p.locator('#results button').first().click(); };

    await p.goto(BASE + '/');
    await p.waitForLoadState('networkidle');
    await p.screenshot({ path: out(`landing-phone${tag}.png`) });

    await p.goto(BASE + '/scan.html');
    await p.screenshot({ path: out(`scan-welcome${tag}.png`) });
    await p.getByRole('button', { name: 'Start scanning' }).click();
    for (const q of ['rice', 'noodles, chicken', 'milk tin', 'bread']) await add(q);
    await p.locator('#lines li').nth(1).getByRole('button', { name: /One more/ }).click();
    await p.waitForTimeout(3200);
    await p.screenshot({ path: out(`scan-basket${tag}.png`) });
    await p.getByRole('button', { name: 'I am at the fast lane' }).click();
    await p.locator('#qr svg').waitFor();
    await p.screenshot({ path: out(`scan-pass${tag}.png`) });
    const basket = JSON.parse(await p.evaluate(() => localStorage.getItem('fastlane.basket')));
    const text = ['FL1', basket.id, basket.ts, ...basket.items.map((i) => `${i.barcode}*${i.qty}`)].join('/');

    await p.goto(BASE + '/checker.html');
    await p.screenshot({ path: out(`checker-scan${tag}.png`), fullPage: true });
    await p.locator('details.fallback summary').click();
    await p.locator('#paste').fill(text);
    await p.getByRole('button', { name: 'Open basket' }).click();
    await p.locator('#r-lines input.need').first().check();
    await p.screenshot({ path: out(`checker-review${tag}.png`), fullPage: true });
    for (const box of await p.locator('#r-lines input.need').all()) await box.check();
    await p.getByRole('button', { name: 'Basket is correct' }).click();
    await p.getByRole('button', { name: 'Transfer' }).click();
    await p.screenshot({ path: out(`checker-pay${tag}.png`) });
    await p.getByRole('button', { name: 'Payment received' }).click();
    await p.screenshot({ path: out(`checker-paid${tag}.png`) });

    await p.goto(BASE + '/order.html');
    const more = async (name, n) => { for (let i = 0; i < n; i++) await p.locator('#list li', { hasText: name }).getByRole('button', { name: /One more/ }).click(); };
    await more('bread', 2); await more('water', 3); await more('milk', 1);
    await p.screenshot({ path: out(`order-browse${tag}.png`) });
    await p.getByRole('button', { name: 'Choose pickup time' }).click();
    await p.locator('#slots button').nth(1).click();
    await p.screenshot({ path: out(`order-time${tag}.png`), fullPage: true });
    await p.locator('#pay').click();
    await p.screenshot({ path: out(`order-pass${tag}.png`), fullPage: true });

    await p.goto(BASE + '/pickup.html');
    await p.screenshot({ path: out(`pickup${tag}.png`), fullPage: true });
    if (!tag) {
      await p.goto(BASE + '/poster.html');
      await p.screenshot({ path: out('queue-sign.png'), fullPage: true });
      await p.goto(BASE + '/scan.html');
      await p.locator('.menu summary').click();
      await p.screenshot({ path: out('menu.png') });
    }
    await ctx.close();
  }
  await browser.close();
  console.log('screens written');
})();
