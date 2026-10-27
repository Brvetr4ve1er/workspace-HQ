// Social tab actions (IPC-CONTRACT 2026-10-27 Social tab). Its vault is VEEMO CORTEX.
// Component.prototype mixin (src/app.js): same `this` as the class methods.
//
// State keys (K-4: app.js declares initial state; an undefined key is its default here):
//   soQuery    the Archive search box            soSearched  a search ran (shows Clear)
//   soTitle    the Vault new-note title          soBody      the Vault new-note text
//   soSaving   true while hq.socialVault.save runs
//   soDiscardAsk  the staged post whose Discard was clicked once (the second click cancels it)
//   soDiscarding  the staged post being canceled right now
import { FX } from './shared.js';
import { TITLE_MAX, BODY_MAX } from './social-limits.mjs';

export const SO_OFF = 'Needs the live app — unavailable in this preview';

export const socialLogic = {
  // on arrival (and a cold start on the tab): the bridge snapshot, the archive counts, the vault listing
  socialLoad() {
    const st = this.store;
    if (st.refreshSocial) st.refreshSocial();
    if (st.refreshSocialArchive) st.refreshSocialArchive();
    if (st.refreshSocialVault) st.refreshSocialVault();
  },
  async soOpenSite(platform) {
    if (!(this.hq && this.hq.socialOpenSite) || this.ps() === 'nobridge') return this.denied(SO_OFF);
    const r = await this.store.openSocialSite(platform);
    if (r && r.error) { this.toast('error', r.error); FX().sfx('error'); return; }
    this.toast('info', 'Opened in your browser — sign in there and keep a tab open; the extension reads it within 5 minutes', { ms: 6000 });
  },
  // Inbox: Discard asks once, then main flips the post staged → canceled (hq:social-cancel; never publishes)
  async soDiscard(id) {
    const S = this.state;
    if (S.soDiscarding) return;
    if (!this.canWrite() || !(this.hq && this.hq.socialCancel)) return this.denied(this.canWrite() ? SO_OFF : undefined);
    if (S.soDiscardAsk !== id) { this.setState({ soDiscardAsk: id }); return; }
    this.setState({ soDiscarding: id });
    const r = await this.store.discardSocialPost(id);
    this.setState({ soDiscarding: null, soDiscardAsk: null });
    if (!r || r.error) {
      const why = r && r.error === 'already publishing' ? 'It is already being published from the extension — too late to discard' : (r && r.error) || 'Discard failed';
      this.toast('error', why); FX().sfx('error'); return;
    }
    this.toast('success', 'Discarded · it can never be sent');
  },
  // Archive: one network's kind of records (toggle), search, the open document
  soPick(origin, kind) {
    const sel = this.LIVE.socialArchive.sel;
    const same = sel && sel.origin === origin && sel.kind === kind;
    return this.store.socialArchiveKind(same ? null : origin, same ? null : kind);
  },
  onSoQuery(e) { this.setState({ soQuery: e && e.target ? e.target.value : '' }); },
  soSearch() { this.setState({ soSearched: true }); return this.store.searchSocialArchive(this.state.soQuery); },
  soClear() { this.setState({ soQuery: '', soSearched: false }); return this.store.searchSocialArchive(''); },
  soOpenDoc(id) { return this.store.openSocialDoc(id); },
  soCloseDoc() { return this.store.closeSocialDoc(); },
  // Claude › Chats with the network's DMs (read-only threads there)
  soOpenDms(origin) { this.go('claude', 'chats'); this.clSetFilter('clSrc', origin); },
  // Vault
  async soOpenNote(rel, how) {
    if (!(this.hq && this.hq.socialVault) || this.ps() === 'nobridge') return this.denied(SO_OFF);
    const r = await this.store.openSocialNote(rel, how);
    if (r && r.error) { this.toast('error', r.error); FX().sfx('error'); }
  },
  onSoTitle(e) { this.setState({ soTitle: e && e.target ? e.target.value : '' }); },
  onSoBody(e) { this.setState({ soBody: e && e.target ? e.target.value : '' }); },
  async soSave() {
    const S = this.state, title = String(S.soTitle || '').trim(), body = String(S.soBody || '');
    if (S.soSaving) return;
    if (!this.canWrite() || !(this.hq && this.hq.socialVault)) return this.denied(this.canWrite() ? SO_OFF : undefined);
    if (!title) return this.toast('error', 'Give the note a title first');
    if ([...title].length > TITLE_MAX) return this.toast('error', 'The title is longer than ' + TITLE_MAX + ' characters');
    if (body.length > BODY_MAX) return this.toast('error', 'The note is longer than ' + BODY_MAX + ' characters');
    this.setState({ soSaving: true });
    const r = await this.store.saveSocialNote({ title, body });
    this.setState({ soSaving: false });
    if (!r || r.error) { this.toast('error', (r && r.error) || 'Saving failed'); FX().sfx('error'); return; }
    this.setState({ soTitle: '', soBody: '' });
    this.toast('success', 'Saved to ' + r.rel);
    if (this.store.refreshSocialVault) this.store.refreshSocialVault();
  },
};
