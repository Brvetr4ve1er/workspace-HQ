// The WorkspaceHQ v3 screen, exactly as authored in Claude Design
// ("Workspace HQ remake scope" > WorkspaceHQ v3.dc.html), minus <helmet>
// (its styles live in styles/tokens.css + styles/app.css, its scripts are imported by boot.js).
// Bindings resolve against Component.renderVals() - see src/dc/runtime.js.
//
// The markup lives in src/tpl/*.tpl.js, one fragment per surface, each an exact
// line-aligned slice of the original template. Joined in this order they give the
// same string byte for byte (tpl.hash.test.mjs). Containers opened in shell close
// in ambient (<main>, body row) and toasts (root <div>).
import shell from './tpl/shell.tpl.js';
import home from './tpl/home.tpl.js';
import projects from './tpl/projects.tpl.js';
import projectPage from './tpl/project-page.tpl.js';
import tasks from './tpl/tasks.tpl.js';
import automations from './tpl/automations.tpl.js';
import claude from './tpl/claude.tpl.js';
import history from './tpl/history.tpl.js';
import system from './tpl/system.tpl.js';
import life from './tpl/life.tpl.js';
import social from './tpl/social.tpl.js';   // v5 addition (2026-10-27): the Social tab, after Life
import studio from './tpl/studio.tpl.js';
import prompt from './tpl/prompt.tpl.js';
import lightbox from './tpl/lightbox.tpl.js';
import ambient from './tpl/ambient.tpl.js';
import navBottom from './tpl/nav-bottom.tpl.js';
import ovScrub from './tpl/ov-scrub.tpl.js';
import ovRuns from './tpl/ov-runs.tpl.js';
import ovAsk from './tpl/ov-ask.tpl.js';
import ovPalette from './tpl/ov-palette.tpl.js';
import ovFocus from './tpl/ov-focus.tpl.js';
import ovConfirm from './tpl/ov-confirm.tpl.js';
import ovCommit from './tpl/ov-commit.tpl.js';
import ovSheet from './tpl/ov-sheet.tpl.js';
import ovSettings from './tpl/ov-settings.tpl.js';
import ovMisc from './tpl/ov-misc.tpl.js';
import ovOnboard from './tpl/ov-onboard.tpl.js';
import extras from './tpl/extras.tpl.js';   // v5 additions (no design slice); empty until Phase 3 P8
import toasts from './tpl/toasts.tpl.js';

export default [
  shell, home, projects, projectPage, tasks, automations, claude, history, system, life, social,
  studio, prompt, lightbox, ambient, navBottom, ovScrub, ovRuns, ovAsk, ovPalette, ovFocus,
  ovConfirm, ovCommit, ovSheet, ovSettings, ovMisc, ovOnboard, extras, toasts,
].join('');
