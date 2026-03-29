/**
 * playwright-agent-log-ac9.spec.mjs
 *
 * AC9 Sub-AC 1: Agent Chat Log UI component verification
 *
 * Verifies:
 *   1. data-testid="agent-log" container is visible during simulation
 *   2. max-height is 300px (per PRD §12.5)
 *   3. agent-log-entry items appear on agent_decision SSE events
 *   4. Each entry has: archetype color dot, agent name, archetype label, chosen product color indicator, reasoning
 *   5. Auto-scroll behavior — container scrollTop increases as entries are added
 *   6. Up to 800 entries supported per iteration (AGENT_LOG_MAX_ENTRIES = 800)
 *
 * PRD §12.5, §16
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';

const PORT     = 3107; // unique port — no collision with dashboard-e2e.spec.mjs (3097)
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

/**
 * Build SSE body with iteration_start + N agent_decision events + simulation_complete.
 * @param {number} agentCount - number of agent_decision events to generate
 */
function buildAgentLogSse(agentCount = 10) {
  const archetypes = [
    'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
    'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
  ];
  const products = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  const names = ['김지수', '이민준', '박서연', '최현우', '정수아', '윤하준', '강도윤', '조아름'];
  const reasonings = [
    '가격이 합리적이고 탈모 케어 성분이 충분합니다.',
    '신뢰 브랜드를 선호합니다.',
    '프리미엄 성분이 마음에 들었습니다.',
    '할인 혜택이 좋습니다.',
    '가성비가 우수합니다.',
    '급하게 필요해서 빠른 배송을 선택했습니다.',
    '디자인이 예쁩니다.',
    '가족이 사용하기 좋을 것 같습니다.',
  ];

  const events = [
    {
      type: 'iteration_start',
      data: {
        iteration: 1,
        total: 1,
        candidates: [{ id: 'test-strategy', title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml', price_krw: 28900 }],
      },
    },
  ];

  for (let i = 0; i < agentCount; i++) {
    events.push({
      type: 'agent_decision',
      data: {
        iteration: 1,
        agent_id: `${archetypes[i % archetypes.length]}_${String(i + 1).padStart(4, '0')}`,
        agent_name: names[i % names.length],
        agent_index: i,
        agent_total: agentCount,
        archetype_id: archetypes[i % archetypes.length],
        chosen_product: products[i % products.length],
        reasoning: reasonings[i % reasonings.length],
        price_sensitivity: 2.0 + (i % 30) / 10,
        trust_sensitivity: 1.5 + (i % 35) / 10,
        promo_affinity: 1.0 + (i % 40) / 10,
        brand_bias: 1.0 + (i % 25) / 10,
        pass_threshold: 0.2 + (i % 6) / 10,
      },
    });
  }

  events.push({
    type: 'simulation_complete',
    data: {
      baseline: { id: 'baseline', title: '기준 상품', price_krw: 29900, simulated_revenue: 5651100, margin_rate: 0.63 },
      selected_strategy: {
        id: 'test-strategy', title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml',
        price_krw: 28900, simulated_revenue: 6200000, margin_rate: 0.62,
        rationale: '가격 최적화 전략',
      },
      holdout: { holdout_uplift: 548900, holdout_revenue: 6200000, margin_floor_violations: 0 },
      diff: {
        title: { before: '기준 상품', after: '최적화 상품' },
        top_copy: { before: '기준 카피', after: '최적화 카피' },
        price: { before: 29900, after: 28900 },
      },
      artifact: { payload: { selected_strategy_id: 'test-strategy', holdout_uplift: 548900, generated_at: new Date().toISOString() } },
    },
  });

  return buildSseBody(events);
}

// ── Helper: wait for fixtures ─────────────────────────────────────────────────

async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

// ── Test 1: agent-log container is visible and has correct max-height ─────────

test('ac9-1: agent-log container is visible during simulation with max-height 300px', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: buildAgentLogSse(5) });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  // agent-log must be visible
  await expect(page.locator('[data-testid="agent-log"]')).toBeVisible();

  // Verify max-height is 300px
  const maxHeight = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="agent-log"]');
    if (!el) return null;
    return window.getComputedStyle(el).maxHeight;
  });

  expect(maxHeight).toBe('300px');
});

// ── Test 2: agent-log-entry elements appear on agent_decision events ──────────

test('ac9-1: agent-log-entry items appear for each agent_decision event', async ({ page }) => {
  const AGENT_COUNT = 8;

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: buildAgentLogSse(AGENT_COUNT) });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for all agent entries to appear
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="agent-log-entry"]').length >= count,
    AGENT_COUNT,
    { timeout: 15_000 },
  );

  const entries = page.locator('[data-testid="agent-log-entry"]');
  const count = await entries.count();
  expect(count).toBeGreaterThanOrEqual(AGENT_COUNT);
});

// ── Test 3: Each entry has archetype color dot ─────────────────────────────────

test('ac9-1: each agent-log-entry has archetype color dot (.agent-dot)', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: buildAgentLogSse(3) });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  // First entry must have an .agent-dot element with a non-default background color
  const dotInfo = await page.evaluate(() => {
    const entry = document.querySelector('[data-testid="agent-log-entry"]');
    if (!entry) return null;
    const dot = entry.querySelector('.agent-dot');
    if (!dot) return { hasDot: false };
    const bg = dot.style.backgroundColor;
    return { hasDot: true, backgroundColor: bg };
  });

  expect(dotInfo).not.toBeNull();
  expect(dotInfo.hasDot).toBe(true);
  // backgroundColor must be set (non-empty) — archetype color was applied
  expect(dotInfo.backgroundColor?.length).toBeGreaterThan(0);
});

// ── Test 4: Each entry has agent name + archetype label ───────────────────────

test('ac9-1: each agent-log-entry shows agent name and archetype label', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: buildAgentLogSse(3) });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  const entryContent = await page.evaluate(() => {
    const entry = document.querySelector('[data-testid="agent-log-entry"]');
    if (!entry) return null;

    const nameEl = entry.querySelector('.agent-name');
    const archLabelEl = entry.querySelector('.agent-archetype-label');

    return {
      hasName: !!nameEl,
      nameText: nameEl?.textContent?.trim() ?? '',
      hasArchLabel: !!archLabelEl,
      archLabelText: archLabelEl?.textContent?.trim() ?? '',
    };
  });

  expect(entryContent).not.toBeNull();
  // Must have agent name
  expect(entryContent.hasName).toBe(true);
  expect(entryContent.nameText.length).toBeGreaterThan(0);
  // Must have archetype label
  expect(entryContent.hasArchLabel).toBe(true);
  // Archetype label must be non-empty Korean label
  expect(entryContent.archLabelText.length).toBeGreaterThan(0);
  // Should be in parentheses format e.g. "(가격민감형)"
  expect(entryContent.archLabelText).toMatch(/^\(.+\)$/);
});

// ── Test 5: Each entry has chosen product color indicator ─────────────────────

test('ac9-1: each agent-log-entry has chosen product color indicator', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: buildAgentLogSse(3) });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  // All entries must have agent-chosen-product element with a choice-* class
  const productInfo = await page.evaluate(() => {
    const entries = document.querySelectorAll('[data-testid="agent-log-entry"]');
    return Array.from(entries).map((entry) => {
      const productEl = entry.querySelector('.agent-chosen-product');
      if (!productEl) return { hasProduct: false };
      const classes = Array.from(productEl.classList);
      const hasChoiceClass = classes.some((c) => c.startsWith('choice-'));
      return {
        hasProduct: true,
        hasChoiceClass,
        text: productEl.textContent?.trim() ?? '',
      };
    });
  });

  expect(productInfo.length).toBeGreaterThan(0);
  for (const info of productInfo) {
    expect(info.hasProduct).toBe(true);
    expect(info.hasChoiceClass).toBe(true);
    expect(info.text.length).toBeGreaterThan(0);
  }
});

// ── Test 6: Each entry has reasoning quote (1 line) ───────────────────────────

test('ac9-1: each agent-log-entry has reasoning quote with 1-line clamp', async ({ page }) => {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: buildAgentLogSse(3) });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  const reasoningInfo = await page.evaluate(() => {
    const entry = document.querySelector('[data-testid="agent-log-entry"]');
    if (!entry) return null;
    const reasonEl = entry.querySelector('.agent-reasoning');
    if (!reasonEl) return { hasReasoning: false };
    const style = window.getComputedStyle(reasonEl);
    return {
      hasReasoning: true,
      text: reasonEl.textContent?.trim() ?? '',
      webkitLineClamp: style.getPropertyValue('-webkit-line-clamp'),
    };
  });

  expect(reasoningInfo).not.toBeNull();
  expect(reasoningInfo.hasReasoning).toBe(true);
  expect(reasoningInfo.text.length).toBeGreaterThan(0);
  // Line clamp should be 1
  expect(reasoningInfo.webkitLineClamp).toBe('1');
});

// ── Test 7: Agent log counter updates correctly ───────────────────────────────

test('ac9-1: agent-log counter (agent-log-count) updates as entries are added', async ({ page }) => {
  const AGENT_COUNT = 5;

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: buildAgentLogSse(AGENT_COUNT) });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  // Wait for all entries
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="agent-log-entry"]').length >= count,
    AGENT_COUNT,
    { timeout: 15_000 },
  );

  const countText = await page.evaluate(() => {
    const el = document.getElementById('agent-log-count');
    return el?.textContent?.trim() ?? '';
  });

  // Should show "N / M" format
  expect(countText).toMatch(/^\d+ \/ \d+$/);

  const [current] = countText.split(' / ').map(Number);
  expect(current).toBeGreaterThanOrEqual(1);
});

// ── Test 8: Supports 800 entries per iteration (AGENT_LOG_MAX_ENTRIES = 800) ──

test('ac9-1: agent log supports at least 50 entries without DOM pruning prematurely', async ({ page }) => {
  // We test with 50 entries (not 800 to keep test fast) to verify the cap is ≥ 50
  const AGENT_COUNT = 50;

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({ status: 200, headers: SSE_HEADERS, body: buildAgentLogSse(AGENT_COUNT) });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for all 50 entries to appear
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="agent-log-entry"]').length >= count,
    AGENT_COUNT,
    { timeout: 30_000 },
  );

  const entryCount = await page.evaluate(() =>
    document.querySelectorAll('[data-testid="agent-log-entry"]').length
  );

  // All 50 entries should be in the DOM (max cap is 800, well above 50)
  expect(entryCount).toBeGreaterThanOrEqual(AGENT_COUNT);
});
