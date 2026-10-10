const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAllowed } = require('../robots');

const txt = `
User-agent: *
Disallow: /private/
Allow: /private/ok.html
Disallow: /*.pdf$

User-agent: WorkspaceHQ-MediaCollector
Disallow: /nope/
`;

test('robots: star group, longest match, wildcards, anchors', () => {
  assert.equal(isAllowed(txt, '/public/x.html', 'otherbot'), true);
  assert.equal(isAllowed(txt, '/private/x.html', 'otherbot'), false);
  assert.equal(isAllowed(txt, '/private/ok.html', 'otherbot'), true);
  assert.equal(isAllowed(txt, '/docs/a.pdf', 'otherbot'), false);
  assert.equal(isAllowed(txt, '/docs/a.pdfx', 'otherbot'), true);
});

test('robots: our own group wins over *', () => {
  assert.equal(isAllowed(txt, '/nope/x'), false);
  assert.equal(isAllowed(txt, '/private/x.html'), true);   // our group has no /private rule
});

test('robots: empty/missing/garbage means allowed', () => {
  assert.equal(isAllowed('', '/x'), true);
  assert.equal(isAllowed(null, '/x'), true);
  assert.equal(isAllowed('garbage ::: text', '/x'), true);
});
