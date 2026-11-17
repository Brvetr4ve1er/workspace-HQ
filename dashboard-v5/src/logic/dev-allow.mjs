// The renderer's half of "Allow and run" (plan batch 9, dish "dev command as an argv array"). Pure.
//
// main (dashboard/dev-command.js) answers hq:dev-start with a fixed word and hq:dev-allow with another; this file names them and
// computes the hash of the command text the owner is SHOWN. hashShown is a copy of dashboard/dev-command-core.mjs hashShown (the
// renderer cannot import from dashboard/); dashboard/dev-command-core.test.mjs pins that the two agree on every input.
export const START_WORDS = Object.freeze(['started', 'running', 'unconfirmed', 'refused', 'busy']);

export function hashShown(text) {
  let h = 0x811c9dc5;
  const s = String(text == null ? '' : text);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// An older main (and the old fakes) answered a boolean: true = it spawned, false = it did not. Anything else (null, an object) is no answer.
export function startAnswer(r) {
  if (typeof r === 'string' && START_WORDS.includes(r)) return r;
  if (r === true) return 'started';
  if (r === false) return 'failed';
  return null;
}

export const REFUSED_TEXT = 'Can’t run this one: it needs a runner or syntax I don’t run; open the terminal.';
export const NOT_ALLOWED_TEXT = 'not allowed yet';
export const BUSY_TEXT = 'Too many dev server starts this hour. Try again later.';
export const ALLOW_NOTE = 'It runs this project’s own scripts.';
