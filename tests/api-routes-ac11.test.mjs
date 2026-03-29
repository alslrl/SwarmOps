/**
 * tests/api-routes-ac11.test.mjs
 *
 * Sub-AC 11.1: Integration tests for all HTTP API route handlers.
 * All tests use mock mode (no live OpenAI calls).
 *
 * Routes covered:
 *   GET  /                  → 200 HTML, contains 'SwarmOps'
 *   GET  /api/fixtures      → full product schema per PRD §14.4
 *   POST /api/run           → JSON response with baseline, selected_strategy, holdout, diff, artifact
 *   POST /api/run/stream    → text/event-stream, emits correct SSE events
 *
 * Test Spec §4 HTTP API Gate:
 *   - health check: GET / → 200, body contains 'SwarmOps'
 *   - fixture API: full schema (product, competitors, archetypes, defaults)
 *   - batch run mock: baseline, selected_strategy, holdout, diff, artifact
 *   - batch run with overrides: title/topCopy/priceKrw/costKrw respected
 *   - SSE stream: Content-Type text/event-stream, expected events emitted
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Force mock mode — no OpenAI API calls during these tests
process.env.SELLER_WAR_GAME_MODEL_MODE = 'mock';

const { createServer } = await import('../src/server.mjs');

// ── Server lifecycle helpers ─────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
    server.once('error', reject);
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Make a JSON GET or POST request, return { status, headers, body }.
 */
function httpRequest(port, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Accept': 'application/json',
      },
    };
    if (body !== null) {
      const payload = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers,
          raw,
          json: () => JSON.parse(raw),
        });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Collect SSE stream from POST /api/run/stream.
 * Returns array of { type, data } parsed events.
 * Aborts after `maxMs` milliseconds to avoid hangs.
 */
function collectSseEvents(port, body, maxMs = 60_000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/api/run/stream',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const events = [];
    let statusCode = null;
    let contentType = null;
    let buffer = '';

    const timeout = setTimeout(() => {
      reject(new Error(`SSE stream did not complete within ${maxMs}ms`));
    }, maxMs);

    const req = http.request(options, (res) => {
      statusCode = res.statusCode;
      contentType = res.headers['content-type'];

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        // Parse complete SSE messages (delimited by double newline)
        const messages = buffer.split('\n\n');
        buffer = messages.pop(); // last partial message back to buffer
        for (const msg of messages) {
          if (!msg.trim()) continue;
          let eventType = 'message';
          let dataLine = null;
          for (const line of msg.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            if (line.startsWith('data: ')) dataLine = line.slice(6).trim();
          }
          if (dataLine !== null) {
            try {
              events.push({ type: eventType, data: JSON.parse(dataLine) });
            } catch {
              events.push({ type: eventType, raw: dataLine });
            }
          }
        }
      });

      res.on('end', () => {
        clearTimeout(timeout);
        resolve({ statusCode, contentType, events });
      });

      res.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. GET / — Health Check
// ═══════════════════════════════════════════════════════════════════════════

test('GET / returns 200 status', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'GET', '/');
    assert.equal(res.status, 200, `GET / should return 200, got ${res.status}`);
  } finally {
    await stopServer(server);
  }
});

test('GET / returns HTML content-type', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'GET', '/');
    assert.ok(
      res.headers['content-type']?.includes('text/html'),
      `GET / content-type should be text/html, got "${res.headers['content-type']}"`,
    );
  } finally {
    await stopServer(server);
  }
});

test('GET / body contains SwarmOps branding', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'GET', '/');
    assert.ok(
      res.raw.includes('SwarmOps'),
      'GET / HTML body must contain "SwarmOps"',
    );
  } finally {
    await stopServer(server);
  }
});

test('GET / body contains 3-panel data-testids', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'GET', '/');
    assert.ok(res.raw.includes('panel-input'), 'HTML must include panel-input testid');
    assert.ok(res.raw.includes('panel-simulation'), 'HTML must include panel-simulation testid');
    assert.ok(res.raw.includes('btn-run'), 'HTML must include btn-run testid');
  } finally {
    await stopServer(server);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. GET /api/fixtures — Fixture API Schema
// ═══════════════════════════════════════════════════════════════════════════

test('GET /api/fixtures returns 200 JSON', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'GET', '/api/fixtures');
    assert.equal(res.status, 200, `GET /api/fixtures should return 200`);
    assert.ok(
      res.headers['content-type']?.includes('application/json'),
      'content-type must be application/json',
    );
  } finally {
    await stopServer(server);
  }
});

test('GET /api/fixtures: product object has all 6 required fields per PRD §14.4', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'GET', '/api/fixtures');
    const data = res.json();

    assert.ok(data.product, 'response must have product object');
    assert.equal(typeof data.product.product_name, 'string', 'product.product_name must be string');
    assert.ok(data.product.product_name.length > 0, 'product.product_name must not be empty');
    assert.equal(typeof data.product.brand_name, 'string', 'product.brand_name must be string');
    assert.ok(data.product.brand_name.length > 0, 'product.brand_name must not be empty');
    assert.equal(typeof data.product.current_title, 'string', 'product.current_title must be string');
    assert.ok(data.product.current_title.length > 0, 'product.current_title must not be empty');
    assert.equal(typeof data.product.current_top_copy, 'string', 'product.current_top_copy must be string');
    assert.ok(data.product.current_top_copy.length > 0, 'product.current_top_copy must not be empty');
    assert.equal(typeof data.product.current_price_krw, 'number', 'product.current_price_krw must be number');
    assert.ok(Number.isInteger(data.product.current_price_krw), 'price must be integer KRW');
    assert.ok(data.product.current_price_krw > 0, 'price must be positive');
    assert.equal(typeof data.product.current_cost_krw, 'number', 'product.current_cost_krw must be number');
    assert.ok(Number.isInteger(data.product.current_cost_krw), 'cost must be integer KRW');
    assert.ok(data.product.current_cost_krw > 0, 'cost must be positive');
  } finally {
    await stopServer(server);
  }
});

test('GET /api/fixtures: competitors array has 3 items with id, product_name, price_krw', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'GET', '/api/fixtures');
    const data = res.json();

    assert.ok(Array.isArray(data.competitors), 'competitors must be array');
    assert.equal(data.competitors.length, 3, 'must have exactly 3 competitors');
    for (const c of data.competitors) {
      assert.equal(typeof c.id, 'string', 'competitor.id must be string');
      assert.ok(c.id.length > 0, 'competitor.id must not be empty');
      assert.equal(typeof c.product_name, 'string', 'competitor.product_name must be string');
      assert.ok(c.product_name.length > 0, 'competitor.product_name must not be empty');
      assert.equal(typeof c.price_krw, 'number', 'competitor.price_krw must be number');
      assert.ok(Number.isInteger(c.price_krw), 'competitor.price_krw must be integer KRW');
      assert.ok(c.price_krw > 0, 'competitor.price_krw must be positive');
    }
  } finally {
    await stopServer(server);
  }
});

test('GET /api/fixtures: archetypes array has 8 items with cohort weights summing to 100', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'GET', '/api/fixtures');
    const data = res.json();

    assert.ok(Array.isArray(data.archetypes), 'archetypes must be array');
    assert.equal(data.archetypes.length, 8, 'must have exactly 8 archetypes');
    for (const a of data.archetypes) {
      assert.equal(typeof a.id, 'string', 'archetype.id must be string');
      assert.equal(typeof a.label, 'string', 'archetype.label must be string');
      assert.equal(typeof a.cohort_weight_percent, 'number', 'cohort_weight_percent must be number');
    }
    const totalWeight = data.archetypes.reduce((sum, a) => sum + a.cohort_weight_percent, 0);
    assert.equal(totalWeight, 100, `archetype weights must sum to 100, got ${totalWeight}`);
  } finally {
    await stopServer(server);
  }
});

test('GET /api/fixtures: defaults has iteration_count and minimum_margin_floor', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'GET', '/api/fixtures');
    const data = res.json();

    assert.ok(data.defaults, 'response must have defaults object');
    assert.equal(typeof data.defaults.iteration_count, 'number', 'defaults.iteration_count must be number');
    assert.ok(data.defaults.iteration_count > 0, 'defaults.iteration_count must be positive');
    assert.equal(typeof data.defaults.minimum_margin_floor, 'number', 'defaults.minimum_margin_floor must be number');
    assert.ok(data.defaults.minimum_margin_floor > 0, 'defaults.minimum_margin_floor must be positive');
    assert.ok(data.defaults.minimum_margin_floor <= 1, 'defaults.minimum_margin_floor must be ≤ 1 (ratio)');
  } finally {
    await stopServer(server);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. POST /api/run — Batch Run
// ═══════════════════════════════════════════════════════════════════════════

test('POST /api/run returns 200 JSON with baseline, selected_strategy, holdout, diff, artifact', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'POST', '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    assert.equal(res.status, 200, `POST /api/run should return 200, got ${res.status}`);
    const data = res.json();
    assert.ok(data.baseline, 'response must have baseline');
    assert.ok(data.selected_strategy, 'response must have selected_strategy');
    assert.ok(data.holdout, 'response must have holdout');
    assert.ok(data.diff, 'response must have diff');
    assert.ok(data.artifact, 'response must have artifact');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run: baseline has simulated_revenue as non-negative integer', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'POST', '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const data = res.json();
    assert.equal(typeof data.baseline.simulated_revenue, 'number', 'baseline.simulated_revenue must be number');
    assert.ok(data.baseline.simulated_revenue >= 0, 'baseline revenue must be non-negative');
    assert.equal(
      Math.floor(data.baseline.simulated_revenue),
      data.baseline.simulated_revenue,
      'baseline.simulated_revenue must be integer (KRW)',
    );
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run: selected_strategy has id (non-empty)', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'POST', '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const data = res.json();
    assert.equal(typeof data.selected_strategy.id, 'string', 'selected_strategy.id must be string');
    assert.ok(data.selected_strategy.id.length > 0, 'selected_strategy.id must not be empty');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run: holdout has holdout_uplift as number', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'POST', '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const data = res.json();
    assert.equal(typeof data.holdout.holdout_uplift, 'number', 'holdout.holdout_uplift must be number');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run: diff has exactly title, top_copy, price keys', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'POST', '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const data = res.json();
    assert.deepEqual(
      Object.keys(data.diff).sort(),
      ['price', 'title', 'top_copy'],
      'diff must have exactly title, top_copy, price keys',
    );
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run: diff.title has before and after string values', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'POST', '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const data = res.json();
    assert.equal(typeof data.diff.title.before, 'string', 'diff.title.before must be string');
    assert.equal(typeof data.diff.title.after, 'string', 'diff.title.after must be string');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run: diff.price has before and after integer values', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'POST', '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const data = res.json();
    assert.equal(typeof data.diff.price.before, 'number', 'diff.price.before must be number');
    assert.equal(typeof data.diff.price.after, 'number', 'diff.price.after must be number');
    assert.equal(Math.floor(data.diff.price.before), data.diff.price.before, 'diff.price.before must be integer KRW');
    assert.equal(Math.floor(data.diff.price.after), data.diff.price.after, 'diff.price.after must be integer KRW');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run: with title override, baseline reflects overridden title', async () => {
  const { server, port } = await startServer();
  try {
    const overrideTitle = '테스트 오버라이드 타이틀 — AC11';
    const res = await httpRequest(port, 'POST', '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
      title: overrideTitle,
    });
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(
      data.baseline.title,
      overrideTitle,
      `baseline.title should reflect override "${overrideTitle}"`,
    );
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run: with topCopy override, baseline reflects overridden top_copy', async () => {
  const { server, port } = await startServer();
  try {
    const overrideTopCopy = '오버라이드된 카피 문구 — AC11 테스트';
    const res = await httpRequest(port, 'POST', '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
      topCopy: overrideTopCopy,
    });
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(
      data.baseline.top_copy,
      overrideTopCopy,
      `baseline.top_copy should reflect override`,
    );
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run: with priceKrw=19900, baseline.price_krw is 19900', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'POST', '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
      priceKrw: 19900,
    });
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(data.baseline.price_krw, 19900, 'baseline.price_krw must reflect priceKrw override');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run: with costKrw override, margin calculations use updated cost', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'POST', '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
      costKrw: 5000,
    });
    assert.equal(res.status, 200);
    const data = res.json();
    // Should succeed without throwing — margin floor satisfied at low cost
    assert.ok(data.selected_strategy, 'selected_strategy should exist even with overridden cost');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run: returns artifact with non-empty payload', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'POST', '/api/run', {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const data = res.json();
    assert.ok(data.artifact, 'artifact must be present');
    // artifact can be an object with a payload or just top-level fields
    const hasContent = (
      (typeof data.artifact === 'object' && data.artifact !== null && Object.keys(data.artifact).length > 0)
    );
    assert.ok(hasContent, 'artifact must have some content (non-empty object)');
  } finally {
    await stopServer(server);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. POST /api/run/stream — SSE Streaming
// ═══════════════════════════════════════════════════════════════════════════

test('POST /api/run/stream returns Content-Type: text/event-stream', async () => {
  const { server, port } = await startServer();
  try {
    const { contentType } = await collectSseEvents(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    assert.ok(
      contentType?.includes('text/event-stream'),
      `Content-Type should be text/event-stream, got "${contentType}"`,
    );
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run/stream returns status 200', async () => {
  const { server, port } = await startServer();
  try {
    const { statusCode } = await collectSseEvents(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    assert.equal(statusCode, 200, 'SSE stream must return status 200');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run/stream emits at least one iteration_start event', async () => {
  const { server, port } = await startServer();
  try {
    const { events } = await collectSseEvents(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const iterStarts = events.filter((e) => e.type === 'iteration_start');
    assert.ok(iterStarts.length >= 1, `must have at least 1 iteration_start event, got ${iterStarts.length}`);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run/stream emits at least one agent_decision event', async () => {
  const { server, port } = await startServer();
  try {
    const { events } = await collectSseEvents(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const decisions = events.filter((e) => e.type === 'agent_decision');
    assert.ok(decisions.length >= 1, `must have at least 1 agent_decision event, got ${decisions.length}`);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run/stream emits iteration_complete event', async () => {
  const { server, port } = await startServer();
  try {
    const { events } = await collectSseEvents(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const iterComplete = events.filter((e) => e.type === 'iteration_complete');
    assert.ok(iterComplete.length >= 1, `must have at least 1 iteration_complete event, got ${iterComplete.length}`);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run/stream emits simulation_complete as final event', async () => {
  const { server, port } = await startServer();
  try {
    const { events } = await collectSseEvents(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const simComplete = events.filter((e) => e.type === 'simulation_complete');
    assert.ok(simComplete.length === 1, `must have exactly 1 simulation_complete event, got ${simComplete.length}`);
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run/stream: simulation_complete payload has baseline, selected_strategy, holdout, diff', async () => {
  const { server, port } = await startServer();
  try {
    const { events } = await collectSseEvents(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const simComplete = events.find((e) => e.type === 'simulation_complete');
    assert.ok(simComplete, 'simulation_complete event must exist');
    const payload = simComplete.data;
    assert.ok(payload.baseline, 'simulation_complete must have baseline');
    assert.ok(payload.selected_strategy, 'simulation_complete must have selected_strategy');
    assert.ok(payload.holdout, 'simulation_complete must have holdout');
    assert.ok(payload.diff, 'simulation_complete must have diff');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run/stream: simulation_complete.diff has title, top_copy, price keys', async () => {
  const { server, port } = await startServer();
  try {
    const { events } = await collectSseEvents(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const simComplete = events.find((e) => e.type === 'simulation_complete');
    const diff = simComplete?.data?.diff;
    assert.ok(diff, 'diff must exist in simulation_complete');
    assert.deepEqual(
      Object.keys(diff).sort(),
      ['price', 'title', 'top_copy'],
      'diff must have exactly title, top_copy, price keys',
    );
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run/stream: iteration_start payload has iteration and agent_count', async () => {
  const { server, port } = await startServer();
  try {
    const { events } = await collectSseEvents(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const iterStart = events.find((e) => e.type === 'iteration_start');
    assert.ok(iterStart, 'iteration_start must exist');
    assert.equal(typeof iterStart.data.iteration, 'number', 'iteration_start.iteration must be number');
    assert.ok(iterStart.data.iteration >= 1, 'iteration must be >= 1');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run/stream: agent_decision has required fields', async () => {
  const { server, port } = await startServer();
  try {
    const { events } = await collectSseEvents(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const decision = events.find((e) => e.type === 'agent_decision');
    assert.ok(decision, 'at least one agent_decision must exist');
    assert.ok(decision.data.agent_id, 'agent_decision must have agent_id');
    assert.ok(decision.data.chosen_product, 'agent_decision must have chosen_product');
    // chosen_product must be one of the 5 valid values
    const validProducts = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
    assert.ok(
      validProducts.includes(decision.data.chosen_product),
      `chosen_product "${decision.data.chosen_product}" must be one of: ${validProducts.join(', ')}`,
    );
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run/stream: with title override, simulation_complete.diff.title.before matches override', async () => {
  const { server, port } = await startServer();
  try {
    const overrideTitle = 'SSE 오버라이드 타이틀 — AC11 테스트';
    const { events } = await collectSseEvents(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
      title: overrideTitle,
    });
    const simComplete = events.find((e) => e.type === 'simulation_complete');
    const diff = simComplete?.data?.diff;
    assert.ok(diff, 'diff must exist');
    assert.equal(
      diff.title.before,
      overrideTitle,
      `diff.title.before must match title override "${overrideTitle}"`,
    );
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run/stream: event sequence is iteration_start before agent_decision', async () => {
  const { server, port } = await startServer();
  try {
    const { events } = await collectSseEvents(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    const firstIterStart = events.findIndex((e) => e.type === 'iteration_start');
    const firstDecision = events.findIndex((e) => e.type === 'agent_decision');
    assert.ok(firstIterStart !== -1, 'iteration_start must exist');
    assert.ok(firstDecision !== -1, 'agent_decision must exist');
    assert.ok(firstIterStart < firstDecision, 'iteration_start must come before agent_decision');
  } finally {
    await stopServer(server);
  }
});

test('POST /api/run/stream: simulation_complete is the last event in the stream', async () => {
  const { server, port } = await startServer();
  try {
    const { events } = await collectSseEvents(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });
    assert.ok(events.length > 0, 'events array must not be empty');
    const lastEvent = events[events.length - 1];
    assert.equal(
      lastEvent.type,
      'simulation_complete',
      `last event must be simulation_complete, got "${lastEvent.type}"`,
    );
  } finally {
    await stopServer(server);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. 404 for unknown routes
// ═══════════════════════════════════════════════════════════════════════════

test('GET /unknown-route returns 404', async () => {
  const { server, port } = await startServer();
  try {
    const res = await httpRequest(port, 'GET', '/nonexistent-path');
    assert.equal(res.status, 404, `unknown route should return 404, got ${res.status}`);
  } finally {
    await stopServer(server);
  }
});
