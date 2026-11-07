// "Is this a spend line?" — the renderer's copy of the one-line spend gate (Ctrl K's "Log a spend" row).
// PURE and import-free: the renderer can't import main-side code, and dashboard/cast.js is a classic script, so this
// block exists three times — dashboard/money/quicklog.mjs (main), here, and cast.js (the integrator pastes the block
// between the BEGIN/END markers there, dropping the `export` keywords). dashboard/money-line-parity.test.mjs runs one
// table of lines through every copy so they can't drift.
//
//   amountLine(text) → null | { amount:number, currency:'DA'|'USD', tagged:boolean }
//     a standalone number at the start or the end of the line ('150 cafe', 'cafe 150', '$12.49 netflix', 'taxi 400da',
//     'hier taxi 400'); a bare number in the middle of words, zero, 1e9 or more, an EUR tag, more than 200 characters
//     and a lone year (1900–2099, no tag, no category word: '2026 plan') are not spend lines.
//   The row's label comes from main's dry preview (apply({type:'log-line', dry:true})), never from here.
//
// ---- BEGIN amountLine block (copy me) ----
export const MAX_LINE = 200;
export const CATEGORY_WORDS = ['cafe', 'coffee', 'kahwa', 'courses', 'pain', 'food', 'resto', 'snack', 'taxi', 'bus', 'yassir', 'essence', 'tram', 'metro', 'loyer', 'idoom', 'sonelgaz', 'facture', 'pharmacie', 'pharmacy'];
const AL_SP = '[ \\u00A0\\u202F\\u2009]';
const AL_NUM = `\\d{1,3}(?:(?:${AL_SP}|[.,])\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?`;
const AL_TAG_PRE = 'us\\$|usd|\\$|dzd|da|eur|€';
const AL_TAG_POST = 'dzd|dinars?|da|usd|\\$|dollars?|eur|€';
const AL_PRE = `(?:(${AL_TAG_PRE})${AL_SP}?)?`;
const AL_POST = `(?:${AL_SP}?(${AL_TAG_POST})(?![\\p{L}\\d]))?`;
const AL_START = new RegExp(`^${AL_PRE}(${AL_NUM})${AL_POST}(?=\\s|$)`, 'iu');
const AL_END = new RegExp(`(?<=^|\\s)${AL_PRE}(${AL_NUM})${AL_POST}$`, 'iu');
function alParse(raw) {   // parse.mjs's parseAmount: a separator before exactly three digits is thousands, the last one before 1–2 digits is the point
  const s = raw.replace(/[\s   ]/g, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(s)) return null;
  const m = /^(.*?)[.,](\d{1,2})$/.exec(s), intPart = m ? m[1] : s, frac = m ? m[2] : '';
  if (!/^\d+(?:[.,]\d{3})*$/.test(intPart)) return null;
  const n = Number(`${intPart.replace(/[.,]/g, '')}${frac ? `.${frac}` : ''}`);
  return Number.isFinite(n) ? n : null;
}
function alTag(t) {
  if (!t) return '';
  const x = t.toLowerCase();
  return x === 'da' || x === 'dzd' || x.startsWith('dinar') ? 'DA' : x === 'usd' || x === 'us$' || x === '$' || x.startsWith('dollar') ? 'USD' : 'EUR';
}
const alWords = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9$]+/).filter(Boolean);
export function amountLine(text) {
  if (typeof text !== 'string') return null;
  const s0 = text.trim().replace(/\s+/g, ' ');
  if (!s0 || s0.length > MAX_LINE) return null;
  const s = s0.replace(/^(?:hier|yesterday) /i, '').replace(/ (?:hier|yesterday)$/i, '');
  const m = AL_START.exec(s) || AL_END.exec(s);
  if (!m) return null;
  const n = alParse(m[2]);
  if (n === null || n <= 0 || n >= 1e9) return null;
  const pre = alTag(m[1]), post = alTag(m[3]);
  if (pre === 'EUR' || post === 'EUR' || (pre && post && pre !== post)) return null;
  const currency = pre || post, tagged = currency !== '';
  if (!tagged && /^\d{4}$/.test(m[2]) && n >= 1900 && n <= 2099) {
    const rest = alWords(s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length));
    if (!rest.some((w) => CATEGORY_WORDS.includes(w))) return null;
  }
  return { amount: Math.round(n * 100) / 100, currency: currency || 'DA', tagged };
}
// ---- END amountLine block ----
