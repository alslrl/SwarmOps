/**
 * playwright-sse-iteration-start-ac8b2.spec.mjs
 *
 * Sub-AC 8.2: Playwright verification — SSE iteration_start event handler
 * populates the 3 strategy candidate cards and strategy-rationale.
 *
 * Verifies:
 *   1. candidate title populated into data-testid="strategy-candidate-{n}"
 *   2. candidate price (KRW formatted) populated into candidate-{n}-price
 *   3. candidate rationale populated into candidate-{n}-rationale
 *   4. data-testid="strategy-rationale" populated with strategy_reasoning text
 *   5. winner highlight (👑 crown + candidate-winner-active class) is cleared
 *      when a new iteration_start arrives after a previous iteration_complete
 *
 * PRD §12.11, §16
 * Port: 3103 — dedicated, no collision with other specs
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';

const PORT = 3103;
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

// ── Test 1: Candidate titles populated from iteration_start ──────────────────

test('ac8b2: iteration_start populates candidate titles into strategy-candidate-{n} slots', async ({ page }) => {
  const candidates = [
    { id: 'cand-1', title: '트리클리닉 두피과학 탈모 샴푸 500ml', price_krw: 28900, rationale: '가격 민감형 고객 확보 전략' },
    { id: 'cand-2', title: '트리클리닉 전문가 설계 탈모 샴푸 500ml', price_krw: 29900, rationale: '신뢰 메시지 강화 전략' },
    { id: 'cand-3', title: '트리클리닉 프리미엄 스칼프 탈모 샴푸 500ml', price_krw: 31900, rationale: '프리미엄 포지션 유지 전략' },
  ];

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: {
            iteration: 1,
            total: 3,
            candidates,
            strategy_reasoning: '3가지 전략으로 가격·신뢰·프리미엄 구간을 커버합니다.',
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for the strategy lobster panel to become visible (indicates iteration_start was processed)
  await page.waitForFunction(
    () => {
      const el = document.getElementById('strategy-lobster');
      return el && el.style.display !== 'none' && el.style.display !== '';
    },
    { timeout: 10_000 },
  );

  // Verify all 3 candidate cards are present
  await expect(page.locator('[data-testid="strategy-candidate-1"]')).toBeAttached();
  await expect(page.locator('[data-testid="strategy-candidate-2"]')).toBeAttached();
  await expect(page.locator('[data-testid="strategy-candidate-3"]')).toBeAttached();

  // Verify candidate titles are populated
  const title1 = await page.locator('#candidate-1-title').textContent();
  const title2 = await page.locator('#candidate-2-title').textContent();
  const title3 = await page.locator('#candidate-3-title').textContent();

  expect(title1?.trim()).toBe(candidates[0].title);
  expect(title2?.trim()).toBe(candidates[1].title);
  expect(title3?.trim()).toBe(candidates[2].title);
});

// ── Test 2: Candidate prices (KRW formatted) populated from iteration_start ──

test('ac8b2: iteration_start populates KRW-formatted prices into candidate price slots', async ({ page }) => {
  const candidates = [
    { id: 'cand-1', title: '전략 A', price_krw: 28900, rationale: '전략 A 근거' },
    { id: 'cand-2', title: '전략 B', price_krw: 29900, rationale: '전략 B 근거' },
    { id: 'cand-3', title: '전략 C', price_krw: 31900, rationale: '전략 C 근거' },
  ];

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: { iteration: 1, total: 2, candidates },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for strategy lobster panel to appear
  await page.waitForFunction(
    () => {
      const el = document.getElementById('strategy-lobster');
      return el && el.style.display !== 'none' && el.style.display !== '';
    },
    { timeout: 10_000 },
  );

  // Wait for prices to be populated (non-empty)
  await page.waitForFunction(
    () => {
      const el = document.getElementById('candidate-1-price');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 5_000 },
  );

  const price1 = await page.locator('#candidate-1-price').textContent();
  const price2 = await page.locator('#candidate-2-price').textContent();
  const price3 = await page.locator('#candidate-3-price').textContent();

  // KRW format: ₩28,900 or 28,900원 — must contain numeric portion
  expect(price1?.trim()).toMatch(/28[,.]?900/);
  expect(price2?.trim()).toMatch(/29[,.]?900/);
  expect(price3?.trim()).toMatch(/31[,.]?900/);
});

// ── Test 3: Per-candidate rationale populated ─────────────────────────────────

test('ac8b2: iteration_start populates per-candidate rationale into candidate-{n}-rationale slots', async ({ page }) => {
  const candidates = [
    { id: 'cand-1', title: '전략 A', price_krw: 28900, rationale: '가격 민감형 고객 확보를 위한 소폭 인하 전략' },
    { id: 'cand-2', title: '전략 B', price_krw: 29900, rationale: '신뢰 기반 메시지를 강화하는 방어형 전략' },
    { id: 'cand-3', title: '전략 C', price_krw: 31900, rationale: '프리미엄 포지션을 유지하는 고가 전략' },
  ];

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: { iteration: 1, total: 2, candidates },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for strategy lobster panel to appear
  await page.waitForFunction(
    () => {
      const el = document.getElementById('strategy-lobster');
      return el && el.style.display !== 'none' && el.style.display !== '';
    },
    { timeout: 10_000 },
  );

  // Wait for candidate-1-rationale to be populated
  await page.waitForFunction(
    () => {
      const el = document.getElementById('candidate-1-rationale');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 5_000 },
  );

  const rationale1 = await page.locator('#candidate-1-rationale').textContent();
  const rationale2 = await page.locator('#candidate-2-rationale').textContent();
  const rationale3 = await page.locator('#candidate-3-rationale').textContent();

  expect(rationale1?.trim()).toBe(candidates[0].rationale);
  expect(rationale2?.trim()).toBe(candidates[1].rationale);
  expect(rationale3?.trim()).toBe(candidates[2].rationale);
});

// ── Test 4: data-testid="strategy-rationale" populated with strategy_reasoning ─

test('ac8b2: iteration_start populates data-testid="strategy-rationale" with strategy_reasoning', async ({ page }) => {
  const STRATEGY_REASONING = '3가지 후보 전략으로 가격 민감형·신뢰 우선형·프리미엄 구간 고객을 동시에 커버합니다.';

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
              { id: 'c1', title: '전략 A', price_krw: 28900, rationale: '전략 A 근거' },
              { id: 'c2', title: '전략 B', price_krw: 29900, rationale: '전략 B 근거' },
            ],
            strategy_reasoning: STRATEGY_REASONING,
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for strategy-rationale to be populated (non-empty)
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="strategy-rationale"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );

  const rationaleText = await page.locator('[data-testid="strategy-rationale"]').textContent();

  // The text should contain the strategy_reasoning content (may have a 💡 prefix)
  expect(rationaleText?.trim()).toContain(STRATEGY_REASONING);
});

// ── Test 5: Winner highlight cleared on new iteration_start ──────────────────

test('ac8b2: winner highlight (crown + active class) cleared when new iteration_start arrives', async ({ page }) => {
  // Stream: iteration_start → iteration_complete (marks winner) → second iteration_start (should clear)
  const sseBody = buildSseBody([
    {
      type: 'iteration_start',
      data: {
        iteration: 1,
        total: 2,
        candidates: [
          { id: 'cand-alpha', title: '전략 알파', price_krw: 28900, rationale: '알파 전략 근거' },
          { id: 'cand-beta',  title: '전략 베타',  price_krw: 29900, rationale: '베타 전략 근거' },
        ],
      },
    },
    {
      type: 'iteration_complete',
      data: {
        iteration: 1,
        winner_id: 'cand-alpha',
        winner_revenue: 5800000,
        accepted: true,
        rejected_count: 1,
        choice_summary: { our_product: 450, competitor_a: 150, competitor_b: 100, competitor_c: 80, pass: 20 },
        archetype_breakdown: {},
      },
    },
    {
      type: 'iteration_start',
      data: {
        iteration: 2,
        total: 2,
        candidates: [
          { id: 'cand-gamma', title: '전략 감마', price_krw: 27900, rationale: '감마 전략 근거' },
          { id: 'cand-delta', title: '전략 델타', price_krw: 30900, rationale: '델타 전략 근거' },
        ],
      },
    },
  ]);

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: sseBody,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for the second iteration_start to arrive (title should change to 전략 감마 in slot 1)
  await page.waitForFunction(
    () => {
      const el = document.getElementById('candidate-1-title');
      return el && el.textContent.trim() === '전략 감마';
    },
    { timeout: 15_000 },
  );

  // After second iteration_start, winner crown must be hidden
  const winner1Hidden = await page.evaluate(() => {
    const el = document.getElementById('candidate-1-winner');
    return !el || el.style.display === 'none';
  });
  const winner2Hidden = await page.evaluate(() => {
    const el = document.getElementById('candidate-2-winner');
    return !el || el.style.display === 'none';
  });

  expect(winner1Hidden).toBe(true);
  expect(winner2Hidden).toBe(true);

  // candidate-winner-active class must be removed from all candidate cards
  const card1Classes = await page.locator('[data-testid="strategy-candidate-1"]').getAttribute('class');
  const card2Classes = await page.locator('[data-testid="strategy-candidate-2"]').getAttribute('class');

  expect(card1Classes ?? '').not.toContain('candidate-winner-active');
  expect(card2Classes ?? '').not.toContain('candidate-winner-active');

  // New candidate titles should be visible after second iteration_start
  const title1 = await page.locator('#candidate-1-title').textContent();
  const title2 = await page.locator('#candidate-2-title').textContent();

  expect(title1?.trim()).toBe('전략 감마');
  expect(title2?.trim()).toBe('전략 델타');
});
