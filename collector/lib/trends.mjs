// Append today's data point to a trend series, replacing any existing point for
// the same day (idempotent per scan). Pure. The TODAY global became an explicit
// `today` param (inserted before the optional key).
export function appendTrend(arr, point, today, key = 'd') {
  const a = (arr || []).filter((x) => x[key] !== today);
  a.push(point);
  return a;
}
