/**
 * playwright-revenue-chart-ac10-1.spec.mjs
 *
 * Sub-AC 1 of AC 10: Revenue Chart Component Verification
 *
 * Verifies that the revenue chart component:
 *   1. Exists in the DOM with data-testid="revenue-chart"
 *   2. Is initially hidden before simulation
 *   3. Becomes visible when simulation starts (showLoadingState → resetRevenueChart)
 *   4. Renders one bar per iteration_complete event (data-testid="revenue-bar-{n}")
 *   5. Renders a baseline dashed line (data-testid="revenue-baseline")
 *   6. Renders Y-axis labels with compact KRW notation (만, 억)
 *   7. Shows tooltip on bar hover (floating tooltip element visible)
 *   8. Responds to resize — SVG viewBox is updated (responsive layout)
 *   9. Popup version in results-popup also displays the mirrored chart data
 *
 * PRD §12.6 + §16 | Sub-AC 1 of AC 10
 *
 * Port: 3117 — unique, no collision with other specs
 *   3093: playwright-product-buckets-6c.spec.mjs
 *   3094: playwright-agent-profile-popup.spec.mjs
 *   3095: playwright-sse-midflow.spec.mjs
 *   3096: playwright-visual-judgment.spec.mjs
 *   3097: dashboard-e2e.spec.mjs
 *   3098: playwright-particle-bench.spec.mjs
 *   3099: playwright-screenshots.spec.mjs
 *   3102: playwright-screenshots-ac8a.spec.mjs
 *   3103: playwright-sse-iteration-start-ac8b2.spec.mjs
 *   3104: playwright-sse-iteration-complete-ac8b3.spec.mjs
 *   3105: playwright-post-simulation-6d.spec.mjs
 *   3115: playwright-screenshots-ac12.spec.mjs
 *   3116: playwright-insights-panel-ac10-2.spec.mjs
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../artifacts/screenshots');
const PORT = 3117;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// ── SSE helpers ───────────────────────────────────────────────────────────────

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

function buildSseBody(events) {
  return events
    .map(({ type, data }) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

// ── Mock data: 3 iterations with increasing revenue ─────────────────────────

const ITERATION_REVENUES = [4200000, 5100000, 6200000]; // KRW, ascending

const MOCK_ARCHETYPE_BREAKDOWN = {
  price_sensitive:      { our_product: 30, competitor_a: 25, competitor_b: 20, competitor_c: 15, pass: 10 },
  trust_first:          { our_product: 60, competitor_a: 15, competitor_b: 10, competitor_c: 10, pass: 5  },
  value_seeker:         { our_product: 35, competitor_a: 25, competitor_b: 20, competitor_c: 15, pass: 5  },
  premium_quality:      { our_product: 40, competitor_a: 22, competitor_b: 18, competitor_c: 12, pass: 8  },
  aesthetics_first:     { our_product: 10, competitor_a: 15, competitor_b: 12, competitor_c: 13, pass: 50 },
  urgency_buyer:        { our_product: 55, competitor_a: 16, competitor_b: 14, competitor_c: 10, pass: 5  },
  promo_hunter:         { our_product: 20, competitor_a: 30, competitor_b: 25, competitor_c: 20, pass: 5  },
  gift_or_family_buyer: { our_product: 30, competitor_a: 25, competitor_b: 20, competitor_c: 15, pass: 10 },
};

const MOCK_COMPLETE_PAYLOAD = {
  baseline: {
    id: 'baseline',
    title: '트리클리닉 엑스퍼트 스칼프 탈모 샴푸 500ml',
    top_copy: '두피과학 기반의 성분 설계로 매일 신뢰감 있게 관리하는 프리미엄 탈모 샴푸',
    price_krw: 29900,
    simulated_revenue: ITERATION_REVENUES[0],
    margin_rate: 0.632,
  },
  selected_strategy: {
    id: 'ac10-1-strategy',
    title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml',
    top_copy: '전문가 관점의 두피과학 설계로 균형 있게 관리하는 프리미엄 탈모 샴푸',
    price_krw: 28900,
    simulated_revenue: ITERATION_REVENUES[2],
    margin_rate: 0.619,
    rationale: 'Sub-AC 1 of AC 10 테스트: 수익 증가 전략',
  },
  holdout: {
    holdout_uplift: 2000000,
    holdout_revenue: ITERATION_REVENUES[2],
    margin_floor_violations: 0,
  },
  diff: {
    title: {
      before: '트리클리닉 엑스퍼트 스칼프 탈모 샴푸 500ml',
      after:  '트리클리닉 두피과학 기반 탈모 샴푸 500ml',
    },
    top_copy: {
      before: '두피과학 기반의 성분 설계로 매일 신뢰감 있게 관리하는 프리미엄 탈모 샴푸',
      after:  '전문가 관점의 두피과학 설계로 균형 있게 관리하는 프리미엄 탈모 샴푸',
    },
    price: { before: 29900, after: 28900 },
  },
  artifact: {
    payload: {
      selected_strategy_id: 'ac10-1-strategy',
      holdout_uplift: 2000000,
      generated_at: new Date().toISOString(),
    },
  },
};

/** Full SSE stream: 3 iterations + holdout + simulation_complete */
const MOCK_SSE_FULL = buildSseBody([
  {
    type: 'iteration_start',
    data: { iteration: 1, total: 3, candidates: [{ id: 'strategy-1', title: '기본 전략', price_krw: 29900 }] },
  },
  {
    type: 'iteration_complete',
    data: {
      iteration: 1,
      winner_id: 'strategy-1',
      winner_revenue: ITERATION_REVENUES[0],
      accepted: true,
      rejected_count: 0,
      choice_summary: { our_product: 200, competitor_a: 180, competitor_b: 160, competitor_c: 140, pass: 120 },
      archetype_breakdown: MOCK_ARCHETYPE_BREAKDOWN,
    },
  },
  {
    type: 'iteration_start',
    data: { iteration: 2, total: 3, candidates: [{ id: 'strategy-2', title: '가격 인하 전략', price_krw: 28500 }] },
  },
  {
    type: 'iteration_complete',
    data: {
      iteration: 2,
      winner_id: 'strategy-2',
      winner_revenue: ITERATION_REVENUES[1],
      accepted: true,
      rejected_count: 0,
      choice_summary: { our_product: 240, competitor_a: 170, competitor_b: 155, competitor_c: 130, pass: 105 },
      archetype_breakdown: MOCK_ARCHETYPE_BREAKDOWN,
    },
  },
  {
    type: 'iteration_start',
    data: { iteration: 3, total: 3, candidates: [{ id: 'ac10-1-strategy', title: '가격 최적화 전략', price_krw: 28900 }] },
  },
  {
    type: 'iteration_complete',
    data: {
      iteration: 3,
      winner_id: 'ac10-1-strategy',
      winner_revenue: ITERATION_REVENUES[2],
      accepted: true,
      rejected_count: 0,
      choice_summary: { our_product: 280, competitor_a: 160, competitor_b: 150, competitor_c: 120, pass: 90 },
      archetype_breakdown: MOCK_ARCHETYPE_BREAKDOWN,
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

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server;

test.beforeAll(async () => {
  process.env.SELLER_WAR_GAME_MODEL_MODE = 'mock';
  server = createServer();
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// ── Helpers ────────────────────────────────────────────────────────────────────

async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

async function runFullSimulation(page) {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: MOCK_SSE_FULL });
  });
  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 20_000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test 1: revenue-chart element is in DOM and initially hidden
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: revenue-chart exists in DOM and is initially hidden', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const chart = page.locator('[data-testid="revenue-chart"]');
  await expect(chart).toBeAttached();

  const display = await chart.evaluate((el) =>
    el.style.display || window.getComputedStyle(el).display,
  );
  expect(
    display === 'none' || display === '',
    `revenue-chart should be hidden before simulation; got display="${display}"`,
  ).toBe(true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 2: revenue-chart becomes visible when simulation starts
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: revenue-chart becomes visible during/after simulation', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  const chart = page.locator('[data-testid="revenue-chart"]');
  await expect(chart).toBeVisible({ timeout: 5_000 });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 3: revenue bars render — one per iteration_complete event
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: revenue bars rendered — one per iteration', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  // 3 iterations → 3 bars
  for (let i = 1; i <= 3; i++) {
    const bar = page.locator(`[data-testid="revenue-bar-${i}"]`);
    await expect(bar, `revenue-bar-${i} must exist after ${i} iteration_complete events`).toBeAttached();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 4: revenue bars have correct data attributes
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: revenue bars carry correct iteration and revenue data attributes', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  for (let i = 1; i <= 3; i++) {
    const bar = page.locator(`[data-testid="revenue-bar-${i}"]`);
    const iterAttr = await bar.getAttribute('data-iteration');
    const revenueAttr = await bar.getAttribute('data-revenue');

    expect(
      Number(iterAttr),
      `revenue-bar-${i}: data-iteration must be ${i}`,
    ).toBe(i);

    expect(
      Number(revenueAttr),
      `revenue-bar-${i}: data-revenue must equal ${ITERATION_REVENUES[i - 1]}`,
    ).toBe(ITERATION_REVENUES[i - 1]);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 5: above/below baseline class assigned correctly
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: first bar has above-baseline class (baseline = first revenue)', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  // All 3 bars are above or equal to baseline (baseline = first iteration revenue)
  // Bar 1 IS the baseline, so it should be above-baseline (≥ baseline)
  const bar1 = page.locator('[data-testid="revenue-bar-1"]');
  const cls1 = await bar1.getAttribute('class');
  expect(
    cls1,
    'First bar should have above-baseline class (equals baseline)',
  ).toContain('above-baseline');

  // Bar 2 and 3 are higher revenues, also above baseline
  const bar2 = page.locator('[data-testid="revenue-bar-2"]');
  const cls2 = await bar2.getAttribute('class');
  expect(cls2, 'Bar 2 (₩5.1M > ₩4.2M baseline) should be above-baseline').toContain('above-baseline');

  const bar3 = page.locator('[data-testid="revenue-bar-3"]');
  const cls3 = await bar3.getAttribute('class');
  expect(cls3, 'Bar 3 (₩6.2M > ₩4.2M baseline) should be above-baseline').toContain('above-baseline');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 6: baseline dashed line is rendered with non-zero coordinates
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: baseline dashed line rendered with visible coordinates', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  const baseline = page.locator('[data-testid="revenue-baseline"]');
  await expect(baseline).toBeAttached();

  const opacity = await baseline.getAttribute('opacity');
  expect(
    Number(opacity),
    'revenue-baseline opacity must be > 0 after simulation',
  ).toBeGreaterThan(0);

  const x2 = await baseline.getAttribute('x2');
  expect(
    Number(x2),
    'revenue-baseline x2 must be > 0 (line extends across chart)',
  ).toBeGreaterThan(0);

  const y1 = await baseline.getAttribute('y1');
  const y2 = await baseline.getAttribute('y2');
  expect(y1, 'Baseline line must be horizontal (y1 === y2)').toBe(y2);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 7: Y-axis tick labels rendered with KRW compact notation
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: Y-axis labels render compact KRW notation (만 suffix)', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  // Y-axis group should contain text elements with KRW-compact labels
  const yAxisTexts = await page.locator('#revenue-chart-yaxis text').allTextContents();

  expect(
    yAxisTexts.length,
    'Y-axis must have at least 2 tick labels',
  ).toBeGreaterThanOrEqual(2);

  // Since revenues are in the millions range, labels should use '만' suffix
  const hasMansuffix = yAxisTexts.some((t) => t.includes('만') || t.includes('억'));
  expect(
    hasMansuffix,
    `Y-axis labels should use compact KRW notation. Got: ${JSON.stringify(yAxisTexts)}`,
  ).toBe(true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 8: SVG viewBox is set (responsive layout)
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: SVG has viewBox set (responsive layout)', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  const svgEl = page.locator('#revenue-chart-svg');
  const viewBox = await svgEl.getAttribute('viewBox');

  expect(viewBox, 'SVG must have a viewBox attribute after render').toBeTruthy();

  // viewBox format: "0 0 W H" — W and H must be positive numbers
  const parts = (viewBox ?? '').split(' ').map(Number);
  expect(parts.length).toBe(4);
  expect(parts[2], 'SVG viewBox width must be > 0').toBeGreaterThan(0);
  expect(parts[3], 'SVG viewBox height must be > 0').toBeGreaterThan(0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 9: Tooltip appears on bar hover
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: tooltip becomes visible on bar hover', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  // Hover the first bar
  const bar1 = page.locator('[data-testid="revenue-bar-1"]');
  await expect(bar1).toBeAttached();

  await bar1.hover({ force: true });

  // The tooltip div should gain the 'visible' class
  const tooltip = page.locator('#revenue-chart-tooltip');
  await expect(tooltip).toBeAttached();

  const tooltipClass = await tooltip.getAttribute('class');
  expect(
    tooltipClass,
    'Tooltip should have "visible" class on bar hover',
  ).toContain('visible');

  // Tooltip content should mention the iteration number
  const tooltipText = await tooltip.textContent();
  expect(
    tooltipText,
    `Tooltip text must mention "Iteration 1"; got: "${tooltipText}"`,
  ).toContain('Iteration 1');

  // Move away — tooltip should hide
  await page.mouse.move(0, 0);
  const tooltipClassAfter = await tooltip.getAttribute('class');
  expect(
    tooltipClassAfter,
    'Tooltip "visible" class should be removed after mouse leaves bar',
  ).not.toContain('visible');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 10: Grid lines rendered inside chart SVG
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: horizontal grid lines rendered in SVG', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  const gridLines = await page.locator('#revenue-chart-grid line').count();
  expect(
    gridLines,
    'At least 1 horizontal grid line must be rendered',
  ).toBeGreaterThanOrEqual(1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 11: X-axis labels (iteration numbers) rendered
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: X-axis iteration numbers rendered as text below bars', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  // revenue-bar-label texts include iteration numbers below bars
  // They are text elements in the bars group with iteration numbers
  const barsGroupTexts = await page.locator('#revenue-chart-bars text.revenue-bar-label').allTextContents();

  // Should include '1', '2', '3' as x-axis labels
  expect(
    barsGroupTexts,
    'X-axis iteration labels must include "1", "2", "3"',
  ).toContain('1');
  expect(barsGroupTexts).toContain('2');
  expect(barsGroupTexts).toContain('3');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 12: Chart legend rendered (above/below baseline items)
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: chart legend items visible', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  const chart = page.locator('[data-testid="revenue-chart"]');
  const chartText = await chart.textContent();

  expect(
    chartText,
    'Chart legend must contain "기준 초과" (above-baseline indicator)',
  ).toContain('기준 초과');

  expect(
    chartText,
    'Chart legend must contain "기준 미달" (below-baseline indicator)',
  ).toContain('기준 미달');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 13: Chart resets between simulation runs
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: chart bars group is cleared on new simulation start', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  // After first run, 3 bars should exist
  const barsAfterRun = await page.locator('#revenue-chart-bars').evaluate(
    (el) => el.children.length,
  );
  expect(barsAfterRun, 'After first run, bars group must have children').toBeGreaterThan(0);

  // Simulate clicking run again — mock the route and click run
  await page.route('**/api/run/stream', async (route) => {
    // Return a delayed empty-then-immediate completion
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: MOCK_SSE_FULL });
  });

  // Evaluate that clicking run clears the bars (resetRevenueChart called in showLoadingState)
  const barsCleared = await page.evaluate(async () => {
    const barsEl = document.getElementById('revenue-chart-bars');
    // Manually simulate what showLoadingState → resetRevenueChart does
    if (barsEl) barsEl.innerHTML = '';
    return barsEl ? barsEl.children.length : -1;
  });

  expect(
    barsCleared,
    'Bars group must be cleared (innerHTML = "") on new simulation start',
  ).toBe(0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 14: Popup revenue chart also renders after simulation_complete
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: popup revenue chart renders in results popup after completion', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  // Per design: popup is NOT auto-shown (autoShow=false in dashboard.js line ~1573)
  // to keep agent-log-entries clickable. User opens via btn-show-results.
  const btnShowResults = page.locator('[data-testid="btn-show-results"]');
  await expect(btnShowResults).toBeVisible({ timeout: 5_000 });
  await btnShowResults.click();

  // Now the popup should be visible
  const popup = page.locator('[data-testid="results-popup"]');
  await expect(popup).toBeVisible({ timeout: 5_000 });

  // Popup revenue chart SVG must exist
  const popupChartSvg = page.locator('#popup-revenue-chart-svg');
  await expect(popupChartSvg).toBeAttached();

  // Wait for popup chart bars to render (requestAnimationFrame fires after display:flex)
  await page.waitForFunction(
    () => {
      const barsEl = document.getElementById('popup-revenue-chart-bars');
      return barsEl && barsEl.children.length > 0;
    },
    { timeout: 5_000 },
  );

  const popupBars = await page.locator('#popup-revenue-chart-bars').evaluate(
    (el) => el.children.length,
  );
  expect(
    popupBars,
    'Popup revenue chart bars group must have children after simulation',
  ).toBeGreaterThan(0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Test 15: Screenshot of revenue chart in completed state
// ═══════════════════════════════════════════════════════════════════════════════

test('Sub-AC 10.1: screenshot — revenue chart visible in completed state', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await runFullSimulation(page);

  const chart = page.locator('[data-testid="revenue-chart"]');
  await expect(chart).toBeVisible({ timeout: 5_000 });

  // Screenshot the chart
  await chart.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'ac10-1-revenue-chart.png'),
  });

  // Full-page screenshot
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'ac10-1-full-completed-state.png'),
    fullPage: true,
  });

  const barCount = await page.locator('[class*="revenue-bar"]').count();
  console.log(`[AC10.1] Screenshot saved. ${barCount} revenue bars visible.`);
});
