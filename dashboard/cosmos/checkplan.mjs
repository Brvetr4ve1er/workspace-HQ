/* Cosmos space — the verdict logic of the Electron-run native check (dashboard/cosmos/checkplan.mjs).
   Pure: no IO, no clock, no electron. dashboard/cosmos-native.check.js does the running (it needs a real
   Electron); every decision about WHAT counts as a pass, a skip, a "not covered" or a failure, and what
   exit code that makes, lives here so plain Node tests pin it.

   Verdicts
     passed        the case ran and the answer was right
     failed        the case ran and the answer was wrong (a blue-shifted colour, a tainted canvas, a stalled loop)
     skipped       this machine cannot do the step the case needs (e.g. Chromium cannot encode WebP);
                   the app is not at fault and the check says so out loud
     not-covered   the case could not be exercised (no AVIF encoder offline; best-effort video capture)

   Exit codes copy dashboard-v5/dev-main.js (finish()): 0 clean, 1 a check failed, 2 timed out. */

export const TOLERANCE = 12;            // per channel, mean RGB of the 32x32 grid vs the colour that went in
export const LOOP_LIMIT_MS = 750;       // the longest the main loop may stall while thumbnailing
export const TIMEOUT_MS = 60000;
export const EXIT = Object.freeze({ OK: 0, FAILED: 1, TIMED_OUT: 2 });
export const VERDICTS = Object.freeze({ PASSED: 'passed', FAILED: 'failed', SKIPPED: 'skipped', NOT_COVERED: 'not-covered' });

export const RED = Object.freeze({ r: 255, g: 0, b: 0 });
export const GREEN = Object.freeze({ r: 0, g: 255, b: 0 });
export const BLUE = Object.freeze({ r: 0, g: 0, b: 255 });
export const ORANGE = Object.freeze({ r: 255, g: 128, b: 0 });
export const TEAL = Object.freeze({ r: 0, g: 128, b: 128 });

const clamp8 = (n) => Math.max(0, Math.min(255, Math.round(n)));

export function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(String(hex));
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

export function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => clamp8(v).toString(16).padStart(2, '0')).join('');
}

/** Mean R, G, B over every pixel of an {width,height,data:RGBA} grid; null when empty. Alpha is ignored. */
export function meanRgb(rgba32) {
  const d = rgba32 && rgba32.data;
  if (!d || d.length < 4) return null;
  const n = Math.floor(d.length / 4);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < n; i++) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; }
  return { r: r / n, g: g / n, b: b / n };
}

/** True when every channel of `actual` is within `tol` of `expected`. */
export function withinTolerance(actual, expected, tol = TOLERANCE) {
  if (!actual || !expected) return false;
  return ['r', 'g', 'b'].every((k) => Number.isFinite(actual[k]) && Math.abs(actual[k] - expected[k]) <= tol);
}

/** {ok, mean, expected, maxDiff} for a thumbnail's rgba32 grid against the colour that went in. */
export function compareColour(rgba32, expected, tol = TOLERANCE) {
  const mean = meanRgb(rgba32);
  if (!mean) return { ok: false, mean: null, expected, maxDiff: Infinity };
  const maxDiff = Math.max(Math.abs(mean.r - expected.r), Math.abs(mean.g - expected.g), Math.abs(mean.b - expected.b));
  return { ok: withinTolerance(mean, expected, tol), mean, expected, maxDiff };
}

/* ---------- the case list ---------- */

const STRATEGY_LABEL = { shell: 'shell', 'native-file': 'native file', chromium: 'chromium' };

function colourCase(id, title, file, expected, strategy, extra = {}) {
  return {
    id, title, group: 'colour', file, strategy, expected, tol: TOLERANCE,
    // the shell provider depends on this machine's Windows setup: no answer from it is "skipped", not a failure
    onNoOutput: strategy === 'shell' ? 'skip' : 'fail',
    ...extra,
  };
}

/**
 * The cases, as data. `file` says what the runner builds: {kind:'png'|'jpeg'|'bmp'|'svg'|'webp'|'avif'|'webm', ...}.
 * opts.avifFile: a tiny fixture the owner supplies (--avif=<file>); without it the AVIF case is "not covered".
 * opts.hasExtractor: dashboard/cosmos/colorextract.mjs exists, so its answer is checked too.
 */
export function buildCases({ avifFile = null, hasExtractor = false } = {}) {
  const cases = [];
  for (const s of ['shell', 'native-file', 'chromium']) {
    cases.push(colourCase(`png-red:${s}`, `solid red PNG through ${STRATEGY_LABEL[s]}`, { kind: 'png', color: RED }, RED, s));
  }
  if (hasExtractor) {
    cases.push({
      id: 'extract:png-red', title: 'extractColors on the red PNG thumbnail', group: 'colour', file: { kind: 'png', color: RED },
      strategy: 'native-file', expected: RED, tol: 40, onNoOutput: 'fail', viaExtractor: true,
    });
  }
  for (const [name, color] of [['jpeg-green', GREEN], ['jpeg-blue', BLUE]]) {
    for (const s of ['shell', 'native-file', 'chromium']) {
      cases.push(colourCase(`${name}:${s}`, `${name.replace('-', ' ')} JPEG through ${STRATEGY_LABEL[s]}`, { kind: 'jpeg', color }, color, s));
    }
  }
  for (const s of ['chromium']) {   // nativeImage cannot decode BMP (seen in a real run): planFor never sends one to native-file
    cases.push(colourCase(`bmp-orange:${s}`, `orange BMP through ${STRATEGY_LABEL[s]}`, { kind: 'bmp', color: ORANGE }, ORANGE, s));
  }
  cases.push(colourCase('svg-teal:chromium', 'teal SVG through chromium (a tainted canvas fails)', { kind: 'svg', color: TEAL }, TEAL, 'chromium', { taintFails: true }));
  cases.push(colourCase('order:shell-rejected', 'teal SVG still thumbnails when the shell rejects', { kind: 'svg', color: TEAL }, TEAL, 'default', { shellRejects: true }));
  cases.push(colourCase('webp-green:chromium', 'WebP made in the decode window', { kind: 'webp', color: GREEN }, GREEN, 'chromium', { tol: 24, onUnsupported: 'skipped' }));
  if (avifFile) {
    cases.push({ id: 'avif:supplied', title: 'supplied AVIF decodes', group: 'colour', file: { kind: 'avif', path: avifFile }, strategy: 'chromium', expected: null, onNoOutput: 'fail' });
  } else {
    cases.push({ id: 'avif:none', title: 'AVIF', group: 'static', staticVerdict: VERDICTS.NOT_COVERED, note: 'no encoder available offline' });
  }
  cases.push({ id: 'network:blocked', title: 'the decode window cannot reach the network', group: 'network' });
  cases.push({
    id: 'video:webm', title: 'webm recorded in the decode window', group: 'colour', file: { kind: 'webm', color: GREEN },
    strategy: 'chromium-video', expected: GREEN, tol: 40, neverFail: true, onUnsupported: 'not-covered', onNoOutput: 'not-covered',
  });
  cases.push({ id: 'loop:20x2000', title: '20 PNGs of 2000x2000 never block the main loop', group: 'loop', count: 20, edge: 2000 });
  return cases;
}

/* ---------- verdicts ---------- */

const NAMES = new Set(Object.values(VERDICTS));

function verdictOf(name, note) {
  const verdict = NAMES.has(name) ? name : VERDICTS.FAILED;
  return note ? { verdict, note } : { verdict };
}

/**
 * Turn what the runner saw into a verdict. Observation fields (all optional):
 *   unsupported  the machine cannot do a step the case needs (no WebP encoder, hidden-window capture empty)
 *   tainted      the decode window's canvas threw a SecurityError
 *   error        the case itself blew up (a message, never a path)
 *   produced     a thumbnail came back (JPEG + 32x32 grid)
 *   rgba32       the grid, for the colour compare
 *   pageError / cancelCounted   (network case) the page's request failed / the request handler counted a cancel
 *   maxGapMs     (loop case) the longest main-loop gap
 * Order of the rules is the contract.
 */
export function classify(def, obs = {}) {
  if (def.staticVerdict) return verdictOf(def.staticVerdict, def.note);
  const soft = def.neverFail ? VERDICTS.NOT_COVERED : VERDICTS.FAILED;
  if (obs.unsupported) {
    const v = def.onUnsupported === 'skipped' ? VERDICTS.SKIPPED : def.onUnsupported === 'not-covered' ? VERDICTS.NOT_COVERED : VERDICTS.FAILED;
    return verdictOf(v, obs.note || 'not supported on this machine');
  }
  if (obs.tainted) return verdictOf(def.neverFail ? VERDICTS.NOT_COVERED : VERDICTS.FAILED, 'canvas tainted: the image was drawn from a file: URL, not a data: URL');
  if (obs.error) return verdictOf(soft, String(obs.error).slice(0, 200));
  if (def.group === 'network') {
    if (!obs.pageError) return verdictOf(VERDICTS.FAILED, 'the page reached the network');
    if (!obs.cancelCounted) return verdictOf(VERDICTS.FAILED, 'the request handler did not count a cancel');
    return verdictOf(VERDICTS.PASSED);
  }
  if (def.group === 'loop') {
    if (!Number.isFinite(obs.maxGapMs)) return verdictOf(VERDICTS.FAILED, 'no loop measurement');
    return obs.maxGapMs > LOOP_LIMIT_MS
      ? verdictOf(VERDICTS.FAILED, `longest main-loop gap ${Math.round(obs.maxGapMs)} ms is over ${LOOP_LIMIT_MS} ms`)
      : verdictOf(VERDICTS.PASSED, `longest main-loop gap ${Math.round(obs.maxGapMs)} ms`);
  }
  if (!obs.produced) {
    const v = def.onNoOutput === 'skip' ? VERDICTS.SKIPPED : def.onNoOutput === 'not-covered' ? VERDICTS.NOT_COVERED : VERDICTS.FAILED;
    return verdictOf(v, 'no thumbnail came back');
  }
  if (def.expected) {
    const c = compareColour(obs.rgba32, def.expected, def.tol ?? TOLERANCE);
    if (!c.ok) {
      const got = c.mean ? rgbToHex(c.mean) : 'nothing';
      return verdictOf(soft, `colour ${got}, wanted ${rgbToHex(def.expected)} (off by up to ${Math.round(c.maxDiff)})`);
    }
  }
  return verdictOf(VERDICTS.PASSED);
}

/** 0 clean, 1 a check failed (or nothing ran), 2 timed out. */
export function exitCodeFor(results, { timedOut = false } = {}) {
  if (timedOut) return EXIT.TIMED_OUT;
  if (!Array.isArray(results) || results.length === 0) return EXIT.FAILED;
  return results.some((r) => r && r.verdict === VERDICTS.FAILED) ? EXIT.FAILED : EXIT.OK;
}

export function summarize(results) {
  const out = { passed: 0, failed: 0, skipped: 0, 'not-covered': 0 };
  for (const r of results || []) if (r && NAMES.has(r.verdict)) out[r.verdict]++;
  return out;
}

/** One printable line per case. Case ids and notes are invented/technical text, never a path. */
export function formatCaseLine(def, res) {
  const tag = res.verdict === VERDICTS.NOT_COVERED ? 'not covered' : res.verdict;
  return `${def.id} ${tag}${res.note ? ': ' + res.note : ''}`;
}

export function finalLine(results, { timedOut = false } = {}) {
  const s = summarize(results);
  const code = exitCodeFor(results, { timedOut });
  const word = timedOut ? 'TIMED OUT' : code === EXIT.OK ? 'PASS' : 'FAIL';
  return `${word} - ${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped, ${s['not-covered']} not covered`;
}

/**
 * The --dry-run report: `ext ok failed` per extension plus a total. Nothing else. Keys that do not look like a
 * bare extension (anything with a separator, a dot inside, or more than 8 characters) are folded into "other",
 * so a file name or a path can never reach the output even if it were passed in by mistake.
 */
export function formatDryRun(counts) {
  const merged = new Map();
  for (const [key, v] of Object.entries(counts || {})) {
    const e = String(key).toLowerCase().replace(/^\./, '');
    const name = /^[a-z0-9]{1,8}$/.test(e) ? e : 'other';
    const cur = merged.get(name) || { ok: 0, failed: 0 };
    const ok = Number.isFinite(v && v.ok) && v.ok > 0 ? Math.floor(v.ok) : 0;
    const failed = Number.isFinite(v && v.failed) && v.failed > 0 ? Math.floor(v.failed) : 0;
    merged.set(name, { ok: cur.ok + ok, failed: cur.failed + failed });
  }
  const lines = ['ext ok failed'];
  let ok = 0, failed = 0;
  for (const name of [...merged.keys()].sort()) {
    const c = merged.get(name);
    lines.push(`${name} ${c.ok} ${c.failed}`);
    ok += c.ok; failed += c.failed;
  }
  lines.push(`total ${ok} ${failed}`);
  return lines.join('\n');
}
