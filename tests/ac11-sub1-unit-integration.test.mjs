/**
 * Sub-AC 11 / Sub-AC 1 — Unit & Integration Tests
 *
 * Covers core game logic and API route handlers without live OpenAI calls.
 *
 * Test categories:
 *   A. Core game logic unit tests
 *      A1. buildDiff
 *      A2. evaluateHoldout
 *      A3. computeMarginRate / isMarginFloorSatisfied / countTextDelta
 *      A4. compareStrategies / buildScoredStrategy
 *      A5. ARCHETYPES constant integrity
 *   B. API route handler integration tests (mock mode, in-process server)
 *      B1. GET / — serve dashboard HTML
 *      B2. GET /dashboard.js — serve JS
 *      B3. GET /styles.css — serve CSS
 *      B4. GET /particle-engine.mjs — serve particle engine
 *      B5. GET /api/fixtures — full schema validation
 *      B6. POST /api/run — correct response structure
 *      B7. POST /api/run with overrides — baseline reflects overrides
 *      B8. POST /api/run/stream — text/event-stream, expected events
 *      B9. Unknown route — 404
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Force mock mode — no live OpenAI calls in this file
process.env.SELLER_WAR_GAME_MODEL_MODE = 'mock';

// ---------------------------------------------------------------------------
// Dynamic imports AFTER setting env vars (important for cached module singletons)
// ---------------------------------------------------------------------------
const { buildDiff } = await import('../src/lib/diff/build-diff.mjs');
const { evaluateHoldout } = await import('../src/lib/simulation/holdout.mjs');
const {
  computeMarginRate,
  isMarginFloorSatisfied,
  countTextDelta,
  compareStrategies,
  buildScoredStrategy,
} = await import('../src/lib/simulation/scorer.mjs');
const { ARCHETYPES } = await import('../src/lib/simulation/archetypes.mjs');
const { createServer } = await import('../src/server.mjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

function getJson(server, path) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, headers: res.headers, body }); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function getText(server, path) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function postJson(server, path, payload) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const bodyStr = JSON.stringify(payload);
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, headers: res.headers, body }); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/** Collect all SSE events from POST /api/run/stream as { type, data } objects. */
function collectSse(server, payload) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const bodyStr = JSON.stringify(payload);
    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/api/run/stream',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        const events = [];
        for (const block of raw.split(/\n\n+/)) {
          if (!block.trim()) continue;
          let eventType = 'message';
          let dataLine = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataLine = line.slice(6).trim();
          }
          if (dataLine) {
            try { events.push({ type: eventType, data: JSON.parse(dataLine) }); }
            catch { /* skip malformed */ }
          }
        }
        resolve({ status: res.statusCode, headers: res.headers, events });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ===========================================================================
// A. Core game logic unit tests
// ===========================================================================

// ---------------------------------------------------------------------------
// A1. buildDiff
// ---------------------------------------------------------------------------

test('A1 buildDiff — returns object with title, top_copy, price keys only', () => {
  const before = { title: '옛날 제목', top_copy: '옛날 카피', price_krw: 29900 };
  const after = { title: '새 제목', top_copy: '새 카피', price_krw: 26500 };
  const diff = buildDiff(before, after);
  assert.deepEqual(Object.keys(diff).sort(), ['price', 'title', 'top_copy'], 'diff must have exactly 3 keys: title, top_copy, price');
});

test('A1 buildDiff — each field has before and after properties', () => {
  const before = { title: '현재 타이틀', top_copy: '현재 카피', price_krw: 29900 };
  const after = { title: '추천 타이틀', top_copy: '추천 카피', price_krw: 26500 };
  const diff = buildDiff(before, after);

  assert.strictEqual(diff.title.before, '현재 타이틀', 'diff.title.before must match before.title');
  assert.strictEqual(diff.title.after, '추천 타이틀', 'diff.title.after must match after.title');
  assert.strictEqual(diff.top_copy.before, '현재 카피', 'diff.top_copy.before must match before.top_copy');
  assert.strictEqual(diff.top_copy.after, '추천 카피', 'diff.top_copy.after must match after.top_copy');
  assert.strictEqual(diff.price.before, 29900, 'diff.price.before must match before.price_krw');
  assert.strictEqual(diff.price.after, 26500, 'diff.price.after must match after.price_krw');
});

test('A1 buildDiff — identical before/after still produces correct structure', () => {
  const both = { title: '동일 타이틀', top_copy: '동일 카피', price_krw: 29900 };
  const diff = buildDiff(both, both);
  assert.strictEqual(diff.title.before, diff.title.after, 'title should be same when before==after');
  assert.strictEqual(diff.price.before, diff.price.after, 'price should be same when before==after');
});

// ---------------------------------------------------------------------------
// A2. evaluateHoldout
// ---------------------------------------------------------------------------

test('A2 evaluateHoldout — positive uplift passes_gate=true', () => {
  const result = evaluateHoldout({ baselineRevenue: 5000000, finalRevenue: 6000000 });
  assert.strictEqual(result.holdout_uplift, 1000000, 'holdout_uplift should be finalRevenue - baselineRevenue');
  assert.strictEqual(result.passes_gate, true, 'passes_gate should be true for positive uplift');
  assert.strictEqual(result.baseline_revenue, 5000000, 'baseline_revenue must be preserved');
  assert.strictEqual(result.final_revenue, 6000000, 'final_revenue must be preserved');
});

test('A2 evaluateHoldout — negative uplift passes_gate=false', () => {
  const result = evaluateHoldout({ baselineRevenue: 6000000, finalRevenue: 5000000 });
  assert.strictEqual(result.holdout_uplift, -1000000, 'holdout_uplift should be negative');
  assert.strictEqual(result.passes_gate, false, 'passes_gate should be false for negative uplift');
});

test('A2 evaluateHoldout — zero uplift passes_gate=false', () => {
  const result = evaluateHoldout({ baselineRevenue: 5000000, finalRevenue: 5000000 });
  assert.strictEqual(result.holdout_uplift, 0, 'holdout_uplift should be 0');
  assert.strictEqual(result.passes_gate, false, 'passes_gate should be false for zero uplift (not strictly positive)');
});

test('A2 evaluateHoldout — returns all required fields', () => {
  const result = evaluateHoldout({ baselineRevenue: 1000, finalRevenue: 2000 });
  assert.ok('holdout_uplift' in result, 'holdout_uplift field must exist');
  assert.ok('passes_gate' in result, 'passes_gate field must exist');
  assert.ok('baseline_revenue' in result, 'baseline_revenue field must exist');
  assert.ok('final_revenue' in result, 'final_revenue field must exist');
  assert.strictEqual(typeof result.holdout_uplift, 'number', 'holdout_uplift must be a number');
  assert.strictEqual(typeof result.passes_gate, 'boolean', 'passes_gate must be a boolean');
});

// ---------------------------------------------------------------------------
// A3. computeMarginRate / isMarginFloorSatisfied / countTextDelta
// ---------------------------------------------------------------------------

test('A3 computeMarginRate — basic 50% margin', () => {
  assert.strictEqual(computeMarginRate(20000, 10000), 0.5, '(20000-10000)/20000 = 0.5');
});

test('A3 computeMarginRate — zero price returns 0', () => {
  assert.strictEqual(computeMarginRate(0, 10000), 0, 'zero price should return 0 margin');
});

test('A3 computeMarginRate — negative price returns 0', () => {
  assert.strictEqual(computeMarginRate(-100, 10000), 0, 'negative price returns 0');
});

test('A3 computeMarginRate — price equals cost → 0% margin', () => {
  assert.strictEqual(computeMarginRate(10000, 10000), 0, 'price == cost should return 0');
});

test('A3 computeMarginRate — KRW integer values (29900/11000)', () => {
  const margin = computeMarginRate(29900, 11000);
  const expected = (29900 - 11000) / 29900;
  assert.ok(Math.abs(margin - expected) < 0.0001, `margin ${margin} should be close to ${expected}`);
});

test('A3 isMarginFloorSatisfied — satisfied when margin >= floor', () => {
  assert.strictEqual(isMarginFloorSatisfied(29900, 11000, 0.35), true, '63% margin satisfies 35% floor');
});

test('A3 isMarginFloorSatisfied — violated when margin < floor', () => {
  assert.strictEqual(isMarginFloorSatisfied(29900, 28000, 0.35), false, 'low margin violates 35% floor');
});

test('A3 isMarginFloorSatisfied — exact floor boundary is satisfied', () => {
  // price=20000, cost=13000 → margin = 7000/20000 = 0.35
  assert.strictEqual(isMarginFloorSatisfied(20000, 13000, 0.35), true, 'exact 35% margin satisfies 35% floor');
});

test('A3 countTextDelta — same string returns 0', () => {
  assert.strictEqual(countTextDelta('트리클리닉 샴푸', '트리클리닉 샴푸'), 0, 'identical strings should return 0');
});

test('A3 countTextDelta — empty strings return 0', () => {
  assert.strictEqual(countTextDelta('', ''), 0, 'both empty should return 0');
});

test('A3 countTextDelta — different strings return positive number', () => {
  const delta = countTextDelta('원래 제목', '완전히 다른 제목입니다');
  assert.ok(delta > 0, 'different strings should have positive delta');
});

test('A3 countTextDelta — null/undefined treated as empty string', () => {
  const delta1 = countTextDelta(null, '');
  const delta2 = countTextDelta(undefined, undefined);
  assert.strictEqual(delta1, 0, 'null vs empty string should return 0');
  assert.strictEqual(delta2, 0, 'undefined vs undefined should return 0');
});

// ---------------------------------------------------------------------------
// A4. compareStrategies / buildScoredStrategy
// ---------------------------------------------------------------------------

test('A4 compareStrategies — margin violations take priority over revenue', () => {
  const baseline = { title: 'Base', top_copy: 'Copy' };
  // a: no violations, low revenue
  const a = buildScoredStrategy({
    candidate: { id: 'a', title: 'A', top_copy: 'A copy', price_krw: 20000 },
    baseline,
    sampledResult: { choices: { our_product: 5 } },
    cost: 10000,
    minimumMarginFloor: 0.4,
  });
  // b: has violations, high revenue
  const b = buildScoredStrategy({
    candidate: { id: 'b', title: 'B', top_copy: 'B copy', price_krw: 50000 },
    baseline,
    sampledResult: { choices: { our_product: 100 } },
    cost: 49000, // margin < floor
    minimumMarginFloor: 0.4,
  });
  assert.ok(compareStrategies(a, b) < 0, 'no-violation strategy must rank above violation strategy regardless of revenue');
});

test('A4 compareStrategies — equal violations: higher revenue wins', () => {
  const baseline = { title: 'Base', top_copy: 'Copy' };
  const low = buildScoredStrategy({
    candidate: { id: 'low', title: 'Low', top_copy: 'Low copy', price_krw: 20000 },
    baseline,
    sampledResult: { choices: { our_product: 10 } },
    cost: 8000,
    minimumMarginFloor: 0.3,
  });
  const high = buildScoredStrategy({
    candidate: { id: 'high', title: 'High', top_copy: 'High copy', price_krw: 20000 },
    baseline,
    sampledResult: { choices: { our_product: 20 } },
    cost: 8000,
    minimumMarginFloor: 0.3,
  });
  assert.ok(compareStrategies(high, low) < 0, 'higher revenue strategy must sort first');
});

test('A4 buildScoredStrategy — output shape includes required fields', () => {
  const baseline = { title: '기준 타이틀', top_copy: '기준 카피' };
  const candidate = { id: 'test', title: '테스트 타이틀', top_copy: '테스트 카피', price_krw: 28000 };
  const sampledResult = { choices: { our_product: 50, competitor_a: 30, competitor_b: 20, competitor_c: 10, pass: 5 } };
  const scored = buildScoredStrategy({ candidate, baseline, sampledResult, cost: 10000, minimumMarginFloor: 0.35 });

  assert.ok('simulated_revenue' in scored, 'simulated_revenue field must exist');
  assert.ok('margin_rate' in scored, 'margin_rate field must exist');
  assert.ok('margin_floor_violations' in scored, 'margin_floor_violations field must exist');
  assert.ok('text_delta' in scored, 'text_delta field must exist');
  assert.ok('sampled_result' in scored, 'sampled_result field must exist');

  assert.strictEqual(scored.simulated_revenue, 50 * 28000, 'simulated_revenue = choices.our_product * price_krw');
  assert.ok(scored.margin_rate > 0, 'margin_rate must be positive');
  assert.strictEqual(scored.margin_floor_violations, 0, 'no violation with healthy margin');
});

test('A4 buildScoredStrategy — margin floor violation counts correctly', () => {
  const baseline = { title: 'A', top_copy: 'B' };
  const candidate = { id: 'x', title: 'X', top_copy: 'Y', price_krw: 10000 };
  const sampledResult = { choices: { our_product: 5 } };
  // cost 9500 on price 10000 → margin 5% < floor 35%
  const scored = buildScoredStrategy({ candidate, baseline, sampledResult, cost: 9500, minimumMarginFloor: 0.35 });
  assert.strictEqual(scored.margin_floor_violations, 1, 'must count 1 violation when margin < floor');
});

// ---------------------------------------------------------------------------
// A5. ARCHETYPES constant integrity
// ---------------------------------------------------------------------------

test('A5 ARCHETYPES — has exactly 8 entries', () => {
  assert.strictEqual(ARCHETYPES.length, 8, 'must have exactly 8 archetype definitions');
});

test('A5 ARCHETYPES — cohort_weight_percent sums to 100', () => {
  const total = ARCHETYPES.reduce((sum, a) => sum + a.cohort_weight_percent, 0);
  assert.strictEqual(total, 100, 'all archetype weights must sum to exactly 100');
});

test('A5 ARCHETYPES — each archetype has required fields', () => {
  const REQUIRED = ['id', 'label', 'cohort_weight_percent', 'price_sensitivity', 'trust_sensitivity'];
  for (const archetype of ARCHETYPES) {
    for (const field of REQUIRED) {
      assert.ok(field in archetype, `archetype "${archetype.id ?? '?'}" must have field "${field}"`);
    }
    assert.strictEqual(typeof archetype.id, 'string', `archetype.id must be string`);
    assert.ok(archetype.id.length > 0, `archetype.id must not be empty`);
    assert.strictEqual(typeof archetype.label, 'string', `archetype.label must be string`);
    assert.strictEqual(typeof archetype.cohort_weight_percent, 'number', `archetype.cohort_weight_percent must be number`);
    assert.ok(archetype.cohort_weight_percent > 0, `cohort_weight_percent must be positive`);
  }
});

test('A5 ARCHETYPES — all ids are unique', () => {
  const ids = ARCHETYPES.map((a) => a.id);
  const uniqueIds = new Set(ids);
  assert.strictEqual(uniqueIds.size, ids.length, 'all archetype ids must be unique');
});

test('A5 ARCHETYPES — price_sensitive archetype has 18% weight', () => {
  const priceSensitive = ARCHETYPES.find((a) => a.id === 'price_sensitive');
  assert.ok(priceSensitive, 'price_sensitive archetype must exist');
  assert.strictEqual(priceSensitive.cohort_weight_percent, 18, 'price_sensitive weight must be 18%');
});

// ===========================================================================
// B. API Route Handler Integration Tests (mock mode, in-process server)
// ===========================================================================

// ---------------------------------------------------------------------------
// B1. GET / — serve dashboard HTML
// ---------------------------------------------------------------------------

test('B1 GET / — returns 200 with text/html content-type', async () => {
  const server = await startServer();
  try {
    const { status, headers } = await getText(server, '/');
    assert.strictEqual(status, 200, 'GET / must return 200');
    assert.ok(
      (headers['content-type'] ?? '').includes('text/html'),
      `content-type should be text/html, got: ${headers['content-type']}`
    );
  } finally {
    await stopServer(server);
  }
});

test('B1 GET / — HTML body is non-empty and contains dashboard structure', async () => {
  const server = await startServer();
  try {
    const { body } = await getText(server, '/');
    assert.ok(body.length > 100, 'HTML body should be substantial');
    assert.match(body, /<html/i, 'body should contain <html> tag');
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// B2. GET /dashboard.js — serve JavaScript
// ---------------------------------------------------------------------------

test('B2 GET /dashboard.js — returns 200 with application/javascript content-type', async () => {
  const server = await startServer();
  try {
    const { status, headers, body } = await getText(server, '/dashboard.js');
    assert.strictEqual(status, 200, 'GET /dashboard.js must return 200');
    assert.ok(
      (headers['content-type'] ?? '').includes('javascript'),
      `content-type should be application/javascript, got: ${headers['content-type']}`
    );
    assert.ok(body.length > 100, 'dashboard.js body should be substantial');
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// B3. GET /styles.css — serve CSS
// ---------------------------------------------------------------------------

test('B3 GET /styles.css — returns 200 with text/css content-type', async () => {
  const server = await startServer();
  try {
    const { status, headers, body } = await getText(server, '/styles.css');
    assert.strictEqual(status, 200, 'GET /styles.css must return 200');
    assert.ok(
      (headers['content-type'] ?? '').includes('css'),
      `content-type should be text/css, got: ${headers['content-type']}`
    );
    assert.ok(body.length > 100, 'styles.css body should be substantial');
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// B4. GET /particle-engine.mjs — serve particle engine
// ---------------------------------------------------------------------------

test('B4 GET /particle-engine.mjs — returns 200 with javascript content-type', async () => {
  const server = await startServer();
  try {
    const { status, headers } = await getText(server, '/particle-engine.mjs');
    assert.strictEqual(status, 200, 'GET /particle-engine.mjs must return 200');
    assert.ok(
      (headers['content-type'] ?? '').includes('javascript'),
      `content-type should include javascript, got: ${headers['content-type']}`
    );
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// B5. GET /api/fixtures — full schema validation
// ---------------------------------------------------------------------------

test('B5 GET /api/fixtures — returns 200 with JSON', async () => {
  const server = await startServer();
  try {
    const { status, headers } = await getJson(server, '/api/fixtures');
    assert.strictEqual(status, 200, 'GET /api/fixtures must return 200');
    assert.ok(
      (headers['content-type'] ?? '').includes('application/json'),
      `content-type should be application/json, got: ${headers['content-type']}`
    );
  } finally {
    await stopServer(server);
  }
});

test('B5 GET /api/fixtures — response has product with all required fields', async () => {
  const server = await startServer();
  try {
    const { body } = await getJson(server, '/api/fixtures');
    const p = body.product;
    assert.ok(p, 'response must have product object');
    assert.strictEqual(typeof p.product_name, 'string', 'product.product_name must be string');
    assert.ok(p.product_name.length > 0, 'product.product_name must not be empty');
    assert.strictEqual(typeof p.brand_name, 'string', 'product.brand_name must be string');
    assert.ok(p.brand_name.length > 0, 'product.brand_name must not be empty');
    assert.strictEqual(typeof p.current_title, 'string', 'product.current_title must be string');
    assert.ok(p.current_title.length > 0, 'product.current_title must not be empty');
    assert.strictEqual(typeof p.current_top_copy, 'string', 'product.current_top_copy must be string');
    assert.ok(p.current_top_copy.length > 0, 'product.current_top_copy must not be empty');
    assert.strictEqual(typeof p.current_price_krw, 'number', 'product.current_price_krw must be number');
    assert.ok(Number.isInteger(p.current_price_krw), 'current_price_krw must be integer (KRW)');
    assert.ok(p.current_price_krw > 0, 'current_price_krw must be positive');
    assert.strictEqual(typeof p.current_cost_krw, 'number', 'product.current_cost_krw must be number');
    assert.ok(Number.isInteger(p.current_cost_krw), 'current_cost_krw must be integer (KRW)');
    assert.ok(p.current_cost_krw > 0, 'current_cost_krw must be positive');
  } finally {
    await stopServer(server);
  }
});

test('B5 GET /api/fixtures — response has 3 competitors with required fields', async () => {
  const server = await startServer();
  try {
    const { body } = await getJson(server, '/api/fixtures');
    assert.ok(Array.isArray(body.competitors), 'response must have competitors array');
    assert.ok(body.competitors.length >= 3, 'must have at least 3 competitors');
    for (const c of body.competitors) {
      assert.strictEqual(typeof c.id, 'string', 'competitor.id must be string');
      assert.ok(c.id.length > 0, 'competitor.id must not be empty');
      assert.strictEqual(typeof c.product_name, 'string', 'competitor.product_name must be string');
      assert.strictEqual(typeof c.price_krw, 'number', 'competitor.price_krw must be number');
      assert.ok(Number.isInteger(c.price_krw), 'competitor.price_krw must be integer');
      assert.ok(c.price_krw > 0, 'competitor.price_krw must be positive');
    }
  } finally {
    await stopServer(server);
  }
});

test('B5 GET /api/fixtures — response has 8 archetypes with weights summing to 100', async () => {
  const server = await startServer();
  try {
    const { body } = await getJson(server, '/api/fixtures');
    assert.ok(Array.isArray(body.archetypes), 'response must have archetypes array');
    assert.strictEqual(body.archetypes.length, 8, 'must have exactly 8 archetypes');
    const total = body.archetypes.reduce((s, a) => s + a.cohort_weight_percent, 0);
    assert.strictEqual(total, 100, 'archetype cohort_weight_percent must sum to 100');
    for (const a of body.archetypes) {
      assert.strictEqual(typeof a.id, 'string', 'archetype.id must be string');
      assert.strictEqual(typeof a.label, 'string', 'archetype.label must be string');
      assert.strictEqual(typeof a.cohort_weight_percent, 'number', 'archetype.cohort_weight_percent must be number');
    }
  } finally {
    await stopServer(server);
  }
});

test('B5 GET /api/fixtures — response has defaults with iteration_count and minimum_margin_floor', async () => {
  const server = await startServer();
  try {
    const { body } = await getJson(server, '/api/fixtures');
    assert.ok(body.defaults, 'response must have defaults object');
    assert.strictEqual(typeof body.defaults.iteration_count, 'number', 'defaults.iteration_count must be number');
    assert.ok(body.defaults.iteration_count > 0, 'defaults.iteration_count must be positive');
    assert.strictEqual(typeof body.defaults.minimum_margin_floor, 'number', 'defaults.minimum_margin_floor must be number');
    assert.ok(body.defaults.minimum_margin_floor > 0, 'defaults.minimum_margin_floor must be positive');
    assert.ok(body.defaults.minimum_margin_floor < 1, 'defaults.minimum_margin_floor must be less than 1');
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// B6. POST /api/run — correct response structure
// ---------------------------------------------------------------------------

test('B6 POST /api/run — returns 200 with correct top-level structure', async () => {
  const server = await startServer();
  try {
    const { status, body } = await postJson(server, '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    assert.strictEqual(status, 200, 'POST /api/run must return 200');
    assert.ok('baseline' in body, 'response must have baseline field');
    assert.ok('selected_strategy' in body, 'response must have selected_strategy field');
    assert.ok('holdout' in body, 'response must have holdout field');
    assert.ok('diff' in body, 'response must have diff field');
    assert.ok('artifact' in body, 'response must have artifact field');
  } finally {
    await stopServer(server);
  }
});

test('B6 POST /api/run — baseline has required fields', async () => {
  const server = await startServer();
  try {
    const { body } = await postJson(server, '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const b = body.baseline;
    assert.ok(b, 'baseline must exist');
    assert.strictEqual(typeof b.simulated_revenue, 'number', 'baseline.simulated_revenue must be number');
    assert.ok(b.simulated_revenue >= 0, 'baseline.simulated_revenue must be non-negative');
    assert.ok(Number.isInteger(b.simulated_revenue), 'baseline.simulated_revenue must be integer (KRW)');
  } finally {
    await stopServer(server);
  }
});

test('B6 POST /api/run — selected_strategy has id and required strategy fields', async () => {
  const server = await startServer();
  try {
    const { body } = await postJson(server, '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const s = body.selected_strategy;
    assert.ok(s, 'selected_strategy must exist');
    assert.ok(typeof s.id === 'string' && s.id.length > 0, 'selected_strategy.id must be non-empty string');
    assert.strictEqual(typeof s.simulated_revenue, 'number', 'selected_strategy.simulated_revenue must be number');
  } finally {
    await stopServer(server);
  }
});

test('B6 POST /api/run — holdout has holdout_uplift field', async () => {
  const server = await startServer();
  try {
    const { body } = await postJson(server, '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    assert.ok(body.holdout, 'holdout must exist');
    assert.strictEqual(typeof body.holdout.holdout_uplift, 'number', 'holdout.holdout_uplift must be number');
  } finally {
    await stopServer(server);
  }
});

test('B6 POST /api/run — diff has exactly title, top_copy, price keys', async () => {
  const server = await startServer();
  try {
    const { body } = await postJson(server, '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    assert.ok(body.diff, 'diff must exist');
    assert.deepEqual(Object.keys(body.diff).sort(), ['price', 'title', 'top_copy'], 'diff must have exactly title, top_copy, price keys');
    for (const key of ['title', 'top_copy', 'price']) {
      assert.ok('before' in body.diff[key], `diff.${key}.before must exist`);
      assert.ok('after' in body.diff[key], `diff.${key}.after must exist`);
    }
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// B7. POST /api/run with overrides — baseline reflects overrides
// ---------------------------------------------------------------------------

test('B7 POST /api/run with title override — baseline.title reflects override', async () => {
  const server = await startServer();
  try {
    const overrideTitle = '테스트 오버라이드 타이틀 AC11';
    const { body } = await postJson(server, '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
      title: overrideTitle,
    });
    assert.strictEqual(body.baseline.title, overrideTitle, 'baseline.title must reflect title override');
  } finally {
    await stopServer(server);
  }
});

test('B7 POST /api/run with priceKrw override — baseline.price_krw reflects override', async () => {
  const server = await startServer();
  try {
    const overridePrice = 24900;
    const { body } = await postJson(server, '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
      priceKrw: overridePrice,
    });
    assert.strictEqual(body.baseline.price_krw, overridePrice, 'baseline.price_krw must reflect priceKrw override');
  } finally {
    await stopServer(server);
  }
});

test('B7 POST /api/run with all overrides — all baseline fields reflect overrides', async () => {
  const server = await startServer();
  try {
    const overrides = {
      title: 'AC11 Sub1 오버라이드 타이틀',
      topCopy: 'AC11 Sub1 오버라이드 카피',
      priceKrw: 25000,
      costKrw: 9000,
    };
    const { status, body } = await postJson(server, '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
      ...overrides,
    });
    assert.strictEqual(status, 200, 'POST /api/run with overrides must return 200');
    assert.strictEqual(body.baseline.title, overrides.title, 'baseline.title must match override');
    assert.strictEqual(body.baseline.top_copy, overrides.topCopy, 'baseline.top_copy must match topCopy override');
    assert.strictEqual(body.baseline.price_krw, overrides.priceKrw, 'baseline.price_krw must match priceKrw override');
    // Margin with overridden cost should be (25000-9000)/25000 = 0.64
    const expectedMargin = (overrides.priceKrw - overrides.costKrw) / overrides.priceKrw;
    assert.ok(
      Math.abs(body.baseline.margin_rate - expectedMargin) < 0.001,
      `baseline.margin_rate (${body.baseline.margin_rate}) must use overridden costKrw`
    );
  } finally {
    await stopServer(server);
  }
});

test('B7 POST /api/run with costKrw override — simulated_revenue differs from default', async () => {
  const server = await startServer();
  try {
    // Default run
    const defaultResult = await postJson(server, '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    // Override price to a very different value
    const overrideResult = await postJson(server, '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
      priceKrw: 14900,
    });
    // Different price means different revenue even if same number of buyers choose our product
    assert.strictEqual(defaultResult.body.baseline.price_krw, 29900, 'default baseline.price_krw should be fixture value 29900');
    assert.strictEqual(overrideResult.body.baseline.price_krw, 14900, 'override baseline.price_krw should be 14900');
    assert.notStrictEqual(
      defaultResult.body.baseline.simulated_revenue,
      overrideResult.body.baseline.simulated_revenue,
      'revenues must differ when prices differ'
    );
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// B8. POST /api/run/stream — SSE event stream
// ---------------------------------------------------------------------------

test('B8 POST /api/run/stream — returns text/event-stream content-type', async () => {
  const server = await startServer();
  try {
    const { status, headers } = await collectSse(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    assert.strictEqual(status, 200, 'POST /api/run/stream must return 200');
    assert.ok(
      (headers['content-type'] ?? '').includes('text/event-stream'),
      `content-type should be text/event-stream, got: ${headers['content-type']}`
    );
  } finally {
    await stopServer(server);
  }
});

test('B8 POST /api/run/stream — emits iteration_start, agent_decision, iteration_complete, simulation_complete', async () => {
  const server = await startServer();
  try {
    const { events } = await collectSse(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const types = events.map((e) => e.type);
    assert.ok(types.includes('iteration_start'), 'must emit iteration_start event');
    assert.ok(types.includes('agent_decision'), 'must emit agent_decision events');
    assert.ok(types.includes('iteration_complete'), 'must emit iteration_complete event');
    assert.ok(types.includes('simulation_complete'), 'must emit simulation_complete event');
  } finally {
    await stopServer(server);
  }
});

test('B8 POST /api/run/stream — simulation_complete has baseline, selected_strategy, holdout, diff', async () => {
  const server = await startServer();
  try {
    const { events } = await collectSse(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const complete = events.find((e) => e.type === 'simulation_complete');
    assert.ok(complete, 'simulation_complete event must be present');
    assert.ok(complete.data.baseline, 'simulation_complete must have baseline');
    assert.ok(complete.data.selected_strategy, 'simulation_complete must have selected_strategy');
    assert.ok(complete.data.holdout, 'simulation_complete must have holdout');
    assert.ok(complete.data.diff, 'simulation_complete must have diff');
    assert.strictEqual(typeof complete.data.holdout.holdout_uplift, 'number', 'holdout.holdout_uplift must be number');
  } finally {
    await stopServer(server);
  }
});

test('B8 POST /api/run/stream — simulation_complete is last event', async () => {
  const server = await startServer();
  try {
    const { events } = await collectSse(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    assert.ok(events.length > 0, 'must have at least one event');
    assert.strictEqual(events[events.length - 1].type, 'simulation_complete', 'last event must be simulation_complete');
  } finally {
    await stopServer(server);
  }
});

test('B8 POST /api/run/stream — agent_decision events have required fields', async () => {
  const VALID_PRODUCTS = new Set(['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']);
  const server = await startServer();
  try {
    const { events } = await collectSse(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const decisions = events.filter((e) => e.type === 'agent_decision');
    assert.ok(decisions.length > 0, 'must have at least one agent_decision event');
    // Check a sample of agent decisions (first 10 and last 10)
    const sample = [...decisions.slice(0, 10), ...decisions.slice(-10)];
    for (const { data } of sample) {
      assert.ok(typeof data.agent_id === 'string' && data.agent_id.length > 0, 'agent_decision.agent_id must be non-empty string');
      assert.ok(VALID_PRODUCTS.has(data.chosen_product), `agent_decision.chosen_product "${data.chosen_product}" must be valid`);
      assert.ok(typeof data.reasoning === 'string' && data.reasoning.length > 0, 'agent_decision.reasoning must be non-empty string');
    }
  } finally {
    await stopServer(server);
  }
});

test('B8 POST /api/run/stream — iteration_complete has choice_summary summing to 800', async () => {
  // choice_summary format: { key: {count, pct} } per Sub-AC 3c explicit schema
  const server = await startServer();
  try {
    const { events } = await collectSse(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const completeEvents = events.filter((e) => e.type === 'iteration_complete');
    assert.ok(completeEvents.length > 0, 'must have at least one iteration_complete event');
    for (const { data } of completeEvents) {
      const cs = data.choice_summary;
      assert.ok(cs && typeof cs === 'object', 'iteration_complete must have choice_summary object');
      const KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
      for (const key of KEYS) {
        assert.ok(key in cs, `choice_summary must contain key: ${key}`);
      }
      // choice_summary values may be plain counts OR {count, pct} objects
      const total = KEYS.reduce((sum, key) => {
        const v = cs[key];
        return sum + (typeof v === 'object' && v !== null ? (v.count ?? 0) : (v ?? 0));
      }, 0);
      assert.strictEqual(total, 800, `choice_summary counts must sum to 800, got ${total}`);
    }
  } finally {
    await stopServer(server);
  }
});

test('B8 POST /api/run/stream with overrides — baseline reflects override in simulation_complete', async () => {
  const overrideTitle = 'SSE 오버라이드 타이틀 AC11';
  const server = await startServer();
  try {
    const { events } = await collectSse(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
      title: overrideTitle,
    });
    const complete = events.find((e) => e.type === 'simulation_complete');
    assert.ok(complete, 'simulation_complete event must be present');
    assert.strictEqual(
      complete.data.baseline?.title ?? complete.data.diff?.title?.before,
      overrideTitle,
      'simulation_complete should reflect override title in baseline or diff.title.before'
    );
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// B9. Unknown route — 404
// ---------------------------------------------------------------------------

test('B9 Unknown GET route — returns 404', async () => {
  const server = await startServer();
  try {
    const { status } = await getJson(server, '/not-a-real-route');
    assert.strictEqual(status, 404, 'Unknown GET route must return 404');
  } finally {
    await stopServer(server);
  }
});

test('B9 404 response — body has error field', async () => {
  const server = await startServer();
  try {
    const { body } = await getJson(server, '/api/nonexistent');
    assert.ok(body.error, '404 response must have error field');
  } finally {
    await stopServer(server);
  }
});

test('B9 POST to unknown route — returns 404', async () => {
  const server = await startServer();
  try {
    const { status } = await postJson(server, '/api/unknown-endpoint', {});
    assert.strictEqual(status, 404, 'Unknown POST route must return 404');
  } finally {
    await stopServer(server);
  }
});
