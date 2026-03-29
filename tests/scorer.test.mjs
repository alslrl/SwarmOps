import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScoredStrategy, compareStrategies, computeMarginRate, isMarginFloorSatisfied } from '../src/lib/simulation/scorer.mjs';

test('margin helpers work', () => {
  assert.equal(Number(computeMarginRate(20000, 10000).toFixed(2)), 0.5);
  assert.equal(isMarginFloorSatisfied(20000, 10000, 0.4), true);
  assert.equal(isMarginFloorSatisfied(20000, 18000, 0.2), false);
});

test('compareStrategies prefers higher revenue after constraints', () => {
  const baseline = { title: 'A', top_copy: 'B' };
  const a = buildScoredStrategy({ candidate: { id: 'a', title: 'A1', top_copy: 'B1', price_krw: 20000 }, baseline, sampledResult: { choices: { our_product: 10 } }, cost: 10000, minimumMarginFloor: 0.2 });
  const b = buildScoredStrategy({ candidate: { id: 'b', title: 'A2', top_copy: 'B2', price_krw: 22000 }, baseline, sampledResult: { choices: { our_product: 8 } }, cost: 10000, minimumMarginFloor: 0.2 });
  assert.ok(compareStrategies(a, b) < 0);
});
