// Cheat codes: ONE small registry for the hidden-but-real unlocks (batch 7, "the console layer"). PURE: no DOM, no timers, no listeners, no
// storage. The host (logic/cheats-host.js) owns the one keydown listener and maps an effect id to an action; this file only
//   - lists the codes (CHEATS, frozen) and checks the list is sound (validateRegistry),
//   - matches typed keys against it (createMatcher: the strict path, createLegacyMatcher: the two eggs that already shipped),
//   - decides what a fired code does (runCheat) and what the Settings list says about them (foundSummary).
//
// Two matchers, two tails, never merged:
//   LEGACY  the two eggs Bit has had since the v2 renderer ('bit', and 'dance' or ArrowUp twice). Same semantics as the old block in
//           hq-fx.js: ONE string of the lower-cased e.key values concatenated, cut to its last N characters ('Shift' adds five of them),
//           match by endsWith, no timeout, no modifier check, skipped only when the target is an input or a textarea.
//           N is LEGACY_TAIL_CHARS = 14, not today's 12. FINDING: 'arrowuparrowup' is 14 characters, so a 12-character tail can never
//           end with it and the double ArrowUp has NEVER fired in the shipped app. 'bit' and 'dance' behave identically at 12 and at 14
//           (both are shorter than either); only the double ArrowUp changes (it now works, as the owner-facing line says it does).
//           createLegacyMatcher({ tail: 12 }) is today's exact behaviour, pinned by the tests.
//   STRICT  every new code: a 12-KEY tail (key names, not characters), a 3 s gap clears it, ctrl / meta / alt held clears it, a typing
//           target (isTypingTarget) clears it and never fires, a code fires once and the tail is cleared.
//
// The layer decides which codes are armed (armedFor): OFF arms exactly the legacy eggs plus the code that turns the layer on.

/** Last N key tokens the strict matcher remembers. Every strict code must fit (validateRegistry). */
export const STRICT_TAIL_KEYS = 12;
/** A gap longer than this between two keys empties the strict tail. */
export const STRICT_GAP_MS = 3000;
/** Characters of the legacy tail. 12 is what hq-fx.js had; 14 is the least that lets the double ArrowUp match (see the header). */
export const LEGACY_TAIL_CHARS = 14;
export const LEGACY_SHIPPED_TAIL_CHARS = 12;

const entry = (c) => Object.freeze({
  ...c,
  seq: Array.isArray(c.seq) ? Object.freeze(c.seq.slice()) : c.seq,
  alt: Object.freeze((c.alt || []).map((a) => Object.freeze(a.slice()))),
});

// seq is what is typed (a word) or pressed (a chord: key names). name is what the Settings list shows once the code is found: it never
// contains the sequence, so a found code does not hand the sequence to someone reading over a shoulder either.
export const CHEATS = Object.freeze([
  entry({ id: 'cartridge', name: 'Power on', kind: 'typed', seq: 'cartridge', legacy: false, worksWhenOff: true, effect: 'console-layer-on' }),
  entry({ id: 'plastic', name: 'Chunky skin', kind: 'typed', seq: 'plastic', legacy: false, worksWhenOff: false, effect: 'console-skin' }),
  entry({ id: 'ember', name: 'Warm accent', kind: 'typed', seq: 'ember', legacy: false, worksWhenOff: false, effect: 'palette-ember' }),
  entry({ id: 'tide', name: 'Cool accent', kind: 'typed', seq: 'tide', legacy: false, worksWhenOff: false, effect: 'palette-tide' }),
  entry({ id: 'timing', name: 'Stopwatch', kind: 'typed', seq: 'timing', legacy: false, worksWhenOff: false, effect: 'debug-overlay' }),
  entry({ id: 'bit', name: 'Hide and seek', kind: 'typed', seq: 'bit', legacy: true, worksWhenOff: true, effect: 'egg-bit' }),
  entry({ id: 'dance', name: 'Little jig', kind: 'typed', seq: 'dance', alt: [['ArrowUp', 'ArrowUp']], legacy: true, worksWhenOff: true, effect: 'egg-dance' }),
]);

const lowerKey = (k) => String(k == null ? '' : k).toLowerCase();

/** The key tokens a strict code needs at the end of the tail: one per character for a typed word, one per key name for a chord. */
export function tokensOf(code) {
  if (!code) return [];
  if (code.kind === 'chord') return (Array.isArray(code.seq) ? code.seq : []).map(lowerKey);
  return [...lowerKey(code.seq)];
}

/** The lower-cased strings a legacy code ends with: its word, and each alternative chord joined the way the old tail joined keys. */
export function legacyNeedles(code) {
  if (!code) return [];
  const own = code.kind === 'chord' ? (Array.isArray(code.seq) ? code.seq.map(lowerKey).join('') : '') : lowerKey(code.seq);
  const alts = (code.alt || []).map((a) => a.map(lowerKey).join(''));
  return [own, ...alts].filter(Boolean);
}

/** Problems with a code list, as plain sentences ([] = sound). The tests run it on CHEATS and on deliberately broken lists. */
export function validateRegistry(codes = CHEATS) {
  const out = [];
  const ids = new Set();
  const tokenLists = [];
  for (const c of codes) {
    if (!c || typeof c !== 'object') { out.push('an entry is not an object'); continue; }
    const where = c.id ? 'code ' + c.id : 'an entry without an id';
    if (!c.id || typeof c.id !== 'string') out.push(where + ': id missing');
    else if (ids.has(c.id)) out.push(where + ': duplicate id');
    ids.add(c.id);
    if (c.kind !== 'typed' && c.kind !== 'chord') out.push(where + ': kind must be typed or chord');
    if (typeof c.name !== 'string' || !c.name.trim()) out.push(where + ': name missing');
    if (typeof c.effect !== 'string' || !c.effect) out.push(where + ': effect missing');
    if (typeof c.legacy !== 'boolean' || typeof c.worksWhenOff !== 'boolean') out.push(where + ': legacy and worksWhenOff must be booleans');
    if (c.legacy === true && c.worksWhenOff !== true) out.push(where + ': a legacy code works when the layer is off');
    const toks = tokensOf(c);
    if (c.kind === 'typed' && (typeof c.seq !== 'string' || !/^[a-z0-9]+$/.test(c.seq))) out.push(where + ': a typed code is lower-case letters and digits');
    if (c.kind === 'chord' && !(Array.isArray(c.seq) && c.seq.length > 1)) out.push(where + ': a chord is a list of at least two key names');
    if (!toks.length) out.push(where + ': empty sequence');
    if (!c.legacy && toks.length > STRICT_TAIL_KEYS) out.push(where + ': longer than the ' + STRICT_TAIL_KEYS + '-key tail');
    tokenLists.push({ id: c.id, legacy: !!c.legacy, toks: toks.join('\u0001'), needles: legacyNeedles(c) });
    if (typeof c.name === 'string' && typeof c.seq === 'string' && c.name.toLowerCase().includes(c.seq.toLowerCase())) out.push(where + ': the name contains the sequence');
  }
  for (const a of tokenLists) {
    for (const b of tokenLists) {
      if (a === b || a.legacy !== b.legacy) continue;
      if (a.toks && a.toks === b.toks) out.push('codes ' + a.id + ' and ' + b.id + ': same sequence');
      else if (!a.legacy && a.toks && b.toks && b.toks.endsWith('\u0001' + a.toks)) out.push('code ' + a.id + ' is the end of ' + b.id + ' and would shadow it');
      else if (!a.legacy && a.toks && b.toks && b.toks.startsWith(a.toks + '\u0001')) out.push('code ' + a.id + ' is the start of ' + b.id + ' and would fire while it is typed');
      else if (a.legacy) for (const na of a.needles) for (const nb of b.needles) if (na !== nb && nb.endsWith(na)) out.push('legacy code ' + a.id + ' is the end of ' + b.id + ' and would shadow it');
    }
  }
  return out;
}

/** Is this element somewhere the owner is typing? input, textarea, select, any contenteditable, role=textbox (and anything inside one). */
export function isTypingTarget(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable === true) return true;
  const attr = (n) => { try { return typeof el.getAttribute === 'function' ? el.getAttribute(n) : null; } catch { return null; } };
  const ce = attr('contenteditable');
  if (ce != null && String(ce).toLowerCase() !== 'false') return true;
  if (String(attr('role') || '').toLowerCase() === 'textbox') return true;
  try {
    if (typeof el.closest === 'function' && el.closest('[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return true;
  } catch { /* a selector the engine refuses is "not typing" */ }
  return false;
}

/** Which codes are armed: with the layer on all of them, off only the legacy eggs and the ones marked worksWhenOff. Ids, registry order. */
export function armedIds(layerOn, codes = CHEATS) {
  return codes.filter((c) => layerOn || c.legacy || c.worksWhenOff).map((c) => c.id);
}

const endsWithTokens = (tail, toks) => toks.length > 0 && tail.length >= toks.length && toks.every((t, i) => tail[tail.length - toks.length + i] === t);

/**
 * The strict matcher (every non-legacy code).
 *   feed(keyOrEvent, target?, armed?) -> { id } | null
 *     keyOrEvent  a key name, or an event-like { key, ctrlKey, metaKey, altKey, target }
 *     target      the event target (defaults to the event's own); a typing target clears the tail and never fires
 *     armed       ids allowed to fire (array or Set); omitted = every strict code
 *   armedFor(layerOn) -> ids        (the whole list, legacy eggs included: this is what the layer switches)
 *   reset()
 */
export function createMatcher({ codes = CHEATS, now = Date.now } = {}) {
  const strict = codes.filter((c) => !c.legacy);
  let tail = [];
  let lastAt = null;
  const reset = () => { tail = []; lastAt = null; };
  function feed(input, target, armed) {
    const ev = input !== null && typeof input === 'object' ? input : { key: input };
    if (isTypingTarget(target !== undefined ? target : ev.target)) { reset(); return null; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) { reset(); return null; }
    const raw = String(ev.key == null ? '' : ev.key);
    if (raw === 'Shift' || raw === 'CapsLock') return null;   // part of typing a capital: neither a key of the code nor a break in it
    const t = Number(now());
    if (lastAt != null && Number.isFinite(t) && t - lastAt > STRICT_GAP_MS) tail = [];
    lastAt = Number.isFinite(t) ? t : lastAt;
    tail.push(lowerKey(raw));
    if (tail.length > STRICT_TAIL_KEYS) tail.shift();
    const allow = armed == null ? null : armed instanceof Set ? armed : new Set(armed);
    for (const c of strict) {
      if (allow && !allow.has(c.id)) continue;
      if (endsWithTokens(tail, tokensOf(c))) { reset(); return { id: c.id }; }
    }
    return null;
  }
  return { feed, reset, armedFor: (layerOn) => armedIds(!!layerOn, codes), tailKeys: () => tail.slice() };
}

/**
 * The legacy matcher (the legacy codes only): the old hq-fx.js semantics, see the header.
 *   feed(keyOrEvent, target?) -> { id } | null
 *   options: tail (characters kept, default LEGACY_TAIL_CHARS; pass LEGACY_SHIPPED_TAIL_CHARS for the 12 that shipped)
 */
export function createLegacyMatcher({ codes = CHEATS, tail = LEGACY_TAIL_CHARS } = {}) {
  const legacy = codes.filter((c) => c.legacy);
  let keys = '';
  function feed(input, target) {
    const ev = input !== null && typeof input === 'object' ? input : { key: input };
    const el = target !== undefined ? target : ev.target;
    const tg = String((el && el.tagName) || '').toLowerCase();
    if (tg === 'input' || tg === 'textarea') return null;   // skipped, tail untouched (as before)
    keys = (keys + lowerKey(ev.key)).slice(-tail);
    for (const c of legacy) if (legacyNeedles(c).some((n) => keys.endsWith(n))) return { id: c.id };
    return null;
  }
  return { feed, reset() { keys = ''; }, tailText: () => keys };
}

// ---- what a fired code does --------------------------------------------------------------------------------------

const PALETTES = Object.freeze({ 'palette-ember': 'ember', 'palette-tide': 'tide' });
const PALETTE_NAME = Object.freeze({ ember: 'Ember', tide: 'Tide' });
const NEEDS_LAYER = 'turn it on in Settings first';

/** Keep only ids the registry knows, once each, in the order given. Garbage in a saved pref is dropped, never thrown. */
export function normaliseFound(raw, codes = CHEATS) {
  const known = new Set(codes.map((c) => c.id));
  const out = [];
  for (const id of Array.isArray(raw) ? raw : []) if (typeof id === 'string' && known.has(id) && !out.includes(id)) out.push(id);
  return out;
}

/**
 * Decide what the code `id` does. state = { layerOn, skin, palette ('' | 'ember' | 'tide'), debug, found }.
 * Returns { ok, id, effect, patch, egg, toast, found, newlyFound }:
 *   patch   the consoleLayer fields to change ({} = none); the host merges it, the registry never touches state
 *   egg     'bit' | 'dance' when the legacy effect should run (HQFx.egg), else null
 *   toast   { kind, text } one honest line for every new code, null for the legacy eggs (Bit speaks for them)
 *   ok      false = the code was understood but could not apply (a toast says why); not recorded as found
 */
export function runCheat(id, state = {}, codes = CHEATS) {
  const c = codes.find((x) => x.id === id);
  const found = normaliseFound(state.found, codes);
  const none = { ok: false, id, effect: '', patch: {}, egg: null, toast: null, found, newlyFound: false };
  if (!c) return none;
  const layerOn = !!state.layerOn;
  const res = { ...none, effect: c.effect };
  const done = (patch, toast, egg) => {
    const newlyFound = !found.includes(c.id);
    return { ...res, ok: true, patch: patch || {}, toast: toast || null, egg: egg || null, found: newlyFound ? found.concat([c.id]) : found, newlyFound };
  };
  const blocked = (text) => ({ ...res, toast: { kind: 'info', text } });
  const info = (text) => ({ kind: 'info', text });

  if (c.effect === 'console-layer-on') return layerOn ? done({}, info('Console layer is already on')) : done({ on: true }, info('Console layer on'));
  if (c.effect === 'egg-bit') return done({}, null, 'bit');
  if (c.effect === 'egg-dance') return done({}, null, 'dance');
  if (!layerOn) return blocked(c.effect === 'console-skin' ? 'The Console skin needs the Console layer: ' + NEEDS_LAYER : 'That needs the Console layer: ' + NEEDS_LAYER);
  if (c.effect === 'console-skin') return state.skin ? done({}, info('Console skin is already on')) : done({ skin: true }, info('Console skin on'));
  if (PALETTES[c.effect]) {
    const p = PALETTES[c.effect];
    return state.palette === p ? done({ palette: '' }, info(PALETTE_NAME[p] + ' accent off')) : done({ palette: p }, info(PALETTE_NAME[p] + ' accent on'));
  }
  if (c.effect === 'debug-overlay') return state.debug ? done({ debug: false }, info('Timing overlay off')) : done({ debug: true }, info('Timing overlay on'));
  return none;   // an effect id this build does not know
}

/** The Settings list: how many are found and the NAME of each (a dash while undiscovered). Never a sequence, never an id. */
export function foundSummary(found, codes = CHEATS) {
  const got = new Set(normaliseFound(found, codes));
  const rows = codes.map((c) => (got.has(c.id) ? { label: c.name, found: true } : { label: '–', found: false }));
  const count = rows.filter((r) => r.found).length;
  const names = rows.filter((r) => r.found).map((r) => r.label);
  return {
    count, total: codes.length, title: 'Codes found: ' + count + ' of ' + codes.length, rows,
    sr: names.length ? 'Found so far: ' + names.join(', ') + '. ' + (codes.length - count) + ' not found yet.' : 'None found yet.',
  };
}
