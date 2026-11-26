import { describe, it, expect, beforeEach } from 'vitest';
import { takeKey } from './source';

const KEY = 'a'.repeat(64);

function fakeLoc(hash: string, pathname = '/world/') {
  return { hash, pathname, search: '' } as Location;
}
function fakeHist() {
  const calls: string[] = [];
  return { calls, h: { replaceState: (_s: unknown, _t: string, url: string) => calls.push(url) } as unknown as History };
}

describe('the key', () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) },
    };
  });

  it('is taken from the fragment once, then stripped from the address bar (other params kept)', () => {
    const { calls, h } = fakeHist();
    expect(takeKey(fakeLoc(`#k=${KEY}&job=quest:q-x`), h)).toBe(KEY);
    expect(calls).toEqual(['/world/#job=quest%3Aq-x']);
    expect(takeKey(fakeLoc(''), h)).toBe(KEY);
  });

  it('a malformed key is ignored', () => {
    const { calls, h } = fakeHist();
    expect(takeKey(fakeLoc('#k=nope'), h)).toBeNull();
    expect(calls).toEqual([]);
  });
});
