/**
 * tests/iteration-result-accumulator.test.mjs
 *
 * Sub-AC 6a: Unit tests for the IterationResultAccumulator module.
 *
 * Validates that:
 *   1. push() correctly extracts choice_summary.our_product.{count,pct}
 *   2. push() correctly extracts archetype_breakdown[i].choices.our_product.pct
 *   3. The accumulator array grows with each push()
 *   4. getRevenueChartData() returns sorted { iteration, revenue, accepted } entries
 *   5. getOurProductRates() returns { iteration, our_product_count, our_product_pct }
 *   6. getArchetypeOurProductTimeseries() returns per-archetype pct timeseries
 *   7. getLatestBreakdown() returns the most recent archetype_breakdown array
 *   8. getLatestFlatBreakdown() returns a flat { archetypeId: { key: count } } object
 *   9. getAggregatedFlatBreakdown() sums counts across all iterations
 *  10. reset() clears all accumulated data
 *  11. Legacy flat format (key: number) is handled gracefully
 *  12. Immutable snapshot: returned items cannot mutate internal state
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIterationResultAccumulator,
  toFlatBreakdown,
} from '../src/lib/simulation/iteration-result-accumulator.mjs';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Build an iteration_complete event payload in Sub-AC 3c explicit schema.
 * choice_summary uses {count, pct} objects.
 * archetype_breakdown is an array with archetype_id, archetype_label, sample_size, choices.
 */
function makeIterationCompletePayload({
  iteration = 1,
  winner_id = 'strategy_a',
  winner_revenue = 14000000,
  accepted = true,
  rejected_count = 1,
  ourProductCount = 320,
  totalBuyers = 800,
} = {}) {
  const pct = parseFloat(((ourProductCount / totalBuyers) * 100).toFixed(2));
  const competitor_a_count = Math.floor((totalBuyers - ourProductCount) * 0.4);
  const competitor_b_count = Math.floor((totalBuyers - ourProductCount) * 0.3);
  const competitor_c_count = Math.floor((totalBuyers - ourProductCount) * 0.2);
  const pass_count = totalBuyers - ourProductCount - competitor_a_count - competitor_b_count - competitor_c_count;

  return {
    type: 'iteration_complete',
    iteration,
    winner_id,
    winner_revenue,
    accepted,
    rejected_count,
    choice_summary: {
      our_product:  { count: ourProductCount, pct },
      competitor_a: { count: competitor_a_count, pct: parseFloat(((competitor_a_count / totalBuyers) * 100).toFixed(2)) },
      competitor_b: { count: competitor_b_count, pct: parseFloat(((competitor_b_count / totalBuyers) * 100).toFixed(2)) },
      competitor_c: { count: competitor_c_count, pct: parseFloat(((competitor_c_count / totalBuyers) * 100).toFixed(2)) },
      pass:         { count: pass_count,          pct: parseFloat(((pass_count / totalBuyers) * 100).toFixed(2)) },
    },
    archetype_breakdown: [
      {
        archetype_id:    'price_sensitive',
        archetype_label: '가격 민감형',
        sample_size:     144,
        choices: {
          our_product:  { count: 50,  pct: 34.72 },
          competitor_a: { count: 40,  pct: 27.78 },
          competitor_b: { count: 30,  pct: 20.83 },
          competitor_c: { count: 20,  pct: 13.89 },
          pass:         { count: 4,   pct: 2.78  },
        },
      },
      {
        archetype_id:    'value_seeker',
        archetype_label: '가성비 균형형',
        sample_size:     128,
        choices: {
          our_product:  { count: 60,  pct: 46.88 },
          competitor_a: { count: 35,  pct: 27.34 },
          competitor_b: { count: 20,  pct: 15.63 },
          competitor_c: { count: 10,  pct: 7.81  },
          pass:         { count: 3,   pct: 2.34  },
        },
      },
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('createIterationResultAccumulator: factory returns object with expected methods', () => {
  const acc = createIterationResultAccumulator();
  assert.equal(typeof acc.push, 'function');
  assert.equal(typeof acc.getAll, 'function');
  assert.equal(typeof acc.getLatestResult, 'function');
  assert.equal(typeof acc.getLatestBreakdown, 'function');
  assert.equal(typeof acc.getLatestFlatBreakdown, 'function');
  assert.equal(typeof acc.getAggregatedFlatBreakdown, 'function');
  assert.equal(typeof acc.getRevenueChartData, 'function');
  assert.equal(typeof acc.getOurProductRates, 'function');
  assert.equal(typeof acc.getArchetypeOurProductTimeseries, 'function');
  assert.equal(typeof acc.reset, 'function');
  assert.equal(typeof acc.size, 'number');
});

test('push(): extracts our_product_count from choice_summary.our_product.count', () => {
  const acc = createIterationResultAccumulator();
  const payload = makeIterationCompletePayload({ ourProductCount: 320 });
  const result = acc.push(payload);
  assert.equal(result.our_product_count, 320);
});

test('push(): extracts our_product_pct from choice_summary.our_product.pct', () => {
  const acc = createIterationResultAccumulator();
  const payload = makeIterationCompletePayload({ ourProductCount: 320, totalBuyers: 800 });
  const result = acc.push(payload);
  // 320/800 = 40.0%
  assert.equal(result.our_product_pct, 40.0);
});

test('push(): extracts archetype_breakdown[i].choices.our_product.pct into archetype_our_product_pcts', () => {
  const acc = createIterationResultAccumulator();
  const payload = makeIterationCompletePayload();
  const result = acc.push(payload);

  assert.ok(Array.isArray(result.archetype_our_product_pcts), 'should be an array');
  assert.ok(result.archetype_our_product_pcts.length > 0, 'should have entries');

  // Check price_sensitive: pct = 34.72
  const priceSensitive = result.archetype_our_product_pcts.find(
    (e) => e.archetype_id === 'price_sensitive',
  );
  assert.ok(priceSensitive, 'price_sensitive entry must exist');
  assert.equal(priceSensitive.pct, 34.72);
  assert.equal(priceSensitive.archetype_label, '가격 민감형');

  // Check value_seeker: pct = 46.88
  const valueSeeker = result.archetype_our_product_pcts.find(
    (e) => e.archetype_id === 'value_seeker',
  );
  assert.ok(valueSeeker, 'value_seeker entry must exist');
  assert.equal(valueSeeker.pct, 46.88);
  assert.equal(valueSeeker.archetype_label, '가성비 균형형');
});

test('push(): archetype_our_product_pcts items have {archetype_id, archetype_label, pct}', () => {
  const acc = createIterationResultAccumulator();
  const result = acc.push(makeIterationCompletePayload());

  for (const entry of result.archetype_our_product_pcts) {
    assert.equal(typeof entry.archetype_id, 'string', 'archetype_id must be string');
    assert.equal(typeof entry.archetype_label, 'string', 'archetype_label must be string');
    assert.equal(typeof entry.pct, 'number', 'pct must be number');
    assert.ok(entry.pct >= 0 && entry.pct <= 100, `pct ${entry.pct} must be 0–100`);
  }
});

test('push(): accumulator grows with each call', () => {
  const acc = createIterationResultAccumulator();
  assert.equal(acc.size, 0);

  acc.push(makeIterationCompletePayload({ iteration: 1 }));
  assert.equal(acc.size, 1);

  acc.push(makeIterationCompletePayload({ iteration: 2 }));
  assert.equal(acc.size, 2);

  acc.push(makeIterationCompletePayload({ iteration: 3 }));
  assert.equal(acc.size, 3);
});

test('push(): returned item has all required AccumulatedIterationResult fields', () => {
  const acc = createIterationResultAccumulator();
  const payload = makeIterationCompletePayload({
    iteration: 2,
    winner_id: 'strategy_b',
    winner_revenue: 18500000,
    accepted: true,
    rejected_count: 2,
  });
  const result = acc.push(payload);

  assert.equal(result.iteration, 2);
  assert.equal(result.winner_id, 'strategy_b');
  assert.equal(result.winner_revenue, 18500000);
  assert.equal(result.accepted, true);
  assert.equal(result.rejected_count, 2);
  assert.equal(typeof result.our_product_count, 'number');
  assert.equal(typeof result.our_product_pct, 'number');
  assert.ok(Array.isArray(result.archetype_our_product_pcts));
  assert.equal(typeof result.choice_summary, 'object');
  assert.ok(Array.isArray(result.archetype_breakdown));
});

test('push(): returned item is frozen (immutable snapshot)', () => {
  const acc = createIterationResultAccumulator();
  const result = acc.push(makeIterationCompletePayload());
  assert.ok(Object.isFrozen(result), 'result must be frozen');
});

test('getRevenueChartData(): returns [{iteration, revenue, accepted}] sorted by iteration', () => {
  const acc = createIterationResultAccumulator();
  // Push out-of-order to verify sorting
  acc.push(makeIterationCompletePayload({ iteration: 3, winner_revenue: 20000000 }));
  acc.push(makeIterationCompletePayload({ iteration: 1, winner_revenue: 14000000 }));
  acc.push(makeIterationCompletePayload({ iteration: 2, winner_revenue: 17000000 }));

  const chartData = acc.getRevenueChartData();
  assert.equal(chartData.length, 3);
  assert.equal(chartData[0].iteration, 1);
  assert.equal(chartData[0].revenue, 14000000);
  assert.equal(chartData[1].iteration, 2);
  assert.equal(chartData[1].revenue, 17000000);
  assert.equal(chartData[2].iteration, 3);
  assert.equal(chartData[2].revenue, 20000000);
});

test('getRevenueChartData(): each entry has accepted boolean', () => {
  const acc = createIterationResultAccumulator();
  acc.push(makeIterationCompletePayload({ iteration: 1, accepted: true }));
  acc.push(makeIterationCompletePayload({ iteration: 2, accepted: false }));

  const chartData = acc.getRevenueChartData();
  assert.equal(chartData[0].accepted, true);
  assert.equal(chartData[1].accepted, false);
});

test('getOurProductRates(): returns per-iteration {iteration, our_product_count, our_product_pct}', () => {
  const acc = createIterationResultAccumulator();
  acc.push(makeIterationCompletePayload({ iteration: 1, ourProductCount: 200, totalBuyers: 800 }));
  acc.push(makeIterationCompletePayload({ iteration: 2, ourProductCount: 320, totalBuyers: 800 }));

  const rates = acc.getOurProductRates();
  assert.equal(rates.length, 2);
  assert.equal(rates[0].iteration, 1);
  assert.equal(rates[0].our_product_count, 200);
  assert.equal(rates[0].our_product_pct, 25.0);
  assert.equal(rates[1].iteration, 2);
  assert.equal(rates[1].our_product_count, 320);
  assert.equal(rates[1].our_product_pct, 40.0);
});

test('getArchetypeOurProductTimeseries(): returns {[archetypeId]: [{iteration, pct}]}', () => {
  const acc = createIterationResultAccumulator();
  acc.push(makeIterationCompletePayload({ iteration: 1 }));
  acc.push(makeIterationCompletePayload({ iteration: 2 }));

  const timeseries = acc.getArchetypeOurProductTimeseries();
  assert.ok(typeof timeseries === 'object');
  assert.ok('price_sensitive' in timeseries, 'should have price_sensitive key');
  assert.ok('value_seeker' in timeseries, 'should have value_seeker key');

  const series = timeseries['price_sensitive'];
  assert.ok(Array.isArray(series));
  assert.equal(series.length, 2);
  assert.equal(series[0].iteration, 1);
  assert.equal(typeof series[0].pct, 'number');
  // Sorted by iteration
  assert.ok(series[0].iteration <= series[1].iteration);
});

test('getLatestResult(): returns most recently pushed item', () => {
  const acc = createIterationResultAccumulator();
  assert.equal(acc.getLatestResult(), null);

  acc.push(makeIterationCompletePayload({ iteration: 1 }));
  acc.push(makeIterationCompletePayload({ iteration: 2 }));
  acc.push(makeIterationCompletePayload({ iteration: 3, winner_revenue: 25000000 }));

  const latest = acc.getLatestResult();
  assert.ok(latest !== null);
  assert.equal(latest.iteration, 3);
  assert.equal(latest.winner_revenue, 25000000);
});

test('getLatestBreakdown(): returns archetype_breakdown array from latest iteration', () => {
  const acc = createIterationResultAccumulator();
  acc.push(makeIterationCompletePayload({ iteration: 1 }));
  acc.push(makeIterationCompletePayload({ iteration: 2 }));

  const breakdown = acc.getLatestBreakdown();
  assert.ok(Array.isArray(breakdown), 'should be array');
  assert.ok(breakdown.length > 0, 'should be non-empty');

  // Each entry should have the Sub-AC 3c shape
  const entry = breakdown[0];
  assert.equal(typeof entry.archetype_id, 'string');
  assert.equal(typeof entry.archetype_label, 'string');
  assert.equal(typeof entry.sample_size, 'number');
  assert.equal(typeof entry.choices, 'object');
  assert.equal(typeof entry.choices.our_product.count, 'number');
  assert.equal(typeof entry.choices.our_product.pct, 'number');
});

test('getLatestFlatBreakdown(): returns flat {[archetypeId]: {key: count}} object', () => {
  const acc = createIterationResultAccumulator();
  acc.push(makeIterationCompletePayload());

  const flat = acc.getLatestFlatBreakdown();
  assert.ok(flat !== null);
  assert.ok('price_sensitive' in flat);
  assert.ok('value_seeker' in flat);

  const priceSensitive = flat['price_sensitive'];
  assert.equal(typeof priceSensitive.our_product, 'number');
  assert.equal(typeof priceSensitive.competitor_a, 'number');
  // Flat format uses plain counts (not {count, pct} objects)
  assert.equal(priceSensitive.our_product, 50);
});

test('getAggregatedFlatBreakdown(): sums counts across all iterations', () => {
  const acc = createIterationResultAccumulator();
  // Push same payload twice — counts should double
  acc.push(makeIterationCompletePayload({ iteration: 1 }));
  acc.push(makeIterationCompletePayload({ iteration: 2 }));

  const aggregated = acc.getAggregatedFlatBreakdown();
  assert.ok(aggregated !== null);
  assert.ok('price_sensitive' in aggregated);

  // price_sensitive our_product count is 50 per iteration × 2 iterations = 100
  assert.equal(aggregated['price_sensitive'].our_product, 100);
});

test('getAggregatedFlatBreakdown({ acceptedOnly: true }): only sums accepted iterations', () => {
  const acc = createIterationResultAccumulator();
  acc.push(makeIterationCompletePayload({ iteration: 1, ourProductCount: 200, accepted: true }));
  acc.push(makeIterationCompletePayload({ iteration: 2, ourProductCount: 100, accepted: false }));

  const allAgg  = acc.getAggregatedFlatBreakdown({ acceptedOnly: false });
  const accepted = acc.getAggregatedFlatBreakdown({ acceptedOnly: true });

  // Accepted-only should have fewer total our_product counts
  const allTotal = Object.values(allAgg).reduce((s, v) => s + v.our_product, 0);
  const accTotal = Object.values(accepted).reduce((s, v) => s + v.our_product, 0);
  assert.ok(accTotal <= allTotal, 'accepted-only should have fewer or equal total counts');
});

test('reset(): clears all accumulated data', () => {
  const acc = createIterationResultAccumulator();
  acc.push(makeIterationCompletePayload({ iteration: 1 }));
  acc.push(makeIterationCompletePayload({ iteration: 2 }));
  assert.equal(acc.size, 2);

  acc.reset();
  assert.equal(acc.size, 0);
  assert.equal(acc.getLatestResult(), null);
  assert.deepEqual(acc.getRevenueChartData(), []);
  assert.deepEqual(acc.getOurProductRates(), []);
  assert.deepEqual(acc.getArchetypeOurProductTimeseries(), {});
});

test('push(): handles legacy flat format (choice_summary as plain number)', () => {
  const acc = createIterationResultAccumulator();
  // Legacy flat: { our_product: 300, competitor_a: 200, ... }
  const legacyPayload = {
    type: 'iteration_complete',
    iteration: 1,
    winner_id: 'strategy_a',
    winner_revenue: 12000000,
    accepted: true,
    rejected_count: 0,
    choice_summary: {
      our_product: 300,
      competitor_a: 200,
      competitor_b: 150,
      competitor_c: 100,
      pass: 50,
    },
    archetype_breakdown: null,
  };

  const result = acc.push(legacyPayload);
  assert.equal(result.our_product_count, 300);
  // Legacy format has no pct → should be 0
  assert.equal(result.our_product_pct, 0);
  assert.deepEqual(result.archetype_our_product_pcts, []);
});

test('push(): handles missing/null choice_summary gracefully', () => {
  const acc = createIterationResultAccumulator();
  const result = acc.push({
    type: 'iteration_complete',
    iteration: 1,
    winner_id: 'x',
    winner_revenue: 0,
    accepted: true,
    rejected_count: 0,
    choice_summary: null,
    archetype_breakdown: null,
  });

  assert.equal(result.our_product_count, 0);
  assert.equal(result.our_product_pct, 0);
  assert.deepEqual(result.archetype_our_product_pcts, []);
});

test('getAll(): returns all accumulated items in push order', () => {
  const acc = createIterationResultAccumulator();
  acc.push(makeIterationCompletePayload({ iteration: 1 }));
  acc.push(makeIterationCompletePayload({ iteration: 2 }));
  acc.push(makeIterationCompletePayload({ iteration: 3 }));

  const all = acc.getAll();
  assert.equal(all.length, 3);
  assert.equal(all[0].iteration, 1);
  assert.equal(all[1].iteration, 2);
  assert.equal(all[2].iteration, 3);
});

test('push(): full Sub-AC 3c schema — choice_summary has {count, pct} for all 5 keys', () => {
  const acc = createIterationResultAccumulator();
  const result = acc.push(makeIterationCompletePayload());
  const cs = result.choice_summary;

  const CHOICE_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  for (const key of CHOICE_KEYS) {
    assert.ok(key in cs, `choice_summary must have key: ${key}`);
    assert.equal(typeof cs[key].count, 'number', `${key}.count must be number`);
    assert.equal(typeof cs[key].pct, 'number', `${key}.pct must be number`);
    assert.ok(cs[key].count >= 0, `${key}.count must be >= 0`);
    assert.ok(cs[key].pct >= 0 && cs[key].pct <= 100, `${key}.pct must be 0–100`);
  }
});

test('push(): archetype_breakdown array entries have {archetype_id, archetype_label, sample_size, choices}', () => {
  const acc = createIterationResultAccumulator();
  const result = acc.push(makeIterationCompletePayload());

  for (const entry of result.archetype_breakdown) {
    assert.equal(typeof entry.archetype_id, 'string', 'archetype_id must be string');
    assert.equal(typeof entry.archetype_label, 'string', 'archetype_label must be string');
    assert.equal(typeof entry.sample_size, 'number', 'sample_size must be number');
    assert.ok(entry.sample_size >= 0, 'sample_size must be >= 0');
    assert.equal(typeof entry.choices, 'object', 'choices must be object');
    assert.equal(typeof entry.choices.our_product.count, 'number');
    assert.equal(typeof entry.choices.our_product.pct, 'number');
  }
});

// ── toFlatBreakdown export ────────────────────────────────────────────────────

test('toFlatBreakdown(): converts archetype_breakdown array to flat {archetypeId: {key: count}}', () => {
  const parsed = [
    {
      archetype_id:    'price_sensitive',
      archetype_label: '가격 민감형',
      sample_size:     144,
      choices: {
        our_product:  { count: 50,  pct: 34.72 },
        competitor_a: { count: 40,  pct: 27.78 },
        competitor_b: { count: 30,  pct: 20.83 },
        competitor_c: { count: 20,  pct: 13.89 },
        pass:         { count: 4,   pct: 2.78  },
      },
    },
  ];

  const flat = toFlatBreakdown(parsed);
  assert.ok('price_sensitive' in flat);
  assert.equal(flat['price_sensitive'].our_product, 50);
  assert.equal(flat['price_sensitive'].competitor_a, 40);
  assert.equal(flat['price_sensitive'].competitor_b, 30);
  assert.equal(flat['price_sensitive'].competitor_c, 20);
  assert.equal(flat['price_sensitive'].pass, 4);
});

test('toFlatBreakdown(): returns {} for non-array input', () => {
  assert.deepEqual(toFlatBreakdown(null), {});
  assert.deepEqual(toFlatBreakdown(undefined), {});
  assert.deepEqual(toFlatBreakdown('string'), {});
  assert.deepEqual(toFlatBreakdown({}), {});
});
