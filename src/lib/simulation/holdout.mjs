export function evaluateHoldout({ baselineRevenue, finalRevenue }) {
  const holdout_uplift = finalRevenue - baselineRevenue;
  return {
    baseline_revenue: baselineRevenue,
    final_revenue: finalRevenue,
    holdout_uplift,
    passes_gate: holdout_uplift > 0,
  };
}
