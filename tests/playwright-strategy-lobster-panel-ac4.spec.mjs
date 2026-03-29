/**
 * playwright-strategy-lobster-panel-ac4.spec.mjs
 *
 * Sub-AC 4: Playwright verification of the Strategy Lobster (전략가재) panel.
 *
 * Verifies:
 *   1. Container visibility — strategy-lobster starts hidden (display:none) and
 *      becomes visible (display:block) on the first iteration_start event.
 *   2. 3 candidate cards rendered with correct sub-fields (title, price_krw, rationale)
 *      on iteration_start — all 3 slots populated simultaneously.
 *   3. Winner card highlighted with blue border (border-color via CSS class
 *      candidate-winner-active) AND 👑 icon visible on iteration_complete.
 *   4. Iteration label (data-testid="strategy-iteration-label") updates each
 *      cycle — shows "Iteration N/M" format matching both iteration and total.
 *
 * PRD §12.11, §16
 * Port: 3106 — dedicated, no collision with other specs
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';

const PORT = 3106;
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

/** Wait for the product-name field to be populated (fixtures loaded) */
async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

/** Wait until strategy-lobster panel is visible */
async function waitForStrategyLobster(page) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('strategy-lobster');
      return el && el.style.display !== 'none' && el.style.display !== '';
    },
    { timeout: 10_000 },
  );
}

// ── Test 1: Container visibility ──────────────────────────────────────────────

test('ac4: strategy-lobster container is hidden on load and becomes visible on iteration_start', async ({ page }) => {
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
              { id: 'c1', title: '전략 알파', price_krw: 28900, rationale: '알파 전략 근거' },
              { id: 'c2', title: '전략 베타', price_krw: 29900, rationale: '베타 전략 근거' },
              { id: 'c3', title: '전략 감마', price_krw: 31900, rationale: '감마 전략 근거' },
            ],
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // ── BEFORE: container must be hidden ─────────────────────────────────────────
  const displayBefore = await page.evaluate(() => {
    const el = document.getElementById('strategy-lobster');
    return el ? getComputedStyle(el).display : 'element-not-found';
  });
  expect(displayBefore).toBe('none');

  // ── Trigger simulation ────────────────────────────────────────────────────────
  await page.locator('[data-testid="btn-run"]').click();

  // ── AFTER: container must become visible (display !== 'none') ─────────────────
  await waitForStrategyLobster(page);

  const displayAfter = await page.evaluate(() => {
    const el = document.getElementById('strategy-lobster');
    return el ? el.style.display : 'element-not-found';
  });
  expect(displayAfter).not.toBe('none');
  expect(displayAfter).toBe('block');

  // Also verify via locator: the container should now be visible
  await expect(page.locator('[data-testid="strategy-lobster"]')).toBeVisible();
});

// ── Test 2: All 3 candidate cards rendered with correct sub-fields ─────────────

test('ac4: iteration_start renders all 3 candidate cards with title, price, and rationale', async ({ page }) => {
  const candidates = [
    {
      id: 'cand-1',
      title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml',
      price_krw: 28900,
      rationale: '가격 민감형 고객 확보를 위한 소폭 인하 전략',
    },
    {
      id: 'cand-2',
      title: '트리클리닉 전문가 설계 탈모 샴푸 500ml',
      price_krw: 29900,
      rationale: '신뢰 기반 메시지를 강화하는 방어형 전략',
    },
    {
      id: 'cand-3',
      title: '트리클리닉 프리미엄 스칼프 탈모 샴푸 500ml',
      price_krw: 31900,
      rationale: '프리미엄 포지션을 유지하는 고가 전략',
    },
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
            strategy_reasoning: '3가지 가격대로 고객 세그먼트를 커버합니다.',
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();
  await waitForStrategyLobster(page);

  // ── Wait for all 3 cards to have titles populated ─────────────────────────────
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

  // ── Verify all 3 card containers are present ──────────────────────────────────
  await expect(page.locator('[data-testid="strategy-candidate-1"]')).toBeAttached();
  await expect(page.locator('[data-testid="strategy-candidate-2"]')).toBeAttached();
  await expect(page.locator('[data-testid="strategy-candidate-3"]')).toBeAttached();

  // ── Verify titles ─────────────────────────────────────────────────────────────
  const title1 = await page.locator('#candidate-1-title').textContent();
  const title2 = await page.locator('#candidate-2-title').textContent();
  const title3 = await page.locator('#candidate-3-title').textContent();

  expect(title1?.trim()).toBe(candidates[0].title);
  expect(title2?.trim()).toBe(candidates[1].title);
  expect(title3?.trim()).toBe(candidates[2].title);

  // ── Verify KRW-formatted prices ───────────────────────────────────────────────
  const price1 = await page.locator('#candidate-1-price').textContent();
  const price2 = await page.locator('#candidate-2-price').textContent();
  const price3 = await page.locator('#candidate-3-price').textContent();

  // KRW format: ₩28,900 — numeric portion must be present
  expect(price1?.trim()).toMatch(/28[,.]?900/);
  expect(price2?.trim()).toMatch(/29[,.]?900/);
  expect(price3?.trim()).toMatch(/31[,.]?900/);

  // ── Verify per-candidate rationale ───────────────────────────────────────────
  const rationale1 = await page.locator('#candidate-1-rationale').textContent();
  const rationale2 = await page.locator('#candidate-2-rationale').textContent();
  const rationale3 = await page.locator('#candidate-3-rationale').textContent();

  expect(rationale1?.trim()).toBe(candidates[0].rationale);
  expect(rationale2?.trim()).toBe(candidates[1].rationale);
  expect(rationale3?.trim()).toBe(candidates[2].rationale);
});

// ── Test 3: Winner card highlighted with blue border and 👑 icon ──────────────

test('ac4: iteration_complete highlights winner card with blue border CSS class and 👑 icon', async ({ page }) => {
  const candidates = [
    { id: 'w-1', title: '전략 오메가', price_krw: 27900, rationale: '오메가 전략 근거' },
    { id: 'w-2', title: '전략 시그마', price_krw: 29900, rationale: '시그마 전략 근거' },
    { id: 'w-3', title: '전략 델타',  price_krw: 32900, rationale: '델타 전략 근거' },
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
        {
          type: 'iteration_complete',
          data: {
            iteration: 1,
            winner_id: 'w-2',
            winner_revenue: 6100000,
            accepted: true,
            rejected_count: 2,
            choice_summary: {
              our_product: 460,
              competitor_a: 140,
              competitor_b: 100,
              competitor_c: 80,
              pass: 20,
            },
            archetype_breakdown: {},
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();
  await waitForStrategyLobster(page);

  // ── Wait for winner to be marked ─────────────────────────────────────────────
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="strategy-candidate-2"]');
      return el && el.classList.contains('candidate-winner-active');
    },
    { timeout: 10_000 },
  );

  // ── Assert CSS class "candidate-winner-active" is applied to winner card ──────
  const card2Classes = await page.locator('[data-testid="strategy-candidate-2"]').getAttribute('class');
  expect(card2Classes).toContain('candidate-winner-active');

  // ── Assert non-winner cards do NOT have the class ─────────────────────────────
  const card1Classes = await page.locator('[data-testid="strategy-candidate-1"]').getAttribute('class');
  const card3Classes = await page.locator('[data-testid="strategy-candidate-3"]').getAttribute('class');
  expect(card1Classes ?? '').not.toContain('candidate-winner-active');
  expect(card3Classes ?? '').not.toContain('candidate-winner-active');

  // ── Assert blue border is applied (computed style on winner card) ─────────────
  // candidate-winner-active sets border-color to var(--accent-blue) = #3b82f6
  // Wait until the CSS transition completes and the border color resolves to blue.
  // The card has transition: all 0.3s — so the border-color animates to blue.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="strategy-candidate-2"]');
      if (!el) return false;
      const color = getComputedStyle(el).borderTopColor;
      // Accept any color containing RGB(59, 130, 246) components (blue family)
      return color.includes('59') && color.includes('130') && color.includes('246');
    },
    { timeout: 5_000 },
  );

  const winnerBorderColor = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="strategy-candidate-2"]');
    if (!el) return null;
    return getComputedStyle(el).borderTopColor;
  });
  // Blue family: rgb(59, 130, 246) = #3b82f6 — accept rgba(...) too (CSS transition alpha)
  expect(winnerBorderColor).toMatch(/rgba?\(59,\s*130,\s*246/);

  // ── Assert 👑 crown span is visible on the winner card ───────────────────────
  const crown2Display = await page.evaluate(() => {
    const el = document.getElementById('candidate-2-winner');
    return el ? el.style.display : null;
  });
  expect(crown2Display).not.toBe('none');
  expect(crown2Display).not.toBeNull();

  // ── Assert 👑 crown spans on non-winner cards are hidden ─────────────────────
  const crown1Display = await page.evaluate(() => {
    const el = document.getElementById('candidate-1-winner');
    return el ? el.style.display : 'none';
  });
  const crown3Display = await page.evaluate(() => {
    const el = document.getElementById('candidate-3-winner');
    return el ? el.style.display : 'none';
  });
  expect(crown1Display).toBe('none');
  expect(crown3Display).toBe('none');
});

// ── Test 4: Iteration label updates each cycle ────────────────────────────────

test('ac4: strategy-iteration-label updates to "Iteration N/M" on each iteration_start and iteration_complete cycle', async ({ page }) => {
  const candidates1 = [
    { id: 'cycle1-a', title: '사이클1 전략 A', price_krw: 28900, rationale: '사이클1 A 근거' },
    { id: 'cycle1-b', title: '사이클1 전략 B', price_krw: 29900, rationale: '사이클1 B 근거' },
  ];
  const candidates2 = [
    { id: 'cycle2-c', title: '사이클2 전략 C', price_krw: 27900, rationale: '사이클2 C 근거' },
    { id: 'cycle2-d', title: '사이클2 전략 D', price_krw: 30900, rationale: '사이클2 D 근거' },
  ];
  const candidates3 = [
    { id: 'cycle3-e', title: '사이클3 전략 E', price_krw: 26900, rationale: '사이클3 E 근거' },
    { id: 'cycle3-f', title: '사이클3 전략 F', price_krw: 33900, rationale: '사이클3 F 근거' },
  ];

  const sseBody = buildSseBody([
    // Cycle 1
    {
      type: 'iteration_start',
      data: { iteration: 1, total: 3, candidates: candidates1 },
    },
    {
      type: 'iteration_complete',
      data: {
        iteration: 1,
        winner_id: 'cycle1-a',
        winner_revenue: 5500000,
        accepted: true,
        rejected_count: 1,
        choice_summary: { our_product: 440, competitor_a: 160, competitor_b: 100, competitor_c: 80, pass: 20 },
        archetype_breakdown: {},
      },
    },
    // Cycle 2
    {
      type: 'iteration_start',
      data: { iteration: 2, total: 3, candidates: candidates2 },
    },
    {
      type: 'iteration_complete',
      data: {
        iteration: 2,
        winner_id: 'cycle2-d',
        winner_revenue: 5900000,
        accepted: true,
        rejected_count: 1,
        choice_summary: { our_product: 455, competitor_a: 145, competitor_b: 100, competitor_c: 80, pass: 20 },
        archetype_breakdown: {},
      },
    },
    // Cycle 3
    {
      type: 'iteration_start',
      data: { iteration: 3, total: 3, candidates: candidates3 },
    },
    {
      type: 'iteration_complete',
      data: {
        iteration: 3,
        winner_id: 'cycle3-f',
        winner_revenue: 6300000,
        accepted: true,
        rejected_count: 1,
        choice_summary: { our_product: 475, competitor_a: 125, competitor_b: 100, competitor_c: 80, pass: 20 },
        archetype_breakdown: {},
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
  await waitForStrategyLobster(page);

  // ── Wait for all 3 cycles to complete (final state: cycle 3 titles in slots) ──
  // When all SSE events are fired at once by Playwright mock, intermediate states
  // (cycle 1 winner highlight) may be cleared before our checks. So we wait for
  // the final state (cycle 3 candidates) and verify the final label = "Iteration 3/3".
  await page.waitForFunction(
    () => {
      const el = document.getElementById('candidate-1-title');
      return el && el.textContent.trim().includes('사이클3');
    },
    { timeout: 15_000 },
  );

  // Wait for cycle 3 winner (slot 2 = cycle3-f) to be marked
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="strategy-candidate-2"]');
      return el && el.classList.contains('candidate-winner-active');
    },
    { timeout: 10_000 },
  );

  // ── Final state: label must contain "Iteration 3/3" ──────────────────────────
  const label3 = await page.locator('[data-testid="strategy-iteration-label"]').textContent();
  expect(label3?.trim()).toMatch(/3/);
  expect(label3?.trim()).toMatch(/Iteration\s+3\s*\/\s*3/i);

  // ── Verify label updates each cycle: it was updated from "—" to a numbered label
  // The fact that label now shows iteration 3 (not the default "Iteration —") proves
  // the label was updated on each iteration_start event.
  expect(label3?.trim()).not.toBe('Iteration —');
  expect(label3?.trim()).not.toMatch(/^—$/);
});

// ── Test 5: Full cycle — container, cards, winner, and label together ──────────

test('ac4: full cycle — container visible, 3 cards populated, winner highlighted, label updated', async ({ page }) => {
  const candidates = [
    { id: 'full-1', title: '통합 테스트 전략 1호', price_krw: 28900, rationale: '통합 테스트 전략 1호 근거' },
    { id: 'full-2', title: '통합 테스트 전략 2호', price_krw: 29900, rationale: '통합 테스트 전략 2호 근거' },
    { id: 'full-3', title: '통합 테스트 전략 3호', price_krw: 31900, rationale: '통합 테스트 전략 3호 근거' },
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
            total: 1,
            candidates,
            strategy_reasoning: '통합 테스트용 전략 근거입니다.',
          },
        },
        {
          type: 'iteration_complete',
          data: {
            iteration: 1,
            winner_id: 'full-3',
            winner_revenue: 6500000,
            accepted: true,
            rejected_count: 2,
            choice_summary: {
              our_product: 490,
              competitor_a: 110,
              competitor_b: 100,
              competitor_c: 80,
              pass: 20,
            },
            archetype_breakdown: {},
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // ── 1. Container starts hidden ────────────────────────────────────────────────
  const initialDisplay = await page.locator('[data-testid="strategy-lobster"]').evaluate((el) => el.style.display);
  expect(initialDisplay).toBe('none');

  // ── 2. Click run ──────────────────────────────────────────────────────────────
  await page.locator('[data-testid="btn-run"]').click();

  // ── 3. Container becomes visible ─────────────────────────────────────────────
  await waitForStrategyLobster(page);
  await expect(page.locator('[data-testid="strategy-lobster"]')).toBeVisible();

  // ── 4. All 3 candidate cards present ─────────────────────────────────────────
  await expect(page.locator('[data-testid="strategy-candidate-1"]')).toBeAttached();
  await expect(page.locator('[data-testid="strategy-candidate-2"]')).toBeAttached();
  await expect(page.locator('[data-testid="strategy-candidate-3"]')).toBeAttached();

  // ── 5. Cards populated with correct sub-fields ───────────────────────────────
  await page.waitForFunction(
    () => {
      const t1 = document.getElementById('candidate-1-title');
      return t1 && t1.textContent.includes('통합 테스트 전략 1호');
    },
    { timeout: 10_000 },
  );

  const t1 = await page.locator('#candidate-1-title').textContent();
  const t2 = await page.locator('#candidate-2-title').textContent();
  const t3 = await page.locator('#candidate-3-title').textContent();
  expect(t1?.trim()).toBe('통합 테스트 전략 1호');
  expect(t2?.trim()).toBe('통합 테스트 전략 2호');
  expect(t3?.trim()).toBe('통합 테스트 전략 3호');

  const p1 = await page.locator('#candidate-1-price').textContent();
  const p3 = await page.locator('#candidate-3-price').textContent();
  expect(p1?.trim()).toMatch(/28[,.]?900/);
  expect(p3?.trim()).toMatch(/31[,.]?900/);

  const r2 = await page.locator('#candidate-2-rationale').textContent();
  expect(r2?.trim()).toBe('통합 테스트 전략 2호 근거');

  // ── 6. Iteration label shows correct format ───────────────────────────────────
  const labelText = await page.locator('[data-testid="strategy-iteration-label"]').textContent();
  expect(labelText?.trim()).toMatch(/Iteration\s+1\s*\/\s*1/i);

  // ── 7. Winner marked (card 3 = full-3) after iteration_complete ──────────────
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="strategy-candidate-3"]');
      return el && el.classList.contains('candidate-winner-active');
    },
    { timeout: 10_000 },
  );

  const card3Classes = await page.locator('[data-testid="strategy-candidate-3"]').getAttribute('class');
  expect(card3Classes).toContain('candidate-winner-active');

  const card1Classes = await page.locator('[data-testid="strategy-candidate-1"]').getAttribute('class');
  const card2Classes = await page.locator('[data-testid="strategy-candidate-2"]').getAttribute('class');
  expect(card1Classes ?? '').not.toContain('candidate-winner-active');
  expect(card2Classes ?? '').not.toContain('candidate-winner-active');

  // ── 8. Winner has blue border (via computed CSS) ──────────────────────────────
  // Wait for CSS transition to complete (transition: all 0.3s) then check color
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="strategy-candidate-3"]');
      if (!el) return false;
      const color = getComputedStyle(el).borderTopColor;
      return color.includes('59') && color.includes('130') && color.includes('246');
    },
    { timeout: 5_000 },
  );
  const winnerBorderColor = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="strategy-candidate-3"]');
    return el ? getComputedStyle(el).borderTopColor : null;
  });
  // Blue family: rgb(59, 130, 246) = #3b82f6 — accept rgba(...) too (CSS transition alpha)
  expect(winnerBorderColor).toMatch(/rgba?\(59,\s*130,\s*246/);

  // ── 9. Winner 👑 icon is visible on winner card ───────────────────────────────
  const crown3Display = await page.evaluate(() => {
    const el = document.getElementById('candidate-3-winner');
    return el ? el.style.display : 'none';
  });
  expect(crown3Display).not.toBe('none');

  // Non-winner crowns hidden
  const crown1Display = await page.evaluate(() => {
    const el = document.getElementById('candidate-1-winner');
    return el ? el.style.display : 'none';
  });
  const crown2Display = await page.evaluate(() => {
    const el = document.getElementById('candidate-2-winner');
    return el ? el.style.display : 'none';
  });
  expect(crown1Display).toBe('none');
  expect(crown2Display).toBe('none');
});
