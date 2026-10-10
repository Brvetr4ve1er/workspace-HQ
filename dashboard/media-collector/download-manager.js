'use strict';
// DownloadManager — the local queue: bounded concurrency, per-host politeness,
// progress, pause/resume (Range + If-Range when the server supports it),
// cancel with partial cleanup, bounded automatic retry for transient errors,
// conflict handling (ask/skip/rename/replace), byte-count + SHA-256
// verification, and a library record for every saved file.
//
// Job states: queued → running → done | failed | cancelled | paused | conflict | skipped
const EventEmitter = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { request, hostSlot, totalSize, sample } = require('./net');
const { decideType } = require('./sniff');
const { UmcError, toPublic, fromStatus, isUmc } = require('./errors');
const F = require('./file-service');
const { hintFromUrl } = require('./filenames');

const SAMPLE_BYTES = 16384;
const PROGRESS_MS = 150;
const RETRY_DELAYS = [1500, 4000, 10000];

class DownloadManager extends EventEmitter {
  constructor({ settings, library, log = console, netOpts = {}, retryDelays = RETRY_DELAYS }) {
    super();
    this.settings = settings; this.library = library; this.log = log; this.netOpts = netOpts; this.retryDelays = retryDelays;
    this.jobs = new Map(); this.order = [];
    this.running = 0; this.ticking = false; this.pausedAll = false;
  }

  // ---- public API --------------------------------------------------------
  add(candidates, { destination } = {}) {
    const s = this.settings.get();
    const dest = destination || s.destination;
    const queuedBytes = this.list().filter((j) => ['queued', 'running', 'paused', 'conflict'].includes(j.status)).reduce((a, j) => a + (j.bytesTotal || 0), 0);
    let acc = queuedBytes;
    const out = [];
    for (const c of candidates) {
      if (!c || !c.sourceUrl) continue;
      if (c.bytes && c.bytes > s.maxFileBytes) { out.push({ refused: toPublic(new UmcError('FILE_TOO_LARGE', `${c.bytes} bytes`)), sourceUrl: c.sourceUrl }); continue; }
      if (c.bytes && acc + c.bytes > s.maxQueuedBytes) { out.push({ refused: toPublic(new UmcError('FILE_TOO_LARGE', 'queue byte limit')), sourceUrl: c.sourceUrl }); continue; }
      acc += c.bytes || 0;
      const job = {
        id: crypto.randomUUID(), candidate: { ...c }, destination: dest, status: 'queued', createdAt: Date.now(), startedAt: null, finishedAt: null,
        bytesDone: 0, bytesTotal: c.bytes || null, speedBps: 0, attempts: 0, error: null, conflict: null, result: null,
        name: null, finalPath: null, partPath: null, validators: c.validators || null, acceptRanges: !!c.acceptRanges, _ac: null, _resumeFrom: 0, _retryTimer: null,
      };
      this.jobs.set(job.id, job); this.order.push(job.id); out.push(this.publicJob(job));
    }
    this.emitQueue(); this.tick();
    return out;
  }
  list() { return this.order.map((id) => this.publicJob(this.jobs.get(id))); }
  get(id) { return this.jobs.get(id) || null; }
  cancel(id) { const j = this.jobs.get(id); if (!j) return false; return this._stop(j, 'cancelled'); }
  pause(id) { const j = this.jobs.get(id); if (!j) return false; return this._stop(j, 'paused'); }
  resume(id) { const j = this.jobs.get(id); if (!j || j.status !== 'paused') return false; j.status = 'queued'; j.error = null; this.emitQueue(); this.tick(); return true; }
  retry(id) { const j = this.jobs.get(id); if (!j || !['failed', 'cancelled'].includes(j.status)) return false; j.status = 'queued'; j.error = null; j.attempts = 0; j.bytesDone = 0; j._resumeFrom = 0; this.emitQueue(); this.tick(); return true; }
  remove(id) { const j = this.jobs.get(id); if (!j) return false; if (['running'].includes(j.status)) this._stop(j, 'cancelled'); if (j._retryTimer) clearTimeout(j._retryTimer); this.jobs.delete(id); this.order = this.order.filter((x) => x !== id); if (j.partPath) F.removeQuietly(j.partPath); this.emitQueue(); return true; }
  resolveConflict(id, choice) {
    const j = this.jobs.get(id); if (!j || j.status !== 'conflict') return false;
    if (choice === 'skip') { j.status = 'skipped'; j.finishedAt = Date.now(); j.conflict = null; this.emitQueue(); this.tick(); return true; }
    if (choice === 'rename' || choice === 'replace') { j._conflictChoice = choice; j.status = 'queued'; j.conflict = null; this.emitQueue(); this.tick(); return true; }
    return false;
  }
  pauseAll() { this.pausedAll = true; for (const j of this.jobs.values()) if (j.status === 'running' || j.status === 'queued') this._stop(j, 'paused'); }
  resumeAll() { this.pausedAll = false; for (const j of this.jobs.values()) if (j.status === 'paused') { j.status = 'queued'; j.error = null; } this.emitQueue(); this.tick(); }
  clearFinished() { for (const id of [...this.order]) { const j = this.jobs.get(id); if (['done', 'failed', 'cancelled', 'skipped'].includes(j.status)) { this.jobs.delete(id); this.order = this.order.filter((x) => x !== id); } } this.emitQueue(); }
  publicJob(j) {
    if (!j) return null;
    const c = j.candidate;
    return { id: j.id, status: j.status, sourceUrl: c.sourceUrl, pageUrl: c.pageUrl || null, host: c.host, kind: c.kind, mime: c.mime, title: (c.attribution && c.attribution.title) || c.filenameHint || '',
      name: j.name, finalPath: j.finalPath, destination: j.destination, bytesDone: j.bytesDone, bytesTotal: j.bytesTotal, speedBps: j.speedBps, attempts: j.attempts,
      error: j.error, conflict: j.conflict, result: j.result, createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt, canResume: j.status === 'paused' };
  }
  emitQueue() { this.emit('queue', this.list()); }
  emitJob(j) { this.emit('job', this.publicJob(j)); }

  // ---- scheduling ----------------------------------------------------------
  tick() {
    if (this.ticking) return; this.ticking = true;
    try {
      const limit = this.settings.get().concurrency;
      let started = 0;
      for (const id of this.order) {
        if (this.running >= limit || this.pausedAll) break;
        const j = this.jobs.get(id);
        if (j && j.status === 'queued' && !j._retryTimer) { this.running++; started++; j.status = 'running'; this._run(j).finally(() => { this.running--; this.tick(); }); }
      }
      if (started) this.emitQueue();
    } finally { this.ticking = false; }
  }
  _stop(j, status) {
    if (j._retryTimer) { clearTimeout(j._retryTimer); j._retryTimer = null; }
    if (j.status === 'running' && j._ac) { j._stopAs = status; j._ac.abort(); return true; }
    if (['queued', 'conflict', 'running'].includes(j.status)) { j.status = status; j.finishedAt = status === 'cancelled' ? Date.now() : null; if (status === 'cancelled' && j.partPath && !this.settings.get().keepPartialOnCancel) F.removeQuietly(j.partPath); this.emitQueue(); return true; }
    return false;
  }

  // ---- the download --------------------------------------------------------
  async _run(j) {
    const s = this.settings.get();
    const c = j.candidate;
    j.startedAt = j.startedAt || Date.now(); j.attempts++; j.error = null; j._ac = new AbortController();
    const signal = j._ac.signal;
    const net = { ...this.netOpts, signal, timeoutMs: 20000 };
    let release = null;
    this.emitJob(j);
    try {
      const destReal = await F.ensureDestination(j.destination);
      release = await hostSlot(c.host, 2);
      // 1. know the type before naming (bytes decide; the resolver's probe may already have them)
      let type = c.mimeTrusted === 'bytes' && c.mime ? { mime: c.mime, ext: c.extHint, kind: c.kind, trusted: 'bytes' } : null;
      let size = j.bytesTotal;
      if (!type || j._resumeFrom === 0) {
        const p = await sample(c.sourceUrl, { ...net, sampleBytes: SAMPLE_BYTES });
        type = decideType(p.bytes, p.headers['content-type'], c.extHint || '');
        size = p.size != null ? p.size : size;
        j.acceptRanges = p.acceptRanges; j.validators = { etag: p.headers.etag || null, lastModified: p.headers['last-modified'] || null };
        if (p.finalUrl !== c.sourceUrl) j._finalUrl = p.finalUrl;
      }
      if (type.kind === 'html') throw new UmcError('UNSUPPORTED_MEDIA', 'the link is a web page');
      if (type.kind === 'manifest') throw new UmcError('UNSUPPORTED_MEDIA', 'stream manifest');
      if (type.kind === 'other') throw new UmcError('UNSUPPORTED_MEDIA', type.mime);
      if (size != null && size > s.maxFileBytes) throw new UmcError('FILE_TOO_LARGE', `${size} bytes`);
      j.bytesTotal = size;
      const free = await F.freeBytes(destReal);
      if (free != null && size != null && size - j._resumeFrom > free) throw new UmcError('DISK_FULL');

      // 2. name + conflict policy
      if (!j.finalPath || j._conflictChoice) {
        const policy = j._conflictChoice === 'rename' ? 'rename' : j._conflictChoice === 'replace' ? 'ask' : s.overwritePolicy;
        const plan = F.planName(destReal, s.filenameTemplate, this._tokens(c, type, j), policy);
        if (plan.conflict && j._conflictChoice !== 'replace') {
          if (s.overwritePolicy === 'skip') { j.status = 'skipped'; j.finishedAt = Date.now(); j.result = { skipped: true, existingPath: plan.existingPath }; this.emitQueue(); return; }
          j.status = 'conflict'; j.conflict = { existingPath: plan.existingPath, proposedName: plan.name }; j._ac = null; this.emitQueue(); return;
        }
        j.name = plan.name; j.finalPath = plan.finalPath; j._replace = j._conflictChoice === 'replace'; j._conflictChoice = null;
      }
      j.partPath = j.partPath || F.partialPath(destReal, j.id);

      // 3. the stream (Range resume when the server supports it and validators still match)
      const hash = crypto.createHash('sha256');
      let offset = 0;
      const headers = {};
      if (j._resumeFrom > 0 && j.acceptRanges && F.exists(j.partPath)) {
        const st = fs.statSync(j.partPath);
        if (st.size === j._resumeFrom) {
          headers.range = `bytes=${st.size}-`;
          if (j.validators && (j.validators.etag || j.validators.lastModified)) headers['if-range'] = j.validators.etag || j.validators.lastModified;
          offset = st.size;
        }
      }
      const r = await request(j._finalUrl || c.sourceUrl, { ...net, method: 'GET', headers });
      if (r.status >= 400) { r.res.resume(); throw fromStatus(r.status, r.headers); }
      let append = false;
      if (offset > 0) {
        if (r.status === 206) { append = true; await this._rehash(hash, j.partPath); }
        else { offset = 0; }   // server ignored the range (or the file changed): start over
      }
      if (r.status === 206 && offset === 0) { r.res.resume(); throw new UmcError('SOURCE_UNAVAILABLE', 'unexpected partial response'); }
      const total = totalSize(r.headers);
      if (total != null) { j.bytesTotal = total; if (total > s.maxFileBytes) { r.res.destroy(); throw new UmcError('FILE_TOO_LARGE', `${total} bytes`); } }
      j.bytesDone = offset;
      await this._pipe(j, r.res, hash, append, s.maxFileBytes, offset === 0);
      // 4. verify
      if (j.bytesTotal != null && j.bytesDone !== j.bytesTotal) throw new UmcError('INTEGRITY_CHECK_FAILED', `${j.bytesDone} of ${j.bytesTotal} bytes`);
      const onDisk = fs.statSync(j.partPath).size;
      if (onDisk !== j.bytesDone) throw new UmcError('INTEGRITY_CHECK_FAILED', 'disk size mismatch');
      const sha256 = hash.digest('hex');
      // 5. commit + record
      await F.commit(j.partPath, j.finalPath, { replace: !!j._replace });
      const dup = this.library.findBySha(sha256);
      const rec = this.library.add({ source: c.pageUrl ? 'web' : 'direct', host: c.host, pageUrl: c.pageUrl, sourceUrl: c.sourceUrl, localPath: j.finalPath, originalName: c.filenameHint || hintFromUrl(c.sourceUrl),
        kind: type.kind, mime: type.mime, bytes: j.bytesDone, sha256, width: c.width, height: c.height, duration: c.duration, title: c.attribution && c.attribution.title, pageTitle: c.attribution && c.attribution.pageTitle, quality: c.quality, via: c.via, jobId: j.id });
      j.status = 'done'; j.finishedAt = Date.now(); j.result = { libraryId: rec.id, sha256, bytes: j.bytesDone, path: j.finalPath, duplicateOf: dup ? { id: dup.id, path: dup.localPath } : null };
      this.emitQueue();
    } catch (err) {
      await this._fail(j, err);
    } finally {
      if (release) release();
      j._ac = null;
    }
  }

  _tokens(c, type, j) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const stripExt = (t) => String(t || '').replace(/\.(jpe?g|png|gif|webp|bmp|tiff?|avif|heic|heif|svg|mp4|m4v|mov|webm|mkv|ogv|mpe?g|avi|3gp|mp3|m4a|aac|ogg|oga|opus|flac|wav|weba)$/i, '');
    const title = stripExt(c.attribution && c.attribution.title) || stripExt(c.filenameHint) || (c.attribution && c.attribution.pageTitle) || '';
    const idx = this.order.indexOf(j.id) + 1;
    return { source: c.pageUrl ? (c.attribution && c.attribution.pageHost) || c.host : c.host, host: c.host, date, time, title, id: (c.id || j.id).slice(0, 8), index: idx, ext: type.ext };
  }

  _rehash(hash, p) {
    return new Promise((resolve, reject) => fs.createReadStream(p).on('data', (ch) => hash.update(ch)).on('error', reject).on('end', resolve));
  }

  _pipe(j, res, hash, append, maxBytes, verifyHead) {
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(j.partPath, { flags: append ? 'a' : 'w' });
      let lastEmit = 0, lastBytes = j.bytesDone, lastT = Date.now(), head = verifyHead, failed = null;
      const fail = (err) => { if (failed) return; failed = err; res.destroy(); out.destroy(); reject(err); };
      res.on('data', (chunk) => {
        if (failed) return;
        if (head) {   // first chunk of a fresh stream: refuse a page/manifest masquerading as a file
          head = null;
          const t = decideType(chunk.subarray(0, 64), null, '');
          if (t.kind === 'html' || t.kind === 'manifest') return fail(new UmcError('UNSUPPORTED_MEDIA', 'the stream is a web page'));
        }
        j.bytesDone += chunk.length;
        if (j.bytesDone > maxBytes) return fail(new UmcError('FILE_TOO_LARGE', `over ${maxBytes} bytes`));
        if (j.bytesTotal != null && j.bytesDone > j.bytesTotal) return fail(new UmcError('INTEGRITY_CHECK_FAILED', 'more bytes than announced'));
        hash.update(chunk);
        if (!out.write(chunk)) { res.pause(); out.once('drain', () => res.resume()); }
        const now = Date.now();
        if (now - lastEmit >= PROGRESS_MS) { const dt = (now - lastT) / 1000; j.speedBps = dt > 0 ? Math.round((j.bytesDone - lastBytes) / dt) : 0; lastEmit = now; lastT = now; lastBytes = j.bytesDone; this.emitJob(j); }
      });
      res.on('error', (err) => fail(isUmc(err) ? err : require('./errors').fromNative(err)));
      out.on('error', (err) => fail(require('./errors').fromNative(err)));
      res.on('end', () => { if (failed) return; out.end(); });
      out.on('finish', () => { if (!failed) resolve(); });
      res.on('close', () => { if (!failed && !res.complete) fail(new UmcError('NETWORK_TIMEOUT', 'connection closed early')); });
    });
  }

  async _fail(j, err) {
    const e = isUmc(err) ? err : require('./errors').fromNative(err);
    const s = this.settings.get();
    if (e.code === 'CANCELLED') {
      const as = j._stopAs || 'cancelled'; j._stopAs = null;
      if (as === 'paused') { j.status = 'paused'; j._resumeFrom = j.partPath && F.exists(j.partPath) ? fs.statSync(j.partPath).size : 0; if (!j.acceptRanges) j._resumeFrom = 0; }
      else { j.status = 'cancelled'; j.finishedAt = Date.now(); j.error = toPublic(e); if (j.partPath && !s.keepPartialOnCancel) await F.removeQuietly(j.partPath); }
      this.emitQueue(); return;
    }
    j.error = toPublic(e);
    const transient = !e.permanent && j.attempts <= this.retryDelays.length && ['NETWORK_TIMEOUT', 'SOURCE_UNAVAILABLE', 'RATE_LIMITED'].includes(e.code);
    if (transient) {
      const delay = (e.extra && e.extra.retryAfterMs) || this.retryDelays[j.attempts - 1];
      j.status = 'queued'; j._resumeFrom = j.acceptRanges && j.partPath && F.exists(j.partPath) ? fs.statSync(j.partPath).size : 0;
      j.error = { ...j.error, retryingInMs: delay };
      j._retryTimer = setTimeout(() => { j._retryTimer = null; this.tick(); }, delay);
      if (typeof j._retryTimer.unref === 'function') j._retryTimer.unref();
      this.emitQueue(); return;
    }
    j.status = 'failed'; j.finishedAt = Date.now();
    if (j.partPath && (e.code === 'INTEGRITY_CHECK_FAILED' || !s.keepPartialOnCancel)) await F.removeQuietly(j.partPath);
    this.emitQueue();
  }
}

module.exports = { DownloadManager };
