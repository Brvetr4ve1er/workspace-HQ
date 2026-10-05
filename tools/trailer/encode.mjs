// tools/trailer/encode.mjs — turns the silent x264 masters that render-main.js
// writes (tools/trailer/out/hq-trailer-N.master.mp4) into the files we ship:
//
//   out/hq-trailer-N.video.webm  VP9, video only, two-pass, sized for the cap
//   out/hq-trailer-N.webm        the in-app trailer (VP9 [+ Opus])  ≤ 8 MB (1) / ≤ 15 MB (2)
//   out/hq-trailer-N.mp4         the x264 master [+ AAC], for a release / sharing
//   out/hq-trailer-N.jpg         poster frame
//
//   node tools/trailer/encode.mjs [--trailer 1|2|all] [--audio <wav>] [--install] [--force]
//
// Audio: the soundtrack is the WAV Claude Design exports ("Download
// soundtrack (.wav)" in each trailer's Tweaks panel). It is looked up at
// --audio, else at <Documents>/WorkspaceHQ Design Kit/audio/WorkspaceHQ-trailer-N.wav.
// Without one the trailers are encoded SILENT, and the script says so.
// Adding audio later is cheap: run encode.mjs again with --audio; the video
// streams are copied (VP9 from .video.webm, x264 from the master), only the
// audio is encoded, so it takes seconds, not a re-render.
//
// --install copies hq-trailer-N.webm and hq-trailer-N.jpg into
// dashboard-v5/media/ — only when the render manifest says the honesty patch
// ran and every check below passed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'out');
const WORK = path.join(HERE, '.work');
const MEDIA = path.join(REPO, 'dashboard-v5', 'media');

export const CAP_BYTES = { 1: 8 * 1000 * 1000, 2: 15 * 1000 * 1000 };
// Poster frames: the decoded wordmark (1) and the finished scan console (2).
export const POSTER_T = { 1: 9.9, 2: 9.5 };
const OPUS_KBPS = 96;

const log = (...m) => console.log('[encode]', ...m);

export function defaultWav(n) {
  return path.join(os.homedir(), 'Documents', 'WorkspaceHQ Design Kit', 'audio', `WorkspaceHQ-trailer-${n}.wav`);
}

/** Video bitrate (kbit/s) that keeps the WebM under `capBytes` with 5% headroom. */
export function videoKbps(capBytes, durationSec, withAudio) {
  const total = Math.floor((capBytes * 8 * 0.95) / durationSec / 1000);
  return total - (withAudio ? OPUS_KBPS : 0);
}

/** |measured − expected| ≤ one frame (+1 ms of container rounding). */
export function durationOk(measured, expected, fps) {
  return Number.isFinite(measured) && Math.abs(measured - expected) <= 1 / fps + 0.001;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.trim().split('\n').slice(-6).join('\n')}`))));
  });
}
const ffmpeg = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

/** Stream duration in seconds; WebM keeps it only as a "HH:MM:SS.fffffffff" DURATION tag. */
export function streamDuration(s) {
  const d = Number(s && s.duration);
  if (Number.isFinite(d)) return d;
  const tag = s && s.tags && (s.tags.DURATION || s.tags.duration);
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(tag || ''));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}

export async function probe(file) {
  const j = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration,size:stream=codec_type,codec_name,width,height,duration,sample_rate,channels:stream_tags=DURATION', '-of', 'json', file]));
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  return {
    duration: Number(j.format.duration), size: Number(j.format.size),
    video: v ? { codec: v.codec_name, width: v.width, height: v.height } : null,
    audio: a ? { codec: a.codec_name, duration: streamDuration(a), rate: Number(a.sample_rate), channels: a.channels } : null,
  };
}

const COLOR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

async function encodeVp9(master, out, { kbps, fps, height, logBase }) {
  const vf = height === 1080 ? [] : ['-vf', `scale=-2:${height}:flags=lanczos`];
  const common = ['-i', master, ...vf, '-c:v', 'libvpx-vp9', '-b:v', `${kbps}k`, '-deadline', 'good', '-row-mt', '1',
    '-tile-columns', height >= 1080 ? '2' : '1', '-auto-alt-ref', '1', '-lag-in-frames', '25', '-g', String(fps * 10),
    '-pix_fmt', 'yuv420p', ...COLOR, '-passlogfile', logBase, '-an'];
  await ffmpeg([...common, '-cpu-used', '4', '-pass', '1', '-f', 'null', '-']);
  await ffmpeg([...common, '-cpu-used', '2', '-pass', '2', '-f', 'webm', out]);
}

async function muxWebm(videoWebm, wav, out, dur) {
  if (!wav) { fs.copyFileSync(videoWebm, out); return; }
  await ffmpeg(['-i', videoWebm, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
    '-c:a', 'libopus', '-b:a', `${OPUS_KBPS}k`, '-ar', '48000', '-ac', '2', '-t', String(dur), '-f', 'webm', out]);
}

async function muxMp4(master, wav, out, dur) {
  if (!wav) { fs.copyFileSync(master, out); return; }
  await ffmpeg(['-i', master, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', String(dur), '-movflags', '+faststart', out]);
}

async function poster(master, t, out) {
  await ffmpeg(['-ss', String(t), '-i', master, '-frames:v', '1',
    '-vf', 'scale=1280:-2:flags=lanczos:in_color_matrix=bt709:out_color_matrix=bt601:out_range=pc,format=yuvj420p',
    '-q:v', '3', out]);
}

export async function encodeOne(n, { audio, install, force } = {}) {
  const tag = `hq-trailer-${n}`;
  const manifestPath = path.join(OUT, `${tag}.render.json`);
  const master = path.join(OUT, `${tag}.master.mp4`);
  if (!fs.existsSync(manifestPath) || !fs.existsSync(master)) {
    throw new Error(`${tag}: no render yet — run render-main.js --trailer ${n} first (missing ${path.basename(fs.existsSync(master) ? manifestPath : master)})`);
  }
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!m.complete) throw new Error(`${tag}: the master is a partial render (${m.frames} frames) — render the whole trailer before encoding`);
  const patches = (m.honesty && (m.honesty.patches || m.honesty.applied)) || [];
  if (!patches.length) throw new Error(`${tag}: the render manifest has no honesty-patch record — refusing to ship it`);
  const dur = m.durationSec, fps = m.fps, cap = CAP_BYTES[n];

  const wav = audio || (fs.existsSync(defaultWav(n)) ? defaultWav(n) : null);
  if (wav && !fs.existsSync(wav)) throw new Error(`${tag}: --audio file not found: ${wav}`);
  log(`${tag}: ${dur}s @ ${fps}fps, cap ${(cap / 1e6).toFixed(0)} MB, audio: ${wav ? path.basename(wav) : 'NONE — encoding SILENT (no soundtrack WAV found at ' + defaultWav(n) + ')'}`);

  // 1. VP9 video stream (kept, so adding audio later is a copy, not an encode)
  fs.mkdirSync(WORK, { recursive: true });
  const videoWebm = path.join(OUT, `${tag}.video.webm`);
  const finalWebm = path.join(OUT, `${tag}.webm`);
  const stale = !fs.existsSync(videoWebm) || force || fs.statSync(videoWebm).mtimeMs < fs.statSync(master).mtimeMs;
  let height = 1080, kbps = videoKbps(cap, dur, !!wav);
  if (stale) {
    log(`${tag}: VP9 two-pass ${height}p @ ${kbps} kbit/s …`);
    await encodeVp9(master, videoWebm, { kbps, fps, height, logBase: path.join(WORK, `vp9-${n}`) });
  } else {
    const pv = await probe(videoWebm);
    height = pv.video.height;
    log(`${tag}: reusing ${path.basename(videoWebm)} (${height}p) — video copied, not re-encoded`);
  }
  await muxWebm(videoWebm, wav, finalWebm, dur);
  // 2. over the cap → 720p, then a lower bitrate
  for (let attempt = 0; fs.statSync(finalWebm).size > cap; attempt++) {
    if (attempt >= 2) throw new Error(`${tag}: WebM is ${(fs.statSync(finalWebm).size / 1e6).toFixed(2)} MB, still over the ${(cap / 1e6).toFixed(0)} MB cap after the 720p fallback`);
    const size = fs.statSync(finalWebm).size;
    if (height !== 720) height = 720; else kbps = Math.floor(kbps * (cap / size) * 0.95);
    log(`${tag}: ${(size / 1e6).toFixed(2)} MB is over the cap → re-encoding ${height}p @ ${kbps} kbit/s`);
    await encodeVp9(master, videoWebm, { kbps, fps, height, logBase: path.join(WORK, `vp9-${n}`) });
    await muxWebm(videoWebm, wav, finalWebm, dur);
  }

  // 3. MP4 (x264 master, copied) + poster
  const mp4 = path.join(OUT, `${tag}.mp4`);
  await muxMp4(master, wav, mp4, dur);
  const jpg = path.join(OUT, `${tag}.jpg`);
  await poster(master, POSTER_T[n], jpg);

  // 4. verify
  const checks = [];
  const check = (ok, what) => { checks.push({ ok, what }); if (!ok) log(`${tag}: CHECK FAILED — ${what}`); };
  const pm = await probe(master), pw = await probe(finalWebm), p4 = await probe(mp4);
  check(durationOk(pm.duration, dur, fps), `master duration ${pm.duration}s = ${dur}s ± 1 frame`);
  check(durationOk(pw.duration, dur, fps), `webm duration ${pw.duration}s = ${dur}s ± 1 frame`);
  check(durationOk(p4.duration, dur, fps), `mp4 duration ${p4.duration}s = ${dur}s ± 1 frame`);
  check(pm.video && pm.video.codec === 'h264' && pm.video.width === 1920 && pm.video.height === 1080, `master is h264 1920x1080 (${JSON.stringify(pm.video)})`);
  check(pw.video && pw.video.codec === 'vp9', `webm video is vp9 (${pw.video && pw.video.codec} ${pw.video && pw.video.height}p)`);
  check(pw.size <= cap, `webm ${(pw.size / 1e6).toFixed(2)} MB ≤ ${(cap / 1e6).toFixed(0)} MB`);
  if (wav) {
    check(pw.audio && pw.audio.codec === 'opus' && Math.abs(pw.audio.duration - dur) <= 0.05, `webm audio is opus, ${pw.audio && pw.audio.duration}s = ${dur}s ± 50 ms`);
    check(p4.audio && p4.audio.codec === 'aac' && Math.abs(p4.audio.duration - dur) <= 0.05, `mp4 audio is aac, ${p4.audio && p4.audio.duration}s = ${dur}s ± 50 ms`);
  } else {
    check(!pw.audio && !p4.audio, 'silent: no audio stream (no soundtrack WAV yet)');
  }
  check(fs.statSync(jpg).size > 10000, `poster ${path.basename(jpg)} written`);
  const ok = checks.every((c) => c.ok);
  const report = {
    trailer: n, at: new Date().toISOString(), ok, audio: wav ? path.basename(wav) : null, silent: !wav,
    webm: { file: path.basename(finalWebm), bytes: pw.size, height: pw.video.height, kbps, duration: pw.duration },
    mp4: { file: path.basename(mp4), bytes: p4.size, duration: p4.duration },
    master: { file: path.basename(master), duration: pm.duration }, poster: { file: path.basename(jpg), t: POSTER_T[n] },
    checks,
  };
  fs.writeFileSync(path.join(OUT, `${tag}.encode.json`), JSON.stringify(report, null, 2));
  log(`${tag}: webm ${(pw.size / 1e6).toFixed(2)} MB ${pw.video.height}p · mp4 ${(p4.size / 1e6).toFixed(1)} MB · ${checks.filter((c) => c.ok).length}/${checks.length} checks ok`);
  if (!ok) throw new Error(`${tag}: verification failed — see ${tag}.encode.json`);

  if (install) {
    fs.mkdirSync(MEDIA, { recursive: true });
    fs.copyFileSync(finalWebm, path.join(MEDIA, `${tag}.webm`));
    fs.copyFileSync(jpg, path.join(MEDIA, `${tag}.jpg`));
    log(`${tag}: installed → dashboard-v5/media/${tag}.webm + ${tag}.jpg${wav ? '' : ' (SILENT)'}`);
  }
  return report;
}

function parseArgs(argv) {
  const a = { trailers: [1, 2], install: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--trailer') { a.trailers = v === 'all' ? [1, 2] : [Number(v)]; i++; }
    else if (k === '--audio') { a.audio = path.resolve(v); i++; }
    else if (k === '--install') a.install = true;
    else if (k === '--force') a.force = true;
  }
  if (a.trailers.some((n) => n !== 1 && n !== 2)) throw new Error('--trailer must be 1, 2 or all');
  if (a.audio && a.trailers.length !== 1) throw new Error('--audio goes with one trailer: --trailer 1 --audio <wav>');
  return a;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const a = parseArgs(process.argv.slice(2));
    for (const n of a.trailers) await encodeOne(n, a);
  } catch (e) {
    console.error('[encode] FAILED:', e.message);
    process.exit(1);
  }
}
