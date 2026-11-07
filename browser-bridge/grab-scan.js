// WorkspaceHQ Bridge 0.7.0 — the page scanner for "Find the best version". ONE self-contained function: it is injected with
// chrome.scripting.executeScript({ target, func: hqGrabScan, args: [{ min: 200 }] }), which serialises its source, so it
// may not import or close over anything — every helper lives inside it. It reads the DOM only. It fetches nothing, loads no
// image and never touches the network; natural sizes are read from elements that are already loaded, never guessed.
//
//   hqGrabScan({ min? }) → { ok:true, pageUrl, title, items:[entry…], streamed, skipped:{data,blob,small}, capped }
//   entry = { url, kind:'image'|'video', via, w, h, shownW, shownH, label, variants:[{url,w?,x?}], streamed? }
//     w/h = natural size when the element has loaded it, else 0 (unknown). variants = the page's own srcset / <source> /
//     <picture> candidates. Skips data: and blob: URLs, and anything with both sides under `min` px (default 200).
function hqGrabScan(opts) {
  var MIN = (opts && opts.min) || 200, MAX_ITEMS = 400, MAX_BG = 3000, LABEL_MAX = 120;
  var base = document.baseURI || location.href;
  var byUrl = {}, items = [], streamed = 0, capped = false, skipped = { data: 0, blob: 0, small: 0 };

  function abs(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    if (/^data:/i.test(s)) { skipped.data++; return null; }
    if (/^blob:/i.test(s)) { skipped.blob++; return null; }
    try {
      var u = new URL(s, base);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      u.hash = '';
      return u.href;
    } catch (e) { return null; }
  }
  function attr(el, name) { var v = el && el.getAttribute ? el.getAttribute(name) : null; return v == null ? '' : String(v); }

  // HTML srcset algorithm: a URL is a run of non-space characters, so commas inside URLs (Cloudinary w_300,h_200) survive;
  // "a.jpg 480w,b.jpg 800w" (no space after the comma) splits after the descriptor.
  function parseSrcset(str) {
    var out = [], s = String(str || ''), i = 0, n = s.length;
    while (i < n) {
      while (i < n && (s.charAt(i) === ',' || /\s/.test(s.charAt(i)))) i++;
      if (i >= n) break;
      var st = i;
      while (i < n && !/\s/.test(s.charAt(i))) i++;
      var url = s.slice(st, i), desc = '';
      if (/,+$/.test(url)) url = url.replace(/,+$/, '');
      else {
        var ds = i, depth = 0;
        while (i < n) { var ch = s.charAt(i); if (ch === '(') depth++; else if (ch === ')') depth--; else if (ch === ',' && depth <= 0) break; i++; }
        desc = s.slice(ds, i).trim();
      }
      var wm = desc.match(/(^|\s)(\d+(?:\.\d+)?)w(\s|$)/), xm = desc.match(/(^|\s)(\d+(?:\.\d+)?)x(\s|$)/);
      var a = abs(url);
      if (a) { var v = { url: a }; if (wm) v.w = Math.round(parseFloat(wm[2])); if (xm) v.x = parseFloat(xm[2]); out.push(v); }
    }
    return out;
  }

  function cleanLabel(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    var chars = Array.from(t);
    return chars.length > LABEL_MAX ? chars.slice(0, LABEL_MAX).join('') : t;
  }
  function labelOf(el) {
    var t = attr(el, 'alt') || attr(el, 'aria-label') || attr(el, 'title');
    if (!t && el.closest) {
      var fig = el.closest('figure');
      var cap = fig && fig.querySelector ? fig.querySelector('figcaption') : null;
      if (cap) t = cap.textContent;
    }
    if (!t) {
      var node = el;
      for (var d = 0; node && d < 6 && !t; d++, node = node.parentElement) {
        var p = node.previousElementSibling;
        for (var k = 0; p && k < 6; k++, p = p.previousElementSibling) {
          if (/^H[1-6]$/.test(p.tagName || '')) { t = p.textContent; break; }
        }
      }
    }
    return cleanLabel(t);
  }
  function shownOf(el) {
    var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    return { w: Math.round((r && r.width) || el.clientWidth || 0), h: Math.round((r && r.height) || el.clientHeight || 0) };
  }

  function add(url, kind, via, nat, shown, label, variants) {
    if (!url) return;
    var w = nat && nat.w > 0 ? nat.w : 0, h = nat && nat.h > 0 ? nat.h : 0;
    var sw = shown ? shown.w : 0, sh = shown ? shown.h : 0;
    if (w && h && w < MIN && h < MIN) { skipped.small++; return; }
    if (!(w && h) && sw && sh && sw < MIN && sh < MIN && via === 'bg') { skipped.small++; return; }   // icons / sprites
    var ex = byUrl[url];
    if (ex) {
      if (w * h > ex.w * ex.h) { ex.w = w; ex.h = h; }
      if (!ex.label && label) ex.label = label;
      if (sw > ex.shownW) { ex.shownW = sw; ex.shownH = sh; }
      (variants || []).forEach(function (v) { if (!ex.variants.some(function (x) { return x.url === v.url; })) ex.variants.push(v); });
      return;
    }
    if (items.length >= MAX_ITEMS) { capped = true; return; }
    var vs = [], seen = {};
    (variants || []).forEach(function (v) { if (v.url !== url && !seen[v.url]) { seen[v.url] = 1; vs.push(v); } });
    var e = { url: url, kind: kind, via: via, w: w, h: h, shownW: sw, shownH: sh, label: label || '', variants: vs };
    byUrl[url] = e; items.push(e);
  }

  function matches(media) {
    if (!media) return true;
    try { return typeof matchMedia === 'function' ? matchMedia(media).matches : true; } catch (e) { return true; }
  }

  // ---- <img> (and the <picture> it sits in), including lazy data-* behind placeholders ------------------------------
  var imgs = document.querySelectorAll('img');
  for (var i = 0; i < imgs.length; i++) {
    var img = imgs[i];
    var variants = [];
    var par = img.parentElement;
    if (par && String(par.tagName).toUpperCase() === 'PICTURE') {
      var srcs = par.querySelectorAll('source');
      for (var s = 0; s < srcs.length; s++) {
        if (!matches(attr(srcs[s], 'media'))) continue;
        variants = variants.concat(parseSrcset(attr(srcs[s], 'srcset') || attr(srcs[s], 'data-srcset')));
      }
    }
    ['srcset', 'data-srcset', 'data-lazy-srcset'].forEach(function (a) { variants = variants.concat(parseSrcset(attr(img, a))); });
    var cur = abs(img.currentSrc || '');
    var plain = abs(attr(img, 'src'));
    var lazy = abs(attr(img, 'data-src') || attr(img, 'data-original') || attr(img, 'data-lazy-src'));
    var primary = cur || plain || lazy, via = 'img';
    if (!cur && lazy) { primary = lazy; via = 'lazy'; }
    else if (par && String(par.tagName).toUpperCase() === 'PICTURE' && variants.length) via = 'picture';
    if (!primary && variants.length) {
      var top = variants[0];
      variants.forEach(function (v) { if ((v.w || 0) > (top.w || 0) || (v.x || 0) > (top.x || 0)) top = v; });
      primary = top.url;
    }
    var loaded = cur && primary === cur && img.naturalWidth > 0;
    add(primary, 'image', via, loaded ? { w: img.naturalWidth, h: img.naturalHeight } : null, shownOf(img), labelOf(img), variants);
  }

  // ---- <video>: src, <source>, poster; blob: / streamed video is reported, not listed ------------------------------
  var vids = document.querySelectorAll('video');
  for (var j = 0; j < vids.length; j++) {
    var v = vids[j];
    var rawSrc = String(v.currentSrc || attr(v, 'src') || '');
    var vsources = v.querySelectorAll ? v.querySelectorAll('source') : [];
    var vvars = [];
    for (var q = 0; q < vsources.length; q++) { var sv = abs(attr(vsources[q], 'src')); if (sv) vvars.push({ url: sv }); }
    var vurl = abs(rawSrc) || (vvars.length ? vvars[0].url : null);
    var vlabel = labelOf(v), vshown = shownOf(v);
    if (/^blob:/i.test(rawSrc)) {   // MediaSource / streamed: listed as a note, with nothing to copy
      streamed++;
      items.push({ url: '', kind: 'video', via: 'video', w: 0, h: 0, shownW: vshown.w, shownH: vshown.h, label: vlabel, variants: [], streamed: true });
    } else if (vurl) {
      add(vurl, 'video', 'video', v.videoWidth > 0 ? { w: v.videoWidth, h: v.videoHeight } : null, vshown, vlabel, vvars);
    }
    var poster = abs(attr(v, 'poster'));
    if (poster) add(poster, 'image', 'poster', null, vshown, vlabel, []);
  }

  // ---- CSS background images ---------------------------------------------------------------------------------------
  var all = document.querySelectorAll('*'), limit = Math.min(all.length, MAX_BG);
  for (var b = 0; b < limit; b++) {
    var el = all[b], cs;
    try { cs = getComputedStyle(el); } catch (e) { continue; }
    var bg = cs && cs.backgroundImage;
    if (!bg || bg === 'none' || bg.indexOf('url(') < 0) continue;
    var re = /url\(\s*(['"]?)(.*?)\1\s*\)/g, m, sh = null;
    while ((m = re.exec(bg))) {
      var bu = abs(m[2]);
      if (!bu) continue;
      sh = sh || shownOf(el);
      add(bu, 'image', 'bg', null, sh, labelOf(el), []);
    }
  }

  return { ok: true, pageUrl: location.href, title: String(document.title || '').slice(0, 200), items: items, streamed: streamed, skipped: skipped, capped: capped };
}
