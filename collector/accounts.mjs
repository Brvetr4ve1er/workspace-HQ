// CONNECTED ACCOUNTS runner — reads the owner's Vercel and Supabase accounts through their own
// CLI logins (no stored token), shapes them with lib/accounts.mjs and writes data/accounts.json
// (gitignored). Read-only: `vercel api` GETs and `supabase projects list` only.
//   run:  node collector/accounts.mjs [--max-age=<seconds>]
// A snapshot younger than --max-age (default 600) is kept, like collector/github.mjs.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shapeVercel, shapeSupabase, failedAccount, sidecar, MAX_AGE_MS } from './lib/accounts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'accounts.json');
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const writeAtomic = (f, data) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); };
const firstLine = (r) => String(r.stderr || r.stdout || (r.error && r.error.message) || 'failed').trim().split('\n').pop().slice(0, 200);

// The Vercel CLI is a Node script (npm global); run it with node directly — a .cmd shim needs a shell
function vercelCli() {
  const npm = process.env.HQ_NPM_DIR || path.join(process.env.APPDATA || '', 'npm');
  const vc = path.join(npm, 'node_modules', 'vercel', 'dist', 'vc.js');
  if (!fs.existsSync(vc)) return null;
  const node = spawnSync('node', ['--version'], { windowsHide: true, timeout: 10000 }).status === 0 ? 'node' : process.execPath;
  return (args) => spawnSync(node, [vc, ...args, '--no-color'], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0' } });
}

function vercel(nowMs, prev) {
  const vc = vercelCli();
  if (!vc) return failedAccount('no-cli', 'Vercel CLI not installed — npm i -g vercel, then vercel login', nowMs, prev);
  const who = vc(['whoami']);
  if (who.status !== 0) return failedAccount('signed-out', 'Not signed in to Vercel — run: vercel login', nowMs, prev);
  const get = (endpoint) => {
    const r = vc(['api', endpoint]);
    if (r.status !== 0) throw new Error(endpoint.split('?')[0] + ': ' + firstLine(r));
    const s = r.stdout, i = s.indexOf('{');
    return JSON.parse(i >= 0 ? s.slice(i) : s);
  };
  let user = null, projects;
  const errors = [];
  try { projects = get('/v9/projects?limit=100').projects; } catch (e) { return failedAccount('error', e.message, nowMs, prev); }
  try { user = get('/v2/user').user; } catch (e) { errors.push(e.message); user = { username: who.stdout.trim().split('\n').pop() }; }
  let deployments = [], teams = [];
  try { deployments = get('/v6/deployments?limit=20').deployments; } catch (e) { errors.push(e.message); }
  try { teams = get('/v2/teams').teams; } catch (e) { errors.push(e.message); }
  return shapeVercel({ user, projects, deployments, teams, nowMs, errors });
}

function supabase(nowMs, prev) {
  const r = spawnSync('supabase', ['projects', 'list', '-o', 'json'], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  if (r.error && r.error.code === 'ENOENT') return failedAccount('no-cli', 'Supabase CLI not installed — install it (supabase.com/docs/guides/cli), then supabase login', nowMs, prev);
  if (r.status !== 0) {
    const why = firstLine(r);
    return failedAccount(/access token|login|unauthor/i.test(why) ? 'signed-out' : 'error', /access token|login|unauthor/i.test(why) ? 'Not signed in to Supabase — run: supabase login' : why, nowMs, prev);
  }
  try { return shapeSupabase({ list: JSON.parse(r.stdout), nowMs }); } catch (e) { return failedAccount('error', 'unreadable answer: ' + e.message, nowMs, prev); }
}

function main() {
  const nowMs = Date.now();
  const arg = process.argv.find((a) => a.startsWith('--max-age='));
  const maxAgeMs = arg ? Math.max(0, Number(arg.slice(10)) * 1000 || 0) : MAX_AGE_MS;
  const prev = readJson(OUT, null) || {};
  const fresh = (a) => a && a.state === 'ok' && !a.stale && Date.parse(a.at) > nowMs - maxAgeMs;
  const v = fresh(prev.vercel) ? prev.vercel : vercel(nowMs, prev.vercel);
  const s = fresh(prev.supabase) ? prev.supabase : supabase(nowMs, prev.supabase);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  writeAtomic(OUT, JSON.stringify(sidecar(v, s), null, 2));
  const line = (name, a, n) => name + ' ' + (a.state === 'ok' ? n + (a.stale ? ' (stale)' : '') : a.state);
  console.log('[accounts] ' + line('vercel', v, (v.totals ? v.totals.projects : 0) + ' projects, ' + (v.totals ? v.totals.prodFailing : 0) + ' failing in production') + ' · ' + line('supabase', s, (s.totals ? s.totals.projects : 0) + ' projects') + ' → ' + path.relative(ROOT, OUT));
}

main();
