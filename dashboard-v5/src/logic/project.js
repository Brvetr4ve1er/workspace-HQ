// Project page actions (v3 Forge parity). Component.prototype mixin (src/app.js).
// The "Add to ideas" capture lives in logic/system.js (saveIdea / saveButton).
import { FX } from './shared.js';

const errText = (e) => { try { return String((e && e.message) || e); } catch { return 'unknown error'; } };

export const projectLogic = {
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
    try { ok = await this.hq.claudeQuest(p.path, prompt); }
    catch (e) { this.toast('error', 'Couldn’t open a terminal · ' + errText(e)); FX().sfx('error'); return; }
    if (ok === false) { this.toast('error', 'Couldn’t open a terminal · ' + p.name + '’s folder wasn’t accepted'); FX().sfx('error'); return; }
    this.toast('info', 'Opened interactive Claude in a terminal · ' + p.name + ' · uses Claude quota');
  },
};
