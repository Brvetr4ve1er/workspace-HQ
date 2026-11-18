// The Lantern look's cards (batch 11): a tarot card for each project and one for each of the five Workbench hosts. Pure: ids and real numbers in,
// shapes and readout text out. No DOM, no IO, no clock, and nothing imported that touches the page.
//
// The 22 glyphs (tarot order: The Fool to The World), the card frame and the card back are the owner's own original drawings, converted here to
// plain path strings in a 120 x 200 card box (every circle, ellipse and rect became an equivalent path, because the template draws paths only).
// A shape's colour is a TOKEN NAME (var(--lnt-glyph), var(--lnt-card), var(--lnt-blood), var(--lnt-brass), ...), never a literal colour, so the cards
// follow the dark and the light base: bone cards with ink glyphs on both.
//
//   ARCANA                 the 22 rows { n, roman, name, glyph, shapes } (frozen)
//   cardFor(projectId)     the card number 0..21: FNV-1a (32 bit) of the id, modulo 22. The same id is the same card for ever.
//   bindProject(id)        the picture of that project's card; the bottom line is the card name, the spoken name is "Arcana XVI, The Tower"
//   bindCard(kind, n, more?)  one of the five readout cards (cleared | skills | notes | needyou | projects); the bottom line is the readout the
//                          Workbench look shows for the same number (logic/workbench-art.mjs READOUTS); more says the number is a floor ("N+")
//   bindSealed()           the face-down card back (the word SEALED, no number), drawn while a number has not been read yet (never a false 0)
//   LNT_EMPTY_ART          the picture every key of the lntv group carries while the look is off (frozen)
// Every picture: { show, sealed, face, aria, viewBox, shapes: [{ key, d, fill, stroke, sw, cap }], title, label, roman }.
import { READOUTS, readoutCount, WBN_KINDS } from './workbench-art.mjs';

export const LNT_VIEW = Object.freeze({ w: 120, h: 200 });
export const LNT_VIEWBOX = '0 0 120 200';
export const LNT_TOKENS = Object.freeze(['var(--lnt-glyph)', 'var(--lnt-card)', 'var(--lnt-blood)', 'var(--lnt-brass)', 'var(--lnt-brass-dim)', 'var(--lnt-back)', 'var(--frame-hi)', 'none']);
const TOK = Object.freeze({ G: 'var(--lnt-glyph)', C: 'var(--lnt-card)', B: 'var(--lnt-blood)', L: 'var(--lnt-brass)' });   // the glyph table's four colour letters

// [d, fill letter | null, stroke letter | null, stroke width, linecap | ''] : each row is one element of the owner's drawing
const GLYPH_ROWS = {
  door: [
    ['M42 132V82a18 18 0 0 1 36 0v50z', 'G', null, 0, ''],
    ['M67.5 108a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0z', 'C', null, 0, ''],
    ['M30 133h60', null, 'G', 3, ''],
  ],
  infinity: [
    ['M38 78c0-11 14-11 22 0s22 11 22 0-14-11-22 0-22 11-22 0z', null, 'G', 4, ''],
    ['M60 94v44', null, 'G', 5, ''],
    ['M56 93a4 4 0 1 0 8 0a4 4 0 1 0 -8 0z', 'G', null, 0, ''],
  ],
  eye: [
    ['M34 124V88a26 26 0 0 1 52 0v36', null, 'G', 4, ''],
    ['M38 100q22-20 44 0q-22 20-44 0z', 'G', null, 0, ''],
    ['M53 100a7 7 0 1 0 14 0a7 7 0 1 0 -14 0z', 'C', null, 0, ''],
    ['M57 100a3 3 0 1 0 6 0a3 3 0 1 0 -6 0z', 'G', null, 0, ''],
  ],
  cradle: [
    ['M34 98a26 26 0 0 0 52 0z', 'G', null, 0, ''],
    ['M51 82a9 9 0 1 0 18 0a9 9 0 1 0 -18 0z', 'G', null, 0, ''],
    ['M40 138h40', null, 'G', 3, ''],
  ],
  crown: [
    ['M34 120V80l13 16 13-22 13 22 13-16v40z', 'G', null, 0, ''],
    ['M34 129h52', null, 'G', 4, ''],
  ],
  chalice: [
    ['M38 62h44c0 24-9 37-22 39c-13-2-22-15-22-39z M57 100h6v20h-6z M44 120h32v7H44z', 'G', null, 0, ''],
    ['M60 70c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12z', 'B', null, 0, ''],
  ],
  rings: [
    ['M33 96a17 17 0 1 0 34 0a17 17 0 1 0 -34 0z', null, 'G', 5, ''],
    ['M53 96a17 17 0 1 0 34 0a17 17 0 1 0 -34 0z', null, 'G', 5, ''],
  ],
  chariot: [
    ['M30 120a12 12 0 1 0 24 0a12 12 0 1 0 -24 0z', null, 'G', 4, ''],
    ['M66 120a12 12 0 1 0 24 0a12 12 0 1 0 -24 0z', null, 'G', 4, ''],
    ['M32 98h56v9H32z M46 74h28v24H46z', 'G', null, 0, ''],
  ],
  claws: [
    ['M40 70l10 64M57 66l7 70M74 70l6 64', null, 'G', 6, 'round'],
  ],
  lantern: [
    ['M52 66h16v6H52z M46 72h28v48H46z M50 120h20v6H50z', 'G', null, 0, ''],
    ['M55 62a5 5 0 0 1 10 0', null, 'G', 3, ''],
    ['M60 82c5 7 6 11 6 14a6 6 0 0 1-12 0c0-3 1-7 6-14z', 'L', null, 0, ''],
  ],
  wheel: [
    ['M30 100a30 30 0 1 0 60 0a30 30 0 1 0 -60 0z', null, 'G', 5, ''],
    ['M54 100a6 6 0 1 0 12 0a6 6 0 1 0 -12 0z', 'G', null, 0, ''],
    ['M60 70v60M30 100h60M39 79l42 42M81 79l-42 42', null, 'G', 3, ''],
  ],
  scales: [
    ['M60 64v68M44 132h32M30 80h60', null, 'G', 4, ''],
    ['M30 80l-9 22h18z M90 80l-9 22h18z', null, 'G', 2.5, ''],
    ['M19 102a11 6 0 0 0 22 0z M79 102a11 6 0 0 0 22 0z', 'G', null, 0, ''],
  ],
  hanged: [
    ['M28 62h64', null, 'G', 5, ''],
    ['M60 62v22', null, 'G', 3, ''],
    ['M42 84h36l-18 34z', 'G', null, 0, ''],
    ['M52 128a8 8 0 1 0 16 0a8 8 0 1 0 -16 0z', 'G', null, 0, ''],
  ],
  hourglass: [
    ['M40 64h40v6c0 14-14 22-14 30s14 16 14 30v6H40v-6c0-14 14-22 14-30s-14-16-14-30z', 'G', null, 0, ''],
    ['M52 128h16l-8-10z', 'C', null, 0, ''],
  ],
  temperance: [
    ['M32 72h22l-3 24H35z M66 106h22l-3 24H69z', 'G', null, 0, ''],
    ['M53 80c11 4 15 13 17 26', null, 'B', 3, ''],
  ],
  devil: [
    ['M38 106a22 22 0 1 0 44 0a22 22 0 1 0 -44 0z', 'G', null, 0, ''],
    ['M42 92c-8-10-8-22-2-30c2 10 8 16 14 20z M78 92c8-10 8-22 2-30c-2 10-8 16-14 20z', 'G', null, 0, ''],
    ['M49 104a3 3 0 1 0 6 0a3 3 0 1 0 -6 0z', 'C', null, 0, ''],
    ['M65 104a3 3 0 1 0 6 0a3 3 0 1 0 -6 0z', 'C', null, 0, ''],
  ],
  tower: [
    ['M48 72h24v62H48z M44 64h32v9H44z M44 57h6v7h-6z M57 57h6v7h-6z M70 57h6v7h-6z', 'G', null, 0, ''],
    ['M56 86h8v12h-8z', 'C', null, 0, ''],
    ['M52 72c-4-8 2-12 4-18c3 7 6 10 2 18z M66 72c-3-6 1-10 3-15c3 6 5 9 1 15z', 'B', null, 0, ''],
  ],
  star: [
    ['M60 52l6 22 22 6-22 6-6 22-6-22-22-6 22-6z', 'G', null, 0, ''],
    ['M60 66l2 11 11 3-11 3-2 11-2-11-11-3 11-3z', 'C', null, 0, ''],
    ['M30 132h60M38 140h44M46 148h28', null, 'G', 3, ''],
  ],
  moon: [
    ['M68 66a26 26 0 1 0 0 44a20 20 0 1 1 0-44z', 'G', null, 0, ''],
    ['M30 130h60M38 138h44M46 146h28', null, 'G', 3, ''],
  ],
  sun: [
    ['M42 100a18 18 0 1 0 36 0a18 18 0 1 0 -36 0z', 'G', null, 0, ''],
    ['M60 76V62M60 124v14M36 100H22M84 100h14M43 83l-10-10M77 83l10-10M43 117l-10 10M77 117l10 10', null, 'G', 4, ''],
  ],
  bell: [
    ['M44 118c0-30 4-46 16-46s16 16 16 46z', 'G', null, 0, ''],
    ['M38 118h44', null, 'G', 4, ''],
    ['M55 126a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z', 'G', null, 0, ''],
    ['M30 92q-6 8 0 16M90 92q6 8 0 16', null, 'G', 2.5, ''],
  ],
  world: [
    ['M34 100a26 36 0 1 0 52 0a26 36 0 1 0 -52 0z', null, 'G', 5, ''],
    ['M60 62l5 7h-10z M60 138l5-7h-10z', 'G', null, 0, ''],
    ['M55 100a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z', 'G', null, 0, ''],
  ],
};

const shape = (d, fill, stroke, sw, cap) => ({ d, fill, stroke, sw, cap: cap || 'butt' });
const fromRow = ([d, f, k, sw, cap]) => shape(d, f ? TOK[f] : 'none', k ? TOK[k] : 'none', k ? sw : 0, cap);

// the card frame (a bone card, a thin hairline so its edge shows on a parchment field, an ink inner line) and the card back (face down)
const FRAME = Object.freeze([
  shape('M7 1h106a6 6 0 0 1 6 6v186a6 6 0 0 1-6 6H7a6 6 0 0 1-6-6V7a6 6 0 0 1 6-6z', 'var(--lnt-card)', 'var(--frame-hi)', 1),
  shape('M10 7h100a3 3 0 0 1 3 3v180a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3z', 'none', 'var(--lnt-glyph)', 1.5),
]);
const BACK = Object.freeze([
  shape('M7 1h106a6 6 0 0 1 6 6v186a6 6 0 0 1-6 6H7a6 6 0 0 1-6-6V7a6 6 0 0 1 6-6z', 'var(--lnt-back)', 'var(--lnt-brass)', 1.5),
  shape('M11 8h98a3 3 0 0 1 3 3v178a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V11a3 3 0 0 1 3-3z', 'none', 'var(--frame-hi)', 1),
  shape('M60 58L60 142', 'none', 'var(--lnt-brass-dim)', 1),
  shape('M89.7 70.3L30.3 129.7', 'none', 'var(--lnt-brass-dim)', 1),
  shape('M102 100L18 100', 'none', 'var(--lnt-brass-dim)', 1),
  shape('M89.7 129.7L30.3 70.3', 'none', 'var(--lnt-brass-dim)', 1),
  shape('M30 100a30 30 0 1 0 60 0a30 30 0 1 0 -60 0z', 'var(--lnt-back)', 'var(--lnt-brass)', 1.2),
  shape('M42 100a18 18 0 1 0 36 0a18 18 0 1 0 -36 0z', 'none', 'var(--lnt-brass-dim)', 1),
  shape('M55 100a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z', 'var(--lnt-brass)', 'none', 0),
]);

const NAMES = [['0', 'The Fool', 'door'], ['I', 'The Magician', 'infinity'], ['II', 'The High Priestess', 'eye'], ['III', 'The Empress', 'cradle'], ['IV', 'The Emperor', 'crown'],
  ['V', 'The Hierophant', 'chalice'], ['VI', 'The Lovers', 'rings'], ['VII', 'The Chariot', 'chariot'], ['VIII', 'Strength', 'claws'], ['IX', 'The Hermit', 'lantern'],
  ['X', 'Wheel of Fortune', 'wheel'], ['XI', 'Justice', 'scales'], ['XII', 'The Hanged Man', 'hanged'], ['XIII', 'Death', 'hourglass'], ['XIV', 'Temperance', 'temperance'],
  ['XV', 'The Devil', 'devil'], ['XVI', 'The Tower', 'tower'], ['XVII', 'The Star', 'star'], ['XVIII', 'The Moon', 'moon'], ['XIX', 'The Sun', 'sun'], ['XX', 'Judgement', 'bell'], ['XXI', 'The World', 'world']];

export const ARCANA = Object.freeze(NAMES.map(([roman, name, glyph], n) => Object.freeze({
  n, roman, name, glyph, shapes: Object.freeze(GLYPH_ROWS[glyph].map((r) => Object.freeze(fromRow(r)))),
})));

/** FNV-1a, 32 bit, over the id's UTF-16 code units; modulo 22. A stable hash: the same project id is the same card on every machine and every day. */
export function cardFor(projectId) {
  const s = String(projectId === null || projectId === undefined ? '' : projectId);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % ARCANA.length;
}

const keyed = (list) => list.map((s, i) => ({ key: 'c' + i, d: s.d, fill: s.fill, stroke: s.stroke, sw: s.sw, cap: s.cap }));
const faceShapes = (card) => keyed(FRAME.concat(card.shapes));

/** The empty picture every key of the lntv group carries while the look is off (or no project page is open), so the template always meets the same keys. */
export const LNT_EMPTY_ART = Object.freeze({ show: false, sealed: false, face: '', aria: '', viewBox: LNT_VIEWBOX, shapes: Object.freeze([]), title: '', label: '', roman: '' });

/** The face-down card: the back, the word SEALED and no number at all. */
export const LNT_SEALED = Object.freeze({ show: true, sealed: true, face: 'sealed', aria: 'Not read yet, card face down', viewBox: LNT_VIEWBOX, shapes: Object.freeze(keyed(BACK)), title: 'Sealed', label: 'SEALED', roman: '' });
export const bindSealed = () => LNT_SEALED;

/** Which card each of the five Workbench hosts gets (an ARCANA index): The Hermit, The Lovers, The High Priestess, The Sun, The World. */
export const KIND_CARD = Object.freeze({ cleared: 9, skills: 6, notes: 2, needyou: 19, projects: 21 });

/** One of the five readout cards. The bottom line is the Workbench readout for the same number. An unknown kind is the empty picture. */
export function bindCard(kind, n, more = false) {
  if (!WBN_KINDS.includes(kind)) return LNT_EMPTY_ART;
  const card = ARCANA[KIND_CARD[kind]];
  const label = READOUTS[kind](readoutCount(n), kind === 'notes' && more === true);
  return { show: true, sealed: false, face: 'up', aria: label.toLowerCase() + ', card: ' + card.name, viewBox: LNT_VIEWBOX, shapes: faceShapes(card), title: card.name, label, roman: card.roman };
}

/** A project's own card. A missing or empty id has no card (the empty picture). */
export function bindProject(id) {
  if (typeof id !== 'string' || !id) return LNT_EMPTY_ART;
  const card = ARCANA[cardFor(id)];
  return { show: true, sealed: false, face: 'up', aria: 'Arcana ' + card.roman + ', ' + card.name, viewBox: LNT_VIEWBOX, shapes: faceShapes(card), title: card.name, label: card.name.toUpperCase(), roman: card.roman };
}
