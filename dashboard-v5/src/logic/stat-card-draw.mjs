// Save stat card PNG: draws the card onto a 2D canvas context. Pure — no DOM lookups, so a
// recording fake context can test it. The colours are the level-up card's own (ov-misc.tpl.js),
// not the theme's, so the image looks the same whichever theme is on.

export const CARD_W = 1200, CARD_H = 630;
const BG = '#14102b', EDGE = '#050409', GOLD = '#ffd23f', DIM = '#9a93c9', TEXT = '#f4f1ff';
export const CARD_FONT = "'IBM Plex Mono', ui-monospace, Menlo, monospace";

// card = { level, title, stats: [{k, v}], date }
export function drawStatCard(g, card) {
  const font = (px, w) => (w || 400) + ' ' + px + 'px ' + CARD_FONT;
  g.fillStyle = EDGE; g.fillRect(0, 0, CARD_W, CARD_H);
  g.fillStyle = BG; g.fillRect(16, 16, CARD_W - 32, CARD_H - 32);
  g.strokeStyle = GOLD; g.lineWidth = 4; g.strokeRect(16, 16, CARD_W - 32, CARD_H - 32);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.fillStyle = GOLD; g.font = font(22, 500); g.fillText('workspacehq · stat card', 64, 92);
  g.fillStyle = TEXT; g.font = font(64, 700); g.fillText(fit(g, 'Level ' + card.level + (card.title ? ' · ' + card.title : ''), CARD_W - 128), 64, 176);
  g.fillStyle = DIM; g.font = font(20, 400); g.fillText('measured from your scans', 64, 236);
  const rows = (card.stats || []).slice(0, 5);
  rows.forEach((s, i) => {
    const y = 300 + i * 56;
    g.fillStyle = 'rgba(255,210,63,.18)'; g.fillRect(64, y + 18, CARD_W - 128, 2);
    g.textAlign = 'left'; g.fillStyle = DIM; g.font = font(26, 400); g.fillText(fit(g, String(s.k), 640), 64, y);
    g.textAlign = 'right'; g.fillStyle = TEXT; g.font = font(30, 600); g.fillText(fit(g, String(s.v), 440), CARD_W - 64, y);
  });
  g.textAlign = 'right'; g.fillStyle = DIM; g.font = font(18, 400); g.fillText(String(card.date || ''), CARD_W - 64, CARD_H - 48);
  g.textAlign = 'left';
}

// shorten text with an ellipsis until it fits maxW
function fit(g, text, maxW) {
  if (!g.measureText || g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
