// Cosmos space — the verdict logic of the Electron-run native check (dashboard/cosmos/checkplan.mjs).
// Placeholder data only. The check itself (dashboard/cosmos-native.check.js) needs a real Electron and is not run here.
//   node --test dashboard/cosmos/checkplan.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOLERANCE, LOOP_LIMIT_MS, EXIT, VERDICTS, RED, GREEN, BLUE, TEAL, hexToRgb, rgbToHex, meanRgb, withinTolerance,
  compareColour, buildCases, classify, exitCodeFor, summarize, formatCaseLine, finalLine, formatDryRun,
} from './checkplan.mjs';
import { bgraToRgba } from './decode.mjs';

/** A 32x32 RGBA grid of one colour. */
function grid({ r, g, b }, n = 32) {
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) data.set([r, g, b, 255], i * 4);
  return { width: n, height: n, data };
}

const byId = (id, opts) => buildCases(opts).find((c) => c.id === id);

describe('tolerance compare', () => {
  it('uses 12 per channel', () => {
    assert.equal(TOLERANCE, 12);
    assert.equal(LOOP_LIMIT_MS, 750);
  });

  it('accepts red within 12 on every channel', () => {
    assert.equal(compareColour(grid({ r: 255, g: 0, b: 0 }), RED).ok, true);
    assert.equal(compareColour(grid({ r: 243, g: 12, b: 12 }), RED).ok, true);
    assert.equal(compareColour(grid({ r: 242, g: 0, b: 0 }), RED).ok, false);     // 12 is the edge, 13 is out
    assert.equal(compareColour(grid({ r: 255, g: 13, b: 0 }), RED).ok, false);
  });

  it('rejects the BGRA-swapped blue (the trap) and accepts it once swapped back', () => {
    // pure red as Windows hands it over: B,G,R,A
    const bgra = Buffer.alloc(32 * 32 * 4);
    for (let i = 0; i < 32 * 32; i++) bgra.set([0, 0, 255, 255], i * 4);
    const unswapped = { width: 32, height: 32, data: new Uint8Array(bgra) };
    const swapped = { width: 32, height: 32, data: bgraToRgba(bgra) };
    const bad = compareColour(unswapped, RED);
    assert.equal(bad.ok, false);
    assert.equal(bad.maxDiff, 255);
    assert.equal(compareColour(swapped, RED).ok, true);
  });

  it('checks green and blue separately (both swapped channels)', () => {
    assert.equal(withinTolerance({ r: 0, g: 255, b: 0 }, GREEN), true);
    assert.equal(withinTolerance({ r: 0, g: 0, b: 255 }, GREEN), false);
    assert.equal(withinTolerance({ r: 255, g: 0, b: 0 }, BLUE), false);
  });

  it('meanRgb averages and ignores alpha; an empty grid gives null', () => {
    const data = Uint8Array.from([0, 0, 0, 0, 100, 200, 50, 255]);
    assert.deepEqual(meanRgb({ data }), { r: 50, g: 100, b: 25 });
    assert.equal(meanRgb({ data: new Uint8Array(0) }), null);
    assert.equal(meanRgb(null), null);
    assert.equal(compareColour({ data: new Uint8Array(0) }, RED).ok, false);
  });

  it('hex helpers round-trip', () => {
    assert.deepEqual(hexToRgb('#ff0000'), RED);
    assert.deepEqual(hexToRgb('008080'), TEAL);
    assert.equal(hexToRgb('red'), null);
    assert.equal(rgbToHex({ r: 255.4, g: 0, b: 128 }), '#ff0080');
  });
});

describe('case list', () => {
  it('covers each strategy for the red PNG and both swapped channels with JPEGs', () => {
    const ids = buildCases().map((c) => c.id);
    for (const id of ['png-red:shell', 'png-red:native-file', 'png-red:chromium', 'jpeg-green:native-file', 'jpeg-blue:native-file',
      'jpeg-green:chromium', 'jpeg-blue:chromium', 'bmp-orange:chromium', 'svg-teal:chromium', 'order:shell-rejected',
      'webp-green:chromium', 'network:blocked', 'video:webm', 'loop:20x2000']) {
      assert.ok(ids.includes(id), id);
    }
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  });

  it('adds the extractor case only when colorextract.mjs exists', () => {
    assert.equal(byId('extract:png-red'), undefined);
    assert.ok(byId('extract:png-red', { hasExtractor: true }));
  });

  it('AVIF is "not covered: no encoder available offline" unless a fixture is supplied', () => {
    const none = byId('avif:none');
    assert.equal(classify(none).verdict, VERDICTS.NOT_COVERED);
    assert.equal(formatCaseLine(none, classify(none)), 'avif:none not covered: no encoder available offline');
    assert.equal(byId('avif:none', { avifFile: 'x.avif' }), undefined);
    assert.ok(byId('avif:supplied', { avifFile: 'x.avif' }));
  });
});

describe('skip vs fail', () => {
  it('a colour mismatch is a failure (a blue-shifted red fails)', () => {
    const r = classify(byId('png-red:native-file'), { produced: true, rgba32: grid(BLUE) });
    assert.equal(r.verdict, VERDICTS.FAILED);
    assert.match(r.note, /#0000ff/);
    assert.match(r.note, /#ff0000/);
  });

  it('a colour match passes', () => {
    assert.equal(classify(byId('png-red:native-file'), { produced: true, rgba32: grid(RED) }).verdict, VERDICTS.PASSED);
  });

  it('a tainted canvas is a failure', () => {
    const r = classify(byId('svg-teal:chromium'), { tainted: true });
    assert.equal(r.verdict, VERDICTS.FAILED);
    assert.match(r.note, /tainted/);
  });

  it('WebP encode unsupported is skipped, not failed', () => {
    assert.equal(classify(byId('webp-green:chromium'), { unsupported: true, note: 'no WebP encoder' }).verdict, VERDICTS.SKIPPED);
  });

  it('video capture unsupported is not covered; a wrong video colour is also not covered, never failed', () => {
    const v = byId('video:webm');
    assert.equal(classify(v, { unsupported: true }).verdict, VERDICTS.NOT_COVERED);
    assert.equal(classify(v, { produced: true, rgba32: grid(BLUE) }).verdict, VERDICTS.NOT_COVERED);
    assert.equal(classify(v, { produced: false }).verdict, VERDICTS.NOT_COVERED);
    assert.equal(classify(v, { error: 'boom' }).verdict, VERDICTS.NOT_COVERED);
    assert.equal(classify(v, { tainted: true }).verdict, VERDICTS.NOT_COVERED);
    assert.equal(classify(v, { produced: true, rgba32: grid(GREEN) }).verdict, VERDICTS.PASSED);
  });

  it('the shell giving nothing is skipped (machine setup), the other strategies giving nothing fail', () => {
    assert.equal(classify(byId('png-red:shell'), { produced: false }).verdict, VERDICTS.SKIPPED);
    assert.equal(classify(byId('png-red:native-file'), { produced: false }).verdict, VERDICTS.FAILED);
    assert.equal(classify(byId('png-red:chromium'), { produced: false }).verdict, VERDICTS.FAILED);
    assert.equal(classify(byId('order:shell-rejected'), { produced: false }).verdict, VERDICTS.FAILED);
  });

  it('a shell result with the wrong colour still FAILS (only "no answer" is skipped)', () => {
    assert.equal(classify(byId('png-red:shell'), { produced: true, rgba32: grid(BLUE) }).verdict, VERDICTS.FAILED);
  });

  it('an error in a normal case fails', () => {
    assert.equal(classify(byId('png-red:chromium'), { error: 'decode window gone' }).verdict, VERDICTS.FAILED);
  });

  it('the network case needs both a page error and a counted cancel', () => {
    const n = byId('network:blocked');
    assert.equal(classify(n, { pageError: true, cancelCounted: true }).verdict, VERDICTS.PASSED);
    assert.equal(classify(n, { pageError: false, cancelCounted: true }).verdict, VERDICTS.FAILED);
    assert.equal(classify(n, { pageError: true, cancelCounted: false }).verdict, VERDICTS.FAILED);
  });

  it('the loop case fails over 750 ms and passes at 750', () => {
    const l = byId('loop:20x2000');
    assert.equal(classify(l, { maxGapMs: 750 }).verdict, VERDICTS.PASSED);
    assert.equal(classify(l, { maxGapMs: 751 }).verdict, VERDICTS.FAILED);
    assert.equal(classify(l, {}).verdict, VERDICTS.FAILED);
    assert.match(classify(l, { maxGapMs: 120 }).note, /120 ms/);
  });

  it('the extractor case uses a looser tolerance than the grid (it may quantise)', () => {
    const e = byId('extract:png-red', { hasExtractor: true });
    assert.equal(classify(e, { produced: true, rgba32: grid({ r: 230, g: 20, b: 20 }) }).verdict, VERDICTS.PASSED);
    assert.equal(classify(e, { produced: true, rgba32: grid(BLUE) }).verdict, VERDICTS.FAILED);
  });
});

describe('exit codes', () => {
  const r = (verdict) => ({ verdict });
  it('0 when nothing failed (skips and not-covered are fine)', () => {
    assert.equal(exitCodeFor([r('passed'), r('skipped'), r('not-covered')]), 0);
    assert.equal(EXIT.OK, 0);
  });
  it('1 when any case failed', () => {
    assert.equal(exitCodeFor([r('passed'), r('failed')]), 1);
    assert.equal(EXIT.FAILED, 1);
  });
  it('2 on a timeout, whatever the results say', () => {
    assert.equal(exitCodeFor([r('passed')], { timedOut: true }), 2);
    assert.equal(exitCodeFor([r('failed')], { timedOut: true }), 2);
    assert.equal(EXIT.TIMED_OUT, 2);
  });
  it('1 when nothing ran at all (an empty check is not a pass)', () => {
    assert.equal(exitCodeFor([]), 1);
    assert.equal(exitCodeFor(undefined), 1);
  });
  it('summarises and words the final line', () => {
    const rs = [r('passed'), r('passed'), r('skipped'), r('not-covered'), r('failed')];
    assert.deepEqual(summarize(rs), { passed: 2, failed: 1, skipped: 1, 'not-covered': 1 });
    assert.match(finalLine(rs), /^FAIL - 2 passed, 1 failed, 1 skipped, 1 not covered$/);
    assert.match(finalLine([r('passed')]), /^PASS/);
    assert.match(finalLine([r('passed')], { timedOut: true }), /^TIMED OUT/);
  });
});

describe('dry-run formatter', () => {
  it('prints extension counts and a total', () => {
    const out = formatDryRun({ '.png': { ok: 10, failed: 1 }, jpg: { ok: 5, failed: 0 }, '.PNG': { ok: 2, failed: 0 } });
    assert.equal(out, ['ext ok failed', 'jpg 5 0', 'png 12 1', 'total 17 1'].join('\n'));
  });

  it('prints only counts: no path separator and no file name, even for hostile keys', () => {
    const out = formatDryRun({
      'C:\\Users\\someone\\Pictures\\holiday.png': { ok: 3, failed: 1 },
      '../secret/holiday.jpg': { ok: 4, failed: 0 },
      'holiday.png': { ok: 1, failed: 0 },
      '/mnt/pics/IMG_0001': { ok: 1, failed: 0 },
      '.webp': { ok: 2, failed: 2 },
    });
    assert.ok(!/[\\/]/.test(out), out);
    assert.ok(!/holiday|secret|someone|IMG_|Pictures|\.\./i.test(out), out);
    assert.match(out, /^other 9 1$/m);
    assert.match(out, /^webp 2 2$/m);
    assert.match(out, /^total 11 3$/m);
  });

  it('survives junk counts', () => {
    assert.equal(formatDryRun(null), 'ext ok failed\ntotal 0 0');
    assert.equal(formatDryRun({ png: { ok: -5, failed: 'x' } }), 'ext ok failed\npng 0 0\ntotal 0 0');
  });
});
