import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBuyerEvaluationPayload, assertRealismJudgePayload, assertStrategyCandidatesPayload, validateRunRequestBody } from '../src/lib/openai/schemas.mjs';

test('strategy schema accepts three candidates', () => {
  const payload = assertStrategyCandidatesPayload({
    strategies: [
      { id: 'a', title: 'T1', top_copy: 'C1', price_krw: 1, rationale: 'r' },
      { id: 'b', title: 'T2', top_copy: 'C2', price_krw: 2, rationale: 'r' },
      { id: 'c', title: 'T3', top_copy: 'C3', price_krw: 3, rationale: 'r' },
    ],
  });
  assert.equal(payload.strategies.length, 3);
});

test('buyer evaluation schema validates output', () => {
  const payload = assertBuyerEvaluationPayload({
    archetype_id: 'price_sensitive',
    evaluations: [{ strategy_id: 's1', weights: { our_product: 1, competitor_a: 1, competitor_b: 1, competitor_c: 1, pass: 1 }, summary: 'ok' }],
  });
  assert.equal(payload.archetype_id, 'price_sensitive');
});

test('realism schema validates verdict', () => {
  const payload = assertRealismJudgePayload({ verdict: 'pass', score: 0.9, issues: [], summary: 'ok' });
  assert.equal(payload.verdict, 'pass');
});

// ---------------------------------------------------------------------------
// validateRunRequestBody — Sub-AC 2a
// ---------------------------------------------------------------------------

test('validateRunRequestBody: empty body returns empty overrides', () => {
  const result = validateRunRequestBody({});
  assert.deepEqual(result, { overrides: {} });
});

test('validateRunRequestBody: null body is treated as empty', () => {
  const result = validateRunRequestBody(null);
  assert.deepEqual(result, { overrides: {} });
});

test('validateRunRequestBody: accepts all optional fields', () => {
  const result = validateRunRequestBody({
    iterationCount: 3,
    minimumMarginFloor: 0.35,
    title: '신상품 타이틀',
    topCopy: '최고의 상품입니다',
    priceKrw: 19900,
    costKrw: 8000,
  });
  assert.equal(result.iterationCount, 3);
  assert.equal(result.minimumMarginFloor, 0.35);
  assert.equal(result.overrides.title, '신상품 타이틀');
  assert.equal(result.overrides.topCopy, '최고의 상품입니다');
  assert.equal(result.overrides.priceKrw, 19900);
  assert.equal(result.overrides.costKrw, 8000);
});

test('validateRunRequestBody: coerces string numbers to Number for price fields', () => {
  const result = validateRunRequestBody({ priceKrw: '29900', costKrw: '10000' });
  assert.equal(result.overrides.priceKrw, 29900);
  assert.equal(result.overrides.costKrw, 10000);
  assert.equal(typeof result.overrides.priceKrw, 'number');
  assert.equal(typeof result.overrides.costKrw, 'number');
});

test('validateRunRequestBody: omitted fields are absent from overrides', () => {
  const result = validateRunRequestBody({ title: '테스트' });
  assert.equal(result.overrides.title, '테스트');
  assert.equal(result.overrides.topCopy, undefined);
  assert.equal(result.overrides.priceKrw, undefined);
  assert.equal(result.overrides.costKrw, undefined);
});

test('validateRunRequestBody: throws on invalid priceKrw (non-integer)', () => {
  assert.throws(
    () => validateRunRequestBody({ priceKrw: 19900.5 }),
    /priceKrw must be a positive integer/
  );
});

test('validateRunRequestBody: throws on invalid priceKrw (negative)', () => {
  assert.throws(
    () => validateRunRequestBody({ priceKrw: -100 }),
    /priceKrw must be a positive integer/
  );
});

test('validateRunRequestBody: throws on invalid minimumMarginFloor (> 1)', () => {
  assert.throws(
    () => validateRunRequestBody({ minimumMarginFloor: 1.5 }),
    /minimumMarginFloor must be a number between 0 and 1/
  );
});

test('validateRunRequestBody: throws on empty title string', () => {
  assert.throws(
    () => validateRunRequestBody({ title: '   ' }),
    /title must be a non-empty string/
  );
});
