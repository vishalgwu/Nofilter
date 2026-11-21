// Small statistics helpers for the speed report (nearest-rank percentiles).

export function percentile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * v.length));
  return v[Math.min(v.length, rank) - 1];
}

export function summarize(values) {
  const v = values.filter((x) => Number.isFinite(x));
  return { n: v.length, p50: percentile(v, 50), p90: percentile(v, 90) };
}
