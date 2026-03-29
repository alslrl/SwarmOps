import { buildCohortCounts } from './archetypes.mjs';

export function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeWeights(weights) {
  const entries = Object.entries(weights).map(([key, value]) => [key, Math.max(Number(value) || 0, 0)]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) {
    return Object.fromEntries(entries.map(([key]) => [key, 1 / entries.length]));
  }
  return Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
}

export function sampleChoice(normalizedWeights, rng) {
  const roll = rng();
  let cursor = 0;
  for (const [choice, weight] of Object.entries(normalizedWeights)) {
    cursor += weight;
    if (roll <= cursor) return choice;
  }
  return Object.keys(normalizedWeights)[Object.keys(normalizedWeights).length - 1];
}

export function sampleStrategyResults({ archetypes, evaluationsByArchetype, totalBuyers, seed }) {
  const rng = mulberry32(seed);
  const counts = buildCohortCounts(archetypes, totalBuyers);
  const strategyResults = {};

  for (const { archetype, count } of counts) {
    const evaluations = evaluationsByArchetype[archetype.id] ?? [];
    for (const evaluation of evaluations) {
      if (!strategyResults[evaluation.strategy_id]) {
        strategyResults[evaluation.strategy_id] = {
          strategy_id: evaluation.strategy_id,
          total_buyers: 0,
          choices: {
            our_product: 0,
            competitor_a: 0,
            competitor_b: 0,
            competitor_c: 0,
            pass: 0,
          },
          archetype_breakdown: {},
        };
      }
      const normalized = normalizeWeights(evaluation.weights);
      const breakdown = {
        archetype_id: archetype.id,
        count,
        choices: {
          our_product: 0,
          competitor_a: 0,
          competitor_b: 0,
          competitor_c: 0,
          pass: 0,
        },
      };

      for (let i = 0; i < count; i += 1) {
        const choice = sampleChoice(normalized, rng);
        strategyResults[evaluation.strategy_id].choices[choice] += 1;
        breakdown.choices[choice] += 1;
        strategyResults[evaluation.strategy_id].total_buyers += 1;
      }

      strategyResults[evaluation.strategy_id].archetype_breakdown[archetype.id] = breakdown;
    }
  }

  return strategyResults;
}
