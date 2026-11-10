'use strict';
// Client delivery check — the in-page probe (spec: batch-2-rest plan, dish "delivery-check").
// measure() runs INSIDE the hidden check window, in an isolated world, so the page's own scripts cannot tamper with it.
// It only READS the DOM and returns a plain object; delivery-check-core.mjs treats that object as untrusted data and
// sanitizes it before any check looks at it. PROBE_SOURCE is the function's text, sent through
// webContents.executeJavaScriptInIsolatedWorld as '(' + PROBE_SOURCE + ')()'.
//
// The function body must stay self-contained (no outer names) and must not use any network API: a test pins that.
// measure(env) takes an optional { window, document } so the unit test can feed it a small fake page.
//
// Returned shape (all numbers and short strings; the core clamps again):
//   { title, viewport: { innerWidth, scrollWidth }, meta: { hasViewport, content }, html: { lang, dir },
//     overflow: [{ tag, cls }]            widest elements past the right edge, at most 5, tag and class only
//     smallText: { count, total }         visible text elements under 12 px / all visible text elements
//     taps: { total, under44, under24, samples }   interactive elements (inline links in text are exempt)
//     bidi: { rtlRuns, unisolated, samples }       right-to-left text that holds a Latin or digit run (a heuristic input)
//     strings: [text]                     visible text strings (trimmed, at most 80 chars, at most 60)
//     links: { alternates, anchors, options }      same-origin language routes, paths only }

function measure(env) {
  var w = (env && env.window) || window;
  var d = (env && env.document) || w.document;
  var cap = function (s, n) { return String(s == null ? '' : s).slice(0, n); };
  var attr = function (el, name) { return el.getAttribute ? el.getAttribute(name) : null; };
  var classOf = function (el) { return cap(typeof el.className === 'string' ? el.className : attr(el, 'class') || '', 60); };
  var tagOf = function (el) { return String(el.tagName || '').toLowerCase(); };
  var SKIP = { script: 1, style: 1, head: 1, meta: 1, link: 1, title: 1, noscript: 1, template: 1, html: 1 };
  var all = Array.prototype.slice.call(d.querySelectorAll('*'), 0, 5000);
  var root = d.documentElement;
  var iw = w.innerWidth || 0;
  var sw = Math.max(root && root.scrollWidth || 0, d.body && d.body.scrollWidth || 0);
  var URLCtor = w.URL || URL;
  var origin = w.location && w.location.origin;

  var out = {
    title: cap(d.title, 80),
    viewport: { innerWidth: iw, scrollWidth: sw },
    meta: { hasViewport: false, content: '' },
    html: { lang: cap(root && attr(root, 'lang'), 20), dir: cap(root && attr(root, 'dir'), 8) },
    overflow: [], smallText: { count: 0, total: 0 }, taps: { total: 0, under44: 0, under24: 0, samples: [] },
    bidi: { rtlRuns: 0, unisolated: 0, samples: [] }, strings: [],
    links: { alternates: [], anchors: [], options: [] },
  };
  var wide = [];
  var seenStrings = {};
  var ARABIC = /[؀-ۿݐ-ݿ]/;
  var LATIN_OR_DIGIT = /[A-Za-z0-9٠-٩]/;
  var localePath = /^\/(ar|fr|en)(\/|$)/i;

  var sameOriginPath = function (href) {
    try {
      var u = new URLCtor(href, w.location.href);
      if (u.origin !== origin) return '';
      return cap(u.pathname + u.search, 80);
    } catch (e) { return ''; }
  };

  for (var i = 0; i < all.length; i++) {
    var el = all[i], tag = tagOf(el);
    if (tag === 'meta') {
      if (String(attr(el, 'name') || '').toLowerCase() === 'viewport') { out.meta.hasViewport = true; out.meta.content = cap(attr(el, 'content'), 120); }
      continue;
    }
    if (tag === 'link') {
      var rel = String(attr(el, 'rel') || '').toLowerCase(), hl = attr(el, 'hreflang');
      if (rel.indexOf('alternate') >= 0 && hl && out.links.alternates.length < 40) {
        var lp = sameOriginPath(attr(el, 'href'));
        if (lp) out.links.alternates.push({ hreflang: cap(hl, 12), path: lp });
      }
      continue;
    }
    if (tag === 'option') {
      if (out.links.options.length < 40) out.links.options.push({ value: cap(attr(el, 'value') || '', 80), text: cap(el.textContent, 30) });
      continue;
    }
    if (SKIP[tag]) continue;

    var langLink = false;
    var cs = w.getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    var shown = cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;

    if (tag === 'a') {
      var ah = attr(el, 'href'), ahl = attr(el, 'hreflang');
      if (ah) {
        var ap = sameOriginPath(ah);
        if (ap && (ahl || localePath.test(ap) || /[?&]lang=[a-z]{2}\b/i.test(ap))) {
          langLink = true;
          if (out.links.anchors.length < 40) out.links.anchors.push({ hreflang: cap(ahl || '', 12), path: ap });
        }
      }
    }
    if (!shown) continue;

    if (tag !== 'body' && rect.right > iw + 1) wide.push({ tag: tag, cls: classOf(el), right: rect.right });

    var isTap = (tag === 'a' && attr(el, 'href')) || tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'summary' ||
      (tag === 'input' && String(attr(el, 'type') || '').toLowerCase() !== 'hidden') || /^(button|link|tab|menuitem)$/.test(String(attr(el, 'role') || ''));
    if (isTap && !(tag === 'a' && cs.display === 'inline')) {
      out.taps.total++;
      if (rect.width < 44 || rect.height < 44) {
        out.taps.under44++;
        if (out.taps.samples.length < 5) out.taps.samples.push({ tag: tag, cls: classOf(el), w: Math.round(rect.width), h: Math.round(rect.height) });
      }
      if (rect.width < 24 || rect.height < 24) out.taps.under24++;
    }

    if (langLink) continue;   // a language switch repeats on every page by design: its words are not untranslated text
    var kids = el.childNodes || [];
    for (var k = 0; k < kids.length; k++) {
      var node = kids[k];
      if (node.nodeType !== 3) continue;
      var text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      out.smallText.total++;
      if (parseFloat(cs.fontSize) < 12) out.smallText.count++;
      var short = text.slice(0, 80);
      if (out.strings.length < 60 && !seenStrings[short]) { seenStrings[short] = 1; out.strings.push(short); }
      if (cs.direction === 'rtl' && ARABIC.test(text) && LATIN_OR_DIGIT.test(text)) {
        out.bidi.rtlRuns++;
        var bidiMode = String(cs.unicodeBidi || '');
        // An element with a dir attribute is an isolate by the browser's own stylesheet (unicode-bidi: isolate), and that says nothing about the
        // run inside its own text: <p dir=rtl>... 555 ...</p> still has a bare number run. So the computed style counts only when the author set it
        // (no dir attribute); dir=auto, <bdi> and <bdo> count by themselves. (Found by the native check on a real page.)
        var dirAttr = attr(el, 'dir');
        var isolated = tag === 'bdi' || tag === 'bdo' || dirAttr === 'auto' || (!dirAttr && /isolate|plaintext/.test(bidiMode));
        if (!isolated) { out.bidi.unisolated++; if (out.bidi.samples.length < 5) out.bidi.samples.push(text.slice(0, 40)); }
      }
    }
  }
  wide.sort(function (a, b) { return b.right - a.right; });
  out.overflow = wide.slice(0, 5).map(function (o) { return { tag: o.tag, cls: o.cls }; });
  return out;
}

const PROBE_SOURCE = String(measure);

module.exports = { measure, PROBE_SOURCE };
