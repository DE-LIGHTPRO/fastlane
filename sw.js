// Offline support. Store networks are patchy, so once a page has loaded it must keep working.
// Strategy: always try the network first (so updates show at once), fall back to the cache.
const CACHE = 'fastlane-v6';
const SHELL = [
  './', 'scan', 'order', 'checker', 'assist', 'pickup', 'products', 'poster', 'proposal', 'privacy',
  'css/app.css', 'data/products.json', 'img/icons.svg', 'img/favicon.svg', 'manifest.webmanifest',
  'js/assist.js', 'js/basket.js', 'js/camera-panel.js', 'js/catalogue.js', 'js/checker.js', 'js/config.js', 'js/ean13.js', 'js/landing.js',
  'js/order.js', 'js/orders.js', 'js/proposal.js', 'js/sales.js',
  'js/pickup.js', 'js/poster.js', 'js/products.js', 'js/scanner.js', 'js/shopper.js', 'js/ui.js',
  'vendor/barcode-detector.js', 'vendor/qrcode.js', 'vendor/zxing_reader.wasm',
  'vendor/fonts/inter-latin-wght-normal.woff2', 'vendor/fonts/bricolage-latin-wght-normal.woff2', 'img/qr-demo.svg', 'vendor/fonts/inter-latin-ext-wght-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request, { ignoreSearch: true })) || Response.error()),
  );
});
