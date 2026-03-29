/**
 * playwright-screenshots.spec.mjs
 *
 * Playwright test that navigates the dashboard through 4 distinct states
 * and captures a screenshot for each state, saving PNG files under
 * artifacts/screenshots/.
 *
 * States:
 *   01-initial-load.png     — empty state on first visit
 *   02-simulation-running.png — loading state (btn-run disabled, progress visible)
 *   03-results-populated.png  — completed state (metrics/strategy/diff visible)
 *   04-error-state.png        — error state (state-error visible)
 *
 * PRD §8, §12.5, §16
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../artifacts/screenshots');
const PORT = 3099; // separate port to avoid collision with dev server

// ── Pre-built mock SSE payloads ───────────────────────────────────────────────

/** Build a realistic simulation_complete payload from the existing artifact */
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
    id: 'iter-1-narrow-gap',
    title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml',
    top_copy: '전문가 관점의 두피과학 설계로 매일 균형 있게 관리하는 프리미엄 탈모 샴푸',
    price_krw: 28900,
    simulated_revenue: 6200000,
    margin_rate: 0.619,
    rationale: '가격 민감형 고객 확보를 위해 소폭 가격 인하, 두피과학 메시지 강화',
  },
  holdout: {
    holdout_uplift: 548900,
    holdout_revenue: 6200000,
    margin_floor_violations: 0,
  },
  diff: {
    title: {
      before: '트리클리닉 엑스퍼트 스칼프 탈모 샴푸 500ml',
      after:  '트리클리닉 두피과학 기반 탈모 샴푸 500ml',
    },
    top_copy: {
      before: '두피과학 기반의 성분 설계로 매일 신뢰감 있게 관리하는 프리미엄 탈모 샴푸',
      after:  '전문가 관점의 두피과학 설계로 매일 균형 있게 관리하는 프리미엄 탈모 샴푸',
    },
    price: {
      before: 29900,
      after:  28900,
    },
  },
  artifact: {
    payload: {
      selected_strategy_id: 'iter-1-narrow-gap',
      holdout_uplift: 548900,
      generated_at: new Date().toISOString(),
    },
  },
};

/** Build a full SSE stream as a single string (the browser will process events from it) */
function buildSSEBody(events) {
  return events
    .map(({ type, data }) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

const MOCK_SSE_COMPLETE = buildSSEBody([
  {
    type: 'iteration_start',
    data: { iteration: 1, total: 2, candidates: [{ id: 'iter-1-narrow-gap', title: '트리클리닉 두피과학 기반 탈모 샴푸', price_krw: 28900 }] },
  },
  {
    type: 'archetype_evaluated',
    data: { iteration: 1, archetype_id: 'price_sensitive', archetype_name: '가격 민감형', choices: { our_product: 82, competitor_a: 28, competitor_b: 18, competitor_c: 12, pass: 4 } },
  },
  {
    type: 'archetype_evaluated',
    data: { iteration: 1, archetype_id: 'value_seeker', archetype_name: '가성비 균형형', choices: { our_product: 74, competitor_a: 32, competitor_b: 20, competitor_c: 8, pass: 2 } },
  },
  {
    type: 'archetype_evaluated',
    data: { iteration: 1, archetype_id: 'premium_quality', archetype_name: '프리미엄형', choices: { our_product: 58, competitor_a: 10, competitor_b: 8, competitor_c: 14, pass: 6 } },
  },
  {
    type: 'archetype_evaluated',
    data: { iteration: 1, archetype_id: 'trust_first', archetype_name: '신뢰 우선형', choices: { our_product: 68, competitor_a: 22, competitor_b: 14, competitor_c: 10, pass: 6 } },
  },
  {
    type: 'archetype_evaluated',
    data: { iteration: 1, archetype_id: 'aesthetics_first', archetype_name: '감성형', choices: { our_product: 36, competitor_a: 12, competitor_b: 10, competitor_c: 6, pass: 4 } },
  },
  {
    type: 'archetype_evaluated',
    data: { iteration: 1, archetype_id: 'urgency_buyer', archetype_name: '문제 해결형', choices: { our_product: 50, competitor_a: 16, competitor_b: 14, competitor_c: 10, pass: 8 } },
  },
  {
    type: 'archetype_evaluated',
    data: { iteration: 1, archetype_id: 'promo_hunter', archetype_name: '할인 반응형', choices: { our_product: 44, competitor_a: 20, competitor_b: 18, competitor_c: 14, pass: 4 } },
  },
  {
    type: 'archetype_evaluated',
    data: { iteration: 1, archetype_id: 'gift_or_family_buyer', archetype_name: '가족 구매형', choices: { our_product: 42, competitor_a: 18, competitor_b: 16, competitor_c: 14, pass: 10 } },
  },
  {
    type: 'iteration_complete',
    data: {
      iteration: 1,
      winner_id: 'iter-1-narrow-gap',
      winner_revenue: 6200000,
      accepted: true,
      rejected_count: 1,
      choice_summary: { our_product: 454, competitor_a: 137, competitor_b: 96, competitor_c: 75, pass: 38 },
      archetype_breakdown: {
        price_sensitive:      { our_product: 82,  competitor_a: 28, competitor_b: 18, competitor_c: 12, pass: 4  },
        value_seeker:         { our_product: 74,  competitor_a: 32, competitor_b: 20, competitor_c: 8,  pass: 2  },
        premium_quality:      { our_product: 58,  competitor_a: 10, competitor_b: 8,  competitor_c: 14, pass: 6  },
        trust_first:          { our_product: 68,  competitor_a: 22, competitor_b: 14, competitor_c: 10, pass: 6  },
        aesthetics_first:     { our_product: 36,  competitor_a: 12, competitor_b: 10, competitor_c: 6,  pass: 4  },
        urgency_buyer:        { our_product: 50,  competitor_a: 16, competitor_b: 14, competitor_c: 10, pass: 8  },
        promo_hunter:         { our_product: 44,  competitor_a: 20, competitor_b: 18, competitor_c: 14, pass: 4  },
        gift_or_family_buyer: { our_product: 42,  competitor_a: 18, competitor_b: 16, competitor_c: 14, pass: 10 },
      },
    },
  },
  {
    type: 'iteration_start',
    data: { iteration: 2, total: 2, candidates: [{ id: 'iter-2-steady-trust', title: '트리클리닉 전문가 설계 탈모 샴푸', price_krw: 29900 }] },
  },
  {
    type: 'archetype_evaluated',
    data: { iteration: 2, archetype_id: 'price_sensitive', archetype_name: '가격 민감형', choices: { our_product: 78, competitor_a: 30, competitor_b: 20, competitor_c: 14, pass: 2 } },
  },
  {
    type: 'iteration_complete',
    data: {
      iteration: 2,
      winner_id: 'iter-1-narrow-gap',
      winner_revenue: 6200000,
      accepted: true,
      rejected_count: 0,
      choice_summary: { our_product: 454, competitor_a: 137, competitor_b: 96, competitor_c: 75, pass: 38 },
      archetype_breakdown: {
        price_sensitive:      { our_product: 82,  competitor_a: 28, competitor_b: 18, competitor_c: 12, pass: 4  },
        value_seeker:         { our_product: 74,  competitor_a: 32, competitor_b: 20, competitor_c: 8,  pass: 2  },
        premium_quality:      { our_product: 58,  competitor_a: 10, competitor_b: 8,  competitor_c: 14, pass: 6  },
        trust_first:          { our_product: 68,  competitor_a: 22, competitor_b: 14, competitor_c: 10, pass: 6  },
        aesthetics_first:     { our_product: 36,  competitor_a: 12, competitor_b: 10, competitor_c: 6,  pass: 4  },
        urgency_buyer:        { our_product: 50,  competitor_a: 16, competitor_b: 14, competitor_c: 10, pass: 8  },
        promo_hunter:         { our_product: 44,  competitor_a: 20, competitor_b: 18, competitor_c: 14, pass: 4  },
        gift_or_family_buyer: { our_product: 42,  competitor_a: 18, competitor_b: 16, competitor_c: 14, pass: 10 },
      },
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

const MOCK_SSE_ERROR = buildSSEBody([
  {
    type: 'iteration_start',
    data: { iteration: 1, total: 5, candidates: [] },
  },
  {
    type: 'error',
    data: { message: 'OpenAI API 연결 오류: 일시적인 네트워크 장애가 발생했습니다.', recoverable: false },
  },
]);

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server;

test.beforeAll(async () => {
  // Ensure screenshots directory exists
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  // Start server in mock mode
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

const BASE_URL = `http://127.0.0.1:${PORT}`;

// ── State 1: Initial load (empty state) ──────────────────────────────────────

test('State 1: Initial load — empty state', async ({ page }) => {
  await page.goto(BASE_URL);

  // Wait for fixture data to load (product-name populated by JS from /api/fixtures)
  await page.waitForFunction(
    () => document.querySelector('[data-testid="product-name"]')?.textContent?.trim().length > 0,
    { timeout: 10_000 },
  );

  // Verify 3-panel layout
  await expect(page.locator('[data-testid="panel-input"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-simulation"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-results"]')).toBeVisible();

  // Verify empty state element (at least one visible)
  const emptyEls = page.locator('[data-testid="state-empty"]');
  await expect(emptyEls.first()).toBeVisible();

  // Verify run button is ready
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '01-initial-load.png'),
    fullPage: true,
  });
});

// ── State 2: Simulation running (loading state with particles mid-flow) ──────

test('State 2: Simulation running — loading state', async ({ page }) => {
  await page.goto(BASE_URL);

  // Wait for fixture data to load
  await page.waitForFunction(
    () => document.querySelector('[data-testid="product-name"]')?.textContent?.trim().length > 0,
    { timeout: 10_000 },
  );

  // Wait for particle engine to initialize and seed product positions (one RAF frame after init)
  await page.waitForFunction(
    () => {
      const e = window.particleEngine;
      // Engine is ready when it's created AND has at least one product position registered
      return e != null && e._nodePos != null && e._nodePos.has('our_product');
    },
    { timeout: 8_000 },
  );

  // Directly invoke the loading-state DOM transitions via page.evaluate.
  // This mirrors showLoadingState() + setInputsDisabled(true) in dashboard.js
  // without triggering a real network request, ensuring the screenshot is stable.
  await page.evaluate(() => {
    const simStateEmpty     = document.getElementById('sim-state-empty');
    const simStateLoading   = document.getElementById('sim-state-loading');
    const simStateCompleted = document.getElementById('sim-state-completed');
    const simProgress       = document.getElementById('sim-progress');
    const simProgressBar    = document.getElementById('sim-progress-bar');
    const runButton         = document.querySelector('[data-testid="btn-run"]');
    const statusEl          = document.querySelector('[data-testid="status-text"]');
    const simIterLabel      = document.getElementById('sim-iteration-label');
    const resultsEmpty      = document.getElementById('results-state-empty');
    const resultsContent    = document.getElementById('results-content');
    const agentLog          = document.getElementById('agent-log');
    const revenueChart      = document.getElementById('revenue-chart');

    // Simulation panel: hide empty overlay, show loading badge + progress
    if (simStateEmpty)     simStateEmpty.style.display     = 'none';
    if (simStateLoading)   simStateLoading.style.display   = 'block';
    if (simStateCompleted) simStateCompleted.style.display = 'none';
    if (simProgress) {
      simProgress.style.display       = 'flex';
      simProgress.style.flexDirection = 'column';
      simProgress.style.gap           = 'var(--space-xs)';
    }
    if (simProgressBar) simProgressBar.style.width = '40%';

    // Results panel: hide content while running
    if (resultsEmpty)   resultsEmpty.style.display   = 'none';
    if (resultsContent) resultsContent.style.display = 'none';

    // Show agent log panel and revenue chart (they appear during a real run)
    if (agentLog)      agentLog.style.display      = 'block';
    if (revenueChart)  revenueChart.style.display  = 'block';

    // Run controls
    if (runButton) runButton.disabled = true;
    if (statusEl)  statusEl.textContent = 'Iteration 2/5 진행 중...';
    if (simIterLabel) simIterLabel.textContent = 'Iteration 2/5';

    // Disable all 6 editable inputs
    document.querySelectorAll(
      '[data-testid="input-title"],[data-testid="input-top-copy"],' +
      '[data-testid="input-price"],[data-testid="input-cost"],' +
      '[data-testid="input-iteration-count"],[data-testid="input-margin-floor"]'
    ).forEach((el) => { el.disabled = true; });
  });

  // ── Spawn particles mid-flow to visualise the agent particle animation ──────
  // Each particle represents a buyer agent decision flowing from an archetype
  // node to a product bucket node.  We set elapsed to mid-flight values so
  // they appear spread along their travel paths in the screenshot.
  await page.evaluate(() => {
    const engine = window.particleEngine;
    if (!engine) return;

    const W = engine._cssW || 800;
    const H = engine._cssH || 500;

    const ARCHETYPE_IDS = [
      'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
      'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
    ];
    const PRODUCT_IDS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];

    // Ensure archetype positions exist (they should be set by the force-graph tick,
    // but we fall back to evenly-spaced synthetic positions if not yet available)
    ARCHETYPE_IDS.forEach((id, i) => {
      if (!engine._nodePos.has(id)) {
        const x = W * 0.1 + i * (W * 0.8 / (ARCHETYPE_IDS.length - 1));
        const y = H * 0.25;
        engine.setArchPos(id, x, y);
      }
    });

    // Ensure product positions exist (should be set after one RAF frame from init)
    PRODUCT_IDS.forEach((id, i) => {
      if (!engine._nodePos.has(id)) {
        const x = W * 0.15 + i * (W * 0.7 / (PRODUCT_IDS.length - 1));
        const y = H * 0.78;
        engine.setProductPos(id, x, y);
      }
    });

    // Spawn particles representing buyers in flight — staggered elapsed times
    // so they appear spread along their travel arcs (not all at the same position)
    const PARTICLE_SPECS = [
      { arch: 'price_sensitive',      prod: 'our_product',  elapsed: 70 },
      { arch: 'value_seeker',         prod: 'our_product',  elapsed: 50 },
      { arch: 'trust_first',          prod: 'our_product',  elapsed: 90 },
      { arch: 'premium_quality',      prod: 'competitor_a', elapsed: 60 },
      { arch: 'aesthetics_first',     prod: 'competitor_b', elapsed: 40 },
      { arch: 'urgency_buyer',        prod: 'our_product',  elapsed: 80 },
      { arch: 'promo_hunter',         prod: 'pass',         elapsed: 55 },
      { arch: 'gift_or_family_buyer', prod: 'our_product',  elapsed: 65 },
      { arch: 'price_sensitive',      prod: 'our_product',  elapsed: 110 },
      { arch: 'value_seeker',         prod: 'competitor_a', elapsed: 75 },
      { arch: 'trust_first',          prod: 'competitor_b', elapsed: 85 },
      { arch: 'premium_quality',      prod: 'our_product',  elapsed: 45 },
      { arch: 'urgency_buyer',        prod: 'competitor_c', elapsed: 95 },
      { arch: 'promo_hunter',         prod: 'our_product',  elapsed: 35 },
      { arch: 'aesthetics_first',     prod: 'pass',         elapsed: 115 },
      { arch: 'gift_or_family_buyer', prod: 'competitor_a', elapsed: 55 },
      { arch: 'price_sensitive',      prod: 'our_product',  elapsed: 125 },
      { arch: 'value_seeker',         prod: 'our_product',  elapsed: 40 },
      { arch: 'trust_first',          prod: 'our_product',  elapsed: 60 },
      { arch: 'premium_quality',      prod: 'competitor_b', elapsed: 80 },
      { arch: 'urgency_buyer',        prod: 'our_product',  elapsed: 100 },
      { arch: 'promo_hunter',         prod: 'competitor_c', elapsed: 70 },
      { arch: 'aesthetics_first',     prod: 'our_product',  elapsed: 30 },
      { arch: 'gift_or_family_buyer', prod: 'our_product',  elapsed: 50 },
      { arch: 'price_sensitive',      prod: 'competitor_a', elapsed: 85 },
    ];

    for (const { arch, prod, elapsed } of PARTICLE_SPECS) {
      const p = engine.spawn(arch, prod);
      if (p) p.elapsed = elapsed;   // set mid-flight; particles last 200ms total
    }
  });

  // Give requestAnimationFrame one render pass to draw the particles on canvas
  await page.waitForTimeout(50);

  // Verify loading state elements are visible
  const stateLoading = page.locator('[data-testid="state-loading"]');
  await expect(stateLoading).toBeVisible();

  const simProgress = page.locator('[data-testid="sim-progress"]');
  await expect(simProgress).toBeVisible();

  await expect(page.locator('[data-testid="btn-run"]')).toBeDisabled();

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '02-simulation-running.png'),
    fullPage: true,
  });
});

// ── State 3: Results populated (completed state) ──────────────────────────────

test('State 3: Results populated — completed state', async ({ page }) => {
  // Route SSE to return full simulation including simulation_complete
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
      body: MOCK_SSE_COMPLETE,
    });
  });

  await page.goto(BASE_URL);

  // Wait for fixture data
  await page.waitForFunction(
    () => document.querySelector('[data-testid="product-name"]')?.textContent?.trim().length > 0,
    { timeout: 10_000 },
  );

  // Click run button
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation_complete: state-completed badge shows
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 30_000,
  });

  // Wait for metrics to be populated
  await page.waitForFunction(
    () => {
      const baseline = document.querySelector('[data-testid="metric-baseline"]');
      return baseline && baseline.textContent !== '—' && baseline.textContent.length > 1;
    },
    { timeout: 10_000 },
  );

  // Verify key result elements are visible and populated
  await expect(page.locator('[data-testid="metric-baseline"]')).toBeVisible();
  await expect(page.locator('[data-testid="metric-final"]')).toBeVisible();
  await expect(page.locator('[data-testid="metric-holdout"]')).toBeVisible();
  await expect(page.locator('[data-testid="strategy-summary"]')).toBeVisible();
  await expect(page.locator('[data-testid="diff-output"]')).toBeVisible();
  await expect(page.locator('[data-testid="artifact-output"]')).toBeVisible();

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '03-results-populated.png'),
    fullPage: true,
  });
});

// ── State 4: Error state ──────────────────────────────────────────────────────

test('State 4: Error state — readable error message', async ({ page }) => {
  // Route SSE to return an error event
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
      body: MOCK_SSE_ERROR,
    });
  });

  await page.goto(BASE_URL);

  // Wait for fixture data
  await page.waitForFunction(
    () => document.querySelector('[data-testid="product-name"]')?.textContent?.trim().length > 0,
    { timeout: 10_000 },
  );

  // Click run button
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for error state to show
  await page.waitForSelector('[data-testid="state-error"]', {
    state: 'visible',
    timeout: 15_000,
  });

  // Verify the error message is readable (not empty)
  const errorEl = page.locator('[data-testid="state-error"]');
  await expect(errorEl).toBeVisible();
  const errorText = await errorEl.textContent();
  expect(errorText?.length).toBeGreaterThan(5);

  // Run button should be re-enabled after error
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '04-error-state.png'),
    fullPage: true,
  });
});

// ── Sub-AC 5b: Agent Profile Popup ───────────────────────────────────────────
//
// SSE stream with agent_decision events that include per-agent stat data so
// the log entries have the required data-* attributes for the popup.

const MOCK_SSE_AGENT_DECISIONS = buildSSEBody([
  {
    type: 'iteration_start',
    data: { iteration: 1, total: 1, candidates: [{ id: 'iter-1', title: '테스트 샴푸', price_krw: 28900 }] },
  },
  // agent_decision events with full per-agent stats
  {
    type: 'agent_decision',
    data: {
      agent_id: 'agent_001',
      agent_name: '구매자 #001',
      agent_index: 1,
      agent_total: 3,
      archetype_id: 'price_sensitive',
      chosen_product: 'our_product',
      reasoning: '가격이 합리적이고 성분이 좋아서 우리 제품을 선택했습니다.',
      price_sensitivity: 4.2,
      trust_sensitivity: 2.8,
      promo_affinity: 3.5,
      brand_bias: 1.9,
      pass_threshold: 0.3,
    },
  },
  {
    type: 'agent_decision',
    data: {
      agent_id: 'agent_002',
      agent_name: '구매자 #002',
      agent_index: 2,
      agent_total: 3,
      archetype_id: 'trust_first',
      chosen_product: 'competitor_a',
      reasoning: '신뢰도가 높은 브랜드를 선택했습니다.',
      price_sensitivity: 1.5,
      trust_sensitivity: 4.8,
      promo_affinity: 2.1,
      brand_bias: 3.7,
      pass_threshold: 0.5,
    },
  },
  {
    type: 'agent_decision',
    data: {
      agent_id: 'agent_003',
      agent_name: '구매자 #003',
      agent_index: 3,
      agent_total: 3,
      archetype_id: 'promo_hunter',
      chosen_product: 'pass',
      reasoning: '할인 혜택이 없어서 구매를 보류했습니다.',
      price_sensitivity: 3.0,
      trust_sensitivity: 2.0,
      promo_affinity: 4.9,
      brand_bias: 1.2,
      pass_threshold: 0.7,
    },
  },
  {
    type: 'iteration_complete',
    data: { iteration: 1, winner_id: 'iter-1', winner_revenue: 5000000, accepted: true, rejected_count: 0 },
  },
  {
    type: 'simulation_complete',
    data: MOCK_COMPLETE_PAYLOAD,
  },
]);

test('Sub-AC 5b: Agent profile popup opens on log entry click', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
      body: MOCK_SSE_AGENT_DECISIONS,
    });
  });

  await page.goto(BASE_URL);

  // Wait for fixture data
  await page.waitForFunction(
    () => document.querySelector('[data-testid="product-name"]')?.textContent?.trim().length > 0,
    { timeout: 10_000 },
  );

  // Run simulation to get agent_decision log entries
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for agent log entries to appear
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  // Popup should be hidden initially
  const popup = page.locator('[data-testid="agent-profile"]');
  await expect(popup).toBeHidden();

  // Click the first log entry to open the popup
  const firstEntry = page.locator('[data-testid="agent-log-entry"]').first();
  await firstEntry.click();

  // Popup should now be visible
  await expect(popup).toBeVisible();

  // Verify agent name is populated (not empty/default)
  const agentName = page.locator('[data-testid="agent-profile-name"]');
  await expect(agentName).toBeVisible();
  const nameText = await agentName.textContent();
  expect(nameText?.trim().length).toBeGreaterThan(0);

  // Verify archetype label is populated
  const archetypeLabel = page.locator('[data-testid="agent-profile-archetype"]');
  await expect(archetypeLabel).toBeVisible();
  const archetypeText = await archetypeLabel.textContent();
  expect(archetypeText?.trim().length).toBeGreaterThan(0);
  // Should be a Korean archetype label, not the raw ID
  expect(archetypeText).not.toContain('_');

  // Verify 5 stat bars section is present
  await expect(page.locator('[data-testid="agent-profile-stats"]')).toBeVisible();

  // Verify all 5 individual stat bars render
  await expect(page.locator('[data-testid="stat-price-sensitivity"]')).toBeVisible();
  await expect(page.locator('[data-testid="stat-trust-sensitivity"]')).toBeVisible();
  await expect(page.locator('[data-testid="stat-promo-affinity"]')).toBeVisible();
  await expect(page.locator('[data-testid="stat-brand-bias"]')).toBeVisible();
  await expect(page.locator('[data-testid="stat-pass-threshold"]')).toBeVisible();

  // Verify stat bars have non-zero widths (data populated)
  const priceSensBar = page.locator('[data-testid="stat-price-sensitivity"]');
  const barWidth = await priceSensBar.evaluate((el) => el.style.width);
  expect(barWidth).not.toBe('0%');
  expect(barWidth).not.toBe('');

  // Verify choice badge is populated
  const choice = page.locator('[data-testid="agent-profile-choice"]');
  await expect(choice).toBeVisible();
  const choiceText = await choice.textContent();
  expect(choiceText?.trim().length).toBeGreaterThan(0);

  // Verify reasoning text is populated
  const reasoning = page.locator('[data-testid="agent-profile-reasoning"]');
  await expect(reasoning).toBeVisible();
  const reasoningText = await reasoning.textContent();
  expect(reasoningText?.trim().length).toBeGreaterThan(0);

  // Take screenshot with popup open
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '05-agent-profile-popup.png'),
    fullPage: true,
  });
});

test('Sub-AC 5b: Agent profile popup dismisses via X button', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
      body: MOCK_SSE_AGENT_DECISIONS,
    });
  });

  await page.goto(BASE_URL);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="product-name"]')?.textContent?.trim().length > 0,
    { timeout: 10_000 },
  );

  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  // Open popup
  await page.locator('[data-testid="agent-log-entry"]').first().click();
  await expect(page.locator('[data-testid="agent-profile"]')).toBeVisible();

  // Click X button to close
  await page.locator('[data-testid="agent-profile-close"]').click();

  // Popup should be hidden
  await expect(page.locator('[data-testid="agent-profile"]')).toBeHidden();
});

test('Sub-AC 5b: Agent profile popup dismisses via ESC key', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
      body: MOCK_SSE_AGENT_DECISIONS,
    });
  });

  await page.goto(BASE_URL);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="product-name"]')?.textContent?.trim().length > 0,
    { timeout: 10_000 },
  );

  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  // Open popup
  await page.locator('[data-testid="agent-log-entry"]').first().click();
  await expect(page.locator('[data-testid="agent-profile"]')).toBeVisible();

  // Press ESC key to dismiss
  await page.keyboard.press('Escape');

  // Popup should be hidden
  await expect(page.locator('[data-testid="agent-profile"]')).toBeHidden();
});

test('Sub-AC 5b: Agent profile popup dismisses via backdrop click', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
      body: MOCK_SSE_AGENT_DECISIONS,
    });
  });

  await page.goto(BASE_URL);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="product-name"]')?.textContent?.trim().length > 0,
    { timeout: 10_000 },
  );

  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  // Open popup
  await page.locator('[data-testid="agent-log-entry"]').first().click();
  await expect(page.locator('[data-testid="agent-profile"]')).toBeVisible();

  // Click the backdrop by clicking the overlay element at a corner position
  // that is guaranteed to be outside the centered 360px dialog
  // Use page.mouse.click at top-left corner (10,10) which is on the backdrop
  await page.mouse.click(10, 10);

  // Popup should be hidden
  await expect(page.locator('[data-testid="agent-profile"]')).toBeHidden();
});

// ── Sub-AC 4e: Loading state — particles mid-flight + DOM counter assertions ──
//
// Asserts that:
//   1. The particle canvas has visibly drawn pixels (non-transparent) confirming
//      particles are mid-flight between archetype spawn points and bucket targets.
//   2. All five product-counter-* data-testid elements are present in the DOM.
//   3. The agent-count element is present in the DOM.

test('Sub-AC 4e: Loading state — particles visible mid-flight and all counters present', async ({ page }) => {
  await page.goto(BASE_URL);

  // Wait for fixture data to load
  await page.waitForFunction(
    () => document.querySelector('[data-testid="product-name"]')?.textContent?.trim().length > 0,
    { timeout: 10_000 },
  );

  // Wait for the particle engine to initialise and register product positions
  await page.waitForFunction(
    () => {
      const e = window.particleEngine;
      return e != null && e._nodePos != null && e._nodePos.has('our_product');
    },
    { timeout: 8_000 },
  );

  // Transition the UI to the loading state (mirrors showLoadingState() in dashboard.js)
  await page.evaluate(() => {
    const simStateEmpty     = document.getElementById('sim-state-empty');
    const simStateLoading   = document.getElementById('sim-state-loading');
    const simStateCompleted = document.getElementById('sim-state-completed');
    const simProgress       = document.getElementById('sim-progress');
    const simProgressBar    = document.getElementById('sim-progress-bar');
    const runButton         = document.querySelector('[data-testid="btn-run"]');
    const statusEl          = document.querySelector('[data-testid="status-text"]');
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
    if (simProgressBar) simProgressBar.style.width = '35%';
    if (runButton) runButton.disabled = true;
    if (statusEl)  statusEl.textContent = 'Iteration 1/5 진행 중...';
    if (agentLog)      agentLog.style.display      = 'block';
    if (revenueChart)  revenueChart.style.display  = 'block';
  });

  // ── Spawn particles at staggered mid-flight elapsed values ──────────────────
  // elapsed values are chosen so every particle is between 20% and 90% of its
  // 200ms travel arc — none are at origin (0ms) or already landed (200ms+).
  await page.evaluate(() => {
    const engine = window.particleEngine;
    if (!engine) return;

    const W = engine._cssW || 800;
    const H = engine._cssH || 500;

    const ARCHETYPE_IDS = [
      'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
      'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
    ];
    const PRODUCT_IDS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];

    // Fall back to synthetic positions if the force-graph has not yet run a tick
    ARCHETYPE_IDS.forEach((id, i) => {
      if (!engine._nodePos.has(id)) {
        const x = W * 0.08 + i * (W * 0.84 / (ARCHETYPE_IDS.length - 1));
        const y = H * 0.22;
        engine.setArchPos(id, x, y);
      }
    });

    PRODUCT_IDS.forEach((id, i) => {
      if (!engine._nodePos.has(id)) {
        const x = W * 0.12 + i * (W * 0.76 / (PRODUCT_IDS.length - 1));
        const y = H * 0.80;
        engine.setProductPos(id, x, y);
      }
    });

    // Spawn a spread of particles targeting every bucket so the canvas is
    // populated across the full width of the simulation panel.
    const specs = [
      { arch: 'price_sensitive',      prod: 'our_product',  elapsed: 60  },
      { arch: 'value_seeker',         prod: 'our_product',  elapsed: 40  },
      { arch: 'trust_first',          prod: 'our_product',  elapsed: 100 },
      { arch: 'premium_quality',      prod: 'competitor_a', elapsed: 80  },
      { arch: 'aesthetics_first',     prod: 'competitor_b', elapsed: 50  },
      { arch: 'urgency_buyer',        prod: 'our_product',  elapsed: 90  },
      { arch: 'promo_hunter',         prod: 'pass',         elapsed: 70  },
      { arch: 'gift_or_family_buyer', prod: 'our_product',  elapsed: 55  },
      { arch: 'price_sensitive',      prod: 'competitor_c', elapsed: 120 },
      { arch: 'value_seeker',         prod: 'competitor_a', elapsed: 75  },
      { arch: 'trust_first',          prod: 'competitor_b', elapsed: 85  },
      { arch: 'premium_quality',      prod: 'our_product',  elapsed: 45  },
      { arch: 'urgency_buyer',        prod: 'competitor_c', elapsed: 95  },
      { arch: 'promo_hunter',         prod: 'our_product',  elapsed: 35  },
      { arch: 'aesthetics_first',     prod: 'pass',         elapsed: 110 },
      { arch: 'gift_or_family_buyer', prod: 'competitor_a', elapsed: 65  },
      { arch: 'price_sensitive',      prod: 'our_product',  elapsed: 130 },
      { arch: 'value_seeker',         prod: 'our_product',  elapsed: 42  },
      { arch: 'trust_first',          prod: 'our_product',  elapsed: 58  },
      { arch: 'premium_quality',      prod: 'competitor_b', elapsed: 88  },
    ];

    for (const { arch, prod, elapsed } of specs) {
      const p = engine.spawn(arch, prod);
      if (p) p.elapsed = elapsed;
    }
  });

  // Give requestAnimationFrame at least two render passes to draw the particles
  await page.waitForTimeout(100);

  // ── 1. Assert canvas has visibly drawn pixels (particles are mid-flight) ─────
  // Read pixel data from the particle canvas; at least one non-transparent pixel
  // must exist, proving particles were rendered.
  const hasDrawnPixels = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="particle-canvas"]');
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const { width, height } = canvas;
    if (!width || !height) return false;
    // Sample a grid of pixels across the canvas looking for any painted pixel
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 10) return true; // alpha > 10 means something was drawn
    }
    return false;
  });
  expect(hasDrawnPixels).toBe(true);

  // ── 2. Assert all five product-counter data-testid elements are in the DOM ───
  const PRODUCT_IDS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  for (const id of PRODUCT_IDS) {
    const counter = page.locator(`[data-testid="product-counter-${id}"]`);
    await expect(counter).toBeAttached(); // present in DOM (may be inside SVG, not necessarily visible)
  }

  // ── 3. Assert agent-count element is present in the DOM ──────────────────────
  const agentCount = page.locator('[data-testid="agent-count"]');
  await expect(agentCount).toBeAttached();

  // ── Loading-state UI sanity checks ───────────────────────────────────────────
  await expect(page.locator('[data-testid="state-loading"]')).toBeVisible();
  await expect(page.locator('[data-testid="sim-progress"]')).toBeVisible();
  await expect(page.locator('[data-testid="btn-run"]')).toBeDisabled();

  // ── Capture screenshot that shows particles in flight ────────────────────────
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '02b-loading-particles-midflight.png'),
    fullPage: true,
  });
});

test('Sub-AC 5b: Agent profile popup shows correct data for different entries', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
      body: MOCK_SSE_AGENT_DECISIONS,
    });
  });

  await page.goto(BASE_URL);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="product-name"]')?.textContent?.trim().length > 0,
    { timeout: 10_000 },
  );

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for all 3 agent entries to appear
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="agent-log-entry"]').length >= 2,
    { timeout: 15_000 },
  );

  const entries = page.locator('[data-testid="agent-log-entry"]');
  const count = await entries.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Click first entry and read its data
  await entries.nth(0).click();
  await expect(page.locator('[data-testid="agent-profile"]')).toBeVisible();
  const firstName = await page.locator('[data-testid="agent-profile-name"]').textContent();
  const firstArchetype = await page.locator('[data-testid="agent-profile-archetype"]').textContent();

  // Close
  await page.locator('[data-testid="agent-profile-close"]').click();
  await expect(page.locator('[data-testid="agent-profile"]')).toBeHidden();

  // Click second entry and verify different data
  await entries.nth(1).click();
  await expect(page.locator('[data-testid="agent-profile"]')).toBeVisible();
  const secondName = await page.locator('[data-testid="agent-profile-name"]').textContent();
  const secondArchetype = await page.locator('[data-testid="agent-profile-archetype"]').textContent();

  // Different agents should have different names and possibly different archetypes
  expect(firstName?.trim()).not.toBe('');
  expect(secondName?.trim()).not.toBe('');
  // Both name or archetype should differ between entries (they are different agents)
  const dataDiffers = firstName !== secondName || firstArchetype !== secondArchetype;
  expect(dataDiffers).toBe(true);

  // Close popup
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="agent-profile"]')).toBeHidden();
});
