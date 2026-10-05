// <hq-lines> and <hq-type> render live text: diff previews, session tails (a 60-line rolling window), streaming
// Ask answers. These pin the planning helpers and drive the real element classes against a tiny fake DOM.
// hq-v3.js is a classic browser script (an IIFE); we run it in a vm sandbox and catch its pure helpers through
// window.__HQ_TEST_HOOK__ and its element classes through a capturing customElements.define.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('./hq-v3.js', import.meta.url), 'utf8');
const plain = (o) => JSON.parse(JSON.stringify(o));   // sandbox objects have another realm's prototypes

// ---- fake DOM: just what hq-lines / hq-type touch ----
class FakeNode {
  constructor(tag) { this.localName = tag; this.style = {}; this.childNodes = []; this.parentNode = null; this.own = ''; this.anims = []; }
  get textContent() { return this.childNodes.length ? this.childNodes.map((c) => c.textContent).join('') : this.own; }
  set textContent(v) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; this.own = String(v); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  appendChild(n) { if (n.parentNode) n.remove(); n.parentNode = this; this.childNodes.push(n); return n; }
  append(...ns) { ns.forEach((n) => this.appendChild(n)); }
  remove() { const p = this.parentNode; if (p) { p.childNodes.splice(p.childNodes.indexOf(this), 1); this.parentNode = null; } }
  animate(keyframes, opts) { this.anims.push(opts); return { cancel() {} }; }
}
class FakeHTMLElement {
  constructor() { this.attrs = new Map(); this.style = {}; this.isConnected = false; this.shadowRoot = null; }
  attachShadow() { return (this.shadowRoot = new FakeNode('#shadow-root')); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  hasAttribute(n) { return this.attrs.has(n); }
  // like a browser: attributeChangedCallback for observed names, connected or not
  setAttribute(n, v) { const o = this.getAttribute(n); this.attrs.set(n, String(v)); this.changed(n, o, String(v)); }
  removeAttribute(n) { const o = this.getAttribute(n); this.attrs.delete(n); this.changed(n, o, null); }
  changed(n, o, v) { if ((this.constructor.observedAttributes || []).includes(n) && this.attributeChangedCallback) this.attributeChangedCallback(n, o, v); }
  connect() { this.isConnected = true; if (this.connectedCallback) this.connectedCallback(); return this; }
  disconnect() { this.isConnected = false; if (this.disconnectedCallback) this.disconnectedCallback(); return this; }
}

// fake clock: timers run only when the test advances time
function makeClock() {
  let now = 0, seq = 0; const timers = new Map();
  const add = (fn, ms, every) => { const id = ++seq; timers.set(id, { fn, at: now + Math.max(1, +ms || 0), every: every ? Math.max(1, +ms || 0) : 0 }); return id; };
  return {
    timers,
    setInterval: (fn, ms) => add(fn, ms, true), setTimeout: (fn, ms) => add(fn, ms, false),
    clear: (id) => { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        const [id, t] = next; now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        t.fn();
      }
      now = end;
    },
  };
}

function load({ reduced = false } = {}) {
  const defined = new Map(), clock = makeClock(); let hook = null;
  const sb = {
    matchMedia: () => ({ matches: reduced }),
    customElements: { get: (n) => defined.get(n), define: (n, c) => { defined.set(n, c); } },
    HTMLElement: FakeHTMLElement,
    MutationObserver: class { observe() {} disconnect() {} },
    addEventListener() {}, removeEventListener() {},
    document: { documentElement: { dataset: {} }, body: null, createElement: (tag) => new FakeNode(tag), querySelector: () => null },
    setInterval: clock.setInterval, clearInterval: clock.clear, setTimeout: clock.setTimeout, clearTimeout: clock.clear,
    __HQ_TEST_HOOK__: (h) => { hook = h; },
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(SRC, sb, { filename: 'hq-v3.js' });
  const make = (name, attrs = {}) => { const el = new (defined.get(name))(); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  return { hook, defined, clock, make };
}

const H = load().hook;
const lines = (el) => el.shadowRoot.childNodes.map((d) => d.textContent);
const anims = (el) => el.shadowRoot.childNodes.reduce((n, d) => n + d.anims.length, 0);

// ---------------------------------------------------------------- loading
test('the script loads in the sandbox: hook fires, every element is defined', () => {
  const { hook, defined } = load();
  assert.ok(hook, 'test hook called');
  for (const n of ['hq-ascii-bg', 'hq-ember', 'hq-prompt', 'hq-clock', 'hq-type', 'hq-scramble', 'hq-roll', 'hq-spin', 'hq-lines', 'hq-icon']) assert.ok(defined.has(n), n);
});

// ---------------------------------------------------------------- linesPlan
test('linesPlan: nothing rendered yet → reset', () => {
  assert.deepEqual(plain(H.linesPlan(null, 'a\nb')), { reset: true, drop: 0, startIndex: 0, replaceLast: false });
  assert.deepEqual(plain(H.linesPlan(undefined, '')), { reset: true, drop: 0, startIndex: 0, replaceLast: false });
});

test('linesPlan: same text → no-op', () => {
  assert.deepEqual(plain(H.linesPlan('a\nb', 'a\nb')), { reset: false, drop: 0, startIndex: 2, replaceLast: false });
});

test('linesPlan: appended whole lines → append only the new ones', () => {
  assert.deepEqual(plain(H.linesPlan('a\nb', 'a\nb\nc\nd')), { reset: false, drop: 0, startIndex: 2, replaceLast: false });
});

test('linesPlan: a chunk that ends mid-line grows the last line in place', () => {
  assert.deepEqual(plain(H.linesPlan('a\nb', 'a\nbc')), { reset: false, drop: 0, startIndex: 2, replaceLast: true });
  assert.deepEqual(plain(H.linesPlan('a\nb', 'a\nbc\nd')), { reset: false, drop: 0, startIndex: 2, replaceLast: true });
  // trailing newline: the empty last line fills in
  assert.deepEqual(plain(H.linesPlan('a\n', 'a\n+b\nc')), { reset: false, drop: 0, startIndex: 2, replaceLast: true });
});

test('linesPlan: replaced with the same number of lines → reset (the old count-based bug)', () => {
  assert.equal(H.linesPlan('Reading git status…', 'M src/app.js | 4 ++--').reset, true);
  assert.equal(H.linesPlan('a\nb\nc', 'x\ny\nz').reset, true);
});

test('linesPlan: shrink → reset', () => {
  assert.equal(H.linesPlan('a\nb\nc', 'a\nb').reset, true);
  assert.equal(H.linesPlan('abc', 'ab').reset, true);
});

test('linesPlan: empty text on either side', () => {
  // '' renders one empty line; anything continues it
  assert.deepEqual(plain(H.linesPlan('', 'a\nb')), { reset: false, drop: 0, startIndex: 1, replaceLast: true });
  assert.deepEqual(plain(H.linesPlan('', '')), { reset: false, drop: 0, startIndex: 1, replaceLast: false });
  assert.equal(H.linesPlan('a\nb', '').reset, true);
  assert.deepEqual(plain(H.linesPlan(null, null)), { reset: true, drop: 0, startIndex: 0, replaceLast: false });
});

test('linesPlan: a scrolled rolling window drops lines off the top and appends', () => {
  const L = Array.from({ length: 61 }, (_, i) => 'line ' + i);
  const a = L.slice(0, 60).join('\n'), b = L.slice(1, 61).join('\n');
  assert.deepEqual(plain(H.linesPlan(a, b)), { reset: false, drop: 1, startIndex: 59, replaceLast: false });
  // scrolled by three, last kept line grew mid-chunk
  const c = L.slice(0, 10).join('\n'), d = [...L.slice(3, 9), L[9] + ' more', 'x', 'y', 'z'].join('\n');
  assert.deepEqual(plain(H.linesPlan(c, d)), { reset: false, drop: 3, startIndex: 7, replaceLast: true });
});

test('linesPlan: no rolling match from a single shared line or blank lines only', () => {
  assert.equal(H.linesPlan('a\nb\nshared', 'shared\nq').reset, true);   // one surviving line is not a window
  assert.equal(H.linesPlan('a\n\n\n', '\n\n\nz').reset, true);         // blanks only
});

// The invariant that matters: whatever the plan, applying it to what was on screen yields exactly the new lines.
test('linesPlan: applying any plan to the old lines yields exactly the new lines (randomized)', () => {
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const word = () => ['', '+add', '-del', '@@ h', 'ok', 'ok', '✗ fail', 'x'][rnd(8)];
  let prev = null;
  for (let step = 0; step < 3000; step++) {
    const pl = prev == null ? [] : prev.split('\n'); let next;
    switch (rnd(5)) {
      case 0: next = (prev ?? '') + (rnd(2) ? '\n' : '') + word(); break;                  // append / grow
      case 1: next = pl.slice(rnd(3)).join('\n') + '\n' + word(); break;                   // roll
      case 2: next = Array.from({ length: rnd(6) }, word).join('\n'); break;               // replace
      case 3: next = (prev ?? '').slice(0, rnd((prev ?? '').length + 1)); break;           // shrink
      default: next = Array.from({ length: 1 + rnd(4) }, () => 'r' + rnd(3)).join('\n');  // repeats
    }
    const p = H.linesPlan(prev, next), nl = next.split('\n');
    const screen = p.reset ? [] : pl.slice(p.drop);
    if (!p.reset) {
      assert.equal(screen.length, p.startIndex, 'kept lines line up with startIndex');
      for (let j = 0; j < screen.length - 1; j++) assert.equal(screen[j], nl[j], 'kept lines are unchanged');
      if (p.replaceLast) screen[p.startIndex - 1] = nl[p.startIndex - 1];
      else if (screen.length) assert.equal(screen[screen.length - 1], nl[screen.length - 1]);
    }
    for (let i = p.startIndex; i < nl.length; i++) screen.push(nl[i]);
    assert.deepEqual(screen, nl, `step ${step}: ${JSON.stringify(prev)} → ${JSON.stringify(next)}`);
    prev = next;
  }
});

test('lineColor: + green, - and ✗ red, @@ blue, others plain', () => {
  assert.equal(H.lineColor('+ added'), 'var(--green)');
  assert.equal(H.lineColor('- removed'), 'var(--red)');
  assert.equal(H.lineColor('✗ failed'), 'var(--red)');
  assert.equal(H.lineColor('@@ -1,2 +1,3 @@'), 'var(--blue)');
  assert.equal(H.lineColor('plain'), '');
  assert.equal(H.lineColor(''), '');
});

// ---------------------------------------------------------------- <hq-lines> element
test('<hq-lines>: append keeps the existing nodes and animates only the new line', () => {
  const { make } = load();
  const el = make('hq-lines', { text: 'a\n+b' }).connect();
  assert.deepEqual(lines(el), ['a', '+b']);
  assert.equal(el.shadowRoot.childNodes[1].style.color, 'var(--green)');
  assert.equal(anims(el), 2);
  const [n0, n1] = el.shadowRoot.childNodes;
  el.setAttribute('text', 'a\n+b\n-c');
  assert.deepEqual(lines(el), ['a', '+b', '-c']);
  assert.equal(el.shadowRoot.childNodes[0], n0); assert.equal(el.shadowRoot.childNodes[1], n1);
  assert.equal(el.shadowRoot.childNodes[2].style.color, 'var(--red)');
  assert.equal(anims(el), 3);
});

test('<hq-lines>: a grown last line is re-rendered in place, re-coloured, not re-animated', () => {
  const { make } = load();
  const el = make('hq-lines', { text: 'a\nb' }).connect();
  const n1 = el.shadowRoot.childNodes[1];
  el.setAttribute('text', 'a\nbc');
  assert.deepEqual(lines(el), ['a', 'bc']);
  assert.equal(el.shadowRoot.childNodes[1], n1);
  assert.equal(anims(el), 2);
  // empty last line (trailing newline) that fills in counts as new: coloured and animated
  el.setAttribute('text', 'a\nbc\n');
  const blank = el.shadowRoot.childNodes[2], had = blank.anims.length;
  el.setAttribute('text', 'a\nbc\n+d');
  assert.deepEqual(lines(el), ['a', 'bc', '+d']);
  assert.equal(el.shadowRoot.childNodes[2], blank);
  assert.equal(blank.style.color, 'var(--green)');
  assert.equal(blank.anims.length - had, 1);
});

test('<hq-lines>: same line count, different text → shows the new text (Reading… → diff, session switch)', () => {
  const { make } = load();
  const el = make('hq-lines', { text: 'Reading git status…' }).connect();
  el.setAttribute('text', '+ new file (untracked)');
  assert.deepEqual(lines(el), ['+ new file (untracked)']);
  assert.equal(el.shadowRoot.childNodes[0].style.color, 'var(--green)');
  el.setAttribute('text', 'session A 1\nsession A 2');
  el.setAttribute('text', 'session B 1\nsession B 2');
  assert.deepEqual(lines(el), ['session B 1', 'session B 2']);
});

test('<hq-lines>: shrink and empty', () => {
  const { make } = load();
  const el = make('hq-lines', { text: 'a\nb\nc' }).connect();
  el.setAttribute('text', 'a');
  assert.deepEqual(lines(el), ['a']);
  el.setAttribute('text', '');
  assert.deepEqual(lines(el), ['']);
  el.removeAttribute('text');
  assert.deepEqual(lines(el), ['']);
});

test('<hq-lines>: a 60-line rolling window scrolls without re-animating the kept lines', () => {
  const { make } = load();
  const L = Array.from({ length: 70 }, (_, i) => 'out ' + i);
  const el = make('hq-lines', { text: L.slice(0, 60).join('\n') }).connect();
  const kept = el.shadowRoot.childNodes.slice(1);
  const before = anims(el);
  el.setAttribute('text', L.slice(1, 61).join('\n'));
  assert.deepEqual(lines(el), L.slice(1, 61));
  kept.forEach((n, i) => assert.equal(el.shadowRoot.childNodes[i], n));
  assert.equal(anims(el) - kept.reduce((s, n) => s + n.anims.length, 0), 1, 'one new animation, on the new line');
  assert.ok(before >= 60);
  el.setAttribute('text', L.slice(10, 70).join('\n'));
  assert.deepEqual(lines(el), L.slice(10, 70));
});

test('<hq-lines>: a disconnect/reconnect does not duplicate lines', () => {
  const { make } = load();
  const el = make('hq-lines', { text: 'a\nb' }).connect();
  el.disconnect(); el.connect();
  assert.deepEqual(lines(el), ['a', 'b']);
  assert.equal(anims(el), 2);
});

test('<hq-lines>: entrance stagger is capped for long resets', () => {
  const { make } = load();
  const el = make('hq-lines', { text: Array.from({ length: 100 }, (_, i) => 'l' + i).join('\n') }).connect();
  const delays = el.shadowRoot.childNodes.map((d) => d.anims[0].delay);
  assert.equal(Math.max(...delays), 20 * 55);
  assert.equal(delays[0], 0); assert.equal(delays[3], 3 * 55);
});

test('<hq-lines>: reduced motion renders with no animation', () => {
  const { make } = load({ reduced: true });
  const el = make('hq-lines', { text: 'a\nb' }).connect();
  el.setAttribute('text', 'a\nb\nc');
  assert.deepEqual(lines(el), ['a', 'b', 'c']);
  assert.equal(anims(el), 0);
});

// ---------------------------------------------------------------- typePlan
test('typePlan: continue when the new text extends what is shown', () => {
  assert.deepEqual(plain(H.typePlan('Hel', 'Hello world')), { keep: 3, instant: false });
  assert.deepEqual(plain(H.typePlan('Hello', 'Hello')), { keep: 5, instant: false });
});

test('typePlan: restart when the new text does not continue the shown text', () => {
  assert.deepEqual(plain(H.typePlan('Good morning', 'Good evening')), { keep: 0, instant: false });
  assert.deepEqual(plain(H.typePlan('Hello world', 'Help')), { keep: 0, instant: false });   // shrank to something else
  assert.deepEqual(plain(H.typePlan('', 'abc')), { keep: 0, instant: false });
  assert.deepEqual(plain(H.typePlan(null, undefined)), { keep: 0, instant: false });
});

// Regression (review): app.js streams the raw answer, then sets the trimmed final text; a final that is a
// prefix of what's shown used to plan keep:0 and blank + retype the whole answer.
test('typePlan: a new text that is a prefix of the shown text is cut back to, not retyped', () => {
  assert.deepEqual(plain(H.typePlan('Hello world', 'Hello')), { keep: 5, instant: false });
  assert.deepEqual(plain(H.typePlan('The answer.\n', 'The answer.')), { keep: 11, instant: false });
  assert.deepEqual(plain(H.typePlan('abc', '')), { keep: 0, instant: false });
});

test('typePlan: stream or reduced motion → instant', () => {
  assert.deepEqual(plain(H.typePlan('Hel', 'Hello', { stream: true })), { keep: 3, instant: true });
  assert.deepEqual(plain(H.typePlan('abc', 'xyz', { reduced: true })), { keep: 0, instant: true });
});

test('typeStep: never splits a surrogate pair', () => {
  const t = 'a😀b';
  assert.equal(H.typeStep(t, 0), 1);
  assert.equal(H.typeStep(t, 1), 3);   // whole emoji
  assert.equal(H.typeStep(t, 3), 4);
  assert.equal(H.typeStep(t, 4), 4);
});

// ---------------------------------------------------------------- <hq-type> element
const shown = (el) => el.shadowRoot.childNodes[0].textContent;
const cursor = (el) => el.shadowRoot.childNodes[1];

test('<hq-type>: types out, then continues from the shown prefix when the text grows', () => {
  const { make, clock } = load();
  const el = make('hq-type', { text: 'Hello' }).connect();
  assert.equal(shown(el), '');
  clock.advance(28 * 2);
  assert.equal(shown(el), 'He');
  el.setAttribute('text', 'Hello world');
  assert.equal(shown(el), 'He', 'kept, not restarted');
  clock.advance(28);
  assert.equal(shown(el), 'Hel');
  clock.advance(28 * 20);
  assert.equal(shown(el), 'Hello world');
});

test('<hq-type>: a streaming answer (text grows every 40 ms) visibly progresses', () => {
  const { make, clock } = load();
  const full = 'The quick brown fox jumps over the lazy dog. '.repeat(3);
  const el = make('hq-type', { text: '', speed: '12' }).connect();
  let last = 0, elapsed = 0;
  for (let n = 4; n <= full.length; n += 4) {
    el.setAttribute('text', full.slice(0, n));
    clock.advance(40); elapsed += 40;
    const len = shown(el).length;
    assert.ok(len >= last, 'never goes backwards');
    assert.equal(full.slice(0, len), shown(el));
    last = len;
  }
  // one char per 12 ms the whole time: updates don't reset the interval (the old element never got past ~3 chars)
  assert.ok(last >= Math.floor(elapsed / 12) - 2, `typed ${last} chars in ${elapsed} ms`);
  el.setAttribute('text', full);   // the final chunk
  clock.advance(1000);
  assert.equal(shown(el), full);
});

test('<hq-type>: unrelated new text retypes from 0', () => {
  const { make, clock } = load();
  const el = make('hq-type', { text: 'Good morning' }).connect();
  clock.advance(28 * 20);
  assert.equal(shown(el), 'Good morning');
  el.setAttribute('text', 'Good evening');
  assert.equal(shown(el), '');
  clock.advance(28);
  assert.equal(shown(el), 'G');
  clock.advance(28 * 20);
  assert.equal(shown(el), 'Good evening');
});

test('<hq-type stream>: renders the full text at once and keeps the cursor', () => {
  const { make, clock } = load();
  const el = make('hq-type', { text: '', stream: '', 'hide-cursor': '' }).connect();
  el.setAttribute('text', 'Partial ans');
  assert.equal(shown(el), 'Partial ans');
  el.setAttribute('text', 'Partial answer, more');
  assert.equal(shown(el), 'Partial answer, more');
  clock.advance(5000);
  assert.notEqual(cursor(el).style.display, 'none', 'cursor stays while streaming even with hide-cursor');
  assert.equal(el.shadowRoot.childNodes.length, 2);
  // stream ends: hide-cursor applies
  el.removeAttribute('stream');
  assert.equal(shown(el), 'Partial answer, more');
  clock.advance(1300);
  assert.equal(cursor(el).style.display, 'none');
});

// Regression (review): the streamed text keeps the model's trailing newline, the final answer is trimmed.
test('<hq-type>: stream ends on a trimmed final answer → cut back in place, never blanked and retyped', () => {
  const { make, clock } = load();
  const el = make('hq-type', { text: '', stream: '', speed: '12', 'hide-cursor': '' }).connect();
  el.setAttribute('text', 'The answer is 42.\n');
  assert.equal(shown(el), 'The answer is 42.\n');
  el.removeAttribute('stream');
  el.setAttribute('text', 'The answer is 42.');
  assert.equal(shown(el), 'The answer is 42.', 'not blanked');
  clock.advance(12);
  assert.equal(shown(el), 'The answer is 42.', 'not retyping');
  clock.advance(1300);
  assert.equal(cursor(el).style.display, 'none', 'finished: hide-cursor applies');
  // typed (not streamed) out to the full raw text, then trimmed: same, no retype
  const t = make('hq-type', { text: 'Done.\n' }).connect();
  clock.advance(28 * 10);
  assert.equal(shown(t), 'Done.\n');
  t.setAttribute('text', 'Done.');
  assert.equal(shown(t), 'Done.');
});

test('<hq-type stream="false">: treated as not streaming (dc runtime writes booleans as strings)', () => {
  const { make, clock } = load();
  const el = make('hq-type', { text: 'abc', stream: 'false' }).connect();
  assert.equal(shown(el), '');
  clock.advance(28 * 3);
  assert.equal(shown(el), 'abc');
});

test('<hq-type hide-cursor>: a pending hide is cancelled when typing resumes', () => {
  const { make, clock } = load();
  const el = make('hq-type', { text: 'ab', 'hide-cursor': '' }).connect();
  clock.advance(28 * 2);
  assert.equal(shown(el), 'ab');
  clock.advance(1000);                          // hide is due at +1200
  el.setAttribute('text', 'abcdefghijklmnop');
  clock.advance(300);
  assert.notEqual(cursor(el).style.display, 'none', 'still typing, cursor visible');
  clock.advance(28 * 20 + 1300);
  assert.equal(shown(el), 'abcdefghijklmnop');
  assert.equal(cursor(el).style.display, 'none');
  el.setAttribute('text', 'abcdefghijklmnopq');   // grows again: cursor comes back while it types
  assert.notEqual(cursor(el).style.display, 'none');
});

test('<hq-type>: reduced motion shows the full text at once', () => {
  const { make } = load({ reduced: true });
  const el = make('hq-type', { text: 'Hello' }).connect();
  assert.equal(shown(el), 'Hello');
  el.setAttribute('text', 'Bye');
  assert.equal(shown(el), 'Bye');
});

test('<hq-type>: disconnect stops its timers; reconnect resumes where it was', () => {
  const { make, clock } = load();
  const base = clock.timers.size;   // the IIFE's own idle-flourish interval
  const el = make('hq-type', { text: 'abcdef', 'hide-cursor': '' }).connect();
  clock.advance(28 * 2);
  el.disconnect();
  assert.equal(clock.timers.size, base);
  el.connect();
  assert.equal(shown(el), 'ab');
  clock.advance(28 * 4);
  assert.equal(shown(el), 'abcdef');
  assert.equal(el.shadowRoot.childNodes.length, 2, 'spans built once');
});

// ---------------------------------------------------------------- <hq-ascii-bg> labels
test('hq-ascii-bg frame labels are neutral: no numbers, nothing that reads like telemetry', () => {
  assert.ok(H.BG_LABELS.length > 0);
  for (const l of H.BG_LABELS) {
    assert.doesNotMatch(l, /\d/, l);
    assert.doesNotMatch(l, /stable|nominal|repos?|pod|mem|scan|git|node|ok|online|healthy|%/i, l);
  }
  assert.doesNotMatch(SRC, /node\.a · stable|git\.mon · 8 repos|mem · nominal|pod\.042/);
});
