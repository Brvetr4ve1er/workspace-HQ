/**
 * Where the world comes from. Served by WorkspaceHQ under /world/ with a key -> the bridge's /world/state.
 * Anywhere else (vite dev, a preview) -> the invented fixture, and the HUD says so.
 *
 * The key arrives once in the URL fragment (#k=..., never sent to any server), is kept in this origin's
 * storage and then removed from the address bar, so a copied link or a screenshot never carries it.
 */
import type { OpenTarget, WorldState } from './types';
import { FIXTURE } from './fixture';

const KEY_STORE = 'maps-hq:key';
const KEY_RE = /^[0-9a-f]{64}$/;

export type Source = { mode: 'live' | 'demo'; key: string | null };

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** Reads #k= once, stores it, strips it from the address bar. Keeps any other hash params (e.g. job=). */
export function takeKey(loc: Location = window.location, hist: History = window.history): string | null {
  const params = new URLSearchParams(loc.hash.replace(/^#/, ''));
  const fromHash = params.get('k');
  const s = storage();
  if (fromHash && KEY_RE.test(fromHash)) {
    try { s?.setItem(KEY_STORE, fromHash); } catch { /* private window: keep it in memory only */ }
    params.delete('k');
    const rest = params.toString();
    hist.replaceState(null, '', loc.pathname + loc.search + (rest ? '#' + rest : ''));
    return fromHash;
  }
  let stored: string | null = null;
  try { stored = s?.getItem(KEY_STORE) ?? null; } catch { stored = null; }
  return stored && KEY_RE.test(stored) ? stored : null;
}

export function detectSource(loc: Location = window.location): Source {
  // vite dev serves under /world/ too (base path), so dev always runs on the invented city
  const onBridge = !import.meta.env.DEV && loc.pathname.startsWith('/world/');
  const key = onBridge ? takeKey(loc) : null;
  return onBridge ? { mode: 'live', key } : { mode: 'demo', key: null };
}

export type Load = { ok: true; world: WorldState | null; reason?: string } | { ok: false; error: string };

export async function loadWorld(src: Source): Promise<Load> {
  if (src.mode === 'demo') return { ok: true, world: FIXTURE };
  if (!src.key) return { ok: false, error: 'Open the map from its address with the key (node tools/world-url.mjs in WorkspaceHQ).' };
  try {
    const r = await fetch('/world/state', { headers: { 'X-HQ-World': src.key }, cache: 'no-store' });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body?.ok) return { ok: false, error: body?.error ?? `The app answered ${r.status}` };
    return { ok: true, world: body.world ?? null, reason: body.reason };
  } catch {
    return { ok: false, error: 'WorkspaceHQ is not running (the map lives on its local bridge).' };
  }
}

export async function openInApp(src: Source, target: OpenTarget): Promise<{ ok: boolean; message: string }> {
  if (src.mode === 'demo') return { ok: true, message: 'Demo map: in WorkspaceHQ this opens the app right there.' };
  if (!src.key) return { ok: false, message: 'No key.' };
  try {
    const r = await fetch('/world/open', {
      method: 'POST', headers: { 'X-HQ-World': src.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ target }),
    });
    const body = await r.json().catch(() => null);
    if (r.ok && body?.ok) return { ok: true, message: body.note ? `Opened. ${body.note}` : 'Opened in WorkspaceHQ.' };
    return { ok: false, message: body?.error ?? `The app answered ${r.status}` };
  } catch {
    return { ok: false, message: 'WorkspaceHQ is not running.' };
  }
}
