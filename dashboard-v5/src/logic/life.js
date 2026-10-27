// Life › Notes actions (IPC-CONTRACT 2026-10-27 Life › Notes): Open in Obsidian / Search for a scanned vault.
// Component.prototype mixin (src/app.js): same `this` as the class methods.
import { FX } from './shared.js';

export const lifeLogic = {
  async lifeVaultOpen(name, how) {
    if (!(this.hq && this.hq.vaultOpen) || this.ps() === 'nobridge') return this.denied('Needs the live app — opening Obsidian is unavailable in this preview');
    let r;
    try { r = await this.hq.vaultOpen(name, how); } catch (e) { r = { error: String((e && e.message) || e) }; }
    if (!r || r.error) { this.toast('error', (r && r.error) || 'Obsidian did not open'); FX().sfx('error'); return; }
    this.toast('info', how === 'search' ? 'Search opened in Obsidian · ' + name : 'Opened in Obsidian · ' + name);
  },
};
