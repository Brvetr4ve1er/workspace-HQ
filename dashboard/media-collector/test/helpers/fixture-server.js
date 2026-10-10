'use strict';
// Local fixture server for resolver/download tests. Serves deterministic
// media bytes, pages, redirects, and misbehaving endpoints on 127.0.0.1.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]), Buffer.from('IHDR'), Buffer.from([0, 0, 0x02, 0x00, 0, 0, 0x01, 0x80, 8, 6, 0, 0, 0]), Buffer.alloc(200, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(9), Buffer.from([0xff, 0xc0, 0, 0x11, 8, 0x01, 0x00, 0x00, 0x80, 3]), Buffer.alloc(500, 1)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(4096, 2)]);
const BIG = Buffer.alloc(300 * 1024, 9);   // declared octet-stream, not media; used for size/range tests

function start() {
  const log = [];
  const flaky = {};
  const srv = http.createServer((req, res) => {
    log.push({ method: req.method, url: req.url, range: req.headers.range, ua: req.headers['user-agent'] });
    const u = new URL(req.url, 'http://x');
    const send = (buf, type, extra = {}) => {
      const range = req.headers.range && /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (range && u.searchParams.get('noRange') !== '1') {
        const s = Number(range[1]), e = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
        res.writeHead(206, { 'content-type': type, 'content-length': e - s + 1, 'content-range': `bytes ${s}-${e}/${buf.length}`, 'accept-ranges': 'bytes', etag: '"v1"', ...extra });
        if (req.method === 'HEAD') return res.end();
        return res.end(buf.subarray(s, e + 1));
      }
      res.writeHead(200, { 'content-type': type, 'content-length': buf.length, 'accept-ranges': 'bytes', etag: '"v1"', ...extra });
      if (req.method === 'HEAD') return res.end();
      res.end(buf);
    };
    switch (u.pathname) {
      case '/a.png': return send(PNG, 'image/png');
      case '/b.jpg': return send(JPG, 'image/jpeg');
      case '/clip.mp4': return send(MP4, 'video/mp4');
      case '/mislabeled.jpg': return send(PNG, 'text/plain');            // bytes win
      case '/page-as.jpg': return send(Buffer.from('<!DOCTYPE html><html><head><title>Not a file</title><meta property="og:image" content="/a.png"></head><body></body></html>'), 'text/html');
      case '/stream.m3u8': return send(Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n'), 'application/vnd.apple.mpegurl');
      case '/big.bin': return send(BIG, 'application/octet-stream');
      case '/big.jpg': return send(Buffer.concat([JPG, BIG]), 'image/jpeg');
      case '/gallery': return send(Buffer.from(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'gallery-local.html'), 'utf8').split('__BASE__').join(`http://127.0.0.1:${srv.address().port}`)), 'text/html; charset=utf-8');
      case '/robots.txt': return send(Buffer.from('User-agent: *\nDisallow: /private/\n'), 'text/plain');
      case '/private/page': return send(Buffer.from('<html><body><img src="/a.png"></body></html>'), 'text/html');
      case '/redir': res.writeHead(302, { location: '/a.png' }); return res.end();
      case '/redir-private': res.writeHead(302, { location: 'http://169.254.169.254/latest' }); return res.end();
      case '/redir-loop': res.writeHead(302, { location: '/redir-loop' }); return res.end();
      case '/redir-file': res.writeHead(302, { location: 'file:///etc/passwd' }); return res.end();
      case '/forbidden': res.writeHead(403); return res.end('no');
      case '/missing': res.writeHead(404); return res.end('no');
      case '/ratelimited': res.writeHead(429, { 'retry-after': '1' }); return res.end('slow down');
      case '/flaky': { const n = Number(u.searchParams.get('n') || 0); const k = u.searchParams.get('k') || 'x'; flaky[k] = (flaky[k] || 0) + 1; if (flaky[k] <= n) { res.writeHead(503); return res.end(); } return send(PNG, 'image/png'); }
      case '/slow': return setTimeout(() => send(PNG, 'image/png'), Number(u.searchParams.get('ms') || 3000));
      case '/stall': res.writeHead(200, { 'content-type': 'image/png', 'content-length': 1000 }); res.write(PNG.subarray(0, 100)); return;   // never finishes
      case '/short': res.writeHead(200, { 'content-type': 'image/png', 'content-length': 5000 }); return res.write(PNG, () => res.socket.destroy());   // truncated transfer
      case '/nolen': res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG);
      case '/drip': {   // JPG header then 30 x 8 KB chunks, 40 ms apart; supports Range for resume tests
        const body = Buffer.concat([JPG, Buffer.alloc(30 * 8192, 5)]);
        const range = req.headers.range && /^bytes=(\d+)-$/.exec(req.headers.range);
        const from = range ? Number(range[1]) : 0;
        if (range) res.writeHead(206, { 'content-type': 'image/jpeg', 'content-length': body.length - from, 'content-range': `bytes ${from}-${body.length - 1}/${body.length}`, 'accept-ranges': 'bytes', etag: '"drip"' });
        else res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': body.length, 'accept-ranges': 'bytes', etag: '"drip"' });
        let o = from;
        const t = setInterval(() => { if (o >= body.length) { clearInterval(t); return res.end(); } const e = Math.min(o + 8192, body.length); res.write(body.subarray(o, e)); o = e; }, 40);
        res.on('close', () => clearInterval(t));
        return;
      }
      case '/changing': { const v = u.searchParams.get('v') || '1'; return send(PNG, 'image/png', { etag: `"v${v}"` }); }
      default: res.writeHead(404); return res.end();
    }
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${srv.address().port}`, log, flaky, close: () => new Promise((r) => srv.close(r)), fixtures: { PNG, JPG, MP4, BIG, DRIP: Buffer.concat([JPG, Buffer.alloc(30 * 8192, 5)]) },
  })));
}

module.exports = { start };
