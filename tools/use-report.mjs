#!/usr/bin/env node
// Use report: what the owner actually opened and acted on, as plain counts. Cut the next plan by this.
//   node tools/use-report.mjs [--days 7,14] [--dir <log folder>]      (--dir is for tests; default follows dashboard/app-log.js)
//
// Reads the day logs logs/app-YYYY-MM-DD.log ONLY, with the same rules as dashboard/use-counts.js: the folder is HQ_APP_LOG_DIR when
// absolute, else <repo>/logs; a file counts by the DATE in its name; only lines {event:'use', surface, action} count; garbage, other
// events, surfaces outside the use-log allowlist and actions outside its action list are ignored. Window n = today and the n-1 days before.
// Per surface: opens and acts, then the allowlisted surfaces never seen (features never used), then the first day each surface/action
// appears. "First" is the earliest RETAINED day file, never "ever": the report says how many day files it saw and from which date.
//
// Never writes, never touches the network, never spawns. The output holds only surface ids, action words, counts and dates: no names,
// ids, text or paths. The process ALWAYS exits 0; a missing or empty log folder prints one honest line.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const useLog = require('../dashboard/use-log.js');
const appLog = require('../dashboard/app-log.js');

export const DEFAULT_DAYS = Object.freeze([7, 14]);
export const MAX_DAYS = 366;
export const MAX_WINDOWS = 4;
export const MAX_READ = 8 * 1024 * 1024; // a day file is capped near 5 MiB by app-log; read it whole so counts are never silently short
export const LINE_NO_DIR = 'Use report: no day logs found yet (nothing to count).';
export const LINE_NO_MARKS = (files) => `Use report: ${files} day log${files === 1 ? '' : 's'} found, but no use marks in them yet (nothing to count).`;
export const LINE_BAD_DAYS = 'Use report: --days needs whole numbers such as 7,14 (nothing printed).';

const FILE_RE = appLog.FILE_RE || /^app-(\d{4})-(\d{2})-(\d{2})\.log$/;
const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayBefore = (d, n) => localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n));

export const surfaceList = () => [...(Array.isArray(useLog.SURFACES) ? useLog.SURFACES : [])];
export const actionList = () => [...(Array.isArray(useLog.ACTIONS) ? useLog.ACTIONS : [])];

// '7,14' -> [7,14]; anything else -> null (the caller says so honestly). Undefined -> the default.
export function parseDays(raw) {
  if (raw === undefined || raw === null) return [...DEFAULT_DAYS];
  if (typeof raw !== 'string' || !/^\d{1,3}(,\d{1,3})*$/.test(raw)) return null;
  const given = raw.split(',').map(Number);
  if (given.length > MAX_WINDOWS || given.some((n) => n < 1 || n > MAX_DAYS)) return null;
  return [...new Set(given)].sort((a, b) => a - b);
}

function readText(fsx, file) {
  const fd = fsx.openSync(file, 'r');
  try {
    const size = fsx.fstatSync(fd).size;
    const len = Math.max(0, Math.min(size, MAX_READ));
    if (!len) return '';
    const buf = Buffer.alloc(len);
    fsx.readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    try { fsx.closeSync(fd); } catch { /* nothing to do */ }
  }
}

// reads <dir> through the injected fs. Returns { dirFound, today, files: [{day, marks: [{surface, action}]}] sorted by day }; never throws.
export function collect({ dir, fs: fsx = fs, now = Date.now } = {}) {
  const out = { dirFound: false, today: '', files: [] };
  try {
    const t = now();
    const ms = t instanceof Date ? t.getTime() : Number(t);
    out.today = localDate(new Date(Number.isFinite(ms) ? ms : Date.now()));
  } catch { out.today = localDate(new Date()); }
  if (!dir) return out;
  let names;
  try { names = fsx.readdirSync(dir); } catch { return out; }
  out.dirFound = true;
  const known = new Set(surfaceList());
  const acts = new Set(actionList());
  for (const n of Array.isArray(names) ? names : []) {
    const m = typeof n === 'string' ? FILE_RE.exec(n) : null;
    if (!m) continue;
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    if (day > out.today) continue; // a future-dated file is not evidence of use
    let text;
    try { text = readText(fsx, path.join(dir, n)); } catch { continue; }
    const marks = [];
    for (const line of text.split('\n')) {
      if (line.charCodeAt(0) !== 123 || line.indexOf('"use"') < 0) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (!o || typeof o !== 'object' || o.event !== 'use') continue;
      if (typeof o.surface !== 'string' || !known.has(o.surface)) continue;
      if (typeof o.action !== 'string' || !acts.has(o.action)) continue;
      marks.push({ surface: o.surface, action: o.action });
    }
    out.files.push({ day, marks });
  }
  out.files.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return out;
}

// pure: (collect() result, days list) -> the numbers the text is made from
export function buildReport(col, days = DEFAULT_DAYS) {
  const known = surfaceList();
  const files = col && Array.isArray(col.files) ? col.files : [];
  const today = col && col.today ? col.today : localDate(new Date());
  const [ty, tm, td] = today.split('-').map(Number);
  const todayDate = new Date(ty, tm - 1, td);
  const windows = days.map((n) => {
    const from = dayBefore(todayDate, n - 1);
    const rows = new Map();
    let marks = 0;
    for (const f of files) {
      if (f.day < from || f.day > today) continue;
      for (const mk of f.marks) {
        marks++;
        const r = rows.get(mk.surface) || { surface: mk.surface, open: 0, act: 0, other: 0 };
        if (mk.action === 'open') r.open++; else if (mk.action === 'act') r.act++; else r.other++;
        rows.set(mk.surface, r);
      }
    }
    const list = [...rows.values()].sort((a, b) => (b.open + b.act + b.other) - (a.open + a.act + a.other) || (a.surface < b.surface ? -1 : 1));
    const never = known.filter((s) => !rows.has(s));
    return { days: n, from, to: today, marks, rows: list, never };
  });
  const first = new Map(); // surface -> { open?: day, act?: day } (earliest retained day file)
  for (const f of files) {
    for (const mk of f.marks) {
      if (mk.action !== 'open' && mk.action !== 'act') continue;
      const e = first.get(mk.surface) || {};
      if (!e[mk.action]) e[mk.action] = f.day; // files are sorted by day
      first.set(mk.surface, e);
    }
  }
  const totalMarks = files.reduce((a, f) => a + f.marks.length, 0);
  return {
    today,
    windows,
    retained: { files: files.length, from: files.length ? files[0].day : '', to: files.length ? files[files.length - 1].day : '' },
    totalMarks,
    first: [...first.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([surface, e]) => ({ surface, open: e.open || '', act: e.act || '' })),
  };
}

const col = (s, w) => String(s).padStart(w, ' ');

// pure: report object -> plain text (ends with a newline)
export function formatReport(rep) {
  if (!rep || !rep.retained || !rep.retained.files) return LINE_NO_DIR + '\n';
  if (!rep.totalMarks) return LINE_NO_MARKS(rep.retained.files) + '\n';
  const out = [];
  out.push('WorkspaceHQ use report (counts only)');
  out.push(`Day logs retained: ${rep.retained.files} (${rep.retained.from} to ${rep.retained.to}). "First" below means first in these files, not first ever.`);
  for (const w of rep.windows) {
    out.push('');
    out.push(`Last ${w.days} day${w.days === 1 ? '' : 's'} (${w.from} to ${w.to}), ${w.marks} mark${w.marks === 1 ? '' : 's'}`);
    if (w.rows.length) {
      const width = Math.max(7, ...w.rows.map((r) => r.surface.length));
      out.push('  ' + 'surface'.padEnd(width) + col('open', 7) + col('act', 7) + col('other', 7));
      for (const r of w.rows) out.push('  ' + r.surface.padEnd(width) + col(r.open, 7) + col(r.act, 7) + col(r.other, 7));
    } else {
      out.push('  no marks in this window');
    }
    out.push(`  never seen (${w.never.length}): ${w.never.length ? w.never.join(', ') : 'none'}`);
  }
  out.push('');
  out.push('First use in the retained day files');
  if (rep.first.length) {
    const width = Math.max(7, ...rep.first.map((r) => r.surface.length));
    for (const r of rep.first) out.push('  ' + r.surface.padEnd(width) + '  open ' + (r.open || '-') + '   act ' + (r.act || '-'));
  } else {
    out.push('  none');
  }
  return out.join('\n') + '\n';
}

export function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && typeof argv[i + 1] === 'string' ? argv[i + 1] : undefined;
}

// the whole run: argv + env + injected fs/now -> text (never throws)
export function run({ argv = [], env = process.env, appRoot, fs: fsx = fs, now = Date.now } = {}) {
  try {
    const days = parseDays(argValue(argv, '--days'));
    if (!days) return LINE_BAD_DAYS + '\n';
    const flagDir = argValue(argv, '--dir');
    const dir = flagDir ? path.resolve(flagDir) : appLog.resolveDir(env, appRoot);
    const found = collect({ dir, fs: fsx, now });
    if (!found.dirFound || !found.files.length) return LINE_NO_DIR + '\n';
    return formatReport(buildReport(found, days));
  } catch {
    return LINE_NO_DIR + '\n';
  }
}

function main() {
  let text = LINE_NO_DIR + '\n';
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    text = run({ argv: process.argv.slice(2), env: process.env, appRoot: path.join(here, '..') });
  } catch { text = LINE_NO_DIR + '\n'; }
  process.stdout.write(text);
  process.exitCode = 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
