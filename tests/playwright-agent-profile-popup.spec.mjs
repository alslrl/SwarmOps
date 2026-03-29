/**
 * playwright-agent-profile-popup.spec.mjs
 *
 * Playwright tests covering AC5 — Agent Profile Popup (Sub-AC 5c)
 *
 * Scenarios:
 *   1. Clicking an agent-log-entry opens the agent-profile popup
 *   2. Popup shows all expected stat fields populated with real values
 *   3. X button (agent-profile-close) dismisses the popup
 *   4. ESC key dismisses the popup
 *   5. Overlay/backdrop click dismisses the popup
 *
 * PRD §16 — data-testid attributes verified:
 *   agent-profile, agent-profile-name, agent-profile-archetype,
 *   agent-profile-stats, stat-price-sensitivity, stat-trust-sensitivity,
 *   stat-promo-affinity, stat-brand-bias, stat-pass-threshold,
 *   agent-profile-choice, agent-profile-reasoning, agent-profile-close
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';

const PORT = 3094; // dedicated port — no collision with other test servers
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
    id: 'ac5-test-strategy',
    title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml',
    top_copy: '전문가 관점의 두피과학 설계로 균형 있게 관리하는 프리미엄 탈모 샴푸',
    price_krw: 28900,
    simulated_revenue: 6200000,
    margin_rate: 0.619,
    rationale: 'AC5 테스트용 전략: 소폭 가격 인하로 가격 민감형 고객 확보',
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
    price: { before: 29900, after: 28900 },
  },
  artifact: {
    payload: {
      selected_strategy_id: 'ac5-test-strategy',
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

// Three mock agent_decision events with full stat payloads
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

const MOCK_SSE_WITH_AGENTS = buildSseBody([
  {
    type: 'iteration_start',
    data: {
      iteration: 1,
      total: 1,
      candidates: [
        { id: 'ac5-test-strategy', title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml', price_krw: 28900 },
      ],
    },
  },
  ...AGENT_DECISION_EVENTS,
  {
    type: 'iteration_complete',
    data: {
      iteration: 1,
      winner_id: 'ac5-test-strategy',
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

const MOCK_SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
};

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wait until fixture data is rendered in the product-name element. */
async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

/**
 * Navigate to the dashboard, intercept SSE with mock data, run simulation,
 * and wait for agent-log-entry items to appear.
 * Returns the `page` for chaining.
 */
async function setupWithAgentLog(page) {
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: MOCK_SSE_HEADERS,
      body: MOCK_SSE_WITH_AGENTS,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.locator('[data-testid="btn-run"]').click();

  // Wait for at least one agent-log-entry to appear
  await page.waitForSelector('[data-testid="agent-log-entry"]', { timeout: 15_000 });

  return page;
}

/** Click the first agent-log-entry and wait for the popup to become visible. */
async function openFirstAgentProfile(page) {
  const firstEntry = page.locator('[data-testid="agent-log-entry"]').first();
  await firstEntry.click();

  // Popup should now have display:flex (set by openAgentProfile)
  const popup = page.locator('[data-testid="agent-profile"]').first();
  await expect(popup).toBeVisible({ timeout: 3_000 });
  return popup;
}

// ── Test 1: Popup opens on log-entry click ────────────────────────────────────

test('AC5: clicking an agent-log-entry opens the agent-profile popup', async ({ page }) => {
  await setupWithAgentLog(page);

  // Popup must be hidden before any click
  const popup = page.locator('#agent-profile-popup');
  await expect(popup).toBeHidden();

  // Click the first log entry
  const firstEntry = page.locator('[data-testid="agent-log-entry"]').first();
  await firstEntry.click();

  // Popup must now be visible
  await expect(popup).toBeVisible({ timeout: 3_000 });
});

// ── Test 2: Popup shows all expected stat fields ──────────────────────────────

test('AC5: agent-profile popup contains all expected stat fields with populated values', async ({ page }) => {
  await setupWithAgentLog(page);
  await openFirstAgentProfile(page);

  // ── Header fields ────────────────────────────────────────
  // agent-profile-name: should display the agent's name (not empty placeholder)
  const nameEl = page.locator('[data-testid="agent-profile-name"]');
  await expect(nameEl).toBeVisible();
  const nameText = await nameEl.textContent();
  expect(nameText?.trim().length).toBeGreaterThan(0);

  // agent-profile-archetype: should display archetype label (not '—')
  const archetypeEl = page.locator('[data-testid="agent-profile-archetype"]');
  await expect(archetypeEl).toBeVisible();
  const archetypeText = await archetypeEl.textContent();
  expect(archetypeText?.trim().length).toBeGreaterThan(0);

  // ── Stats container ───────────────────────────────────────
  const statsContainer = page.locator('[data-testid="agent-profile-stats"]');
  await expect(statsContainer).toBeVisible();

  // ── Individual stat bar elements ──────────────────────────
  const statTestIds = [
    'stat-price-sensitivity',
    'stat-trust-sensitivity',
    'stat-promo-affinity',
    'stat-brand-bias',
    'stat-pass-threshold',
  ];
  for (const testId of statTestIds) {
    const statBar = page.locator(`[data-testid="${testId}"]`);
    await expect(statBar, `${testId} must be attached`).toBeAttached();
  }

  // ── Stat value labels must show numeric values (not '—') ──
  const statValTestIds = [
    'stat-val-price-sensitivity',
    'stat-val-trust-sensitivity',
    'stat-val-promo-affinity',
    'stat-val-brand-bias',
    'stat-val-pass-threshold',
  ];
  for (const testId of statValTestIds) {
    const valEl = page.locator(`[data-testid="${testId}"]`).first();
    await expect(valEl, `${testId} must be visible`).toBeVisible();
    const valText = await valEl.textContent();
    // Must be a numeric value (not the '—' placeholder)
    expect(valText?.trim(), `${testId} should show a numeric value`).not.toBe('—');
    expect(valText?.trim().length).toBeGreaterThan(0);
  }

  // ── Chosen product badge ──────────────────────────────────
  const choiceEl = page.locator('[data-testid="agent-profile-choice"]');
  await expect(choiceEl).toBeVisible();
  const choiceText = await choiceEl.textContent();
  expect(choiceText?.trim().length).toBeGreaterThan(0);
  expect(choiceText?.trim()).not.toBe('—');

  // ── Reasoning text ────────────────────────────────────────
  const reasoningEl = page.locator('[data-testid="agent-profile-reasoning"]');
  await expect(reasoningEl).toBeVisible();
  const reasoningText = await reasoningEl.textContent();
  expect(reasoningText?.trim().length).toBeGreaterThan(0);

  // ── Close button is present and accessible ────────────────
  const closeBtn = page.locator('[data-testid="agent-profile-close"]');
  await expect(closeBtn).toBeVisible();
  await expect(closeBtn).toBeEnabled();
});

// ── Test 3: Stat bars have non-zero width after popup opens ───────────────────

test('AC5: stat bars have non-zero widths reflecting agent sensitivity values', async ({ page }) => {
  await setupWithAgentLog(page);
  await openFirstAgentProfile(page);

  // The first agent (김지수, price_sensitive) has:
  //   price_sensitivity: 4.2  →  (4.2/5)*100 = 84%
  //   trust_sensitivity: 2.8  →  (2.8/5)*100 = 56%
  //   promo_affinity:    3.5  →  (3.5/5)*100 = 70%
  //   brand_bias:        1.9  →  (1.9/5)*100 = 38%
  //   pass_threshold:    0.3  →  (0.3/1)*100 = 30%
  //
  // All bars must have width > 0% (i.e. the setStatBar function ran correctly)

  const statBarIds = [
    'stat-price-sensitivity',
    'stat-trust-sensitivity',
    'stat-promo-affinity',
    'stat-brand-bias',
    'stat-pass-threshold',
  ];

  for (const testId of statBarIds) {
    const barEl = page.locator(`[data-testid="${testId}"]`).first();
    const width = await barEl.evaluate((el) => el.style.width);
    // Width should be set and greater than 0
    expect(width, `${testId} bar width should be set`).toBeTruthy();
    const widthNum = parseFloat(width);
    expect(widthNum, `${testId} bar width should be > 0`).toBeGreaterThan(0);
  }
});

// ── Test 4: Close via X button ────────────────────────────────────────────────

test('AC5: X button (agent-profile-close) dismisses the agent-profile popup', async ({ page }) => {
  await setupWithAgentLog(page);

  const popup = page.locator('#agent-profile-popup');

  // Open popup
  await openFirstAgentProfile(page);
  await expect(popup).toBeVisible();

  // Click the X button
  const closeBtn = page.locator('[data-testid="agent-profile-close"]');
  await closeBtn.click();

  // Popup must be hidden after X click
  await expect(popup).toBeHidden({ timeout: 2_000 });
});

// ── Test 5: Close via ESC key ─────────────────────────────────────────────────

test('AC5: ESC key dismisses the agent-profile popup', async ({ page }) => {
  await setupWithAgentLog(page);

  const popup = page.locator('#agent-profile-popup');

  // Open popup
  await openFirstAgentProfile(page);
  await expect(popup).toBeVisible();

  // Press ESC key
  await page.keyboard.press('Escape');

  // Popup must be hidden after ESC
  await expect(popup).toBeHidden({ timeout: 2_000 });
});

// ── Test 6: Close via overlay/backdrop click ──────────────────────────────────

test('AC5: clicking the backdrop overlay dismisses the agent-profile popup', async ({ page }) => {
  await setupWithAgentLog(page);

  const popup = page.locator('#agent-profile-popup');

  // Open popup
  await openFirstAgentProfile(page);
  await expect(popup).toBeVisible();

  // Click the backdrop (not the dialog card).
  // The dialog card is centered in the viewport (360px wide, ~1440px viewport).
  // Clicking at position (10, 10) relative to the backdrop's top-left corner
  // lands well outside the dialog and registers as a backdrop click.
  const backdrop = page.locator('#agent-profile-backdrop');
  await backdrop.click({ position: { x: 10, y: 10 } });

  // Popup must be hidden after backdrop click
  await expect(popup).toBeHidden({ timeout: 2_000 });
});

// ── Test 7: Popup can be re-opened after closing ──────────────────────────────

test('AC5: popup can be re-opened after being closed', async ({ page }) => {
  await setupWithAgentLog(page);

  const popup = page.locator('#agent-profile-popup');
  const entries = page.locator('[data-testid="agent-log-entry"]');

  // Open → close via X → re-open
  await entries.first().click();
  await expect(popup).toBeVisible({ timeout: 3_000 });

  await page.locator('[data-testid="agent-profile-close"]').click();
  await expect(popup).toBeHidden({ timeout: 2_000 });

  // Re-open same entry
  await entries.first().click();
  await expect(popup).toBeVisible({ timeout: 3_000 });

  // Stat values must still be populated after re-open
  const nameText = await page.locator('[data-testid="agent-profile-name"]').textContent();
  expect(nameText?.trim().length).toBeGreaterThan(0);
});

// ── Test 8: Different log entries show different agent data ───────────────────

test('AC5: clicking different agent-log-entries shows different agent data in popup', async ({ page }) => {
  await setupWithAgentLog(page);

  const popup = page.locator('#agent-profile-popup');
  const entries = page.locator('[data-testid="agent-log-entry"]');

  // Verify we have at least 2 entries
  const count = await entries.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Open first entry
  await entries.first().click();
  await expect(popup).toBeVisible({ timeout: 3_000 });
  const firstName = await page.locator('[data-testid="agent-profile-name"]').textContent();

  // Close
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden({ timeout: 2_000 });

  // Open second entry
  await entries.nth(1).click();
  await expect(popup).toBeVisible({ timeout: 3_000 });
  const secondName = await page.locator('[data-testid="agent-profile-name"]').textContent();

  // The two agents must have different names (김지수 vs 이민준 in mock data)
  expect(firstName?.trim()).not.toBe(secondName?.trim());
});

// ── Test 9: Close button has focus after popup opens (accessibility) ──────────

test('AC5: close button receives focus when popup opens (keyboard accessibility)', async ({ page }) => {
  await setupWithAgentLog(page);
  await openFirstAgentProfile(page);

  // The openAgentProfile() function calls elAgentProfileClose?.focus()
  // Verify the close button has focus
  const closeBtn = page.locator('[data-testid="agent-profile-close"]');
  await expect(closeBtn).toBeFocused({ timeout: 1_000 });
});

// ── Test 10: All 3 close methods: comprehensive sequential test ───────────────

test('AC5: comprehensive — all 3 close methods (X, ESC, backdrop) each dismiss popup', async ({ page }) => {
  await setupWithAgentLog(page);

  const popup = page.locator('#agent-profile-popup');
  const entries = page.locator('[data-testid="agent-log-entry"]');

  // ── Round 1: Close via X button ──────────────────────────
  await entries.first().click();
  await expect(popup).toBeVisible({ timeout: 3_000 });
  await page.locator('[data-testid="agent-profile-close"]').click();
  await expect(popup).toBeHidden({ timeout: 2_000 });

  // ── Round 2: Close via ESC key ───────────────────────────
  await entries.first().click();
  await expect(popup).toBeVisible({ timeout: 3_000 });
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden({ timeout: 2_000 });

  // ── Round 3: Close via backdrop click ────────────────────
  // Click at top-left corner (x:10, y:10) of the backdrop to avoid
  // hitting the centered dialog card which intercepts pointer events.
  await entries.first().click();
  await expect(popup).toBeVisible({ timeout: 3_000 });
  await page.locator('#agent-profile-backdrop').click({ position: { x: 10, y: 10 } });
  await expect(popup).toBeHidden({ timeout: 2_000 });
});
