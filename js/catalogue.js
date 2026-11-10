// The product list: the sample file plus anything added on this device from the Products page.
const LOCAL_KEY = 'fastlane.products.local';

export function getLocalProducts() {
  try {
    const list = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    return Array.isArray(list) ? list.filter((p) => p && /^\d{6,14}$/.test(p.barcode) && p.name && Number.isInteger(p.price)) : [];
  } catch { return []; }
}

export function saveLocalProduct(product) {
  const list = getLocalProducts().filter((p) => p.barcode !== product.barcode);
  list.push(product);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
}

export function removeLocalProduct(barcode) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(getLocalProducts().filter((p) => p.barcode !== barcode)));
}

export async function loadSampleProducts() {
  const res = await fetch(new URL('../data/products.json', import.meta.url));
  if (!res.ok) throw new Error('The product list could not be loaded.');
  return res.json();
}

// Map barcode -> { barcode, name, price }. Products added on this device win over the sample file.
export async function loadCatalogue() {
  const map = new Map();
  for (const p of await loadSampleProducts()) map.set(p.barcode, p);
  for (const p of getLocalProducts()) map.set(p.barcode, p);
  return map;
}

export function searchProducts(catalogue, query, limit = 6) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const p of catalogue.values()) {
    const hay = (p.name + ' ' + p.barcode).toLowerCase();
    if (words.every((w) => hay.includes(w))) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}
