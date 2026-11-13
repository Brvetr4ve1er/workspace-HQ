#!/usr/bin/env node
// Brief lines: up to three plain lines from the local Brief, for an optional SessionStart hook.
//   node tools/brief-lines.mjs [--data <dir>]      (default <repo>/data; --data is for tests)
//
// Reads <data>/brief.json ONLY. Never writes, never touches the network, never spawns. Every printed word comes from the
// Brief's screen-safe projection (dashboard/brief-project.mjs: a fixed wording table keyed by rule id), never from the
// raw items, which carry project names, paths and amounts. No ref, key, rule id, nav, name, path or amount is printed.
// The process ALWAYS exits 0: a SessionStart hook must never block a session, so every failure path prints one line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_ITEMS = 3;
export const MAX_CHARS = 600;
export const MAX_BYTES = 8 * 1024 * 1024;
export const LINE_NONE = 'Brief: nothing needs you';
export const LINE_MISSING = 'Brief: not available yet (WorkspaceHQ has not written one)';

export function ageWords(min) {
  if (!Number.isFinite(min) || min < 0) return 'time unknown';
  if (min < 120) return Math.floor(min) + ' min';
  if (min < 48 * 60) return Math.floor(min / 60) + ' h';
  return Math.floor(min / 1440) + ' days';
}

// pure: (parsed brief.json | anything, projectBrief, now ms) -> array of lines (never empty, never throws)
export function linesFor(raw, projectBrief, now) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [LINE_MISSING];
    // an object that is not shaped like a brief at all ({} or foreign JSON) is "not written yet", not "empty"
    if (!Array.isArray(raw.items) && typeof raw.generatedAt !== 'string') return [LINE_MISSING];
    const p = projectBrief(raw, { now });
    if (!p) return [LINE_MISSING];
    if (p.stale) {
      const when = p.ageMinutes === null ? 'time unknown' : ageWords(p.ageMinutes) + ' ago';
      return ['Brief: out of date, last updated ' + when + ' (the app may be closed)'];
    }
    const out = p.items.slice(0, MAX_ITEMS).map((it) => it.sevWord + ': ' + it.text);
    if (p.more > 0 && p.overflowLine) out.push(p.overflowLine);
    return out.length ? out : [LINE_NONE];
  } catch {
    return [LINE_MISSING];
  }
}

export function clip(lines) {
  let s = lines.join('\n');
  if (s.length > MAX_CHARS) s = s.slice(0, MAX_CHARS);
  return s + '\n';
}

export function dataDirFrom(argv, fallback) {
  const i = argv.indexOf('--data');
  return i >= 0 && typeof argv[i + 1] === 'string' && argv[i + 1] ? path.resolve(argv[i + 1]) : fallback;
}

export function readBrief(dir) {
  try {
    const file = path.join(dir, 'brief.json');
    if (fs.statSync(file).size > MAX_BYTES) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  let text = LINE_MISSING + '\n';
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dir = dataDirFrom(process.argv.slice(2), path.join(here, '..', 'data'));
    const { projectBrief } = await import('../dashboard/brief-project.mjs');
    text = clip(linesFor(readBrief(dir), projectBrief, Date.now()));
  } catch {
    text = LINE_MISSING + '\n';
  }
  process.stdout.write(text);
  process.exitCode = 0;
}

const isMain = (() => { try { return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main().catch(() => { process.stdout.write(LINE_MISSING + '\n'); process.exitCode = 0; });
