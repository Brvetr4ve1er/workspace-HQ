// The emergency sheet must print alone: a print stylesheet hides the rest of the app and lays the sheet out black on white.
//   node --test dashboard-v5/styles/print.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('./app.css', import.meta.url), 'utf8');
const block = () => {
  const i = CSS.indexOf('@media print');
  assert.ok(i >= 0, 'an @media print block exists');
  let depth = 0, j = CSS.indexOf('{', i);
  const start = j;
  for (; j < CSS.length; j++) { if (CSS[j] === '{') depth++; else if (CSS[j] === '}' && --depth === 0) break; }
  return CSS.slice(start + 1, j);
};

test('@media print hides everything but the emergency sheet and prints it black on white without its buttons', () => {
  const b = block();
  assert.match(b, /body \*\s*\{\s*visibility:\s*hidden\s*!important/);
  assert.match(b, /\[data-sec="sheet"\],\s*\[data-sec="sheet"\] \*\s*\{\s*visibility:\s*visible\s*!important/);
  assert.match(b, /\[data-sec="sheet"\]\s*\{[^}]*background:\s*#fff[^}]*color:\s*#000/);
  assert.match(b, /\[data-sec="sheet-close"\],\s*\[data-sec="sheet-print"\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(b, /html,\s*body\s*\{[^}]*overflow:\s*visible/, 'the window-sized, scroll-locked page is released for printing');
});
