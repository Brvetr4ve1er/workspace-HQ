// Cosmos space — the pure half of thumbnailing (dashboard/cosmos/decode.mjs). Placeholder data only.
//   node --test dashboard/cosmos/decode.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDGE, NATIVE_FILE_MAX_BYTES, CHROMIUM_MAX_BYTES, normExt, planFor, bgraToRgba, grayGrid, fitWithin, mimeFor,
  toDataUrl, parseDataUrl, imageScript, videoScript, videoCleanupScript,
} from './decode.mjs';
import { IMAGE_EXT, VIDEO_EXT } from './infer.mjs';

const MB = 1024 * 1024;

describe('planFor', () => {
  it('has "shell" first for every extension infer.mjs knows, images and videos', () => {
    for (const e of [...IMAGE_EXT, ...VIDEO_EXT]) {
      const kind = VIDEO_EXT.has(e) ? 'video' : 'image';
      assert.equal(planFor(e, kind, 1 * MB)[0], 'shell', e);
    }
  });

  it('png jpg jpeg ico -> shell, native-file, chromium when small', () => {
    for (const e of ['.png', '.jpg', '.jpeg', '.ico']) {
      assert.deepEqual(planFor(e, 'image', 1 * MB), ['shell', 'native-file', 'chromium'], e);
    }
  });

  it('drops native-file above 25 MB but keeps it at exactly 25 MB', () => {
    assert.deepEqual(planFor('.png', 'image', NATIVE_FILE_MAX_BYTES), ['shell', 'native-file', 'chromium']);
    assert.deepEqual(planFor('.png', 'image', NATIVE_FILE_MAX_BYTES + 1), ['shell', 'chromium']);
    assert.equal(NATIVE_FILE_MAX_BYTES, 25 * MB);
  });

  it('drops native-file when the size is unknown (a sync decode could stall the app)', () => {
    for (const s of [undefined, null, NaN, '5']) assert.deepEqual(planFor('.jpg', 'image', s), ['shell', 'chromium']);
  });

  it('gif webp avif svg tiff bmp never get native-file (nativeImage does not decode them; BMP proven by a real Electron run)', () => {
    for (const e of ['.gif', '.webp', '.avif', '.svg', '.tiff', '.tif', '.bmp']) {
      assert.deepEqual(planFor(e, 'image', 1024), ['shell', 'chromium'], e);
      assert.ok(!planFor(e, 'image', 1024).includes('native-file'));
    }
  });

  it('videos -> shell, chromium-video; the capture strategy can be switched off', () => {
    for (const e of ['.mp4', '.webm', '.mov', '.m4v', '.ogv']) {
      assert.deepEqual(planFor(e, 'video', 50 * MB), ['shell', 'chromium-video'], e);
      assert.deepEqual(planFor(e, 'video', 50 * MB, { videoCapture: false }), ['shell'], e);
    }
  });

  it('accepts the extension with or without the dot, in any case', () => {
    assert.deepEqual(planFor('PNG', 'image', 10), planFor('.png', 'image', 10));
    assert.deepEqual(planFor('.Webm', 'video', 10), ['shell', 'chromium-video']);
  });

  it('an unknown extension gets the shell only, or the video plan when the kind says video', () => {
    assert.deepEqual(planFor('.xyz', 'image', 10), ['shell']);
    assert.deepEqual(planFor('', 'image', 10), ['shell']);
    assert.deepEqual(planFor('.xyz', 'video', 10), ['shell', 'chromium-video']);
  });
});

describe('bgraToRgba', () => {
  it('swaps R and B: (B=1,G=2,R=3,A=4) -> (3,2,1,4)', () => {
    assert.deepEqual([...bgraToRgba(Buffer.from([1, 2, 3, 4]))], [3, 2, 1, 4]);
  });

  it('turns the BGRA of pure red (0,0,255,255) into RGBA (255,0,0,255)', () => {
    assert.deepEqual([...bgraToRgba(Uint8Array.from([0, 0, 255, 255]))], [255, 0, 0, 255]);
  });

  it('swaps every pixel and does not mutate its input', () => {
    const input = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const copy = Buffer.from(input);
    const out = bgraToRgba(input);
    assert.deepEqual([...out], [3, 2, 1, 4, 7, 6, 5, 8]);
    assert.deepEqual([...input], [...copy]);
    assert.notEqual(out.buffer, input.buffer);
    assert.ok(out instanceof Uint8Array);
  });

  it('refuses a buffer that is not whole pixels', () => {
    assert.throws(() => bgraToRgba(Buffer.from([1, 2, 3])), RangeError);
    assert.throws(() => bgraToRgba(null), RangeError);
  });
});

describe('grayGrid', () => {
  it('gives 72 values for a 9x8 grid', () => {
    assert.equal(grayGrid(new Uint8Array(9 * 8 * 4), 9, 8).length, 72);
  });

  it('uses the 0.299 / 0.587 / 0.114 luma weights on a known patch', () => {
    const rgba = new Uint8Array(9 * 8 * 4);
    const put = (i, r, g, b) => { rgba.set([r, g, b, 255], i * 4); };
    put(0, 255, 0, 0);          // 76.245 -> 76
    put(1, 0, 255, 0);          // 149.685 -> 150
    put(2, 0, 0, 255);          // 29.07 -> 29
    put(3, 255, 255, 255);      // 255
    put(4, 0, 0, 0);            // 0
    put(5, 100, 100, 100);      // 100
    const g = grayGrid(rgba, 9, 8);
    assert.deepEqual([...g.slice(0, 6)], [76, 150, 29, 255, 0, 100]);
    assert.ok(g.slice(6).every((v) => v === 0));
  });

  it('ignores alpha', () => {
    assert.deepEqual([...grayGrid(Uint8Array.from([10, 20, 30, 0]), 1, 1)], [...grayGrid(Uint8Array.from([10, 20, 30, 255]), 1, 1)]);
  });

  it('refuses a short buffer or a bad size', () => {
    assert.throws(() => grayGrid(new Uint8Array(10), 9, 8), RangeError);
    assert.throws(() => grayGrid(new Uint8Array(4), 0, 1), RangeError);
  });
});

describe('fitWithin', () => {
  it('never upscales', () => {
    assert.deepEqual(fitWithin(100, 50, 560), { width: 100, height: 50 });
    assert.deepEqual(fitWithin(560, 560, 560), { width: 560, height: 560 });
  });

  it('keeps the ratio when it shrinks', () => {
    assert.deepEqual(fitWithin(2000, 1000, 560), { width: 560, height: 280 });
    assert.deepEqual(fitWithin(1000, 2000, 560), { width: 280, height: 560 });
    const r = fitWithin(4000, 3000, 560);
    assert.equal(r.width, 560);
    assert.ok(Math.abs(r.width / r.height - 4 / 3) < 0.01);
  });

  it('never returns a zero side', () => {
    assert.deepEqual(fitWithin(10000, 1, 560), { width: 560, height: 1 });
  });

  it('returns null for unusable input', () => {
    for (const bad of [[0, 5, 560], [5, -1, 560], [NaN, 5, 560], [5, 5, 0], ['5', 5, 560]]) {
      assert.equal(fitWithin(...bad), null, JSON.stringify(bad));
    }
  });

  it('the default edge is 560', () => {
    assert.equal(EDGE, 560);
  });
});

describe('mimeFor', () => {
  it('maps the table', () => {
    const t = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
      '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.tiff': 'image/tiff',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.ogv': 'video/ogg',
    };
    for (const [e, m] of Object.entries(t)) assert.equal(mimeFor(e), m, e);
  });

  it('knows every extension infer.mjs knows', () => {
    for (const e of [...IMAGE_EXT, ...VIDEO_EXT]) assert.ok(mimeFor(e), e);
  });

  it('is case and dot insensitive and null for the unknown', () => {
    assert.equal(mimeFor('PNG'), 'image/png');
    assert.equal(mimeFor('.xyz'), null);
    assert.equal(mimeFor(''), null);
    assert.equal(mimeFor(undefined), null);
    assert.equal(mimeFor('__proto__'), null);
    assert.equal(mimeFor('constructor'), null);
  });

  it('normExt strips one dot and lower-cases', () => {
    assert.equal(normExt('.JPG'), 'jpg');
    assert.equal(normExt(5), '');
  });
});

describe('data URLs and page scripts', () => {
  it('round-trips bytes', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252]);
    const url = toDataUrl('image/png', bytes);
    assert.match(url, /^data:image\/png;base64,/);
    const back = parseDataUrl(url);
    assert.equal(back.mime, 'image/png');
    assert.deepEqual([...back.buffer], [...bytes]);
  });

  it('parseDataUrl refuses anything else', () => {
    for (const bad of ['', null, 'file:///x.png', 'data:image/png,abc', 'data:image/png;base64,', 'http://x/y', 'data:image/png;base64,@@@']) {
      assert.equal(parseDataUrl(bad), null, String(bad));
    }
  });

  it('the image script embeds the data: URL as the src and never mentions a file: URL (taint guard)', () => {
    const url = toDataUrl('image/svg+xml', Buffer.from('<svg/>'));
    const s = imageScript(url, 560, true);
    assert.ok(s.includes(`img.src = ${JSON.stringify(url)}`));
    assert.ok(!/file:/i.test(s));
    assert.ok(!/https?:|ftp:|ws:/i.test(s));
  });

  it('the image script only upscales when asked to (svg)', () => {
    assert.match(imageScript('data:image/png;base64,AAAA', 560, false), /if \(!false && s > 1\) s = 1/);
    assert.match(imageScript('data:image/svg+xml;base64,AAAA', 560, true), /if \(!true && s > 1\) s = 1/);
  });

  it('a hostile string cannot break out of the script (it is JSON-quoted)', () => {
    const s = imageScript('data:image/png;base64,AA"; alert(1); //', 560, false);
    assert.ok(s.includes('\\"; alert(1); //'));
  });

  it('the video script is the one place a file: URL goes, JSON-quoted, and it never uses a canvas', () => {
    const s = videoScript('file:///C:/alpha-site/clip.mp4');
    assert.ok(s.includes('"file:///C:/alpha-site/clip.mp4"'));
    assert.ok(!/canvas|toDataURL|drawImage/.test(s));
    assert.match(s, /Math\.min\(1, d \* 0\.1\)/);
    assert.match(videoCleanupScript(), /removeAttribute\('src'\)/);
  });

  it('exposes the limits the Electron half uses', () => {
    assert.equal(CHROMIUM_MAX_BYTES, 32 * MB);
  });
});
