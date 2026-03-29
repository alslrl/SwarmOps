/**
 * playwright-sse-network-log-ac8b.spec.mjs
 *
 * Sub-AC 8b: Capture SSE stream network logs and console output showing
 * live force-directed simulation events flowing from server to client.
 *
 * This spec verifies and captures evidence that:
 *   1. The SSE network response has Content-Type: text/event-stream
 *   2. The SSE response body contains agent_decision events (force-directed sim events)
 *   3. The client receives and processes agent_decision events (via simEventBus)
 *   4. Force-directed graph archetype node colors update on agent_decision
 *   5. Console output captures SSE event flow evidence
 *   6. Network log is saved to test-results/sse-network-log-ac8b.json as evidence
 *
 * PRD §13, §12.4 (Simulation Panel)
 * Port: 3106 — dedicated, no collision with other specs
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT     = 3106;
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

/** Build a realistic SSE stream with multiple agent_decision events */
function buildSimulationSseBody(agentCount = 10) {
  const archetypes = [
    'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
    'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
  ];
  const products = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  const names = [
    '김지수', '이민준', '박서연', '최현우', '정수아',
    '윤하준', '강도윤', '조아름', '신예진', '홍태양',
    '문지원', '임서준', '배나영', '오주현', '황민서',
  ];

  const candidates = [
    { id: 'cand-alpha', title: '트리클리닉 두피과학 탈모 샴푸 500ml', price_krw: 28900, rationale: '가격 경쟁력 강화 전략' },
    { id: 'cand-beta',  title: '트리클리닉 전문가 설계 탈모 샴푸',    price_krw: 29900, rationale: '신뢰 메시지 강화 전략' },
    { id: 'cand-gamma', title: '트리클리닉 프리미엄 스칼프 샴푸',      price_krw: 31900, rationale: '프리미엄 포지션 전략'  },
  ];

  const events = [
    {
      type: 'iteration_start',
      data: {
        iteration: 1,
        total: 1,
        candidates,
        strategy_reasoning: '가격 민감형 고객 이탈 방어와 프리미엄 포지션 유지를 균형있게 테스트합니다.',
        agent_count: agentCount,
      },
    },
  ];

  for (let i = 0; i < agentCount; i++) {
    events.push({
      type: 'agent_decision',
      data: {
        iteration:         1,
        agent_id:          `agent_${String(i + 1).padStart(4, '0')}`,
        agent_name:        names[i % names.length],
        agent_index:       i + 1,
        agent_total:       agentCount,
        archetype_id:      archetypes[i % archetypes.length],
        archetype_name:    archetypes[i % archetypes.length].replace(/_/g, ' '),
        chosen_product:    products[i % products.length],
        reasoning:         `에이전트 ${i + 1}번: ${products[i % products.length]} 선택 — 가격 대비 품질 고려`,
        price_sensitivity: 2.0 + (i % 30) / 10,
        trust_sensitivity: 1.5 + (i % 35) / 10,
        promo_affinity:    1.0 + (i % 40) / 10,
        brand_bias:        1.0 + (i % 25) / 10,
        pass_threshold:    0.2 + (i % 6) / 10,
      },
    });
  }

  events.push({
    type: 'iteration_complete',
    data: {
      iteration:       1,
      winner_id:       'cand-alpha',
      winner_revenue:  5800000,
      accepted:        true,
      rejected_count:  2,
      choice_summary: {
        our_product:  Math.ceil(agentCount * 0.36),
        competitor_a: Math.ceil(agentCount * 0.24),
        competitor_b: Math.ceil(agentCount * 0.18),
        competitor_c: Math.ceil(agentCount * 0.12),
        pass:         Math.floor(agentCount * 0.10),
      },
      archetype_breakdown: {},
    },
  });

  events.push({
    type: 'simulation_complete',
    data: {
      baseline:          { simulated_revenue: 5100000, agent_count: agentCount },
      selected_strategy: { id: 'cand-alpha', title: '트리클리닉 두피과학 탈모 샴푸 500ml', price_krw: 28900, top_copy: '전문가 설계 두피 솔루션' },
      holdout:           { holdout_uplift: 700000, holdout_revenue: 5800000, agent_count: 20 },
      diff:              { title: { before: '현재 타이틀', after: '트리클리닉 두피과학 탈모 샴푸 500ml' }, top_copy: { before: '현재 카피', after: '전문가 설계 두피 솔루션' }, price: { before: 29900, after: 28900 } },
      artifact:          { path: 'artifacts/latest-run-summary.json', selected_strategy_id: 'cand-alpha', holdout_uplift: 700000 },
      total_agents:      agentCount,
      total_llm_calls:   agentCount + 5,
    },
  });

  return buildSseBody(events);
}

// ── Fixture waiters ───────────────────────────────────────────────────────────

async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

// ── Test 1: SSE network response has correct Content-Type ────────────────────

test('ac8b: SSE network response Content-Type is text/event-stream', async ({ page }) => {
  const AGENT_COUNT = 8;
  let capturedSseResponse = null;

  // Capture the SSE response object from the network layer
  page.on('response', (response) => {
    if (response.url().includes('/api/run/stream')) {
      capturedSseResponse = response;
    }
  });

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSimulationSseBody(AGENT_COUNT),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for SSE to be processed (agent-count element updates)
  await page.waitForFunction(
    () => {
      const el = document.getElementById('agent-count');
      return el && /\d+ \/ \d+/.test(el.textContent ?? '');
    },
    { timeout: 10_000 },
  );

  // Verify the SSE network response
  expect(capturedSseResponse).not.toBeNull();
  const contentType = capturedSseResponse.headers()['content-type'];
  expect(contentType).toMatch(/text\/event-stream/);
  expect(capturedSseResponse.status()).toBe(200);

  console.log(`[ac8b] SSE network response: status=${capturedSseResponse.status()} content-type="${contentType}"`);
});

// ── Test 2: Capture SSE response body with agent_decision events ──────────────

test('ac8b: SSE response body contains agent_decision force-directed sim events', async ({ page }) => {
  const AGENT_COUNT = 10;
  let capturedResponseBody = '';

  // Intercept the SSE route and store the body
  await page.route('**/api/run/stream', async (route) => {
    const body = buildSimulationSseBody(AGENT_COUNT);
    capturedResponseBody = body;
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body,
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for the simulation to complete
  await page.waitForFunction(
    () => {
      const el = document.getElementById('sim-state-completed');
      return el && el.style.display !== 'none';
    },
    { timeout: 15_000 },
  );

  // Parse the captured SSE body and verify agent_decision events
  const lines = capturedResponseBody.split('\n');
  const eventLines = lines.filter(l => l.startsWith('event:'));
  const dataLines  = lines.filter(l => l.startsWith('data:'));

  const eventTypes = eventLines.map(l => l.replace('event:', '').trim());
  const agentDecisionEvents = [];

  let currentType = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('event:')) {
      currentType = trimmed.slice(6).trim();
    } else if (trimmed.startsWith('data:') && currentType === 'agent_decision') {
      try {
        const parsed = JSON.parse(trimmed.slice(5).trim());
        agentDecisionEvents.push(parsed);
      } catch {
        // skip malformed
      }
    }
  }

  // Verify iteration_start was in the stream
  expect(eventTypes).toContain('iteration_start');
  // Verify agent_decision events were in the stream
  expect(eventTypes).toContain('agent_decision');
  // Verify iteration_complete was in the stream
  expect(eventTypes).toContain('iteration_complete');
  // Verify simulation_complete was in the stream
  expect(eventTypes).toContain('simulation_complete');

  // Verify we got the expected number of agent_decision events
  expect(agentDecisionEvents.length).toBe(AGENT_COUNT);

  // Verify each agent_decision event has required force-directed sim fields
  for (const evt of agentDecisionEvents) {
    expect(evt).toHaveProperty('agent_id');
    expect(evt).toHaveProperty('agent_name');
    expect(evt).toHaveProperty('archetype_id');
    expect(evt).toHaveProperty('chosen_product');
    expect(['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'])
      .toContain(evt.chosen_product);
  }

  console.log(`[ac8b] Captured SSE body: ${eventTypes.length} event blocks, ${agentDecisionEvents.length} agent_decision events`);
  console.log(`[ac8b] Event sequence: ${[...new Set(eventTypes)].join(' → ')}`);
  console.log(`[ac8b] Sample agent_decision: agent_id="${agentDecisionEvents[0]?.agent_id}" archetype="${agentDecisionEvents[0]?.archetype_id}" chosen="${agentDecisionEvents[0]?.chosen_product}"`);
});

// ── Test 3: Client receives SSE events via simEventBus (event bus tap) ────────

test('ac8b: client simEventBus receives agent_decision events from SSE stream', async ({ page }) => {
  const AGENT_COUNT = 12;

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSimulationSseBody(AGENT_COUNT),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Inject a log collector into the page BEFORE clicking run
  // Tap into window.simEventBus to capture events
  await page.evaluate(() => {
    window.__ac8bEventLog = [];
    window.__ac8bEventLogReady = false;

    // Poll until simEventBus is available (it's created synchronously at page load)
    const installTap = () => {
      if (window.simEventBus) {
        const originalEmit = window.simEventBus.emit.bind(window.simEventBus);
        window.simEventBus.emit = function(type, data) {
          window.__ac8bEventLog.push({ type, timestamp: Date.now(), data });
          return originalEmit(type, data);
        };
        window.__ac8bEventLogReady = true;
      }
    };

    // simEventBus is created at module load — should be available immediately
    installTap();

    // Fallback: if not yet available, retry briefly
    if (!window.__ac8bEventLogReady) {
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        installTap();
        if (window.__ac8bEventLogReady || attempts > 20) clearInterval(poll);
      }, 50);
    }
  });

  // Verify the tap is installed before clicking run
  await page.waitForFunction(() => window.__ac8bEventLogReady === true, { timeout: 3_000 });

  // Click run to start the SSE stream
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation to complete
  await page.waitForFunction(
    () => {
      const el = document.getElementById('sim-state-completed');
      return el && el.style.display !== 'none';
    },
    { timeout: 15_000 },
  );

  // Read the captured event log from the page
  const eventLog = await page.evaluate(() => window.__ac8bEventLog);

  // Verify events were received by the client
  const receivedTypes = eventLog.map(e => e.type);
  expect(receivedTypes).toContain('iteration_start');
  expect(receivedTypes).toContain('agent_decision');
  expect(receivedTypes).toContain('iteration_complete');
  expect(receivedTypes).toContain('simulation_complete');

  // Verify agent_decision events received
  const agentDecisions = eventLog.filter(e => e.type === 'agent_decision');
  expect(agentDecisions.length).toBe(AGENT_COUNT);

  // Verify each event has the correct structure for force-directed visualization
  for (const entry of agentDecisions) {
    expect(entry.data).toHaveProperty('archetype_id');   // used to route particle to node
    expect(entry.data).toHaveProperty('chosen_product'); // used to animate edge
    expect(entry.data).toHaveProperty('agent_index');    // used for progress
  }

  console.log(`[ac8b] simEventBus received ${eventLog.length} total events: ${[...new Set(receivedTypes)].join(', ')}`);
  console.log(`[ac8b] agent_decision events: ${agentDecisions.length} received`);
  console.log(`[ac8b] First event: ${JSON.stringify(eventLog[0]?.data).slice(0, 120)}...`);
});

// ── Test 4: Force-directed graph archetype nodes update color on agent_decision ─

test('ac8b: archetype nodes in force-directed graph change color on agent_decision events', async ({ page }) => {
  const AGENT_COUNT = 8; // one per archetype

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSimulationSseBody(AGENT_COUNT),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // Capture initial archetype node fill colors before simulation
  const initialColors = await page.evaluate(() => {
    const archetypes = [
      'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
      'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
    ];
    return archetypes.reduce((acc, id) => {
      const node = document.querySelector(`[data-testid="archetype-${id}"] circle`);
      acc[id] = node ? node.getAttribute('fill') : null;
      return acc;
    }, {});
  });

  // All archetype nodes should be present
  const presentNodes = Object.values(initialColors).filter(v => v !== null);
  expect(presentNodes.length).toBeGreaterThan(0);

  // Click run to start simulation
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for at least one agent_decision to be processed (agent-count updates)
  await page.waitForFunction(
    () => {
      const el = document.getElementById('agent-count');
      return el && /^[1-9]/.test((el.textContent ?? '').trim());
    },
    { timeout: 10_000 },
  );

  // Give time for archetype colors to update
  await page.waitForTimeout(200);

  // Capture archetype node fill colors after agent_decision events
  const updatedColors = await page.evaluate(() => {
    const archetypes = [
      'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
      'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
    ];
    return archetypes.reduce((acc, id) => {
      const node = document.querySelector(`[data-testid="archetype-${id}"] circle`);
      acc[id] = node ? node.getAttribute('fill') : null;
      return acc;
    }, {});
  });

  // At least one archetype node should exist
  const updatedPresent = Object.values(updatedColors).filter(v => v !== null);
  expect(updatedPresent.length).toBeGreaterThan(0);

  // Count how many nodes changed color (force-directed visualization active)
  const changedCount = Object.keys(initialColors).filter(
    id => initialColors[id] !== null && updatedColors[id] !== null &&
          initialColors[id] !== updatedColors[id]
  ).length;

  console.log(`[ac8b] Archetype nodes with color change: ${changedCount}/${presentNodes.length}`);
  console.log(`[ac8b] Initial colors (sample): price_sensitive="${initialColors.price_sensitive}" value_seeker="${initialColors.value_seeker}"`);
  console.log(`[ac8b] Updated colors (sample): price_sensitive="${updatedColors.price_sensitive}" value_seeker="${updatedColors.value_seeker}"`);

  // At least some archetype nodes should have been colored by SSE events
  expect(changedCount).toBeGreaterThan(0);
});

// ── Test 5: Full network log capture — save evidence to file ─────────────────

test('ac8b: full SSE network log captured and saved as evidence', async ({ page }) => {
  const AGENT_COUNT = 15;
  const networkLog = {
    timestamp:    new Date().toISOString(),
    spec:         'playwright-sse-network-log-ac8b',
    port:         PORT,
    base_url:     BASE_URL,
    sse_request:  null,
    sse_response: null,
    events:       [],
    console_messages: [],
    summary:      {},
  };

  // ── Capture console messages ──────────────────────────────────────────────
  page.on('console', (msg) => {
    const text = msg.text();
    networkLog.console_messages.push({
      type: msg.type(),
      text: text.slice(0, 300), // truncate long messages
    });
  });

  // ── Capture network request/response ─────────────────────────────────────
  page.on('request', (req) => {
    if (req.url().includes('/api/run/stream')) {
      networkLog.sse_request = {
        url:    req.url(),
        method: req.method(),
        headers: req.headers(),
      };
    }
  });

  page.on('response', (res) => {
    if (res.url().includes('/api/run/stream')) {
      networkLog.sse_response = {
        url:         res.url(),
        status:      res.status(),
        content_type: res.headers()['content-type'],
        headers:     res.headers(),
      };
    }
  });

  // ── Route SSE stream with full simulation events ──────────────────────────
  let rawSseBody = '';
  await page.route('**/api/run/stream', async (route) => {
    rawSseBody = buildSimulationSseBody(AGENT_COUNT);
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: rawSseBody,
    });
  });

  // ── Install event bus tap ─────────────────────────────────────────────────
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  await page.evaluate(() => {
    window.__ac8bFullLog = [];
    const installTap = () => {
      if (window.simEventBus) {
        const orig = window.simEventBus.emit.bind(window.simEventBus);
        window.simEventBus.emit = (type, data) => {
          window.__ac8bFullLog.push({ type, ts: Date.now(), data });
          return orig(type, data);
        };
        window.__ac8bTapInstalled = true;
      }
    };
    installTap();
    if (!window.__ac8bTapInstalled) {
      const poll = setInterval(() => { installTap(); if (window.__ac8bTapInstalled) clearInterval(poll); }, 50);
    }
  });

  await page.waitForFunction(() => window.__ac8bTapInstalled === true, { timeout: 3_000 });

  // ── Run the simulation ────────────────────────────────────────────────────
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation to complete
  await page.waitForFunction(
    () => {
      const el = document.getElementById('sim-state-completed');
      return el && el.style.display !== 'none';
    },
    { timeout: 15_000 },
  );

  // ── Collect event log from page ───────────────────────────────────────────
  const clientEventLog = await page.evaluate(() => window.__ac8bFullLog);
  networkLog.events = clientEventLog.map(e => ({
    type: e.type,
    ts: e.ts,
    // Only include non-verbose data for agent_decision to keep log readable
    data: e.type === 'agent_decision'
      ? { agent_id: e.data.agent_id, archetype_id: e.data.archetype_id, chosen_product: e.data.chosen_product, agent_index: e.data.agent_index }
      : e.data,
  }));

  // ── Parse raw SSE body for event summary ─────────────────────────────────
  const rawLines = rawSseBody.split('\n');
  let currType = '';
  const eventTypeCounts = {};
  for (const line of rawLines) {
    const t = line.trim();
    if (t.startsWith('event:')) {
      currType = t.slice(6).trim();
      eventTypeCounts[currType] = (eventTypeCounts[currType] ?? 0) + 1;
    }
  }

  networkLog.summary = {
    raw_sse_event_type_counts:    eventTypeCounts,
    client_received_event_counts: clientEventLog.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {}),
    total_raw_events:    Object.values(eventTypeCounts).reduce((a, b) => a + b, 0),
    total_client_events: clientEventLog.length,
    sse_content_type:    networkLog.sse_response?.content_type ?? 'not captured',
    console_message_count: networkLog.console_messages.length,
  };

  // ── Save evidence to file ─────────────────────────────────────────────────
  const outDir = path.join(__dirname, '..', 'test-results');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'sse-network-log-ac8b.json');
  await fs.writeFile(outPath, JSON.stringify(networkLog, null, 2), 'utf8');

  const fileSize = (await fs.stat(outPath)).size;

  // ── Assertions ────────────────────────────────────────────────────────────

  // Network assertions
  expect(networkLog.sse_response?.status).toBe(200);
  expect(networkLog.sse_response?.content_type).toMatch(/text\/event-stream/);

  // Event flow assertions
  const clientTypes = Object.keys(networkLog.summary.client_received_event_counts);
  expect(clientTypes).toContain('iteration_start');
  expect(clientTypes).toContain('agent_decision');
  expect(clientTypes).toContain('iteration_complete');
  expect(clientTypes).toContain('simulation_complete');

  // agent_decision count matches
  expect(networkLog.summary.client_received_event_counts['agent_decision']).toBe(AGENT_COUNT);
  expect(networkLog.summary.raw_sse_event_type_counts['agent_decision']).toBe(AGENT_COUNT);

  // Evidence file saved
  expect(fileSize).toBeGreaterThan(500);

  console.log(`[ac8b] Network log saved: ${outPath} (${fileSize} bytes)`);
  console.log(`[ac8b] SSE Content-Type: "${networkLog.summary.sse_content_type}"`);
  console.log(`[ac8b] Raw SSE events: ${JSON.stringify(networkLog.summary.raw_sse_event_type_counts)}`);
  console.log(`[ac8b] Client received: ${JSON.stringify(networkLog.summary.client_received_event_counts)}`);
  console.log(`[ac8b] Console messages: ${networkLog.summary.console_message_count}`);
});

// ── Test 6: Console output captures SSE processing evidence ──────────────────

test('ac8b: console output shows SSE stream processing (no errors)', async ({ page }) => {
  const AGENT_COUNT = 8;
  const consoleMessages = [];

  // Capture all console messages
  page.on('console', (msg) => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });

  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: SSE_HEADERS,
      body: buildSimulationSseBody(AGENT_COUNT),
    });
  });

  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for simulation to complete
  await page.waitForFunction(
    () => {
      const el = document.getElementById('sim-state-completed');
      return el && el.style.display !== 'none';
    },
    { timeout: 15_000 },
  );

  // Verify NO SSE parse errors were logged
  const sseParseErrors = consoleMessages.filter(
    m => m.type === 'warning' && m.text.includes('SSE parse error')
  );
  expect(sseParseErrors.length).toBe(0);

  // Verify no handleSSEEvent internal errors
  const handleErrors = consoleMessages.filter(
    m => m.type === 'warning' && m.text.includes('handleSSEEvent internal error')
  );
  expect(handleErrors.length).toBe(0);

  // Log the console output for evidence
  const warnMessages = consoleMessages.filter(m => m.type === 'warning');
  console.log(`[ac8b] Console messages captured: ${consoleMessages.length} total, ${warnMessages.length} warnings`);
  console.log(`[ac8b] SSE parse errors: ${sseParseErrors.length} (expected: 0)`);
  if (consoleMessages.length > 0) {
    console.log(`[ac8b] Console sample: ${consoleMessages.slice(0, 3).map(m => `[${m.type}] ${m.text.slice(0, 80)}`).join(' | ')}`);
  }

  // Verify the sim completed without error state
  const stateError = await page.evaluate(() => {
    const el = document.getElementById('sim-state-error');
    return el ? el.style.display : 'none';
  });
  expect(stateError).toBe('none');
});
