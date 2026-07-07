// Shared numeric helpers for the collector engines. Pure, no I/O.
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const round = (n) => Math.round(n);
