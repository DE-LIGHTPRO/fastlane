// Offline support. Store networks are patchy, so once a page has loaded it must keep working.
// Strategy: always try the network first (so updates show at once), fall back to the cache.
const CACHE = 'fastlane-v3';
const SHELL = [
  './', 'index.html', 'scan.html', 'order.html', 'checker.html', 'pickup.html', 'products.html', 'poster.html',
  'css/app.css', 'data/products.json', 'img/icons.svg', 'img/favicon.svg', 'manifest.webmanifest',
  'js/basket.js', 'js/camera-panel.js', 'js/catalogue.js', 'js/checker.js', 'js/ean13.js', 'js/order.js', 'js/orders.js',
  'js/pickup.js', 'js/poster.js', 'js/products.js', 'js/scanner.js', 'js/shopper.js', 'js/ui.js',
  'vendor/barcode-detector.js', 'vendor/qrcode.js', 'vendor/zxing_reader.wasm',
  'vendor/fonts/inter-latin-wght-normal.woff2', 'vendor/fonts/inter-latin-ext-wght-normal.woff2',
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
