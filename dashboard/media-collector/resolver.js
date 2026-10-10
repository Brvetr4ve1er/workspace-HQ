'use strict';
// Resolver — SourceDetector → adapter → normalized ResolverResult.
// ResolverResult: { pageUrl, source, capability, title, candidates[],
//                   warnings[], nextAction, scannedAt, error? }
// A failure is also a ResolverResult (error set, candidates []) so the UI has
// one shape to render — the capability + next action travel with the error.
const crypto = require('node:crypto');
const { detect } = require('./source-detector');
const { capability, STATE_LABEL } = require('./sources');
const { toPublic, UmcError } = require('./errors');
const direct = require('./adapters/direct');
const webpage = require('./adapters/webpage');
const platform = require('./adapters/platform');

const cid = (c) => crypto.createHash('sha1').update(`${c.sourceUrl}\n${c.pageUrl || ''}`).digest('hex').slice(0, 16);

function capInfo(id) { const c = capability(id); return { id: c.id, label: c.label, state: c.state, stateLabel: STATE_LABEL[c.state] || c.state, nextAction: c.nextAction }; }

async function resolve(input, ctx = {}) {
  const scannedAt = new Date().toISOString();
  let detected;
  try { detected = detect(input, { allowPrivate: !!ctx.allowPrivate }); }
  catch (err) { return { pageUrl: null, source: null, capability: null, title: '', candidates: [], warnings: [], nextAction: toPublic(err).next, scannedAt, error: toPublic(err) }; }
  const base = { pageUrl: detected.url, source: detected.source, capability: capInfo(detected.source), title: '', candidates: [], warnings: [], nextAction: '', scannedAt, error: null };
  try {
    let r;
    if (detected.source === 'direct') {
      r = await direct.resolve(detected, ctx);
      if (r.kind === 'html') {
        base.warnings.push({ code: 'LINK_IS_PAGE', message: 'The link returned a web page, so it was scanned as a page.' });
        base.source = 'webpage'; base.capability = capInfo('webpage');
        r = await webpage.resolve({ ...detected, url: r.probe.finalUrl, source: 'webpage' }, ctx);
      }
    } else if (detected.source === 'webpage') {
      r = await webpage.resolve(detected, ctx);
      if (r.kind === 'redirect-direct') {
        base.warnings.push({ code: 'PAGE_IS_FILE', message: 'The page link is a media file itself.' });
        base.source = 'direct'; base.capability = capInfo('direct');
        r = await direct.resolve({ ...detected, url: r.finalUrl, source: 'direct' }, ctx);
        if (r.kind === 'html') throw new UmcError('UNSUPPORTED_MEDIA', 'inconsistent content type');
      }
    } else {
      r = platform.resolve(detected, ctx);   // throws by design
    }
    const list = r.kind === 'media' ? [r.candidate] : r.candidates;
    for (const c of list) c.id = cid(c);
    base.title = r.title || (list[0] && list[0].filenameHint) || '';
    base.candidates = list;
    base.warnings.push(...(r.warnings || []));
    if (!list.length) base.error = toPublic(new UmcError('NO_MEDIA_FOUND'));
    base.nextAction = base.error ? base.error.next : (base.source === 'direct' ? 'Choose a destination and save.' : 'Select the candidates you want and add them to the queue.');
    return base;
  } catch (err) {
    base.error = toPublic(err);
    base.nextAction = base.capability && base.capability.nextAction && (err.code === 'AUTHORIZATION_REQUIRED' || err.code === 'UNSUPPORTED_SOURCE') ? base.capability.nextAction : base.error.next;
    return base;
  }
}

module.exports = { resolve, cid };
