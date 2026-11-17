// node --test dashboard/dev-command-core.test.mjs
// The dev command grammar (dev-command-core.mjs): per-runner shapes, every refusal, the pinned word lists, the key and the shown hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDevCommand, devKey, hashShown, cleanEntry, ENV_ALLOW, WORDS, ALLOW_WORDS, MAX_LINE } from './dev-command-core.mjs';
import { hashShown as rendererHash } from '../dashboard-v5/src/logic/dev-allow.mjs';

const ok = (t) => { const r = parseDevCommand(t); assert.equal(r.ok, true, t + ' -> ' + JSON.stringify(r)); return r; };
const no = (t, why) => { const r = parseDevCommand(t); assert.equal(r.ok, false, JSON.stringify(t) + ' must be refused'); if (why) assert.equal(r.why, why, JSON.stringify(t)); return r; };

test('each runner has one pinned argument list', () => {
  assert.deepEqual(ok('npm run dev').words, ['npm', 'run', 'dev']);
  assert.deepEqual(ok('npm start').words, ['npm', 'start']);
  assert.deepEqual(ok('pnpm run build:watch').words, ['pnpm', 'run', 'build:watch']);
  assert.deepEqual(ok('pnpm dev').words, ['pnpm', 'dev']);
  assert.deepEqual(ok('yarn dev').words, ['yarn', 'dev']);
  assert.deepEqual(ok('bun run dev_server').words, ['bun', 'run', 'dev_server']);
  assert.deepEqual(ok('node server.js').words, ['node', 'server.js']);
  assert.deepEqual(ok('node src/app/main.mjs').words, ['node', 'src/app/main.mjs']);
});

test('the scripts a command runs are the named one plus its pre and post; node and a bare start have their own', () => {
  assert.deepEqual(ok('npm run dev').scripts, ['dev', 'predev', 'postdev']);
  assert.deepEqual(ok('npm start').scripts, ['start', 'prestart', 'poststart']);
  assert.deepEqual(ok('pnpm dev').scripts, ['dev', 'predev', 'postdev']);
  assert.deepEqual(ok('node server.js').scripts, []);
  assert.equal(ok('node server.js').file, 'server.js');
});

test('the only suffix is --port and digits, with -- in front as written', () => {
  assert.equal(ok('npm run dev -- --port 5173').port, 5173);
  assert.equal(ok('npm run dev --port 3000').port, 3000);
  assert.equal(ok('yarn dev --port 8080').port, 8080);
  assert.equal(ok('node server.js --port 4000').port, 4000);
  assert.deepEqual(ok('npm run dev -- --port 5173').words, ['npm', 'run', 'dev', '--', '--port', '5173']);
  for (const t of ['npm run dev --port', 'npm run dev --port abc', 'npm run dev --port 0', 'npm run dev --port 70000', 'npm run dev --host 0.0.0.0', 'npm run dev -- --open', 'npm run dev --port 3000 --open', 'npm run dev -- -- --port 3000'])
    no(t, 'suffix');
});

test('every shell symbol, percent sign and control character is refused', () => {
  for (const sym of ['&', '&&', '|', '||', ';', '>', '<', '`', '$', '(', ')', '{', '}', '*', '?', '"', "'", '\\', '^', '!', '%', '~', '#', '=', ',', '@']) {
    no('npm run dev' + sym + 'x');
    no('npm run dev ' + sym + ' calc');
    no('node server' + sym + '.js');
  }
  no('npm run dev %PATH%');
  no('npm run dev\nnpm run evil', 'control');
  no('npm run dev\r', 'control');
  no('npm run dev\tx', 'control');
  no('npm run dev\u0000', 'control');
  no('npm run dev\u007f', 'control');
});

test('npx, bunx, exec, dlx, init and install are refused anywhere', () => {
  for (const t of ['npx vite', 'bunx vite', 'pnpm dlx vite', 'pnpm exec vite', 'yarn dlx vite', 'npm init', 'npm install', 'npm run install', 'npm run init', 'bun install', 'pnpm install', 'yarn install', 'npm exec vite', 'npm run dev install']) no(t, 'runner');
});

test('node options that run code are refused', () => {
  for (const t of ['node -e x', 'node -p 1', 'node --eval x', 'node --print x', 'node --require=x server.js', 'node --require x server.js', 'node -r x server.js', 'node --import x server.js', 'node --import=x server.js', 'node --loader x server.js', 'node --experimental-loader=x server.js', 'npm run dev --script-shell sh', 'npm run dev --script-shell=sh']) no(t, 'option');
});

test('a node file is relative, forward slashes only, inside the folder, and a script file', () => {
  for (const t of ['node /etc/x.js', 'node C:/x.js', 'node C:\\x.js', 'node ../x.js', 'node a/../../x.js', 'node ./x.js', 'node a//x.js', 'node a\\x.js', 'node -x.js', 'node x.sh', 'node x', 'node x.json', 'node a/./x.js', 'node']) no(t);
  no('node \\\\host\\s\\x.js', 'file');
});

test('the name rule: lower case, digits, colon, underscore, dash, no leading dash', () => {
  for (const t of ['npm run Dev', 'npm run -dev', 'npm run de v', 'npm run dev.x', 'npm run', 'pnpm run', 'bun run', 'yarn -x', 'yarn Dev', 'npm run dev/x']) no(t);
  ok('npm run a1:b_c-d');
});

test('yarn <name> is never one of yarn’s own commands; other bare commands are not on the list', () => {
  for (const n of ['add', 'remove', 'up', 'upgrade', 'link', 'publish', 'config', 'global', 'set', 'create', 'node', 'plugin', 'npm', 'workspace', 'run']) no('yarn ' + n, 'name');
  for (const t of ['pnpm start', 'pnpm add x', 'pnpm', 'bun dev', 'bun x vite', 'deno task dev', 'python -m http.server 5500', 'vite', 'next dev', 'cmd /c dev', 'powershell dev', 'dotnet run', 'npm test', 'npm run-script dev', 'npm', '']) no(t);
});

test('empty, blank and over-long lines are refused', () => {
  no('', 'empty'); no('   ', 'empty'); no(null, 'empty'); no(undefined, 'empty'); no({}, 'empty');
  no('npm run ' + 'a'.repeat(MAX_LINE), 'long');
  no('npm run dev ' + 'x '.repeat(10), 'shape');
});

test('a loop over invented scan lines: what runs, what does not', () => {
  const GOOD = ['npm run dev', 'npm run dev -- --port 5173', 'npm start', 'pnpm dev', 'pnpm run serve', 'yarn start-dev', 'bun run dev', 'node server.js', 'node scripts/serve.mjs --port 4173'];
  const BAD = ['python -m http.server 5500', 'npm run dev && npm run api', 'npx serve .', 'cd app && npm run dev', 'npm run dev | tee log', 'start http://localhost', 'dotnet watch run',
    'npm run dev > out.txt', 'NODE_ENV=production npm run dev', 'set X=1 && npm run dev', 'node ../other/server.js', 'node C:\\x\\y.js', 'npm run dev;calc', 'cmd /c npm run dev', 'npm run "dev"'];
  for (const t of GOOD) ok(t);
  for (const t of BAD) no(t);
});

test('the key binds folder, words, scripts and config files; any change moves it', () => {
  const base = { folder: 'c:/p/a', words: ['npm', 'run', 'dev'], scripts: { dev: 'vite', predev: null, postdev: null }, rc: { '.npmrc': null } };
  const k = devKey(base);
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(devKey(JSON.parse(JSON.stringify(base))), k, 'same inputs, same key');
  assert.equal(devKey({ ...base, scripts: { postdev: null, dev: 'vite', predev: null } }), k, 'key order does not matter');
  assert.notEqual(devKey({ ...base, folder: 'c:/p/b' }), k);
  assert.notEqual(devKey({ ...base, words: ['npm', 'run', 'dev', '--', '--port', '1'] }), k);
  assert.notEqual(devKey({ ...base, scripts: { ...base.scripts, dev: 'vite --host' } }), k);
  assert.notEqual(devKey({ ...base, scripts: { ...base.scripts, predev: 'node x.js' } }), k);
  assert.notEqual(devKey({ ...base, rc: { '.npmrc': 'script-shell=sh' } }), k);
  assert.doesNotThrow(() => devKey(null));
});

test('the shown hash is 8 hex chars, deterministic, and the renderer copy agrees on every input', () => {
  assert.match(hashShown('npm run dev'), /^[0-9a-f]{8}$/);
  assert.equal(hashShown('npm run dev'), hashShown('npm run dev'));
  assert.notEqual(hashShown('npm run dev'), hashShown('npm run dev '));
  for (const t of ['', 'npm run dev', 'node server.js --port 3000', 'caf\u00e9', '\ud83d\ude00', null, undefined, 'a'.repeat(300)]) assert.equal(rendererHash(t), hashShown(t), JSON.stringify(t));
});

test('a stored entry survives only when well formed', () => {
  const good = { words: ['npm', 'run', 'dev'], key: 'a'.repeat(64), confirmedAt: '2026-11-17T10:00:00.000Z' };
  assert.deepEqual(cleanEntry(good), good);
  for (const bad of [null, [], 'x', {}, { ...good, words: [] }, { ...good, words: [1] }, { ...good, key: 'xyz' }, { ...good, confirmedAt: 'nope' }, { ...good, words: new Array(9).fill('a') }]) assert.equal(cleanEntry(bad), null);
});

test('the environment allowlist holds names, not a token or a key', () => {
  assert.ok(ENV_ALLOW.includes('PATH') && ENV_ALLOW.includes('SystemRoot'));
  assert.ok(!ENV_ALLOW.some((n) => /token|key|secret|pass|github|npm_config|electron/i.test(n)), ENV_ALLOW.join());
  assert.deepEqual(Object.values(WORDS).sort(), ['busy', 'refused', 'running', 'started', 'unconfirmed']);
  assert.deepEqual(Object.values(ALLOW_WORDS).sort(), ['allowed', 'busy', 'changed', 'refused']);
});
