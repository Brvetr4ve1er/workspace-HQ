'use strict';
// Error taxonomy — stable codes, plain-language messages, and the next useful
// action when one exists. Every failure the renderer ever sees is one of these
// (toPublic() strips stack traces and never carries a URL query string).

const CATALOG = {
  INVALID_URL:            { message: 'That is not a usable web address.',                       next: 'Paste a full http:// or https:// link to a page or a media file.' },
  UNSUPPORTED_SCHEME:     { message: 'Only http and https links are supported.',                next: 'Paste an http:// or https:// link.' },
  UNSUPPORTED_SOURCE:     { message: 'This site is not supported through an approved path.',    next: 'Open the page in your browser, use the platform export flow, or paste a direct media link.' },
  AUTHORIZATION_REQUIRED: { message: 'This source needs an authorized account connection.',     next: 'See Sources for what this platform allows and how to connect an official API.' },
  ACCESS_DENIED:          { message: 'The server refused the request.',                         next: 'The content may be private or need a login. Nothing was bypassed.' },
  RATE_LIMITED:           { message: 'The server asked us to slow down.',                       next: 'Wait a moment and retry. The queue backs off automatically.' },
  ROBOTS_OR_POLICY_BLOCK: { message: 'The site asks automated tools not to read this page.',    next: 'Open the page in your browser, or paste a direct media link instead.' },
  NO_MEDIA_FOUND:         { message: 'No media was found on this page.',                        next: 'The media may load with scripts or need a login. Try a direct media link.' },
  PARTIAL_RESULTS:        { message: 'Results are partial: a limit was reached while scanning.', next: 'Raise the scan limits in Settings, or paste a more specific link.' },
  UNSUPPORTED_MEDIA:      { message: 'The response is not a media file we can save.',           next: 'Check the link in a browser. It may be an HTML page or a stream manifest.' },
  NETWORK_TIMEOUT:        { message: 'The server did not respond in time.',                     next: 'Check your connection and retry.' },
  SOURCE_UNAVAILABLE:     { message: 'The source could not be reached.',                        next: 'Retry later. The server may be down or the link expired.' },
  FILE_TOO_LARGE:         { message: 'The file is larger than the configured limit.',           next: 'Raise the maximum file size in Settings if you really want it.' },
  DISK_FULL:              { message: 'There is not enough free space at the destination.',      next: 'Free space or choose another destination folder.' },
  FILE_CONFLICT:          { message: 'A file with this name already exists.',                   next: 'Choose skip, rename, or replace.' },
  INTEGRITY_CHECK_FAILED: { message: 'The saved bytes do not match what the server announced.', next: 'Retry the download. The partial file was removed.' },
  CANCELLED:              { message: 'Cancelled.',                                              next: '' },
};

class UmcError extends Error {
  constructor(code, detail, extra) {
    const entry = CATALOG[code] || CATALOG.SOURCE_UNAVAILABLE;
    super(entry.message + (detail ? ` (${detail})` : ''));
    this.name = 'UmcError';
    this.code = CATALOG[code] ? code : 'SOURCE_UNAVAILABLE';
    this.detail = detail || '';
    this.next = entry.next;
    this.extra = extra || null;
    this.permanent = ['INVALID_URL', 'UNSUPPORTED_SCHEME', 'UNSUPPORTED_SOURCE', 'AUTHORIZATION_REQUIRED',
      'ACCESS_DENIED', 'ROBOTS_OR_POLICY_BLOCK', 'UNSUPPORTED_MEDIA', 'FILE_TOO_LARGE', 'CANCELLED'].includes(this.code);
  }
}

const isUmc = (e) => e instanceof UmcError || (e && typeof e.code === 'string' && CATALOG[e.code]);

// Map a raw Node/network failure onto the taxonomy. Keeps the original
// code in `detail` for diagnostics (never the URL).
function fromNative(err) {
  if (isUmc(err)) return err;
  const c = (err && err.code) || '';
  if (c === 'ENOSPC') return new UmcError('DISK_FULL', c);
  if (c === 'ABORT_ERR' || c === 'ABORTED' || (err && err.name === 'AbortError')) return new UmcError('CANCELLED');
  if (c === 'ETIMEDOUT' || c === 'ECONNRESET' || c === 'UND_ERR_HEADERS_TIMEOUT' || c === 'UND_ERR_BODY_TIMEOUT') return new UmcError('NETWORK_TIMEOUT', c);
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN' || c === 'ECONNREFUSED' || c === 'EHOSTUNREACH' || c === 'ENETUNREACH' || c === 'CERT_HAS_EXPIRED' || /^ERR_TLS/.test(c) || /CERT/.test(c)) {
    return new UmcError('SOURCE_UNAVAILABLE', c);
  }
  return new UmcError('SOURCE_UNAVAILABLE', c || (err && err.message ? err.message.slice(0, 80) : 'unknown'));
}

// Map an HTTP status onto the taxonomy.
function fromStatus(status, headers) {
  if (status === 401 || status === 403 || status === 451) return new UmcError('ACCESS_DENIED', `HTTP ${status}`);
  if (status === 404 || status === 410) return new UmcError('SOURCE_UNAVAILABLE', `HTTP ${status}`);
  if (status === 429) {
    const ra = headers && headers['retry-after'];
    const secs = ra ? Number.parseInt(String(ra), 10) : NaN;
    return new UmcError('RATE_LIMITED', `HTTP 429`, { retryAfterMs: Number.isFinite(secs) ? Math.min(secs, 120) * 1000 : null });
  }
  if (status >= 500) return new UmcError('SOURCE_UNAVAILABLE', `HTTP ${status}`);
  return new UmcError('SOURCE_UNAVAILABLE', `HTTP ${status}`);
}

// What crosses the IPC boundary. No stack, no URL, no headers.
function toPublic(err) {
  const e = isUmc(err) ? err : fromNative(err);
  return { code: e.code, message: CATALOG[e.code].message, detail: e.detail || '', next: e.next || CATALOG[e.code].next, extra: e.extra || null };
}

module.exports = { CATALOG, UmcError, isUmc, fromNative, fromStatus, toPublic };
