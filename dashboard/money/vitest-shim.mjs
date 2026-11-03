// The ported Ember tests were written for vitest; HQ runs node --test with zero deps.
// This maps the handful of matchers they use onto node:assert so the assertions stay
// VERBATIM — the same checks that held in Ember now hold on the ported ESM (that's the parity proof).
import { describe, it as nodeIt } from 'node:test';
import assert from 'node:assert/strict';

export { describe };
export const it = Object.assign((name, fn) => nodeIt(name, fn), {
  each: (rows) => (name, fn) => rows.forEach((row) => {
    const args = Array.isArray(row) ? row : [row];
    let i = 0;
    nodeIt(name.replace(/%[sdjo]/g, () => JSON.stringify(args[i++])), () => fn(...args));
  }),
});

// toMatchObject: every key in `exp` matches recursively; arrays must match element-wise
function subset(act, exp) {
  if (exp === null || typeof exp !== 'object') return Object.is(act, exp) || (typeof exp === 'number' && act === exp);
  if (act === null || typeof act !== 'object') return false;
  if (Array.isArray(exp)) return Array.isArray(act) && act.length === exp.length && exp.every((e, i) => subset(act[i], e));
  return Object.keys(exp).every((k) => subset(act[k], exp[k]));
}

function matchers(act, neg) {
  const ok = (cond, msg) => assert.ok(neg ? !cond : cond, (neg ? 'not ' : '') + msg);
  return {
    toBe: (e) => (neg ? assert.notStrictEqual(act, e) : assert.strictEqual(act, e)),
    toEqual: (e) => (neg ? assert.notDeepStrictEqual(act, e) : assert.deepStrictEqual(act, e)),
    toBeNull: () => ok(act === null, `expected null, got ${JSON.stringify(act)}`),
    toBeTruthy: () => ok(!!act, `expected truthy, got ${JSON.stringify(act)}`),
    toBeCloseTo: (e, digits = 2) => ok(Math.abs(act - e) < 10 ** -digits / 2, `expected ${act} ≈ ${e}`),
    toBeGreaterThan: (e) => ok(act > e, `expected ${act} > ${e}`),
    toBeLessThan: (e) => ok(act < e, `expected ${act} < ${e}`),
    toBeLessThanOrEqual: (e) => ok(act <= e, `expected ${act} <= ${e}`),
    toContain: (e) => ok(typeof act === 'string' ? act.includes(e) : act.includes(e), `expected ${JSON.stringify(act)} to contain ${JSON.stringify(e)}`),
    toHaveLength: (n) => ok(act.length === n, `expected length ${n}, got ${act && act.length}`),
    toMatchObject: (e) => ok(subset(act, e), `expected ${JSON.stringify(act)} to match ${JSON.stringify(e)}`),
  };
}
export const expect = (act) => Object.assign(matchers(act, false), { not: matchers(act, true) });
