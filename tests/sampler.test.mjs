import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleStrategyResults } from '../src/lib/simulation/sampler.mjs';

const archetypes = [
  { id: 'a', cohort_weight_percent: 50 },
  { id: 'b', cohort_weight_percent: 50 },
];
const evaluationsByArchetype = {
  a: [{ strategy_id: 's1', weights: { our_product: 1, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 } }],
  b: [{ strategy_id: 's1', weights: { our_product: 0, competitor_a: 1, competitor_b: 0, competitor_c: 0, pass: 0 } }],
};

test('sampler is deterministic for the same seed', () => {
  const first = sampleStrategyResults({ archetypes, evaluationsByArchetype, totalBuyers: 10, seed: 42 });
  const second = sampleStrategyResults({ archetypes, evaluationsByArchetype, totalBuyers: 10, seed: 42 });
  assert.deepEqual(first, second);
});

test('sampler respects total buyer count', () => {
  const result = sampleStrategyResults({ archetypes, evaluationsByArchetype, totalBuyers: 10, seed: 1 });
  assert.equal(result.s1.total_buyers, 10);
});
