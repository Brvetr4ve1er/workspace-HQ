// hero.js — LOOKBACK's ONE focal element: the momentum forecast, promoted out
// of the TRENDS chart grid and up above the section tabs.
//
// WHY IT MOVED (v4.3 beautify pass). The v4 design constitution asks every
// surface to answer "what is the ONE thing this screen wants me to see?" in a
// glance. LOOKBACK's answer is not any single chart — it is "where is this
// account heading". That was previously the third tile in a ten-tile grid,
// visually indistinguishable from "Automation runs / day". Promoted here it is
// the only display-weight type on the screen and the only violet-glow panel,
// exactly the shape home/view.js's `.oracle` established.
//
// It is rendered ABOVE the tab bar and repainted by view.js's paint(), so it
// belongs to the whole surface rather than to one section: Trends, Trophies and
// Timeline all read under the same headline, and each of those sections then
// has no rival focal of its own.
//
// NOTHING IS ADDED AND NOTHING IS DROPPED. Every fact this block prints — the
// trend word, the slope, the ETA, the sample-size basis — is the same fact
// trends.js's forecastCard printed, produced by the same two pure functions.
//
// THE HONESTY CONTRACT, carried over verbatim from that card:
//   UNITS      the least-squares fit is per trend SAMPLE — one sample per scan,
//              and scans are NOT daily — so the slope is XP/scan and any ETA is
//              counted in SCANS. Nothing here may claim calendar days; that
//              would need an observed scans-per-day rate, which nothing computes.
//   FALLING    must NOT inherit the flat copy ("not enough forward motion"),
//              which reads as "nearly there" under a falling headline. A
//              negative slope has no crossing with the next level, so there is
//              no ETA to project and the block says exactly that.
//   BASIS      "based on N scans" is load-bearing honesty about the fit, not a
//              footnote. A slope fitted over four samples reads far more
//              confident than it deserves. Never style it out of existence.
//
// PURITY. `now` is threaded in from view.js's paint() and never read here, which
// is what keeps intel/*.mjs pure and the forecast honest under the scrubber.
import { el, esc, fmt } from '../../ui/util.js';
import { momentum } from '../../intel/derive.mjs';
import { forecastLine } from '../../intel/foresight.mjs';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

// Mixed-case headline words. The old card shouted these through a `.figure`
// whose CSS uppercased nothing but whose violet glow made "Rising" compete with
// the number beside it; here the word is part of a sentence.
const TREND_WORD = { rising: 'Rising', falling: 'Falling', flat: 'Flat' };

// The headline sentence per trend. One display line, mixed case, no shouting.
function headline(f) {
  const mag = Math.abs(f.slopePerScan);
  if (f.trend === 'rising')  return `Rising by ${fmt(mag)} XP per scan`;
  if (f.trend === 'falling') return `Falling by ${fmt(mag)} XP per scan`;
  return 'Holding steady, scan to scan';
}

// The second line: what that means next. Three states, three sentences.
function outlook(f, target) {
  if (f.trend === 'falling') return 'XP is trending down, so there is no level ETA to project.';
  if (f.trend === 'flat' || f.etaLabel === '—') return 'Not enough forward motion to project a date.';
  return `About ${f.etaLabel.replace('~', '')} to level ${fmt(target)}.`;
}

// Builds and appends the hero. Returns the facts view.js logs.
export function renderHero(parent, ctx, now) {
  const S = ctx.data.selected;
  const m = momentum(S?.trends, S?.account, now);
  const f = forecastLine(m);
  const target = num(S?.account?.level) + 1;
  const sampleN = (S?.trends?.xp || []).length;

  const hero = el('section', 'lb-hero');
  hero.dataset.trend = f.trend;
  hero.innerHTML = `
    <div class="lb-eyebrow">MOMENTUM FORECAST</div>
    <h1 class="lb-hero-line">${esc(headline(f))}</h1>
    <p class="lb-hero-out">${esc(outlook(f, target))}</p>
    <p class="lb-hero-basis">Fitted over ${esc(fmt(sampleN))} scan${sampleN === 1 ? '' : 's'} of XP history.</p>`;
  parent.appendChild(hero);

  return { trend: f.trend, slope: f.slopePerScan, eta: f.etaLabel, basis: sampleN, word: TREND_WORD[f.trend] || f.trend };
}
