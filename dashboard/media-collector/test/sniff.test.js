const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideType, kindOfMime } = require('../sniff');

const B = (...bytes) => Uint8Array.from(bytes);
const S = (s) => new TextEncoder().encode(s);

test('bytes win over headers and extensions', () => {
  assert.deepEqual(decideType(B(0xff, 0xd8, 0xff, 0xe0, 0, 0), 'text/html', 'png'), { mime: 'image/jpeg', ext: 'jpg', kind: 'image', trusted: 'bytes' });
  assert.equal(decideType(B(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a), 'application/octet-stream', 'exe').ext, 'png');
  assert.equal(decideType(S('GIF89a....'), '', '').mime, 'image/gif');
  assert.equal(decideType(S('RIFF....WEBPVP8 '), '', '').mime, 'image/webp');
  assert.equal(decideType(S('RIFF....WAVEfmt '), '', '').mime, 'audio/wav');
  assert.equal(decideType(S('....ftypisom....'), '', '').mime, 'video/mp4');
  assert.equal(decideType(S('....ftypM4A ....'), '', '').mime, 'audio/mp4');
  assert.equal(decideType(S('....ftypqt  ....'), '', '').mime, 'video/quicktime');
  assert.equal(decideType(S('....ftypavif....'), '', '').mime, 'image/avif');
  assert.equal(decideType(B(0x1a, 0x45, 0xdf, 0xa3, ...S('....webm....')), '', '').mime, 'video/webm');
  assert.equal(decideType(S('OggS....'), '', '').mime, 'audio/ogg');
  assert.equal(decideType(S('ID3....'), '', '').mime, 'audio/mpeg');
  assert.equal(decideType(B(0xff, 0xfb, 0x90, 0x00), '', '').mime, 'audio/mpeg');
});

test('HTML and manifests are recognized so they are refused as media', () => {
  assert.equal(decideType(S('<!DOCTYPE html><html>'), 'image/jpeg', 'jpg').kind, 'html');
  assert.equal(decideType(S('  <html lang=en>'), 'image/jpeg', 'jpg').kind, 'html');
  assert.equal(decideType(S('#EXTM3U\n#EXT-X-VERSION:3'), 'video/mp4', 'mp4').kind, 'manifest');
  assert.equal(decideType(S('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'), '', '').mime, 'image/svg+xml');
});

test('declared media type is accepted when bytes are not recognizably something else', () => {
  assert.deepEqual(decideType(B(1, 2, 3, 4, 5, 6, 7, 8), 'image/x-unknown', 'jpg'), { mime: 'image/x-unknown', ext: 'jpg', kind: 'image', trusted: 'header' });
  assert.equal(decideType(B(1, 2, 3, 4), 'application/octet-stream', 'mp4').trusted, 'extension');
  assert.equal(decideType(B(1, 2, 3, 4), 'application/octet-stream', 'exe').kind, 'other');
  assert.equal(decideType(B(1, 2, 3, 4), 'text/plain', 'jpg').kind, 'other');
  assert.equal(decideType(new Uint8Array(0), 'video/mp4', '').ext, 'mp4');
});

test('kindOfMime', () => {
  assert.equal(kindOfMime('IMAGE/JPEG; charset=x'), 'image');
  assert.equal(kindOfMime('application/vnd.apple.mpegurl'), 'manifest');
  assert.equal(kindOfMime(undefined), 'other');
});
