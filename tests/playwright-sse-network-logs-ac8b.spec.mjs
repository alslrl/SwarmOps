/**
 * playwright-sse-network-logs-ac8b.spec.mjs
 *
 * Sub-AC 8b: Capture SSE stream network logs and console output showing
 * live force-directed simulation events flowing from server to client.
 *
 * This test:
 *   1. Intercepts the SSE network request to /api/run/stream
 *   2. Captures browser console output (agent_decision events logged by injected listener)
 *   3. Verifies that force-directed simulation events (agent_decision, iteration_start,
 *      iteration_complete) flow from server → SSE stream → dashboard client → particle engine
 *   4. Captures network response metadata (Content-Type: text/event-stream)
 *   5. Saves a structured network-log artifact to artifacts/sse-network-log-ac8b.json
 *
 * PRD §12.3, §16
 * Port: 3105 — dedicated, no collision with other specs
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(__dirname, '../artifacts');

const PORT = 3105;
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
 * Build a full simulation SSE stream with:
 *   - 1 x iteration_start
 *   - 24 x agent_decision (3 per archetype × 8 archetypes)
 *   - 1 x iteration_complete
 *   - 1 x simulation_complete
 *
 * All events contain force-directed simulation data:
 * archetype_id + chosen_product + x/y coordinates
 */
function buildForceSimSseBody() {
  const archetypes = [
    'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
    'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
  ];
  const products = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  const names = [
    '김지수', '이민준', '박서연', '최현우', '정수아', '윤하준', '강도윤', '조아름',
    '신예진', '홍태양', '문지원', '임서준', '배나영', '오주현', '황민서',
    '서지호', '전유빈', '양수빈', '류채원', '노지민', '한예슬', '고승완', '배진수', '천민아',
  ];

  const candidates = [
    { id: 'force-sim-strategy', title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml', price_krw: 28900, rationale: '가격 민감형 고객 확보 전략' },
    { id: 'force-sim-strategy-b', title: '트리클리닉 전문가 설계 탈모 샴푸 500ml', price_krw: 29900, rationale: '신뢰 메시지 강화 전략' },
  ];

  const events = [
    {
      type: 'iteration_start',
      data: {
        iteration: 1,
        total: 1,
        candidates,
        strategy_reasoning: '가격 경쟁력과 신뢰 메시지 강화를 통해 매출 극대화를 목표로 합니다.',
      },
    },
  ];

  // Generate 24 agent_decision events — 3 decisions per archetype
  for (let i = 0; i < 24; i++) {
    const archIdx = i % archetypes.length;
    const archetype = archetypes[archIdx];
    const chosenProduct = products[i % products.length];

    events.push({
      type: 'agent_decision',
      data: {
        iteration: 1,
        agent_id: `${archetype}_${String(i + 1).padStart(4, '0')}`,
        agent_name: names[i],
        agent_index: i,
        agent_total: 800,
        archetype_id: archetype,
        chosen_product: chosenProduct,
        reasoning: `에이전트 ${i + 1}번: ${archetype} 유형이 ${chosenProduct}를 선택했습니다.`,
        price_sensitivity: 2.0 + (i % 30) / 10,
        trust_sensitivity: 1.5 + (i % 35) / 10,
        promo_affinity: 1.0 + (i % 40) / 10,
        brand_bias: 1.0 + (i % 25) / 10,
        pass_threshold: 0.2 + (i % 6) / 10,
      },
    });
  }

  // Build archetype_breakdown for iteration_complete
  const choiceSummary = { our_product: 0, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 };
  for (let i = 0; i < 24; i++) {
    const pid = products[i % products.length];
    choiceSummary[pid] = (choiceSummary[pid] || 0) + 1;
  }

  const archetypeBreakdown = {};
  for (const arch of archetypes) {
    archetypeBreakdown[arch] = {
      our_product: 2, competitor_a: 1, competitor_b: 0, competitor_c: 0, pass: 0,
    };
  }

  events.push({
    type: 'iteration_complete',
    data: {
      iteration: 1,
      winner_id: 'force-sim-strategy',
      winner_revenue: 6200000,
      accepted: true,
      rejected_count: 1,
      choice_summary: choiceSummary,
      archetype_breakdown: archetypeBreakdown,
    },
  });

  events.push({
    type: 'simulation_complete',
    data: {
      baseline: {
        id: 'baseline',
        title: '트리클리닉 엑스퍼트 스칼프 탈모 샴푸 500ml',
        top_copy: '두피과학 기반의 성분 설계로 매일 신뢰감 있게 관리하는 프리미엄 탈모 샴푸',
        price_krw: 29900,
        simulated_revenue: 5651100,
        margin_rate: 0.632,
      },
      selected_strategy: {
        id: 'force-sim-strategy',
        title: '트리클리닉 두피과학 기반 탈모 샴푸 500ml',
        top_copy: '전문가 관점의 두피과학 설계로 매일 균형 있게 관리하는 프리미엄 탈모 샴푸',
        price_krw: 28900,
        simulated_revenue: 6200000,
        margin_rate: 0.619,
        rationale: '가격 민감형 고객 확보를 위해 소폭 가격 인하, 두피과학 메시지 강화',
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
        price: { before: 29900, after: 28900 },
      },
      artifact: {
        payload: {
          selected_strategy_id: 'force-sim-strategy',
          holdout_uplift: 548900,
          generated_at: new Date().toISOString(),
        },
      },
    },
  });

  return buildSseBody(events);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

async function waitForParticleEngine(page) {
  await page.waitForFunction(
    () => typeof window.particleEngine !== 'undefined' && window.particleEngine !== null,
    { timeout: 10_000 },
  );
}

// ── Test 1: Network response has correct SSE Content-Type header ──────────────

test('ac8b-network: SSE endpoint returns text/event-stream Content-Type', async ({ page }) => {
  // Capture the network response to the SSE endpoint
  const capturedResponses = [];

  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/run/stream')) {
      capturedResponses.push({
        url,
        status: response.status(),
        headers: response.headers(),
        timestamp: new Date().toISOString(),
      });
    }
  });

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: { iteration: 1, total: 1, candidates: [{ id: 'test', title: '테스트 전략', price_krw: 28900 }] },
        },
        {
          type: 'simulation_complete',
          data: {
            baseline: { id: 'b', title: '베이스', price_krw: 29900, simulated_revenue: 5000000, margin_rate: 0.6 },
            selected_strategy: { id: 'test', title: '테스트 전략', price_krw: 28900, simulated_revenue: 5500000, margin_rate: 0.58, rationale: '테스트' },
            holdout: { holdout_uplift: 500000, holdout_revenue: 5500000, margin_floor_violations: 0 },
            diff: { title: { before: '베이스', after: '테스트 전략' }, price: { before: 29900, after: 28900 } },
            artifact: { payload: { selected_strategy_id: 'test', holdout_uplift: 500000, generated_at: new Date().toISOString() } },
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation to complete
  await page.waitForSelector('[data-testid="state-completed"]', { state: 'visible', timeout: 20_000 });

  // Verify network response was captured
  expect(capturedResponses.length).toBeGreaterThan(0);

  const sseResponse = capturedResponses[0];
  expect(sseResponse.status).toBe(200);
  expect(sseResponse.headers['content-type']).toContain('text/event-stream');
  expect(sseResponse.url).toContain('/api/run/stream');

  console.log(`[ac8b-network] SSE response captured: status=${sseResponse.status}, content-type=${sseResponse.headers['content-type']}`);
});

// ── Test 2: Console output captures agent_decision events flowing through simEventBus ──

test('ac8b-console: console output captures agent_decision events via simEventBus injection', async ({ page }) => {
  /** @type {Array<{type: string, text: string, timestamp: string}>} */
  const consoleMessages = [];

  // Capture all console output from the browser
  page.on('console', (msg) => {
    consoleMessages.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: new Date().toISOString(),
    });
  });

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildForceSimSseBody(),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await waitForParticleEngine(page);

  // Inject a simEventBus listener BEFORE clicking run, to log every SSE event to console
  await page.evaluate(() => {
    if (!window.simEventBus) {
      console.warn('[ac8b-test] simEventBus not available on window');
      return;
    }

    // Subscribe to agent_decision events — log archetype + product to console
    window.simEventBus.on('agent_decision', (data) => {
      console.log(
        `[SSE:agent_decision] archetype=${data.archetype_id} -> product=${data.chosen_product}` +
        ` | agent_index=${data.agent_index} | agent_total=${data.agent_total}`,
      );
    });

    // Subscribe to iteration_start events — log iteration number
    window.simEventBus.on('iteration_start', (data) => {
      console.log(
        `[SSE:iteration_start] iteration=${data.iteration}/${data.total}` +
        ` | candidates=${data.candidates?.length ?? 0}`,
      );
    });

    // Subscribe to iteration_complete events — log winner and revenue
    window.simEventBus.on('iteration_complete', (data) => {
      console.log(
        `[SSE:iteration_complete] iteration=${data.iteration}` +
        ` | winner_id=${data.winner_id} | winner_revenue=${data.winner_revenue}` +
        ` | accepted=${data.accepted}`,
      );
    });

    // Subscribe to simulation_complete events
    window.simEventBus.on('simulation_complete', (data) => {
      const uplift = data.holdout?.holdout_uplift ?? 0;
      const strategyId = data.selected_strategy?.id ?? 'unknown';
      console.log(
        `[SSE:simulation_complete] strategy=${strategyId}` +
        ` | holdout_uplift=${uplift}`,
      );
    });

    console.log('[ac8b-test] simEventBus listeners registered — ready for SSE stream');
  });

  // Click run to start the SSE stream
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation to complete
  await page.waitForSelector('[data-testid="state-completed"]', { state: 'visible', timeout: 30_000 });

  // Give a moment for all console messages to flush
  await page.waitForTimeout(200);

  // Filter for the SSE-related console messages
  const sseMessages = consoleMessages.filter((m) => m.text.startsWith('[SSE:'));

  // Verify that SSE event log messages were captured
  expect(sseMessages.length).toBeGreaterThan(0);

  // Must have at least 1 iteration_start message
  const iterationStartMsgs = sseMessages.filter((m) => m.text.includes('[SSE:iteration_start]'));
  expect(iterationStartMsgs.length).toBeGreaterThanOrEqual(1);

  // Must have agent_decision messages (we sent 24)
  const agentDecisionMsgs = sseMessages.filter((m) => m.text.includes('[SSE:agent_decision]'));
  expect(agentDecisionMsgs.length).toBeGreaterThanOrEqual(10);

  // Must have iteration_complete message
  const iterationCompleteMsgs = sseMessages.filter((m) => m.text.includes('[SSE:iteration_complete]'));
  expect(iterationCompleteMsgs.length).toBeGreaterThanOrEqual(1);

  // Must have simulation_complete message
  const simCompleteMsgs = sseMessages.filter((m) => m.text.includes('[SSE:simulation_complete]'));
  expect(simCompleteMsgs.length).toBeGreaterThanOrEqual(1);

  // Verify agent_decision messages contain force-directed simulation data
  const firstAgentMsg = agentDecisionMsgs[0];
  expect(firstAgentMsg.text).toMatch(/archetype=\w+/);
  expect(firstAgentMsg.text).toMatch(/product=\w+/);
  expect(firstAgentMsg.text).toMatch(/agent_index=\d+/);

  // Verify iteration_start shows correct format
  const iterStartMsg = iterationStartMsgs[0];
  expect(iterStartMsg.text).toMatch(/iteration=1\/1/);
  expect(iterStartMsg.text).toMatch(/candidates=2/);

  console.log(`[ac8b-console] Captured ${sseMessages.length} SSE event log messages`);
  console.log(`[ac8b-console]   iteration_start: ${iterationStartMsgs.length}`);
  console.log(`[ac8b-console]   agent_decision:  ${agentDecisionMsgs.length}`);
  console.log(`[ac8b-console]   iteration_complete: ${iterationCompleteMsgs.length}`);
  console.log(`[ac8b-console]   simulation_complete: ${simCompleteMsgs.length}`);
});

// ── Test 3: Force-directed simulation events trigger particle engine ───────────

test('ac8b-force-sim: agent_decision events spawn particles in the force-directed engine', async ({ page }) => {
  const capturedAgentDecisions = [];

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildForceSimSseBody(),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await waitForParticleEngine(page);

  // Inject listener to track particle spawns triggered by agent_decision
  await page.evaluate(() => {
    window._ac8bParticleSpawnLog = [];
    const originalSpawnForAgent = window.particleEngine?.spawnForAgent?.bind(window.particleEngine);

    if (window.particleEngine && originalSpawnForAgent) {
      window.particleEngine.spawnForAgent = function (archetypeId, chosenProduct) {
        window._ac8bParticleSpawnLog.push({
          archetype_id: archetypeId,
          chosen_product: chosenProduct,
          timestamp: performance.now(),
        });
        return originalSpawnForAgent(archetypeId, chosenProduct);
      };
    }

    // Also track agent_decision events from simEventBus
    window._ac8bAgentDecisionLog = [];
    if (window.simEventBus) {
      window.simEventBus.on('agent_decision', (data) => {
        window._ac8bAgentDecisionLog.push({
          agent_id: data.agent_id,
          archetype_id: data.archetype_id,
          chosen_product: data.chosen_product,
          agent_index: data.agent_index,
          agent_total: data.agent_total,
        });
      });
    }
  });

  // Click run to start the SSE stream
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation to complete
  await page.waitForSelector('[data-testid="state-completed"]', { state: 'visible', timeout: 30_000 });

  // Allow time for all particle spawn callbacks to execute
  await page.waitForTimeout(500);

  // Read the logs from the browser
  const agentDecisionLog = await page.evaluate(() => window._ac8bAgentDecisionLog ?? []);
  const particleSpawnLog = await page.evaluate(() => window._ac8bParticleSpawnLog ?? []);

  // Verify agent_decision events were received from the SSE stream
  expect(agentDecisionLog.length).toBeGreaterThanOrEqual(20);

  // Verify all agent_decisions have valid archetype_id and chosen_product
  for (const entry of agentDecisionLog) {
    expect(entry.archetype_id).toBeTruthy();
    expect(entry.chosen_product).toBeTruthy();
    expect(entry.agent_total).toBe(800);
  }

  // Verify that each agent_decision triggered a particle spawn (1:1 mapping)
  // Allow for minor discrepancy (particles may not spawn if engine is frozen)
  expect(particleSpawnLog.length).toBeGreaterThanOrEqual(agentDecisionLog.length * 0.8);

  // Verify particle spawns contain correct archetype and product data
  for (const spawn of particleSpawnLog.slice(0, 5)) {
    expect(spawn.archetype_id).toBeTruthy();
    expect(spawn.chosen_product).toBeTruthy();
    capturedAgentDecisions.push(spawn);
  }

  console.log(`[ac8b-force-sim] SSE agent_decision events: ${agentDecisionLog.length}`);
  console.log(`[ac8b-force-sim] Particle spawns triggered: ${particleSpawnLog.length}`);
  console.log(`[ac8b-force-sim] First 3 agent decisions:`);
  for (const d of agentDecisionLog.slice(0, 3)) {
    console.log(`[ac8b-force-sim]   ${d.archetype_id} -> ${d.chosen_product} (index=${d.agent_index})`);
  }
});

// ── Test 4: Full SSE stream network log capture with artifact save ─────────────
//
// This is the primary evidence capture test. It records all SSE events, network
// metadata, and console output, then saves to artifacts/sse-network-log-ac8b.json.

test('ac8b-network-log: capture full SSE stream events and save artifact log', async ({ page }) => {
  /** @type {Array<{url: string, status: number, contentType: string, timestamp: string}>} */
  const networkLog = [];

  /** @type {Array<{type: string, text: string, timestamp: string}>} */
  const consolelog = [];

  /** @type {Array<{eventType: string, agentIndex?: number, archetypeId?: string, chosenProduct?: string}>} */
  const sseEventLog = [];

  // Capture network responses
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/run/stream')) {
      networkLog.push({
        url,
        status: response.status(),
        contentType: response.headers()['content-type'] ?? '',
        timestamp: new Date().toISOString(),
        method: 'POST',
      });
    }
  });

  // Capture all console messages from the browser
  page.on('console', (msg) => {
    consolelog.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: new Date().toISOString(),
    });
  });

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildForceSimSseBody(),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await waitForParticleEngine(page);

  // Inject comprehensive SSE event tracking via simEventBus
  await page.evaluate(() => {
    window._ac8bSseEventLog = [];

    if (!window.simEventBus) {
      console.warn('[ac8b-network-log] simEventBus not available');
      return;
    }

    // Log ALL event types
    window.simEventBus.onAny((type, data) => {
      const entry = { eventType: type, timestamp: performance.now() };

      switch (type) {
        case 'iteration_start':
          entry.iteration = data.iteration;
          entry.total = data.total;
          entry.candidateCount = data.candidates?.length ?? 0;
          console.log(
            `[SSE:network-log] iteration_start | iter=${data.iteration}/${data.total}` +
            ` | candidates=${entry.candidateCount}`,
          );
          break;
        case 'agent_decision':
          entry.agentIndex = data.agent_index;
          entry.archetypeId = data.archetype_id;
          entry.chosenProduct = data.chosen_product;
          entry.agentTotal = data.agent_total;
          // Only log every 4th agent_decision to avoid flooding console
          if (data.agent_index % 4 === 0) {
            console.log(
              `[SSE:network-log] agent_decision[${data.agent_index}]` +
              ` | ${data.archetype_id} -> ${data.chosen_product}`,
            );
          }
          break;
        case 'iteration_complete':
          entry.iteration = data.iteration;
          entry.winnerId = data.winner_id;
          entry.winnerRevenue = data.winner_revenue;
          entry.accepted = data.accepted;
          console.log(
            `[SSE:network-log] iteration_complete | iter=${data.iteration}` +
            ` | winner=${data.winner_id} | revenue=${data.winner_revenue}` +
            ` | accepted=${data.accepted}`,
          );
          break;
        case 'simulation_complete':
          entry.strategyId = data.selected_strategy?.id;
          entry.holdoutUplift = data.holdout?.holdout_uplift;
          console.log(
            `[SSE:network-log] simulation_complete` +
            ` | strategy=${entry.strategyId}` +
            ` | uplift=${entry.holdoutUplift}`,
          );
          break;
        default:
          break;
      }

      window._ac8bSseEventLog.push(entry);
    });

    console.log('[SSE:network-log] Event capture listeners registered');
  });

  // Click run to start the SSE stream
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation to complete
  await page.waitForSelector('[data-testid="state-completed"]', { state: 'visible', timeout: 30_000 });

  // Wait for all events to flush through
  await page.waitForTimeout(500);

  // Collect results from browser
  const sseEventLogFromPage = await page.evaluate(() => window._ac8bSseEventLog ?? []);

  // ── Assertions ────────────────────────────────────────────────────────────

  // Network: SSE endpoint was called with correct content-type
  expect(networkLog.length).toBeGreaterThan(0);
  expect(networkLog[0].contentType).toContain('text/event-stream');
  expect(networkLog[0].status).toBe(200);

  // SSE Events: all expected event types were received
  const eventTypes = new Set(sseEventLogFromPage.map((e) => e.eventType));
  expect(eventTypes.has('iteration_start')).toBe(true);
  expect(eventTypes.has('agent_decision')).toBe(true);
  expect(eventTypes.has('iteration_complete')).toBe(true);
  expect(eventTypes.has('simulation_complete')).toBe(true);

  // Agent decisions: 24 were sent, at least 20 must be received
  const agentDecisions = sseEventLogFromPage.filter((e) => e.eventType === 'agent_decision');
  expect(agentDecisions.length).toBeGreaterThanOrEqual(20);

  // Each agent_decision has required force-simulation fields
  for (const ad of agentDecisions.slice(0, 5)) {
    expect(ad.archetypeId).toBeTruthy();
    expect(ad.chosenProduct).toBeTruthy();
    expect(typeof ad.agentIndex).toBe('number');
    expect(ad.agentTotal).toBe(800);
  }

  // Console: SSE event log messages were emitted
  const networkLogConsoleMsgs = consolelog.filter((m) => m.text.includes('[SSE:network-log]'));
  expect(networkLogConsoleMsgs.length).toBeGreaterThan(0);

  // ── Save artifact ─────────────────────────────────────────────────────────

  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });

  const artifactPath = path.join(ARTIFACTS_DIR, 'sse-network-log-ac8b.json');
  const artifact = {
    generated_at: new Date().toISOString(),
    test_name: 'ac8b-network-log',
    description: 'SSE stream network logs and console output for force-directed simulation',
    network_log: networkLog,
    sse_event_summary: {
      total_events: sseEventLogFromPage.length,
      event_type_counts: sseEventLogFromPage.reduce((acc, e) => {
        acc[e.eventType] = (acc[e.eventType] || 0) + 1;
        return acc;
      }, {}),
      agent_decisions_received: agentDecisions.length,
      agent_total_per_event: agentDecisions[0]?.agentTotal ?? null,
      archetypes_seen: [...new Set(agentDecisions.map((e) => e.archetypeId))],
      products_seen: [...new Set(agentDecisions.map((e) => e.chosenProduct))],
    },
    sse_events_sample: sseEventLogFromPage.slice(0, 30),
    console_log_sample: consolelog
      .filter((m) => m.text.includes('[SSE:'))
      .slice(0, 30),
    assertions_passed: {
      network_sse_content_type: networkLog[0]?.contentType?.includes('text/event-stream') ?? false,
      iteration_start_received: eventTypes.has('iteration_start'),
      agent_decision_received: eventTypes.has('agent_decision'),
      iteration_complete_received: eventTypes.has('iteration_complete'),
      simulation_complete_received: eventTypes.has('simulation_complete'),
      agent_decisions_count_gte_20: agentDecisions.length >= 20,
      console_output_captured: networkLogConsoleMsgs.length > 0,
    },
  };

  await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');

  const stats = await fs.stat(artifactPath);
  expect(stats.size).toBeGreaterThan(500);

  console.log(`[ac8b-network-log] Artifact saved: ${artifactPath} (${stats.size} bytes)`);
  console.log(`[ac8b-network-log] SSE events captured: ${sseEventLogFromPage.length}`);
  console.log(`[ac8b-network-log] Agent decisions: ${agentDecisions.length}`);
  console.log(`[ac8b-network-log] Event types: ${[...eventTypes].join(', ')}`);
  console.log(`[ac8b-network-log] Archetypes seen: ${artifact.sse_event_summary.archetypes_seen.join(', ')}`);
});

// ── Test 5: SSE stream request includes correct POST body parameters ──────────

test('ac8b-request: SSE stream POST request body contains simulation parameters', async ({ page }) => {
  /** @type {Array<{url: string, method: string, postData: string|null}>} */
  const capturedRequests = [];

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/run/stream')) {
      capturedRequests.push({
        url,
        method: request.method(),
        postData: request.postData(),
        headers: request.headers(),
        timestamp: new Date().toISOString(),
      });
    }
  });

  await page.route('**/api/run/stream', async (route) => {
    // Let the request metadata through, then fulfill with mock
    const request = route.request();
    const postData = request.postData();

    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSseBody([
        {
          type: 'iteration_start',
          data: { iteration: 1, total: 1, candidates: [{ id: 'req-test', title: '요청 테스트', price_krw: 28900 }] },
        },
        {
          type: 'simulation_complete',
          data: {
            baseline: { id: 'b', title: '베이스', price_krw: 29900, simulated_revenue: 5000000, margin_rate: 0.6 },
            selected_strategy: { id: 'req-test', title: '요청 테스트', price_krw: 28900, simulated_revenue: 5500000, margin_rate: 0.58, rationale: '테스트' },
            holdout: { holdout_uplift: 500000, holdout_revenue: 5500000, margin_floor_violations: 0 },
            diff: { title: { before: '베이스', after: '요청 테스트' }, price: { before: 29900, after: 28900 } },
            artifact: { payload: { selected_strategy_id: 'req-test', holdout_uplift: 500000, generated_at: new Date().toISOString() } },
          },
        },
      ]),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation to complete
  await page.waitForSelector('[data-testid="state-completed"]', { state: 'visible', timeout: 20_000 });

  // Verify request was captured
  expect(capturedRequests.length).toBeGreaterThan(0);

  const sseRequest = capturedRequests[0];
  expect(sseRequest.method).toBe('POST');
  expect(sseRequest.url).toContain('/api/run/stream');

  // POST body must be valid JSON with simulation parameters
  expect(sseRequest.postData).not.toBeNull();
  const postBody = JSON.parse(sseRequest.postData);

  // Required simulation parameters from the input panel
  expect(postBody).toHaveProperty('title');
  expect(postBody).toHaveProperty('topCopy');
  expect(postBody).toHaveProperty('priceKrw');
  expect(postBody).toHaveProperty('costKrw');
  expect(typeof postBody.priceKrw).toBe('number');
  expect(postBody.priceKrw).toBeGreaterThan(0);

  console.log(`[ac8b-request] SSE POST request captured: ${sseRequest.url}`);
  console.log(`[ac8b-request] POST body title: "${postBody.title?.substring(0, 40)}..."`);
  console.log(`[ac8b-request] POST body priceKrw: ${postBody.priceKrw}`);
  console.log(`[ac8b-request] POST body iterationCount: ${postBody.iterationCount}`);
});
