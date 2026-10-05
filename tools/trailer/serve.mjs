// tools/trailer/serve.mjs — a tiny static file server for the trailer work copy.
//
// Dev tool only (never part of the app runtime). It serves the PATCHED copy in
// tools/trailer/.work/site on 127.0.0.1 so the Claude Design runtime can fetch()
// its .jsx modules (file:// would not allow that). Read-only, GET/HEAD only,
// every path is contained inside the root.
//
//   node tools/trailer/serve.mjs [root] [--port N]      (default root: .work/site, port: random)
//
// render-main.js imports serve() and starts it on a random port itself.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.join(HERE, '.work', 'site');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/** Resolve a URL path inside root; null when it would escape the root. */
export function resolveInside(root, urlPath) {
  let rel;
  try { rel = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0]); } catch { return null; }
  if (rel.includes('\0')) return null;
  const abs = path.resolve(root, '.' + path.posix.normalize('/' + rel.replace(/\\/g, '/')));
  const r = path.resolve(root);
  if (abs !== r && !abs.startsWith(r + path.sep)) return null;
  return abs;
}

/**
 * Start the server. Resolves to { url, port, close() }.
 * @param {string} root directory to serve
 * @param {{port?: number, host?: string, quiet?: boolean}} [opts]
 */
export function serve(root = DEFAULT_ROOT, { port = 0, host = '127.0.0.1', quiet = true } = {}) {
  const base = path.resolve(root);
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
    return Promise.reject(new Error('serve: root is not a directory: ' + base));
  }
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let file = resolveInside(base, req.url || '/');
    if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (!quiet) console.log('[serve] 404', req.url);
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const p = server.address().port;
      resolve({ url: `http://${host}:${p}/`, port: p, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const pi = argv.indexOf('--port');
  const port = pi >= 0 ? +argv[pi + 1] : 0;
  const root = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--port') || DEFAULT_ROOT;
  serve(root, { port, quiet: false }).then(({ url }) => {
    console.log('[serve] ' + path.resolve(root) + ' at ' + url + '  (Ctrl+C to stop)');
  }, (e) => { console.error(e.message); process.exit(1); });
}
