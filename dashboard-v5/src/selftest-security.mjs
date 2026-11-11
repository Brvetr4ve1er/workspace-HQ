// Security space - the states the selftest walks (selftest.js loops them beside Cosmos' and Money's, in both themes).
//
//   securityStates()  -> [name, sub, securityLive, secState, extra][]          (the Cosmos row shape, selftest.js "cosmos-" rows)
//     securityLive    a LIVE.security slice, put straight into the store (LV.security = row[2]); the arrival read is held by the caller
//     secState        the `sec` component state this row sets (an object spread over secInit()); the caller puts it at state.sec
//     extra           any other state patch ({} for every row here)
//   securityFixture(opts)  the hq:security:read answer of the INVENTED footprint (also what the fake preload answers: tools/cdp-security.mjs
//                          exports it as fakeSecurityRead; example.test, acme.test, alpha-site.test, owner@example.test, nothing real)
//   passphraseLeaks(pass, { state, vals, storage })  the places a typed passphrase shows up: JSON of the app state, of the vals tree and of
//                          the (fake or real) storage. The selftest's "security-unlock-clears" check runs it at every step and wants [].
//
// This file is import-light on purpose (only the slice's emptySecurity) and does no IO: the unit test drives it in plain Node.
import { emptySecurity } from './live/security-slice.mjs';

/** Rows that need hq.security hidden for one combo (the store's hq, never window.hq), the way cosmos-offline hides hq.cosmos. */
export const SECURITY_OFFLINE_ROWS = Object.freeze(['security-offline']);
/** The passphrase the fake answers ok for (invented). */
export const FAKE_PASSPHRASE = 'correct horse example';
export const WRONG_PASSPHRASE_ERROR = 'wrong passphrase or key file';

const day = (n) => '2026-' + String(Math.floor(n / 28) + 1).padStart(2, '0') + '-' + String((n % 28) + 1).padStart(2, '0') + 'T08:00:00.000Z';
const A = (n, extra) => ({
  id: 'k-' + String(n).padStart(12, '0'), title: 'site ' + n, host: 'site' + n + '.example.test', group: 'Root/Web', created: day(n), modified: '2026-10-01T08:00:00.000Z',
  totp: false, passkey: false, strength: 'strong', reuseGroup: null, old: false, identityRef: 'i-aaaaaaaaaaaa', breached: false, ...(extra || {}),
});

/**
 * The invented answer of hq:security:read. opts: { lock: labels null, noBreach: breached null everywhere, many: n extra accounts (for the
 * fold row), empty: no map, noCli, noVault, exports: false = never scanned handled by the slice, conflicts: n }.
 */
export function securityFixture(opts = {}) {
  const o = opts || {};
  const accounts = [
    A(1, { title: 'example.test', host: 'example.test', strength: 'weak', reuseGroup: 1, created: '2025-02-10T08:00:00.000Z' }),
    A(2, { title: 'acme.test', host: 'acme.test', reuseGroup: 1, old: true, totp: true, created: '2025-04-02T08:00:00.000Z' }),
    A(3, { title: 'alpha-site.test', host: 'alpha-site.test', breached: true, passkey: true, created: '2025-09-15T08:00:00.000Z' }),
    A(4, { title: 'beta-shop.test', host: 'beta-shop.test', identityRef: 'i-bbbbbbbbbbbb', created: '2026-01-20T08:00:00.000Z' }),
    A(5, { title: 'gamma-mail.test', host: 'gamma-mail.test', totp: true, created: '2026-03-03T08:00:00.000Z' }),
    A(6, { title: 'delta-forum.test', host: 'delta-forum.test', identityRef: 'i-bbbbbbbbbbbb', created: '2026-06-18T08:00:00.000Z' }),
    A(7, { title: 'login.example.test', host: 'login.example.test', identityRef: null, created: '2026-08-25T08:00:00.000Z' }),
  ];
  for (let i = 0; i < (o.many || 0); i++) accounts.push(A(100 + i, { title: 'bulk ' + i, host: 'bulk' + i + '.example.test', identityRef: i % 2 ? 'i-bbbbbbbbbbbb' : 'i-aaaaaaaaaaaa', totp: true, created: day(i % 300) }));
  if (o.noBreach) for (const a of accounts) a.breached = null;
  const identities = [
    { ref: 'i-aaaaaaaaaaaa', kind: 'email', label: o.lock ? null : 'owner@example.test' },
    { ref: 'i-bbbbbbbbbbbb', kind: 'phone', label: o.lock ? null : '+1 555 010 0199' },
  ];
  const map = o.empty ? null : { v: 1, refreshedAt: '2026-11-10T09:00:00.000Z', accounts, identities };
  const owner = {
    v: 1,
    accounts: o.empty ? {} : { [accounts[3].id]: { twofa: 'sms', signInWith: accounts[2].id, recoveryRef: 'i-aaaaaaaaaaaa' }, [accounts[5].id]: { hiddenFromClaude: true } },
    manual: o.empty ? [] : [{ id: 'm-0123456789ab', title: 'old-hobby.test', host: 'old-hobby.test', createdAt: '2026-05-05T00:00:00.000Z' }],
    identities: [],
  };
  return {
    settings: { v: 1, vaultPath: o.noVault ? null : 'C:/placeholder/vault/example.kdbx', keyFilePath: null, cliPath: null, walkthrough: { 'email-2fa': { done: true, at: '2026-11-01T09:00:00.000Z' }, 'emergency-sheet': { done: true, at: '2026-11-02T09:00:00.000Z' } } },
    map, owner,
    snapshots: [
      { at: '2026-10-20T09:00:00.000Z', accounts: 5, identities: 2, flags: { weak: 1, reused: 2, breached: 0, no2fa: 3, old: 1, notInVault: 0 } },
      { at: '2026-11-01T09:00:00.000Z', accounts: 6, identities: 2, flags: { weak: 1, reused: 2, breached: 1, no2fa: 3, old: 1, notInVault: 1 } },
      { at: '2026-11-10T09:00:00.000Z', accounts: accounts.length, identities: 2, flags: { weak: 1, reused: 2, breached: 1, no2fa: 3, old: 1, notInVault: 1 } },
    ],
    status: { v: 1, at: '2026-11-10T09:00:00.000Z', refreshedAt: o.empty ? null : '2026-11-10T09:00:00.000Z', breachCheckedAt: o.noBreach ? null : '2026-11-10T09:00:00.000Z', exportsFound: 1, conflicts: Number.isFinite(o.conflicts) ? o.conflicts : 1, email2faDone: true, walkthroughStarted: true },
    cliFound: !o.noCli, vaultExists: !o.noVault,
  };
}

/** The plain-export scan the health rows show. */
export const FIXTURE_EXPORTS = Object.freeze([{ name: 'Chrome Passwords.csv', dir: 'C:/placeholder/Downloads', size: 4096, mtime: '2026-11-09T10:00:00.000Z' }]);

function liveOf(answer, over) {
  return Object.assign(emptySecurity(), {
    loaded: true, error: '', settings: answer.settings, map: answer.map, owner: answer.owner, snapshots: answer.snapshots, status: answer.status,
    cliFound: answer.cliFound, vaultExists: answer.vaultExists, exports: FIXTURE_EXPORTS.slice(), revision: 1,
  }, over || {});
}

/** @returns {Array<[string, string, object, object, object]>} */
export function securityStates() {
  const row = (name, sub, live, st, extra) => [name, sub, live, st || {}, extra || {}];
  const full = () => liveOf(securityFixture());
  const first = securityFixture().map.accounts[2].id;   // the breached one, with a passkey
  return [
    row('security-offline', 'map', emptySecurity()),
    row('security-loading', 'map', emptySecurity()),
    row('security-error', 'map', Object.assign(emptySecurity(), { loaded: true, error: 'selftest: synthetic read error' })),
    row('security-error-with-map', 'map', liveOf(securityFixture(), { error: 'selftest: synthetic read error' })),
    row('security-empty', 'map', liveOf(securityFixture({ empty: true, noVault: true }), { exports: null })),
    row('security-no-cli', 'map', liveOf(securityFixture({ empty: true, noCli: true }))),
    row('security-map-flags', 'map', full()),
    row('security-map-card', 'map', full(), { sel: first }),
    row('security-map-card-identity', 'map', full(), { sel: 'i-aaaaaaaaaaaa' }),
    row('security-map-slider', 'map', full(), { slider: 2 }),
    row('security-map-folded', 'map', liveOf(securityFixture({ many: 700 }))),
    row('security-map-form-account', 'map', full(), { form: 'account' }),
    row('security-map-form-error', 'map', full(), { form: 'identity', formErr: 'not an email or phone number' }),
    row('security-locked-labels', 'map', liveOf(securityFixture({ lock: true })), { sel: 'i-aaaaaaaaaaaa' }),
    row('security-breach-not-checked', 'health', liveOf(securityFixture({ noBreach: true }))),
    row('security-health', 'health', full()),
    row('security-health-clean', 'health', liveOf(securityFixture({ conflicts: 0 }), { exports: [] })),
    row('security-unlock-dialog', 'map', full(), { dlg: { busy: false, error: '', breaches: true } }),
    row('security-unlock-breaches-off', 'map', full(), { dlg: { busy: false, error: '', breaches: false } }),
    row('security-unlock-busy', 'map', full(), { dlg: { busy: true, error: '', breaches: true } }),
    row('security-unlock-error', 'map', full(), { dlg: { busy: false, error: WRONG_PASSPHRASE_ERROR, breaches: true } }),
    row('security-setup-half', 'setup', full()),
    row('security-setup-fresh', 'setup', liveOf(securityFixture({ empty: true, noCli: true, noVault: true }), { settings: { v: 1, vaultPath: null, walkthrough: {} }, exports: null })),
    row('security-setup-sheet', 'setup', full(), { sheet: true }),
    row('security-generator', 'generate', full()),
    row('security-generator-out', 'generate', full(), { gen: { kind: 'words', words: 7, chars: 20, sets: { lower: true, upper: true, digits: true, symbols: true }, out: { text: 'amber-pier-quiet-lemon-orbit-tulip-frost', bits: 73.9, kind: 'words' }, note: '', err: '' } }),
    row('security-generator-chars', 'generate', full(), { gen: { kind: 'chars', words: 7, chars: 20, sets: { lower: true, upper: true, digits: false, symbols: true }, out: { text: 'p7Zq-Rm!x3Lw?9Tb(Vk4', bits: 123.5, kind: 'chars' }, note: 'Copied; cleared from the clipboard after 30 s.', err: '' } }),
  ];
}

/**
 * Where does a typed passphrase show up? Each part is JSON-stringified (functions are dropped by JSON, which is the point: a handler cannot
 * carry text); returns the names of the parts that contain it. [] is the only passing answer.
 */
export function passphraseLeaks(pass, parts) {
  const p = typeof pass === 'string' ? pass : '';
  if (p.length < 4) return ['(a passphrase too short to check)'];
  const out = [];
  for (const [name, part] of Object.entries(parts || {})) {
    let text = '';
    try { text = JSON.stringify(part === undefined ? null : part, (_k, v) => (typeof v === 'function' ? undefined : v)) || ''; } catch { text = String(part); }
    if (text.includes(p)) out.push(name);
  }
  return out;
}
