// node --test tools/trailer/encode.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { videoKbps, durationOk, streamDuration, CAP_BYTES, POSTER_T, defaultWav } from './encode.mjs';

test('stream duration reads ffprobe fields and WebM DURATION tags', () => {
  assert.equal(streamDuration({ duration: '30.000000' }), 30);
  assert.equal(streamDuration({ duration: 'N/A', tags: { DURATION: '00:01:01.007000000' } }), 61.007);
  assert.ok(Number.isNaN(streamDuration({})));
});

test('video bitrate keeps each WebM under its cap with headroom', () => {
  for (const [n, dur] of [[1, 30], [2, 61]]) {
    for (const audio of [false, true]) {
      const kbps = videoKbps(CAP_BYTES[n], dur, audio);
      const bytes = ((kbps + (audio ? 96 : 0)) * 1000 * dur) / 8;
      assert.ok(bytes <= CAP_BYTES[n] * 0.95 + 1, `trailer ${n} audio=${audio}: ${bytes} B`);
      assert.ok(kbps > 1000, `trailer ${n}: ${kbps} kbit/s is too starved for 1080p`);
    }
  }
  assert.equal(CAP_BYTES[1], 8e6);
  assert.equal(CAP_BYTES[2], 15e6);
});

test('audio takes its share of the budget', () => {
  assert.equal(videoKbps(8e6, 30, false) - videoKbps(8e6, 30, true), 96);
});

test('duration check allows one frame, no more', () => {
  assert.ok(durationOk(30, 30, 30));
  assert.ok(durationOk(30.033, 30, 30));
  assert.ok(durationOk(29.967, 30, 30));
  assert.ok(!durationOk(30.1, 30, 30));
  assert.ok(!durationOk(NaN, 30, 30));
});

test('posters sit inside their trailers', () => {
  assert.ok(POSTER_T[1] > 0 && POSTER_T[1] < 30);
  assert.ok(POSTER_T[2] > 0 && POSTER_T[2] < 61);
});

test('default soundtrack path is per trailer and has no user-specific parts', () => {
  assert.match(defaultWav(1), /WorkspaceHQ Design Kit[\\/]audio[\\/]WorkspaceHQ-trailer-1\.wav$/);
  assert.match(defaultWav(2), /WorkspaceHQ-trailer-2\.wav$/);
});
