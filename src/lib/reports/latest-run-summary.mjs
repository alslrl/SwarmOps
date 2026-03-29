import fs from 'node:fs/promises';
import path from 'node:path';

export async function writeLatestRunSummary({ outputDir, result }) {
  await fs.mkdir(outputDir, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    sampler_seed: result.sampler_seed,
    selected_strategy_id: result.selected_strategy.id,
    baseline_revenue: result.baseline.simulated_revenue,
    final_revenue: result.selected_strategy.simulated_revenue,
    holdout_uplift: result.holdout.holdout_uplift,
    rejected_strategies: result.rejected_strategies.map((item) => ({
      id: item.id,
      reason: item.rejection_reason,
    })),
    diff: result.diff,
  };
  const filePath = path.join(outputDir, 'latest-run-summary.json');
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
  return { filePath, payload };
}
