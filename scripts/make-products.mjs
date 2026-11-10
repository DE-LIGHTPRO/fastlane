// Writes data/products.json. Barcodes use the 20x prefix, which the barcode
// standard reserves for in-store use, so they cannot clash with real products.
// Names and prices are sample data for the demo, not any store's real prices.
import { writeFileSync } from 'node:fs';
import { ean13CheckDigit } from '../js/ean13.js';

const items = [
  ['Instant noodles, chicken 70g', 350], ['Instant noodles, pack of 40', 13500], ['Evaporated milk tin 160g', 900],
  ['Powdered milk sachet 350g', 4200], ['Granulated sugar 1kg', 2100], ['Long grain rice 5kg', 9800],
  ['Spaghetti 500g', 1150], ['Vegetable oil 3 litres', 8900], ['Tomato paste sachet 70g', 250],
  ['Seasoning cubes, pack of 50', 1400], ['Table salt 500g', 400], ['Sliced bread, family loaf', 1600],
  ['Cornflakes 500g', 3900], ['Chocolate drink 400g', 4300], ['Tea bags, box of 50', 1900],
  ['Bottled water 75cl', 250], ['Malt drink can 33cl', 700], ['Orange juice 1 litre', 2400],
  ['Bar soap 150g', 650], ['Laundry detergent 900g', 2900], ['Toothpaste 140g', 1500],
  ['Toilet tissue, pack of 4', 2200], ['Baby diapers, pack of 44', 11500], ['Body lotion 400ml', 3600],
];
// The short list offered for order-ahead pickup: fast sellers that need no aisle-walking.
const PICKUP = new Set(['Sliced bread, family loaf', 'Bottled water 75cl', 'Evaporated milk tin 160g', 'Granulated sugar 1kg',
  'Instant noodles, pack of 40', 'Long grain rice 5kg', 'Toilet tissue, pack of 4', 'Laundry detergent 900g']);
const products = items.map(([name, naira], i) => {
  const first12 = '200000' + String(100 + i * 7).padStart(6, '0');
  const product = { barcode: first12 + ean13CheckDigit(first12), name, price: naira * 100 };
  if (PICKUP.has(name)) product.pickup = true;
  return product;
});
// Items sold without a barcode. Shoppers cannot scan these; staff add them at the fast lane.
const loose = [['Fresh bakery loaf', 1400], ['Eggs, crate of 30', 5800], ['Sachet water, bag of 20', 500]];
loose.forEach(([name, naira], i) => {
  const first12 = '299000' + String(100 + i).padStart(6, '0');
  products.push({ barcode: first12 + ean13CheckDigit(first12), name, price: naira * 100, loose: true });
});
writeFileSync(new URL('../data/products.json', import.meta.url), JSON.stringify(products, null, 2) + '\n');
console.log('wrote', products.length, 'products');
