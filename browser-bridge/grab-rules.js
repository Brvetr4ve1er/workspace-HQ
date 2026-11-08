// WorkspaceHQ Bridge 0.7.0 — "Find the best version": the pure half. Classic script (importScripts / <script>); no DOM,
// no chrome.*, no network. It never requests anything: every upgrade here is a GUESS built from the URL's own shape and
// is labelled as one by the popup. The page's own srcset variants are the only candidates that are known to exist.
// Download on click (grab.js) uses the pure helpers at the end: saveCheck, saveCandidates, grabPath, stateText.
//
//   HQGrabRules.upgradeCandidates(url) → string[]   guessed bigger versions on the SAME host (http/https only), the
//                                                    original always last, no duplicates
//   HQGrabRules.candidatesFor(entry)   → [{ url, guess }]   best first: guesses, then the page's own variants by size,
//                                                    the original last
//   HQGrabRules.rankEntries(items, clickedUrl) → entries, the clicked one on top, then biggest first
//   HQGrabRules.describe(entry)        → { typeWord, size, host, name, bigger, label, streamed }  text for one row
//   HQGrabRules.isRestricted(tabUrl)   → boolean   pages Chrome will not let an extension script
//   HQGrabRules.normalizeUrl(url)      → string|null   absolute http(s) URL without a hash
//   HQGrabRules.saveCheck(entry, pageUrl) → { ok:true } | { ok:false, message }   may this one be saved? (plain files only; never Instagram, Facebook, TikTok)
//   HQGrabRules.saveCandidates(entry)  → [{url, guess}]   candidatesFor() limited to what saveCheck allows, at most 6, the original last
//   HQGrabRules.grabPath(host, url, kind) → 'WorkspaceHQ/grabs/<host>/<safe name>'   relative to the Downloads folder
//   HQGrabRules.stateText(job)         → the honest words for a queued / saving / saved / failed grab
(function (root) {
  'use strict';
  var GENERIC_PARAMS = ['w', 'h', 'width', 'height', 'resize'];
  var MIN_PX = 200;

  function parse(u) {
    try { var x = new URL(String(u)); return (x.protocol === 'http:' || x.protocol === 'https:') ? x : null; } catch (e) { return null; }
  }
  function normalizeUrl(u) { var x = parse(u); if (!x) return null; x.hash = ''; return x.href; }

  // ---- the upgrade rules: each takes a parsed URL and returns href strings (possibly none) -----------------------
  function ruleX(u) {
    if (!/(^|\.)twimg\.com$/i.test(u.hostname)) return [];
    var out = [];
    if (u.searchParams.has('name') && u.searchParams.get('name') !== 'orig') {
      var a = new URL(u.href); a.searchParams.set('name', 'orig'); out.push(a.href);
    }
    var m = u.pathname.match(/^(.*\.(?:jpe?g|png|webp|gif)):(?:thumb|small|medium|large)$/i);
    if (m) { var b = new URL(u.href); b.pathname = m[1] + ':orig'; out.push(b.href); }
    return out;
  }
  function ruleCloudinary(u) {
    var m = u.pathname.match(/^(.*\/(?:image|video)\/upload\/)((?:[a-z]{1,3}_[^\/,]+(?:,[a-z]{1,3}_[^\/,]+)*\/)+)(.+)$/);
    if (!m) return [];
    var a = new URL(u.href); a.pathname = m[1] + m[3]; return [a.href];
  }
  function ruleWordPress(u) {
    var p = u.pathname, out = [];
    var sized = p.replace(/-\d{2,5}x\d{2,5}(\.[A-Za-z0-9]{2,5})$/, '$1');
    var wp = /\/wp-content\//.test(p);
    var unscaled = wp ? sized.replace(/-scaled(\.[A-Za-z0-9]{2,5})$/, '$1') : sized;
    [sized, unscaled].forEach(function (np) {
      if (np !== p && out.length < 2) { var a = new URL(u.href); a.pathname = np; if (out.indexOf(a.href) < 0) out.push(a.href); }
    });
    return out;
  }
  function ruleSuffix(u) {
    var np = u.pathname.replace(/_\d{2,5}x\d{2,5}(\.[A-Za-z0-9]{2,5})$/, '$1');
    if (np === u.pathname) return [];
    var a = new URL(u.href); a.pathname = np; return [a.href];
  }
  function ruleSegments(u) {
    var out = [];
    if (!/\/(?:thumbs?|small)\//i.test(u.pathname)) return out;
    ['large', 'original'].forEach(function (word) {
      var a = new URL(u.href); a.pathname = u.pathname.replace(/\/(?:thumbs?|small)\//i, '/' + word + '/'); out.push(a.href);
    });
    return out;
  }
  function ruleGeneric(u) {
    var a = new URL(u.href), hit = false;
    GENERIC_PARAMS.forEach(function (k) { if (a.searchParams.has(k)) { a.searchParams.delete(k); hit = true; } });
    return hit ? [a.href] : [];
  }
  var RULES = [ruleX, ruleCloudinary, ruleWordPress, ruleSuffix, ruleSegments, ruleGeneric];

  function upgradeCandidates(url) {
    var u = parse(url);
    if (!u) return [];
    u.hash = '';
    var original = u.href, out = [];
    RULES.forEach(function (rule) {
      var got = [];
      try { got = rule(new URL(original)); } catch (e) { got = []; }
      got.forEach(function (g) {
        var x = parse(g);
        if (!x || x.hostname.toLowerCase() !== u.hostname.toLowerCase()) return;   // same site only
        x.hash = '';
        if (x.href !== original && out.indexOf(x.href) < 0) out.push(x.href);
      });
    });
    out.push(original);   // the original is always listed last
    return out;
  }

  // ---- entries: { url, kind, w, h, shownW, shownH, label, variants:[{url,w?,x?}], streamed? } ----------------------
  function variantScore(v) { return v.w ? v.w : (v.x ? v.x * 1000 : 0); }
  function bestVariant(entry) {
    var best = null;
    (entry.variants || []).forEach(function (v) { if (parse(v.url) && (!best || variantScore(v) > variantScore(best))) best = v; });
    return best;
  }
  function candidatesFor(entry) {
    if (!entry || !parse(entry.url)) return [];
    var original = normalizeUrl(entry.url), out = [], seen = {};
    function add(u, guess) { var n = normalizeUrl(u); if (n && !seen[n] && n !== original) { seen[n] = true; out.push({ url: n, guess: guess }); } }
    var top = bestVariant(entry);
    var topUrl = top ? normalizeUrl(top.url) : null;
    if (topUrl && topUrl !== original) upgradeCandidates(topUrl).slice(0, -1).forEach(function (g) { add(g, true); });
    upgradeCandidates(original).slice(0, -1).forEach(function (g) { add(g, true); });
    (entry.variants || []).slice().sort(function (a, b) { return variantScore(b) - variantScore(a); }).forEach(function (v) { add(v.url, false); });
    out.push({ url: original, guess: false });
    return out;
  }

  function areaOf(e) {
    if (e.w > 0 && e.h > 0) return e.w * e.h;
    var b = bestVariant(e);
    return b && b.w ? b.w * b.w * 0.75 : 0;
  }
  function rankEntries(items, clickedUrl) {
    var click = clickedUrl ? normalizeUrl(clickedUrl) : null;
    function isClicked(e) {
      if (!click) return false;
      if (normalizeUrl(e.url) === click) return true;
      return (e.variants || []).some(function (v) { return normalizeUrl(v.url) === click; });
    }
    var list = (items || []).map(function (e, i) { return { e: e, i: i, c: isClicked(e), a: areaOf(e) }; });
    list.sort(function (a, b) { return (b.c - a.c) || (b.a - a.a) || (a.i - b.i); });
    return list.map(function (x) { return x.e; });
  }

  function fileName(u) {
    var x = parse(u); if (!x) return '';
    var seg = x.pathname.split('/').filter(Boolean).pop() || '';
    try { seg = decodeURIComponent(seg); } catch (e) { /* keep as is */ }
    return seg.slice(0, 80);
  }
  function describe(entry) {
    var x = parse(entry.url);
    if (entry.streamed || !x) return { typeWord: 'video', size: '', host: '', name: '', bigger: '', label: entry.label || '', streamed: true };
    var ext = (fileName(entry.url).match(/\.([A-Za-z0-9]{2,5})$/) || [])[1];
    var best = bestVariant(entry);
    var bw = Math.max(entry.w || 0, best && best.w ? best.w : 0);
    var bigger = '';
    if (entry.shownW > 0 && bw > entry.shownW * 1.25) {
      var f = Math.round(bw / entry.shownW * 10) / 10;
      bigger = '×' + f + ' bigger than shown';
    }
    return {
      typeWord: ext ? ext.toLowerCase() : (entry.kind === 'video' ? 'video' : 'image'),
      size: entry.w > 0 && entry.h > 0 ? entry.w + '×' + entry.h : (best && best.w ? best.w + ' px wide' : 'size unknown'),
      host: x.hostname, name: fileName(entry.url), bigger: bigger, label: entry.label || '', streamed: false,
    };
  }

  function isRestricted(tabUrl) {
    var s = String(tabUrl || '');
    if (!s) return true;
    if (!/^https?:/i.test(s) && !/^file:/i.test(s)) return true;   // chrome://, chrome-extension://, about:, view-source:, edge://, data:
    var u = parse(s);
    if (u && (u.hostname === 'chromewebstore.google.com' || (u.hostname === 'chrome.google.com' && /^\/webstore/.test(u.pathname)))) return true;
    return false;
  }

  // ---- download on click: what may be saved, where, and what to say about it ---------------------------------------
  var VIDEO_EXT = ['mp4', 'webm', 'mov'];
  var SAVE_ROOT = 'WorkspaceHQ/grabs';
  var MAX_TRIES = 6;   // the first five candidates and the original
  // Instagram, Facebook and TikTok: nothing is saved from them, not even one at a click (the owner's limit, 2026-11-08)
  var BLOCKED_SITES = ['instagram.com', 'cdninstagram.com', 'facebook.com', 'fbcdn.net', 'fbsbx.com', 'tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokv.com', 'muscdn.com'];
  var BLOCKED_MESSAGE = 'saving is off on Instagram, Facebook and TikTok';
  var RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  function hostOf(u) { var x = parse(u); return x ? x.hostname.toLowerCase() : ''; }
  function isBlockedHost(h) {
    h = String(h || '').toLowerCase().replace(/\.$/, '');
    return BLOCKED_SITES.some(function (b) { return h === b || h.slice(-(b.length + 1)) === '.' + b; });
  }
  function extOf(u) {
    var x = parse(u); if (!x) return '';
    var seg = x.pathname.split('/').filter(Boolean).pop() || '';
    var m = seg.match(/\.([A-Za-z0-9]{2,5})$/);
    return m ? m[1].toLowerCase() : '';
  }
  function isPlainVideoUrl(u) { return VIDEO_EXT.indexOf(extOf(u)) >= 0; }

  function saveCheck(entry, pageUrl) {
    if (!entry || typeof entry.url !== 'string') return { ok: false, message: "Can't save this one" };
    if (/^blob:/i.test(entry.url) || entry.streamed) return { ok: false, message: api.STREAMED_MESSAGE };
    var x = parse(entry.url);
    if (!x) return { ok: false, message: "Can't save this one" };
    if (isBlockedHost(x.hostname) || (pageUrl && isBlockedHost(hostOf(pageUrl)))) return { ok: false, message: BLOCKED_MESSAGE };
    if (entry.kind === 'video' && !isPlainVideoUrl(entry.url)) return { ok: false, message: api.STREAMED_MESSAGE };
    return { ok: true };
  }
  function saveCandidates(entry) {
    var ok = candidatesFor(entry).filter(function (c) {
      if (isBlockedHost(hostOf(c.url))) return false;
      return !(entry.kind === 'video' && !isPlainVideoUrl(c.url));
    });
    if (ok.length > MAX_TRIES) ok = ok.slice(0, MAX_TRIES - 1).concat(ok.slice(-1));
    return ok;
  }

  function safeSegment(s, keep) {
    s = String(s || '').replace(/[\u0000-\u001f\u007f<>:"\/\\|?*]/g, '_').replace(/\s+/g, ' ').trim();
    s = s.replace(/^\.+/, '').replace(/[. ]+$/, '');
    return s.slice(0, keep || 80);
  }
  function safeHost(h) {
    h = String(h || '').toLowerCase().replace(/[^a-z0-9.-]/g, '').replace(/\.{2,}/g, '.').replace(/^[.-]+|[.]+$/g, '');
    return h.slice(0, 80) || 'unknown-host';
  }
  function fileNameFor(url, kind) {
    var x = parse(url), raw = '';
    if (x) { raw = x.pathname.split('/').filter(Boolean).pop() || ''; try { raw = decodeURIComponent(raw); } catch (e) { /* keep as is */ } }
    var ext = (raw.match(/\.([A-Za-z0-9]{2,5})$/) || [])[1] || '';
    var base = ext ? raw.slice(0, -(ext.length + 1)) : raw;
    if (!ext && x) {   // X-style links carry the type in the query (?format=jpg)
      var f = x.searchParams.get('format');
      if (f && /^[A-Za-z0-9]{2,5}$/.test(f)) ext = f;
    }
    base = safeSegment(base, 80);
    if (!base || RESERVED.test(base)) base = (kind === 'video' ? 'video' : 'image') + (base ? '-' + base : '');
    ext = ext.toLowerCase();
    return ext ? base + '.' + ext : base;
  }
  function grabPath(host, url, kind) { return SAVE_ROOT + '/' + safeHost(host) + '/' + fileNameFor(url, kind); }

  function plural(n) { return n + (n === 1 ? ' size' : ' sizes'); }
  function stateText(job) {
    if (!job) return '';
    if (job.state === 'queued') return 'queued';
    if (job.state === 'saving') return 'saving';
    if (job.state === 'saved') return 'saved to Downloads/' + SAVE_ROOT + '/' + safeHost(job.host) + '/';
    if (job.state === 'failed') return job.message || ('could not save (tried ' + plural(job.tried || 0) + ')');
    return '';
  }

  var api = {
    upgradeCandidates: upgradeCandidates, candidatesFor: candidatesFor, rankEntries: rankEntries, describe: describe,
    isRestricted: isRestricted, normalizeUrl: normalizeUrl, MIN_PX: MIN_PX,
    saveCheck: saveCheck, saveCandidates: saveCandidates, grabPath: grabPath, stateText: stateText, isBlockedHost: isBlockedHost, hostOf: hostOf,
    SAVE_ROOT: SAVE_ROOT, BLOCKED_MESSAGE: BLOCKED_MESSAGE, MAX_TRIES: MAX_TRIES,
    RESTRICTED_MESSAGE: "Chrome doesn't let extensions read this page",
    EMPTY_MESSAGE: 'No images or videos here bigger than ' + MIN_PX + ' px',
    STREAMED_MESSAGE: 'streamed video — needs the video helper (not installed)',
    SAVE_NOTE: 'Save puts one image or video in Downloads/WorkspaceHQ/grabs/<site>/, only when you press it. Nothing is requested until then.',
    GUESS_NOTE: 'Guesses are built from the link. Save asks that same site once (a HEAD check) before using a guess, and moves on to the next size if it is not there.',
  };
  root.HQGrabRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
