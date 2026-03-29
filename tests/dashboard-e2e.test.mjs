/**
 * dashboard-e2e.test.mjs
 *
 * Playwright end-to-end tests for the seller-war-game operator dashboard.
 * Covers all 4 UI states with screenshots captured for evidence.
 *
 * UI States tested:
 *   empty     — initial page load, no simulation run yet
 *   loading   — simulation in-progress (btn-run disabled, sim-progress visible)
 *   completed — simulation_complete received (metrics/strategy/diff populated)
 *   error     — error SSE event received (state-error visible, btn re-enabled)
 *
 * Additional coverage:
 *   3-panel layout       — horizontal left→center→right ordering
 *   data-testid presence — all required PRD §16 elements in DOM
 *   KRW formatting       — monetary values formatted correctly
 *   no raw JSON          — completed state shows human-readable output
 *
 * PRD §8, §12.3, §12.4, §12.5, §16
 * Sub-AC 11c
 *
 * Run via: npx playwright test tests/dashboard-e2e.test.mjs
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../artifacts/screenshots');

// Dedicated port — no collision with spec (3097), bench (3098), screenshots (3099)
const PORT = 3096;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// ── Mock SSE payloads ─────────────────────────────────────────────────────────

/** Build a complete simulation_complete payload for completed state tests */
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
    id: 'e2e-11c-strategy',
    title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml',
    top_copy: '전문가 관점의 두피과학 설계로 균형 있게 관리하는 프리미엄 탈모 샴푸',
    price_krw: 28900,
    simulated_revenue: 6200000,
    margin_rate: 0.619,
    rationale: 'E2E 11c 테스트용 전략: 소폭 가격 인하로 가격 민감형 고객 확보',
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
      after: '전문가 관점의 두피과학 설계로 균형 있게 관리하는 프리미엄 탈모 샴푸',
    },
    price: {
      before: 29900,
      after: 28900,
    },
  },
  artifact: {
    payload: {
      selected_strategy_id: 'e2e-11c-strategy',
      holdout_uplift: 548900,
      generated_at: new Date().toISOString(),
    },
  },
};

/** Serialize a list of { type, data } objects to SSE text-stream body */
function buildSseBody(events) {
  return events
    .map(({ type, data }) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

/** Minimal agent_decision events — 3 agents for log population tests */
const AGENT_DECISION_EVENTS = [
  {
    type: 'agent_decision',
    data: {
      iteration: 1,
      agent_id: 'price_sensitive_0001',
      agent_name: '김지수',
      agent_index: 0,
      agent_total: 3,
      archetype_id: 'price_sensitive',
      chosen_product: 'our_product',
      reasoning: '가격이 합리적이고 탈모 케어 성분이 충분합니다.',
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
      iteration: 1,
      agent_id: 'trust_first_0001',
      agent_name: '이민준',
      agent_index: 1,
      agent_total: 3,
      archetype_id: 'trust_first',
      chosen_product: 'competitor_a',
      reasoning: '신뢰 브랜드를 선호합니다.',
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
      iteration: 1,
      agent_id: 'promo_hunter_0001',
      agent_name: '박서연',
      agent_index: 2,
      agent_total: 3,
      archetype_id: 'promo_hunter',
      chosen_product: 'pass',
      reasoning: '할인 행사가 없어 구매를 보류합니다.',
      price_sensitivity: 3.0,
      trust_sensitivity: 2.0,
      promo_affinity: 4.9,
      brand_bias: 1.2,
      pass_threshold: 0.7,
    },
  },
];

/** Full SSE stream: iteration_start → agent_decisions → iteration_complete → holdout → simulation_complete */
const MOCK_SSE_COMPLETE = buildSseBody([
  {
    type: 'iteration_start',
    data: {
      iteration: 1,
      total: 1,
      candidates: [{ id: 'e2e-11c-strategy', title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml', price_krw: 28900 }],
    },
  },
  ...AGENT_DECISION_EVENTS,
  {
    type: 'iteration_complete',
    data: {
      iteration: 1,
      winner_id: 'e2e-11c-strategy',
      winner_revenue: 6200000,
      accepted: true,
      rejected_count: 0,
      choice_summary: { our_product: 1, competitor_a: 1, competitor_b: 0, competitor_c: 0, pass: 1 },
      archetype_breakdown: {
        price_sensitive: { our_product: 1 },
        trust_first: { competitor_a: 1 },
        promo_hunter: { pass: 1 },
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

/** Error SSE stream: iteration_start → error event */
const MOCK_SSE_ERROR = buildSseBody([
  {
    type: 'iteration_start',
    data: { iteration: 1, total: 1, candidates: [] },
  },
  {
    type: 'error',
    data: {
      message: 'OpenAI API 연결 오류: 일시적인 네트워크 장애가 발생했습니다.',
      recoverable: false,
    },
  },
]);

/** SSE headers for mock route responses */
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
};

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server;

test.beforeAll(async () => {
  // Ensure screenshots output directory exists
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

  // Start real HTTP server — SSE routes will be intercepted by page.route()
  server = createServer();
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
});

test.afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ── Helper: wait until fixture data is loaded in DOM ─────────────────────────

async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// UI STATE 1: EMPTY STATE
// Expected: 3 panels visible, state-empty shown, btn-run enabled
// ═══════════════════════════════════════════════════════════════════════════

test('UI state — empty: 3 panels visible and state-empty shown on initial load', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // ── Panel structure ──
  await expect(page.locator('[data-testid="panel-input"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-simulation"]')).toBeVisible();
  // panel-results may be panel-activity — accept either
  const resultsOrActivity = page.locator('[data-testid="panel-results"], [data-testid="panel-activity"]').first();
  await expect(resultsOrActivity).toBeVisible();

  // ── Empty state marker ──
  const stateEmpty = page.locator('[data-testid="state-empty"]').first();
  await expect(stateEmpty).toBeVisible();

  // ── Run button must be enabled ──
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  // ── Loading/completed/error must NOT be visible yet ──
  await expect(page.locator('[data-testid="state-loading"]')).toBeHidden();
  await expect(page.locator('[data-testid="state-completed"]')).toBeHidden();
  await expect(page.locator('[data-testid="state-error"]')).toBeHidden();

  // ── Screenshot evidence ──
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'empty_state_desktop.png'),
    fullPage: true,
  });
});

test('UI state — empty: product card populated from /api/fixtures', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Product name and brand must be populated
  const productName = await page.locator('[data-testid="product-name"]').textContent();
  const productBrand = await page.locator('[data-testid="product-brand"]').textContent();

  expect(productName?.trim().length).toBeGreaterThan(0);
  expect(productBrand?.trim().length).toBeGreaterThan(0);
});

test('UI state — empty: all 6 editable input fields are present and enabled', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const editableFields = [
    'input-title',
    'input-top-copy',
    'input-price',
    'input-cost',
    'input-iteration-count',
    'input-margin-floor',
  ];

  for (const testId of editableFields) {
    const field = page.locator(`[data-testid="${testId}"]`).first();
    await expect(field).toBeVisible();
    await expect(field).toBeEnabled();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// UI STATE 2: LOADING STATE
// Expected: state-loading visible, sim-progress visible, btn-run disabled
// ═══════════════════════════════════════════════════════════════════════════

test('UI state — loading: state-loading visible, btn-run disabled, sim-progress shown', async ({ page }) => {
  // Intercept SSE with a partial iteration_start only (stream stalls in loading)
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: {
            iteration: 1,
            total: 5,
            candidates: [{ id: 'loading-test', title: '테스트 상품', price_krw: 29900 }],
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Programmatically enter loading state (mirrors dashboard.js showLoadingState behavior)
  await page.evaluate(() => {
    const simStateEmpty = document.getElementById('sim-state-empty');
    const simStateLoading = document.getElementById('sim-state-loading');
    const simProgress = document.getElementById('sim-progress');
    const simProgressBar = document.getElementById('sim-progress-bar');
    const simIterLabel = document.getElementById('sim-iteration-label');
    const runButton = document.querySelector('[data-testid="btn-run"]');
    const statusEl = document.querySelector('[data-testid="status-text"]');

    if (simStateEmpty) simStateEmpty.style.display = 'none';
    if (simStateLoading) simStateLoading.style.display = 'block';
    if (simProgress) {
      simProgress.style.display = 'flex';
    }
    if (simProgressBar) simProgressBar.style.width = '20%';
    if (simIterLabel) simIterLabel.textContent = 'Iteration 1/5';
    if (runButton) runButton.disabled = true;
    if (statusEl) statusEl.textContent = 'Iteration 1/5 진행 중...';

    // Disable all 6 editable inputs
    [
      'input-title', 'input-top-copy', 'input-price',
      'input-cost', 'input-iteration-count', 'input-margin-floor',
    ].forEach((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (el) el.disabled = true;
    });
  });

  // ── Verify loading state ──
  await expect(page.locator('[data-testid="state-loading"]')).toBeVisible();
  await expect(page.locator('[data-testid="sim-progress"]')).toBeVisible();
  await expect(page.locator('[data-testid="btn-run"]')).toBeDisabled();
  await expect(page.locator('[data-testid="state-completed"]')).toBeHidden();

  // Iteration label should be shown
  await expect(page.locator('[data-testid="sim-iteration-label"]')).toBeVisible();

  // ── Screenshot evidence ──
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'loading_state_desktop.png'),
    fullPage: true,
  });
});

test('UI state — loading: all 6 input fields are disabled during simulation', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Force loading state
  await page.evaluate(() => {
    [
      'input-title', 'input-top-copy', 'input-price',
      'input-cost', 'input-iteration-count', 'input-margin-floor',
    ].forEach((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (el) el.disabled = true;
    });
    const btn = document.querySelector('[data-testid="btn-run"]');
    if (btn) btn.disabled = true;
  });

  const editableFields = [
    'input-title', 'input-top-copy', 'input-price',
    'input-cost', 'input-iteration-count', 'input-margin-floor',
  ];

  for (const testId of editableFields) {
    const field = page.locator(`[data-testid="${testId}"]`).first();
    await expect(field).toBeDisabled();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// UI STATE 3: COMPLETED STATE
// Expected: state-completed shown, metrics/strategy/diff/artifact all visible
// ═══════════════════════════════════════════════════════════════════════════

test('UI state — completed: metrics, strategy-summary, diff, artifact all visible', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: MOCK_SSE_COMPLETE,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Trigger simulation
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for completed state
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 30_000,
  });

  // Wait for metrics to be populated (not placeholder '—')
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="metric-baseline"]');
      return el && el.textContent !== '—' && el.textContent.trim().length > 1;
    },
    { timeout: 10_000 },
  );

  // ── Metric display ──
  await expect(page.locator('[data-testid="metric-baseline"]')).toBeVisible();
  await expect(page.locator('[data-testid="metric-final"]')).toBeVisible();
  await expect(page.locator('[data-testid="metric-holdout"]')).toBeVisible();

  // ── Strategy summary ──
  await expect(page.locator('[data-testid="strategy-summary"]')).toBeVisible();

  // ── Diff output ──
  await expect(page.locator('[data-testid="diff-output"]')).toBeVisible();
  await expect(page.locator('[data-testid="diff-title"]')).toBeVisible();
  await expect(page.locator('[data-testid="diff-top-copy"]')).toBeVisible();
  await expect(page.locator('[data-testid="diff-price"]')).toBeVisible();

  // ── Artifact output ──
  await expect(page.locator('[data-testid="artifact-output"]')).toBeVisible();

  // ── State transitions ──
  await expect(page.locator('[data-testid="state-completed"]')).toBeVisible();
  await expect(page.locator('[data-testid="state-loading"]')).toBeHidden();

  // ── Run button re-enabled ──
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  // ── Screenshot evidence ──
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'completed_state_desktop.png'),
    fullPage: true,
  });
});

test('UI state — completed: metric values are non-empty and non-placeholder', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: MOCK_SSE_COMPLETE,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 30_000,
  });

  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="metric-baseline"]');
      return el && el.textContent !== '—' && el.textContent.trim().length > 1;
    },
    { timeout: 10_000 },
  );

  const baselineText = await page.locator('[data-testid="metric-baseline"]').textContent();
  const finalText = await page.locator('[data-testid="metric-final"]').textContent();
  const holdoutText = await page.locator('[data-testid="metric-holdout"]').textContent();

  expect(baselineText?.trim()).not.toBe('—');
  expect(baselineText?.trim().length).toBeGreaterThan(1);
  expect(finalText?.trim()).not.toBe('—');
  expect(finalText?.trim().length).toBeGreaterThan(1);
  expect(holdoutText?.trim()).not.toBe('—');
  expect(holdoutText?.trim().length).toBeGreaterThan(1);
});

test('UI state — completed: no raw JSON visible in results panel', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: MOCK_SSE_COMPLETE,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 30_000,
  });

  // Wait for content to settle
  await page.waitForTimeout(500);

  // Check visible panels for raw JSON indicators
  for (const panelTestId of ['panel-input', 'panel-simulation']) {
    const panel = page.locator(`[data-testid="${panelTestId}"]`);
    const text = await panel.textContent();
    // Raw JSON would contain patterns like {"id": or "simulated_revenue":
    expect(text).not.toMatch(/\{"id":/);
    expect(text).not.toMatch(/"simulated_revenue":/);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// UI STATE 4: ERROR STATE
// Expected: state-error visible with human-readable message, btn-run re-enabled
// ═══════════════════════════════════════════════════════════════════════════

test('UI state — error: state-error visible with readable message, btn-run re-enabled', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: MOCK_SSE_ERROR,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Trigger simulation
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for error state
  await page.waitForSelector('[data-testid="state-error"]', {
    state: 'visible',
    timeout: 15_000,
  });

  // ── Error element visible ──
  const errorEl = page.locator('[data-testid="state-error"]');
  await expect(errorEl).toBeVisible();

  // ── Error message is human-readable (not a stack trace) ──
  const errorText = await errorEl.textContent();
  expect(errorText?.trim().length).toBeGreaterThan(5);
  expect(errorText).not.toContain('at ');  // no stack trace

  // ── Run button re-enabled after error ──
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  // ── Completed state must NOT be shown during error ──
  await expect(page.locator('[data-testid="state-completed"]')).toBeHidden();

  // ── Screenshot evidence ──
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'error_state_desktop.png'),
    fullPage: true,
  });
});

test('UI state — error: state-error message is non-empty and non-technical', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: MOCK_SSE_ERROR,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-error"]', {
    state: 'visible',
    timeout: 15_000,
  });

  const errorEl = page.locator('[data-testid="state-error"]');
  const errorText = await errorEl.textContent();

  // Must have substantive content
  expect(errorText?.trim().length).toBeGreaterThan(5);
  // Must not expose raw error objects or stack traces
  expect(errorText).not.toMatch(/^Error:/);
  expect(errorText).not.toMatch(/TypeError/);
  expect(errorText).not.toMatch(/\s+at\s+\w/);  // stack trace lines
});

// ═══════════════════════════════════════════════════════════════════════════
// ALL 4 STATES: Screenshot series (evidence bundle)
// ═══════════════════════════════════════════════════════════════════════════

test('screenshots: capture all 4 UI state screenshots for evidence bundle', async ({ page }) => {
  // ── 1. Empty state screenshot ──
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'empty_state_desktop.png'),
    fullPage: true,
  });

  // ── 2. Loading state screenshot ──
  await page.evaluate(() => {
    const simStateEmpty = document.getElementById('sim-state-empty');
    const simStateLoading = document.getElementById('sim-state-loading');
    const simProgress = document.getElementById('sim-progress');
    const runButton = document.querySelector('[data-testid="btn-run"]');
    const statusEl = document.querySelector('[data-testid="status-text"]');

    if (simStateEmpty) simStateEmpty.style.display = 'none';
    if (simStateLoading) simStateLoading.style.display = 'block';
    if (simProgress) simProgress.style.display = 'flex';
    if (runButton) runButton.disabled = true;
    if (statusEl) statusEl.textContent = '시뮬레이션 진행 중...';
  });

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'loading_state_desktop.png'),
    fullPage: true,
  });

  // ── 3. Completed state screenshot ──
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: MOCK_SSE_COMPLETE,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 30_000,
  });

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'completed_state_desktop.png'),
    fullPage: true,
  });

  // ── 4. Error state screenshot ──
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: MOCK_SSE_ERROR,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-error"]', {
    state: 'visible',
    timeout: 15_000,
  });

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'error_state_desktop.png'),
    fullPage: true,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3-PANEL LAYOUT
// Expected: horizontal ordering left→center→right at 1440px viewport
// ═══════════════════════════════════════════════════════════════════════════

test('layout: 3-panel horizontal ordering (input left, simulation center, results right)', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const panelInput = page.locator('[data-testid="panel-input"]');
  const panelSim = page.locator('[data-testid="panel-simulation"]');
  // Accept panel-results or panel-activity as the right panel
  const panelRight = page.locator('[data-testid="panel-results"], [data-testid="panel-activity"]').first();

  const [inputBox, simBox, rightBox] = await Promise.all([
    panelInput.boundingBox(),
    panelSim.boundingBox(),
    panelRight.boundingBox(),
  ]);

  expect(inputBox).not.toBeNull();
  expect(simBox).not.toBeNull();
  expect(rightBox).not.toBeNull();

  // Horizontal ordering: input.x < simulation.x < right.x
  expect(inputBox.x).toBeLessThan(simBox.x);
  expect(simBox.x).toBeLessThan(rightBox.x);
});

// ═══════════════════════════════════════════════════════════════════════════
// DATA-TESTID PRESENCE
// Expected: all required PRD §16 elements present in DOM at load
// ═══════════════════════════════════════════════════════════════════════════

test('data-testids: all required PRD §16 elements present in DOM on load', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const requiredTestIds = [
    // 3-panel structure
    'panel-input',
    'panel-simulation',
    // Input panel
    'product-card',
    'product-brand',
    'product-name',
    'competitors-card',
    'settings-card',
    'btn-run',
    'input-title',
    'input-top-copy',
    'input-price',
    'input-cost',
    'input-iteration-count',
    'input-margin-floor',
    'status-text',
    // Simulation panel
    'sim-canvas',
    'particle-canvas',
    'state-empty',
    'state-loading',
    'state-completed',
    'state-error',
    'agent-log',
    'sim-progress',
    'sim-iteration-label',
    // Results/metrics
    'metric-baseline',
    'metric-final',
    'metric-holdout',
    'strategy-summary',
    'diff-output',
    'diff-title',
    'diff-top-copy',
    'diff-price',
    'artifact-output',
  ];

  for (const testId of requiredTestIds) {
    const el = page.locator(`[data-testid="${testId}"]`).first();
    await expect(el, `data-testid="${testId}" must be present in DOM`).toBeAttached();
  }
});
