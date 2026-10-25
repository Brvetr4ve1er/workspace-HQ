// Prompt harvest (spec 2026-10-15 §6.2, phase P2). Pure: no I/O, no store. Every scored term is returned as a
// reason {key, points, text}; the texts state facts (counts), never a judgment of the prompt.
import crypto from 'node:crypto';
import { MASK } from './redact.mjs';

export const HARVEST_MIN_CHARS = 120;
export const HARVEST_LIMIT = 50;
export const HARVEST_LIMIT_MAX = 200;
export const LONG_CHARS = 300;
export const TURNS_CAP = 20;
export const MASK_MARK = MASK('').slice(0, MASK('').indexOf('(') + 1);   // '••• secret ('
const KINDS = new Set(['code', 'web', 'chatgpt', 'history']);
const MAX_SOURCES = 5;
const pts = (n) => Math.round(n * 100) / 100;
const chars = (s) => [...s].length;

export function normalize(text) {
  return String(text == null ? '' : text).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
export const candidateKey = (norm) => 'cand:' + crypto.createHash('sha1').update(String(norm)).digest('hex');

export function excludeReason(row) {
  const r = row && typeof row === 'object' ? row : {};
  if (!KINDS.has(r.kind)) return 'source';
  if (r.kind !== 'history' && r.role !== 'user') return 'role';
  if (r.pasted) return 'pasted';
  const t = String(r.text == null ? '' : r.text).trim();
  if (chars(normalize(t)) < HARVEST_MIN_CHARS) return 'short';
  if (t.startsWith('/') || /^<command-(name|message)>/.test(t)) return 'slash';
  if (t.includes(MASK_MARK)) return 'secret';
  if (t.includes('<local-command')) return 'local-command';
  return null;
}

const newer = (a, b) => String(b || '').localeCompare(String(a || ''));   // ISO strings; null/'' sort last

function reasonsOf(g, inLibrary) {
  const out = [];
  const s = g.sessions.size;
  out.push(s >= 2 ? { key: 'reuse', points: 3 * s, text: `used in ${s} sessions` } : { key: 'reuse', points: 0, text: 'seen in 1 session' });
  const t = g.turns;
  out.push(t > TURNS_CAP ? { key: 'turns', points: pts(TURNS_CAP / 4), text: `followed by more than ${TURNS_CAP} assistant messages (counted as ${TURNS_CAP})` }
    : t > 0 ? { key: 'turns', points: pts(t / 4), text: `followed by ${t} assistant message${t === 1 ? '' : 's'}` }
      : { key: 'turns', points: 0, text: 'no assistant message followed it' });
  if (g.chars >= LONG_CHARS) out.push({ key: 'length', points: 1, text: `${LONG_CHARS}+ characters` });
  if (inLibrary) out.push({ key: 'library', points: -5, text: 'already a prompt note' });
  return out;
}

export function harvest(pool, { promptBodies = [], hidden = new Set(), limit = HARVEST_LIMIT } = {}) {
  const lib = new Set((Array.isArray(promptBodies) ? promptBodies : []).map(normalize));
  const groups = new Map();
  let hiddenCount = 0;
  const hiddenSeen = new Set();
  for (const r of Array.isArray(pool) ? pool : []) {
    if (excludeReason(r)) continue;
    const norm = normalize(r.text);
    const key = candidateKey(norm);
    if (hidden.has(key)) { if (!hiddenSeen.has(key)) { hiddenSeen.add(key); hiddenCount++; } continue; }
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, norm, occ: [], sessions: new Set(), turns: 0, chars: 0 }));
    g.occ.push(r);
    g.sessions.add(String(r.sessionKey || r.conversationId || r.documentId || ''));
    g.turns = Math.max(g.turns, Math.max(0, Math.min(Number(r.turnsAfter) || 0, TURNS_CAP + 1)));
  }
  const out = [];
  for (const g of groups.values()) {
    g.occ.sort((a, b) => newer(a.at, b.at));
    const text = String(g.occ[0].text).trim();
    g.chars = chars(text);
    const reasons = reasonsOf(g, lib.has(g.norm));
    out.push({
      key: g.key, text, chars: g.chars, score: pts(reasons.reduce((s, x) => s + x.points, 0)), reasons,
      sources: g.occ.slice(0, MAX_SOURCES).map((r) => ({ kind: r.kind, ...(r.conversationId ? { conversationId: r.conversationId } : {}),
        ...(r.documentId ? { documentId: r.documentId } : {}), at: r.at || null, project: r.project || null })),
      sessions: g.sessions.size, lastAt: g.occ[0].at || null,
    });
  }
  out.sort((a, b) => b.score - a.score || newer(a.lastAt, b.lastAt) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const n = Math.max(1, Math.min(Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : HARVEST_LIMIT, HARVEST_LIMIT_MAX));
  return { candidates: out.slice(0, n), hidden: hiddenCount };
}
