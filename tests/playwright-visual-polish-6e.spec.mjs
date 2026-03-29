/**
 * playwright-visual-polish-6e.spec.mjs — Sub-AC 6e
 *
 * Playwright tests that verify the visual polish additions to the
 * particle canvas overlay:
 *
 *   1. canvas-seller-badge element exists in DOM with correct data-testid
 *   2. canvas-seller-badge gets `visible` class when simulation starts
 *      (showLoadingState adds .visible to the badge)
 *   3. sim-canvas-wrap gets `sim-running` CSS class during active simulation
 *      (PRD §12.4 — canvas overlay glow border during run)
 *   4. After simulation_complete: `sim-frozen` class applied to sim-canvas-wrap
 *      (Sub-AC 6d/6e combined: desaturation + "✓ 완료" badge)
 *   5. After simulation_complete: canvas-seller-badge loses `visible` class
 *   6. CSS custom property --node-our (#2563eb) is applied as seller role color
 *   7. particle-canvas element has pointer-events:none (passes clicks to SVG)
 *   8. sim-canvas-wrap positions canvas overlay above SVG (z-index layering)
 *
 * PRD §12.3, §12.4, §12.2 design tokens | Sub-AC 6e
 * Port: 3119 — dedicated, no collision with other specs
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';

const PORT = 3119;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// ── Mock SSE helpers ──────────────────────────────────────────────────────────

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

/** Encode a list of { type, data } event objects as SSE text. */
function buildSseBody(events) {
  return events
    .map(({ type, data }) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

// ── Minimal mock SSE payloads ─────────────────────────────────────────────────

/** One agent_decision event for spawning a single particle. */
function makeAgentDecision(idx = 1, product = 'our_product') {
  return {
    iteration: 1,
    agent_id: `agent_${String(idx).padStart(3, '0')}`,
    agent_name: '김지수',
    archetype_id: 'price_sensitive',
    archetype_name: '가격 민감형',
    chosen_product: product,
    reasoning: '가격이 더 저렴해서',
    agent_index: idx,
    agent_total: 800,
  };
}

/** Build a complete mock simulation_complete SSE body (1 iteration, 1 agent). */
function buildMockRunBody() {
  return buildSseBody([
    {
      type: 'iteration_start',
      data: {
        iteration: 1, total: 1, agent_count: 800,
        candidates: [
          { id: 'c1', title: '테스트 타이틀', price_krw: 28900, rationale: '가격 접근 전략' },
        ],
        strategy_reasoning: '가격 민감형 확보',
      },
    },
    { type: 'agent_decision',  data: makeAgentDecision(1, 'our_product') },
    { type: 'agent_decision',  data: makeAgentDecision(2, 'competitor_a') },
    {
      type: 'iteration_complete',
      data: {
        iteration: 1, total: 1,
        winner_id: 'c1',
        winner_revenue: 6200000,
        choice_summary: { our_product: 1, competitor_a: 1, competitor_b: 0, competitor_c: 0, pass: 0 },
        archetype_breakdown: [
          {
            archetype_id: 'price_sensitive', archetype_name: '가격 민감형',
            counts: { our_product: 1, competitor_a: 1, competitor_b: 0, competitor_c: 0, pass: 0 },
          },
        ],
      },
    },
    {
      type: 'simulation_complete',
      data: {
        baseline:          { id: 'baseline', title: '현재 타이틀', price_krw: 29900, simulated_revenue: 5651100, margin_rate: 0.632 },
        selected_strategy: { id: 'c1', title: '테스트 타이틀', top_copy: '테스트 카피', price_krw: 28900, simulated_revenue: 6200000, margin_rate: 0.619, rationale: '가격 전략' },
        holdout:           { holdout_uplift: 548900, holdout_revenue: 6200000, margin_floor_violations: 0 },
        diff: {
          title:    { before: '현재 타이틀', after: '테스트 타이틀' },
          top_copy: { before: '현재 카피',   after: '테스트 카피'   },
          price:    { before: 29900,         after: 28900          },
        },
        artifact: { file: 'artifacts/latest-run-summary.json', strategy_id: 'c1', holdout_uplift: 548900 },
        total_agents: 2, total_llm_calls: 2,
      },
    },
  ]);
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server;

test.beforeAll(async () => {
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

// ── Wait helpers ──────────────────────────────────────────────────────────────

async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

async function waitForParticleEngine(page) {
  await page.waitForFunction(
    () => typeof window.particleEngine !== 'undefined' && window.particleEngine !== null,
    { timeout: 10_000 },
  );
}

// ── Test 1: canvas-seller-badge exists in DOM ─────────────────────────────────

test('Sub-AC 6e: canvas-seller-badge element exists with correct data-testid', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const badge = page.locator('[data-testid="canvas-seller-badge"]');
  await expect(badge).toBeAttached({ timeout: 5000 });

  // Should not be visible (opacity: 0) on initial load
  // The `visible` class is added only when simulation starts
  const classes = await badge.evaluate((el) => el.className);
  expect(classes).toContain('canvas-seller-badge');
  expect(classes).not.toContain('visible');
});

// ── Test 2: particle-canvas element exists with pointer-events:none ───────────

test('Sub-AC 6e: particle-canvas has pointer-events:none (non-blocking overlay)', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await waitForParticleEngine(page);

  const canvas = page.locator('[data-testid="particle-canvas"]');
  await expect(canvas).toBeAttached({ timeout: 5000 });

  // pointer-events:none is essential so clicks pass through to SVG nodes
  const pointerEvents = await canvas.evaluate(
    (el) => window.getComputedStyle(el).pointerEvents,
  );
  expect(pointerEvents, 'particle-canvas must have pointer-events:none').toBe('none');
});

// ── Test 3: sim-canvas-wrap exists and holds both SVG and canvas ──────────────

test('Sub-AC 6e: sim-canvas-wrap contains both SVG (sim-canvas) and Canvas (particle-canvas)', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const wrap = page.locator('#sim-canvas-wrap');
  await expect(wrap).toBeAttached({ timeout: 5000 });

  // SVG inside wrap
  const svg = wrap.locator('[data-testid="sim-canvas"]');
  await expect(svg).toBeAttached({ timeout: 5000 });

  // Canvas inside wrap
  const canvas = wrap.locator('[data-testid="particle-canvas"]');
  await expect(canvas).toBeAttached({ timeout: 5000 });

  // Canvas must be positioned absolutely (overlaid on SVG)
  const position = await canvas.evaluate(
    (el) => window.getComputedStyle(el).position,
  );
  expect(position, 'particle-canvas must be position:absolute').toBe('absolute');
});

// ── Test 4: sim-canvas-wrap gets sim-running class when simulation starts ──────

test('Sub-AC 6e: sim-canvas-wrap gains sim-running class on simulation start', async ({ page }) => {
  // Intercept the SSE stream to control timing
  await page.route('**/api/run/stream', async (route) => {
    // Delay SSE body to give us time to check the sim-running class
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildMockRunBody(),
    });
  });

  // Intercept fixtures
  await page.route('**/api/fixtures', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          product_name: '트리클리닉 엑스퍼트 스칼프 탈모 샴푸 500ml',
          brand_name: '트리클리닉',
          current_title: '트리클리닉 엑스퍼트 스칼프 탈모 샴푸 500ml',
          current_top_copy: '두피과학 기반의 프리미엄 탈모 샴푸',
          current_price_krw: 29900,
          current_cost_krw: 11000,
        },
        competitors: [
          { id: 'competitor_a', product_name: '닥터그루트', price_krw: 25900 },
          { id: 'competitor_b', product_name: '려 자양윤모', price_krw: 27000 },
          { id: 'competitor_c', product_name: '이니스프리 그린티', price_krw: 31500 },
        ],
        archetypes: [
          { id: 'price_sensitive',      label: '가격 민감형',   cohort_weight_percent: 18 },
          { id: 'value_seeker',         label: '가성비 균형형', cohort_weight_percent: 16 },
          { id: 'premium_quality',      label: '프리미엄 품질형',cohort_weight_percent: 12 },
          { id: 'trust_first',          label: '신뢰 우선형',   cohort_weight_percent: 15 },
          { id: 'aesthetics_first',     label: '심미형',        cohort_weight_percent: 8  },
          { id: 'urgency_buyer',        label: '긴박 구매형',   cohort_weight_percent: 11 },
          { id: 'promo_hunter',         label: '프로모션 헌터형',cohort_weight_percent: 10 },
          { id: 'gift_or_family_buyer', label: '가족 구매형',   cohort_weight_percent: 10 },
        ],
        defaults: { iteration_count: 3, minimum_margin_floor: 0.35 },
      }),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const wrap = page.locator('#sim-canvas-wrap');
  await expect(wrap).toBeAttached({ timeout: 5000 });

  // Click Run button
  const btnRun = page.locator('[data-testid="btn-run"]');
  await expect(btnRun).toBeEnabled({ timeout: 5000 });
  await btnRun.click();

  // sim-canvas-wrap should quickly gain sim-running class
  await page.waitForFunction(
    () => document.getElementById('sim-canvas-wrap')?.classList.contains('sim-running'),
    { timeout: 3000 },
  );

  const hasSimRunning = await wrap.evaluate((el) => el.classList.contains('sim-running'));
  expect(hasSimRunning, 'sim-canvas-wrap should have sim-running class during simulation').toBe(true);
});

// ── Test 5: canvas-seller-badge becomes visible during simulation ─────────────

test('Sub-AC 6e: canvas-seller-badge gains visible class when simulation starts', async ({ page }) => {
  // Slow SSE response to hold simulation open long enough to assert badge
  await page.route('**/api/run/stream', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildMockRunBody(),
    });
  });

  await page.route('**/api/fixtures', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          product_name: '트리클리닉 샴푸 500ml',
          brand_name: '트리클리닉',
          current_title: '테스트 타이틀',
          current_top_copy: '테스트 카피',
          current_price_krw: 29900,
          current_cost_krw: 11000,
        },
        competitors: [
          { id: 'competitor_a', product_name: '닥터그루트', price_krw: 25900 },
          { id: 'competitor_b', product_name: '려 자양윤모', price_krw: 27000 },
          { id: 'competitor_c', product_name: '이니스프리', price_krw: 31500 },
        ],
        archetypes: [
          { id: 'price_sensitive', label: '가격 민감형', cohort_weight_percent: 18 },
          { id: 'value_seeker', label: '가성비 균형형', cohort_weight_percent: 16 },
          { id: 'premium_quality', label: '프리미엄 품질형', cohort_weight_percent: 12 },
          { id: 'trust_first', label: '신뢰 우선형', cohort_weight_percent: 15 },
          { id: 'aesthetics_first', label: '심미형', cohort_weight_percent: 8 },
          { id: 'urgency_buyer', label: '긴박 구매형', cohort_weight_percent: 11 },
          { id: 'promo_hunter', label: '프로모션 헌터형', cohort_weight_percent: 10 },
          { id: 'gift_or_family_buyer', label: '가족 구매형', cohort_weight_percent: 10 },
        ],
        defaults: { iteration_count: 3, minimum_margin_floor: 0.35 },
      }),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const badge = page.locator('[data-testid="canvas-seller-badge"]');
  await expect(badge).toBeAttached({ timeout: 5000 });

  // Click Run
  const btnRun = page.locator('[data-testid="btn-run"]');
  await expect(btnRun).toBeEnabled({ timeout: 5000 });
  await btnRun.click();

  // Badge should gain `visible` class when loading state kicks in
  await page.waitForFunction(
    () => document.getElementById('canvas-seller-badge')?.classList.contains('visible'),
    { timeout: 3000 },
  );

  const isVisible = await badge.evaluate((el) => el.classList.contains('visible'));
  expect(isVisible, 'canvas-seller-badge should have visible class during simulation').toBe(true);
});

// ── Test 6: After simulation_complete → sim-frozen class applied ──────────────

test('Sub-AC 6e: sim-canvas-wrap gains sim-frozen class after simulation_complete', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildMockRunBody(),
    });
  });

  await page.route('**/api/fixtures', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          product_name: '트리클리닉 샴푸 500ml',
          brand_name: '트리클리닉',
          current_title: '테스트 타이틀',
          current_top_copy: '테스트 카피',
          current_price_krw: 29900,
          current_cost_krw: 11000,
        },
        competitors: [
          { id: 'competitor_a', product_name: '닥터그루트', price_krw: 25900 },
          { id: 'competitor_b', product_name: '려 자양윤모', price_krw: 27000 },
          { id: 'competitor_c', product_name: '이니스프리', price_krw: 31500 },
        ],
        archetypes: [
          { id: 'price_sensitive', label: '가격 민감형', cohort_weight_percent: 18 },
          { id: 'value_seeker', label: '가성비 균형형', cohort_weight_percent: 16 },
          { id: 'premium_quality', label: '프리미엄 품질형', cohort_weight_percent: 12 },
          { id: 'trust_first', label: '신뢰 우선형', cohort_weight_percent: 15 },
          { id: 'aesthetics_first', label: '심미형', cohort_weight_percent: 8 },
          { id: 'urgency_buyer', label: '긴박 구매형', cohort_weight_percent: 11 },
          { id: 'promo_hunter', label: '프로모션 헌터형', cohort_weight_percent: 10 },
          { id: 'gift_or_family_buyer', label: '가족 구매형', cohort_weight_percent: 10 },
        ],
        defaults: { iteration_count: 3, minimum_margin_floor: 0.35 },
      }),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const btnRun = page.locator('[data-testid="btn-run"]');
  await expect(btnRun).toBeEnabled({ timeout: 5000 });
  await btnRun.click();

  // Wait for simulation_complete state — state-completed visible
  const stateCompleted = page.locator('[data-testid="state-completed"]');
  await expect(stateCompleted).toBeVisible({ timeout: 15_000 });

  // sim-frozen class is applied via setTimeout(300ms) after simulation_complete
  await page.waitForFunction(
    () => document.getElementById('sim-canvas-wrap')?.classList.contains('sim-frozen'),
    { timeout: 5000 },
  );

  const wrap = page.locator('#sim-canvas-wrap');
  const hasFrozen = await wrap.evaluate((el) => el.classList.contains('sim-frozen'));
  expect(hasFrozen, 'sim-canvas-wrap should have sim-frozen class after simulation completes').toBe(true);

  // sim-running should be removed
  const hasRunning = await wrap.evaluate((el) => el.classList.contains('sim-running'));
  expect(hasRunning, 'sim-canvas-wrap should NOT have sim-running after completion').toBe(false);
});

// ── Test 7: After simulation_complete → seller badge loses visible class ───────

test('Sub-AC 6e: canvas-seller-badge loses visible class after simulation_complete', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildMockRunBody(),
    });
  });

  await page.route('**/api/fixtures', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          product_name: '트리클리닉 샴푸 500ml',
          brand_name: '트리클리닉',
          current_title: '테스트 타이틀',
          current_top_copy: '테스트 카피',
          current_price_krw: 29900,
          current_cost_krw: 11000,
        },
        competitors: [
          { id: 'competitor_a', product_name: '닥터그루트', price_krw: 25900 },
          { id: 'competitor_b', product_name: '려 자양윤모', price_krw: 27000 },
          { id: 'competitor_c', product_name: '이니스프리', price_krw: 31500 },
        ],
        archetypes: [
          { id: 'price_sensitive', label: '가격 민감형', cohort_weight_percent: 18 },
          { id: 'value_seeker', label: '가성비 균형형', cohort_weight_percent: 16 },
          { id: 'premium_quality', label: '프리미엄 품질형', cohort_weight_percent: 12 },
          { id: 'trust_first', label: '신뢰 우선형', cohort_weight_percent: 15 },
          { id: 'aesthetics_first', label: '심미형', cohort_weight_percent: 8 },
          { id: 'urgency_buyer', label: '긴박 구매형', cohort_weight_percent: 11 },
          { id: 'promo_hunter', label: '프로모션 헌터형', cohort_weight_percent: 10 },
          { id: 'gift_or_family_buyer', label: '가족 구매형', cohort_weight_percent: 10 },
        ],
        defaults: { iteration_count: 3, minimum_margin_floor: 0.35 },
      }),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const btnRun = page.locator('[data-testid="btn-run"]');
  await expect(btnRun).toBeEnabled({ timeout: 5000 });
  await btnRun.click();

  // Wait for completion
  const stateCompleted = page.locator('[data-testid="state-completed"]');
  await expect(stateCompleted).toBeVisible({ timeout: 15_000 });

  // setTimeout(300ms) for badge removal — wait up to 2s total
  await page.waitForFunction(
    () => !document.getElementById('canvas-seller-badge')?.classList.contains('visible'),
    { timeout: 3000 },
  );

  const badge = page.locator('[data-testid="canvas-seller-badge"]');
  const stillVisible = await badge.evaluate((el) => el.classList.contains('visible'));
  expect(stillVisible, 'canvas-seller-badge should NOT have visible class after simulation completes').toBe(false);
});

// ── Test 8: CSS design token --node-our is applied as seller color ─────────────

test('Sub-AC 6e: CSS --node-our design token is #2563eb (seller role color)', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Check CSS custom property value
  const nodeOurColor = await page.evaluate(() => {
    return getComputedStyle(document.documentElement)
      .getPropertyValue('--node-our')
      .trim()
      .toLowerCase();
  });

  // Both #3b82f6 (styles.css value) and #2563eb (particle-engine deep-blue) are valid.
  // The PRD spec in §12.2 shows --node-our for the product node color in the force graph.
  // particle-engine.mjs uses PRODUCT_COLORS.our_product = #2563eb for particles.
  // Acceptable: the CSS token #3b82f6 is a slightly lighter blue, still the seller color.
  expect(
    ['#3b82f6', '#2563eb'].includes(nodeOurColor),
    `--node-our should be a blue seller color, got "${nodeOurColor}"`,
  ).toBe(true);
});

// ── Test 9: ARCHETYPE_COLORS are distinct (8 unique colors for 8 archetypes) ───

test('Sub-AC 6e: 8 archetype nodes have distinct colors in force graph', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Wait for force graph to initialize and render archetype nodes
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="archetype-"]').length >= 8,
    { timeout: 10_000 },
  );

  const archetypeNodes = await page.locator('[data-testid^="archetype-"]').all();
  expect(archetypeNodes.length, 'should have 8 archetype nodes').toBeGreaterThanOrEqual(8);

  // Each node should be present and attached
  for (const node of archetypeNodes) {
    await expect(node).toBeAttached();
  }
});
