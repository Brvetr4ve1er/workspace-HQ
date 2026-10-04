// dc-lite — a CSP-safe renderer for Claude Design ".dc" templates.
//
// Claude Design's own runtime (support.js) compiles the logic script with
// `new Function` and pulls React + Babel from unpkg. This app's CSP is
// `script-src 'self'`, so neither can run here. The templates themselves are
// simple: every binding is a dotted path (`{{ a.b.c }}`), plus `sc-if`,
// `sc-for` and `x-import` (custom elements). This module renders exactly that
// subset, with the same semantics as the Claude Design runtime:
//
//   template → light vnode tree per render → positional patch onto the DOM
//
// Children are matched by position inside fragments, the way React reconciles
// the runtime's keyed Fragments. So a toggled `sc-if` never shifts its
// siblings, custom elements (hq-roll, hq-type…) keep their identity and
// animate through attributeChangedCallback, and a focused input keeps its
// caret. The logic stays a plain ES module class (no eval anywhere).

const SVG_NS = 'http://www.w3.org/2000/svg';
const CAMEL = 'sc-camel-';

// ---- expressions: the subset the runtime's expr.ts accepts ------------------
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

export function resolve(vals, src) {
  const expr = String(src).trim();
  if (!expr) return undefined;
  if (expr[0] === '(' && expr[expr.length - 1] === ')' && wrapsWhole(expr)) return resolve(vals, expr.slice(1, -1));
  const eq = topLevelEquality(expr);
  if (eq) {
    const l = resolve(vals, expr.slice(0, eq.index)), r = resolve(vals, expr.slice(eq.index + eq.op.length));
    // eslint-disable-next-line eqeqeq
    return eq.op === '===' ? l === r : eq.op === '!==' ? l !== r : eq.op === '==' ? l == r : l != r;
  }
  if (expr[0] === '!') return !resolve(vals, expr.slice(1));
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (expr === 'null') return null;
  if (expr === 'undefined') return undefined;
  if (NUMBER_RE.test(expr)) return Number(expr);
  if (expr.length >= 2 && (expr[0] === '"' || expr[0] === "'") && expr[expr.length - 1] === expr[0]) return expr.slice(1, -1);
  return resolvePath(vals, expr);
}
function wrapsWhole(expr) {
  let depth = 0;
  for (let i = 0; i < expr.length - 1; i++) {
    if (expr[i] === '(') depth++;
    else if (expr[i] === ')' && --depth === 0) return false;
  }
  return true;
}
function topLevelEquality(expr) {
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (depth === 0 && (c === '=' || c === '!') && expr[i + 1] === '=') {
      if (i > 0 && (expr[i - 1] === '=' || expr[i - 1] === '!')) continue;
      if (!expr.slice(0, i).trim()) continue;
      return { index: i, op: expr[i + 2] === '=' ? c + '==' : c + '=' };
    }
  }
  return null;
}
function resolvePath(vals, expr) {
  const head = expr.match(IDENT_RE);
  if (!head) return undefined;
  let cur = vals == null ? undefined : vals[head[0]];
  let i = head[0].length;
  while (i < expr.length) {
    if (expr[i] === '.') {
      const m = expr.slice(i + 1).match(IDENT_RE) || expr.slice(i + 1).match(/^\d+/);
      if (!m) return undefined;
      cur = cur == null ? undefined : cur[m[0]];
      i += 1 + m[0].length;
    } else if (expr[i] === '[') {
      let depth = 1, j = i + 1;
      for (; j < expr.length && depth > 0; j++) {
        if (expr[j] === '[') depth++;
        else if (expr[j] === ']' && --depth === 0) break;
      }
      if (depth !== 0) return undefined;
      const key = resolve(vals, expr.slice(i + 1, j));
      cur = cur == null ? undefined : cur[key];
      i = j + 1;
    } else return undefined;
  }
  return cur;
}

// `attr="{{ x }}"` yields the raw value (functions, objects, refs); a mixed
// string interpolates, with unresolved holes rendering as ''.
export function compileAttr(raw) {
  const whole = raw.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/);
  if (whole) return (vals) => resolve(vals, whole[1]);
  if (raw.includes('{{')) {
    const parts = raw.split(/\{\{([\s\S]+?)\}\}/g);
    return (vals) => parts.map((s, i) => (i & 1 ? resolve(vals, s) ?? '' : s)).join('');
  }
  return () => raw;
}

// ---- styles (React's rules: numbers get px unless the property is unitless) --
const UNITLESS = new Set(('animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth '
  + 'boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative '
  + 'flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan '
  + 'gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom '
  + 'fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth').split(' '));
const kebab = (k) => (k.startsWith('--') ? k : k.replace(/^(Webkit|Moz|ms)/, (m) => '-' + m.toLowerCase()).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));

export function styleMap(v) {
  const out = {};
  if (typeof v === 'string') {
    for (const decl of v.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim(), val = decl.slice(i + 1).trim();
      if (prop && val) out[prop.startsWith('--') ? prop : prop.toLowerCase()] = val;
    }
  } else if (v && typeof v === 'object') {
    for (const [k, raw] of Object.entries(v)) {
      if (raw == null || typeof raw === 'boolean' || raw === '') continue;
      out[kebab(k)] = typeof raw === 'number' && raw !== 0 && !UNITLESS.has(k) && !k.startsWith('--') ? raw + 'px' : String(raw);
    }
  }
  return out;
}
function patchStyle(el, oldV, newV) {
  const a = oldV === undefined ? {} : styleMap(oldV), b = styleMap(newV);
  for (const p of Object.keys(a)) if (!(p in b)) el.style.removeProperty(p);
  for (const [p, val] of Object.entries(b)) {
    if (a[p] === val && oldV !== undefined) continue;
    const imp = /!\s*important\s*$/i.test(val);
    el.style.setProperty(p, imp ? val.replace(/!\s*important\s*$/i, '').trim() : val, imp ? 'important' : '');
  }
}

// x-import: the runtime wraps each custom element in a div. It keeps only the
// positioning half of the authored style on that div and drops the rest, which
// glues `<hq-clock style="margin-right:10px">` to its neighbour and leaves the
// sized 3D viewers rendering small. We follow the author's intent instead: a
// sized/positioned import gets its whole style on the wrapper and the element
// fills it; an unsized one gets its style directly (wrapper is display:contents).
const HOST_STYLE = new Set(['position', 'left', 'right', 'top', 'bottom', 'inset', 'width', 'height', 'z-index', 'transform']);
function importStyles(raw) {
  const all = styleMap(raw);
  const boxed = Object.keys(all).some((k) => HOST_STYLE.has(k));
  return boxed ? { host: all, inner: { display: 'block', width: '100%', height: '100%' } } : { host: { display: 'contents' }, inner: all };
}

// ---- compile -----------------------------------------------------------------
function encodeCase(html) {
  html = html.replace(/<(x-import)((?:[^>"']|"[^"]*"|'[^']*')*)\/>/gi, '<$1$2></$1>');
  // the HTML parser lowercases attributes; park camelCase names (onClick,
  // viewBox, autoFocus…) in a reversible kebab form first
  return html.replace(/(\s)([a-z]+[A-Z][A-Za-z0-9]*)(\s*=)/g, (_, sp, name, eq) => sp + CAMEL + name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + eq);
}
const decodeName = (n) => (n.startsWith(CAMEL) ? n.slice(CAMEL.length).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()) : n);

export function compile(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = encodeCase(html);   // inert: template content never executes
  const kids = walkKids(tpl.content);
  return (vals) => kids.map((b) => b(vals || {}));
}
function walkKids(node) { return [...node.childNodes].map(walk).filter(Boolean); }
function walk(node) {
  if (node.nodeType === Node.TEXT_NODE) return walkText(node);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.localName;
  if (tag === 'sc-for') return walkFor(node);
  if (tag === 'sc-if') return walkIf(node);
  if (tag === 'x-import') return walkImport(node);
  if (tag === 'helmet' || tag === 'sc-helmet' || tag === 'script') return null;
  return walkElement(node);
}
// Bindings that never resolved (a typo, or a value the logic forgot to
// return). The runtime warns once per hole; we collect them for the selftest.
export const unresolved = new Set();
const hole = (expr) => { const k = expr.trim(); if (!unresolved.has(k)) { unresolved.add(k); console.warn('[dc] {{ ' + k + ' }} never resolved'); } };

function walkText(node) {
  const txt = node.nodeValue || '';
  if (!txt.includes('{{')) {
    if (!txt.trim() && !txt.includes(' ')) return null;
    return () => ({ k: 't', text: txt });
  }
  const parts = txt.split(/\{\{([\s\S]+?)\}\}/g);
  return (vals) => ({
    k: 'f',
    kids: parts.map((p, i) => {
      if (!(i & 1)) return p ? { k: 't', text: p } : null;
      const v = resolve(vals, p);
      if (v === undefined) hole(p);
      if (v === undefined || v === null || typeof v === 'boolean') return null;
      return { k: 'e', tag: 'span', ns: null, props: { class: 'sc-interp' }, kids: [{ k: 't', text: String(v) }] };
    }),
  });
}
function walkIf(el) {
  const get = compileAttr(el.getAttribute('value') || '');
  const kids = walkKids(el);
  const src = el.getAttribute('value') || '';
  return (vals) => {
    const v = get(vals);
    if (v === undefined && /^\s*\{\{\s*[A-Za-z_$][\w$.]*\s*\}\}\s*$/.test(src)) hole(src.replace(/[{}]/g, ''));
    return v ? { k: 'f', kids: kids.map((b) => b(vals)) } : null;
  };
}
function walkFor(el) {
  const get = compileAttr(el.getAttribute('list') || '');
  const as = el.getAttribute('as') || 'item';
  const kids = walkKids(el);
  const src = el.getAttribute('list') || '';
  return (vals) => {
    const list = get(vals);
    if (list === undefined) hole(src.replace(/[{}]/g, ''));
    return { k: 'f', kids: (Array.isArray(list) ? list : []).map((item, i) => {
      const sub = { ...vals, [as]: item, $index: i };
      return { k: 'f', kids: kids.map((b) => b(sub)) };
    }) };
  };
}
function propGetters(el, skip) {
  const out = [];
  for (const { name, value } of [...el.attributes]) {
    if (skip.has(name) || name.startsWith('hint-')) continue;
    out.push([decodeName(name), compileAttr(value)]);
  }
  return out;
}
// `style-hover="…"` / `style-active="…"` become one generated class each, with
// every declaration !important so it beats the inline style (runtime parity).
let pseudoSheet = null;
const pseudoCache = new Map();
function importantify(css) {
  const decls = []; let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '(') depth++;
    else if (css[i] === ')') depth = Math.max(0, depth - 1);
    else if (css[i] === ';' && depth === 0) { decls.push(css.slice(start, i)); start = i + 1; }
  }
  decls.push(css.slice(start));
  return decls.map((d) => d.trim()).filter(Boolean).map((d) => (/!\s*important$/i.test(d) ? d : d + ' !important')).join(';');
}
function pseudoClass(pseudo, css) {
  const key = pseudo + '|' + css;
  if (pseudoCache.has(key)) return pseudoCache.get(key);
  if (!pseudoSheet) { const s = document.createElement('style'); s.dataset.dc = 'pseudo'; document.head.appendChild(s); pseudoSheet = s.sheet; }
  const cls = 'scp' + pseudoCache.size.toString(36);
  const el = pseudo === 'before' || pseudo === 'after';
  pseudoSheet.insertRule('.' + cls + (el ? '::' : ':') + pseudo + '{' + (el ? css : importantify(css)) + '}', pseudoSheet.cssRules.length);
  pseudoCache.set(key, cls);
  return cls;
}
function walkElement(el) {
  const tag = el.localName, ns = el.namespaceURI === SVG_NS ? SVG_NS : null;
  const pseudo = [];
  for (const { name, value } of [...el.attributes]) if (name.startsWith('style-')) pseudo.push(pseudoClass(name.slice(6), value));
  const getters = propGetters(el, new Set([...el.attributes].map((a) => a.name).filter((n) => n.startsWith('style-'))));
  if (pseudo.length) {
    const cls = getters.find(([k]) => k === 'class');
    const base = cls ? cls[1] : () => '';
    const merged = (vals) => [base(vals), ...pseudo].filter(Boolean).join(' ');
    if (cls) cls[1] = merged; else getters.push(['class', merged]);
  }
  const kids = walkKids(el.localName === 'template' ? el.content : el);
  return (vals) => {
    const props = {};
    for (const [k, g] of getters) props[k] = g(vals);
    return { k: 'e', tag, ns, props, kids: kids.map((b) => b(vals)) };
  };
}
function walkImport(el) {
  const name = (el.getAttribute('component-from-global-scope') || '').trim();
  const styleGet = el.hasAttribute('style') ? compileAttr(el.getAttribute('style')) : null;
  const getters = propGetters(el, new Set(['component-from-global-scope', 'style', 'from', 'component']));
  const kids = walkKids(el);
  return (vals) => {
    const st = importStyles(styleGet ? styleGet(vals) : '');
    const props = { __custom: true, style: st.inner };
    for (const [k, g] of getters) props[k] = g(vals);
    const inner = name ? { k: 'e', tag: name, ns: null, props, kids: kids.map((b) => b(vals)) } : null;
    return { k: 'e', tag: 'div', ns: null, props: { class: 'sc-host-x', style: st.host }, kids: [inner] };
  };
}

// ---- patch -------------------------------------------------------------------
const evType = (tag, name, el) => {
  const t = name.slice(2).toLowerCase();
  if (t === 'change' && (tag === 'textarea' || (tag === 'input' && !/^(checkbox|radio|file)$/i.test(el.type || '')))) return 'input';
  if (t === 'doubleclick') return 'dblclick';
  return t;
};
function setHandler(el, type, fn) {
  const h = el.__dch || (el.__dch = {});
  if (!(type in h)) el.addEventListener(type, (e) => { const f = el.__dch[type]; if (typeof f === 'function') f(e); });
  h[type] = fn;
}
function setRef(ref, el) {
  if (typeof ref === 'function') ref(el);
  else if (ref && typeof ref === 'object') ref.current = el;
}
function applyProps(v, el, oldP) {
  const custom = !!v.props.__custom;
  for (const [name, val] of Object.entries(v.props)) {
    if (name === '__custom' || name === 'ref' || name === 'autoFocus') continue;
    const old = oldP ? oldP[name] : undefined;
    if (name === 'style') { if (!oldP || old !== val) patchStyle(el, oldP ? old : undefined, val); continue; }
    if (!custom && /^on[A-Z]/.test(name)) { setHandler(el, evType(v.tag, name, el), val); continue; }
    if (oldP && old === val) continue;
    if (!custom && name === 'value' && 'value' in el) { const s = val == null ? '' : String(val); if (el.value !== s) el.value = s; continue; }
    if (!custom && name === 'checked') { el.checked = !!val; continue; }
    if (!custom && name === 'disabled' && 'disabled' in el) { el.disabled = !!val; continue; }
    if (typeof val === 'function') continue;
    const aria = name.startsWith('aria-');
    if (val == null || (val === false && !aria && !custom)) el.removeAttribute(name);
    else if (val === true && !custom) el.setAttribute(name, aria ? 'true' : '');
    else el.setAttribute(name, String(val));
  }
}
function detachRefs(v) {
  if (!v) return;
  if (v.k === 'e' && v.props.ref) setRef(v.props.ref, null);
  if (v.kids) v.kids.forEach(detachRefs);
}
function remove(v) {
  if (!v) return;
  if (v.k === 'f') { v.kids.forEach(remove); return; }
  detachRefs(v);
  v.dom.remove();
}
const place = (parent, node, before) => { if (node.parentNode !== parent || node.nextSibling !== before) parent.insertBefore(node, before); };

// Returns the first DOM node of `n` (or `before` when it rendered nothing), so
// lists can be patched right-to-left with a moving insertion point.
function patch(parent, o, n, before, after) {
  if (!n) { remove(o); return before; }
  if (n.k === 'f') {
    if (o && o.k !== 'f') { remove(o); o = null; }
    return patchKids(parent, o ? o.kids : [], n.kids, before, after);
  }
  if (n.k === 't') {
    if (o && o.k === 't') { n.dom = o.dom; if (o.text !== n.text) n.dom.data = n.text; }
    else { remove(o); n.dom = document.createTextNode(n.text); }
    place(parent, n.dom, before);
    return n.dom;
  }
  const same = o && o.k === 'e' && o.tag === n.tag && o.ns === n.ns;
  if (o && !same) remove(o);
  const el = same ? o.dom : (n.ns ? document.createElementNS(n.ns, n.tag) : document.createElement(n.tag));
  n.dom = el;
  applyProps(n, el, same ? o.props : null);
  patchKids(el, same ? o.kids : [], n.kids, null, after);
  place(parent, el, before);
  const oldRef = same ? o.props.ref : undefined, newRef = n.props.ref;
  if (oldRef !== newRef || !same) after.push(() => { if (same && oldRef) setRef(oldRef, null); if (newRef) setRef(newRef, el); });
  if (!same && n.props.autoFocus) after.push(() => el.focus());
  return el;
}
function patchKids(parent, oldKids, newKids, before, after) {
  for (let i = oldKids.length - 1; i >= newKids.length; i--) remove(oldKids[i]);
  let at = before;
  for (let i = newKids.length - 1; i >= 0; i--) at = patch(parent, oldKids[i], newKids[i], at, after);
  return at;
}

// ---- logic base + host -------------------------------------------------------
export const createRef = () => ({ current: null });

// Same contract as the runtime's DCLogic: setState merges synchronously into
// this.state and schedules one render; renderVals() returns the flat object
// the template binds against (merged over props).
export class DCLogic {
  constructor(props) { this.props = props || {}; this.state = {}; this.__host = null; }
  setState(update, cb) {
    const patchObj = typeof update === 'function' ? update(this.state, this.props) : update;
    if (patchObj) this.state = { ...this.state, ...patchObj };
    if (this.__host) this.__host.schedule(cb);
  }
  forceUpdate(cb) { if (this.__host) this.__host.schedule(cb); }
  componentDidMount() {}
  componentDidUpdate() {}
  componentWillUnmount() {}
  renderVals() { return {}; }
}

export function mount(root, Logic, template, props) {
  const render = compile(template);
  const logic = new Logic(props || {});
  let tree = [], queued = false, mounted = false, cbs = [], prevProps = logic.props;
  const flush = () => {
    queued = false;
    let vals;
    try { vals = { ...logic.props, ...(logic.renderVals() || {}) }; }
    catch (e) { console.error('[dc] renderVals failed:', e); return; }
    const next = render(vals), after = [];
    patchKids(root, tree, next, null, after);
    tree = next;
    after.forEach((f) => { try { f(); } catch (e) { console.error('[dc] ref failed:', e); } });
    const done = cbs; cbs = [];
    try {
      if (!mounted) { mounted = true; logic.componentDidMount(); }
      else logic.componentDidUpdate(prevProps);
    } catch (e) { console.error('[dc] lifecycle failed:', e); }
    prevProps = logic.props;
    done.forEach((f) => f());
  };
  logic.__host = {
    schedule(cb) {
      if (cb) cbs.push(cb);
      if (!queued) { queued = true; queueMicrotask(flush); }
    },
  };
  logic.__host.schedule();
  return {
    logic,
    setProps(p) { logic.props = { ...logic.props, ...p }; logic.__host.schedule(); },
    unmount() { try { logic.componentWillUnmount(); } catch (e) { console.error(e); } logic.__host = null; tree.forEach(remove); tree = []; },
  };
}
