export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;

  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return Number(value.toFixed(1));
}

export function p95(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;

  // Nearest-rank empirical p95. With ten samples this is the observed maximum.
  const rank = Math.ceil(sorted.length * 0.95);
  return Number(sorted[Math.max(0, rank - 1)].toFixed(1));
}

export function summarize(values) {
  const finite = values.filter(Number.isFinite);
  return {
    sampleCount: finite.length,
    medianMs: median(finite),
    empiricalP95Ms: p95(finite),
  };
}
