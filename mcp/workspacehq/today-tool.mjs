// hq_today for the workspacehq MCP server: where today went, as COUNTS. READ-ONLY and file-mediated: it reads data/today.json
// ({ v:1, day, generatedAt, counts }, written by dashboard/day-ribbon.js while WorkspaceHQ runs) and never writes, renames or quarantines
// anything. It never returns a project name, domain, commit message or path: counts are the only content, rebuilt from five known keys.
//
//   readToday({ dataDir, daysAgo?, now?, fsMod? })
//     -> { day, isToday, asOf:'14:20', ageMinutes, appLikelyOpen, counts, summary, note } | { error }
//
// With the app closed the last file still answers, with its age, and the answer says so. A day other than today needs the app (the
// ribbon builds past days from the Hub, the app log and git on demand): it answers an error that names the app.
import fs from 'node:fs';
import path from 'node:path';
import { cleanCounts, captionFromCounts, localDayKey } from '../../dashboard/day-core.mjs';

export const TOOL_NAME = 'hq_today';
export const STALE_MINUTES = 30;   // the app rewrites the file every 10 minutes while it runs
export const DESCRIPTION = "Where today went, as counts from the WorkspaceHQ Today ribbon: five-minute blocks with Claude and across how many projects, commits, PC asleep minutes and browser focus minutes, in one sentence plus the numbers. A block is five minutes with at least one turn in a Claude chat, not a measure of time spent. A count is null when its source could not be read (the sentence says so). Answers 'as of HH:MM'; with WorkspaceHQ closed it answers the last file it wrote and says so. Only today is answered here: another day needs the app open (its Home ribbon steps back up to 7 days). Read-only. It never returns a project name, website, commit message or path.";
export const INPUT_SCHEMA = { type: 'object', properties: {
  daysAgo: { type: 'integer', minimum: 0, maximum: 6, description: 'Only 0 (today, the default) is answered here; another day is an error that says to open WorkspaceHQ.' } }, additionalProperties: false };

const pad = (n) => String(n).padStart(2, '0');
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

export function readToday({ dataDir, daysAgo = 0, now = new Date(), fsMod = fs } = {}) {
  if (!Number.isInteger(daysAgo) || daysAgo < 0 || daysAgo > 6) return { error: 'daysAgo must be a whole number from 0 to 6' };
  if (daysAgo !== 0) return { error: 'Only today is answered here. A past day is built by WorkspaceHQ from its own records when you open it: open WorkspaceHQ and step back on the Home ribbon.' };
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  let raw;
  try { raw = fsMod.readFileSync(path.join(dataDir, 'today.json'), 'utf8'); }
  catch (e) { return { error: e && e.code === 'ENOENT' ? 'data/today.json does not exist yet: open WorkspaceHQ and let Home load once' : 'data/today.json could not be read' }; }
  let doc; try { doc = JSON.parse(raw); } catch { return { error: 'data/today.json is unreadable: open WorkspaceHQ so it writes a fresh one' }; }
  const gen = isObj(doc) && typeof doc.generatedAt === 'string' ? Date.parse(doc.generatedAt) : NaN;
  if (!isObj(doc) || doc.v !== 1 || typeof doc.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.day) || !isObj(doc.counts) || !Number.isFinite(gen)) {
    return { error: 'data/today.json is not in a shape this version understands: open WorkspaceHQ so it writes a fresh one' };
  }
  const counts = cleanCounts(doc.counts);
  const d = new Date(gen);
  const asOf = pad(d.getHours()) + ':' + pad(d.getMinutes());
  const ageMinutes = Number.isFinite(nowMs) ? Math.max(0, Math.floor((nowMs - gen) / 60000)) : null;
  const appLikelyOpen = ageMinutes !== null && ageMinutes <= STALE_MINUTES;
  const todayKey = Number.isFinite(nowMs) ? localDayKey(nowMs, -new Date(nowMs).getTimezoneOffset()) : null;
  const isToday = todayKey === doc.day;
  const notes = [];
  if (!isToday) notes.push('This is the answer for ' + doc.day + ', not today: WorkspaceHQ has not refreshed it since. Open WorkspaceHQ for today.');
  if (!appLikelyOpen) notes.push('WorkspaceHQ looks closed (the file is ' + (ageMinutes === null ? 'of unknown age' : ageMinutes < 120 ? ageMinutes + ' min old' : Math.round(ageMinutes / 60) + ' h old') + '): this is the last answer it wrote, as of ' + asOf + '.');
  return {
    day: doc.day, isToday, asOf: 'as of ' + asOf, ageMinutes, appLikelyOpen, counts,
    summary: captionFromCounts(counts),
    note: notes.join(' ') || 'A block is five minutes with at least one turn in a Claude chat; a null count means that source could not be read.',
  };
}
