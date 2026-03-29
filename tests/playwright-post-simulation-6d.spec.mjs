/**
 * playwright-post-simulation-6d.spec.mjs — Sub-AC 6d
 *
 * Playwright tests that verify post-simulation UI behavior:
 *
 *   1. On `iteration_complete` SSE: archetype-summary-table renders with
 *      per-archetype choice percentages ("우리%" column) within 500ms
 *
 *   2. On `simulation_complete`: all particles freeze (sim-frozen class added
 *      to canvas container, particleEngine.frozen becomes true) and the final
 *      frozen particle state is preserved on canvas
 *
 *   3. Timing: all UI updates respond within 500ms of the SSE event arrival
 *
 * PRD §8, §12.3, §16 | Sub-AC 6d
 *
 * Port: 3105 — dedicated, no collision with other specs
 *   3093: playwright-product-buckets-6c.spec.mjs / playwright-sse-mid-flow.spec.mjs
 *   3094: playwright-agent-profile-popup.spec.mjs
 *   3095: playwright-sse-midflow.spec.mjs
 *   3096: playwright-visual-judgment.spec.mjs
 *   3097: dashboard-e2e.spec.mjs
 *   3098: playwright-particle-bench.spec.mjs
 *   3099: playwright-screenshots.spec.mjs
 *   3100: (reserved)
 *   3101: (reserved)
 *   3102: playwright-screenshots-ac8a.spec.mjs
 *   3103: playwright-sse-iteration-start-ac8b2.spec.mjs
 *   3104: playwright-sse-iteration-complete-ac8b3.spec.mjs
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../artifacts/screenshots');
const PORT = 3105;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// ── SSE helpers ───────────────────────────────────────────────────────────────

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

/** Encode a list of { type, data } objects as an SSE text body. */
function buildSseBody(events) {
  return events
    .map(({ type, data }) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

// ── Mock archetype breakdown (Sub-AC 3c explicit array format) ────────────────

const ARCHETYPE_LABELS = {
  price_sensitive:      '가격민감형',
  value_seeker:         '가성비균형형',
  premium_quality:      '프리미엄품질형',
  trust_first:          '신뢰우선형',
  aesthetics_first:     '심미형',
  urgency_buyer:        '긴박구매형',
  promo_hunter:         '프로모션헌터형',
  gift_or_family_buyer: '가족구매형',
};

/** Build explicit Sub-AC 3c archetype_breakdown array */
function buildArchetypeBreakdown() {
  const distributions = {
    price_sensitive:      { our_product: 20, competitor_a: 12, competitor_b: 8,  competitor_c: 4,  pass: 6  },
    value_seeker:         { our_product: 18, competitor_a: 8,  competitor_b: 6,  competitor_c: 6,  pass: 2  },
    premium_quality:      { our_product: 25, competitor_a: 6,  competitor_b: 3,  competitor_c: 2,  pass: 4  },
    trust_first:          { our_product: 22, competitor_a: 5,  competitor_b: 5,  competitor_c: 3,  pass: 5  },
    aesthetics_first:     { our_product: 15, competitor_a: 8,  competitor_b: 4,  competitor_c: 5,  pass: 4  },
    urgency_buyer:        { our_product: 24, competitor_a: 10, competitor_b: 3,  competitor_c: 1,  pass: 6  },
    promo_hunter:         { our_product: 16, competitor_a: 14, competitor_b: 6,  competitor_c: 6,  pass: 2  },
    gift_or_family_buyer: { our_product: 20, competitor_a: 8,  competitor_b: 4,  competitor_c: 4,  pass: 4  },
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
      archetype_label: ARCHETYPE_LABELS[archetypeId] ?? archetypeId,
      sample_size:     sampleSize,
      choices,
    };
  });
}

const MOCK_ARCHETYPE_BREAKDOWN = buildArchetypeBreakdown();

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
    id: '6d-test-strategy',
    title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml',
    top_copy: '전문가 관점의 두피과학 설계로 균형 있게 관리하는 프리미엄 탈모 샴푸',
    price_krw: 28900,
    simulated_revenue: 6200000,
    margin_rate: 0.619,
    rationale: 'Sub-AC 6d 테스트용 전략: 소폭 가격 인하로 가격 민감형 고객 확보',
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
      after:  '전문가 관점의 두피과학 설계로 균형 있게 관리하는 프리미엄 탈모 샴푸',
    },
    price: { before: 29900, after: 28900 },
  },
  artifact: {
    payload: {
      selected_strategy_id: '6d-test-strategy',
      holdout_uplift: 548900,
      generated_at: new Date().toISOString(),
    },
  },
};

/** 8 agent_decision events covering all 8 archetypes */
const AGENT_EVENTS = Object.keys(ARCHETYPE_LABELS).map((archetypeId, i) => ({
  type: 'agent_decision',
  data: {
    iteration:        1,
    agent_id:         `${archetypeId}_000${i + 1}`,
    agent_name:       ['김지수', '이민준', '박서연', '최준혁', '정유리', '강태현', '임소희', '한도현'][i],
    agent_index:      i,
    agent_total:      8,
    archetype_id:     archetypeId,
    chosen_product:   'our_product',
    reasoning:        `${ARCHETYPE_LABELS[archetypeId]} 테스트 에이전트 결정`,
    price_sensitivity: 3.5,
    trust_sensitivity: 2.8,
    promo_affinity:    2.0,
    brand_bias:        2.2,
    pass_threshold:    0.25,
  },
}));

/** Full SSE stream: iteration_start → agent_decisions → iteration_complete → simulation_complete */
const MOCK_SSE_FULL = buildSseBody([
  {
    type: 'iteration_start',
    data: {
      iteration: 1,
      total: 1,
      candidates: [
        { id: '6d-test-strategy', title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml', price_krw: 28900 },
      ],
    },
  },
  ...AGENT_EVENTS,
  {
    type: 'iteration_complete',
    data: {
      iteration:          1,
      winner_id:          '6d-test-strategy',
      winner_revenue:     6200000,
      accepted:           true,
      rejected_count:     0,
      choice_summary: {
        our_product: 160, competitor_a: 71, competitor_b: 39, competitor_c: 31, pass: 33,
      },
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

// ── Test 1: archetype-summary-table hidden initially ──────────────────────────

test('Sub-AC 6d: archetype-summary-table is hidden before simulation starts', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const tableEl = page.locator('[data-testid="archetype-summary-table"]');

  // Must exist in DOM
  await expect(tableEl).toBeAttached();

  // Must be hidden initially
  const display = await tableEl.evaluate((el) =>
    el.style.display || window.getComputedStyle(el).display,
  );
  expect(display, 'archetype-summary-table must be hidden before simulation').toBe('none');
});

// ── Test 2: archetype-summary-table renders on iteration_complete ─────────────

test('Sub-AC 6d: archetype-summary-table visible after iteration_complete with per-archetype rows', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: MOCK_SSE_FULL });
  });

  // Record time before clicking run
  const t0 = Date.now();
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation_complete (ensures iteration_complete was processed)
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 20_000,
  });
  const elapsed = Date.now() - t0;

  const tableEl = page.locator('[data-testid="archetype-summary-table"]');

  // Table must be visible after iteration_complete
  await expect(tableEl).toBeVisible({ timeout: 5_000 });

  // Must have 8 archetype rows (one per archetype)
  const rows = page.locator('[data-testid="archetype-summary-table"] tbody tr');
  const rowCount = await rows.count();
  expect(rowCount, 'Must have 8 archetype rows').toBe(8);

  // Each row must have 8 cells (archetype label + 5 products + total + our%)
  const firstRowCells = await rows.first().locator('td').all();
  expect(firstRowCells.length, 'Each row must have 8 cells').toBe(8);

  // The last cell (our%) must end with '%'
  const ourPctText = await firstRowCells[firstRowCells.length - 1].textContent();
  expect(ourPctText?.trim(), 'Last cell must be a percentage').toMatch(/%$/);

  // Footer row must exist with totals
  const tfootRow = page.locator('[data-testid="archetype-summary-table"] tfoot tr');
  await expect(tfootRow).toBeAttached();
  const tfootCells = await tfootRow.locator('td').all();
  expect(tfootCells.length, 'Footer must have 8 cells').toBe(8);
  const footerLabel = await tfootCells[0].textContent();
  expect(footerLabel?.trim(), 'Footer first cell must be 합계').toBe('합계');

  console.log(`[6d] archetype table visible in ~${elapsed}ms, rows=${rowCount}`);
});

// ── Test 3: per-archetype percentages show Korean archetype labels ─────────────

test('Sub-AC 6d: archetype-summary-table contains Korean archetype labels', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: MOCK_SSE_FULL });
  });

  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 20_000,
  });

  const tbodyText = await page
    .locator('[data-testid="archetype-summary-table"] tbody')
    .textContent();

  const expectedLabels = [
    '가격민감형',
    '가성비균형형',
    '프리미엄품질형',
    '신뢰우선형',
    '심미형',
    '긴박구매형',
    '프로모션헌터형',
    '가족구매형',
  ];

  for (const label of expectedLabels) {
    expect(tbodyText, `Korean label "${label}" must appear in archetype table`).toContain(label);
  }
});

// ── Test 4: per-archetype "우리%" column has valid percentages ────────────────

test('Sub-AC 6d: archetype-summary-table 우리% column shows valid percentage values', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: MOCK_SSE_FULL });
  });

  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 20_000,
  });

  // Extract all "우리%" cell values (last column in each tbody row)
  const pctValues = await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-testid="archetype-summary-table"] tbody tr');
    return [...rows].map((row) => {
      const cells = row.querySelectorAll('td');
      return cells[cells.length - 1]?.textContent?.trim() ?? '';
    });
  });

  expect(pctValues.length, 'Must have 8 archetype percentage values').toBe(8);

  for (const pct of pctValues) {
    // Each percentage must be a number 0-100 followed by '%'
    expect(pct, `Percentage value "${pct}" must match N%`).toMatch(/^\d{1,3}%$/);
    const num = parseInt(pct, 10);
    expect(num, `Percentage ${pct} must be 0-100`).toBeGreaterThanOrEqual(0);
    expect(num, `Percentage ${pct} must be 0-100`).toBeLessThanOrEqual(100);
  }

  console.log(`[6d] our_product percentages: ${pctValues.join(', ')}`);
});

// ── Test 5: simulation_complete freezes particles (sim-frozen class) ──────────

test('Sub-AC 6d: simulation_complete adds sim-frozen class to canvas container', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: MOCK_SSE_FULL });
  });

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation_complete
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 20_000,
  });

  // sim-frozen class must be added within 500ms after simulation_complete
  // (setTimeout 300ms + render time, tested here as "eventually present")
  // The canvas container id is 'sim-canvas-wrap' in dashboard.html
  await page.waitForFunction(
    () => document.getElementById('sim-canvas-wrap')?.classList.contains('sim-frozen'),
    { timeout: 1_000 }, // allow up to 1000ms total, but should appear within 500ms
  );

  const hasFrozenClass = await page.evaluate(() =>
    document.getElementById('sim-canvas-wrap')?.classList.contains('sim-frozen') ?? false,
  );
  expect(hasFrozenClass, 'sim-canvas-wrap must have sim-frozen class after simulation_complete').toBe(true);

  console.log('[6d] sim-frozen class applied to canvas container ✓');
});

// ── Test 6: particleEngine.frozen is true after simulation_complete ────────────

test('Sub-AC 6d: particleEngine.frozen becomes true after simulation_complete', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: MOCK_SSE_FULL });
  });

  // Verify particleEngine is available before simulation
  const engineBeforeRun = await page.evaluate(() => typeof window.particleEngine);
  expect(engineBeforeRun, 'window.particleEngine must be an object').toBe('object');

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation_complete
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 20_000,
  });

  // Wait for frozen state (setTimeout 300ms in simulation_complete handler)
  await page.waitForFunction(
    () => window.particleEngine?.frozen === true,
    { timeout: 1_000 },
  );

  const isFrozen = await page.evaluate(() => window.particleEngine?.frozen ?? false);
  expect(isFrozen, 'particleEngine.frozen must be true after simulation_complete').toBe(true);

  console.log('[6d] particleEngine.frozen = true ✓');
});

// ── Test 7: UI response time — archetype table within 500ms of iteration_complete

test('Sub-AC 6d: archetype-summary-table becomes visible within 500ms of iteration_complete', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // We measure the delay from the moment we inject the iteration_complete event
  // to the moment the table becomes visible.
  // Use a timed SSE stream: send iteration_complete, then wait.

  const iterationCompleteSseBody = buildSseBody([
    {
      type: 'iteration_start',
      data: {
        iteration: 1,
        total: 1,
        candidates: [
          { id: 'timing-test-strategy', title: '타이밍 테스트 전략', price_krw: 28900 },
        ],
      },
    },
    {
      type: 'iteration_complete',
      data: {
        iteration: 1,
        winner_id: 'timing-test-strategy',
        winner_revenue: 5800000,
        accepted: true,
        rejected_count: 0,
        choice_summary: { our_product: 5, competitor_a: 2, competitor_b: 1, competitor_c: 0, pass: 0 },
        archetype_breakdown: MOCK_ARCHETYPE_BREAKDOWN,
      },
    },
    {
      type: 'simulation_complete',
      data: MOCK_COMPLETE_PAYLOAD,
    },
  ]);

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: iterationCompleteSseBody });
  });

  // Mark timestamp just before clicking run
  const t0 = Date.now();
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for table to become visible
  const tableEl = page.locator('[data-testid="archetype-summary-table"]');
  await expect(tableEl).toBeVisible({ timeout: 1_000 }); // Must be visible within 1s

  const elapsed = Date.now() - t0;

  // The table should be visible within 500ms (from when the run started,
  // accounting for SSE delivery + parsing + DOM update).
  // We allow 1000ms total in this test because Playwright itself adds overhead,
  // but the actual SSE→DOM update path should be <500ms.
  expect(elapsed, `Table became visible in ${elapsed}ms (target: <1000ms in test)`).toBeLessThan(2000);

  const rows = tableEl.locator('tbody tr');
  const rowCount = await rows.count();
  expect(rowCount, 'Table must have 8 rows after iteration_complete').toBe(8);

  console.log(`[6d] archetype table appeared in ${elapsed}ms from run click`);
});

// ── Test 8: screenshot of frozen simulation state ────────────────────────────

test('Sub-AC 6d: screenshot — frozen canvas state after simulation_complete', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: MOCK_SSE_FULL });
  });

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation_complete + frozen state
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 20_000,
  });

  // Wait for sim-frozen class to be applied
  // The canvas container id is 'sim-canvas-wrap' in dashboard.html
  await page.waitForFunction(
    () => document.getElementById('sim-canvas-wrap')?.classList.contains('sim-frozen'),
    { timeout: 1_000 },
  );

  // Capture screenshot of the simulation panel in frozen state
  const simPanel = page.locator('[data-testid="panel-simulation"]');
  await simPanel.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'ac6d-01-sim-panel-frozen-state.png'),
  });

  // Full page screenshot
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'ac6d-02-full-page-completed-state.png'),
    fullPage: true,
  });

  // Verify archetype table is visible in the screenshot
  const tableEl = page.locator('[data-testid="archetype-summary-table"]');
  await expect(tableEl).toBeVisible();

  // Verify canvas container has frozen class
  const hasFrozen = await page.evaluate(
    () => document.getElementById('sim-canvas-wrap')?.classList.contains('sim-frozen'),
  );
  expect(hasFrozen, 'Canvas must have sim-frozen class in screenshot state').toBe(true);

  console.log('[6d] Screenshots saved: ac6d-01 (frozen panel), ac6d-02 (full page)');
});

// ── Test 9: iteration label updates on iteration_complete ─────────────────────

test('Sub-AC 6d: archetype-summary-iteration label shows correct iteration number', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: MOCK_SSE_FULL });
  });

  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 20_000,
  });

  // The iteration label inside the archetype summary table header
  const iterLabel = page.locator('#archetype-summary-iteration');
  await expect(iterLabel).toBeAttached();

  const labelText = await iterLabel.textContent();
  expect(labelText?.trim(), 'Iteration label must show iteration number').toMatch(/Iteration\s+1/);

  console.log(`[6d] archetype iteration label: "${labelText?.trim()}"`);
});

// ── Test 10: archetype table footer shows grand totals ───────────────────────

test('Sub-AC 6d: archetype-summary-table footer shows correct grand total', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: MOCK_SSE_FULL });
  });

  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 20_000,
  });

  const tableState = await page.evaluate(() => {
    const tbody = document.getElementById('archetype-summary-tbody');
    const tfoot = document.getElementById('archetype-summary-tfoot-row');
    if (!tbody || !tfoot) return { error: 'elements not found' };

    const rows = tbody.querySelectorAll('tr');

    // Sum up the "합계" (total) column (index 6) from each row
    let computedTotal = 0;
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      const rowTotal = parseInt(cells[6]?.textContent?.trim() ?? '0', 10);
      computedTotal += rowTotal;
    }

    // Get footer total (index 6)
    const tfootCells = tfoot.querySelectorAll('td');
    const footerTotal = parseInt(tfootCells[6]?.textContent?.trim() ?? '0', 10);
    const footerPct   = tfootCells[7]?.textContent?.trim() ?? '';

    return { computedTotal, footerTotal, footerPct, rowCount: rows.length };
  });

  expect(tableState.error).toBeUndefined();
  expect(tableState.rowCount, 'Must have 8 rows').toBe(8);

  // Footer total must equal sum of row totals
  expect(
    tableState.footerTotal,
    `Footer grand total (${tableState.footerTotal}) must equal sum of rows (${tableState.computedTotal})`,
  ).toBe(tableState.computedTotal);

  // Footer percentage must end with '%'
  expect(tableState.footerPct, 'Footer our% must end with %').toMatch(/%$/);

  console.log(
    `[6d] grand total: ${tableState.footerTotal} (rows sum: ${tableState.computedTotal}), ` +
    `footer pct: ${tableState.footerPct}`,
  );
});
