// core/scrubber.js — the SNAPSHOT SCRUBBER (v3's "time machine", rebuilt as
// topstrip chrome on the v4 component language).
//
// What it is: `data.scans` is a stack of nightly photographs. This control
// moves the whole app between them via `data.select(i)` and says, always and
// unmissably, WHICH photograph you are looking at and whether it is the newest.
//
// THE BINDING BOUNDARY (recorded at b1d4d9c, restated in work/view.js): the
// shell answers `data:select` with a FULL unmount+mount of the active surface.
// Partial refreshes are forbidden — every surface closes over its mount-time
// scan in places (project lists, metric lookups, the truth rail's Snapshot
// tile), so anything less than a re-mount leaves half the room describing a
// different photograph than the stamp above it. That wiring lives in shell.js;
// this module only ever calls data.select().
//
// LIFECYCLE: these nodes are app-lifetime chrome — built once by the shell,
// never unmounted. Handlers are property assignments on nodes this module
// creates, so there is nothing to leak and nothing to tear down. Crucially the
// nodes PERSIST across a scrub: rebuilding them per click would destroy the
// button under the user's cursor and drop keyboard focus mid-interaction.
import { data } from './data.js';
import { el } from '../ui/util.js';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
// signed delta for the vs-previous read-out: +12 / -3 / 0
const sgn = (d) => (d > 0 ? `+${d}` : String(d));
const dir = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : 'flat');

export function createScrubber() {
  const root = el('div', 'scrub');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Snapshot scrubber');
  // Static skeleton — no interpolation, so nothing scan-derived is ever parsed
  // as markup here. Every value below is written with textContent (strictly
  // stronger than esc(): the string is never parsed at all).
  root.innerHTML = `
    <div class="scrub-read">
      <div class="scrub-line">
        <span class="scrub-key">SNAPSHOT</span>
        <span class="scrub-id"></span>
        <span class="scrub-badge"></span>
      </div>
      <div class="scrub-line scrub-delta">
        <span class="scrub-pos"></span>
        <span class="dlt" data-k="HP"><i>HP</i><b></b></span>
        <span class="dlt" data-k="XP"><i>XP</i><b></b></span>
        <span class="dlt-base">baseline</span>
      </div>
    </div>
    <div class="scrub-ctl">
      <button class="scrub-btn" type="button" data-go="prev" aria-label="Older snapshot">◀</button>
      <button class="scrub-btn" type="button" data-go="next" aria-label="Newer snapshot">▶</button>
      <button class="scrub-btn scrub-latest" type="button" data-go="latest">LATEST</button>
    </div>`;

  const idEl = root.querySelector('.scrub-id');
  const badgeEl = root.querySelector('.scrub-badge');
  const posEl = root.querySelector('.scrub-pos');
  const hpEl = root.querySelector('.dlt[data-k="HP"]');
  const xpEl = root.querySelector('.dlt[data-k="XP"]');
  const baseEl = root.querySelector('.dlt-base');
  const prevB = root.querySelector('[data-go="prev"]');
  const nextB = root.querySelector('[data-go="next"]');
  const lastB = root.querySelector('[data-go="latest"]');

  // data.select() clamps to range and no-ops when the index is unchanged, so
  // these can never overrun the stack even if a disabled state were bypassed.
  prevB.onclick = () => data.select(data.selectedIndex - 1);
  nextB.onclick = () => data.select(data.selectedIndex + 1);
  lastB.onclick = () => data.select(data.scans.length - 1);

  function paint() {
    const n = data.scans.length;
    const S = data.selected;
    // No scans at all: three buttons that could only fail would be lying
    // controls, so they go disabled-with-reason and the stamp says why.
    if (!n || !S) {
      idEl.textContent = '—';
      badgeEl.textContent = 'NO DATA';
      badgeEl.dataset.state = 'none';
      posEl.textContent = '';
      hpEl.hidden = xpEl.hidden = baseEl.hidden = true;
      for (const b of [prevB, nextB, lastB]) {
        b.disabled = true;
        b.title = 'No scan data in this build — run a scan to populate the snapshot stack.';
      }
      return;
    }

    const i = data.selectedIndex;
    const isLatest = data.isLatest;
    idEl.textContent = String(S.scan?.id ?? '—');
    badgeEl.textContent = isLatest ? 'LATEST' : 'PAST';
    badgeEl.dataset.state = isLatest ? 'latest' : 'past';
    posEl.textContent = `${i + 1}/${n}`;

    // vs the snapshot immediately before this one — the change dimension the
    // warden plate's absolute numerals can't show on their own.
    const prev = data.scans[i - 1];
    if (prev) {
      const dh = num(S.account?.health_index) - num(prev.account?.health_index);
      const dx = num(S.account?.xp) - num(prev.account?.xp);
      hpEl.hidden = xpEl.hidden = false;
      baseEl.hidden = true;
      hpEl.querySelector('b').textContent = sgn(dh);
      xpEl.querySelector('b').textContent = sgn(dx);
      hpEl.dataset.dir = dir(dh);
      xpEl.dataset.dir = dir(dx);
      hpEl.title = `health ${S.account?.health_index ?? '—'} vs ${prev.scan?.id ?? 'previous'} (${sgn(dh)})`;
      xpEl.title = `xp ${S.account?.xp ?? '—'} vs ${prev.scan?.id ?? 'previous'} (${sgn(dx)})`;
    } else {
      hpEl.hidden = xpEl.hidden = true;
      baseEl.hidden = false;
    }

    prevB.disabled = i === 0;
    prevB.title = prevB.disabled
      ? 'This is the oldest snapshot in the build.'
      : `Step back to ${data.scans[i - 1]?.scan?.id ?? 'the previous snapshot'} — the whole app re-reads that photograph.`;
    nextB.disabled = isLatest;
    nextB.title = nextB.disabled
      ? 'This is the newest snapshot.'
      : `Step forward to ${data.scans[i + 1]?.scan?.id ?? 'the next snapshot'} — the whole app re-reads that photograph.`;
    lastB.disabled = isLatest;
    lastB.title = isLatest
      ? 'Already on the newest snapshot.'
      : `Jump back to the newest snapshot (${data.scans[n - 1]?.scan?.id ?? '—'}).`;
  }

  paint();
  return { el: root, paint };
}
