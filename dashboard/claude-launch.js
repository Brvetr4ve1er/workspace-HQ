// Open an interactive Claude session in a NEW terminal window, in a project
// folder, with a seed prompt. Extracted from main.js's hq:claude-quest handler
// (v5 clean pass M4); prompt runs reuse the same launcher.
//
//   launchClaudeTerminal(cwd, prompt, opts?) → boolean
//     cwd    — absolute project folder, ALREADY containment-checked by the caller
//              (main.js runs resolveProjectPath first); it must exist, or → false.
//     prompt — seed text: control chars/newlines → one space, `"` → `'`, capped at 500 chars.
//     true   = the terminal was started (or, dry, would have been); false = refused
//              or the spawn failed.
//   HQ_DRY_LAUNCH=1 (read on every call) → logs "[dry-launch] <cwd> :: <prompt>"
//     to stdout, spawns NOTHING, returns true. Gates and tests use it so checking
//     "send to Claude" never opens a terminal or starts a Claude session.
//   opts = { env, spawnSync, log, isDir, helper } — injection seams for claude-launch.test.mjs.
//
// How it launches (R-P4 fix). Neither the folder nor the prompt is ever written
// on a cmd command line:
//   cmd.exe /d /v:off /c start "" cmd /d /v:off /k "<dashboard>\claude-launch.cmd"
//   spawned with { cwd: <project>, env: { HQ_LAUNCH_PROMPT: <prompt> } } — `start`
//   opens the new console in the inherited working directory, and the static helper
//   runs `claude "%HQ_LAUNCH_PROMPT%"` with delayed expansion off.
// The previous shape, `cd /d "<cwd>" && claude "<prompt>"` as ONE spawn argument,
// was broken twice over: Node quotes that argument with \" escapes, which cmd does
// not understand, so (1) `cd /d \"C:\...\"` always failed — the terminal opened on
// an error and claude never started — and (2) the outer `cmd /c` saw the prompt
// OUTSIDE any quotes, so a quest title like `build & deploy` ran `deploy` as a
// command (shell injection; covered by the end-to-end test in claude-launch.test.mjs).
// Pure Node (child_process + fs), no Electron requires.
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const PROMPT_MAX = 500;
const HELPER = path.join(__dirname, 'claude-launch.cmd');
// Characters that would let the helper's own path change the meaning of the outer
// command line. The real path (…\workspace hq\dashboard\…) has none; refuse rather
// than guess if the app ever lives somewhere that does.
const UNSAFE_HELPER_PATH = /["%!&|<>^()]/;

function sanitizePrompt(prompt) {
  return String(prompt == null ? '' : prompt)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')   // newlines/tabs/control chars: one line (a newline would end the batch line)
    .replace(/"/g, "'")                  // never close the helper's quoted argument
    .slice(0, PROMPT_MAX);
}

// The helper passes the value inside "…" and claude parses its command line with the
// usual Windows rules, where backslashes right before the closing quote are escapes:
// double a trailing run so claude receives exactly the sanitized prompt.
function promptEnvValue(p) {
  return p.replace(/(\\+)$/, '$1$1');
}

function defaultIsDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function launchClaudeTerminal(cwd, prompt, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const env = o.env || process.env;
  const run = typeof o.spawnSync === 'function' ? o.spawnSync : childProcess.spawnSync;
  const log = typeof o.log === 'function' ? o.log : (line) => console.log(line);
  const isDir = typeof o.isDir === 'function' ? o.isDir : defaultIsDir;
  const helper = typeof o.helper === 'string' ? o.helper : HELPER;

  if (typeof cwd !== 'string' || !cwd || !path.isAbsolute(cwd) || cwd.includes('"')) return false;
  if (!isDir(cwd)) return false;
  if (UNSAFE_HELPER_PATH.test(helper) || !fs.existsSync(helper)) {
    console.error('[claude-launch] helper missing or at an unsafe path — not launching');
    return false;
  }
  const p = sanitizePrompt(prompt);

  if (env.HQ_DRY_LAUNCH === '1') {
    log(`[dry-launch] ${cwd} :: ${p}`);
    return true;
  }
  try {
    const line = `/d /v:off /c start "" cmd /d /v:off /k "${helper}"`;
    const r = run('cmd.exe', [line], {
      cwd,
      env: { ...env, HQ_LAUNCH_PROMPT: promptEnvValue(p) },
      windowsHide: false,
      windowsVerbatimArguments: true,   // the line above is already a cmd command line; no \" re-quoting
    });
    return !(r && r.error);
  } catch (e) {
    console.error('[claude-launch] spawn failed', e);
    return false;
  }
}

module.exports = { launchClaudeTerminal, sanitizePrompt, promptEnvValue, PROMPT_MAX, HELPER };
