// Secret masking for the Claude Hub index (spec §4). Pure, no deps, never throws.
// The original transcripts on disk are never modified; only indexed text is masked.
export const MASK = (name) => `••• secret (${name})`;

// order matters: specific shapes before generic ones (sk-ant- before sk-)
const RULES = [
  { name: 'private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g },
  // A block with no END line: a transcript can hold an unterminated BEGIN (a pasted half key, a log cut by its
  // writer). Everything after it is masked to the end of the text (conservative: never leak the tail). Masking runs
  // on the full text before any cut, so this is not about our own truncation. Runs after the terminated rule so a
  // complete block keeps its context.
  { name: 'private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*$/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { name: 'stripe-key', re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { name: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'google-key', re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { name: 'bearer', re: /(\bAuthorization:\s*Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, keep: 1 },
];

export function maskSecrets(input) {
  let text = typeof input === 'string' ? input : '';
  let hits = 0;
  for (const r of RULES) {
    text = text.replace(r.re, (...m) => { hits++; return (r.keep ? m[r.keep] : '') + MASK(r.name); });
  }
  return { text, hits };
}
