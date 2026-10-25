// renderVals(): the flat object the template binds against. Names, shapes and
// styles follow the Claude Design prototype; values come from the snapshot at
// the time-machine offset (state.snapOffset) and the live store.
//
// makeCtx() (ctx.js) computes what several surfaces share; then one function per
// surface (src/vals/<surface>.js, same `this`) returns that surface’s keys. The
// surfaces’ keys are disjoint, so the merge order below only sets key order.
import { makeCtx } from './ctx.js';
import { shellVals } from './shell.js';
import { homeVals } from './home.js';
import { projectsVals } from './projects.js';
import { projectPageVals } from './project-page.js';
import { tasksVals } from './tasks.js';
import { scrubVals } from './scrub.js';
import { runsVals } from './runs.js';
import { askVals } from './ask.js';
import { paletteVals } from './palette.js';
import { focusVals } from './focus.js';
import { commitVals } from './commit.js';
import { overlaysVals } from './overlays.js';
import { automationsVals } from './automations.js';
import { claudeVals } from './claude.js';
import { claudeLibVals } from './claude-lib.js';
import { claudeChatVals } from './claude-chat.js';
import { claudeImportVals } from './claude-import.js';
import { historyVals } from './history.js';
import { systemVals } from './system.js';
import { lifeVals } from './life.js';
import { studioVals } from './studio.js';
import { extrasVals } from './extras.js';

const SURFACES = [
  shellVals, homeVals, projectsVals, projectPageVals, tasksVals, scrubVals, runsVals, askVals, paletteVals,
  focusVals, commitVals, overlaysVals, automationsVals, claudeVals, claudeLibVals, claudeChatVals, claudeImportVals, historyVals, systemVals, lifeVals, studioVals, extrasVals,
];

export function renderVals() {
  const ctx = makeCtx.call(this);
  const out = {};
  for (const surface of SURFACES) Object.assign(out, surface.call(this, ctx));
  return out;
}
