// WATCHTOWER category map — domain → social/video/dev/docs/ai/news/shopping/other.
// Substring rules, FIRST HIT WINS: keep specific needles (claude.ai, docs.google)
// above the broad ones, and extend by inserting a [needle, category] pair — no
// other code changes needed.
import { COL } from '../../ui/util.js';

export const CATEGORIES = {
  social:   { label: 'SOCIAL',   color: COL.pink },
  video:    { label: 'VIDEO',    color: COL.red },
  dev:      { label: 'DEV',      color: COL.green },
  docs:     { label: 'DOCS',     color: COL.blue },
  ai:       { label: 'AI',       color: COL.cyan },
  news:     { label: 'NEWS',     color: COL.orange },
  shopping: { label: 'SHOPPING', color: COL.gold },
  other:    { label: 'OTHER',    color: '#9a93c9' },
};

const RULES = [
  // ai — before dev/docs so claude.ai / gemini.google never fall through
  ['claude.ai', 'ai'], ['claude.com', 'ai'], ['anthropic', 'ai'], ['chatgpt', 'ai'],
  ['openai', 'ai'], ['gemini.google', 'ai'], ['perplexity', 'ai'],
  ['copilot.microsoft', 'ai'], ['huggingface', 'ai'], ['midjourney', 'ai'],
  // video
  ['youtube', 'video'], ['youtu.be', 'video'], ['twitch', 'video'], ['netflix', 'video'],
  ['tiktok', 'video'], ['vimeo', 'video'], ['crunchyroll', 'video'], ['kick.com', 'video'],
  ['primevideo', 'video'], ['disneyplus', 'video'],
  // social
  ['instagram', 'social'], ['x.com', 'social'], ['twitter', 'social'], ['reddit', 'social'],
  ['tumblr', 'social'], ['discord', 'social'], ['facebook', 'social'], ['threads.net', 'social'],
  ['bsky.app', 'social'], ['mastodon', 'social'], ['linkedin', 'social'], ['pinterest', 'social'],
  ['snapchat', 'social'], ['telegram', 'social'], ['whatsapp', 'social'],
  // docs — reference/reading; docs.google before the generic google fallthrough
  ['docs.google', 'docs'], ['notion.so', 'docs'], ['wikipedia', 'docs'], ['obsidian.md', 'docs'],
  ['developer.mozilla', 'docs'], ['readthedocs', 'docs'], ['confluence', 'docs'],
  ['stackexchange', 'docs'],
  // dev — repos, consoles, deploy targets, localhost previews
  ['github', 'dev'], ['gitlab', 'dev'], ['bitbucket', 'dev'], ['stackoverflow', 'dev'],
  ['localhost', 'dev'], ['127.0.0.1', 'dev'], ['vercel.app', 'dev'], ['vercel.com', 'dev'],
  ['netlify', 'dev'], ['cloudflare', 'dev'], ['npmjs', 'dev'], ['codepen', 'dev'],
  ['codesandbox', 'dev'], ['replit', 'dev'], ['supabase', 'dev'],
  ['firebase.google', 'dev'], ['console.cloud.google', 'dev'], ['console.aws', 'dev'],
  // news
  ['news.ycombinator', 'news'], ['theverge', 'news'], ['techcrunch', 'news'],
  ['arstechnica', 'news'], ['reuters', 'news'], ['nytimes', 'news'],
  ['theguardian', 'news'], ['bbc.', 'news'], ['cnn.', 'news'],
  // shopping
  ['amazon.', 'shopping'], ['ebay.', 'shopping'], ['aliexpress', 'shopping'],
  ['etsy.', 'shopping'], ['temu.', 'shopping'],
];

export function categorize(domain) {
  const d = String(domain || '').toLowerCase();
  for (const [needle, cat] of RULES) if (d.includes(needle)) return cat;
  return 'other';
}
