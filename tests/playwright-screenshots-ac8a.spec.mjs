/**
 * playwright-screenshots-ac8a.spec.mjs
 *
 * Sub-AC 8a: Playwright screenshot capture
 * Launches the browser via Playwright and captures four named screenshots
 * stored under artifacts/screenshots/:
 *
 *   01-initial-load.png        — initial dashboard, no simulation run yet
 *   02-simulation-running.png  — simulation in progress, particles visible mid-flight
 *   03-results-populated.png   — simulation complete, all results populated
 *   04-error-state.png         — SSE error event received, error message shown
 *
 * Uses a mock SSE server so no real OpenAI calls are made.
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../artifacts/screenshots');
const PORT = 3102; // Unique port — no collision with other specs (3099, 3100, 3101)

// ── Mock SSE payloads ─────────────────────────────────────────────────────────

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
    id: 'ac8a-strategy',
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
      after: '트리클리닉 두피과학 기반 탈모 샴푸 500ml',
    },
    top_copy: {
      before: '두피과학 기반의 성분 설계로 매일 신뢰감 있게 관리하는 프리미엄 탈모 샴푸',
      after: '전문가 관점의 두피과학 설계로 매일 균형 있게 관리하는 프리미엄 탈모 샴푸',
    },
    price: { before: 29900, after: 28900 },
  },
  artifact: {
    payload: {
      selected_strategy_id: 'ac8a-strategy',
      holdout_uplift: 548900,
      generated_at: new Date().toISOString(),
    },
  },
};

function buildSSEBody(events) {
  return events
    .map(({ type, data }) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

/** Full successful simulation SSE stream */
const MOCK_SSE_COMPLETE = buildSSEBody([
  {
    type: 'iteration_start',
    data: { iteration: 1, total: 2, candidates: [{ id: 'ac8a-strategy', title: '트리클리닉 두피과학 기반 탈모 샴푸', price_krw: 28900 }] },
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
      winner_id: 'ac8a-strategy',
      winner_revenue: 6200000,
      accepted: true,
      rejected_count: 1,
      choice_summary: { our_product: 454, competitor_a: 158, competitor_b: 118, competitor_c: 88, pass: 44 },
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
    data: { iteration: 2, total: 2, candidates: [{ id: 'ac8a-strategy-v2', title: '트리클리닉 전문가 설계 탈모 샴푸', price_krw: 29900 }] },
  },
  {
    type: 'archetype_evaluated',
    data: { iteration: 2, archetype_id: 'price_sensitive', archetype_name: '가격 민감형', choices: { our_product: 78, competitor_a: 30, competitor_b: 20, competitor_c: 14, pass: 2 } },
  },
  {
    type: 'iteration_complete',
    data: {
      iteration: 2,
      winner_id: 'ac8a-strategy',
      winner_revenue: 6200000,
      accepted: true,
      rejected_count: 0,
      choice_summary: { our_product: 454, competitor_a: 158, competitor_b: 118, competitor_c: 88, pass: 44 },
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

/** Error SSE stream */
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
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
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

// ── Helper: wait for fixtures to load ────────────────────────────────────────

async function waitForFixtures(page) {
  await page.waitForFunction(
    () => document.querySelector('[data-testid="product-name"]')?.textContent?.trim().length > 0,
    { timeout: 10_000 },
  );
}

// ── Screenshot 1: empty_state ─────────────────────────────────────────────────

test('AC8a screenshot 1: empty_state', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Verify 3-panel layout is visible
  await expect(page.locator('[data-testid="panel-input"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-simulation"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-results"]')).toBeVisible();

  // Verify empty-state placeholder is shown
  await expect(page.locator('[data-testid="state-empty"]').first()).toBeVisible();

  // Run button should be enabled
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '01-initial-load.png'),
    fullPage: true,
  });
});

// ── Screenshot 2: loading_state (particles mid-flight) ───────────────────────

test('AC8a screenshot 2: loading_state with particles visible', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Wait for particle engine to initialise and register product positions
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
    if (simProgressBar) simProgressBar.style.width = '38%';
    if (runButton) runButton.disabled = true;
    if (statusEl)  statusEl.textContent = 'Iteration 2/5 진행 중...';
    if (simIterLabel) simIterLabel.textContent = 'Iteration 2/5';
    if (agentLog)      agentLog.style.display      = 'block';
    if (revenueChart)  revenueChart.style.display  = 'block';

    // Disable all 6 editable inputs
    document.querySelectorAll(
      '[data-testid="input-title"],[data-testid="input-top-copy"],' +
      '[data-testid="input-price"],[data-testid="input-cost"],' +
      '[data-testid="input-iteration-count"],[data-testid="input-margin-floor"]',
    ).forEach((el) => { el.disabled = true; });
  });

  // Spawn particles at staggered mid-flight elapsed values so they are
  // spread across all archetype → product arcs in the canvas.
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

    // Fallback positions in case the force-graph has not yet run a tick
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

    // Spread of particles covering every destination bucket
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
      { arch: 'premium_quality',      prod: 'competitor_b', elapsed: 78  },
      { arch: 'urgency_buyer',        prod: 'our_product',  elapsed: 102 },
      { arch: 'promo_hunter',         prod: 'competitor_c', elapsed: 68  },
      { arch: 'aesthetics_first',     prod: 'our_product',  elapsed: 32  },
      { arch: 'gift_or_family_buyer', prod: 'our_product',  elapsed: 48  },
      { arch: 'price_sensitive',      prod: 'competitor_a', elapsed: 88  },
    ];
    for (const { arch, prod, elapsed } of specs) {
      const p = engine.spawn(arch, prod);
      if (p) p.elapsed = elapsed;
    }
  });

  // Allow one RAF frame so particles are painted on canvas
  await page.waitForTimeout(60);

  // Verify loading state
  await expect(page.locator('[data-testid="state-loading"]')).toBeVisible();
  await expect(page.locator('[data-testid="sim-progress"]')).toBeVisible();
  await expect(page.locator('[data-testid="btn-run"]')).toBeDisabled();

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '02-simulation-running.png'),
    fullPage: true,
  });
});

// ── Screenshot 3: completed_state ────────────────────────────────────────────

test('AC8a screenshot 3: completed_state', async ({ page }) => {
  // Intercept SSE to return mock complete payload without real LLM calls
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
  await waitForFixtures(page);

  // Click run to start simulation
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for the completed state badge
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 30_000,
  });

  // Wait for metrics to be populated (not placeholder "—")
  await page.waitForFunction(
    () => {
      const baseline = document.querySelector('[data-testid="metric-baseline"]');
      return baseline && baseline.textContent !== '—' && baseline.textContent.trim().length > 1;
    },
    { timeout: 10_000 },
  );

  // Verify key result elements are visible
  await expect(page.locator('[data-testid="metric-baseline"]')).toBeVisible();
  await expect(page.locator('[data-testid="metric-final"]')).toBeVisible();
  await expect(page.locator('[data-testid="metric-holdout"]')).toBeVisible();
  await expect(page.locator('[data-testid="strategy-summary"]')).toBeVisible();
  await expect(page.locator('[data-testid="diff-output"]')).toBeVisible();

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '03-results-populated.png'),
    fullPage: true,
  });
});

// ── Screenshot 4: error_state ─────────────────────────────────────────────────

test('AC8a screenshot 4: error_state', async ({ page }) => {
  // Intercept SSE to return an error event
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
  await waitForFixtures(page);

  // Click run to trigger the error
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for error state
  await page.waitForSelector('[data-testid="state-error"]', {
    state: 'visible',
    timeout: 15_000,
  });

  // Verify error message is readable (non-empty)
  const errorEl = page.locator('[data-testid="state-error"]');
  await expect(errorEl).toBeVisible();
  const errorText = await errorEl.textContent();
  expect(errorText?.trim().length).toBeGreaterThan(5);

  // Run button must be re-enabled so user can retry
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '04-error-state.png'),
    fullPage: true,
  });
});
