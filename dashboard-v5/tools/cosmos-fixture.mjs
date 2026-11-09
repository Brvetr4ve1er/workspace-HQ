// Cosmos space — the invented library the gates run on (selftest states, the fake preload's cosmos.read, the cdp scenarios).
// Every name, folder, title, tag and colour is made up; the root is the placeholder 'C:/placeholder-library'. Nothing here
// was read from a disk, and the data is deterministic: a local xorshift, no Math.random, no clock, so two calls agree.
//
// fakeCosmos(opts) is ONE self-contained function: no imports, no module scope, no globals beyond Math/String/Number/Object.
// That is what lets tools/cosmos-fixture-paste.mjs paste Function.prototype.toString() of it into the sandboxed fake preload
// (which cannot require files; see the MONEY note in fake-preload.js). Keep it that way: cosmos-fixture.test.mjs scans the
// source for require, import, Math.random and the clock.
//
// It returns a full hq.cosmos.read answer, the shape dashboard/cosmos.js sends:
//   { state, config:{version,root,indexedAt}, works[], dupes:{exact,near,junk}, curation, cleanup, rootOk, indexing }
// Each work is a library.json work plus the two URLs main decorates it with (url, thumbUrl), both `data:` SVGs here so lazy
// images load with no file access. A work whose size is unknown is written 1x1, approx:true, thumb:null, thumbUrl:null and
// color:null (the honest fallback: it renders from its original `url`).
//
// Options (all optional):
//   count        works to make (default 1000); every rule below scales down with it and keeps every section non-empty
//   seed         another deterministic library
//   state:'empty'  never indexed: works [], config.root null           (rootNull:true does the root part alone)
//   rootOk:false   the folder is unreachable right now
//   indexing:{phase,done,total}  an index run in progress
//   indexedAt    another last-index stamp (a stale library)
//   error:'text' the whole answer is { error } (a failed read)
//   describe:true  returns the tables below instead (tags, colours with their families, the known answers)
export function fakeCosmos(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const ROOT = 'C:/placeholder-library';
  const AT = '2026-11-05T09:00:00.000Z';
  const TYPES = ['3d', 'ui', 'illustration', 'photo', 'logo', 'motion', 'type', 'misc'];
  // twenty invented tags; 'kiln' is the known tag (every 25th work carries it and no other work does)
  const TAGS = ['kiln', 'harbor', 'lantern', 'meadow', 'copper', 'velvet', 'orbit', 'quartz', 'ember', 'fjord', 'mosaic', 'tundra', 'saffron', 'prism', 'cobalt', 'willow', 'granite', 'nebula', 'pewter', 'thistle'];
  // sixteen hand-picked colours and the family each one falls in (the test checks them against the real taxonomy)
  const COLORS = [['#c0392b', 'RED'], ['#d9541e', 'ORANGE'], ['#e08a1e', 'ORANGE'], ['#e3b505', 'AMBER'], ['#8fbf2a', 'LIME'], ['#2e8b3d', 'GREEN'],
    ['#1a6b52', 'TEAL'], ['#17a398', 'TEAL'], ['#1f9bbf', 'CYAN'], ['#2f5fd0', 'BLUE'], ['#4b3fb5', 'INDIGO'], ['#7a3fb0', 'VIOLET'],
    ['#c2338f', 'MAGENTA'], ['#808080', 'MONO'], ['#1c1c1c', 'MONO'], ['#f2f2f2', 'MONO']];
  const TEAL = [6, 7];
  const NOT_TEAL = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15];
  const ADJ = ['Quiet', 'Copper', 'Hollow', 'Amber', 'Distant', 'Folded', 'Paper', 'Salt', 'Midnight', 'Slow', 'Bright', 'Winter'];
  const NOUN = ['harbor', 'lantern', 'study', 'garden', 'signal', 'tower', 'market', 'bridge', 'pane', 'orbit', 'field', 'relay'];
  const KNOWN = { count: 1000, tag: 'kiln', hex: '#1a6b52', family: 'TEAL', type: 'photo' };
  if (o.describe) {
    return { root: ROOT, indexedAt: AT, types: TYPES.slice(), tags: TAGS.slice(), colors: COLORS.map((c) => ({ hex: c[0], family: c[1] })), known: KNOWN };
  }
  if (typeof o.error === 'string' && o.error) return { error: o.error };

  const never = o.state === 'empty';
  const n = never ? 0 : (o.count == null ? 1000 : Math.max(0, Math.floor(Number(o.count)) || 0));
  const rootNull = never || o.rootNull === true;
  const indexedAt = rootNull ? null : (typeof o.indexedAt === 'string' ? o.indexedAt : AT);

  // ---- the generator ------------------------------------------------------------------------------------
  let s = (0x9e3779b9 ^ (Math.floor(Number(o.seed)) || 0)) >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const ri = (k) => Math.floor(rnd() * k);
  const hex16 = () => { const a = Math.floor(rnd() * 4294967296).toString(16).padStart(8, '0'); const b = Math.floor(rnd() * 4294967296).toString(16).padStart(8, '0'); return a + b; };
  const pad = (v, w) => String(v).padStart(w, '0');
    const enc = (t) => t.replace(/[%<>#]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  // a coloured rectangle as a data: SVG (the root's own background, so the file stays tiny); `label` is drawn when given.
  // vw x vh is the viewBox (the aspect ratio).
  const art = (hex, vw, vh, label) => 'data:image/svg+xml,' + enc("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + vw + ' ' + vh + "' style='background:" + hex + "'"
    + (label ? "><text y='4' font-size='3'>" + label + '</text></svg>' : '/>'));
  const box = (w, h) => { const m = Math.max(w, h); return [Math.max(4, Math.round((w / m) * 40)), Math.max(4, Math.round((h / m) * 40))]; };
  const colorOf = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
    let h = 0;
    if (d !== 0) {
      if (mx === R) h = ((G - B) / d) % 6; else if (mx === G) h = (B - R) / d + 2; else h = (R - G) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    const l = (mx + mn) / 2, sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return { hex, r, g, b, h: Math.round(h), s: Math.round(sat * 100) / 100, l: Math.round(l * 100) / 100 };
  };

  // roles: which work plays which part, spread across the library and never twice
  const used = new Set();
  const take = (k, shift, avoid) => {
    const out = [];
    for (let j = 0; j < k && used.size < n; j++) {
      let p = Math.floor((j + shift) * n / k) % n, guard = 0;
      while ((used.has(p) || (avoid && avoid(p))) && guard++ < n) p = (p + 1) % n;
      if (used.has(p)) break;
      used.add(p); out.push(p);
    }
    return out;
  };
  const per = (rate) => (n > 0 ? Math.max(1, Math.round(n * rate)) : 0);
  const isKiln = (p) => p % 25 === 3;
  const role = new Map();
  const mark = (list, r) => list.forEach((p, i) => role.set(p, Object.assign({ i }, r)));
  mark(take(per(0.004), 0.5), { k: 'approx' });
  mark(take(per(0.006), 0.3), { k: 'drop' });
  const junkAt = take(per(0.005), 0.7);
  mark(junkAt, { k: 'junk' });
  const specialTitle = take(3, 0.4);
  mark(specialTitle, { k: 'title' });
  const exactGroups = n > 0 ? per(0.003) : 0, nearGroups = n > 0 ? per(0.004) : 0;
  const exactAt = [], nearAt = [];
  for (let g = 0; g < exactGroups; g++) { const m = take(g === 0 ? 3 : 2, 0.15 + g * 0.31); if (m.length > 1) { exactAt.push(m); mark(m, { k: 'exact', g }); } }
  for (let g = 0; g < nearGroups; g++) { const m = take(2, 0.55 + g * 0.17); if (m.length > 1) { nearAt.push(m); mark(m, { k: 'near', g }); } }
  const overAt = take(per(0.004), 0.2, isKiln);
  const hiddenAt = take(per(0.015), 0.6);
  const favAt = take(per(0.025), 0.1);

  const works = [];
  let imp = 0;
  for (let i = 0; i < n; i++) {
    const rl = role.get(i) || null, kind = rl ? rl.k : '';
    const video = i % 20 === 9 && !rl;
    const num = pad(i + 1, 3);
    const folder = i % 3 === 1 ? 'beta-shots' : 'alpha-site';
    const noun = NOUN[ri(12)], adj = ADJ[ri(12)];
    const type = video ? 'motion' : TYPES[i % 8];
    let title = adj + ' ' + noun, id = folder + '-' + num, rel;
    const ext = video ? 'mp4' : ['png', 'jpg', 'webp', 'jpg'][i % 4];
    rel = folder + '/' + noun + '-' + num + '.' + ext;
    if (kind === 'drop') { imp += 1; id = 'imports-drop-' + imp; rel = 'imports:drop-' + imp + '.png'; title = 'Dropped file ' + imp; }
    if (kind === 'title') {
      if (rl.i === 0) title = 'Very long title for layout testing '.repeat(7).slice(0, 200);
      else if (rl.i === 1) title = 'Say "cheese" & \'smile\' \u{1F680}';
      else { title = 'rough draft #3 100%'; rel = folder + '/rough draft #3 100%.png'; }
    }
    // tags: 1-3 from the non-kiln words, plus 'kiln' on every 25th work
    const tags = [];
    if (isKiln(i)) tags.push('kiln');
    for (let k = 1 + (ri(3) === 0 ? 1 : 0); k > 0; k--) { const t = TAGS[1 + ri(19)]; if (!tags.includes(t)) tags.push(t); }

    // size
    let width, height, approx = false;
    if (kind === 'approx') { width = 1; height = 1; approx = true; rnd(); rnd(); }
    else if (video) { const v = i % 80 === 29; width = v ? 1080 : 1920; height = v ? 1920 : 1080; rnd(); rnd(); }
    else if (kind === 'junk' && rl.i % 5 < 3) { width = 40 + ri(20); height = 40 + ri(16); rnd(); }
    else { height = 600 + ri(1000); width = Math.round(height * (0.5 + rnd() * 1.5)); }
    const orientation = width > height * 1.05 ? 'landscape' : height > width * 1.05 ? 'portrait' : 'square';

    // colour
    let color = null, palette = [];
    if (!approx) {
      let ci;
      if (kind === 'junk' && rl.i % 5 >= 3) ci = 13;
      else if (i % 20 === 5) ci = TEAL[(i / 20 | 0) % 2];
      else ci = NOT_TEAL[ri(14)];
      color = colorOf(COLORS[ci][0]);
      palette = [COLORS[ci][0]];
      if (!(kind === 'junk' && rl.i % 5 >= 3)) for (let k = ri(3); k > 0; k--) { const h2 = COLORS[ri(16)][0]; if (!palette.includes(h2)) palette.push(h2); }
    }

    // when it was made: spread over 40 months (2023-07 .. 2026-10)
    const m = ri(40), yy = 2023 + Math.floor((6 + m) / 12), mm = (6 + m) % 12 + 1;
    const createdAt = yy + '-' + pad(mm, 2) + '-' + pad(1 + ri(28), 2) + 'T' + pad(ri(24), 2) + ':' + pad(ri(60), 2) + ':00.000Z';

    let contentHash = null;
    let perceptualHash = approx ? null : hex16();
    const w = { id, rel, title, type, width, height, orientation, color, palette, thumb: approx ? null : 'thumbs/' + id + '.jpg', video, contentHash, perceptualHash, tags, createdAt };
    if (approx) w.approx = true;
    const fill = color ? color.hex : '#888888';
    const bx = box(width, height);
    // a video's original is not a picture: the page's CSP only lets media load from 'self' and file:, so a data: URI there is a console error the
    // gates count. A video with a thumbnail has no url here (it shows its poster); the real library carries a file: URL, which main makes.
    w.url = video && !approx ? null : art(fill, approx ? 4 : bx[0], approx ? 3 : bx[1], '');
    w.thumbUrl = approx ? null : art(fill, bx[0], bx[1], id);
    works.push(w);
  }

  // duplicates: exact members share a content hash, near members a hash one nibble apart
  const mk = (ids, kinds, reason) => ({ key: ids.slice().sort().join(' '), ids, kinds, keeperId: ids[0], reason });
  const exact = exactAt.map((m) => {
    const base = works[m[0]];
    const hc = hex16(), hp = base.perceptualHash;
    for (const p of m) { works[p].contentHash = hc; works[p].perceptualHash = hp; }
    return mk(m.map((p) => works[p].id), m.map(() => 'exact'), 'Identical file contents');
  });
  const near = nearAt.map((m) => {
    const hp = works[m[0]].perceptualHash;
    works[m[1]].perceptualHash = hp.slice(0, 15) + ((parseInt(hp[15], 16) + 1) % 16).toString(16);
    return mk(m.map((p) => works[p].id), m.map(() => 'near'), 'Visually similar (perceptual hash within 10 bits)');
  });
  const junk = junkAt.map((p, i) => ({ id: works[p].id, reason: i % 5 < 3 ? 'tiny' : 'blank' }));

  // curation: the owner's side (favourites, hidden, four overrides, three clusters - one of them smart)
  const favorites = {}, hidden = {}, overrides = {};
  for (const p of favAt) favorites[works[p].id] = true;
  for (const p of hiddenAt) hidden[works[p].id] = true;
  const edits = [{ title: 'Renamed by the owner' }, { tags: ['ember', 'velvet'] }, { title: 'Second rename', tags: ['quartz'] }, { tags: [] }];
  overAt.forEach((p, i) => { overrides[works[p].id] = edits[i % 4]; });
  const ids = works.map((w) => w.id);
  const stride = (k, off) => { const out = []; for (let j = 0; j < k && j * 7 + off < n; j++) out.push(ids[j * 7 + off]); return out; };
  const clusters = n === 0 ? [] : [
    { id: 'cl-harbor', name: 'Harbor mornings', description: 'A hand-made cluster', elementIds: stride(Math.min(12, Math.ceil(n / 7)), 1), createdAt: '2026-03-02T10:00:00.000Z', updatedAt: '2026-03-02T10:00:00.000Z' },
    { id: 'cl-quiet', name: 'Quiet corners', elementIds: stride(Math.min(7, Math.ceil(n / 9)), 2), createdAt: '2026-04-11T18:30:00.000Z', updatedAt: '2026-05-01T09:00:00.000Z' },
    { id: 'cl-smart-kiln', name: 'Everything kiln', elementIds: [], rule: { tags: ['kiln'] }, createdAt: '2026-06-20T08:15:00.000Z', updatedAt: '2026-06-20T08:15:00.000Z' },
  ];
  const curation = { version: 1, clusters, favorites, hidden, overrides };
  const cleanup = n === 0 ? { version: 1, dismissed: { clusters: {}, candidates: {} } } : { version: 1, dismissed: {
    clusters: { [near.length > 1 ? near[near.length - 1].key : 'retired-group-1 retired-group-2']: '2026-10-20T08:00:00.000Z' },
    candidates: { [junk.length > 1 ? junk[junk.length - 1].id : 'retired-candidate-1']: '2026-10-20T08:00:00.000Z' },
  } };

  return {
    state: never ? 'empty' : 'ready',
    config: { version: 1, root: rootNull ? null : ROOT, indexedAt },
    works,
    dupes: { exact, near, junk },
    curation,
    cleanup,
    rootOk: o.rootOk !== false,
    indexing: o.indexing && typeof o.indexing === 'object' ? { phase: String(o.indexing.phase || 'walk'), done: Number(o.indexing.done) || 0, total: Number(o.indexing.total) || 0, startedAt: AT } : null,
  };
}

/**
 * The known answers at the default size (1,000 works), measured once and pinned by cosmos-fixture.test.mjs against the real search
 * grammar AND against plain filters, so the gates can assert numbers that do not come from the code under test:
 *   tag 'kiln'   on every 25th work and no other: 40 works (none of them hidden)
 *   '#1a6b52'    one of two teal colours: 24 works carry exactly it, 48 are in the TEAL family ('teal')
 *   'photo'      125 works of that type
 * The Feed hides the 15 hidden works, so what the owner sees by default is 985 of 1,000. The cdp scenarios compute the counts they
 * expect from the library they are served (cdp-cosmos.mjs visibleWorks), which also covers the four overrides.
 */
export const COSMOS_KNOWN = Object.freeze({ count: 1000, visible: 985, tag: 'kiln', tagCount: 40, hex: '#1a6b52', hexCount: 24, family: 'TEAL', familyCount: 48, type: 'photo', typeCount: 125 });
