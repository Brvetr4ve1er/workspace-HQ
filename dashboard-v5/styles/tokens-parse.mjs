// Zero-dependency reader for WorkspaceHQ token stylesheets (styles/tokens.css,
// and later the browser extension's copied block in popup.css, which is
// parity-checked against it). Not a general CSS parser: it reads TOP-LEVEL style
// rules and @font-face, and skips every other at-rule body (@media, @supports,
// @keyframes … are conditional, not part of the base token set).
//
//   parseTokens(cssText) → {
//     rules:     { [normalizedSelector]: { [property]: value } }  all declarations,
//                later rule wins per property (cascade order, specificity ignored),
//     fontFaces: [{ family, urls, weight, style, display, src }],
//     dark:      custom properties of [data-hq-theme]          (null if absent),
//     light:     custom properties of [data-hq-theme="light"]  (null if absent),
//   }
//
// Selector lists are split (":root,[data-hq-theme]{…}" fills both keys) and each
// selector is normalized so [data-hq-theme="light"], [data-hq-theme='light'] and
// [data-hq-theme=light] are the same key.

export const DARK = '[data-hq-theme]';
export const LIGHT = '[data-hq-theme=light]';

// Drop /* … */ comments, leaving quoted strings intact (a "/*" inside a string
// is content, not a comment).
function stripComments(css) {
  let out = '', q = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (q) {
      out += c;
      if (c === '\\' && i + 1 < css.length) out += css[++i];
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") { q = c; out += c; }
    else if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 1;
      out += ' ';
    } else out += c;
  }
  return out;
}

// Split on `sep` only outside quotes, parens and brackets — so a value like
// "'IBM Plex Mono',ui-monospace" or url("a;b") stays whole.
function splitTop(text, sep) {
  const parts = [];
  let buf = '', depth = 0, q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      buf += c;
      if (c === '\\' && i + 1 < text.length) buf += text[++i];
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    else if (c === sep && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += c;
  }
  parts.push(buf);
  return parts;
}

// Index just past the `}` matching the `{` at `open` (quote-aware, nesting-aware).
function matchBrace(css, open) {
  let depth = 0, q = null;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return css.length; // unterminated block: take the rest, like a browser would
}

function parseDecls(body) {
  const decls = {};
  for (const piece of splitTop(body, ';')) {
    const colon = piece.indexOf(':');
    if (colon === -1) continue;
    let name = piece.slice(0, colon).trim();
    const value = piece.slice(colon + 1).trim();
    if (!name) continue;
    if (!name.startsWith('--')) name = name.toLowerCase(); // custom props are case-sensitive
    decls[name] = value;
  }
  return decls;
}

const unquote = (s) => s.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');

export function normalizeSelector(sel) {
  return sel.trim().replace(/\s+/g, ' ')
    // [ attr  op  "value" ]  →  [attr op value]
    .replace(/\[\s*([^\]\s~|^$*=]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]/g,
      (_m, attr, op, dq, sq, bare) => op ? `[${attr}${op}${dq ?? sq ?? bare ?? ''}]` : `[${attr}]`);
}

const customOnly = (decls) => decls
  ? Object.fromEntries(Object.entries(decls).filter(([k]) => k.startsWith('--')))
  : null;

export function parseTokens(cssText) {
  const css = stripComments(String(cssText ?? ''));
  const rules = {}, fontFaces = [];
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf('{', i);
    const semi = css.indexOf(';', i);
    if (brace === -1) break;
    // Block-less at-rule statement (@import …; @charset …;) before the next block.
    if (semi !== -1 && semi < brace && css.slice(i, semi).trim().startsWith('@')) { i = semi + 1; continue; }
    const prelude = css.slice(i, brace).trim();
    const end = matchBrace(css, brace);
    const body = css.slice(brace + 1, end - 1);
    i = end;
    if (/^@font-face\b/i.test(prelude)) {
      const d = parseDecls(body);
      const src = d.src ?? '';
      const urls = [...src.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g)]
        .map((m) => m[1] ?? m[2] ?? m[3]);
      fontFaces.push({ family: unquote(d['font-family'] ?? ''), urls, weight: d['font-weight'] ?? null,
        style: d['font-style'] ?? null, display: d['font-display'] ?? null, src });
      continue;
    }
    if (prelude.startsWith('@') || !prelude) continue; // conditional/nested at-rules: not base tokens
    const decls = parseDecls(body);
    for (const raw of splitTop(prelude, ',')) {
      const sel = normalizeSelector(raw);
      if (sel) rules[sel] = { ...(rules[sel] || {}), ...decls };
    }
  }
  return { rules, fontFaces, dark: customOnly(rules[DARK]), light: customOnly(rules[LIGHT]) };
}
