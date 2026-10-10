'use strict';
// Honest adapter boundaries for platforms whose approved access paths are
// not integrated in this version. Each returns a ResolverResult with zero
// candidates, the capability state, and the next useful action. No scraping
// fallback exists here on purpose.
const { capability } = require('../sources');
const { UmcError } = require('../errors');

function resolve(detected) {
  const cap = capability(detected.source);
  if (cap.state === 'authorization-required') throw new UmcError('AUTHORIZATION_REQUIRED', cap.label, { source: cap.id });
  throw new UmcError('UNSUPPORTED_SOURCE', cap.label, { source: cap.id });
}

module.exports = { resolve };
