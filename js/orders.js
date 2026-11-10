// Order-ahead storage. In this demo orders live in the browser, so the staff
// Pickup page sees an order early only when it was placed on the same device.
// On another device the order arrives when the shopper's code is scanned.
import { sameLocalDay } from './basket.js';

const KEY = 'fastlane.orders';

export function loadOrders() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export function saveOrder(order) {
  const list = loadOrders().filter((o) => o.id !== order.id);
  list.push(order);
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function findOrder(id) {
  return loadOrders().find((o) => o.id === id) || null;
}

// { day: 'Today', range: '7:00 PM to 7:30 PM' }
export function slotParts(slot, now = Date.now()) {
  const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const tomorrow = now + 24 * 60 * 60 * 1000;
  const day = sameLocalDay(slot, now) ? 'Today' : sameLocalDay(slot, tomorrow) ? 'Tomorrow'
    : new Date(slot).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return { day, range: `${t(slot)} to ${t(slot + 30 * 60 * 1000)}` };
}

export function slotLabel(slot, now = Date.now()) {
  const { day, range } = slotParts(slot, now);
  return `${day}, ${range}`;
}
