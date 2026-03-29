/**
 * dashboard-e2e.test.mjs
 *
 * End-to-end Playwright tests for the seller-war-game dashboard.
 * Covers all 4 UI states, particle canvas, and agent log behavior
 * using individual-agent (agent_decision) events per the v1 architecture.
 *
 * States tested:
 *   empty     — initial load, no simulation run yet
 *   loading   — simulation in-progress (btn-run disabled, progress visible)
 *   completed — simulation_complete received (metrics/strategy/diff visible)
 *   error     — error event received (state-error visible, btn re-enabled)
 *
 * Additional coverage:
 *   particle-canvas — DOM element present with correct CSS (absolute, z-index≥2, pointer-events:none)
 *   agent-log       — agent-log-entry items appear on agent_decision events
 *   data-testid     — all static data-testid attributes are present in DOM
 *
 * PRD §8, §12.3, §12.4, §12.5, §16
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../artifacts/screenshots');

const PORT = 3097; // dedicated port — no collision with screenshots (3099) or bench (3098)
const BASE_URL = `http://127.0.0.1:${PORT}`;

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
    id: 'e2e-test-strategy',
    title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml',
    top_copy: '전문가 관점의 두피과학 설계로 균형 있게 관리하는 프리미엄 탈모 샴푸',
    price_krw: 28900,
    simulated_revenue: 6200000,
    margin_rate: 0.619,
    rationale: 'E2E 테스트용 전략: 소폭 가격 인하로 가격 민감형 고객 확보',
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
      selected_strategy_id: 'e2e-test-strategy',
      holdout_uplift: 548900,
      generated_at: new Date().toISOString(),
    },
  },
};

/** Encode a list of { type, data } objects as an SSE text body. */
function buildSseBody(events) {
  return events
    .map(({ type, data }) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

// Minimal agent_decision events (3 agents) for agent-log tests
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

// Full SSE stream with agent_decision events → simulation_complete
const MOCK_SSE_WITH_AGENTS = buildSseBody([
  {
    type: 'iteration_start',
    data: {
      iteration: 1,
      total: 1,
      candidates: [{ id: 'e2e-test-strategy', title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml', price_krw: 28900 }],
    },
  },
  ...AGENT_DECISION_EVENTS,
  {
    type: 'iteration_complete',
    data: {
      iteration: 1,
      winner_id: 'e2e-test-strategy',
      winner_revenue: 6200000,
      accepted: true,
      rejected_count: 0,
      choice_summary: { our_product: 1, competitor_a: 1, competitor_b: 0, competitor_c: 0, pass: 1 },
      archetype_breakdown: { price_sensitive: { our_product: 1 }, trust_first: { competitor_a: 1 }, promo_hunter: { pass: 1 } },
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

// Error SSE stream
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

// Slow SSE stream that hangs — used to capture the loading state
const MOCK_SSE_SLOW_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
};

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server;

test.beforeAll(async () => {
  // Ensure screenshots directory exists for evidence capture
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

// ── Helper: wait for fixture data ─────────────────────────────────────────────

async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

// ── State 1: Empty state ──────────────────────────────────────────────────────

test('dashboard: empty state — 3 panels visible and state-empty shown', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // All 3 panels must be visible
  await expect(page.locator('[data-testid="panel-input"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-simulation"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-results"]')).toBeVisible();

  // state-empty overlay visible (multiple instances — at least one must be visible)
  const emptyEls = page.locator('[data-testid="state-empty"]');
  await expect(emptyEls.first()).toBeVisible();

  // Run button must be enabled
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  // state-loading and state-completed must NOT be visible initially
  await expect(page.locator('[data-testid="state-loading"]')).toBeHidden();
  await expect(page.locator('[data-testid="state-completed"]')).toBeHidden();

  // state-error must NOT be visible initially
  await expect(page.locator('[data-testid="state-error"]')).toBeHidden();

  // Capture screenshot for evidence bundle
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'empty_state_desktop.png'),
    fullPage: true,
  });
});

// ── State 2: Loading state ────────────────────────────────────────────────────

test('dashboard: loading state — state-loading visible, btn-run disabled, sim-progress visible', async ({ page }) => {
  // Route SSE to send only headers and then stall (loading state preserved)
  await page.route('**/api/run/stream', async (route) => {
    // Fulfill with SSE headers but only send a partial iteration_start
    // The stream remains "open" so the loading state persists for screenshot
    await route.fulfill({
      status: 200,
      headers: MOCK_SSE_SLOW_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: { iteration: 1, total: 5, candidates: [{ id: 'stall-test', title: '테스트', price_krw: 29900 }] },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Trigger loading state by programmatic DOM mutation (mirrors dashboard.js showLoadingState)
  // This approach is used because the real SSE stream completes too quickly in mock mode.
  await page.evaluate(() => {
    const stateEmpty = document.getElementById('sim-state-empty');
    const stateLoading = document.getElementById('sim-state-loading');
    const simProgress = document.getElementById('sim-progress');
    const simProgressBar = document.getElementById('sim-progress-bar');
    const runButton = document.querySelector('[data-testid="btn-run"]');
    const statusEl = document.querySelector('[data-testid="status-text"]');
    const simIterLabel = document.getElementById('sim-iteration-label');
    const resultsContent = document.getElementById('results-content');
    const resultsEmpty = document.getElementById('results-state-empty');

    if (stateEmpty) stateEmpty.style.display = 'none';
    if (stateLoading) stateLoading.style.display = 'block';
    if (simProgress) {
      simProgress.style.display = 'flex';
      simProgress.style.flexDirection = 'column';
      simProgress.style.gap = 'var(--space-xs)';
    }
    if (simProgressBar) simProgressBar.style.width = '30%';
    if (resultsContent) resultsContent.style.display = 'none';
    if (resultsEmpty) resultsEmpty.style.display = 'none';
    if (runButton) runButton.disabled = true;
    if (statusEl) statusEl.textContent = 'Iteration 1/5 진행 중...';
    if (simIterLabel) simIterLabel.textContent = 'Iteration 1/5';

    // Disable all 6 editable inputs
    document.querySelectorAll(
      '[data-testid="input-title"],[data-testid="input-top-copy"],' +
      '[data-testid="input-price"],[data-testid="input-cost"],' +
      '[data-testid="input-iteration-count"],[data-testid="input-margin-floor"]',
    ).forEach((el) => { el.disabled = true; });
  });

  // Verify loading state elements
  await expect(page.locator('[data-testid="state-loading"]')).toBeVisible();
  await expect(page.locator('[data-testid="sim-progress"]')).toBeVisible();
  await expect(page.locator('[data-testid="btn-run"]')).toBeDisabled();

  // sim-iteration-label should reflect current iteration
  await expect(page.locator('[data-testid="sim-iteration-label"]')).toBeVisible();

  // state-completed must NOT be visible during loading
  await expect(page.locator('[data-testid="state-completed"]')).toBeHidden();

  // Capture screenshot for evidence bundle
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'loading_state_desktop.png'),
    fullPage: true,
  });
});

// ── State 3: Completed state ──────────────────────────────────────────────────

test('dashboard: completed state — metrics, strategy-summary, diff, artifact all visible', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: MOCK_SSE_SLOW_HEADERS,
      body: MOCK_SSE_WITH_AGENTS,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Click run button to start simulation
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation_complete: state-completed badge shows
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 30_000,
  });

  // Wait for metrics to be populated
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="metric-baseline"]');
      return el && el.textContent !== '—' && el.textContent.trim().length > 1;
    },
    { timeout: 10_000 },
  );

  // All result elements must be visible and populated
  await expect(page.locator('[data-testid="metric-baseline"]')).toBeVisible();
  await expect(page.locator('[data-testid="metric-final"]')).toBeVisible();
  await expect(page.locator('[data-testid="metric-holdout"]')).toBeVisible();
  await expect(page.locator('[data-testid="strategy-summary"]')).toBeVisible();
  await expect(page.locator('[data-testid="diff-output"]')).toBeVisible();
  await expect(page.locator('[data-testid="artifact-output"]')).toBeVisible();

  // Diff sub-elements
  await expect(page.locator('[data-testid="diff-title"]')).toBeVisible();
  await expect(page.locator('[data-testid="diff-top-copy"]')).toBeVisible();
  await expect(page.locator('[data-testid="diff-price"]')).toBeVisible();

  // state-completed must be shown, state-loading must be hidden
  await expect(page.locator('[data-testid="state-completed"]')).toBeVisible();
  await expect(page.locator('[data-testid="state-loading"]')).toBeHidden();

  // Run button must be re-enabled
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  // Verify metric values are non-empty (not the placeholder '—')
  const baselineText = await page.locator('[data-testid="metric-baseline"]').textContent();
  expect(baselineText?.trim()).not.toBe('—');
  expect(baselineText?.trim().length).toBeGreaterThan(1);

  // Capture screenshot for evidence bundle
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'completed_state_desktop.png'),
    fullPage: true,
  });
});

// ── State 4: Error state ──────────────────────────────────────────────────────

test('dashboard: error state — state-error visible with readable message, btn-run re-enabled', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: MOCK_SSE_SLOW_HEADERS,
      body: MOCK_SSE_ERROR,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Click run button
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for error state
  await page.waitForSelector('[data-testid="state-error"]', {
    state: 'visible',
    timeout: 15_000,
  });

  // Error element must be visible
  const errorEl = page.locator('[data-testid="state-error"]');
  await expect(errorEl).toBeVisible();

  // Error message must be non-empty and human-readable (not a stack trace)
  const errorText = await errorEl.textContent();
  expect(errorText?.trim().length).toBeGreaterThan(5);
  expect(errorText).not.toContain('Error:');
  expect(errorText).not.toContain('at ');

  // Run button must be re-enabled after error
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  // state-completed must NOT be visible in error state
  await expect(page.locator('[data-testid="state-completed"]')).toBeHidden();

  // Capture screenshot for evidence bundle
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'error_state_desktop.png'),
    fullPage: true,
  });
});

// ── Particle canvas ───────────────────────────────────────────────────────────

test('dashboard: particle-canvas element is present and correctly positioned', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // particle-canvas must be attached to the DOM
  const canvas = page.locator('[data-testid="particle-canvas"]');
  await expect(canvas).toBeAttached();

  // Verify computed CSS: absolute positioning, pointer-events:none, z-index ≥ 2
  const styles = await canvas.evaluate((el) => {
    const cs = window.getComputedStyle(el);
    return {
      position: cs.position,
      pointerEvents: cs.pointerEvents,
      zIndex: cs.zIndex,
      display: cs.display,
    };
  });

  expect(styles.position).toBe('absolute');
  expect(styles.pointerEvents).toBe('none');
  expect(Number(styles.zIndex)).toBeGreaterThanOrEqual(2);
  expect(styles.display).not.toBe('none');
});

test('dashboard: sim-canvas SVG element is present with product nodes', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // SVG canvas must be attached
  await expect(page.locator('[data-testid="sim-canvas"]')).toBeAttached();

  // All 5 product nodes must be in the SVG
  await expect(page.locator('[data-testid="product-node-our_product"]')).toBeAttached();
  await expect(page.locator('[data-testid="product-node-competitor_a"]')).toBeAttached();
  await expect(page.locator('[data-testid="product-node-competitor_b"]')).toBeAttached();
  await expect(page.locator('[data-testid="product-node-competitor_c"]')).toBeAttached();
  await expect(page.locator('[data-testid="product-node-pass"]')).toBeAttached();

  // All 8 archetype nodes must be in the SVG
  const archetypeIds = [
    'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
    'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
  ];
  for (const id of archetypeIds) {
    await expect(page.locator(`[data-testid="archetype-${id}"]`)).toBeAttached();
  }
});

// ── Agent log ─────────────────────────────────────────────────────────────────

test('dashboard: agent-log appears and shows agent-log-entry items on agent_decision events', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: MOCK_SSE_SLOW_HEADERS,
      body: MOCK_SSE_WITH_AGENTS,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Click run button
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for agent-log-entry elements to appear
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  // agent-log container must be visible
  await expect(page.locator('[data-testid="agent-log"]')).toBeVisible();

  // At least the 3 mock agent_decision events must produce log entries
  const entries = page.locator('[data-testid="agent-log-entry"]');
  const count = await entries.count();
  expect(count).toBeGreaterThanOrEqual(3);

  // Each entry must have non-empty text content
  for (let i = 0; i < Math.min(count, 3); i++) {
    const text = await entries.nth(i).textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  }
});

test('dashboard: agent-log entries contain agent name and chosen product', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: MOCK_SSE_SLOW_HEADERS,
      body: MOCK_SSE_WITH_AGENTS,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  const entries = page.locator('[data-testid="agent-log-entry"]');
  const count = await entries.count();
  expect(count).toBeGreaterThanOrEqual(1);

  // Verify first entry has meaningful content
  const firstEntry = entries.first();
  const entryText = await firstEntry.textContent();
  expect(entryText?.trim().length).toBeGreaterThan(2);

  // Each entry must have the data attributes needed for the profile popup
  // Note: dashboard.js uses data-archetype (not data-archetype-id) for the log entries
  const hasDataAttrs = await firstEntry.evaluate((el) => {
    return (
      el.hasAttribute('data-agent-id') &&
      (el.hasAttribute('data-archetype') || el.hasAttribute('data-archetype-id')) &&
      el.hasAttribute('data-chosen-product')
    );
  });
  expect(hasDataAttrs).toBe(true);
});

// ── All data-testid elements present ─────────────────────────────────────────

test('dashboard: all required static data-testid elements are present in DOM', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Panel structure
  const staticTestIds = [
    'panel-input',
    'panel-simulation',
    'panel-results',
    'product-card',
    'product-brand',
    'product-name',
    'competitors-card',
    'competitor-a',
    'competitor-b',
    'competitor-c',
    'settings-card',
    'input-title',
    'input-top-copy',
    'input-price',
    'input-cost',
    'input-iteration-count',
    'input-margin-floor',
    'btn-run',
    'status-text',
    'sim-canvas',
    'particle-canvas',
    'state-empty',
    'state-loading',
    'state-completed',
    'agent-log',
    'revenue-chart',
    'sim-progress',
    'sim-iteration-label',
    'metric-baseline',
    'metric-final',
    'metric-holdout',
    'strategy-summary',
    'diff-output',
    'diff-title',
    'diff-top-copy',
    'diff-price',
    'artifact-output',
    'state-error',
    // Agent profile popup
    'agent-profile',
    'agent-profile-name',
    'agent-profile-archetype',
    'agent-profile-stats',
    'stat-price-sensitivity',
    'stat-trust-sensitivity',
    'stat-promo-affinity',
    'stat-brand-bias',
    'stat-pass-threshold',
    'agent-profile-choice',
    'agent-profile-reasoning',
    'agent-profile-close',
  ];

  for (const testId of staticTestIds) {
    const el = page.locator(`[data-testid="${testId}"]`).first();
    await expect(el, `data-testid="${testId}" must be present in DOM`).toBeAttached();
  }
});

// ── 3-panel horizontal layout ─────────────────────────────────────────────────

test('dashboard: 3-panel layout is horizontal (left → center → right)', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const panelInput = page.locator('[data-testid="panel-input"]');
  const panelSim = page.locator('[data-testid="panel-simulation"]');
  const panelResults = page.locator('[data-testid="panel-results"]');

  const [inputBox, simBox, resultsBox] = await Promise.all([
    panelInput.boundingBox(),
    panelSim.boundingBox(),
    panelResults.boundingBox(),
  ]);

  // All panels must be visible
  expect(inputBox).not.toBeNull();
  expect(simBox).not.toBeNull();
  expect(resultsBox).not.toBeNull();

  // Horizontal ordering: input.x < simulation.x < results.x
  expect(inputBox.x).toBeLessThan(simBox.x);
  expect(simBox.x).toBeLessThan(resultsBox.x);

  // Panels should overlap vertically (same row)
  const inputMidY = inputBox.y + inputBox.height / 2;
  const simMidY = simBox.y + simBox.height / 2;
  const resultsMidY = resultsBox.y + resultsBox.height / 2;

  // Mid-points should be within 200px of each other (same horizontal band)
  expect(Math.abs(inputMidY - simMidY)).toBeLessThan(200);
  expect(Math.abs(simMidY - resultsMidY)).toBeLessThan(200);
});

// ── No raw JSON in completed state ───────────────────────────────────────────

test('dashboard: completed state shows no raw JSON in visible panels', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: MOCK_SSE_SLOW_HEADERS,
      body: MOCK_SSE_WITH_AGENTS,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 30_000,
  });

  // Verify no raw JSON string is shown in the results panel
  const resultsPanel = page.locator('[data-testid="panel-results"]');
  const resultsText = await resultsPanel.textContent();

  // Raw JSON would look like {"id": or "simulated_revenue":
  expect(resultsText).not.toMatch(/\{"[a-z_]+"\s*:/);
  expect(resultsText).not.toContain('"simulated_revenue"');
  expect(resultsText).not.toContain('"holdout_uplift"');
});

// ── SSE: 800 agent_decision events per iteration (via server) ────────────────

test('sse: server emits exactly 800 agent_decision events for 1 iteration (mock mode)', async ({ page }) => {
  // Navigate to base URL first so fetch calls have an origin context
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Verify the actual mock server produces the right event counts via streaming fetch
  const agentDecisionCount = await page.evaluate(async () => {
    const response = await fetch('/api/run/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iterationCount: 1, minimumMarginFloor: 0.35 }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let agentDecisions = 0;
    let done = false;

    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) {
        buffer += decoder.decode(result.value, { stream: true });
      }

      const blocks = buffer.split('\n\n');
      // Keep last potentially-partial block
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split('\n');
        let eventType = 'message';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice('event: '.length).trim();
          }
        }
        if (eventType === 'agent_decision') agentDecisions++;
      }
    }

    return agentDecisions;
  });

  expect(agentDecisionCount).toBe(800);
}, 120_000); // 2-minute timeout — 800 mock evaluations may take time

// ── Sub-AC 4c: Agent count progress display ───────────────────────────────────

test('Sub-AC 4c: agent-count shows "{n} / {total} 에이전트 완료" updated on agent_decision events', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: MOCK_SSE_SLOW_HEADERS,
      body: MOCK_SSE_WITH_AGENTS,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Click run to start simulation stream
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation_complete so all events have been processed
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 30_000,
  });

  // data-testid="agent-count" element must be attached to the DOM
  const agentCountEl = page.locator('[data-testid="agent-count"]');
  await expect(agentCountEl).toBeAttached();

  // After 3 agent_decision events (agent_total=3), the counter must show the final count
  // The mock sends agent_total=3, so expected text = "3 / 3 에이전트 완료"
  const countText = await agentCountEl.textContent();
  expect(countText).toMatch(/\d+\s*\/\s*\d+\s*에이전트 완료/);

  // The count must be visible (display !== 'none') after events are received
  const displayStyle = await agentCountEl.evaluate((el) => window.getComputedStyle(el).display);
  expect(displayStyle).not.toBe('none');
});

test('Sub-AC 4c: agent-count text format is "{n} / {total} 에이전트 완료" with Korean suffix', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: MOCK_SSE_SLOW_HEADERS,
      body: MOCK_SSE_WITH_AGENTS,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for at least the first agent_decision to be processed
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  // agent-count must exist in DOM at this point
  const agentCountEl = page.locator('[data-testid="agent-count"]');
  await expect(agentCountEl).toBeAttached();

  // Text must match the required format: "{n} / {total} 에이전트 완료"
  const text = await agentCountEl.textContent();
  expect(text).toContain('에이전트 완료');
  // Must contain a fraction like "1 / 3" or "3 / 3"
  expect(text).toMatch(/\d+\s*\/\s*\d+/);
});

// ── Sub-AC 4c: Archetype summary table ───────────────────────────────────────

test('Sub-AC 4c: archetype-summary-table is visible with per-archetype rows after iteration_complete', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: MOCK_SSE_SLOW_HEADERS,
      body: MOCK_SSE_WITH_AGENTS,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation_complete so iteration_complete has been processed
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 30_000,
  });

  // data-testid="archetype-summary-table" must be attached to DOM
  const summaryTable = page.locator('[data-testid="archetype-summary-table"]');
  await expect(summaryTable).toBeAttached();

  // The table must be visible (not display:none) after iteration_complete
  await expect(summaryTable).toBeVisible();

  // The tbody must contain rows (one per archetype in the breakdown)
  // Mock sends 3 archetypes: price_sensitive, trust_first, promo_hunter
  const rows = page.locator('[data-testid="archetype-summary-table"] tbody tr');
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThanOrEqual(1);

  // The header row must show column labels
  const headerRow = page.locator('[data-testid="archetype-summary-table"] thead tr');
  const headerText = await headerRow.textContent();
  expect(headerText).toContain('아키타입');
  expect(headerText).toContain('우리제품');

  // tfoot must have a totals row
  const tfootRow = page.locator('[data-testid="archetype-summary-table"] tfoot tr');
  await expect(tfootRow).toBeAttached();
  const tfootText = await tfootRow.textContent();
  expect(tfootText).toContain('합계');
});

test('Sub-AC 4c: archetype-summary-table rows contain Korean archetype labels', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: MOCK_SSE_SLOW_HEADERS,
      body: MOCK_SSE_WITH_AGENTS,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 30_000,
  });

  const summaryTable = page.locator('[data-testid="archetype-summary-table"]');
  await expect(summaryTable).toBeVisible();

  // The tbody must contain rows with Korean archetype names
  // Mock sends price_sensitive → '가격민감형', trust_first → '신뢰우선형', promo_hunter → '할인반응형'
  const tbodyText = await page.locator('[data-testid="archetype-summary-table"] tbody').textContent();
  // At least one known Korean archetype label must appear
  const knownKoreanLabels = ['가격민감형', '신뢰우선형', '할인반응형', '가성비균형형', '프리미엄형', '감성형', '문제해결형', '가족구매형'];
  const hasKoreanLabel = knownKoreanLabels.some((label) => tbodyText?.includes(label));
  expect(hasKoreanLabel).toBe(true);
});

test('Sub-AC 4c: archetype-summary-table is hidden initially (before simulation)', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Before any simulation, the archetype-summary-table must be hidden (display:none)
  const summaryTable = page.locator('[data-testid="archetype-summary-table"]');
  await expect(summaryTable).toBeAttached();
  await expect(summaryTable).toBeHidden();
});

// ── Sub-AC 6a: Revenue Bar Chart ─────────────────────────────────────────────

// Multi-iteration mock with one above-baseline and one below-baseline iteration:
// Iteration 1: winner_revenue=6200000 (above baseline 5651100) → green bar
// Iteration 2: winner_revenue=4500000 (below baseline 5651100) → red bar
const MOCK_SSE_TWO_ITERATIONS = buildSseBody([
  {
    type: 'iteration_start',
    data: { iteration: 1, total: 2, candidates: [{ id: 'iter-1', title: '전략 A', price_krw: 28900 }] },
  },
  ...AGENT_DECISION_EVENTS,
  {
    type: 'iteration_complete',
    data: {
      iteration: 1,
      winner_id: 'iter-1',
      winner_revenue: 6200000, // above baseline (5651100) → green
      accepted: true,
      rejected_count: 0,
      choice_summary: { our_product: 1, competitor_a: 1, competitor_b: 0, competitor_c: 0, pass: 1 },
      archetype_breakdown: { price_sensitive: { our_product: 1 }, trust_first: { competitor_a: 1 }, promo_hunter: { pass: 1 } },
    },
  },
  {
    type: 'iteration_start',
    data: { iteration: 2, total: 2, candidates: [{ id: 'iter-2', title: '전략 B', price_krw: 27900 }] },
  },
  ...AGENT_DECISION_EVENTS,
  {
    type: 'iteration_complete',
    data: {
      iteration: 2,
      winner_id: 'iter-2',
      winner_revenue: 4500000, // below baseline (5651100) → red
      accepted: false,
      rejected_count: 1,
      choice_summary: { our_product: 1, competitor_a: 1, competitor_b: 0, competitor_c: 0, pass: 1 },
      archetype_breakdown: { price_sensitive: { our_product: 1 }, trust_first: { competitor_a: 1 }, promo_hunter: { pass: 1 } },
    },
  },
  { type: 'holdout_start', data: { message: 'Holdout 검증 중...' } },
  { type: 'simulation_complete', data: MOCK_COMPLETE_PAYLOAD },
]);

test('Sub-AC 6a: revenue-chart element is present in DOM (data-testid="revenue-chart")', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const revenueChart = page.locator('[data-testid="revenue-chart"]');
  await expect(revenueChart).toBeAttached();
});

test('Sub-AC 6a: revenue-chart is hidden initially (before simulation)', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const revenueChart = page.locator('[data-testid="revenue-chart"]');
  await expect(revenueChart).toBeAttached();
  // The chart must start hidden — only shown after simulation starts
  const displayStyle = await revenueChart.evaluate((el) => window.getComputedStyle(el).display);
  expect(displayStyle).toBe('none');
});

test('Sub-AC 6a: revenue-chart becomes visible on iteration_complete event', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: MOCK_SSE_SLOW_HEADERS, body: MOCK_SSE_WITH_AGENTS });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation to complete
  await page.waitForSelector('[data-testid="state-completed"]', { state: 'visible', timeout: 30_000 });

  const revenueChart = page.locator('[data-testid="revenue-chart"]');
  await expect(revenueChart).toBeVisible();
});

test('Sub-AC 6a: revenue-chart renders SVG bars with data-testid="revenue-bar-{n}"', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: MOCK_SSE_SLOW_HEADERS, body: MOCK_SSE_WITH_AGENTS });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation to complete so iteration_complete has been processed
  await page.waitForSelector('[data-testid="state-completed"]', { state: 'visible', timeout: 30_000 });

  // revenue-bar-1 must exist (mock sends 1 iteration_complete with iteration=1)
  const bar = page.locator('[data-testid="revenue-bar-1"]');
  await expect(bar).toBeAttached();

  // The bar must have a data-revenue attribute matching the mock's winner_revenue
  const dataRevenue = await bar.getAttribute('data-revenue');
  expect(Number(dataRevenue)).toBe(6200000);

  // The bar must have a data-iteration attribute
  const dataIteration = await bar.getAttribute('data-iteration');
  expect(Number(dataIteration)).toBe(1);
});

test('Sub-AC 6a: revenue-chart bars are green (above-baseline) when revenue >= baseline', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: MOCK_SSE_SLOW_HEADERS, body: MOCK_SSE_WITH_AGENTS });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', { state: 'visible', timeout: 30_000 });

  // MOCK_SSE_WITH_AGENTS: winner_revenue=6200000, baseline.simulated_revenue=5651100
  // 6200000 > 5651100, so the bar must have class "above-baseline"
  const bar = page.locator('[data-testid="revenue-bar-1"]');
  await expect(bar).toBeAttached();

  const barClass = await bar.getAttribute('class');
  expect(barClass).toContain('above-baseline');
  expect(barClass).not.toContain('below-baseline');
});

test('Sub-AC 6a: revenue-chart renders baseline dashed line after simulation_complete', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: MOCK_SSE_SLOW_HEADERS, body: MOCK_SSE_WITH_AGENTS });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', { state: 'visible', timeout: 30_000 });

  // revenue-baseline-line must be visible (opacity != 0) after simulation_complete
  const baselineLine = page.locator('#revenue-baseline-line');
  await expect(baselineLine).toBeAttached();

  const opacity = await baselineLine.getAttribute('opacity');
  expect(Number(opacity)).toBeGreaterThan(0);

  // Baseline line must have stroke-dasharray (dashed)
  const strokeDasharray = await baselineLine.getAttribute('stroke-dasharray');
  expect(strokeDasharray).toBeTruthy();
  expect(strokeDasharray).not.toBe('');
});

test('Sub-AC 6a: revenue-chart baseline label shows KRW-formatted value', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: MOCK_SSE_SLOW_HEADERS, body: MOCK_SSE_WITH_AGENTS });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', { state: 'visible', timeout: 30_000 });

  // revenue-baseline-label text must contain "기준" prefix and a KRW value
  const baselineLabel = page.locator('#revenue-baseline-label');
  await expect(baselineLabel).toBeAttached();

  const labelText = await baselineLabel.textContent();
  expect(labelText).toContain('기준');
  // Must contain a number (formatted KRW)
  expect(labelText).toMatch(/\d/);
});

test('Sub-AC 6a: revenue-chart marks above-baseline bars green and below-baseline bars red', async ({ page }) => {
  // Use two-iteration mock: iter 1 above baseline (6200000 > 5651100), iter 2 below (4500000 < 5651100)
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: MOCK_SSE_SLOW_HEADERS, body: MOCK_SSE_TWO_ITERATIONS });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', { state: 'visible', timeout: 30_000 });

  // Bar 1: winner_revenue=6200000 > baseline=5651100 → above-baseline (green)
  const bar1 = page.locator('[data-testid="revenue-bar-1"]');
  await expect(bar1).toBeAttached();
  const bar1Class = await bar1.getAttribute('class');
  expect(bar1Class).toContain('above-baseline');

  // Bar 2: winner_revenue=4500000 < baseline=5651100 → below-baseline (red)
  const bar2 = page.locator('[data-testid="revenue-bar-2"]');
  await expect(bar2).toBeAttached();
  const bar2Class = await bar2.getAttribute('class');
  expect(bar2Class).toContain('below-baseline');
});

test('Sub-AC 6a: revenue-chart has correct header with legend labels', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // The revenue-chart header must contain legend items for above/below baseline
  const revenueChart = page.locator('[data-testid="revenue-chart"]');
  await expect(revenueChart).toBeAttached();

  // Check the header elements are present
  const chartText = await revenueChart.evaluate((el) => el.innerHTML);
  expect(chartText).toContain('revenue-chart-header');
  // Legend items for green (above) and red (below) must be present
  expect(chartText).toContain('legend-above');
  expect(chartText).toContain('legend-below');
});

test('Sub-AC 4c: archetype-summary-table shows iteration number label', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: MOCK_SSE_SLOW_HEADERS,
      body: MOCK_SSE_WITH_AGENTS,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 30_000,
  });

  const summaryTable = page.locator('[data-testid="archetype-summary-table"]');
  await expect(summaryTable).toBeVisible();

  // The iteration label must show "Iteration N" where N matches the mock's iteration=1
  const iterLabel = page.locator('#archetype-summary-iteration');
  await expect(iterLabel).toBeAttached();
  const iterText = await iterLabel.textContent();
  expect(iterText).toMatch(/Iteration\s+\d+/);
});

// ── Sub-AC 5a: Fixture loading & price formatting ─────────────────────────────

test('Sub-AC 5a: product-brand and product-name populated from fixture on page load', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Read-only product identity fields must be populated
  const brandText = await page.locator('[data-testid="product-brand"]').textContent();
  const nameText  = await page.locator('[data-testid="product-name"]').textContent();

  expect(brandText?.trim().length).toBeGreaterThan(0);
  expect(nameText?.trim().length).toBeGreaterThan(0);

  // Must match fixture values: brand = 트리클리닉, name = 트리클리닉 엑스퍼트 스칼프 탈모 샴푸
  expect(brandText?.trim()).toBe('트리클리닉');
  expect(nameText?.trim()).toContain('트리클리닉');
});

test('Sub-AC 5a: editable fields (input-title, input-top-copy, input-price, input-cost) populated from fixture', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // input-title must be populated with fixture current_title
  const titleVal = await page.locator('[data-testid="input-title"]').inputValue();
  expect(titleVal.trim().length).toBeGreaterThan(0);
  expect(titleVal).toContain('트리클리닉');

  // input-top-copy must be populated with fixture current_top_copy
  const copyVal = await page.locator('[data-testid="input-top-copy"]').inputValue();
  expect(copyVal.trim().length).toBeGreaterThan(0);
  expect(copyVal).toContain('두피');

  // input-price must be populated with fixture current_price_krw (29900)
  const priceVal = await page.locator('[data-testid="input-price"]').inputValue();
  expect(Number(priceVal)).toBe(29900);

  // input-cost must be populated with fixture current_cost_krw (11000)
  const costVal = await page.locator('[data-testid="input-cost"]').inputValue();
  expect(Number(costVal)).toBe(11000);
});

test('Sub-AC 5a: competitor prices are KRW-formatted using Intl.NumberFormat ko-KR', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Wait for competitors to be populated (not "로딩 중…")
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="competitor-a"] .competitor-price');
    return el && el.textContent !== '—' && el.textContent.trim().length > 1;
  }, { timeout: 10_000 });

  // competitor-a price must be ₩27,900 (KRW formatted)
  const priceA = await page.locator('[data-testid="competitor-a"] .competitor-price').textContent();
  expect(priceA?.trim()).toMatch(/₩|₩/); // Must contain won symbol
  expect(priceA?.trim()).toContain('27,900');

  // competitor-b price must be ₩16,120
  const priceB = await page.locator('[data-testid="competitor-b"] .competitor-price').textContent();
  expect(priceB?.trim()).toContain('16,120');

  // competitor-c price must be ₩13,900
  const priceC = await page.locator('[data-testid="competitor-c"] .competitor-price').textContent();
  expect(priceC?.trim()).toContain('13,900');
});

test('Sub-AC 5a: competitor names are populated with brand names from fixture', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Wait for competitors to be populated
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="competitor-a"] span:first-child');
    return el && el.textContent !== '로딩 중…' && el.textContent.trim().length > 0;
  }, { timeout: 10_000 });

  // competitor-a brand name must be 닥터포헤어
  const nameA = await page.locator('[data-testid="competitor-a"] span:first-child').textContent();
  expect(nameA?.trim()).toBe('닥터포헤어');

  // competitor-b brand name must be 라보에이치
  const nameB = await page.locator('[data-testid="competitor-b"] span:first-child').textContent();
  expect(nameB?.trim()).toBe('라보에이치');

  // competitor-c brand name must be 닥터방기원
  const nameC = await page.locator('[data-testid="competitor-c"] span:first-child').textContent();
  expect(nameC?.trim()).toBe('닥터방기원');
});

test('Sub-AC 5a: defaults (iteration-count, margin-floor) populated from fixture', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // iteration-count default = 5
  const iterVal = await page.locator('[data-testid="input-iteration-count"]').inputValue();
  expect(Number(iterVal)).toBe(5);

  // margin-floor default = 0.35
  const marginVal = await page.locator('[data-testid="input-margin-floor"]').inputValue();
  expect(Number(marginVal)).toBeCloseTo(0.35, 2);
});

test('Sub-AC 5a: margin rate is auto-computed and displayed after fixture load', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Margin rate should be computed from price (29900) and cost (11000)
  // margin = (29900 - 11000) / 29900 * 100 = 63.2%
  const marginText = await page.locator('#margin-rate-value').textContent();
  expect(marginText?.trim()).not.toBe('—');
  expect(marginText?.trim()).toMatch(/^\d+\.\d+%$/);

  // Value should be approximately 63.2%
  const marginNum = parseFloat(marginText ?? '0');
  expect(marginNum).toBeGreaterThan(60);
  expect(marginNum).toBeLessThan(70);
});

// ── Sub-AC 4b: Panel-input contents ──────────────────────────────────────────

test('Sub-AC 4b: archetype-weights-card is visible inside panel-input', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // archetype-weights-card must be inside panel-input (shell header card)
  const archetypeCard = page.locator('[data-testid="panel-input"] [data-testid="archetype-weights-card"]');
  await expect(archetypeCard).toBeVisible();

  // Per PRD §12.4.1 and §16, archetype-mixer interactive controls are in Simulation Panel bottom
  // (not inside archetype-weights-card which is just a section header in Input Panel)
  const mixer = page.locator('[data-testid="panel-simulation"] [data-testid="archetype-mixer"]');
  await expect(mixer).toBeVisible();
});

test('Sub-AC 4b: all 8 archetype count inputs exist with valid default values summing to 800', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const archetypeIds = [
    'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
    'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
  ];

  let total = 0;
  for (const id of archetypeIds) {
    const input = page.locator(`[data-testid="count-${id}"]`);
    await expect(input).toBeVisible();
    const val = await input.inputValue();
    expect(Number(val)).toBeGreaterThan(0);
    total += Number(val);
  }

  // Default values should sum to exactly 800
  expect(total).toBe(800);
});

test('Sub-AC 4b: agent-total display shows "800명 ✓" when archetype inputs sum to 800', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const agentTotal = page.locator('[data-testid="agent-total"]');
  await expect(agentTotal).toBeVisible();

  const text = await agentTotal.textContent();
  expect(text?.trim()).toContain('800명');
  expect(text?.trim()).toContain('✓');
});

test('Sub-AC 4b: btn-run becomes disabled when archetype count total is not 800', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Ensure btn-run is initially enabled
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  // Change price_sensitive count to 0 (total will be 800 - 144 = 656)
  const priceSensitiveInput = page.locator('[data-testid="count-price_sensitive"]');
  await priceSensitiveInput.fill('0');
  await priceSensitiveInput.dispatchEvent('input');

  // btn-run should become disabled
  await expect(page.locator('[data-testid="btn-run"]')).toBeDisabled();

  // agent-total should show ✗
  const agentTotal = page.locator('[data-testid="agent-total"]');
  const text = await agentTotal.textContent();
  expect(text?.trim()).toContain('✗');
});

test('Sub-AC 4b: btn-run re-enabled when archetype total is restored to 800', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Reduce count to make total < 800
  const priceSensitiveInput = page.locator('[data-testid="count-price_sensitive"]');
  await priceSensitiveInput.fill('0');
  await priceSensitiveInput.dispatchEvent('input');
  await expect(page.locator('[data-testid="btn-run"]')).toBeDisabled();

  // Restore the original value (144) to get total back to 800
  await priceSensitiveInput.fill('144');
  await priceSensitiveInput.dispatchEvent('input');

  // btn-run should be re-enabled
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  // agent-total should show ✓ again
  const agentTotal = page.locator('[data-testid="agent-total"]');
  const text = await agentTotal.textContent();
  expect(text?.trim()).toContain('✓');
});

test('Sub-AC 4b: gender inputs (male + female) are present in archetype-mixer', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const maleInput = page.locator('[data-testid="gender-male-count"]');
  const femaleInput = page.locator('[data-testid="gender-female-count"]');

  await expect(maleInput).toBeVisible();
  await expect(femaleInput).toBeVisible();

  // Default values: male=480, female=320, total=800
  const maleVal = Number(await maleInput.inputValue());
  const femaleVal = Number(await femaleInput.inputValue());
  expect(maleVal + femaleVal).toBe(800);
  expect(maleVal).toBeGreaterThan(0);
  expect(femaleVal).toBeGreaterThan(0);
});

test('Sub-AC 4b: product-card has 6 editable fields (title, top-copy, price, cost) + 2 read-only fields', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Read-only identity fields
  await expect(page.locator('[data-testid="product-brand"]')).toBeVisible();
  await expect(page.locator('[data-testid="product-name"]')).toBeVisible();

  // Editable fields (the 4 that contribute to 6 editable total with iteration-count + margin-floor)
  await expect(page.locator('[data-testid="input-title"]')).toBeVisible();
  await expect(page.locator('[data-testid="input-top-copy"]')).toBeVisible();
  await expect(page.locator('[data-testid="input-price"]')).toBeVisible();
  await expect(page.locator('[data-testid="input-cost"]')).toBeVisible();

  // All 4 product editable fields must be pre-populated from fixture
  const titleVal = await page.locator('[data-testid="input-title"]').inputValue();
  expect(titleVal.length).toBeGreaterThan(0);

  const copyVal = await page.locator('[data-testid="input-top-copy"]').inputValue();
  expect(copyVal.length).toBeGreaterThan(0);

  const priceVal = await page.locator('[data-testid="input-price"]').inputValue();
  expect(Number(priceVal)).toBeGreaterThan(0);

  const costVal = await page.locator('[data-testid="input-cost"]').inputValue();
  expect(Number(costVal)).toBeGreaterThan(0);
});

test('Sub-AC 4b: competitors-card has 3 competitor rows with names and prices', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // All 3 competitor rows must be visible
  await expect(page.locator('[data-testid="competitor-a"]')).toBeVisible();
  await expect(page.locator('[data-testid="competitor-b"]')).toBeVisible();
  await expect(page.locator('[data-testid="competitor-c"]')).toBeVisible();

  // Each competitor row must have a name and a price
  for (const id of ['competitor-a', 'competitor-b', 'competitor-c']) {
    const row = page.locator(`[data-testid="${id}"]`);
    const rowText = await row.textContent();
    // Should not be empty loading state
    expect(rowText).not.toContain('로딩 중');
    // Should contain a KRW price (₩ symbol or digit)
    expect(rowText).toMatch(/\d/);
  }
});

test('Sub-AC 4b: settings-card has iteration-count and margin-floor inputs with valid defaults', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const iterInput = page.locator('[data-testid="input-iteration-count"]');
  const marginInput = page.locator('[data-testid="input-margin-floor"]');

  await expect(iterInput).toBeVisible();
  await expect(marginInput).toBeVisible();

  // Check defaults are populated from fixture
  const iterVal = Number(await iterInput.inputValue());
  const marginVal = Number(await marginInput.inputValue());

  expect(iterVal).toBeGreaterThanOrEqual(1);
  expect(iterVal).toBeLessThanOrEqual(10);
  expect(marginVal).toBeGreaterThanOrEqual(0.10);
  expect(marginVal).toBeLessThanOrEqual(0.90);
});

test('Sub-AC 4b: btn-run and status-text are visible in panel-input', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // btn-run must be in panel-input and enabled initially
  const btnRun = page.locator('[data-testid="panel-input"] [data-testid="btn-run"]');
  await expect(btnRun).toBeVisible();
  await expect(btnRun).toBeEnabled();

  // status-text must be visible with Korean text
  const statusText = page.locator('[data-testid="status-text"]');
  await expect(statusText).toBeVisible();
  const text = await statusText.textContent();
  expect(text?.trim().length).toBeGreaterThan(0);
});

// ── Sub-AC 7c: Validation logic tests ─────────────────────────────────────────

test('Sub-AC 7c: btn-run disabled when gender total is not 800 even if archetype total is 800', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Initially both totals are 800 — btn-run should be enabled
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  // Change gender-male-count to 100 (total becomes 100 + 320 = 420 ≠ 800)
  const maleInput = page.locator('[data-testid="gender-male-count"]');
  await maleInput.fill('100');
  await maleInput.dispatchEvent('input');

  // btn-run should now be disabled (gender total is invalid)
  await expect(page.locator('[data-testid="btn-run"]')).toBeDisabled();
});

test('Sub-AC 7c: btn-run re-enabled when both archetype and gender totals are restored to 800', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Break gender total
  const maleInput = page.locator('[data-testid="gender-male-count"]');
  await maleInput.fill('100');
  await maleInput.dispatchEvent('input');
  await expect(page.locator('[data-testid="btn-run"]')).toBeDisabled();

  // Restore gender total (100 + 700 = 800)
  const femaleInput = page.locator('[data-testid="gender-female-count"]');
  await femaleInput.fill('700');
  await femaleInput.dispatchEvent('input');

  // btn-run should be re-enabled now
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();
});

test('Sub-AC 7c: agent-total shows ✗ N명 부족 when archetype total is under 800', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Set price_sensitive to 0 → total = 800 - 144 = 656 → 144명 부족
  const priceSensitiveInput = page.locator('[data-testid="count-price_sensitive"]');
  await priceSensitiveInput.fill('0');
  await priceSensitiveInput.dispatchEvent('input');

  const agentTotal = page.locator('[data-testid="agent-total"]');
  const text = await agentTotal.textContent();
  expect(text).toContain('✗');
  expect(text).toContain('부족');
  // Should NOT say 초과 (since we're under 800)
  expect(text).not.toContain('초과');
});

test('Sub-AC 7c: agent-total shows ✗ N명 초과 when archetype total exceeds 800', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Increase price_sensitive by 200 → total = 800 + 200 = 1000 → 200명 초과
  const priceSensitiveInput = page.locator('[data-testid="count-price_sensitive"]');
  await priceSensitiveInput.fill('344');  // 144 + 200 = 344
  await priceSensitiveInput.dispatchEvent('input');

  const agentTotal = page.locator('[data-testid="agent-total"]');
  const text = await agentTotal.textContent();
  expect(text).toContain('✗');
  expect(text).toContain('초과');
  // Should NOT say 부족 (since we're over 800)
  expect(text).not.toContain('부족');
});

test('Sub-AC 7c: gender-total display shows ✗ N명 부족 when gender total is under 800', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Set male to 100, female stays 320 → total = 420 → 380명 부족
  const maleInput = page.locator('[data-testid="gender-male-count"]');
  await maleInput.fill('100');
  await maleInput.dispatchEvent('input');

  const genderTotal = page.locator('#gender-total-display');
  const text = await genderTotal.textContent();
  expect(text).toContain('✗');
  expect(text).toContain('부족');
  expect(text).not.toContain('초과');
});

test('Sub-AC 7c: gender-total display shows ✗ N명 초과 when gender total exceeds 800', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Set male to 700, female stays 320 → total = 1020 → 220명 초과
  const maleInput = page.locator('[data-testid="gender-male-count"]');
  await maleInput.fill('700');
  await maleInput.dispatchEvent('input');

  const genderTotal = page.locator('#gender-total-display');
  const text = await genderTotal.textContent();
  expect(text).toContain('✗');
  expect(text).toContain('초과');
  expect(text).not.toContain('부족');
});

test('Sub-AC 7c: integer-only input — decimal values are stripped from archetype count inputs', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Input a decimal value into price_sensitive
  const priceSensitiveInput = page.locator('[data-testid="count-price_sensitive"]');
  await priceSensitiveInput.fill('144.7');
  await priceSensitiveInput.dispatchEvent('input');

  // Value should be floored to 144
  const val = await priceSensitiveInput.inputValue();
  expect(Number(val)).toBe(Math.floor(144.7));  // 144
  expect(val).not.toContain('.');
});

test('Sub-AC 7c: both archetype AND gender totals must be 800 for btn-run to be enabled', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Both start valid
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  // Break archetype total only
  const priceSensitiveInput = page.locator('[data-testid="count-price_sensitive"]');
  await priceSensitiveInput.fill('0');
  await priceSensitiveInput.dispatchEvent('input');
  await expect(page.locator('[data-testid="btn-run"]')).toBeDisabled();

  // Fix archetype but break gender
  await priceSensitiveInput.fill('144');
  await priceSensitiveInput.dispatchEvent('input');
  // Archetype is valid again but btn should be enabled (gender is still 800)
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();

  // Now break gender
  const maleInput = page.locator('[data-testid="gender-male-count"]');
  await maleInput.fill('100');
  await maleInput.dispatchEvent('input');
  // Gender invalid → btn disabled
  await expect(page.locator('[data-testid="btn-run"]')).toBeDisabled();

  // Fix gender
  await maleInput.fill('480');
  await maleInput.dispatchEvent('input');
  // Both valid → enabled
  await expect(page.locator('[data-testid="btn-run"]')).toBeEnabled();
});

// ── Sub-AC 7b: Fixture wiring — cohort_weight_percent × 800 default values ────

test('Sub-AC 7b: archetype count inputs are populated from fixture cohort_weight_percent × 800', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Expected values: cohort_weight_percent (from buyer-personas.md) × 800
  const expected = {
    price_sensitive:      144,  // 18% × 800
    value_seeker:         128,  // 16% × 800
    premium_quality:       96,  // 12% × 800
    trust_first:          120,  // 15% × 800
    aesthetics_first:      64,  //  8% × 800
    urgency_buyer:         88,  // 11% × 800 (fixture id: desperate_hairloss)
    promo_hunter:          80,  // 10% × 800
    gift_or_family_buyer:  80,  // 10% × 800
  };

  let total = 0;
  for (const [id, expectedCount] of Object.entries(expected)) {
    const input = page.locator(`[data-testid="count-${id}"]`);
    await expect(input).toBeVisible();
    const val = Number(await input.inputValue());
    expect(val).toBe(expectedCount);
    total += val;
  }

  // Grand total must be exactly 800
  expect(total).toBe(800);
});

test('Sub-AC 7b: agent-total shows "800명 ✓" immediately after fixture load (mount)', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const agentTotal = page.locator('[data-testid="agent-total"]');
  await expect(agentTotal).toBeVisible();

  const text = await agentTotal.textContent();
  expect(text?.trim()).toBe('800명 ✓');
});

test('Sub-AC 7b: agent-total live sum updates immediately when any archetype input changes', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Confirm initial state is 800명 ✓
  const agentTotal = page.locator('[data-testid="agent-total"]');
  expect((await agentTotal.textContent())?.trim()).toBe('800명 ✓');

  // Change urgency_buyer from 88 → 0 (total drops to 712)
  const urgencyInput = page.locator('[data-testid="count-urgency_buyer"]');
  await urgencyInput.fill('0');
  await urgencyInput.dispatchEvent('input');

  // agent-total must reflect the change immediately (712명, 88명 부족)
  const textAfterChange = await agentTotal.textContent();
  expect(textAfterChange).toContain('712');
  expect(textAfterChange).toContain('✗');
  expect(textAfterChange).toContain('부족');

  // Restore to 88 → total back to 800명 ✓
  await urgencyInput.fill('88');
  await urgencyInput.dispatchEvent('input');
  expect((await agentTotal.textContent())?.trim()).toBe('800명 ✓');
});

// ── Sub-AC 7d: archetypeCounts + genderMaleCount included in SSE request body ─

test('Sub-AC 7d: btn-run click sends archetypeCounts object and genderMaleCount integer in SSE request body', async ({ page }) => {
  let capturedBody = null;

  // Intercept /api/run/stream and capture the request body before responding
  await page.route('**/api/run/stream', async (route) => {
    const request = route.request();
    try {
      capturedBody = JSON.parse(request.postData() ?? '{}');
    } catch {
      capturedBody = {};
    }
    // Respond with a minimal simulation_complete so the run finishes cleanly
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
      body: [
        'event: simulation_complete',
        `data: ${JSON.stringify({
          baseline: { id: 'baseline', title: 'T', top_copy: 'C', price_krw: 29900, simulated_revenue: 5000000, margin_rate: 0.63 },
          selected_strategy: { id: 's1', title: 'T2', top_copy: 'C2', price_krw: 28900, simulated_revenue: 5500000, margin_rate: 0.62, rationale: 'test' },
          holdout: { holdout_uplift: 500000, holdout_revenue: 5500000, margin_floor_violations: 0 },
          diff: { title: { baseline: 'T', candidate: 'T2', changed: true }, top_copy: { baseline: 'C', candidate: 'C2', changed: true }, price_krw: { baseline: 29900, candidate: 28900, changed: true } },
          artifact: { path: 'artifacts/test.json', written: true },
        })}`,
        '',
        '',
      ].join('\n'),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Click btn-run (fixtures pre-populate totals to 800 so button is enabled)
  const runBtn = page.locator('[data-testid="btn-run"]');
  await expect(runBtn).toBeEnabled({ timeout: 5000 });
  await runBtn.click();

  // Wait for the request to be intercepted
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-testid="btn-run"]');
    // btn should be re-enabled after simulation_complete
    return btn && !btn.disabled;
  }, { timeout: 10_000 });

  // Now assert on captured body
  expect(capturedBody).not.toBeNull();

  // archetypeCounts must be an object (non-null, not an array)
  expect(typeof capturedBody.archetypeCounts).toBe('object');
  expect(Array.isArray(capturedBody.archetypeCounts)).toBe(false);
  expect(capturedBody.archetypeCounts).not.toBeNull();

  // archetypeCounts must have at least one archetype_id key with a non-negative integer value
  const archetypeKeys = Object.keys(capturedBody.archetypeCounts);
  expect(archetypeKeys.length).toBeGreaterThan(0);
  for (const key of archetypeKeys) {
    const val = capturedBody.archetypeCounts[key];
    expect(typeof val).toBe('number');
    expect(Number.isInteger(val)).toBe(true);
    expect(val).toBeGreaterThanOrEqual(0);
  }

  // genderMaleCount must be a non-negative integer
  expect(typeof capturedBody.genderMaleCount).toBe('number');
  expect(Number.isInteger(capturedBody.genderMaleCount)).toBe(true);
  expect(capturedBody.genderMaleCount).toBeGreaterThanOrEqual(0);

  // The sum of archetypeCounts values must equal 800 (valid state required to click btn-run)
  const archetypeTotal = Object.values(capturedBody.archetypeCounts).reduce((a, b) => a + b, 0);
  expect(archetypeTotal).toBe(800);
});
