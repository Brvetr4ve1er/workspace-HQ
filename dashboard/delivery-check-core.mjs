// Client delivery check — the pure engine (spec: batch-2-rest plan, dish "delivery-check"; CONTRACT "Client delivery check").
// "Is the phone layout and the Arabic / French / English pages sane?", answered against a dev server on THIS PC only.
// No IO, no Electron, no network: main (delivery-check.js) probes ports and drives a hidden window, the in-page probe
// (delivery-check-probe.js) measures the DOM, and everything it reports passes through here first.
//
//   loopbackOrigin(url)            http://127.0.0.1|localhost|[::1][:port] with no credentials / path / query → 'http://127.0.0.1:5173', else null
//   candidateUrls({devCmd})        up to 6 origins to probe, the first being adapter.devPort(cmd) when the command names a port
//   blockDecision(url)             the per-request verdict of the network defence: { allow, host }
//   sanitizeSnapshot(raw)          untrusted probe output → a fresh, clamped snapshot (never copies a key it does not know)
//   discoverLocales(snap)          same-origin language routes from the entry page: [{ locale, path }] (≤ 6), or []
//   checkRoute(snap, {locale})     the per-page findings; compareLocales(routes) the cross-locale heuristic
//   buildReport({...})             the report v:1 the card shows and data/delivery/checks/<id>.json keeps
//
// Wording rules: the two bidi / untranslated checks are HEURISTICS and say so; the tap-size line is a "comfort guide" with the
// 24 px WCAG floor reported separately; outside traffic is "blocked and counted" — never "nothing left your PC".

export const LIMITS = Object.freeze({
  RUN_MS: 45000, PROBE_MS: 2000, MAX_ROUTES: 6, MAX_REQUESTS: 200, MAX_SHOTS: 12, MAX_CANDIDATES: 6, MAX_HOSTS: 8,
  MAX_OFFENDERS: 5, MAX_SAMPLES: 5, SAMPLE_LEN: 40, MAX_STR: 80, MAX_ARR: 60, MAX_LINKS: 40, MAX_URL_INPUT: 200,
  MIN_TEXT_PX: 12, TAP_COMFORT: 44, TAP_FLOOR: 24, MIN_STRING_LEN: 4, MIN_IDENTICAL: 2,
  PHONE: Object.freeze({ width: 390, height: 844, scale: 3 }),
});

export const REPORT_VERSION = 1;
export const RTL = Object.freeze(['ar', 'he', 'fa', 'ur']);
export const PATH_LOCALES = Object.freeze(['ar', 'fr', 'en']);
export const OFF_ORIGIN_TEXT = 'Only a dev server on this PC can be checked';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

// ---- the address gate -----------------------------------------------------------------------------------------------
// Only a dev server on this PC. The returned origin has 'localhost' rewritten to 127.0.0.1 (one address to probe, one to pin).
export function loopbackOrigin(url) {
  if (typeof url !== 'string') return null;
  const s = url.trim();
  if (!s || s.length > LIMITS.MAX_URL_INPUT) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (!LOOPBACK_HOSTS.has(u.hostname)) return null;
  if (u.pathname !== '/' || u.search || u.hash) return null;
  const host = u.hostname === 'localhost' ? '127.0.0.1' : u.hostname;
  return 'http://' + host + (u.port ? ':' + u.port : '');
}

// ---- where is the dev server? ---------------------------------------------------------------------------------------------
// Parity with dashboard-v5/src/live/adapter.mjs devPort (the card's own guess): the last 4–5 digit number in the command.
// Kept as a copy because the renderer tree is not imported from main; a test pins the two together.
export function devPort(cmd) {
  const m = String(cmd || '').match(/(?:^|[^\d])(\d{4,5})(?!.*\d{4,5})/);
  return m ? +m[1] : null;
}
const FRAMEWORKS = [
  [/\bvite\b/i, 5173], [/\b(?:next|nuxt|nuxi|react-scripts)\b/i, 3000], [/\bastro\b/i, 4321],
  [/\bwebpack(?:-dev-server|\s+serve)\b/i, 8080], [/\bng\s+serve\b/i, 4200], [/\bgatsby\b/i, 8000],
];
const DEFAULT_PORTS = [5173, 3000, 4321, 8080, 4200, 8000];
const validPort = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;

export function candidateUrls({ devCmd } = {}) {
  const cmd = typeof devCmd === 'string' ? devCmd.slice(0, 1000) : '';
  const ports = [];
  const add = (n) => { n = +n; if (validPort(n) && !ports.includes(n)) ports.push(n); };
  if (cmd) {
    const dp = devPort(cmd);
    if (dp != null) add(dp);
    for (const m of cmd.matchAll(/(?:--port(?:=|\s+)|(?:^|\s)-p(?:=|\s+)|\bPORT=)(\d{2,5})\b/g)) add(m[1]);
    for (const m of cmd.matchAll(/:(\d{2,5})\b/g)) add(m[1]);
    for (const [re, port] of FRAMEWORKS) if (re.test(cmd)) add(port);
  }
  // nothing in the command names a port or a framework (or there is no command): the usual local ports, in their usual order
  if (!ports.length) for (const p of DEFAULT_PORTS) add(p);
  return ports.slice(0, LIMITS.MAX_CANDIDATES).map((p) => 'http://127.0.0.1:' + p);
}

// ---- the network defence verdict (one request) ------------------------------------------------------------------------------
// Allowed: http / ws to a loopback host (any port: a dev app may call its own API). data: blob: about: carry no network, so
// they pass uncounted. Everything else is cancelled and counted by host (hosts only: never a path, never a query).
export function blockDecision(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { return { allow: false, host: '(unreadable address)' }; }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return { allow: true, host: '' };
  const host = u.hostname || '(no host)';
  if ((u.protocol === 'http:' || u.protocol === 'ws:') && LOOPBACK_HOSTS.has(u.hostname)) return { allow: true, host };
  return { allow: false, host: host.slice(0, LIMITS.MAX_STR) };
}
// hosts: Map host → count → [{ host, count }] busiest first, at most MAX_HOSTS
export function topHosts(map) {
  return [...(map instanceof Map ? map : new Map())].map(([host, count]) => ({ host: String(host).slice(0, LIMITS.MAX_STR), count: Math.max(0, count | 0) }))
    .sort((a, b) => b.count - a.count || (a.host < b.host ? -1 : 1)).slice(0, LIMITS.MAX_HOSTS);
}
export function blockedLine(blocked) {
  const n = blocked && Number.isFinite(blocked.count) ? blocked.count : 0;
  if (!n) return '0 outside requests seen by the app (a black-hole proxy covers anything the app cannot see)';
  const hosts = (blocked.hosts || []).map((h) => h.host).filter(Boolean);
  return n + ' outside request' + (n === 1 ? '' : 's') + ' blocked' + (hosts.length ? ' (' + hosts.join(', ') + ')' : '');
}

// ---- untrusted snapshot → clean snapshot ---------------------------------------------------------------------------------------
const num = (x, max = 1e6) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(max, Math.round(x * 100) / 100)) : 0);
const str = (x, n = LIMITS.MAX_STR) => (typeof x === 'string' ? x.slice(0, n) : '');
const list = (x, n = LIMITS.MAX_ARR) => (Array.isArray(x) ? x.slice(0, n) : []);
const bool = (x) => x === true;
const own = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
const cls = (x) => str(x, 60).replace(/[^A-Za-z0-9_\- ]/g, '').trim();
const tag = (x) => str(x, 20).toLowerCase().replace(/[^a-z0-9\-]/g, '');
const pathOnly = (x) => { const s = str(x); return s.startsWith('/') && !s.startsWith('//') ? s : ''; };

// Builds a NEW object from known keys only: an own "__proto__" key, a 10 MB string, NaN or a nested bomb in the input
// can never reach a check. Returns null when the input is not an object at all.
export function sanitizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const vp = own(raw.viewport), meta = own(raw.meta), html = own(raw.html), taps = own(raw.taps), small = own(raw.smallText), bidi = own(raw.bidi), links = own(raw.links);
  return {
    title: str(raw.title),
    innerWidth: num(vp.innerWidth, 20000), scrollWidth: num(vp.scrollWidth, 100000),
    hasViewportMeta: bool(meta.hasViewport), viewportContent: str(meta.content),
    lang: str(html.lang, 20), dir: str(html.dir, 8),
    overflowers: list(raw.overflow, LIMITS.MAX_OFFENDERS).map((o) => ({ tag: tag(own(o).tag), cls: cls(own(o).cls) })),
    smallTextCount: num(small.count), textElements: num(small.total),
    tapTotal: num(taps.total), tapUnderComfort: num(taps.under44), tapUnderFloor: num(taps.under24),
    tapSamples: list(taps.samples, LIMITS.MAX_SAMPLES).map((o) => ({ tag: tag(own(o).tag), cls: cls(own(o).cls), w: num(own(o).w, 5000), h: num(own(o).h, 5000) })),
    bidi: { rtlRuns: num(bidi.rtlRuns), unisolated: num(bidi.unisolated), samples: list(bidi.samples, LIMITS.MAX_SAMPLES).map((s) => str(s, LIMITS.SAMPLE_LEN)) },
    strings: list(raw.strings).map((s) => str(s)).filter(Boolean),
    links: {
      alternates: list(links.alternates, LIMITS.MAX_LINKS).map((a) => ({ hreflang: str(own(a).hreflang, 12), path: pathOnly(own(a).path) })),
      anchors: list(links.anchors, LIMITS.MAX_LINKS).map((a) => ({ hreflang: str(own(a).hreflang, 12), path: pathOnly(own(a).path) })),
      options: list(links.options, LIMITS.MAX_LINKS).map((o) => ({ value: str(own(o).value), text: str(own(o).text, 30) })),
    },
  };
}

// ---- language routes ------------------------------------------------------------------------------------------------------
const primary = (tagText) => String(tagText || '').toLowerCase().split(/[-_]/)[0];
const isRtl = (locale) => RTL.includes(primary(locale));

// The first path segment ('/ar', '/ar/about') or a ?lang=xx query names a locale; null when neither does.
export function localeOfPath(p) {
  const m = String(p || '').match(/^\/([a-z]{2})(?:[/?#]|$)/i);
  if (m && PATH_LOCALES.includes(m[1].toLowerCase())) return m[1].toLowerCase();
  const q = String(p || '').match(/[?&]lang=([a-z]{2})\b/i);
  if (q && PATH_LOCALES.includes(q[1].toLowerCase())) return q[1].toLowerCase();
  return null;
}

// Where the other languages live, read from the entry page and only from it. Same origin only (the probe already dropped the
// rest); at most one route per locale (the shortest path wins), MAX_ROUTES in all. Nothing found → { routes: [], switch: 'none' }:
// no routes are guessed. A language select whose values are not addresses is reported as 'unreadable', not guessed at.
export function discoverLocales(snap) {
  const found = new Map();
  const take = (locale, path) => {
    if (!locale || !path || path === '/' || found.size >= LIMITS.MAX_ROUTES && !found.has(locale)) return;
    const cur = found.get(locale);
    if (!cur || path.length < cur.length) found.set(locale, path);
  };
  const links = snap && snap.links ? snap.links : { alternates: [], anchors: [], options: [] };
  for (const a of links.alternates) { const l = primary(a.hreflang); if (/^[a-z]{2}$/.test(l)) take(l, a.path); }
  for (const a of links.anchors) { const l = primary(a.hreflang); if (/^[a-z]{2}$/.test(l)) take(l, a.path); }
  for (const a of [...links.alternates, ...links.anchors]) take(localeOfPath(a.path), a.path);
  let optionsSeen = false;
  for (const o of links.options) {
    const v = o.value; optionsSeen = true;
    if (v.startsWith('/') && !v.startsWith('//')) take(localeOfPath(v), v);
  }
  const routes = [...found].map(([locale, path]) => ({ locale, path })).slice(0, LIMITS.MAX_ROUTES);
  return { routes, switch: routes.length ? 'found' : optionsSeen ? 'unreadable' : 'none' };
}

// ---- the per-page checks -----------------------------------------------------------------------------------------------------
const finding = (id, level, route, text, extra) => Object.assign({ id, level, route, text }, extra || {});
const offenderName = (o) => o.tag + (o.cls ? '.' + o.cls.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '');

// snap: a sanitized snapshot; opts.locale: the language this route is supposed to be (null on the entry page);
// opts.route: the path, for the report. Levels: 'problem' (a thing to fix), 'heads-up' (a guide), 'heuristic' (may be wrong).
export function checkRoute(snap, { locale = null, route = '/' } = {}) {
  const out = [];
  if (!snap) return [finding('no-snapshot', 'problem', route, 'The page could not be measured')];
  const w = LIMITS.PHONE.width;
  // Against the phone's own width, never window.innerWidth: a mobile browser widens the layout viewport to fit overflowing content, so a 1200 px
  // table reads innerWidth 1200 and scrollWidth 1200 (found by the native check). Without a viewport meta the phone lays the page out at 980 px by
  // design and says so below, so that case is the viewport finding, not a second "overflow" for the same cause.
  if (snap.hasViewportMeta && snap.scrollWidth > w + 1) {
    const names = snap.overflowers.map(offenderName).filter(Boolean);
    out.push(finding('overflow', 'problem', route, 'Sideways scroll at ' + w + ' px: the page is ' + Math.round(snap.scrollWidth) + ' px wide' + (names.length ? ' · widest: ' + names.join(', ') : ''), { offenders: names }));
  }
  if (!snap.hasViewportMeta) out.push(finding('viewport', 'problem', route, 'No viewport meta tag, so a phone shows the page zoomed out'));
  else if (!/width\s*=\s*device-width/i.test(snap.viewportContent)) out.push(finding('viewport', 'problem', route, 'The viewport meta tag does not say width=device-width'));
  if (snap.smallTextCount > 0) out.push(finding('small-text', 'heads-up', route, snap.smallTextCount + ' piece' + (snap.smallTextCount === 1 ? '' : 's') + ' of visible text under ' + LIMITS.MIN_TEXT_PX + ' px'));
  if (snap.tapUnderFloor > 0) out.push(finding('tap-floor', 'problem', route, snap.tapUnderFloor + ' of ' + snap.tapTotal + ' tap targets are under the ' + LIMITS.TAP_FLOOR + ' px WCAG floor', { samples: snap.tapSamples.map((t) => offenderName(t) + ' ' + t.w + 'x' + t.h) }));
  if (snap.tapUnderComfort > 0) out.push(finding('tap-comfort', 'heads-up', route, snap.tapUnderComfort + ' of ' + snap.tapTotal + ' tap targets are under ' + LIMITS.TAP_COMFORT + 'x' + LIMITS.TAP_COMFORT + ' px (a comfort guide, not a rule)', { samples: snap.tapSamples.map((t) => offenderName(t) + ' ' + t.w + 'x' + t.h) }));
  const lang = primary(snap.lang), dir = snap.dir.toLowerCase();
  if (!snap.lang) out.push(finding('lang', 'problem', route, 'The <html> tag has no lang attribute'));
  else if (locale && lang !== locale) out.push(finding('lang', 'problem', route, '<html lang="' + snap.lang + '"> but this route is ' + locale));
  const rtl = locale ? isRtl(locale) : snap.lang ? isRtl(snap.lang) : false;
  if (locale || snap.lang) {
    if (rtl && dir !== 'rtl') out.push(finding('dir', 'problem', route, 'Arabic-style page without dir="rtl" on <html>' + (dir ? ' (dir="' + snap.dir + '")' : ' (dir missing)')));
    if (!rtl && locale && dir === 'rtl') out.push(finding('dir', 'problem', route, 'dir="rtl" on a ' + locale + ' page'));
  }
  if (rtl && snap.bidi.unisolated > 0) {
    out.push(finding('bidi', 'heuristic', route, 'Heuristic: ' + snap.bidi.unisolated + ' number or Latin run' + (snap.bidi.unisolated === 1 ? '' : 's') + ' inside right-to-left text with no <bdi>, dir or unicode-bidi isolate; they may display in the wrong order', { samples: snap.bidi.samples.slice(0, LIMITS.MAX_SAMPLES) }));
  }
  return out;
}

// Strings present on two different locale routes, word for word. Brand names and "OK" repeat legitimately, so this is a
// heuristic: at least MIN_IDENTICAL strings of MIN_STRING_LEN+ characters containing a letter, five samples of 40 characters.
// routes: [{ locale, path, strings }]; the entry page counts as a route when its <html lang> is known.
export function compareLocales(routes) {
  const out = [];
  const rs = list(routes, 20).filter((r) => r && r.locale);
  const norm = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
  const usable = (s) => s.length >= LIMITS.MIN_STRING_LEN && /\p{L}/u.test(s);
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      if (primary(rs[i].locale) === primary(rs[j].locale)) continue;
      const a = new Map(); for (const s of rs[i].strings || []) { const n = norm(s); if (usable(n) && !a.has(n)) a.set(n, s); }
      const same = []; const seen = new Set();
      for (const s of rs[j].strings || []) { const n = norm(s); if (a.has(n) && !seen.has(n)) { seen.add(n); same.push(a.get(n)); } }
      if (same.length >= LIMITS.MIN_IDENTICAL) {
        out.push(finding('identical', 'heuristic', rs[j].path || '/', 'Heuristic: ' + same.length + ' string' + (same.length === 1 ? '' : 's') + ' on ' + (rs[j].path || '/') + ' are word for word the same as on ' + (rs[i].path || '/') + ' (possibly untranslated)',
          { samples: same.slice(0, LIMITS.MAX_SAMPLES).map((s) => String(s).slice(0, LIMITS.SAMPLE_LEN)), count: same.length }));
      }
    }
  }
  return out;
}

// ---- the report ----------------------------------------------------------------------------------------------------------------
// routes: [{ path, locale, snap, loadError?, shot? }] in check order (the entry page first);
// extra: { origin, at (Date | ms | iso), switch, blocked: { count, hosts }, requestsSeen, truncated: { routes, requests, time }, notes[] }
// Names-only: findings, counts, route paths, and the capped samples above. No page text beyond those samples.
export function buildReport({ origin, at, routes, switch: sw = 'none', blocked = { count: 0, hosts: [] }, requestsSeen = 0, truncated = {}, notes = [] } = {}) {
  const rs = list(routes, LIMITS.MAX_ROUTES + 1);
  const findings = [];
  const outRoutes = rs.map((r) => {
    if (r.loadError) { findings.push(finding('route-failed', 'problem', r.path, 'The page did not load: ' + str(r.loadError, 100))); return { path: r.path, locale: r.locale || null, title: '', loaded: false, shot: r.shot || null }; }
    const f = checkRoute(r.snap, { locale: r.isEntry ? null : r.locale || null, route: r.path });
    findings.push(...f);
    return { path: r.path, locale: r.locale || primary(r.snap && r.snap.lang) || null, title: r.snap ? r.snap.title : '', loaded: true, width: r.snap ? r.snap.scrollWidth : 0, shot: r.shot || null };
  });
  findings.push(...compareLocales(rs.filter((r) => r.snap).map((r) => ({ locale: r.locale || primary(r.snap.lang), path: r.path, strings: r.snap.strings }))));
  const counts = { problem: 0, headsUp: 0, heuristic: 0 };
  for (const f of findings) counts[f.level === 'problem' ? 'problem' : f.level === 'heads-up' ? 'headsUp' : 'heuristic']++;
  const allNotes = notes.map((n) => str(n, 160));
  if (sw === 'none') allNotes.push('No language switch found, so nothing was checked per language');
  else if (sw === 'unreadable') allNotes.push('A language select was found but its values are not addresses, so those languages were not checked');
  if (truncated.routes) allNotes.push('More than ' + LIMITS.MAX_ROUTES + ' language routes were found; only the first ' + LIMITS.MAX_ROUTES + ' were checked');
  if (truncated.requests) allNotes.push('The page made more than ' + LIMITS.MAX_REQUESTS + ' requests; the rest were cut off');
  if (truncated.time) allNotes.push('The check stopped at its ' + Math.round(LIMITS.RUN_MS / 1000) + ' s limit; later pages were not checked');
  const atIso = at instanceof Date ? at.toISOString() : Number.isFinite(at) ? new Date(at).toISOString() : typeof at === 'string' ? at : new Date(0).toISOString();
  return {
    v: REPORT_VERSION, at: atIso, origin: str(origin, 60), phone: { width: LIMITS.PHONE.width, height: LIMITS.PHONE.height, scale: LIMITS.PHONE.scale },
    routes: outRoutes, findings, counts, languageSwitch: sw,
    blocked: { count: num(blocked.count), hosts: topHosts(new Map(list(blocked.hosts, LIMITS.MAX_HOSTS).map((h) => [own(h).host, own(h).count]))) },
    requestsSeen: num(requestsSeen, 100000), truncated: { routes: !!truncated.routes, requests: !!truncated.requests, time: !!truncated.time },
    summary: summaryLine(counts, outRoutes.length), blockedLine: blockedLine({ count: num(blocked.count), hosts: topHosts(new Map(list(blocked.hosts, LIMITS.MAX_HOSTS).map((h) => [own(h).host, own(h).count]))) }),
    notes: allNotes,
  };
}
export function summaryLine(counts, pages) {
  const c = counts || { problem: 0, headsUp: 0, heuristic: 0 };
  const parts = [];
  if (c.problem) parts.push(c.problem + ' to fix');
  if (c.headsUp) parts.push(c.headsUp + ' to look at');
  if (c.heuristic) parts.push(c.heuristic + ' heuristic' + (c.heuristic === 1 ? '' : 's') + ' (may be wrong)');
  return (parts.length ? parts.join(' · ') : 'Nothing found') + ' · ' + pages + ' page' + (pages === 1 ? '' : 's') + ' at ' + LIMITS.PHONE.width + ' px';
}

// A stored report is data from disk: accept only the shape this module writes (v:1, arrays and strings in range) or null.
export function validateReport(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r) || r.v !== REPORT_VERSION) return null;
  if (typeof r.at !== 'string' || !Array.isArray(r.routes) || !Array.isArray(r.findings) || !r.counts || typeof r.origin !== 'string') return null;
  if (r.findings.length > 500 || r.routes.length > 20) return null;
  return r;
}
