/**
 * stream-formatter-3c.test.mjs
 *
 * Unit tests for Sub-AC 3c: Explicit {count, pct} schema in iteration_complete.
 *
 * Tests the following functions from src/lib/sse/stream-formatter.mjs:
 *   - buildChoiceSummaryExplicit(flatChoiceSummary, totalBuyers)
 *   - buildArchetypeBreakdownDetail(rawBreakdown, archetypes)
 *   - formatIterationComplete(event)
 *
 * Sub-AC 3c schema contract:
 *   choice_summary: { [key]: { count: number, pct: float 0–100 } }
 *   archetype_breakdown: [{archetype_id, archetype_label, sample_size, choices: {key: {count, pct}}}]
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChoiceSummaryExplicit,
  buildArchetypeBreakdownDetail,
  formatIterationComplete,
  formatSseFrame,
  normalizeFlatBreakdown,
} from '../src/lib/sse/stream-formatter.mjs';

const CHOICE_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];

// ── buildChoiceSummaryExplicit ────────────────────────────────────────────────

test('buildChoiceSummaryExplicit: converts flat counts to {count, pct} objects', () => {
  const flat = { our_product: 320, competitor_a: 180, competitor_b: 140, competitor_c: 100, pass: 60 };
  const result = buildChoiceSummaryExplicit(flat, 800);

  for (const key of CHOICE_KEYS) {
    assert.ok(key in result, `result must have key "${key}"`);
    assert.equal(typeof result[key], 'object', `result.${key} must be an object`);
    assert.equal(typeof result[key].count, 'number', `result.${key}.count must be a number`);
    assert.equal(typeof result[key].pct, 'number', `result.${key}.pct must be a number`);
    assert.ok(result[key].count >= 0, `result.${key}.count must be >= 0`);
    assert.ok(result[key].pct >= 0 && result[key].pct <= 100, `result.${key}.pct must be in [0, 100]`);
  }
});

test('buildChoiceSummaryExplicit: count values match input flat counts', () => {
  const flat = { our_product: 320, competitor_a: 180, competitor_b: 140, competitor_c: 100, pass: 60 };
  const result = buildChoiceSummaryExplicit(flat, 800);

  assert.equal(result.our_product.count, 320);
  assert.equal(result.competitor_a.count, 180);
  assert.equal(result.competitor_b.count, 140);
  assert.equal(result.competitor_c.count, 100);
  assert.equal(result.pass.count, 60);
});

test('buildChoiceSummaryExplicit: pct values are correct percentage of totalBuyers', () => {
  const flat = { our_product: 400, competitor_a: 200, competitor_b: 100, competitor_c: 50, pass: 50 };
  const result = buildChoiceSummaryExplicit(flat, 800);

  assert.equal(result.our_product.pct, 50.0, 'our_product pct should be 50.0%');
  assert.equal(result.competitor_a.pct, 25.0, 'competitor_a pct should be 25.0%');
  assert.equal(result.competitor_b.pct, 12.5, 'competitor_b pct should be 12.5%');
  assert.equal(result.competitor_c.pct, 6.25, 'competitor_c pct should be 6.25%');
  assert.equal(result.pass.pct, 6.25, 'pass pct should be 6.25%');
});

test('buildChoiceSummaryExplicit: pct values sum to ~100', () => {
  const flat = { our_product: 320, competitor_a: 180, competitor_b: 140, competitor_c: 100, pass: 60 };
  const result = buildChoiceSummaryExplicit(flat, 800);

  const totalPct = CHOICE_KEYS.reduce((sum, k) => sum + result[k].pct, 0);
  assert.ok(Math.abs(totalPct - 100) < 0.1, `pct values should sum to ~100, got ${totalPct}`);
});

test('buildChoiceSummaryExplicit: handles zero totalBuyers gracefully', () => {
  const flat = { our_product: 0, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 };
  const result = buildChoiceSummaryExplicit(flat, 0);

  for (const key of CHOICE_KEYS) {
    assert.equal(result[key].count, 0);
    assert.equal(result[key].pct, 0);
  }
});

test('buildChoiceSummaryExplicit: handles missing keys with count=0, pct=0', () => {
  const flat = { our_product: 400 }; // missing other keys
  const result = buildChoiceSummaryExplicit(flat, 800);

  assert.equal(result.our_product.count, 400);
  assert.equal(result.competitor_a.count, 0);
  assert.equal(result.competitor_a.pct, 0);
});

// ── buildArchetypeBreakdownDetail ─────────────────────────────────────────────

test('buildArchetypeBreakdownDetail: returns array sorted by archetype_id', () => {
  const flat = {
    price_sensitive:  { our_product: 50, competitor_a: 40, competitor_b: 30, competitor_c: 20, pass: 4 },
    value_seeker:     { our_product: 60, competitor_a: 35, competitor_b: 20, competitor_c: 10, pass: 3 },
  };
  const result = buildArchetypeBreakdownDetail(flat);

  assert.ok(Array.isArray(result), 'result must be an array');
  assert.equal(result.length, 2, 'result must have 2 entries');
  // Sorted by archetype_id: price_sensitive < value_seeker
  assert.equal(result[0].archetype_id, 'price_sensitive');
  assert.equal(result[1].archetype_id, 'value_seeker');
});

test('buildArchetypeBreakdownDetail: each entry has archetype_id, archetype_label, sample_size, choices', () => {
  const flat = {
    price_sensitive: { our_product: 50, competitor_a: 40, competitor_b: 30, competitor_c: 20, pass: 4 },
  };
  const result = buildArchetypeBreakdownDetail(flat);

  assert.equal(result.length, 1);
  const entry = result[0];

  assert.equal(entry.archetype_id, 'price_sensitive');
  assert.equal(typeof entry.archetype_label, 'string');
  assert.ok(entry.archetype_label.length > 0, 'archetype_label must not be empty');
  assert.equal(typeof entry.sample_size, 'number');
  assert.ok(entry.sample_size > 0, 'sample_size must be positive');
  assert.ok(entry.choices && typeof entry.choices === 'object', 'choices must be an object');
});

test('buildArchetypeBreakdownDetail: uses Korean label from canonical ARCHETYPES (no custom archetypes needed)', () => {
  const flat = {
    price_sensitive: { our_product: 100, competitor_a: 50, competitor_b: 30, competitor_c: 20, pass: 40 },
  };
  const result = buildArchetypeBreakdownDetail(flat);

  // '가격 민감형' is the label from archetypes.mjs
  assert.ok(
    result[0].archetype_label === '가격 민감형',
    `Expected Korean label '가격 민감형', got '${result[0].archetype_label}'`
  );
});

test('buildArchetypeBreakdownDetail: sample_size equals sum of all choice counts', () => {
  const flat = {
    price_sensitive: { our_product: 50, competitor_a: 40, competitor_b: 30, competitor_c: 20, pass: 4 },
  };
  const result = buildArchetypeBreakdownDetail(flat);
  const entry = result[0];

  const expectedSampleSize = 50 + 40 + 30 + 20 + 4; // = 144
  assert.equal(entry.sample_size, expectedSampleSize, `sample_size must equal sum of choice counts (${expectedSampleSize})`);
});

test('buildArchetypeBreakdownDetail: choices have {count, pct} structure with correct values', () => {
  const flat = {
    price_sensitive: { our_product: 50, competitor_a: 40, competitor_b: 30, competitor_c: 20, pass: 4 },
  };
  const result = buildArchetypeBreakdownDetail(flat);
  const entry = result[0];
  const sampleSize = 50 + 40 + 30 + 20 + 4; // = 144

  assert.equal(entry.choices.our_product.count, 50);
  assert.equal(
    entry.choices.our_product.pct,
    parseFloat(((50 / sampleSize) * 100).toFixed(2)),
    'our_product pct must be relative to sample_size'
  );

  // All pcts must sum to ~100
  const totalPct = CHOICE_KEYS.reduce((sum, k) => sum + entry.choices[k].pct, 0);
  assert.ok(Math.abs(totalPct - 100) < 0.1, `per-archetype pct values must sum to ~100, got ${totalPct}`);
});

test('buildArchetypeBreakdownDetail: handles nested internal engine format (choices sub-object)', () => {
  // Internal engine format: {archetype_id, count, choices: {key: number}}
  const nested = {
    price_sensitive: {
      archetype_id: 'price_sensitive',
      count: 144,
      choices: { our_product: 50, competitor_a: 40, competitor_b: 30, competitor_c: 20, pass: 4 },
    },
  };
  const result = buildArchetypeBreakdownDetail(nested);

  assert.equal(result.length, 1);
  assert.equal(result[0].choices.our_product.count, 50);
  assert.equal(result[0].choices.competitor_a.count, 40);
});

test('buildArchetypeBreakdownDetail: returns empty array for null/empty input', () => {
  assert.deepEqual(buildArchetypeBreakdownDetail(null), []);
  assert.deepEqual(buildArchetypeBreakdownDetail(undefined), []);
  assert.deepEqual(buildArchetypeBreakdownDetail({}), []);
});

test('buildArchetypeBreakdownDetail: uses custom archetype labels when provided', () => {
  const flat = {
    custom_archetype: { our_product: 100, competitor_a: 50, competitor_b: 30, competitor_c: 20, pass: 0 },
  };
  const archetypes = [{ id: 'custom_archetype', label: '커스텀 고객군' }];
  const result = buildArchetypeBreakdownDetail(flat, archetypes);

  assert.equal(result[0].archetype_label, '커스텀 고객군', 'Custom label should be used when provided');
});

test('buildArchetypeBreakdownDetail: falls back to archetype_id when label is unknown', () => {
  const flat = {
    unknown_archetype_xyz: { our_product: 100, competitor_a: 50, competitor_b: 30, competitor_c: 20, pass: 0 },
  };
  const result = buildArchetypeBreakdownDetail(flat);

  assert.equal(result[0].archetype_label, 'unknown_archetype_xyz', 'Unknown archetype should fall back to id');
});

// ── formatIterationComplete ───────────────────────────────────────────────────

test('formatIterationComplete: emits SSE frame with correct event type', () => {
  const frame = formatIterationComplete({
    iteration: 1,
    winner_id: 'strategy_001',
    winner_revenue: 9568000,
    accepted: true,
    rejected_count: 2,
    choice_summary: { our_product: 320, competitor_a: 180, competitor_b: 140, competitor_c: 100, pass: 60 },
    archetype_breakdown: {
      price_sensitive: { our_product: 50, competitor_a: 40, competitor_b: 30, competitor_c: 20, pass: 4 },
    },
  });

  assert.ok(frame.startsWith('event: iteration_complete\n'), 'Frame must start with correct event type');
  assert.ok(frame.endsWith('\n\n'), 'Frame must end with double newline');
});

test('formatIterationComplete: payload has explicit {count, pct} choice_summary', () => {
  const frame = formatIterationComplete({
    iteration: 1,
    winner_id: 'strategy_001',
    winner_revenue: 9568000,
    accepted: true,
    rejected_count: 2,
    choice_summary: { our_product: 400, competitor_a: 200, competitor_b: 100, competitor_c: 50, pass: 50 },
    archetype_breakdown: {},
  });

  const dataLine = frame.split('\n')[1];
  const payload = JSON.parse(dataLine.slice('data: '.length));

  assert.ok(payload.choice_summary, 'payload must have choice_summary');
  for (const key of CHOICE_KEYS) {
    assert.ok(key in payload.choice_summary, `choice_summary must have key "${key}"`);
    assert.equal(typeof payload.choice_summary[key], 'object', `choice_summary.${key} must be an object`);
    assert.equal(typeof payload.choice_summary[key].count, 'number', `choice_summary.${key}.count must be a number`);
    assert.equal(typeof payload.choice_summary[key].pct, 'number', `choice_summary.${key}.pct must be a number`);
  }

  // Verify specific values
  assert.equal(payload.choice_summary.our_product.count, 400);
  assert.equal(payload.choice_summary.our_product.pct, 50.0);
});

test('formatIterationComplete: payload has archetype_breakdown as array', () => {
  const frame = formatIterationComplete({
    iteration: 1,
    winner_id: 'strategy_001',
    winner_revenue: 9568000,
    accepted: true,
    rejected_count: 2,
    choice_summary: { our_product: 320, competitor_a: 180, competitor_b: 140, competitor_c: 100, pass: 60 },
    archetype_breakdown: {
      price_sensitive: { our_product: 50, competitor_a: 40, competitor_b: 30, competitor_c: 20, pass: 4 },
      value_seeker:    { our_product: 60, competitor_a: 35, competitor_b: 20, competitor_c: 10, pass: 3 },
    },
  });

  const dataLine = frame.split('\n')[1];
  const payload = JSON.parse(dataLine.slice('data: '.length));

  assert.ok(Array.isArray(payload.archetype_breakdown), 'archetype_breakdown must be an array');
  assert.equal(payload.archetype_breakdown.length, 2, 'archetype_breakdown must have 2 entries');

  for (const entry of payload.archetype_breakdown) {
    assert.equal(typeof entry.archetype_id, 'string', 'entry.archetype_id must be a string');
    assert.equal(typeof entry.archetype_label, 'string', 'entry.archetype_label must be a string');
    assert.equal(typeof entry.sample_size, 'number', 'entry.sample_size must be a number');
    assert.ok(entry.choices && typeof entry.choices === 'object', 'entry.choices must be an object');
  }
});

test('formatIterationComplete: archetype_breakdown entry Korean label is resolved from canonical ARCHETYPES', () => {
  const frame = formatIterationComplete({
    iteration: 1,
    winner_id: 'strategy_001',
    winner_revenue: 9568000,
    accepted: true,
    rejected_count: 0,
    choice_summary: { our_product: 100, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 },
    archetype_breakdown: {
      price_sensitive: { our_product: 100, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 },
    },
  });

  const dataLine = frame.split('\n')[1];
  const payload = JSON.parse(dataLine.slice('data: '.length));

  const priceSensitiveEntry = payload.archetype_breakdown.find((e) => e.archetype_id === 'price_sensitive');
  assert.ok(priceSensitiveEntry, 'price_sensitive entry must exist');
  assert.equal(
    priceSensitiveEntry.archetype_label,
    '가격 민감형',
    `Expected Korean label '가격 민감형', got '${priceSensitiveEntry.archetype_label}'`
  );
});

test('formatIterationComplete: archetype_breakdown entry pct is per-archetype (relative to sample_size)', () => {
  const frame = formatIterationComplete({
    iteration: 1,
    winner_id: 'strategy_001',
    winner_revenue: 9568000,
    accepted: true,
    rejected_count: 0,
    choice_summary: { our_product: 50, competitor_a: 30, competitor_b: 20, competitor_c: 0, pass: 0 },
    archetype_breakdown: {
      // This archetype has 100 agents total (sample_size = 100)
      price_sensitive: { our_product: 50, competitor_a: 30, competitor_b: 20, competitor_c: 0, pass: 0 },
    },
  });

  const dataLine = frame.split('\n')[1];
  const payload = JSON.parse(dataLine.slice('data: '.length));

  const entry = payload.archetype_breakdown[0];
  assert.equal(entry.sample_size, 100, 'sample_size must be 100 (sum of all choices)');

  // pct is relative to sample_size (100), NOT to global buyer count
  assert.equal(entry.choices.our_product.pct, 50.0, 'our_product pct must be 50.0% of 100');
  assert.equal(entry.choices.competitor_a.pct, 30.0, 'competitor_a pct must be 30.0% of 100');
  assert.equal(entry.choices.competitor_b.pct, 20.0, 'competitor_b pct must be 20.0% of 100');
});

// ── normalizeFlatBreakdown (kept for backward compat utility) ─────────────────

test('normalizeFlatBreakdown: converts nested engine format to flat', () => {
  const nested = {
    price_sensitive: {
      archetype_id: 'price_sensitive',
      count: 100,
      choices: { our_product: 50, competitor_a: 30, competitor_b: 20, competitor_c: 0, pass: 0 },
    },
  };
  const result = normalizeFlatBreakdown(nested);

  assert.equal(result.price_sensitive.our_product, 50);
  assert.equal(result.price_sensitive.competitor_a, 30);
  assert.equal(result.price_sensitive.competitor_b, 20);
});

test('normalizeFlatBreakdown: passes through flat format unchanged', () => {
  const flat = {
    price_sensitive: { our_product: 50, competitor_a: 30, competitor_b: 20, competitor_c: 0, pass: 0 },
  };
  const result = normalizeFlatBreakdown(flat);

  assert.equal(result.price_sensitive.our_product, 50);
  assert.equal(result.price_sensitive.competitor_a, 30);
});
