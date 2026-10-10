'use strict';
// FileService — destination validation, final-path containment, partial
// files, atomic commit (hard-link or rename, never a silent overwrite),
// free-space check, SHA-256 of what is on disk.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { UmcError } = require('./errors');
const { buildName, resolveCollision } = require('./filenames');
const { validateDestination } = require('./settings');

const PARTIAL_DIR = '.umc-partial';

async function ensureDestination(dest) {
  const err = validateDestination(dest);
  if (err) throw new UmcError('INVALID_URL', err);   // never reached from the UI: settings already validated
  const abs = path.resolve(dest);
  await fsp.mkdir(abs, { recursive: true });
  const st = await fsp.stat(abs);
  if (!st.isDirectory()) throw new UmcError('DISK_FULL', 'destination is not a directory');
  await fsp.access(abs, fs.constants.W_OK).catch(() => { throw new UmcError('ACCESS_DENIED', 'destination is not writable'); });
  await fsp.mkdir(path.join(abs, PARTIAL_DIR), { recursive: true });
  return await fsp.realpath(abs);
}

// The final path must stay inside the destination (template tokens are
// sanitized, but this is the structural guarantee, not a convention).
function containedPath(destReal, name) {
  const p = path.resolve(destReal, name);
  const rel = path.relative(destReal, p);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) throw new UmcError('INVALID_URL', 'path escapes destination');
  return p;
}

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

// Name planning: template → sanitized name → collision policy.
// Returns { name, finalPath, conflict: bool, existingPath }.
function planName(destReal, template, tokens, policy) {
  let name = buildName(template, tokens);
  const taken = (n) => exists(path.join(destReal, n));
  const existing = taken(name);
  if (existing && policy === 'rename') name = resolveCollision(name, taken);
  const finalPath = containedPath(destReal, name);
  return { name, finalPath, conflict: existing && policy !== 'rename', existingPath: existing ? path.join(destReal, buildName(template, tokens)) : null };
}

const partialPath = (destReal, jobId) => path.join(destReal, PARTIAL_DIR, `${jobId}.part`);

async function freeBytes(dir) {
  try { const s = await fsp.statfs(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

// Commit the partial into place. Without `replace`, an existing file is a
// hard error (FILE_CONFLICT) — hard links fail atomically with EEXIST, and
// the rename fallback re-checks right before moving.
async function commit(partPath, finalPath, { replace = false } = {}) {
  if (replace) {
    try { await fsp.unlink(finalPath); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    await fsp.rename(partPath, finalPath);
    return;
  }
  try {
    await fsp.link(partPath, finalPath);
    await fsp.unlink(partPath);
    return;
  } catch (err) {
    if (err.code === 'EEXIST') throw new UmcError('FILE_CONFLICT');
    if (!['EPERM', 'EXDEV', 'ENOTSUP', 'EOPNOTSUPP', 'EACCES', 'EMLINK'].includes(err.code)) throw err;
  }
  if (exists(finalPath)) throw new UmcError('FILE_CONFLICT');
  await fsp.rename(partPath, finalPath);
}

async function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

async function removeQuietly(p) { try { await fsp.unlink(p); } catch {} }

module.exports = { ensureDestination, containedPath, planName, partialPath, freeBytes, commit, sha256File, removeQuietly, exists, PARTIAL_DIR };
