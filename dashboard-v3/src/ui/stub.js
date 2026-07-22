// Placeholder view factory — every realm ships this until its v2 port lands,
// so the shell/rail/theme loop is testable realm-by-realm. Ports replace the
// realm's view.js wholesale; nothing imports this after M0 completes.
import { el } from './util.js';

export function stubView(lexKey) {
  return {
    mount(root, ctx) {
      const scan = ctx.data.selected;
      root.appendChild(el('div', 'port-pending',
        `<h2 class="sec">${ctx.LX(lexKey)}</h2>
         <p class="muted">port pending — v2 surface renders here at parity</p>
         <p class="muted">snapshot ${scan ? scan.scan?.date ?? ctx.data.selectedIndex + 1 : '—'} / ${ctx.data.scans.length} · theme ${ctx.theme} · hq ${ctx.hq ? 'bound' : 'absent (dev)'}</p>`));
    },
    unmount() {},
  };
}
