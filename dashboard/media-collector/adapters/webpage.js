'use strict';
// WebPageResolver — one bounded, script-free fetch of a public page, then
// candidate discovery from standard HTML/metadata, then a bounded probe of
// the top candidates (type, size, dimensions from file headers).
const { fetchText } = require('../net');
const { extractCandidates } = require('../html-parse');
const { kindOfMime } = require('../sniff');
const { isAllowed } = require('../robots');
const { hintFromUrl } = require('../filenames');
const { UmcError, toPublic } = require('../errors');
const direct = require('./direct');

const PROBE_CONCURRENCY = 4;

async function robotsAllows(pageUrl, ctx) {
  const u = new URL(pageUrl);
  try {
    const r = await fetchText(`${u.protocol}//${u.host}/robots.txt`, { allowPrivate: ctx.allowPrivate, signal: ctx.signal, timeoutMs: Math.min(ctx.timeoutMs || 15000, 8000), maxBytes: 256 * 1024 });
    if (r.status !== 200) return true;
    return isAllowed(r.text, u.pathname + u.search);
  } catch { return true; }   // unreachable robots.txt is not a block
}

async function resolve(detected, ctx, opts = {}) {
  const warnings = [];
  if (ctx.respectRobots !== false && !(await robotsAllows(detected.url, ctx))) throw new UmcError('ROBOTS_OR_POLICY_BLOCK');
  const page = await fetchText(detected.url, { allowPrivate: ctx.allowPrivate, signal: ctx.signal, timeoutMs: ctx.timeoutMs, maxBytes: ctx.maxPageBytes || 5 * 1024 * 1024 });
  if (page.status >= 400) { const { fromStatus } = require('../errors'); throw fromStatus(page.status, page.headers); }
  const ctKind = kindOfMime(page.contentType);
  if (ctKind === 'image' || ctKind === 'video' || ctKind === 'audio') {
    // The "page" is a bare media file — hand it back to the direct resolver.
    return { kind: 'redirect-direct', finalUrl: page.finalUrl };
  }
  if (ctKind !== 'html' && !/^text\/|^application\/xml|^$/i.test(page.contentType)) throw new UmcError('UNSUPPORTED_MEDIA', page.contentType.split(';')[0]);
  if (page.truncated) warnings.push({ code: 'PARTIAL_RESULTS', message: 'The page was larger than the scan limit; only the first part was read.' });
  const ex = extractCandidates(page.text, page.finalUrl, { maxCandidates: ctx.maxCandidates || 200 });
  if (ex.truncated) warnings.push({ code: 'PARTIAL_RESULTS', message: `Candidate limit reached; ${ex.dropped} more were not listed.` });
  if (page.hops.length) warnings.push({ code: 'REDIRECTED', message: `Followed ${page.hops.length} redirect(s).` });
  const pageHost = new URL(page.finalUrl).hostname;
  const candidates = ex.candidates.map((c) => ({
    sourceUrl: c.sourceUrl, pageUrl: page.finalUrl, host: new URL(c.sourceUrl).hostname,
    kind: c.kind, mime: c.mime || null, mimeTrusted: 'none', filenameHint: hintFromUrl(c.sourceUrl), extHint: c.extHint,
    width: c.width, height: c.height, duration: c.duration, bytes: null, quality: c.quality, accessLevel: 'public',
    attribution: { title: c.title || '', pageTitle: ex.title, pageHost }, via: c.via, probed: false, acceptRanges: null, validators: null,
  }));
  if (!opts.skipProbe) await probeSome(candidates, ctx);
  return { kind: 'page', title: ex.title, finalUrl: page.finalUrl, candidates, warnings };
}

// Probe the first N candidates (ranged GET, 16 KB) within a time budget.
// Failures are recorded on the candidate, never thrown: a dead CDN link is
// information, not a scan failure.
async function probeSome(candidates, ctx) {
  const limit = Math.min(candidates.length, ctx.probeLimit == null ? 24 : ctx.probeLimit);
  const deadline = Date.now() + (ctx.probeBudgetMs || 12000);
  let i = 0;
  const worker = async () => {
    while (i < limit) {
      const c = candidates[i++];
      if (Date.now() > deadline || (ctx.signal && ctx.signal.aborted)) { c.probeError = { code: 'SKIPPED', message: 'Probe budget exhausted.' }; continue; }
      try {
        const p = await direct.probe(c.sourceUrl, { ...ctx, timeoutMs: Math.min(ctx.timeoutMs || 15000, 8000) });
        if (p.type.kind === 'html' || p.type.kind === 'manifest' || p.type.kind === 'other') {
          c.probed = true; c.probeError = { code: 'UNSUPPORTED_MEDIA', message: p.type.kind === 'html' ? 'Link returns a web page, not a file.' : `Not a media file (${p.type.mime}).` };
          continue;
        }
        c.probed = true; c.kind = p.type.kind; c.mime = p.type.mime; c.mimeTrusted = p.type.trusted; c.extHint = p.type.ext;
        c.bytes = p.size; c.acceptRanges = p.acceptRanges; c.validators = { etag: p.etag, lastModified: p.lastModified };
        if (p.dims) { c.width = c.width || p.dims.width; c.height = c.height || p.dims.height; c.dimsFrom = 'file-header'; }
        if (p.finalUrl !== c.sourceUrl) c.finalUrl = p.finalUrl;
      } catch (err) { c.probed = true; c.probeError = toPublic(err); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, limit) }, worker));
}

module.exports = { resolve, probeSome, robotsAllows };
