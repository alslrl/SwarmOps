/**
 * playwright-input-strategy-lobster-ac8-2.spec.mjs
 *
 * Sub-AC 8.2: Editable input controls connected to Strategy Lobster panel
 *
 * Verifies:
 *   1. All 6 editable input fields are pre-populated from fixtures on load
 *   2. margin-rate auto-updates (local state) when price or cost is edited
 *   3. Input fields are disabled (locked) while simulation runs
 *   4. Input fields are re-enabled with the same values after simulation
 *   5. Edited values (title, price) are sent in the SSE request body
 *   6. Strategy Lobster panel becomes visible when simulation runs
 *   7. Strategy Lobster shows candidates during simulation
 *   8. After simulation_complete, diff-title-before shows the user-edited title
 *   9. After simulation_complete, diff-price-before shows the user-edited price
 *  10. Changing title from fixture default then running → diff shows custom title
 *
 * PRD §12.11, §14.5, §16
 * Port: 3120 — dedicated, no collision
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';

const PORT = 3120;
const BASE_URL = `http://127.0.0.1:${PORT}`;

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

// ── SSE helpers ───────────────────────────────────────────────────────────────

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
};

function buildSseBody(events) {
  return events
    .map(({ type, data }) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

// ── Page helpers ──────────────────────────────────────────────────────────────

async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

// ── Test 1: All 6 input fields pre-populated from fixtures ────────────────────

test('ac8-2: all 6 editable input fields are pre-populated from fixtures on load', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Title field — must have non-empty value from fixture
  const titleVal = await page.locator('[data-testid="input-title"]').inputValue();
  expect(titleVal.trim().length).toBeGreaterThan(0);

  // Top copy — must have non-empty value
  const topCopyVal = await page.locator('[data-testid="input-top-copy"]').inputValue();
  expect(topCopyVal.trim().length).toBeGreaterThan(0);

  // Price — must be a positive number
  const priceVal = await page.locator('[data-testid="input-price"]').inputValue();
  expect(Number(priceVal)).toBeGreaterThan(0);

  // Cost — must be a positive number
  const costVal = await page.locator('[data-testid="input-cost"]').inputValue();
  expect(Number(costVal)).toBeGreaterThan(0);

  // Iteration count — must be a positive integer (default 5)
  const iterVal = await page.locator('[data-testid="input-iteration-count"]').inputValue();
  expect(Number(iterVal)).toBeGreaterThanOrEqual(1);

  // Margin floor — must be a decimal between 0.10 and 0.90 (default 0.35)
  const marginFloorVal = await page.locator('[data-testid="input-margin-floor"]').inputValue();
  const marginFloorNum = Number(marginFloorVal);
  expect(marginFloorNum).toBeGreaterThanOrEqual(0.10);
  expect(marginFloorNum).toBeLessThanOrEqual(0.90);
});

// ── Test 2: margin-rate auto-updates on price/cost change (local state) ───────

test('ac8-2: margin-rate auto-updates when price or cost is edited', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Set a known price and cost so we can compute expected margin
  await page.locator('[data-testid="input-price"]').fill('20000');
  await page.locator('[data-testid="input-cost"]').fill('8000');

  // margin = (20000 - 8000) / 20000 * 100 = 60.0%
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="margin-rate"]');
      return el && el.textContent.includes('60');
    },
    { timeout: 3_000 },
  );

  const marginText = await page.locator('[data-testid="margin-rate"]').textContent();
  expect(marginText?.trim()).toMatch(/60[.,]?0?%/);

  // Change price to 10000 — margin should update to 20%
  await page.locator('[data-testid="input-price"]').fill('10000');

  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="margin-rate"]');
      return el && el.textContent.includes('20');
    },
    { timeout: 3_000 },
  );

  const marginText2 = await page.locator('[data-testid="margin-rate"]').textContent();
  expect(marginText2?.trim()).toMatch(/20[.,]?0?%/);
});

// ── Test 3: Input fields locked (disabled) during simulation run ──────────────

test('ac8-2: input fields are disabled while simulation is running', async ({ page }) => {
  // Deferred mock: hold the SSE connection open until the test explicitly releases it.
  // This prevents the fast-path race where all events arrive before waitForFunction polls.
  let releaseRoute;
  const holdPromise = new Promise((resolve) => { releaseRoute = resolve; });

  await page.route('**/api/run/stream', async (route) => {
    // Wait until the test signals it's done checking the disabled state
    await holdPromise;
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: {
            iteration: 1,
            total: 1,
            candidates: [
              { id: 'c1', title: '전략 A', price_krw: 28900, rationale: '근거 A' },
            ],
          },
        },
        {
          type: 'iteration_complete',
          data: {
            iteration: 1,
            winner_id: 'c1',
            winner_revenue: 5800000,
            accepted: true,
            rejected_count: 0,
            choice_summary: { our_product: 450, competitor_a: 150, competitor_b: 100, competitor_c: 60, pass: 40 },
            archetype_breakdown: {},
          },
        },
        {
          type: 'simulation_complete',
          data: {
            baseline: { id: 'baseline', title: '기존 제목', top_copy: '기존 카피', price_krw: 29900, simulated_revenue: 5800000, margin_rate: 0.632 },
            selected_strategy: { id: 'c1', title: '전략 A', top_copy: '전략 A 카피', price_krw: 28900, simulated_revenue: 6100000, margin_rate: 0.619, rationale: '전략 근거' },
            holdout: { holdout_uplift: 300000, holdout_revenue: 6100000, margin_floor_violations: 0 },
            diff: {
              title: { before: '기존 제목', after: '전략 A' },
              top_copy: { before: '기존 카피', after: '전략 A 카피' },
              price: { before: 29900, after: 28900 },
            },
            artifact: { payload: { selected_strategy_id: 'c1', holdout_uplift: 300000, generated_at: new Date().toISOString() } },
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Click Run — runSimulation() calls setInputsDisabled(true) BEFORE the first await,
  // then suspends on await fetch(). Because the route is held, the fetch stays pending
  // and the inputs remain disabled while we check.
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for disabled state to be set (runSimulation has passed setInputsDisabled(true))
  await page.waitForFunction(
    () => {
      const titleEl = document.querySelector('[data-testid="input-title"]');
      return titleEl && titleEl.disabled === true;
    },
    { timeout: 5_000 },
  );

  const titleDisabled    = await page.locator('[data-testid="input-title"]').isDisabled();
  const topCopyDisabled  = await page.locator('[data-testid="input-top-copy"]').isDisabled();
  const priceDisabled    = await page.locator('[data-testid="input-price"]').isDisabled();
  const costDisabled     = await page.locator('[data-testid="input-cost"]').isDisabled();

  expect(titleDisabled).toBe(true);
  expect(topCopyDisabled).toBe(true);
  expect(priceDisabled).toBe(true);
  expect(costDisabled).toBe(true);

  // Release the held route — let SSE response arrive and simulation complete
  releaseRoute();
  // Wait for simulation to finish so afterAll server.close() is clean
  await page.waitForSelector('[data-testid="state-completed"]', { state: 'visible', timeout: 15_000 });
});

// ── Test 4: Input fields re-enabled after simulation completes ────────────────

test('ac8-2: input fields are re-enabled with same values after simulation completes', async ({ page }) => {
  const CUSTOM_TITLE = '커스텀 테스트 제목 — 재활성화 검증';
  const CUSTOM_PRICE = '27500';

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: { iteration: 1, total: 1, candidates: [{ id: 'c1', title: '전략 A', price_krw: 27500, rationale: '근거' }] },
        },
        {
          type: 'iteration_complete',
          data: {
            iteration: 1,
            winner_id: 'c1',
            winner_revenue: 5500000,
            accepted: true,
            rejected_count: 0,
            choice_summary: { our_product: 440, competitor_a: 160, competitor_b: 100, competitor_c: 60, pass: 40 },
            archetype_breakdown: {},
          },
        },
        {
          type: 'simulation_complete',
          data: {
            baseline: { id: 'baseline', title: CUSTOM_TITLE, top_copy: '카피', price_krw: Number(CUSTOM_PRICE), simulated_revenue: 5500000, margin_rate: 0.6 },
            selected_strategy: { id: 'c1', title: '전략 A', top_copy: '전략 카피', price_krw: 27500, simulated_revenue: 5800000, margin_rate: 0.595, rationale: '근거' },
            holdout: { holdout_uplift: 300000, holdout_revenue: 5800000, margin_floor_violations: 0 },
            diff: {
              title: { before: CUSTOM_TITLE, after: '전략 A' },
              top_copy: { before: '카피', after: '전략 카피' },
              price: { before: Number(CUSTOM_PRICE), after: 27500 },
            },
            artifact: { payload: { selected_strategy_id: 'c1', holdout_uplift: 300000, generated_at: new Date().toISOString() } },
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Edit title and price
  await page.locator('[data-testid="input-title"]').fill(CUSTOM_TITLE);
  await page.locator('[data-testid="input-price"]').fill(CUSTOM_PRICE);

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation to complete
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 15_000,
  });

  // After completion, input fields must be re-enabled
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="input-title"]');
      return el && el.disabled === false;
    },
    { timeout: 5_000 },
  );

  const titleEnabled = await page.locator('[data-testid="input-title"]').isEnabled();
  const priceEnabled = await page.locator('[data-testid="input-price"]').isEnabled();
  expect(titleEnabled).toBe(true);
  expect(priceEnabled).toBe(true);

  // Values must be preserved (same as what user typed)
  const titleVal = await page.locator('[data-testid="input-title"]').inputValue();
  const priceVal = await page.locator('[data-testid="input-price"]').inputValue();
  expect(titleVal.trim()).toBe(CUSTOM_TITLE);
  expect(priceVal).toBe(CUSTOM_PRICE);
});

// ── Test 5: Edited values are sent in the request body ───────────────────────

test('ac8-2: edited title and price values are sent in the SSE request body', async ({ page }) => {
  const CUSTOM_TITLE = '테스트 오버라이드 타이틀 검증용';
  const CUSTOM_PRICE = '24900';

  let capturedRequestBody = null;

  // Intercept the SSE route and capture the request body
  await page.route('**/api/run/stream', async (route) => {
    const request = route.request();
    try {
      capturedRequestBody = JSON.parse(request.postData() ?? '{}');
    } catch {
      capturedRequestBody = {};
    }

    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: { iteration: 1, total: 1, candidates: [{ id: 'c1', title: CUSTOM_TITLE, price_krw: Number(CUSTOM_PRICE), rationale: '근거' }] },
        },
        {
          type: 'simulation_complete',
          data: {
            baseline: { id: 'baseline', title: CUSTOM_TITLE, top_copy: '카피', price_krw: Number(CUSTOM_PRICE), simulated_revenue: 4950000, margin_rate: 0.6 },
            selected_strategy: { id: 'c1', title: CUSTOM_TITLE, top_copy: '카피', price_krw: Number(CUSTOM_PRICE), simulated_revenue: 5000000, margin_rate: 0.6, rationale: '근거' },
            holdout: { holdout_uplift: 50000, holdout_revenue: 5000000, margin_floor_violations: 0 },
            diff: {
              title: { before: CUSTOM_TITLE, after: CUSTOM_TITLE },
              top_copy: { before: '카피', after: '카피' },
              price: { before: Number(CUSTOM_PRICE), after: Number(CUSTOM_PRICE) },
            },
            artifact: { payload: { selected_strategy_id: 'c1', holdout_uplift: 50000, generated_at: new Date().toISOString() } },
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Edit fields
  await page.locator('[data-testid="input-title"]').fill(CUSTOM_TITLE);
  await page.locator('[data-testid="input-price"]').fill(CUSTOM_PRICE);

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for iteration_start to be processed (lobster becomes visible)
  await page.waitForFunction(
    () => {
      const el = document.getElementById('strategy-lobster');
      return el && el.style.display !== 'none' && el.style.display !== '';
    },
    { timeout: 10_000 },
  );

  // Verify the captured request body contains the overridden values
  expect(capturedRequestBody).not.toBeNull();
  expect(capturedRequestBody.title).toBe(CUSTOM_TITLE);
  expect(capturedRequestBody.priceKrw).toBe(Number(CUSTOM_PRICE));
});

// ── Test 6: Strategy Lobster becomes visible when simulation runs ─────────────

test('ac8-2: Strategy Lobster panel becomes visible when simulation is running', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: {
            iteration: 1,
            total: 2,
            candidates: [
              { id: 'c1', title: '에디터블 테스트 전략 1', price_krw: 28900, rationale: '전략 1 근거' },
              { id: 'c2', title: '에디터블 테스트 전략 2', price_krw: 29900, rationale: '전략 2 근거' },
              { id: 'c3', title: '에디터블 테스트 전략 3', price_krw: 31900, rationale: '전략 3 근거' },
            ],
            strategy_reasoning: '에디터블 입력값 기반 전략 생성',
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Verify lobster is hidden before run
  const hiddenBefore = await page.evaluate(() => {
    const el = document.getElementById('strategy-lobster');
    return el ? getComputedStyle(el).display : 'element-not-found';
  });
  expect(hiddenBefore).toBe('none');

  // Click Run
  await page.locator('[data-testid="btn-run"]').click();

  // Lobster must become visible
  await page.waitForFunction(
    () => {
      const el = document.getElementById('strategy-lobster');
      return el && el.style.display === 'block';
    },
    { timeout: 10_000 },
  );

  await expect(page.locator('[data-testid="strategy-lobster"]')).toBeVisible();

  // Verify iteration label is set
  const labelText = await page.locator('[data-testid="strategy-iteration-label"]').textContent();
  expect(labelText?.trim()).toMatch(/Iteration\s+1\s*\/\s*2/i);
});

// ── Test 7: Strategy Lobster shows 3 candidate cards from iteration_start ──────

test('ac8-2: Strategy Lobster shows 3 candidate cards with title, price, rationale from iteration_start', async ({ page }) => {
  const candidates = [
    { id: 'inp-1', title: '입력 기반 전략 Alpha', price_krw: 27900, rationale: '알파 전략 — 가격 인하' },
    { id: 'inp-2', title: '입력 기반 전략 Beta',  price_krw: 29900, rationale: '베타 전략 — 카피 강화' },
    { id: 'inp-3', title: '입력 기반 전략 Gamma', price_krw: 32900, rationale: '감마 전략 — 프리미엄 포지셔닝' },
  ];

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: { iteration: 1, total: 1, candidates, strategy_reasoning: '입력 파라미터 기반 전략 생성' },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Edit title to confirm the lobster is showing candidates for custom inputs
  await page.locator('[data-testid="input-title"]').fill('커스텀 제목으로 전략가재 테스트');
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for lobster to appear
  await page.waitForFunction(
    () => {
      const el = document.getElementById('strategy-lobster');
      return el && el.style.display === 'block';
    },
    { timeout: 10_000 },
  );

  // Wait for all candidate titles to be populated
  await page.waitForFunction(
    () => {
      const t1 = document.getElementById('candidate-1-title');
      const t2 = document.getElementById('candidate-2-title');
      const t3 = document.getElementById('candidate-3-title');
      return (
        t1 && t1.textContent.trim().length > 1 &&
        t2 && t2.textContent.trim().length > 1 &&
        t3 && t3.textContent.trim().length > 1
      );
    },
    { timeout: 10_000 },
  );

  // Verify titles
  const t1 = await page.locator('#candidate-1-title').textContent();
  const t2 = await page.locator('#candidate-2-title').textContent();
  const t3 = await page.locator('#candidate-3-title').textContent();
  expect(t1?.trim()).toBe(candidates[0].title);
  expect(t2?.trim()).toBe(candidates[1].title);
  expect(t3?.trim()).toBe(candidates[2].title);

  // Verify KRW prices
  const p1 = await page.locator('#candidate-1-price').textContent();
  const p2 = await page.locator('#candidate-2-price').textContent();
  const p3 = await page.locator('#candidate-3-price').textContent();
  expect(p1?.trim()).toMatch(/27[,.]?900/);
  expect(p2?.trim()).toMatch(/29[,.]?900/);
  expect(p3?.trim()).toMatch(/32[,.]?900/);

  // Verify rationales
  const r1 = await page.locator('#candidate-1-rationale').textContent();
  const r2 = await page.locator('#candidate-2-rationale').textContent();
  const r3 = await page.locator('#candidate-3-rationale').textContent();
  expect(r1?.trim()).toBe(candidates[0].rationale);
  expect(r2?.trim()).toBe(candidates[1].rationale);
  expect(r3?.trim()).toBe(candidates[2].rationale);
});

// ── Test 8: diff-title-before shows the user-edited title ────────────────────

test('ac8-2: after simulation_complete, diff-title-before shows the user-edited title', async ({ page }) => {
  const CUSTOM_TITLE = '사용자가 직접 입력한 테스트 제목 — diff 검증용';
  const STRATEGY_TITLE = '전략가재가 추천한 최적화 제목';

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: {
            iteration: 1,
            total: 1,
            candidates: [{ id: 'strat-1', title: STRATEGY_TITLE, price_krw: 28500, rationale: '최적화 근거' }],
          },
        },
        {
          type: 'iteration_complete',
          data: {
            iteration: 1,
            winner_id: 'strat-1',
            winner_revenue: 6000000,
            accepted: true,
            rejected_count: 0,
            choice_summary: { our_product: 460, competitor_a: 140, competitor_b: 100, competitor_c: 60, pass: 40 },
            archetype_breakdown: {},
          },
        },
        {
          type: 'simulation_complete',
          data: {
            baseline: {
              id: 'baseline',
              title: CUSTOM_TITLE,
              top_copy: '기존 카피',
              price_krw: 29900,
              simulated_revenue: 5800000,
              margin_rate: 0.632,
            },
            selected_strategy: {
              id: 'strat-1',
              title: STRATEGY_TITLE,
              top_copy: '추천 카피',
              price_krw: 28500,
              simulated_revenue: 6000000,
              margin_rate: 0.614,
              rationale: '최적화 근거',
            },
            holdout: { holdout_uplift: 200000, holdout_revenue: 6000000, margin_floor_violations: 0 },
            diff: {
              title: { before: CUSTOM_TITLE, after: STRATEGY_TITLE },
              top_copy: { before: '기존 카피', after: '추천 카피' },
              price: { before: 29900, after: 28500 },
            },
            artifact: { payload: { selected_strategy_id: 'strat-1', holdout_uplift: 200000, generated_at: new Date().toISOString() } },
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Edit title to a custom value
  await page.locator('[data-testid="input-title"]').fill(CUSTOM_TITLE);

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for completion
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 15_000,
  });

  // Wait for diff to be populated
  await page.waitForFunction(
    () => {
      const el = document.getElementById('diff-title-before');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 5_000 },
  );

  // Verify diff-title-before shows the custom title the user entered
  const diffTitleBefore = await page.locator('#diff-title-before').textContent();
  expect(diffTitleBefore?.trim()).toBe(CUSTOM_TITLE);

  // Verify diff-title-after shows the strategy title
  const diffTitleAfter = await page.locator('#diff-title-after').textContent();
  expect(diffTitleAfter?.trim()).toBe(STRATEGY_TITLE);
});

// ── Test 9: diff-price-before shows the user-edited price ────────────────────

test('ac8-2: after simulation_complete, diff-price-before shows the user-edited price', async ({ page }) => {
  const CUSTOM_PRICE_KRW = 24900;
  const STRATEGY_PRICE_KRW = 22900;

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: {
            iteration: 1,
            total: 1,
            candidates: [{ id: 'price-strat', title: '가격 최적화 전략', price_krw: STRATEGY_PRICE_KRW, rationale: '가격 인하 근거' }],
          },
        },
        {
          type: 'iteration_complete',
          data: {
            iteration: 1,
            winner_id: 'price-strat',
            winner_revenue: 5740000,
            accepted: true,
            rejected_count: 0,
            choice_summary: { our_product: 500, competitor_a: 140, competitor_b: 80, competitor_c: 50, pass: 30 },
            archetype_breakdown: {},
          },
        },
        {
          type: 'simulation_complete',
          data: {
            baseline: { id: 'baseline', title: '기존 제목', top_copy: '기존 카피', price_krw: CUSTOM_PRICE_KRW, simulated_revenue: 4980000, margin_rate: 0.598 },
            selected_strategy: { id: 'price-strat', title: '가격 최적화 전략', top_copy: '최적화 카피', price_krw: STRATEGY_PRICE_KRW, simulated_revenue: 5740000, margin_rate: 0.579, rationale: '근거' },
            holdout: { holdout_uplift: 760000, holdout_revenue: 5740000, margin_floor_violations: 0 },
            diff: {
              title: { before: '기존 제목', after: '가격 최적화 전략' },
              top_copy: { before: '기존 카피', after: '최적화 카피' },
              price: { before: CUSTOM_PRICE_KRW, after: STRATEGY_PRICE_KRW },
            },
            artifact: { payload: { selected_strategy_id: 'price-strat', holdout_uplift: 760000, generated_at: new Date().toISOString() } },
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Set custom price
  await page.locator('[data-testid="input-price"]').fill(String(CUSTOM_PRICE_KRW));

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for completion
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 15_000,
  });

  // Wait for diff price to be populated
  await page.waitForFunction(
    () => {
      const el = document.getElementById('diff-price-before');
      return el && el.textContent.trim().length > 0 && el.textContent.trim() !== '—';
    },
    { timeout: 5_000 },
  );

  // diff-price-before must show KRW-formatted custom price
  const diffPriceBefore = await page.locator('#diff-price-before').textContent();
  expect(diffPriceBefore?.trim()).toMatch(/24[,.]?900/);

  // diff-price-after must show the strategy price
  const diffPriceAfter = await page.locator('#diff-price-after').textContent();
  expect(diffPriceAfter?.trim()).toMatch(/22[,.]?900/);
});

// ── Test 10: Full edit-run-verify cycle ───────────────────────────────────────

test('ac8-2: full cycle — edit title + price → run → Strategy Lobster shows → diff reflects edits', async ({ page }) => {
  const EDITED_TITLE = '완전히 새로운 제목 — 에디터블 입력 종합 검증';
  const EDITED_PRICE = '26900';
  const WINNER_TITLE = '최적화된 전략 제목';

  let requestBody = null;

  await page.route('**/api/run/stream', async (route) => {
    try { requestBody = JSON.parse(route.request().postData() ?? '{}'); } catch { requestBody = {}; }

    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: {
            iteration: 1,
            total: 1,
            candidates: [
              { id: 'final-1', title: WINNER_TITLE, price_krw: 25900, rationale: '최적화 근거' },
              { id: 'final-2', title: '2번 전략',    price_krw: 26900, rationale: '2번 근거' },
              { id: 'final-3', title: '3번 전략',    price_krw: 27900, rationale: '3번 근거' },
            ],
            strategy_reasoning: '편집된 입력 기반 전략 제안',
          },
        },
        {
          type: 'iteration_complete',
          data: {
            iteration: 1,
            winner_id: 'final-1',
            winner_revenue: 6200000,
            accepted: true,
            rejected_count: 2,
            choice_summary: { our_product: 480, competitor_a: 130, competitor_b: 90, competitor_c: 60, pass: 40 },
            archetype_breakdown: {},
          },
        },
        {
          type: 'simulation_complete',
          data: {
            baseline: { id: 'baseline', title: EDITED_TITLE, top_copy: '기존 카피', price_krw: Number(EDITED_PRICE), simulated_revenue: 5380000, margin_rate: 0.6 },
            selected_strategy: { id: 'final-1', title: WINNER_TITLE, top_copy: '최적 카피', price_krw: 25900, simulated_revenue: 6200000, margin_rate: 0.585, rationale: '최적화 근거' },
            holdout: { holdout_uplift: 820000, holdout_revenue: 6200000, margin_floor_violations: 0 },
            diff: {
              title: { before: EDITED_TITLE, after: WINNER_TITLE },
              top_copy: { before: '기존 카피', after: '최적 카피' },
              price: { before: Number(EDITED_PRICE), after: 25900 },
            },
            artifact: { payload: { selected_strategy_id: 'final-1', holdout_uplift: 820000, generated_at: new Date().toISOString() } },
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // ── 1. Edit title and price ───────────────────────────────────────────────
  await page.locator('[data-testid="input-title"]').fill(EDITED_TITLE);
  await page.locator('[data-testid="input-price"]').fill(EDITED_PRICE);

  // ── 2. Click Run ──────────────────────────────────────────────────────────
  await page.locator('[data-testid="btn-run"]').click();

  // ── 3. Strategy Lobster appears ───────────────────────────────────────────
  await page.waitForFunction(
    () => {
      const el = document.getElementById('strategy-lobster');
      return el && el.style.display === 'block';
    },
    { timeout: 10_000 },
  );
  await expect(page.locator('[data-testid="strategy-lobster"]')).toBeVisible();

  // ── 4. All 3 candidate cards show ────────────────────────────────────────
  await expect(page.locator('[data-testid="strategy-candidate-1"]')).toBeAttached();
  await expect(page.locator('[data-testid="strategy-candidate-2"]')).toBeAttached();
  await expect(page.locator('[data-testid="strategy-candidate-3"]')).toBeAttached();

  // ── 5. Wait for completion ────────────────────────────────────────────────
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 15_000,
  });

  // ── 6. Verify request contained edited values ─────────────────────────────
  expect(requestBody?.title).toBe(EDITED_TITLE);
  expect(requestBody?.priceKrw).toBe(Number(EDITED_PRICE));

  // ── 7. Verify diff reflects edited baseline ───────────────────────────────
  await page.waitForFunction(
    () => {
      const el = document.getElementById('diff-title-before');
      return el && el.textContent.trim().length > 1;
    },
    { timeout: 5_000 },
  );

  const diffBefore = await page.locator('#diff-title-before').textContent();
  expect(diffBefore?.trim()).toBe(EDITED_TITLE);

  const diffPriceBefore = await page.locator('#diff-price-before').textContent();
  expect(diffPriceBefore?.trim()).toMatch(/26[,.]?900/);

  // ── 8. Winner candidate 1 should be highlighted ───────────────────────────
  const card1Classes = await page.locator('[data-testid="strategy-candidate-1"]').getAttribute('class');
  expect(card1Classes).toContain('candidate-winner-active');

  // ── 9. Input fields re-enabled with same custom values ────────────────────
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="input-title"]')?.disabled,
    { timeout: 5_000 },
  );
  const titleAfter = await page.locator('[data-testid="input-title"]').inputValue();
  const priceAfter = await page.locator('[data-testid="input-price"]').inputValue();
  expect(titleAfter.trim()).toBe(EDITED_TITLE);
  expect(priceAfter).toBe(EDITED_PRICE);
});
