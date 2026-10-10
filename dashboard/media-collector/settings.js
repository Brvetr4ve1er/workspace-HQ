'use strict';
// Settings — validated, bounded, persisted as JSON in userData. Every value
// the renderer can set passes through `validate()`, so a hostile or buggy
// renderer cannot raise a cap past its hard ceiling or point the destination
// at a system directory.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { readJsonStore, writeJsonStore } = require('./json-store');
const { DEFAULT_TEMPLATE } = require('./filenames');

const CEILING = { concurrency: 4, maxPageBytes: 20 * 1024 * 1024, maxFileBytes: 16 * 1024 * 1024 * 1024, maxCandidates: 500, probeLimit: 60, maxQueuedBytes: 64 * 1024 * 1024 * 1024 };

function defaults(userData, downloadsDir) {
  return {
    destination: path.join(downloadsDir || path.join(os.homedir(), 'Downloads'), 'WorkspaceHQ Media'),
    concurrency: 2,
    filenameTemplate: DEFAULT_TEMPLATE,
    overwritePolicy: 'ask',           // ask | skip | rename  (replace is never a default)
    respectRobots: true,
    maxPageBytes: 5 * 1024 * 1024,
    maxFileBytes: 2 * 1024 * 1024 * 1024,
    maxCandidates: 200,
    probeLimit: 24,
    maxQueuedBytes: 20 * 1024 * 1024 * 1024,
    keepPartialOnCancel: false,
    autoPreviewImages: true,
    previewMaxBytes: 1.5 * 1024 * 1024,
    acknowledgedAt: null,             // onboarding: owner/permission acknowledgement
    telemetry: false,                 // there is no telemetry; the flag exists so the UI can say so honestly
    _userData: userData,
  };
}

const SYSTEM_DIRS = (() => {
  const roots = ['/', '/bin', '/boot', '/dev', '/etc', '/lib', '/proc', '/root', '/sbin', '/sys', '/usr', '/var', 'C:\\', 'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)'];
  return new Set(roots.map((r) => path.resolve(r).toLowerCase()));
})();

function validateDestination(p) {
  if (typeof p !== 'string' || !p.trim()) return 'Destination is empty.';
  const abs = path.resolve(p);
  if (SYSTEM_DIRS.has(abs.toLowerCase())) return 'Destination cannot be a system directory.';
  if (/^\\\\/.test(abs) || /^\/\//.test(abs)) return 'Network paths are not supported as a destination.';
  return null;
}

const clampInt = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };

function validate(patch, current) {
  const out = { ...current };
  const errors = {};
  for (const [k, v] of Object.entries(patch || {})) {
    switch (k) {
      case 'destination': { const e = validateDestination(v); if (e) errors[k] = e; else out.destination = path.resolve(v); break; }
      case 'concurrency': out.concurrency = clampInt(v, 1, CEILING.concurrency, current.concurrency); break;
      case 'filenameTemplate': out.filenameTemplate = typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : DEFAULT_TEMPLATE; break;
      case 'overwritePolicy': out.overwritePolicy = ['ask', 'skip', 'rename'].includes(v) ? v : 'ask'; break;
      case 'respectRobots': case 'keepPartialOnCancel': case 'autoPreviewImages': out[k] = !!v; break;
      case 'maxPageBytes': out.maxPageBytes = clampInt(v, 64 * 1024, CEILING.maxPageBytes, current.maxPageBytes); break;
      case 'maxFileBytes': out.maxFileBytes = clampInt(v, 1024, CEILING.maxFileBytes, current.maxFileBytes); break;
      case 'maxCandidates': out.maxCandidates = clampInt(v, 1, CEILING.maxCandidates, current.maxCandidates); break;
      case 'probeLimit': out.probeLimit = clampInt(v, 0, CEILING.probeLimit, current.probeLimit); break;
      case 'maxQueuedBytes': out.maxQueuedBytes = clampInt(v, 1024 * 1024, CEILING.maxQueuedBytes, current.maxQueuedBytes); break;
      case 'previewMaxBytes': out.previewMaxBytes = clampInt(v, 0, 3 * 1024 * 1024, current.previewMaxBytes); break;
      case 'acknowledgedAt': out.acknowledgedAt = v ? new Date().toISOString() : null; break;
      default: break;   // unknown keys (and _userData, telemetry) are ignored
    }
  }
  return { value: out, errors };
}

function createSettings(userData, log = console, downloadsDir) {
  const file = path.join(userData, 'settings.json');
  const base = defaults(userData, downloadsDir);
  const { value: stored, quarantined } = readJsonStore(file, {}, log);
  let current = validate(stored, base).value;
  current._userData = userData;
  const api = {
    file, quarantined: quarantined || null,
    get: () => ({ ...current }),
    set(patch) {
      const { value, errors } = validate(patch, current);
      current = value;
      const toWrite = { ...current }; delete toWrite._userData;
      writeJsonStore(file, toWrite);
      return { value: api.get(), errors };
    },
    ensureDestination() {
      fs.mkdirSync(current.destination, { recursive: true });
      return current.destination;
    },
  };
  return api;
}

module.exports = { createSettings, validate, validateDestination, defaults, CEILING };
