// oracle-card.js — the Oracle hero for the home realm. Renders derive.oracle()'s
// single "do this now" as label + reason + ONE primary button routed through the
// audited dispatch() seam. DOM lives here; the action mapping + copy come from
// the headless-tested oracle-logic.mjs. Flag: hq-ff-oracle (default on).
import { el, esc } from '../../ui/util.js';
import { sfx, openDrawer, deriveScanContext } from '../../ui/components.js';
import { dispatch } from '../../core/actions.mjs';
import { oracleActionId, oracleButtonMeta } from './oracle-logic.mjs';

// Default ON; killable with localStorage.setItem('hq-ff-oracle','off').
export function oracleFlagOn() {
  try { return localStorage.getItem('hq-ff-oracle') !== 'off'; } catch { return true; }
}

export function buildOracleCard(oracle, ctx) {
  const meta = oracleButtonMeta(oracle);
  const card = el('div', 'oracle-card');
  card.setAttribute('data-action', oracle.action || '');
  card.innerHTML = `
    <div class="oc-eyebrow">◎ DO THIS NOW · everything else can wait</div>
    <div class="oc-label">${esc(oracle.label || '')}</div>
    <div class="oc-reason">${esc(oracle.reason || '')}</div>
    <div class="oc-act"><button class="oc-go">${esc(meta.icon)} ${esc(meta.label)} ▸</button></div>`;
  card.querySelector('.oc-go').onclick = () => {
    const id = oracleActionId(oracle);
    if (id) dispatch(id, ctx);                       // audited nav / side-effect
    // Any PROJECT-scoped recommendation (a commit, or a project concern like
    // exposed secrets — both carry target.projectId) opens that project's drawer
    // so acting is one motion. Task-scoped quests carry target.questId instead
    // (no projectId) and just navigate to the hunts board.
    if (oracle.target?.projectId) {
      const { projById, prevProj } = deriveScanContext(ctx.data);
      const p = projById[oracle.target.projectId];
      if (p) openDrawer(p, prevProj[oracle.target.projectId], ctx.data);
    }
    sfx('blip');
  };
  return card;
}

// Calm state when nothing is on fire (oracle() returned null). Night-aware copy.
export function buildRestCard(now) {
  const hour = new Date(now).getHours();
  const night = hour >= 22 || hour < 6;
  const card = el('div', 'oracle-card rest');
  card.innerHTML = `
    <div class="oc-eyebrow">◎ ${night ? 'ALL QUIET' : 'CLEAR'}</div>
    <div class="oc-label">${night ? 'Late and clear. Rest.' : 'Nothing on fire.'}</div>
    <div class="oc-reason">${night
      ? 'No uncommitted work, no exposed secrets, no red tasks. Come back tomorrow.'
      : 'Everything is committed and the board is clear. Pick anything below, or take the win.'}</div>`;
  return card;
}
