// Project page actions (v3 Forge parity). Component.prototype mixin (src/app.js).
// The "Add to ideas" capture lives in logic/system.js (saveIdea / saveButton).
import { FX } from './shared.js';

const errText = (e) => { try { return String((e && e.message) || e); } catch { return 'unknown error'; } };

// hq.claudeQuest spawns a new interactive Claude terminal on every call (main dedupes
// nothing), so a double-click on ⚡ or "Open in terminal" opened two and used quota twice.
// claudeTerminal lets one open per folder + prompt run at a time, and holds the same one
// off for TERM_COOLDOWN_MS after main opened it. A held-off call answers TERM_SKIPPED.
// A refusal (false) or a throw clears the hold at once, so a retry click is never swallowed.
export const TERM_COOLDOWN_MS = 1500;
export const TERM_SKIPPED = Object.freeze({ skipped: true });

export const projectLogic = {
  // → main's claudeQuest answer (true / false), TERM_SKIPPED, or it throws what claudeQuest threw
  async claudeTerminal(path, prompt) {
    const key = String(path) + '\n' + String(prompt), busy = this._termBusy || (this._termBusy = new Map());
    const until = busy.get(key);
    if (until === true || (typeof until === 'number' && Date.now() < until)) return TERM_SKIPPED;
    busy.set(key, true);
    let ok = false;
    try { ok = await this.hq.claudeQuest(path, prompt); return ok; }
    finally { if (ok === false) busy.delete(key); else busy.set(key, Date.now() + TERM_COOLDOWN_MS); }
  },
  // v3's ⚡ on a side quest: interactive Claude in a new terminal at the project,
  // seeded with "title — detail" (hq.claudeQuest; main answers false when it
  // refuses the folder). Uses Claude quota; nothing else is claimed.
  async questTerminal(item, p) {
    if (!this.canWrite()) return this.denied();
    if (!p || !p.path) return this.denied('This project has no folder');
    if (!this.hq || !this.hq.claudeQuest) return this.denied('This window can’t open a terminal');
    const title = String((item && item.title) || '').trim(), detail = String((item && item.detail) || '').trim();
    if (!title) return;
    const prompt = title + (detail && !(item && item.capture) ? ' — ' + detail : '');
    let ok;
    try { ok = await this.claudeTerminal(p.path, prompt); }
    catch (e) { this.toast('error', 'Couldn’t open a terminal · ' + errText(e)); FX().sfx('error'); return; }
    if (ok === TERM_SKIPPED) return;   // the same terminal is opening, or just opened
    if (ok === false) { this.toast('error', 'Couldn’t open a terminal · ' + p.name + '’s folder wasn’t accepted'); FX().sfx('error'); return; }
    this.toast('info', 'Opened interactive Claude in a terminal · ' + p.name + ' · uses Claude quota');
  },
};
