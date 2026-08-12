// Placeholder surface factory — the five non-WORK surfaces mount this until
// v4.1 builds them for real. It is deliberately ONE honest line and ZERO
// controls: a button here would be a dead control, and the no-dead-controls
// rule has already cost three fix waves.
import { el, esc } from '../ui/util.js';

export function placeholderView(label) {
  return {
    mount(stage) {
      stage.appendChild(el('section', 'hud-frame placeholder', `
        <div class="hud-eyebrow">${esc(label)}</div>
        <div class="hud-title">Built in v4.1</div>`));
    },
    unmount() {},
  };
}
