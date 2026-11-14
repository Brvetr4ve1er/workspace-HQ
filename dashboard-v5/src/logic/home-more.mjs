// "More on Home" disclosure state (batch 7, dish home-one-decision). PURE: the storage is passed in, nothing is imported.
//
// ONE per-viewer boolean under localStorage key 'hq.homeMore'. It is a convenience, never a setting: it lives in this window's storage
// (not in the prefs the app saves to main), so it never crosses to another device and nothing waits on it.
//
//   read(storage?)         -> boolean   true only when the stored value is exactly '1'; default closed
//   write(storage?, open)  -> boolean   true when the value was stored; false when there was no storage or it refused (the page keeps its in-memory state)
//   label(open)            -> 'More on Home' | 'Less on Home'    (the button's words: the label names the action, not the state)
//   browserStorage()       -> the page's localStorage, or null    (the getter itself can throw in a locked-down window)
//
// Every access is in try/catch. A throwing or absent storage reads closed and the page still renders; a garbage value reads closed
// (never open by accident). Called with no storage argument, read/write use browserStorage(); passing null means "no storage".

export const KEY = 'hq.homeMore';
const OPEN = '1', CLOSED = '0';

export function browserStorage() {
  try { return typeof localStorage !== 'undefined' && localStorage ? localStorage : null; } catch { return null; }
}

export function read(storage = browserStorage()) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return false;
    return storage.getItem(KEY) === OPEN;
  } catch { return false; }
}

export function write(storage, open) {
  const s = arguments.length < 1 || storage === undefined ? browserStorage() : storage;
  try {
    if (!s || typeof s.setItem !== 'function') return false;
    s.setItem(KEY, open === true ? OPEN : CLOSED);
    return true;
  } catch { return false; }
}

export const label = (open) => (open === true ? 'Less on Home' : 'More on Home');
