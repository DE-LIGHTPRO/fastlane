// Tiny static server for local use: `npm run serve`, then open http://localhost:4173
// It sends the same security headers as vercel.json, so what works here works when deployed.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};
const port = Number(process.env.PORT || 4173);

const security = {};
for (const h of JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).headers[0].headers) {
  // frame-ancestors is dropped locally so in-app preview panes can show the site.
  security[h.key] = h.key === 'Content-Security-Policy' ? h.value.replace(/;\s*frame-ancestors [^;]*/, '') : h.value;
}

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // Mirror Vercel's cleanUrls: /scan.html redirects to /scan, and /scan serves scan.html.
  if (path.endsWith('.html') && path !== '/404.html') {
    res.writeHead(308, { location: path === '/index.html' ? '/' : path.slice(0, -5) }).end();
    return;
  }
  if (path.endsWith('/')) path += 'index.html';
  else if (!extname(path)) path += '.html';
  const file = normalize(join(root, path));
  const hidden = path.split('/').some((part) => part.startsWith('.') || part === 'node_modules');
  const headers = { ...security, 'cache-control': 'no-store' };
  if (hidden || (file !== root && !file.startsWith(root + sep))) { res.writeHead(403, headers).end('Forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { ...headers, 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    const body = await readFile(join(root, '404.html')).catch(() => 'Not found');
    res.writeHead(404, { ...headers, 'content-type': types['.html'] }).end(body);
  }
}).listen(port, () => console.log(`FastLane on http://localhost:${port}`));
