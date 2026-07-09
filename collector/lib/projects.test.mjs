import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildProject, deterministicCompletion } from './projects.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RAW = JSON.parse(readFileSync(join(here, '__fixtures__', 'raw-metrics.sample.json'), 'utf8'));
// schema/ lives at the repo root — two levels up from collector/lib/.
const GCFG = JSON.parse(readFileSync(join(here, '..', '..', 'schema', 'gamification.config.json'), 'utf8'));
const rp = RAW.products.find((p) => !p.missing);

test('deterministicCompletion stays within [3, 95]', () => {
  const pct = deterministicCompletion(rp);
  assert.ok(pct >= 3 && pct <= 95);
});

test('buildProject returns a product with id, level, metrics', () => {
  const p = buildProject(rp, { prevProj: new Map(), enrichProj: {}, config: GCFG });
  assert.equal(p.id, rp.id);
  assert.equal(p.kind, 'product');
  assert.ok(p.metrics.git_safety);
  assert.ok(typeof p.level === 'number');
});
