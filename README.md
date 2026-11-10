# FastLane

Scan while you wait. Shoppers scan their own basket on their phone while they stand in the checkout queue. At a fast lane, a checker scans one code, confirms the basket and takes payment by cash, POS or transfer.

There is also an order-ahead mode: reserve a short list of essentials from home, pay, and collect at a pickup counter.

This is a demo to show a store manager. It is not ready for a live store: see "What the demo does not do".

## Try it

```bash
npm run serve
```

Then open http://localhost:4173. No install step is needed to run it (the libraries are already in `vendor/`).

A full walk-through needs a laptop and a phone, or two phones:

1. Open `products.html` on a laptop. It shows a sheet of sample barcodes.
2. Open the site on a phone, tap **Start scanning** and scan a few barcodes off the laptop screen.
3. Tap **I am at the fast lane**. The phone shows a code.
4. Open `checker.html` on a second phone (or the laptop webcam) and scan that code.
5. Tick the checks, choose a payment method, tap **Payment received**.

The camera only works on `https://` addresses or on `localhost`. To use phones, deploy the folder to any static host (it is plain files, no build step).

To demo with real products, use **Add a real product** on `products.html`. Added products are saved on that device only.

## Pages

| Page | Who uses it | What it does |
|---|---|---|
| `index.html` | Shopper | Scan barcodes, see a running total, show the fast-lane code |
| `checker.html` | Fast-lane staff | Scan the code, check the basket, record payment, download the sales file |
| `order.html` | Shopper at home | Pick from a short list of essentials, choose a pickup time, pay (simulated), get a pickup code |
| `pickup.html` | Pickup counter staff | Packing list, mark packed, scan or type the order to hand it over |
| `products.html` | Demo setup | Sample barcode sheet, add real products |

## Order ahead

1. Open `order.html`, add a few items and tap **Choose pickup time**.
2. Pick a time and tap **Pay**. No money is taken in the demo.
3. Open `pickup.html` on the same device. The order is on the packing list. Tap **Mark as packed**.
4. Hand it over by typing the order number, or scan the shopper's code from a second device.

Only products marked `"pickup": true` in `data/products.json` are offered, at most 5 of each per order. Pickup times are half-hour slots that start at least 30 minutes ahead, inside sample counter hours of 8am to 9pm. An order can be collected once, and only on its pickup day.

## How cheating is handled

- Prices never come from the shopper's phone. The code carries barcodes and quantities only, and the checker prices the basket from its own product list.
- The checker must find up to three named items, always including the dearest one, and count the whole basket.
- Baskets over 25 items get a full count.
- A code works once, and expires 15 minutes after it is shown.
- A barcode missing from the product list blocks the fast lane for that basket.
- A basket that does not match is sent to a normal till and its code stops working.

## What the demo does not do

- **No server.** The basket travels inside the QR code and "used" codes are remembered on the checker's device only. Two checker phones do not share that list, so a live pilot needs a small server.
- **Order-ahead payment is simulated, and a pickup code is trusted as paid.** Without a server nothing proves an order was paid, so a made-up code would be accepted. A live version must take real payment and check each order against the server.
- **Orders do not travel between devices until the code is scanned.** Staff see an order early only if it was placed on the same device. There is no stock check either.
- **No real product list.** `data/products.json` is sample data with made-up prices and in-store (20x) barcodes. A pilot needs the store's barcodes and prices.
- **No money moves.** The checker takes payment the way the store does today and records the method.
- **No link to the store's till or stock system.** The sales file (CSV) is the hand-off.
- **Items without barcodes** (loose bread, weighed goods) are not handled.

## Tests

```bash
npm test
```

```bash
npm run test:e2e
```

`npm test` runs 21 unit tests on the basket and order rules. `npm run test:e2e` runs 34 checks in a real browser (needs Playwright), including the camera: the app's own barcode and QR code are played back as a fake camera feed and read by the app's scanner.

## Layout

- `js/basket.js`: basket rules, code format, pricing, spot checks, sales export (no DOM)
- `js/scanner.js`: camera and barcode reading
- `js/ean13.js`: barcode check digits and drawing
- `js/catalogue.js`: product list
- `js/orders.js`: order-ahead storage on the device
- `vendor/`: bundled barcode reader (barcode-detector 3.2.3 with zxing-wasm, MIT) and QR writer (qrcode-generator 2.0.4, MIT). Rebuild with `npm install && npm run vendor`.
