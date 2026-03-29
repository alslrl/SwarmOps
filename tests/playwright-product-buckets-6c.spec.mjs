/**
 * playwright-product-buckets-6c.spec.mjs — Sub-AC 6c
 *
 * Playwright tests for product bucket zones and real-time counters:
 *   1. 5 product bucket zones are rendered on the right side of the canvas
 *      with correct PRD-specified colors:
 *        our_product  = #2563eb
 *        competitor_a = #dc2626
 *        competitor_b = #ea580c
 *        competitor_c = #ca8a04
 *        pass         = #6b7280
 *   2. data-testid='product-counter-{id}' DOM elements increment
 *      within 500ms of each agent_decision SSE event
 *   3. data-testid='agent-count' shows '247 / 800 에이전트 완료' format
 *   4. product-bucket-panel overlay appears on the right side of sim-canvas-wrap
 *
 * Port: 3093 — dedicated, no collision with other specs
 *   3094: playwright-agent-profile-popup.spec.mjs
 *   3095: playwright-sse-midflow.spec.mjs
 *   3096: playwright-visual-judgment.spec.mjs
 *   3097: dashboard-e2e.spec.mjs
 *   3098: playwright-particle-bench.spec.mjs
 *   3099: playwright-screenshots.spec.mjs
 *
 * Sub-AC 6c | PRD §12.4, §16
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../artifacts/screenshots');
const PORT = 3093;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// ── Mock SSE helpers ──────────────────────────────────────────────────────────

/** Encode a list of { type, data } event objects as an SSE text body. */
function buildSseBody(events) {
  return events
    .map(({ type, data }) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('');
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
};

// ── Product color spec (PRD §12.4 / Sub-AC 6c) ───────────────────────────────

/**
 * Expected product bucket colors per PRD specification.
 * These must match BUCKET_DEFS in particle-engine.mjs.
 */
const PRODUCT_COLORS = {
  our_product:  '#2563eb',
  competitor_a: '#dc2626',
  competitor_b: '#ea580c',
  competitor_c: '#ca8a04',
  pass:         '#6b7280',
};

// ── Mock SSE data ─────────────────────────────────────────────────────────────

const ARCHETYPE_IDS = [
  'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
  'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
];

const PRODUCT_CYCLE = [
  'our_product', 'our_product', 'our_product',
  'competitor_a', 'competitor_a',
  'competitor_b',
  'competitor_c',
  'pass',
];

/** Generate N agent_decision events with agent_total=800. */
function makeAgentDecisionEvents(count) {
  return Array.from({ length: count }, (_, i) => ({
    type: 'agent_decision',
    data: {
      iteration:      1,
      agent_id:       `${ARCHETYPE_IDS[i % ARCHETYPE_IDS.length]}_${String(i).padStart(4, '0')}`,
      agent_name:     '테스트구매자',
      agent_index:    i,
      agent_total:    800,
      archetype_id:   ARCHETYPE_IDS[i % ARCHETYPE_IDS.length],
      chosen_product: PRODUCT_CYCLE[i % PRODUCT_CYCLE.length],
      reasoning:      '테스트 근거',
      price_sensitivity: 3.0,
      trust_sensitivity: 2.5,
      promo_affinity:    2.0,
      brand_bias:        1.5,
      pass_threshold:    0.3,
    },
  }));
}

const AGENT_DECISION_EVENTS_50 = makeAgentDecisionEvents(50);

const CHOICE_SUMMARY = { our_product: 20, competitor_a: 12, competitor_b: 6, competitor_c: 6, pass: 6 };

const MOCK_COMPLETE_PAYLOAD = {
  baseline: {
    id: 'baseline',
    title: '트리클리닉 엑스퍼트 스칼프 탈모 샴푸 500ml',
    top_copy: '두피과학 기반의 성분 설계',
    price_krw: 29900,
    simulated_revenue: 5651100,
    margin_rate: 0.632,
  },
  selected_strategy: {
    id: 'ac6c-test-strategy',
    title: '트리클리닉 두피과학 기반 탈모 샴푸',
    top_copy: '전문가 관점의 두피과학 설계',
    price_krw: 28900,
    simulated_revenue: 6200000,
    margin_rate: 0.619,
    rationale: 'Sub-AC 6c 검증용 전략',
  },
  holdout: { holdout_uplift: 548900, holdout_revenue: 6200000, margin_floor_violations: 0 },
  diff: {
    title: { before: '트리클리닉 엑스퍼트 스칼프 탈모 샴푸 500ml', after: '트리클리닉 두피과학 기반 탈모 샴푸' },
    top_copy: { before: '두피과학 기반의 성분 설계', after: '전문가 관점의 두피과학 설계' },
    price: { before: 29900, after: 28900 },
  },
  artifact: {
    payload: {
      selected_strategy_id: 'ac6c-test-strategy',
      holdout_uplift: 548900,
      generated_at: new Date().toISOString(),
    },
  },
};

const MOCK_SSE_BODY = buildSseBody([
  { type: 'iteration_start', data: { iteration: 1, total: 1, candidates: [
    { id: 'ac6c-test-strategy', title: '트리클리닉 두피과학 기반 탈모 샴푸', price_krw: 28900 },
  ]}},
  ...AGENT_DECISION_EVENTS_50,
  { type: 'iteration_complete', data: {
    iteration: 1, winner_id: 'ac6c-test-strategy', winner_revenue: 6200000,
    accepted: true, rejected_count: 0, choice_summary: CHOICE_SUMMARY, archetype_breakdown: {},
  }},
  { type: 'holdout_start', data: { message: 'Holdout 검증 진행 중...' }},
  { type: 'simulation_complete', data: MOCK_COMPLETE_PAYLOAD },
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

// ── Shared helpers ────────────────────────────────────────────────────────────

async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el != null && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

async function runMockSimulation(page) {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: MOCK_SSE_BODY,
    });
  });

  await page.locator('[data-testid="btn-run"]').click();

  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 20_000,
  });
}

// ── Test 1: SVG product node circles have correct PRD-spec fill colors ────────

test('Sub-AC 6c: SVG product node circles have correct PRD-spec fill colors', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Read the fill color of each product node circle from the SVG DOM
  const colors = await page.evaluate(() => {
    const result = {};
    const ids = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
    for (const id of ids) {
      const g = document.querySelector(`[data-product-id="${id}"]`);
      if (!g) { result[id] = null; continue; }
      const circle = g.querySelector('circle');
      result[id] = circle ? circle.getAttribute('fill') : null;
    }
    return result;
  });

  // Assert each color matches the PRD spec
  expect(colors.our_product,  'our_product should be #2563eb').toBe('#2563eb');
  expect(colors.competitor_a, 'competitor_a should be #dc2626').toBe('#dc2626');
  expect(colors.competitor_b, 'competitor_b should be #ea580c').toBe('#ea580c');
  expect(colors.competitor_c, 'competitor_c should be #ca8a04').toBe('#ca8a04');
  expect(colors.pass,         'pass should be #6b7280').toBe('#6b7280');

  console.log('[6c] SVG product node colors:', JSON.stringify(colors));
});

// ── Test 2: product-counter-{id} DOM elements exist and have initial value 0 ──

test('Sub-AC 6c: product-counter-{id} DOM elements exist with initial value 0', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const counterValues = await page.evaluate(() => {
    const ids = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
    const result = {};
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="product-counter-${id}"]`);
      result[id] = el ? el.textContent.trim() : null;
    }
    return result;
  });

  // All elements must exist (not null)
  for (const [id, val] of Object.entries(counterValues)) {
    expect(val, `product-counter-${id} element must exist`).not.toBeNull();
  }

  // All elements should have initial value '0'
  for (const [id, val] of Object.entries(counterValues)) {
    expect(val, `product-counter-${id} initial value should be '0'`).toBe('0');
  }

  console.log('[6c] initial counter values:', JSON.stringify(counterValues));
});

// ── Test 3: product-counter-{id} elements increment within 500ms of agent_decision ──

test('Sub-AC 6c: product counters increment within 500ms of agent_decision SSE events', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Run mock simulation (50 agent_decision events)
  await runMockSimulation(page);

  // Wait beyond the 220ms setTimeout (product counter increment delay)
  // Total: 220ms + 280ms buffer = 500ms max from last event
  await page.waitForTimeout(500);

  const counters = await page.evaluate(() => {
    const ids = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
    const result = {};
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="product-counter-${id}"]`);
      result[id] = el ? parseInt(el.textContent ?? '0', 10) : -1;
    }
    return result;
  });

  // All counter elements must exist (>= 0)
  for (const [id, val] of Object.entries(counters)) {
    expect(val, `counter element for ${id} must exist`).toBeGreaterThanOrEqual(0);
  }

  // Total must equal 50 (one increment per agent_decision event)
  const total = Object.values(counters).reduce((a, b) => a + b, 0);
  expect(total, 'total across all buckets must equal 50').toBe(50);

  // our_product gets 20 (highest in PRODUCT_CYCLE: 3/8 × 50)
  expect(counters.our_product, 'our_product should have 20 counts').toBe(20);
  // competitor_a gets 12 (2/8 × 50 — rounded by cycle pattern)
  expect(counters.competitor_a, 'competitor_a should have 12 counts').toBe(12);

  // All buckets must have non-zero counts (PRODUCT_CYCLE covers all 5)
  expect(counters.our_product,  'our_product must be > 0').toBeGreaterThan(0);
  expect(counters.competitor_a, 'competitor_a must be > 0').toBeGreaterThan(0);
  expect(counters.competitor_b, 'competitor_b must be > 0').toBeGreaterThan(0);
  expect(counters.competitor_c, 'competitor_c must be > 0').toBeGreaterThan(0);
  expect(counters.pass,         'pass must be > 0').toBeGreaterThan(0);

  console.log('[6c] product counters after 50 events:', JSON.stringify(counters), `total=${total}`);
});

// ── Test 4: agent-count displays "N / 800 에이전트 완료" format ──────────────

test('Sub-AC 6c: agent-count shows "N / 800 에이전트 완료" format', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Run mock simulation
  await runMockSimulation(page);

  const agentCountText = await page.evaluate(() => {
    const el = document.getElementById('agent-count');
    return el ? el.textContent.trim() : null;
  });

  expect(agentCountText, 'agent-count element must exist').not.toBeNull();
  // Must match "N / 800 에이전트 완료"
  expect(agentCountText).toMatch(/^\d+ \/ 800 에이전트 완료$/);

  // After 50 agent_decision events, count must be 50
  const match = agentCountText.match(/^(\d+) \/ 800 에이전트 완료$/);
  expect(match).not.toBeNull();
  const receivedCount = Number(match[1]);
  expect(receivedCount).toBe(50);

  console.log(`[6c] agent-count: "${agentCountText}" (count=${receivedCount})`);
});

// ── Test 5: product-bucket-panel visible on right side during simulation ──────

test('Sub-AC 6c: product-bucket-panel is visible on the right side of canvas during simulation', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Before simulation: bucket panel should not be visible (hidden initially)
  const panelBeforeRun = await page.evaluate(() => {
    const el = document.getElementById('product-bucket-panel');
    if (!el) return { exists: false };
    const style = el.style.display;
    // The initial style is 'none' due to inline style in HTML
    // But the element might have 'flex' set as well (double-display CSS trick)
    // Check if it's actually visible
    const rect = el.getBoundingClientRect();
    return { exists: true, display: style, width: rect.width, height: rect.height };
  });
  expect(panelBeforeRun.exists, 'product-bucket-panel must exist in DOM').toBe(true);

  // Run simulation
  await runMockSimulation(page);
  await page.waitForTimeout(300);

  // After simulation: bucket panel should be visible
  const panelAfterRun = await page.evaluate(() => {
    const el = document.getElementById('product-bucket-panel');
    if (!el) return { exists: false };
    const rect = el.getBoundingClientRect();
    const simWrap = document.getElementById('sim-canvas-wrap');
    const wrapRect = simWrap ? simWrap.getBoundingClientRect() : null;
    return {
      exists:      true,
      display:     el.style.display,
      left:        rect.left,
      right:       rect.right,
      width:       rect.width,
      wrapRight:   wrapRect ? wrapRect.right : 0,
      wrapLeft:    wrapRect ? wrapRect.left : 0,
      isOnRightSide: wrapRect ? (rect.right >= wrapRect.right - 10) : false,
    };
  });

  expect(panelAfterRun.exists, 'product-bucket-panel must exist').toBe(true);
  expect(panelAfterRun.display, 'product-bucket-panel should not be none').not.toBe('none');
  expect(panelAfterRun.width, 'product-bucket-panel must have width > 0').toBeGreaterThan(0);
  expect(panelAfterRun.isOnRightSide, 'product-bucket-panel must be on the right side of canvas').toBe(true);

  console.log('[6c] bucket panel after run:', JSON.stringify(panelAfterRun));
});

// ── Test 6: bucket zone count displays sync with counter state ────────────────

test('Sub-AC 6c: bucket zone count displays sync with product counter state', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Run mock simulation
  await runMockSimulation(page);
  await page.waitForTimeout(500);

  // Check bucket panel counts match the SVG counter values
  const syncCheck = await page.evaluate(() => {
    const ids = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
    const result = {};
    for (const id of ids) {
      const svgCounter = document.querySelector(`[data-testid="product-counter-${id}"]`);
      const bucketCount = document.getElementById(`bucket-count-${id}`);
      result[id] = {
        svgValue:    svgCounter ? parseInt(svgCounter.textContent ?? '0', 10) : -1,
        bucketValue: bucketCount ? parseInt(bucketCount.textContent ?? '0', 10) : -1,
      };
    }
    return result;
  });

  for (const [id, { svgValue, bucketValue }] of Object.entries(syncCheck)) {
    expect(svgValue, `SVG counter for ${id} must exist`).toBeGreaterThanOrEqual(0);
    expect(bucketValue, `Bucket count display for ${id} must exist`).toBeGreaterThanOrEqual(0);
    expect(bucketValue, `Bucket panel count for ${id} must match SVG counter`).toBe(svgValue);
  }

  console.log('[6c] counter sync check:', JSON.stringify(syncCheck));
});

// ── Test 7: Screenshot of bucket zones in running state ────────────────────────

test('Sub-AC 6c: screenshot — bucket zones visible on right side of canvas during simulation', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Run mock simulation
  await runMockSimulation(page);
  await page.waitForTimeout(300);

  // Capture simulation panel
  const simPanel = page.locator('[data-testid="panel-simulation"]');
  await simPanel.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'ac6c-01-bucket-zones-completed.png'),
  });

  // Full page
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'ac6c-02-full-page-completed.png'),
    fullPage: true,
  });

  console.log('[6c] screenshots captured in', SCREENSHOTS_DIR);
});
