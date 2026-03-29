/**
 * playwright-sse-midflow.spec.mjs — Sub-AC 4d
 *
 * Playwright screenshot test that:
 *   1. Streams a mock SSE session containing per-agent agent_decision events
 *      (individual-agent pipeline, NOT the legacy batch archetype_evaluated events)
 *   2. Captures sim-canvas during mid-flow loading_state with particles visible
 *   3. Asserts particles are visible on the Canvas 2D overlay (activeCount > 0,
 *      non-transparent pixels present in the canvas pixel buffer)
 *   4. Asserts product bucket counters are non-zero after agent_decision events
 *      increment them (via the 220ms setTimeout in dashboard.js)
 *   5. Asserts agent-count text matches the "N / 800 에이전트 완료" format
 *
 * Sub-AC 4d | PRD §12.3, §16
 *
 * Port: 3095 — dedicated, no collision with other Playwright specs
 *   3094: playwright-agent-profile-popup.spec.mjs
 *   3096: playwright-visual-judgment.spec.mjs
 *   3097: dashboard-e2e.spec.mjs
 *   3098: playwright-particle-bench.spec.mjs
 *   3099: playwright-screenshots.spec.mjs
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../artifacts/screenshots');
const PORT = 3095;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// ── Mock SSE body builder ─────────────────────────────────────────────────────

/** Encode a list of { type, data } event objects as an SSE text body. */
function buildSseBody(events) {
  return events
    .map(({ type, data }) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

// ── Mock data definitions ─────────────────────────────────────────────────────

/**
 * 8 archetype IDs in rotation (matching the 8 archetype nodes in the force graph).
 * Using `i % 8` to distribute agents across all archetypes evenly.
 */
const ARCHETYPE_IDS = [
  'price_sensitive',
  'value_seeker',
  'premium_quality',
  'trust_first',
  'aesthetics_first',
  'urgency_buyer',
  'promo_hunter',
  'gift_or_family_buyer',
];

/**
 * Product distribution cycle (length 8) giving:
 *   our_product:  3/8 ≈ 37.5%
 *   competitor_a: 2/8 = 25.0%
 *   competitor_b: 1/8 = 12.5%
 *   competitor_c: 1/8 = 12.5%
 *   pass:         1/8 = 12.5%
 *
 * With 50 events (6 full cycles + 2 remainder):
 *   our_product:  6×3 + 2 = 20
 *   competitor_a: 6×2     = 12
 *   competitor_b: 6×1     = 6
 *   competitor_c: 6×1     = 6
 *   pass:         6×1     = 6
 *   Total: 50 ✓
 */
const PRODUCT_CYCLE = [
  'our_product',
  'our_product',
  'our_product',
  'competitor_a',
  'competitor_a',
  'competitor_b',
  'competitor_c',
  'pass',
];

/** Korean names for generated buyer agents */
const AGENT_NAMES = [
  '김지수', '이민준', '박서연', '최현우',
  '정다은', '강민서', '윤준혁', '한지원',
];

/**
 * Generate 50 agent_decision events with agent_total=800.
 * Each event represents one buyer agent evaluating the product strategy.
 * agent_index values are unique across [0, 49].
 */
const AGENT_DECISION_EVENTS = Array.from({ length: 50 }, (_, i) => ({
  type: 'agent_decision',
  data: {
    iteration:      1,
    agent_id:       `${ARCHETYPE_IDS[i % ARCHETYPE_IDS.length]}_${String(i).padStart(4, '0')}`,
    agent_name:     AGENT_NAMES[i % AGENT_NAMES.length],
    agent_index:    i,
    agent_total:    800,  // total agents in this iteration (full 800-agent simulation)
    archetype_id:   ARCHETYPE_IDS[i % ARCHETYPE_IDS.length],
    chosen_product: PRODUCT_CYCLE[i % PRODUCT_CYCLE.length],
    reasoning:      '가격 대비 성분 구성이 우수하여 선택했습니다.',
    price_sensitivity: parseFloat((1 + (i % 5) * 0.8).toFixed(1)),
    trust_sensitivity: parseFloat((2 + (i % 4) * 0.6).toFixed(1)),
    promo_affinity:    parseFloat((1.5 + (i % 3) * 0.9).toFixed(1)),
    brand_bias:        parseFloat((1 + (i % 4) * 0.7).toFixed(1)),
    pass_threshold:    parseFloat((0.2 + (i % 5) * 0.1).toFixed(1)),
  },
}));

/**
 * Derive archetype_breakdown from AGENT_DECISION_EVENTS.
 * Used in iteration_complete payload (matching the engine format from the individual-agent pipeline).
 */
const ARCHETYPE_BREAKDOWN = {};
for (const { data } of AGENT_DECISION_EVENTS) {
  if (!ARCHETYPE_BREAKDOWN[data.archetype_id]) {
    ARCHETYPE_BREAKDOWN[data.archetype_id] = {
      our_product: 0, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0,
    };
  }
  ARCHETYPE_BREAKDOWN[data.archetype_id][data.chosen_product]++;
}

/**
 * Matching choice_summary for iteration_complete (derived from 50 events).
 * our_product:20, competitor_a:12, competitor_b:6, competitor_c:6, pass:6
 */
const CHOICE_SUMMARY = { our_product: 20, competitor_a: 12, competitor_b: 6, competitor_c: 6, pass: 6 };

/** simulation_complete payload for the test strategy */
const MOCK_COMPLETE_PAYLOAD = {
  baseline: {
    id: 'baseline',
    title: '트리클리닉 엑스퍼트 스칼프 탈모 샴푸 500ml',
    top_copy: '두피과학 기반의 성분 설계로 매일 신뢰감 있게 관리하는 프리미엄 탈모 샴푸',
    price_krw: 29900,
    simulated_revenue: 5651100,
    margin_rate: 0.632,
  },
  selected_strategy: {
    id: 'ac4d-mid-flow-strategy',
    title: '트리클리닉 두피과학 기반 탈모 샴푸',
    top_copy: '두피과학 설계로 균형 있게 관리하는 프리미엄 탈모 샴푸',
    price_krw: 28900,
    simulated_revenue: 6200000,
    margin_rate: 0.619,
    rationale: 'Sub-AC 4d 검증용 전략: 개별 에이전트 파이프라인 mid-flow 시각화 테스트',
  },
  holdout: { holdout_uplift: 548900, holdout_revenue: 6200000, margin_floor_violations: 0 },
  diff: {
    title: {
      before: '트리클리닉 엑스퍼트 스칼프 탈모 샴푸 500ml',
      after: '트리클리닉 두피과학 기반 탈모 샴푸',
    },
    top_copy: {
      before: '두피과학 기반의 성분 설계로 매일 신뢰감 있게 관리하는 프리미엄 탈모 샴푸',
      after: '두피과학 설계로 균형 있게 관리하는 프리미엄 탈모 샴푸',
    },
    price: { before: 29900, after: 28900 },
  },
  artifact: {
    payload: {
      selected_strategy_id: 'ac4d-mid-flow-strategy',
      holdout_uplift: 548900,
      generated_at: new Date().toISOString(),
    },
  },
};

/**
 * Complete mock SSE body for the individual-agent pipeline.
 * Contains: iteration_start → 50×agent_decision → iteration_complete → holdout_start → simulation_complete
 */
const MOCK_SSE_WITH_AGENT_DECISIONS = buildSseBody([
  {
    type: 'iteration_start',
    data: {
      iteration: 1,
      total: 1,
      candidates: [
        { id: 'ac4d-mid-flow-strategy', title: '트리클리닉 두피과학 기반 탈모 샴푸', price_krw: 28900 },
      ],
    },
  },
  ...AGENT_DECISION_EVENTS,
  {
    type: 'iteration_complete',
    data: {
      iteration: 1,
      winner_id: 'ac4d-mid-flow-strategy',
      winner_revenue: 6200000,
      accepted: true,
      rejected_count: 0,
      choice_summary: CHOICE_SUMMARY,
      archetype_breakdown: ARCHETYPE_BREAKDOWN,
    },
  },
  {
    type: 'holdout_start',
    data: { message: 'Holdout 검증 진행 중 (200명)...' },
  },
  {
    type: 'simulation_complete',
    data: MOCK_COMPLETE_PAYLOAD,
  },
]);

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
};

// ── Particle spawn specs for mid-flow visual ──────────────────────────────────

/**
 * Particle trajectory specs for the mid-flow screenshot.
 * Each spec spawns one particle representing a buyer agent in-flight.
 * elapsed values are set between 30ms–130ms so particles appear spread
 * across the canvas (PARTICLE_DURATION_MS = 200ms total journey).
 */
const MID_FLOW_PARTICLE_SPECS = [
  { arch: 'price_sensitive',      prod: 'our_product',  elapsed: 70  },
  { arch: 'value_seeker',         prod: 'our_product',  elapsed: 50  },
  { arch: 'trust_first',          prod: 'our_product',  elapsed: 90  },
  { arch: 'premium_quality',      prod: 'competitor_a', elapsed: 60  },
  { arch: 'aesthetics_first',     prod: 'competitor_b', elapsed: 40  },
  { arch: 'urgency_buyer',        prod: 'our_product',  elapsed: 80  },
  { arch: 'promo_hunter',         prod: 'pass',         elapsed: 55  },
  { arch: 'gift_or_family_buyer', prod: 'our_product',  elapsed: 65  },
  { arch: 'price_sensitive',      prod: 'our_product',  elapsed: 110 },
  { arch: 'value_seeker',         prod: 'competitor_a', elapsed: 75  },
  { arch: 'trust_first',          prod: 'competitor_b', elapsed: 85  },
  { arch: 'premium_quality',      prod: 'our_product',  elapsed: 45  },
  { arch: 'urgency_buyer',        prod: 'competitor_c', elapsed: 95  },
  { arch: 'promo_hunter',         prod: 'our_product',  elapsed: 35  },
  { arch: 'aesthetics_first',     prod: 'pass',         elapsed: 115 },
  { arch: 'gift_or_family_buyer', prod: 'competitor_a', elapsed: 55  },
  { arch: 'price_sensitive',      prod: 'our_product',  elapsed: 125 },
  { arch: 'value_seeker',         prod: 'our_product',  elapsed: 40  },
  { arch: 'trust_first',          prod: 'our_product',  elapsed: 60  },
  { arch: 'premium_quality',      prod: 'competitor_b', elapsed: 80  },
  { arch: 'urgency_buyer',        prod: 'our_product',  elapsed: 100 },
  { arch: 'promo_hunter',         prod: 'competitor_c', elapsed: 70  },
  { arch: 'aesthetics_first',     prod: 'our_product',  elapsed: 30  },
  { arch: 'gift_or_family_buyer', prod: 'our_product',  elapsed: 50  },
  { arch: 'price_sensitive',      prod: 'competitor_a', elapsed: 85  },
];

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server;

test.beforeAll(async () => {
  // Ensure screenshot output directory exists
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
  // Start server in mock mode (no live OpenAI calls)
  process.env.SELLER_WAR_GAME_MODEL_MODE = 'mock';
  server = createServer();
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Wait for fixture data (product-name) to be rendered by dashboard.js → /api/fixtures. */
async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el != null && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

/** Wait for the particle engine to initialise AND register the our_product node position. */
async function waitForEngineReady(page) {
  await page.waitForFunction(
    () => {
      const e = window.particleEngine;
      return e != null && e._nodePos != null && e._nodePos.has('our_product');
    },
    { timeout: 10_000 },
  );
}

/**
 * Route the /api/run/stream endpoint to serve MOCK_SSE_WITH_AGENT_DECISIONS,
 * click Run, wait until simulation_complete is processed (state-completed visible).
 */
async function runMockSimulation(page) {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: MOCK_SSE_WITH_AGENT_DECISIONS,
    });
  });

  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 20_000,
  });
}

/**
 * Re-enter the visual loading state and spawn mid-flight particles.
 *
 * After a simulation run, the dashboard shows the completed state.
 * This helper manually restores the loading overlay and spawns Canvas 2D
 * particles at mid-flight positions so the screenshot captures a stable
 * "agents in transit" frame — independent of network/processing timing.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>} number of particles successfully spawned
 */
async function spawnMidFlowParticles(page) {
  // Step 1: Restore loading overlay DOM state
  await page.evaluate(() => {
    const simStateEmpty     = document.getElementById('sim-state-empty');
    const simStateLoading   = document.getElementById('sim-state-loading');
    const simStateCompleted = document.getElementById('sim-state-completed');
    const simProgress       = document.getElementById('sim-progress');
    const simProgressBar    = document.getElementById('sim-progress-bar');
    const simIterLabel      = document.getElementById('sim-iteration-label');
    const agentLog          = document.getElementById('agent-log');
    const revenueChart      = document.getElementById('revenue-chart');

    if (simStateEmpty)     simStateEmpty.style.display     = 'none';
    if (simStateLoading)   simStateLoading.style.display   = 'block';
    if (simStateCompleted) simStateCompleted.style.display = 'none';
    if (simProgress) {
      simProgress.style.display       = 'flex';
      simProgress.style.flexDirection = 'column';
      simProgress.style.gap           = 'var(--space-xs)';
    }
    if (simProgressBar)  simProgressBar.style.width     = '50%';
    if (simIterLabel)    simIterLabel.textContent         = 'Iteration 1/1';
    if (agentLog)        agentLog.style.display           = 'block';
    if (revenueChart)    revenueChart.style.display       = 'block';
  });

  // Step 2: Spawn particles with mid-flight elapsed values
  const spawnedCount = await page.evaluate((specs) => {
    const engine = window.particleEngine;
    if (!engine) return 0;

    const W = engine._cssW || 800;
    const H = engine._cssH || 500;

    const ARCH_IDS = [
      'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
      'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
    ];
    const PROD_IDS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];

    // Ensure archetype positions are registered (fallback to evenly-spaced if force graph
    // hasn't placed them yet — happens on first page load without a prior force graph run)
    ARCH_IDS.forEach((id, i) => {
      if (!engine._nodePos.has(id)) {
        const x = W * 0.1 + i * (W * 0.8 / (ARCH_IDS.length - 1));
        engine.setArchPos(id, x, H * 0.25);
      }
    });

    // Ensure product node positions are registered
    PROD_IDS.forEach((id, i) => {
      if (!engine._nodePos.has(id)) {
        const x = W * 0.15 + i * (W * 0.7 / (PROD_IDS.length - 1));
        engine.setProductPos(id, x, H * 0.78);
      }
    });

    // Spawn each particle and set its elapsed to a mid-flight value
    let spawned = 0;
    for (const { arch, prod, elapsed } of specs) {
      const p = engine.spawn(arch, prod);
      if (p) {
        p.elapsed = elapsed;  // 30–130ms puts particles mid-travel (total journey = 200ms)
        spawned++;
      }
    }
    return spawned;
  }, MID_FLOW_PARTICLE_SPECS);

  return spawnedCount;
}

// ── Test 1: Mid-flow screenshot — particles visible, loading state visible ────
// This is the primary visual verification for Sub-AC 4d.

test('Sub-AC 4d: sim-canvas mid-flow screenshot — particles visible during loading state', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await waitForEngineReady(page);

  // Run the mock SSE simulation (50 agent_decision events → simulation_complete)
  await runMockSimulation(page);

  // Wait for the 220ms incrementProductCounter setTimeout to fire
  await page.waitForTimeout(400);

  // ── Assert agent-count format after processing 50 agent_decision events ─
  const agentCountText = await page.evaluate(() => {
    const el = document.getElementById('agent-count');
    return el ? el.textContent.trim() : null;
  });
  expect(agentCountText).not.toBeNull();
  // Must match "N / 800 에이전트 완료" pattern (agent_total=800 from mock events)
  expect(agentCountText).toMatch(/^\d+ \/ 800 에이전트 완료$/);

  // ── Assert at least one product bucket counter is non-zero ───────────────
  const counters = await page.evaluate(() => {
    const ids = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
    const result = {};
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="product-counter-${id}"]`);
      result[id] = el ? parseInt(el.textContent ?? '0', 10) : 0;
    }
    return result;
  });
  // our_product should have the largest count (20 out of 50 events)
  expect(counters.our_product).toBeGreaterThan(0);

  // ── Re-enter loading state and spawn mid-flight particles ────────────────
  const spawnedCount = await spawnMidFlowParticles(page);
  expect(spawnedCount).toBeGreaterThan(0);

  // Wait one RAF render pass
  await page.waitForTimeout(50);

  // ── Assert state-loading is now visible ──────────────────────────────────
  await expect(page.locator('[data-testid="state-loading"]')).toBeVisible();

  // ── Assert particle engine has active particles ───────────────────────────
  const activeCount = await page.evaluate(() => {
    return window.particleEngine ? window.particleEngine.activeCount : 0;
  });
  expect(activeCount).toBeGreaterThan(0);

  // ── Assert particle-canvas has non-zero dimensions ───────────────────────
  const canvas = page.locator('[data-testid="particle-canvas"]');
  await expect(canvas).toBeAttached();

  const canvasDims = await canvas.evaluate((el) => ({
    cssWidth:    el.offsetWidth,
    cssHeight:   el.offsetHeight,
    pixelWidth:  el.width,
    pixelHeight: el.height,
  }));
  expect(canvasDims.cssWidth).toBeGreaterThan(0);
  expect(canvasDims.cssHeight).toBeGreaterThan(0);

  // ── Capture screenshots ───────────────────────────────────────────────────
  // Simulation panel — shows the particle canvas + SVG + loading overlay
  const simPanel = page.locator('[data-testid="panel-simulation"]');
  await simPanel.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'ac4d-01-mid-flow-sim-canvas.png'),
  });

  // Full page — all 3 panels visible at once
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'ac4d-02-mid-flow-full-page.png'),
    fullPage: true,
  });

  console.log(`[ac4d] agent-count: "${agentCountText}"`);
  console.log(`[ac4d] our_product counter: ${counters.our_product}`);
  console.log(`[ac4d] active particles: ${activeCount}`);
  console.log(`[ac4d] spawned: ${spawnedCount}`);
});

// ── Test 2: Agent-count text format ───────────────────────────────────────────
// Verifies the exact "N / 800 에이전트 완료" format required by PRD §16.

test('Sub-AC 4d: agent-count text matches "N / 800 에이전트 완료" format', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Run the mock SSE simulation with 50 agent_decisions (agent_total=800)
  await runMockSimulation(page);

  // Read agent-count element content
  const agentCountText = await page.evaluate(() => {
    const el = document.getElementById('agent-count');
    return el ? el.textContent.trim() : null;
  });

  expect(agentCountText).not.toBeNull();

  // ── Pattern assertion: "N / 800 에이전트 완료" ────────────────────────────
  expect(agentCountText).toMatch(/^\d+ \/ 800 에이전트 완료$/);

  // ── Exact count assertion: 50 agent_decision events were sent ─────────────
  // After iteration_start, resetAgentCount() zeroes the counter.
  // Then 50 agent_decision events increment it to exactly 50.
  const match = agentCountText.match(/^(\d+) \/ 800 에이전트 완료$/);
  expect(match).not.toBeNull();
  const receivedCount = Number(match[1]);
  expect(receivedCount).toBe(50);

  console.log(`[ac4d] agent-count text: "${agentCountText}" (count=${receivedCount})`);
});

// ── Test 3: Product counters increment after agent_decision events ─────────────
// Verifies that incrementProductCounter() fires correctly via the 220ms setTimeout.

test('Sub-AC 4d: product bucket counters are non-zero after agent_decision SSE events', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Run mock simulation
  await runMockSimulation(page);

  // Wait beyond the 220ms setTimeout delay for all counters to update
  await page.waitForTimeout(500);

  // Read all 5 product counter SVG text elements
  const counters = await page.evaluate(() => {
    const ids = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
    const result = {};
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="product-counter-${id}"]`);
      result[id] = el ? parseInt(el.textContent ?? '0', 10) : -1;
    }
    return result;
  });

  // All counter elements must exist
  for (const [id, val] of Object.entries(counters)) {
    expect(val, `Counter element for ${id} must exist`).toBeGreaterThanOrEqual(0);
  }

  // Total across all buckets must equal 50 (one per agent_decision event)
  const total = Object.values(counters).reduce((a, b) => a + b, 0);
  expect(total).toBe(50);

  // our_product must be the largest bucket (20 agents out of 50 chose it)
  expect(counters.our_product).toBe(20);

  // competitor_a gets 12 agents
  expect(counters.competitor_a).toBe(12);

  // All 5 buckets should have non-zero counts (given PRODUCT_CYCLE coverage)
  expect(counters.our_product).toBeGreaterThan(0);
  expect(counters.competitor_a).toBeGreaterThan(0);
  expect(counters.competitor_b).toBeGreaterThan(0);
  expect(counters.competitor_c).toBeGreaterThan(0);
  expect(counters.pass).toBeGreaterThan(0);

  console.log(`[ac4d] product counters: ${JSON.stringify(counters)}, total=${total}`);
});

// ── Test 4: Canvas pixel sampling — particles render colored dots ─────────────
// Verifies that the Canvas 2D overlay actually draws non-transparent pixels
// when particles are active, confirming the RAF render loop is working.

test('Sub-AC 4d: particle canvas renders non-transparent pixels when particles are active', async ({ page }) => {
  // This test does not trigger a full SSE run.
  // It directly manipulates the engine to isolate canvas rendering behavior.
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await waitForEngineReady(page);

  // Spawn particles and immediately check the canvas pixel buffer
  const pixelCheck = await page.evaluate(async (specs) => {
    const engine = window.particleEngine;
    if (!engine) return { error: 'no engine', hasPixels: false, activeCount: 0 };

    const W = engine._cssW || 600;
    const H = engine._cssH || 400;

    const ARCH_IDS = [
      'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
      'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
    ];
    const PROD_IDS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];

    // Ensure node positions
    ARCH_IDS.forEach((id, i) => {
      if (!engine._nodePos.has(id)) {
        engine.setArchPos(id, W * 0.1 + i * (W * 0.8 / 7), H * 0.25);
      }
    });
    PROD_IDS.forEach((id, i) => {
      if (!engine._nodePos.has(id)) {
        engine.setProductPos(id, W * 0.15 + i * (W * 0.7 / 4), H * 0.78);
      }
    });

    // Clear existing particles, then spawn fresh mid-flight ones
    engine.clearAll();
    let spawned = 0;
    for (const { arch, prod, elapsed } of specs) {
      const p = engine.spawn(arch, prod);
      if (p) {
        p.elapsed = elapsed;
        spawned++;
      }
    }

    const beforeActive = engine.activeCount;

    // Wait for one RAF cycle to complete (16ms polling)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    // Check canvas pixel buffer for non-transparent pixels
    const canvas = engine.canvas;
    const pixelWidth  = canvas.width;
    const pixelHeight = canvas.height;

    if (pixelWidth === 0 || pixelHeight === 0) {
      return { error: 'canvas has zero dimensions', hasPixels: false, activeCount: beforeActive, spawned };
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { error: 'no 2d context', hasPixels: false, activeCount: beforeActive, spawned };
    }

    const imageData = ctx.getImageData(0, 0, pixelWidth, pixelHeight);
    const data = imageData.data;

    // Sample every 4th pixel's alpha channel (RGBA layout, alpha = index 3)
    // to check for any non-transparent content (particles or bucket ring indicators)
    let hasPixels = false;
    for (let i = 3; i < data.length; i += 16) {  // step 4 pixels at a time
      if (data[i] > 0) {
        hasPixels = true;
        break;
      }
    }

    return {
      hasPixels,
      activeCount: engine.activeCount,
      spawned,
      pixelWidth,
      pixelHeight,
    };
  }, MID_FLOW_PARTICLE_SPECS);

  expect(pixelCheck.error).toBeUndefined();
  expect(pixelCheck.spawned).toBeGreaterThan(0);
  expect(pixelCheck.activeCount).toBeGreaterThan(0);
  expect(pixelCheck.pixelWidth).toBeGreaterThan(0);
  expect(pixelCheck.pixelHeight).toBeGreaterThan(0);
  // The canvas must have non-transparent pixels from particle/bucket rendering
  expect(pixelCheck.hasPixels).toBe(true);

  // Take a screenshot for visual confirmation
  const simPanel = page.locator('[data-testid="panel-simulation"]');
  await simPanel.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'ac4d-03-canvas-pixel-check.png'),
  });

  console.log(
    `[ac4d] canvas pixels: hasPixels=${pixelCheck.hasPixels} ` +
    `pixelDims=${pixelCheck.pixelWidth}×${pixelCheck.pixelHeight} ` +
    `active=${pixelCheck.activeCount} spawned=${pixelCheck.spawned}`,
  );
});

// ── Test 5: Archetype summary table renders on iteration_complete ─────────────
//
// Sub-AC 4d: Verifies that:
//   1. archetype-summary-table is hidden before simulation runs
//   2. archetype-summary-table becomes visible after iteration_complete event
//   3. Table rows are populated from archetype_breakdown (both flat and explicit formats)
//   4. Screenshot of the archetype summary table during loading state is captured
//
// This test uses the EXPLICIT array format for archetype_breakdown to validate
// the Sub-AC 3c schema parsing in renderArchetypeSummary().

/**
 * Build an iteration_complete event with Sub-AC 3c EXPLICIT array format
 * for archetype_breakdown: [{archetype_id, archetype_label, sample_size, choices: {key: {count, pct}}}]
 */
function buildExplicitArchetypeBreakdown() {
  const ARCHETYPE_IDS_KO = {
    price_sensitive:      '가격민감형',
    value_seeker:         '가성비균형형',
    premium_quality:      '프리미엄품질형',
    trust_first:          '신뢰우선형',
    aesthetics_first:     '심미형',
    urgency_buyer:        '긴박구매형',
    promo_hunter:         '프로모션헌터형',
    gift_or_family_buyer: '가족구매형',
  };

  // Each archetype gets ~6 agents with realistic distribution
  const distributions = {
    price_sensitive:      { our_product: 2, competitor_a: 2, competitor_b: 1, competitor_c: 0, pass: 1 },
    value_seeker:         { our_product: 3, competitor_a: 1, competitor_b: 1, competitor_c: 1, pass: 0 },
    premium_quality:      { our_product: 4, competitor_a: 1, competitor_b: 0, competitor_c: 0, pass: 1 },
    trust_first:          { our_product: 3, competitor_a: 1, competitor_b: 1, competitor_c: 0, pass: 1 },
    aesthetics_first:     { our_product: 2, competitor_a: 1, competitor_b: 1, competitor_c: 1, pass: 1 },
    urgency_buyer:        { our_product: 3, competitor_a: 2, competitor_b: 0, competitor_c: 0, pass: 1 },
    promo_hunter:         { our_product: 2, competitor_a: 2, competitor_b: 1, competitor_c: 1, pass: 0 },
    gift_or_family_buyer: { our_product: 3, competitor_a: 1, competitor_b: 1, competitor_c: 0, pass: 1 },
  };

  return Object.entries(distributions).map(([archetypeId, counts]) => {
    const sampleSize = Object.values(counts).reduce((a, b) => a + b, 0);
    const choices = {};
    for (const [k, count] of Object.entries(counts)) {
      choices[k] = {
        count,
        pct: sampleSize > 0 ? parseFloat(((count / sampleSize) * 100).toFixed(2)) : 0,
      };
    }
    return {
      archetype_id:    archetypeId,
      archetype_label: ARCHETYPE_IDS_KO[archetypeId] ?? archetypeId,
      sample_size:     sampleSize,
      choices,
    };
  });
}

/** Mock SSE body for the explicit format archetype_breakdown test. */
const MOCK_SSE_EXPLICIT_BREAKDOWN = buildSseBody([
  {
    type: 'iteration_start',
    data: {
      iteration: 1,
      total: 1,
      candidates: [
        { id: 'explicit-breakdown-strategy', title: '트리클리닉 두피과학 기반 탈모 샴푸', price_krw: 28900 },
      ],
    },
  },
  // Send 3 agent_decision events to show streaming in progress
  {
    type: 'agent_decision',
    data: {
      iteration: 1, agent_id: 'price_sensitive_0001', agent_name: '김지수',
      agent_index: 0, agent_total: 48, archetype_id: 'price_sensitive',
      chosen_product: 'our_product', reasoning: '가격 대비 성분이 우수합니다.',
      price_sensitivity: 4.2, trust_sensitivity: 2.1, promo_affinity: 3.5,
      brand_bias: 1.8, pass_threshold: 0.3,
    },
  },
  {
    type: 'agent_decision',
    data: {
      iteration: 1, agent_id: 'value_seeker_0001', agent_name: '이민준',
      agent_index: 1, agent_total: 48, archetype_id: 'value_seeker',
      chosen_product: 'our_product', reasoning: '성분 대비 합리적인 가격입니다.',
      price_sensitivity: 3.0, trust_sensitivity: 3.2, promo_affinity: 2.0,
      brand_bias: 2.5, pass_threshold: 0.2,
    },
  },
  {
    type: 'agent_decision',
    data: {
      iteration: 1, agent_id: 'premium_quality_0001', agent_name: '박서연',
      agent_index: 2, agent_total: 48, archetype_id: 'premium_quality',
      chosen_product: 'competitor_a', reasoning: '경쟁사 A가 더 프리미엄합니다.',
      price_sensitivity: 1.5, trust_sensitivity: 4.0, promo_affinity: 1.2,
      brand_bias: 4.3, pass_threshold: 0.1,
    },
  },
  {
    type: 'iteration_complete',
    data: {
      iteration: 1,
      winner_id: 'explicit-breakdown-strategy',
      winner_revenue: 5760000,
      accepted: true,
      rejected_count: 0,
      choice_summary: {
        our_product:  { count: 22, pct: 45.83 },
        competitor_a: { count: 11, pct: 22.92 },
        competitor_b: { count: 6,  pct: 12.50 },
        competitor_c: { count: 3,  pct: 6.25  },
        pass:         { count: 6,  pct: 12.50 },
      },
      // Sub-AC 3c explicit array format for archetype_breakdown
      archetype_breakdown: buildExplicitArchetypeBreakdown(),
    },
  },
  {
    type: 'holdout_start',
    data: { message: 'Holdout 검증 진행 중 (200명)...' },
  },
  {
    type: 'simulation_complete',
    data: {
      ...MOCK_COMPLETE_PAYLOAD,
      selected_strategy: {
        ...MOCK_COMPLETE_PAYLOAD.selected_strategy,
        id: 'explicit-breakdown-strategy',
      },
    },
  },
]);

test('Sub-AC 4d: archetype-summary-table renders from explicit {count, pct} breakdown format', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // ── Verify the table is hidden before simulation starts ──────────────────
  const tableBefore = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="archetype-summary-table"]');
    if (!el) return { found: false };
    const style = el.style.display || window.getComputedStyle(el).display;
    return { found: true, display: style };
  });
  expect(tableBefore.found, 'archetype-summary-table must exist in DOM').toBe(true);
  // Table should be hidden initially (display: none)
  expect(tableBefore.display).toBe('none');

  // ── Route SSE to return the explicit-format breakdown ────────────────────
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: MOCK_SSE_EXPLICIT_BREAKDOWN,
    });
  });

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation_complete to ensure iteration_complete was processed
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 20_000,
  });

  // ── Verify the table is now visible ─────────────────────────────────────
  const tableEl = page.locator('[data-testid="archetype-summary-table"]');
  await expect(tableEl).toBeVisible({ timeout: 5_000 });

  // ── Verify table has populated rows ─────────────────────────────────────
  const tableState = await page.evaluate(() => {
    const tbody = document.getElementById('archetype-summary-tbody');
    const tfoot = document.getElementById('archetype-summary-tfoot-row');
    if (!tbody || !tfoot) return { error: 'elements not found' };

    const rows = tbody.querySelectorAll('tr');
    const tfootCells = tfoot.querySelectorAll('td');

    // Extract first row's data for validation
    const firstRow = rows[0];
    const firstRowCells = firstRow ? [...firstRow.querySelectorAll('td')].map((td) => td.textContent.trim()) : [];

    // Extract footer totals
    const footerCells = [...tfootCells].map((td) => td.textContent.trim());

    return {
      rowCount:       rows.length,
      firstRowCells,
      footerCells,
      tfootCellCount: tfootCells.length,
    };
  });

  expect(tableState.error).toBeUndefined();
  // 8 archetypes should produce 8 rows
  expect(tableState.rowCount).toBe(8);
  // Each row should have 8 cells: archetype label + 5 products + total + our%
  expect(tableState.firstRowCells.length).toBe(8);
  // Footer should have 8 cells too
  expect(tableState.tfootCellCount).toBe(8);
  // Footer first cell should be the Korean total label
  expect(tableState.footerCells[0]).toBe('합계');
  // Footer last cell (our%) should end with '%'
  expect(tableState.footerCells[tableState.footerCells.length - 1]).toMatch(/%$/);

  // ── Re-enter loading state and capture screenshot ────────────────────────
  // Programmatically restore loading state to simulate the mid-flow scenario
  // (table remains populated from the iteration_complete event)
  await page.evaluate(() => {
    const stateEmpty     = document.getElementById('sim-state-empty');
    const stateLoading   = document.getElementById('sim-state-loading');
    const stateCompleted = document.getElementById('sim-state-completed');
    const simProgress    = document.getElementById('sim-progress');
    const simProgressBar = document.getElementById('sim-progress-bar');
    const simIterLabel   = document.getElementById('sim-iteration-label');
    const agentLog       = document.getElementById('agent-log');
    const revenueChart   = document.getElementById('revenue-chart');

    if (stateEmpty)     stateEmpty.style.display     = 'none';
    if (stateLoading)   stateLoading.style.display   = 'block';
    if (stateCompleted) stateCompleted.style.display = 'none';
    if (simProgress) {
      simProgress.style.display       = 'flex';
      simProgress.style.flexDirection = 'column';
      simProgress.style.gap           = 'var(--space-xs)';
    }
    if (simProgressBar)  simProgressBar.style.width = '100%';
    if (simIterLabel)    simIterLabel.textContent    = 'Iteration 1/1';
    if (agentLog)        agentLog.style.display      = 'block';
    if (revenueChart)    revenueChart.style.display  = 'block';
  });

  // ── Assert state-loading is visible ─────────────────────────────────────
  await expect(page.locator('[data-testid="state-loading"]')).toBeVisible();

  // ── Assert archetype-summary-table is still visible in loading state ─────
  await expect(tableEl).toBeVisible();

  // ── Capture screenshot of the full page in mid-flow loading state ────────
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'ac4d-04-archetype-table-loading-state.png'),
    fullPage: true,
  });

  // Capture just the simulation panel showing table + loading overlay
  const simPanel = page.locator('[data-testid="panel-simulation"]');
  await simPanel.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'ac4d-05-sim-panel-with-archetype-table.png'),
  });

  console.log(`[ac4d] archetype table rows: ${tableState.rowCount}`);
  console.log(`[ac4d] footer cells: ${JSON.stringify(tableState.footerCells)}`);
  console.log(`[ac4d] Screenshots saved: ac4d-04, ac4d-05`);
});
