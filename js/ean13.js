// EAN-13 helpers: check digit, validation and an SVG renderer for the demo barcode sheet.

export function ean13CheckDigit(first12) {
  if (!/^\d{12}$/.test(first12)) throw new Error('EAN-13 needs 12 digits before the check digit');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

export function isValidEan13(code) {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === code[12];
}

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
// Which of the six left-hand digits use the G pattern, chosen by the first digit.
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function ean13Modules(code) {
  if (!isValidEan13(code)) throw new Error('Not a valid EAN-13: ' + code);
  const parity = PARITY[Number(code[0])];
  let bits = '101';
  for (let i = 0; i < 6; i++) {
    const d = Number(code[i + 1]);
    bits += parity[i] === 'L' ? L[d] : G[d];
  }
  bits += '01010';
  for (let i = 0; i < 6; i++) bits += R[Number(code[i + 7])];
  return bits + '101'; // 95 modules
}

export function ean13Svg(code, { moduleWidth = 3, height = 90 } = {}) {
  const bits = ean13Modules(code);
  const quiet = 11; // quiet zone in modules, each side
  const width = (bits.length + quiet * 2) * moduleWidth;
  let rects = '';
  let run = 0;
  for (let i = 0; i <= bits.length; i++) {
    if (bits[i] === '1') { run++; continue; }
    if (run) {
      rects += `<rect x="${(quiet + i - run) * moduleWidth}" y="0" width="${run * moduleWidth}" height="${height}"/>`;
      run = 0;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + 22}" width="${width}" height="${height + 22}" role="img" aria-label="Barcode ${code}">` +
    `<rect width="100%" height="100%" fill="#fff"/><g fill="#000" shape-rendering="crispEdges">${rects}</g>` +
    `<text x="${width / 2}" y="${height + 17}" text-anchor="middle" font-family="monospace" font-size="15" fill="#000">${code}</text></svg>`;
}
