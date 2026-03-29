/**
 * tests/game-logic-ac11.test.mjs
 *
 * Sub-AC 11.1: Unit tests for core game logic modules.
 * Covers: buildDiff, evaluateHoldout, scorer (comprehensive), archetypes.
 * All tests run without any OpenAI API calls.
 *
 * Acceptance criteria per PRD §8 Engine Gate and Test Spec §2:
 *   - diff output fields: diff keys are exactly ['title', 'top_copy', 'price']
 *   - holdout gate: holdout_uplift is a number, passes_gate correct
 *   - margin floor enforcement: violations detected and flagged
 *   - archetype weights sum to 100%
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── buildDiff ────────────────────────────────────────────────────────────────

import { buildDiff } from '../src/lib/diff/build-diff.mjs';

test('buildDiff: output has exactly the keys title, top_copy, price', () => {
  const before = { title: 'A', top_copy: 'B', price_krw: 29900 };
  const after  = { title: 'A2', top_copy: 'B2', price_krw: 28000 };
  const diff = buildDiff(before, after);
  assert.deepEqual(Object.keys(diff).sort(), ['price', 'title', 'top_copy']);
});

test('buildDiff: captures before and after values for title', () => {
  const before = { title: '트리클리닉 기존 제목', top_copy: 'X', price_krw: 29900 };
  const after  = { title: '트리클리닉 새 제목', top_copy: 'X', price_krw: 29900 };
  const diff = buildDiff(before, after);
  assert.equal(diff.title.before, '트리클리닉 기존 제목');
  assert.equal(diff.title.after,  '트리클리닉 새 제목');
});

test('buildDiff: captures before and after values for top_copy', () => {
  const before = { title: 'T', top_copy: '기존 카피 문구', price_krw: 29900 };
  const after  = { title: 'T', top_copy: '새 카피 문구',   price_krw: 29900 };
  const diff = buildDiff(before, after);
  assert.equal(diff.top_copy.before, '기존 카피 문구');
  assert.equal(diff.top_copy.after,  '새 카피 문구');
});

test('buildDiff: captures before and after price_krw as integers', () => {
  const before = { title: 'T', top_copy: 'C', price_krw: 29900 };
  const after  = { title: 'T', top_copy: 'C', price_krw: 27500 };
  const diff = buildDiff(before, after);
  assert.equal(diff.price.before, 29900);
  assert.equal(diff.price.after,  27500);
  assert.equal(Math.floor(diff.price.before), diff.price.before, 'before price must be integer');
  assert.equal(Math.floor(diff.price.after),  diff.price.after,  'after price must be integer');
});

test('buildDiff: works when before and after are identical (no change)', () => {
  const strategy = { title: 'T', top_copy: 'C', price_krw: 29900 };
  const diff = buildDiff(strategy, strategy);
  assert.equal(diff.title.before, diff.title.after);
  assert.equal(diff.top_copy.before, diff.top_copy.after);
  assert.equal(diff.price.before, diff.price.after);
});

test('buildDiff: does NOT include extra keys beyond title, top_copy, price', () => {
  const before = { title: 'T', top_copy: 'C', price_krw: 29900, simulated_revenue: 5000000, id: 'b' };
  const after  = { title: 'T2', top_copy: 'C2', price_krw: 28000, simulated_revenue: 5200000, id: 's1' };
  const diff = buildDiff(before, after);
  assert.ok(!('simulated_revenue' in diff), 'simulated_revenue must NOT be in diff');
  assert.ok(!('id' in diff),                'id must NOT be in diff');
  assert.ok(!('margin_rate' in diff),        'margin_rate must NOT be in diff');
});

// ── evaluateHoldout ──────────────────────────────────────────────────────────

import { evaluateHoldout } from '../src/lib/simulation/holdout.mjs';

test('evaluateHoldout: returns holdout_uplift as number', () => {
  const result = evaluateHoldout({ baselineRevenue: 5000000, finalRevenue: 5500000 });
  assert.equal(typeof result.holdout_uplift, 'number', 'holdout_uplift must be a number');
});

test('evaluateHoldout: positive uplift when finalRevenue > baselineRevenue', () => {
  const result = evaluateHoldout({ baselineRevenue: 5000000, finalRevenue: 5500000 });
  assert.ok(result.holdout_uplift > 0, `uplift should be positive, got ${result.holdout_uplift}`);
  assert.equal(result.holdout_uplift, 500000);
});

test('evaluateHoldout: zero uplift when finalRevenue === baselineRevenue', () => {
  const result = evaluateHoldout({ baselineRevenue: 5000000, finalRevenue: 5000000 });
  assert.equal(result.holdout_uplift, 0);
});

test('evaluateHoldout: negative uplift when finalRevenue < baselineRevenue', () => {
  const result = evaluateHoldout({ baselineRevenue: 5000000, finalRevenue: 4800000 });
  assert.ok(result.holdout_uplift < 0, `uplift should be negative, got ${result.holdout_uplift}`);
  assert.equal(result.holdout_uplift, -200000);
});

test('evaluateHoldout: passes_gate is true when holdout_uplift > 0', () => {
  const result = evaluateHoldout({ baselineRevenue: 5000000, finalRevenue: 5500000 });
  assert.equal(result.passes_gate, true, 'passes_gate should be true for positive uplift');
});

test('evaluateHoldout: passes_gate is false when holdout_uplift === 0', () => {
  const result = evaluateHoldout({ baselineRevenue: 5000000, finalRevenue: 5000000 });
  assert.equal(result.passes_gate, false, 'passes_gate should be false when uplift is zero');
});

test('evaluateHoldout: passes_gate is false when holdout_uplift < 0', () => {
  const result = evaluateHoldout({ baselineRevenue: 5000000, finalRevenue: 4800000 });
  assert.equal(result.passes_gate, false, 'passes_gate should be false for negative uplift');
});

test('evaluateHoldout: result includes baseline_revenue and final_revenue fields', () => {
  const result = evaluateHoldout({ baselineRevenue: 5000000, finalRevenue: 5500000 });
  assert.equal(typeof result.baseline_revenue, 'number', 'baseline_revenue must be number');
  assert.equal(typeof result.final_revenue, 'number', 'final_revenue must be number');
  assert.equal(result.baseline_revenue, 5000000);
  assert.equal(result.final_revenue, 5500000);
});

test('evaluateHoldout: works with KRW integer amounts (large numbers)', () => {
  // Realistic KRW simulation amounts
  const result = evaluateHoldout({ baselineRevenue: 23920000, finalRevenue: 26250000 });
  assert.equal(result.holdout_uplift, 2330000);
  assert.equal(result.passes_gate, true);
});

// ── Scorer (comprehensive) ───────────────────────────────────────────────────

import {
  buildScoredStrategy,
  compareStrategies,
  computeMarginRate,
  isMarginFloorSatisfied,
} from '../src/lib/simulation/scorer.mjs';

test('scorer computeMarginRate: (price - cost) / price', () => {
  assert.equal(Number(computeMarginRate(20000, 10000).toFixed(2)), 0.5);
  assert.equal(Number(computeMarginRate(29900, 11000).toFixed(4)), Number(((29900 - 11000) / 29900).toFixed(4)));
  assert.equal(Number(computeMarginRate(10000, 10000).toFixed(2)), 0.0);
});

test('scorer isMarginFloorSatisfied: true when margin >= floor', () => {
  assert.equal(isMarginFloorSatisfied(20000, 10000, 0.5), true,  '50% margin satisfies 50% floor');
  assert.equal(isMarginFloorSatisfied(20000, 10000, 0.4), true,  '50% margin satisfies 40% floor');
  assert.equal(isMarginFloorSatisfied(29900, 11000, 0.35), true, '63% margin satisfies 35% floor');
});

test('scorer isMarginFloorSatisfied: false when margin < floor', () => {
  assert.equal(isMarginFloorSatisfied(20000, 18000, 0.2),  false, '10% margin fails 20% floor');
  assert.equal(isMarginFloorSatisfied(10000, 9500,  0.35), false, '5% margin fails 35% floor');
});

test('scorer buildScoredStrategy: returns simulated_revenue = choices.our_product * price_krw', () => {
  const baseline = { title: 'T', top_copy: 'C' };
  const candidate = { id: 's1', title: 'T1', top_copy: 'C1', price_krw: 20000 };
  const sampledResult = { choices: { our_product: 10 } };
  const scored = buildScoredStrategy({ candidate, baseline, sampledResult, cost: 10000, minimumMarginFloor: 0.2 });
  assert.equal(scored.simulated_revenue, 200000, '10 buyers * 20000 KRW = 200000 KRW revenue');
});

test('scorer buildScoredStrategy: margin_floor_violations = 0 when margin satisfies floor', () => {
  const baseline = { title: 'T', top_copy: 'C' };
  const candidate = { id: 's1', title: 'T1', top_copy: 'C1', price_krw: 20000 };
  const sampledResult = { choices: { our_product: 10 } };
  const scored = buildScoredStrategy({ candidate, baseline, sampledResult, cost: 10000, minimumMarginFloor: 0.2 });
  assert.equal(scored.margin_floor_violations, 0, 'no violations expected for 50% margin with 20% floor');
});

test('scorer buildScoredStrategy: margin_floor_violations > 0 when margin violates floor', () => {
  const baseline = { title: 'T', top_copy: 'C' };
  const candidate = { id: 's1', title: 'T1', top_copy: 'C1', price_krw: 10000 };
  const sampledResult = { choices: { our_product: 10 } };
  // margin = (10000-9500)/10000 = 5%, floor = 35%
  const scored = buildScoredStrategy({ candidate, baseline, sampledResult, cost: 9500, minimumMarginFloor: 0.35 });
  assert.ok(scored.margin_floor_violations > 0, 'violations expected when margin < floor');
});

test('scorer buildScoredStrategy: result has required fields id, title, top_copy, price_krw', () => {
  const baseline = { title: 'T', top_copy: 'C' };
  const candidate = { id: 'cand-1', title: 'New Title', top_copy: 'New Copy', price_krw: 25000 };
  const sampledResult = { choices: { our_product: 100 } };
  const scored = buildScoredStrategy({ candidate, baseline, sampledResult, cost: 10000, minimumMarginFloor: 0.35 });
  assert.equal(scored.id, 'cand-1');
  assert.equal(scored.title, 'New Title');
  assert.equal(scored.top_copy, 'New Copy');
  assert.equal(scored.price_krw, 25000);
});

test('scorer buildScoredStrategy: simulated_revenue is an integer (KRW format)', () => {
  const baseline = { title: 'T', top_copy: 'C' };
  const candidate = { id: 's1', title: 'T1', top_copy: 'C1', price_krw: 28900 };
  const sampledResult = { choices: { our_product: 287 } };
  const scored = buildScoredStrategy({ candidate, baseline, sampledResult, cost: 11000, minimumMarginFloor: 0.35 });
  assert.equal(scored.simulated_revenue, 287 * 28900, '287 buyers * 28900 KRW');
  assert.equal(Math.floor(scored.simulated_revenue), scored.simulated_revenue, 'revenue must be an integer');
});

test('scorer compareStrategies: higher revenue wins', () => {
  const baseline = { title: 'T', top_copy: 'C' };
  const a = buildScoredStrategy({
    candidate: { id: 'a', title: 'A', top_copy: 'Ca', price_krw: 20000 },
    baseline,
    sampledResult: { choices: { our_product: 10 } },
    cost: 10000,
    minimumMarginFloor: 0.2,
  });
  const b = buildScoredStrategy({
    candidate: { id: 'b', title: 'B', top_copy: 'Cb', price_krw: 22000 },
    baseline,
    sampledResult: { choices: { our_product: 8 } },
    cost: 10000,
    minimumMarginFloor: 0.2,
  });
  // a.simulated_revenue = 200000, b.simulated_revenue = 176000 → a wins
  assert.ok(compareStrategies(a, b) < 0, 'a (₩200,000) should rank before b (₩176,000)');
});

test('scorer compareStrategies: strategy with margin violations loses to valid one', () => {
  const baseline = { title: 'T', top_copy: 'C' };
  const valid = buildScoredStrategy({
    candidate: { id: 'valid', title: 'V', top_copy: 'Cv', price_krw: 20000 },
    baseline,
    sampledResult: { choices: { our_product: 5 } },
    cost: 10000,
    minimumMarginFloor: 0.2,
  }); // 50% margin, no violation

  const violating = buildScoredStrategy({
    candidate: { id: 'bad', title: 'Bad', top_copy: 'Cbad', price_krw: 10000 },
    baseline,
    sampledResult: { choices: { our_product: 10 } },
    cost: 9500,
    minimumMarginFloor: 0.35,
  }); // 5% margin, violation

  // violating strategy has higher revenue (100,000 vs 100,000) but has violations
  // compareStrategies should prefer valid over violating
  assert.ok(
    compareStrategies(valid, violating) < 0,
    'strategy with no margin violations should rank before violating one'
  );
});

// ── ARCHETYPES ───────────────────────────────────────────────────────────────

import { ARCHETYPES, getArchetypeById, getArchetypeIds } from '../src/lib/simulation/archetypes.mjs';

test('ARCHETYPES: exactly 8 archetypes defined', () => {
  assert.equal(ARCHETYPES.length, 8);
});

test('ARCHETYPES: cohort_weight_percent sums to exactly 100', () => {
  const total = ARCHETYPES.reduce((sum, a) => sum + a.cohort_weight_percent, 0);
  assert.equal(total, 100, `archetype weights must sum to 100, got ${total}`);
});

test('ARCHETYPES: each archetype has required fields', () => {
  for (const a of ARCHETYPES) {
    assert.equal(typeof a.id, 'string', `${a.id}: id must be string`);
    assert.equal(typeof a.label, 'string', `${a.id}: label must be string`);
    assert.ok(a.id.length > 0, `${a.id}: id must not be empty`);
    assert.ok(a.label.length > 0, `${a.id}: label must not be empty`);
    assert.equal(typeof a.cohort_weight_percent, 'number', `${a.id}: cohort_weight_percent must be number`);
    assert.ok(a.cohort_weight_percent > 0, `${a.id}: cohort_weight_percent must be positive`);
  }
});

test('ARCHETYPES: all 8 expected archetype IDs are present', () => {
  const ids = ARCHETYPES.map((a) => a.id);
  const expected = [
    'price_sensitive',
    'value_seeker',
    'premium_quality',
    'trust_first',
    'aesthetics_first',
    'urgency_buyer',
    'promo_hunter',
    'gift_or_family_buyer',
  ];
  for (const expectedId of expected) {
    assert.ok(ids.includes(expectedId), `archetype ID '${expectedId}' must be present`);
  }
});

test('getArchetypeById: returns correct archetype for valid ID', () => {
  const archetype = getArchetypeById('price_sensitive');
  assert.ok(archetype, 'should find price_sensitive archetype');
  assert.equal(archetype.id, 'price_sensitive');
});

test('getArchetypeById: throws for unknown ID (strict validation)', () => {
  assert.throws(
    () => getArchetypeById('nonexistent_archetype'),
    /Unknown archetype_id/,
    'should throw for unknown archetype ID',
  );
});

test('getArchetypeIds: returns array of all 8 archetype IDs', () => {
  const ids = getArchetypeIds();
  assert.equal(ids.length, 8, 'must return exactly 8 archetype IDs');
  assert.ok(Array.isArray(ids), 'must return an array');
});

test('ARCHETYPES: IDs are all unique (no duplicates)', () => {
  const ids = ARCHETYPES.map((a) => a.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, 'archetype IDs must be unique');
});

test('ARCHETYPES: labels are all unique (no duplicates)', () => {
  const labels = ARCHETYPES.map((a) => a.label);
  const uniqueLabels = new Set(labels);
  assert.equal(uniqueLabels.size, labels.length, 'archetype labels must be unique');
});
