/**
 * playwright-sse-iteration-complete-ac8b3.spec.mjs
 *
 * Sub-AC 8.3: Playwright verification — SSE iteration_complete event handler
 * highlights the winning strategy card with 👑 crown + blue border, and updates
 * data-testid="strategy-iteration-label" with the current iteration number.
 *
 * Verifies:
 *   1. Winner card receives 'candidate-winner-active' CSS class on iteration_complete
 *   2. Winner crown span (candidate-{n}-winner) becomes visible
 *   3. data-testid="strategy-iteration-label" is updated with the iteration number
 *   4. Non-winner cards do NOT receive the active class
 *   5. Multi-iteration: label + winner updates correctly on each iteration_complete
 *
 * PRD §12.11, §16
 * Port: 3104 — dedicated, no collision with other specs
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';

const PORT = 3104;
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

// ── Fixture helpers ───────────────────────────────────────────────────────────

async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

async function waitForStrategyLobster(page) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('strategy-lobster');
      return el && el.style.display !== 'none' && el.style.display !== '';
    },
    { timeout: 10_000 },
  );
}

// ── Test 1: Winner card receives candidate-winner-active class ────────────────

test('ac8b3: iteration_complete marks winner card with candidate-winner-active class', async ({ page }) => {
  const candidates = [
    { id: 'cand-1', title: '전략 알파', price_krw: 28900, rationale: '알파 전략 근거' },
    { id: 'cand-2', title: '전략 베타', price_krw: 29900, rationale: '베타 전략 근거' },
    { id: 'cand-3', title: '전략 감마', price_krw: 31900, rationale: '감마 전략 근거' },
  ];

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: { iteration: 1, total: 3, candidates },
        },
        {
          type: 'iteration_complete',
          data: {
            iteration: 1,
            winner_id: 'cand-2',
            winner_revenue: 5900000,
            accepted: true,
            rejected_count: 2,
            choice_summary: { our_product: 450, competitor_a: 150, competitor_b: 100, competitor_c: 80, pass: 20 },
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

  // Wait for the winner to be marked (class applied)
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="strategy-candidate-2"]');
      return el && el.classList.contains('candidate-winner-active');
    },
    { timeout: 10_000 },
  );

  // Winner card must have candidate-winner-active class
  const card2Classes = await page.locator('[data-testid="strategy-candidate-2"]').getAttribute('class');
  expect(card2Classes).toContain('candidate-winner-active');

  // Non-winner cards must NOT have the active class
  const card1Classes = await page.locator('[data-testid="strategy-candidate-1"]').getAttribute('class');
  const card3Classes = await page.locator('[data-testid="strategy-candidate-3"]').getAttribute('class');
  expect(card1Classes ?? '').not.toContain('candidate-winner-active');
  expect(card3Classes ?? '').not.toContain('candidate-winner-active');
});

// ── Test 2: Winner crown (👑 span) becomes visible ───────────────────────────

test('ac8b3: iteration_complete shows 👑 crown span on winner card', async ({ page }) => {
  const candidates = [
    { id: 'cand-1', title: '전략 알파', price_krw: 28900, rationale: '알파 전략 근거' },
    { id: 'cand-2', title: '전략 베타', price_krw: 29900, rationale: '베타 전략 근거' },
    { id: 'cand-3', title: '전략 감마', price_krw: 31900, rationale: '감마 전략 근거' },
  ];

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: { iteration: 1, total: 3, candidates },
        },
        {
          type: 'iteration_complete',
          data: {
            iteration: 1,
            winner_id: 'cand-3',
            winner_revenue: 6200000,
            accepted: true,
            rejected_count: 2,
            choice_summary: { our_product: 480, competitor_a: 120, competitor_b: 100, competitor_c: 80, pass: 20 },
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

  // Wait for the winner crown to become visible
  await page.waitForFunction(
    () => {
      const el = document.getElementById('candidate-3-winner');
      return el && el.style.display !== 'none';
    },
    { timeout: 10_000 },
  );

  // Crown for winner card-3 must be visible
  const crown3Display = await page.evaluate(() => {
    const el = document.getElementById('candidate-3-winner');
    return el ? el.style.display : null;
  });
  expect(crown3Display).not.toBe('none');
  expect(crown3Display).not.toBeNull();

  // Crowns for non-winner cards must remain hidden
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

// ── Test 3: strategy-iteration-label updated with iteration number ────────────

test('ac8b3: iteration_complete updates strategy-iteration-label with current iteration', async ({ page }) => {
  const candidates = [
    { id: 'cand-1', title: '전략 알파', price_krw: 28900, rationale: '알파 전략 근거' },
    { id: 'cand-2', title: '전략 베타', price_krw: 29900, rationale: '베타 전략 근거' },
  ];

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: { iteration: 1, total: 3, candidates },
        },
        {
          type: 'iteration_complete',
          data: {
            iteration: 1,
            winner_id: 'cand-1',
            winner_revenue: 5500000,
            accepted: true,
            rejected_count: 1,
            choice_summary: { our_product: 440, competitor_a: 160, competitor_b: 100, competitor_c: 80, pass: 20 },
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

  // Wait for the winner to be marked (ensures iteration_complete was processed)
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="strategy-candidate-1"]');
      return el && el.classList.contains('candidate-winner-active');
    },
    { timeout: 10_000 },
  );

  // strategy-iteration-label must contain the iteration number
  const labelText = await page.locator('[data-testid="strategy-iteration-label"]').textContent();
  expect(labelText?.trim()).toMatch(/1/); // must contain iteration number "1"
});

// ── Test 4: Multi-iteration — label + winner updates correctly ────────────────

test('ac8b3: multi-iteration sequence updates label and winner on each iteration_complete', async ({ page }) => {
  const candidates1 = [
    { id: 'cand-a', title: '전략 A1', price_krw: 28900, rationale: '전략 A1 근거' },
    { id: 'cand-b', title: '전략 B1', price_krw: 29900, rationale: '전략 B1 근거' },
  ];
  const candidates2 = [
    { id: 'cand-c', title: '전략 C2', price_krw: 27900, rationale: '전략 C2 근거' },
    { id: 'cand-d', title: '전략 D2', price_krw: 30900, rationale: '전략 D2 근거' },
  ];

  const sseBody = buildSseBody([
    { type: 'iteration_start', data: { iteration: 1, total: 2, candidates: candidates1 } },
    {
      type: 'iteration_complete',
      data: {
        iteration: 1,
        winner_id: 'cand-a',
        winner_revenue: 5600000,
        accepted: true,
        rejected_count: 1,
        choice_summary: { our_product: 450, competitor_a: 150, competitor_b: 100, competitor_c: 80, pass: 20 },
        archetype_breakdown: {},
      },
    },
    { type: 'iteration_start', data: { iteration: 2, total: 2, candidates: candidates2 } },
    {
      type: 'iteration_complete',
      data: {
        iteration: 2,
        winner_id: 'cand-d',
        winner_revenue: 6100000,
        accepted: true,
        rejected_count: 1,
        choice_summary: { our_product: 470, competitor_a: 130, competitor_b: 100, competitor_c: 80, pass: 20 },
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

  // Wait for second iteration_complete to be processed:
  // After iteration 2, cand-d (slot 2) should be the winner
  await page.waitForFunction(
    () => {
      // Candidate 2 title should be '전략 D2'
      const title2 = document.getElementById('candidate-2-title');
      return title2 && title2.textContent.trim() === '전략 D2';
    },
    { timeout: 15_000 },
  );

  // Wait for second iteration winner to be marked
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="strategy-candidate-2"]');
      return el && el.classList.contains('candidate-winner-active');
    },
    { timeout: 10_000 },
  );

  // After iteration 2 complete: label must contain "2"
  const labelText = await page.locator('[data-testid="strategy-iteration-label"]').textContent();
  expect(labelText?.trim()).toMatch(/2/);

  // Iteration 2 winner is cand-d (slot 2), so card 2 should have winner active class
  const card2Classes = await page.locator('[data-testid="strategy-candidate-2"]').getAttribute('class');
  expect(card2Classes).toContain('candidate-winner-active');

  // Card 1 should NOT have winner active class (was cleared by iteration_start for iteration 2)
  const card1Classes = await page.locator('[data-testid="strategy-candidate-1"]').getAttribute('class');
  expect(card1Classes ?? '').not.toContain('candidate-winner-active');

  // Crown for winner (slot 2) must be visible
  const crown2Display = await page.evaluate(() => {
    const el = document.getElementById('candidate-2-winner');
    return el ? el.style.display : 'none';
  });
  expect(crown2Display).not.toBe('none');
  expect(crown2Display).not.toBeNull();
});

// ── Test 5: First winner card (slot 1) is highlighted correctly ───────────────

test('ac8b3: iteration_complete highlights first candidate card when winner_id matches slot 1', async ({ page }) => {
  const candidates = [
    { id: 'alpha-1', title: '트리클리닉 두피과학 탈모 샴푸', price_krw: 28900, rationale: '가격 경쟁력 우선 전략' },
    { id: 'alpha-2', title: '트리클리닉 프리미엄 스칼프 샴푸', price_krw: 32900, rationale: '프리미엄 포지셔닝 전략' },
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
            winner_id: 'alpha-1',
            winner_revenue: 5800000,
            accepted: true,
            rejected_count: 1,
            choice_summary: { our_product: 460, competitor_a: 140, competitor_b: 100, competitor_c: 80, pass: 20 },
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

  // Wait for winner to be marked
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="strategy-candidate-1"]');
      return el && el.classList.contains('candidate-winner-active');
    },
    { timeout: 10_000 },
  );

  // Card 1 must be highlighted
  const card1Classes = await page.locator('[data-testid="strategy-candidate-1"]').getAttribute('class');
  expect(card1Classes).toContain('candidate-winner-active');

  // Crown for card 1 must be visible
  const crown1Display = await page.evaluate(() => {
    const el = document.getElementById('candidate-1-winner');
    return el ? el.style.display : 'none';
  });
  expect(crown1Display).not.toBe('none');

  // Crown for card 2 must remain hidden
  const crown2Display = await page.evaluate(() => {
    const el = document.getElementById('candidate-2-winner');
    return el ? el.style.display : 'none';
  });
  expect(crown2Display).toBe('none');

  // strategy-iteration-label must contain iteration number 1
  const labelText = await page.locator('[data-testid="strategy-iteration-label"]').textContent();
  expect(labelText?.trim()).toMatch(/1/);
});
