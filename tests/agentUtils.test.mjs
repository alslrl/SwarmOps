/**
 * agentUtils.test.mjs
 *
 * Unit tests for src/lib/simulation/agentUtils.mjs:
 *   - createKoreanNameGenerator — uniqueness, determinism, character constraints
 *   - generateUniqueKoreanNames — array length, uniqueness, overflow guard
 *   - sensitivity_variation      — range bounds (±10%), clamping, rounding
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_UNIQUE_NAMES,
  createKoreanNameGenerator,
  generateUniqueKoreanNames,
  sensitivity_variation,
} from '../src/lib/simulation/agentUtils.mjs';
import { mulberry32 } from '../src/lib/simulation/sampler.mjs';

// ---------------------------------------------------------------------------
// MAX_UNIQUE_NAMES constant
// ---------------------------------------------------------------------------

test('MAX_UNIQUE_NAMES equals 30 * 40 = 1200', () => {
  assert.equal(MAX_UNIQUE_NAMES, 1200);
});

// ---------------------------------------------------------------------------
// createKoreanNameGenerator — interface
// ---------------------------------------------------------------------------

test('createKoreanNameGenerator returns an object with next() and size', () => {
  const gen = createKoreanNameGenerator(42);
  assert.equal(typeof gen.next, 'function', 'gen.next must be a function');
  assert.equal(typeof gen.size, 'number', 'gen.size must be a number');
});

test('createKoreanNameGenerator size equals MAX_UNIQUE_NAMES', () => {
  const gen = createKoreanNameGenerator(1);
  assert.equal(gen.size, MAX_UNIQUE_NAMES);
});

// ---------------------------------------------------------------------------
// createKoreanNameGenerator — character constraints
// ---------------------------------------------------------------------------

test('createKoreanNameGenerator produces strings with 2–10 characters', () => {
  const gen = createKoreanNameGenerator(7);
  for (let i = 0; i < 50; i++) {
    const name = gen.next();
    assert.ok(typeof name === 'string', `Expected string, got ${typeof name}`);
    assert.ok(name.length >= 2, `Name "${name}" must be ≥ 2 chars`);
    assert.ok(name.length <= 10, `Name "${name}" must be ≤ 10 chars`);
  }
});

test('createKoreanNameGenerator names contain Korean characters', () => {
  const gen = createKoreanNameGenerator(3);
  // Korean Hangul block: U+AC00–U+D7A3 (syllables) or U+1100–U+11FF (Jamo)
  const koreanPattern = /[\uAC00-\uD7A3\u1100-\u11FF]/;
  for (let i = 0; i < 30; i++) {
    const name = gen.next();
    assert.match(name, koreanPattern, `Name "${name}" should contain Korean characters`);
  }
});

// ---------------------------------------------------------------------------
// createKoreanNameGenerator — uniqueness
// ---------------------------------------------------------------------------

test('createKoreanNameGenerator produces 800 unique names consecutively', () => {
  const gen = createKoreanNameGenerator(42);
  const seen = new Set();
  for (let i = 0; i < 800; i++) {
    seen.add(gen.next());
  }
  assert.equal(seen.size, 800, 'All 800 names must be distinct');
});

test('createKoreanNameGenerator produces all 1200 unique names before cycling', () => {
  const gen = createKoreanNameGenerator(99);
  const seen = new Set();
  for (let i = 0; i < MAX_UNIQUE_NAMES; i++) {
    seen.add(gen.next());
  }
  assert.equal(seen.size, MAX_UNIQUE_NAMES, `All ${MAX_UNIQUE_NAMES} names must be distinct`);
});

// ---------------------------------------------------------------------------
// createKoreanNameGenerator — determinism
// ---------------------------------------------------------------------------

test('createKoreanNameGenerator is deterministic for the same seed', () => {
  const gen1 = createKoreanNameGenerator(55);
  const gen2 = createKoreanNameGenerator(55);
  for (let i = 0; i < 100; i++) {
    assert.equal(gen1.next(), gen2.next(), `Name at index ${i} must match for equal seeds`);
  }
});

test('createKoreanNameGenerator produces different sequences for different seeds', () => {
  const gen1 = createKoreanNameGenerator(1);
  const gen2 = createKoreanNameGenerator(2);
  const seq1 = Array.from({ length: 20 }, () => gen1.next());
  const seq2 = Array.from({ length: 20 }, () => gen2.next());
  // With 1200-element shuffled pools, different seeds should differ
  const identical = seq1.every((n, i) => n === seq2[i]);
  assert.equal(identical, false, 'Different seeds must produce different name sequences');
});

// ---------------------------------------------------------------------------
// generateUniqueKoreanNames — array length & uniqueness
// ---------------------------------------------------------------------------

test('generateUniqueKoreanNames returns array of the requested length', () => {
  const names = generateUniqueKoreanNames(50, 42);
  assert.equal(names.length, 50);
});

test('generateUniqueKoreanNames all names are unique for 800 agents', () => {
  const names = generateUniqueKoreanNames(800, 42);
  const unique = new Set(names);
  assert.equal(unique.size, names.length, 'Every generated name must be distinct');
});

test('generateUniqueKoreanNames returns exactly MAX_UNIQUE_NAMES names without error', () => {
  assert.doesNotThrow(() => generateUniqueKoreanNames(MAX_UNIQUE_NAMES, 1));
  const names = generateUniqueKoreanNames(MAX_UNIQUE_NAMES, 1);
  assert.equal(names.length, MAX_UNIQUE_NAMES);
  assert.equal(new Set(names).size, MAX_UNIQUE_NAMES);
});

test('generateUniqueKoreanNames throws RangeError when count exceeds pool', () => {
  assert.throws(
    () => generateUniqueKoreanNames(MAX_UNIQUE_NAMES + 1),
    (err) => err instanceof RangeError,
    'Should throw RangeError for count > MAX_UNIQUE_NAMES',
  );
});

test('generateUniqueKoreanNames is deterministic for the same seed', () => {
  const a = generateUniqueKoreanNames(100, 77);
  const b = generateUniqueKoreanNames(100, 77);
  assert.deepEqual(a, b);
});

test('generateUniqueKoreanNames differs for different seeds', () => {
  const a = generateUniqueKoreanNames(50, 10);
  const b = generateUniqueKoreanNames(50, 20);
  assert.notDeepEqual(a, b, 'Different seeds must produce different name arrays');
});

// ---------------------------------------------------------------------------
// sensitivity_variation — range bounds
// ---------------------------------------------------------------------------

test('sensitivity_variation result is always within [1, 5]', () => {
  const rng = mulberry32(42);
  const bases = [1, 1.5, 2, 3, 4, 4.5, 5];
  for (const base of bases) {
    for (let i = 0; i < 100; i++) {
      const result = sensitivity_variation(base, rng);
      assert.ok(result >= 1, `result ${result} must be >= 1 for base ${base}`);
      assert.ok(result <= 5, `result ${result} must be <= 5 for base ${base}`);
    }
  }
});

test('sensitivity_variation applies at most ±10% variation to base before clamping', () => {
  // Controlled RNGs: factor = rng() * 0.2 - 0.1
  // rng = 0 → factor = -0.1 (minimum)
  // rng = 1 → factor = +0.1 (maximum, note: rng() is [0,1) so 1 is theoretical)
  const minRng = () => 0;   // factor = -0.10 → varied = base * 0.90
  const maxRng = () => 0.9999; // factor ≈ +0.10 → varied ≈ base * 1.10

  const base = 3; // Mid-range value; clamping won't interfere
  const minResult = sensitivity_variation(base, minRng);
  const maxResult = sensitivity_variation(base, maxRng);

  // base * 0.90 = 2.7, base * 1.10 = 3.3
  assert.ok(minResult >= 2.7 - 0.05,
    `Min result ${minResult} should be near or above ${base * 0.9}`);
  assert.ok(maxResult <= 3.3 + 0.05,
    `Max result ${maxResult} should be near or below ${base * 1.1}`);
});

test('sensitivity_variation clamps base=5 with +10% to 5', () => {
  // base=5, factor=+0.10 → 5 * 1.1 = 5.5 → clamped to 5
  const alwaysHigh = () => 0.9999;
  assert.equal(sensitivity_variation(5, alwaysHigh), 5);
});

test('sensitivity_variation clamps base=1 with -10% to 1', () => {
  // base=1, factor=-0.10 → 1 * 0.9 = 0.9 → clamped to 1
  const alwaysLow = () => 0;
  assert.equal(sensitivity_variation(1, alwaysLow), 1);
});

test('sensitivity_variation output is rounded to 1 decimal place', () => {
  const rng = mulberry32(13);
  for (let i = 0; i < 200; i++) {
    const result = sensitivity_variation(3, rng);
    // result × 10 must be an integer (within floating-point tolerance)
    const scaled = result * 10;
    assert.ok(
      Math.abs(scaled - Math.round(scaled)) < 1e-9,
      `result ${result} must be rounded to 1 decimal place`,
    );
  }
});

test('sensitivity_variation produces varied results (not constant)', () => {
  const rng = mulberry32(42);
  const results = new Set();
  for (let i = 0; i < 200; i++) {
    results.add(sensitivity_variation(3, rng));
  }
  assert.ok(results.size > 1, 'variation should produce more than one distinct value');
});

test('sensitivity_variation with base=3 stays within [2.7, 3.3]', () => {
  // ±10% of 3 is [2.7, 3.3]; after rounding the bounds hold exactly
  const rng = mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const result = sensitivity_variation(3, rng);
    assert.ok(
      result >= 2.7 && result <= 3.3,
      `result ${result} must be in [2.7, 3.3] for base=3 with ±10% variation`,
    );
  }
});

test('sensitivity_variation with base=4 stays within [3.6, 4.4] before clamping', () => {
  // ±10% of 4 is [3.6, 4.4]; no clamping needed since [3.6, 4.4] ⊂ [1, 5]
  const rng = mulberry32(99);
  for (let i = 0; i < 1000; i++) {
    const result = sensitivity_variation(4, rng);
    assert.ok(
      result >= 3.6 && result <= 4.4,
      `result ${result} must be in [3.6, 4.4] for base=4 with ±10% variation`,
    );
  }
});
