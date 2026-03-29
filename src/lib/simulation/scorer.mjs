export function computeMarginRate(price, cost) {
  if (!price || price <= 0) return 0;
  return (price - cost) / price;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function isMarginFloorSatisfied(price, cost, floor) {
  return computeMarginRate(price, cost) >= floor;
}

export function countTextDelta(before, after) {
  if (before === after) return 0;
  return Math.abs(String(before ?? '').length - String(after ?? '').length) + levenshtein(String(before ?? ''), String(after ?? ''));
}

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => (row === 0 ? col : col === 0 ? row : 0)));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[rows - 1][cols - 1];
}

export function buildScoredStrategy({ candidate, baseline, sampledResult, cost, minimumMarginFloor }) {
  const margin_rate = computeMarginRate(candidate.price_krw, cost);
  const margin_floor_violations = isMarginFloorSatisfied(candidate.price_krw, cost, minimumMarginFloor) ? 0 : 1;
  const simulated_revenue = sampledResult.choices.our_product * candidate.price_krw;
  const text_delta = countTextDelta(baseline.title, candidate.title) + countTextDelta(baseline.top_copy, candidate.top_copy);

  return {
    ...candidate,
    sampled_result: sampledResult,
    simulated_revenue,
    margin_rate,
    margin_floor_violations,
    text_delta,
  };
}

export function compareStrategies(a, b) {
  if (a.margin_floor_violations !== b.margin_floor_violations) {
    return a.margin_floor_violations - b.margin_floor_violations;
  }
  if (a.simulated_revenue !== b.simulated_revenue) {
    return b.simulated_revenue - a.simulated_revenue;
  }
  if (a.margin_rate !== b.margin_rate) {
    return b.margin_rate - a.margin_rate;
  }
  return a.text_delta - b.text_delta;
}
