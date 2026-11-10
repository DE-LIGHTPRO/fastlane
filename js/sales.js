// Sales recorded on this staff device, shared by the checker and staff-scan pages.
const KEY = 'fastlane.sales';

export function loadSales() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export function recordSale(sale) {
  const sales = loadSales();
  sales.push(sale);
  localStorage.setItem(KEY, JSON.stringify(sales));
}

export function clearSales() {
  localStorage.removeItem(KEY);
}

export function summarise(sales) {
  const paid = sales.filter((s) => s.status === 'paid');
  const sum = (list) => list.reduce((t, s) => t + s.total, 0);
  return {
    count: paid.length,
    total: sum(paid),
    cash: sum(paid.filter((s) => s.method === 'cash')),
    pos: sum(paid.filter((s) => s.method === 'pos')),
    transfer: sum(paid.filter((s) => s.method === 'transfer')),
    rejected: sales.filter((s) => s.status === 'rejected').length,
    staffScanned: paid.filter((s) => s.lane === 'staff-scan').length,
  };
}
