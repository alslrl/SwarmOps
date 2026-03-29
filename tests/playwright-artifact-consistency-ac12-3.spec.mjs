/**
 * playwright-artifact-consistency-ac12-3.spec.mjs
 *
 * Sub-AC 12.3: Artifact data consistency verification
 *
 * Asserts that strategy_id, baseline_revenue, final_revenue, holdout_uplift,
 * and diff values are consistent across three data sources:
 *   1. API response — simulation_complete SSE event payload
 *   2. Artifact file — artifacts/latest-run-summary.json (written by engine)
 *   3. UI display — browser DOM after simulation completes
 *
 * Stores evidence under artifacts/ac12-3-consistency-evidence.json
 *
 * Port: 3118 (unique — no collision with other specs)
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(__dirname, '../artifacts');
const PORT = 3118;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server;
/** simulation_complete payload captured from the real engine mock run */
let capturedApiData = null;
/** Contents of latest-run-summary.json captured after the mock run */
let capturedFileData = null;

test.beforeAll(async () => {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
  process.env.SELLER_WAR_GAME_MODEL_MODE = 'mock';

  server = createServer();
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  // Run a real simulation (mock mode, 1 iteration) to:
  //   a) capture simulation_complete event data (== API response)
  //   b) trigger writeLatestRunSummary so artifacts/latest-run-summary.json is up-to-date
  capturedApiData = await runAndCaptureSimComplete({ port: PORT, iterationCount: 1 });

  // Read the artifact file that was just written by the engine
  const summaryPath = path.join(ARTIFACTS_DIR, 'latest-run-summary.json');
  const raw = await fs.readFile(summaryPath, 'utf8');
  capturedFileData = JSON.parse(raw);
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// ── Helper: run SSE simulation and capture simulation_complete event ──────────

/**
 * Makes an HTTP POST to /api/run/stream, reads the entire SSE stream, and
 * returns the parsed data from the first simulation_complete event found.
 */
async function runAndCaptureSimComplete({ port, iterationCount = 1 }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/run/stream',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      },
      (res) => {
        res.on('data', (chunk) => chunks.push(chunk.toString()));
        res.on('end', () => {
          const raw = chunks.join('');
          // Parse SSE blocks
          for (const block of raw.split(/\n\n+/)) {
            if (!block.trim()) continue;
            let type = 'message';
            let dataStr = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event: ')) type = line.slice(7).trim();
              else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
            }
            if (type === 'simulation_complete' && dataStr) {
              try {
                return resolve(JSON.parse(dataStr));
              } catch (e) {
                return reject(new Error(`Failed to parse simulation_complete data: ${e.message}`));
              }
            }
          }
          reject(new Error('simulation_complete event not found in SSE stream'));
        });
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify({ iterationCount }));
  });
}

// ── Helper: parse KRW formatted text back to integer ─────────────────────────

/**
 * Parse a KRW-formatted string (e.g. "₩5,651,100", "+₩548,900", "-₩37,000",
 * "₩28,900 (-3.3%)") back to an integer.
 *
 * Handles:
 *   - Leading sign: "+₩548,900" → 548900, "-₩37,000" → -37000
 *   - Trailing percentage suffix: "₩28,900 (-3.3%)" → 28900
 * Returns null if the text is a placeholder ("—") or unparseable.
 */
function parseKrwText(text) {
  if (!text || text === '—') return null;
  const trimmed = text.trim();

  // Determine sign from the leading character (+ or -) only
  const isNeg = trimmed.startsWith('-');

  // Extract the KRW amount: take only the initial ₩N,NNN part
  // (before any whitespace + percentage suffix like " (-3.3%)")
  const krwPart = trimmed.split(/\s/)[0];
  const digits = krwPart.replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return isNeg ? -n : n;
}

// ── Test 1: API response vs artifact file consistency ────────────────────────

test('AC12.3 — API simulation_complete matches latest-run-summary.json', async () => {
  expect(capturedApiData, 'simulation_complete event must have been captured').toBeTruthy();
  expect(capturedFileData, 'latest-run-summary.json must have been read').toBeTruthy();

  const api = capturedApiData;
  const file = capturedFileData;

  // strategy_id
  const apiStrategyId = api.artifact?.payload?.selected_strategy_id ?? api.selected_strategy?.id;
  expect(
    apiStrategyId,
    `API strategy_id must match file.selected_strategy_id.\n` +
    `  API:  ${apiStrategyId}\n` +
    `  File: ${file.selected_strategy_id}`,
  ).toBe(file.selected_strategy_id);

  // baseline_revenue
  const apiBaselineRevenue = api.baseline?.simulated_revenue;
  expect(
    apiBaselineRevenue,
    `API baseline_revenue must match file.baseline_revenue.\n` +
    `  API:  ${apiBaselineRevenue}\n` +
    `  File: ${file.baseline_revenue}`,
  ).toBe(file.baseline_revenue);

  // final_revenue
  const apiFinalRevenue = api.selected_strategy?.simulated_revenue;
  expect(
    apiFinalRevenue,
    `API final_revenue must match file.final_revenue.\n` +
    `  API:  ${apiFinalRevenue}\n` +
    `  File: ${file.final_revenue}`,
  ).toBe(file.final_revenue);

  // holdout_uplift
  const apiHoldoutUplift = api.holdout?.holdout_uplift;
  expect(
    apiHoldoutUplift,
    `API holdout_uplift must match file.holdout_uplift.\n` +
    `  API:  ${apiHoldoutUplift}\n` +
    `  File: ${file.holdout_uplift}`,
  ).toBe(file.holdout_uplift);

  // diff.title
  expect(api.diff?.title?.before).toBe(file.diff?.title?.before);
  expect(api.diff?.title?.after).toBe(file.diff?.title?.after);

  // diff.top_copy
  expect(api.diff?.top_copy?.before).toBe(file.diff?.top_copy?.before);
  expect(api.diff?.top_copy?.after).toBe(file.diff?.top_copy?.after);

  // diff.price
  expect(api.diff?.price?.before).toBe(file.diff?.price?.before);
  expect(api.diff?.price?.after).toBe(file.diff?.price?.after);
});

// ── Test 2: UI display vs API + artifact file consistency ─────────────────────

test('AC12.3 — UI display matches API simulation_complete and artifact file', async ({ page }) => {
  expect(capturedApiData, 'simulation_complete event must be available for UI replay').toBeTruthy();

  // Build a minimal SSE stream that replays the captured simulation_complete event
  const mockSseBody =
    `event: simulation_complete\n` +
    `data: ${JSON.stringify(capturedApiData)}\n\n`;

  // Intercept SSE endpoint to inject the captured payload (identical to what engine wrote)
  await page.route('**/api/run/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
      body: mockSseBody,
    });
  });

  // Navigate and wait for fixtures
  await page.goto(BASE_URL);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="product-name"]')?.textContent?.trim().length > 0,
    { timeout: 10_000 },
  );

  // Click run to trigger SSE injection
  await page.locator('[data-testid="btn-run"]').click();

  // Wait for completed state to appear
  await page.waitForSelector('[data-testid="state-completed"]', {
    state: 'visible',
    timeout: 15_000,
  });

  // Wait for metric-baseline to be populated (non-placeholder)
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="metric-baseline"]');
      return el && el.textContent !== '—' && el.textContent.trim().length > 1;
    },
    { timeout: 10_000 },
  );

  // ── Extract UI values ─────────────────────────────────────────────────────

  const uiValues = await page.evaluate(() => {
    const get = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
    const getId = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
    return {
      metric_baseline:    get('[data-testid="metric-baseline"]'),
      metric_final:       get('[data-testid="metric-final"]'),
      metric_holdout:     get('[data-testid="metric-holdout"]'),
      strategy_id:        getId('artifact-strategy-id'),
      diff_title_before:  getId('diff-title-before'),
      diff_title_after:   getId('diff-title-after'),
      diff_copy_before:   getId('diff-copy-before'),
      diff_copy_after:    getId('diff-copy-after'),
      diff_price_before:  getId('diff-price-before'),
      diff_price_after:   getId('diff-price-after'),
    };
  });

  const api = capturedApiData;
  const file = capturedFileData;

  // ── strategy_id ────────────────────────────────────────────────────────────
  const expectedStrategyId = api.artifact?.payload?.selected_strategy_id ?? api.selected_strategy?.id;
  expect(
    uiValues.strategy_id,
    `UI strategy_id "${uiValues.strategy_id}" must match API/file "${expectedStrategyId}"`,
  ).toBe(expectedStrategyId);

  // ── baseline_revenue ───────────────────────────────────────────────────────
  const uiBaseline = parseKrwText(uiValues.metric_baseline);
  expect(
    uiBaseline,
    `UI baseline_revenue ${uiBaseline} must match API ${api.baseline?.simulated_revenue}`,
  ).toBe(api.baseline?.simulated_revenue);

  // ── final_revenue ──────────────────────────────────────────────────────────
  const uiFinal = parseKrwText(uiValues.metric_final);
  expect(
    uiFinal,
    `UI final_revenue ${uiFinal} must match API ${api.selected_strategy?.simulated_revenue}`,
  ).toBe(api.selected_strategy?.simulated_revenue);

  // ── holdout_uplift ─────────────────────────────────────────────────────────
  const uiHoldout = parseKrwText(uiValues.metric_holdout);
  expect(
    uiHoldout,
    `UI holdout_uplift ${uiHoldout} must match API ${api.holdout?.holdout_uplift}`,
  ).toBe(api.holdout?.holdout_uplift);

  // ── diff.title ─────────────────────────────────────────────────────────────
  expect(
    uiValues.diff_title_before,
    `UI diff_title_before must match API value`,
  ).toBe(api.diff?.title?.before ?? '—');

  // diff-title-after may show "변경 없음" if before === after; check only when changed
  if (api.diff?.title?.before !== api.diff?.title?.after) {
    expect(
      uiValues.diff_title_after,
      `UI diff_title_after must match API value when changed`,
    ).toBe(api.diff?.title?.after ?? '—');
  }

  // ── diff.top_copy ──────────────────────────────────────────────────────────
  expect(
    uiValues.diff_copy_before,
    `UI diff_copy_before must match API value`,
  ).toBe(api.diff?.top_copy?.before ?? '—');

  if (api.diff?.top_copy?.before !== api.diff?.top_copy?.after) {
    expect(
      uiValues.diff_copy_after,
      `UI diff_copy_after must match API value when changed`,
    ).toBe(api.diff?.top_copy?.after ?? '—');
  }

  // ── diff.price ─────────────────────────────────────────────────────────────
  const uiPriceBefore = parseKrwText(uiValues.diff_price_before);
  expect(
    uiPriceBefore,
    `UI diff_price_before ${uiPriceBefore} must match API ${api.diff?.price?.before}`,
  ).toBe(api.diff?.price?.before ?? null);

  // Note: diff_price_after may include a percentage suffix e.g. "₩28,900 (-3.3%)"
  // We verify the KRW prefix matches; parseKrwText strips the percentage portion.
  if (api.diff?.price?.before !== api.diff?.price?.after) {
    const uiPriceAfter = parseKrwText(uiValues.diff_price_after);
    expect(
      uiPriceAfter,
      `UI diff_price_after (parsed) ${uiPriceAfter} must match API ${api.diff?.price?.after}`,
    ).toBe(api.diff?.price?.after ?? null);
  }

  // ── Triple-source summary assertion ───────────────────────────────────────
  // Verify UI, API, and file all agree on the 5 key fields
  expect(uiValues.strategy_id).toBe(file.selected_strategy_id);
  expect(uiBaseline).toBe(file.baseline_revenue);
  expect(uiFinal).toBe(file.final_revenue);
  expect(uiHoldout).toBe(file.holdout_uplift);
  expect(api.diff?.price?.before).toBe(file.diff?.price?.before);
});

// ── Test 3: Write evidence bundle ─────────────────────────────────────────────

test('AC12.3 — Write consistency evidence to artifacts/', async () => {
  expect(capturedApiData).toBeTruthy();
  expect(capturedFileData).toBeTruthy();

  const api = capturedApiData;
  const file = capturedFileData;

  const apiStrategyId = api.artifact?.payload?.selected_strategy_id ?? api.selected_strategy?.id;

  const evidence = {
    ac: 'AC12',
    sub_ac: 'Sub-AC 12.3',
    description: 'Artifact data consistency verification across UI, API, and file',
    generated_at: new Date().toISOString(),
    fields_checked: ['strategy_id', 'baseline_revenue', 'final_revenue', 'holdout_uplift', 'diff'],
    api_response: {
      source: `POST /api/run/stream → simulation_complete event`,
      strategy_id: apiStrategyId,
      baseline_revenue: api.baseline?.simulated_revenue,
      final_revenue: api.selected_strategy?.simulated_revenue,
      holdout_uplift: api.holdout?.holdout_uplift,
      diff: api.diff,
    },
    artifact_file: {
      source: 'artifacts/latest-run-summary.json',
      strategy_id: file.selected_strategy_id,
      baseline_revenue: file.baseline_revenue,
      final_revenue: file.final_revenue,
      holdout_uplift: file.holdout_uplift,
      diff: file.diff,
    },
    consistency_checks: {
      strategy_id_match:        apiStrategyId === file.selected_strategy_id,
      baseline_revenue_match:   api.baseline?.simulated_revenue === file.baseline_revenue,
      final_revenue_match:      api.selected_strategy?.simulated_revenue === file.final_revenue,
      holdout_uplift_match:     api.holdout?.holdout_uplift === file.holdout_uplift,
      diff_title_before_match:  api.diff?.title?.before === file.diff?.title?.before,
      diff_title_after_match:   api.diff?.title?.after === file.diff?.title?.after,
      diff_copy_before_match:   api.diff?.top_copy?.before === file.diff?.top_copy?.before,
      diff_copy_after_match:    api.diff?.top_copy?.after === file.diff?.top_copy?.after,
      diff_price_before_match:  api.diff?.price?.before === file.diff?.price?.before,
      diff_price_after_match:   api.diff?.price?.after === file.diff?.price?.after,
    },
    verdict: 'PASS',
  };

  // Compute overall verdict
  const allMatch = Object.values(evidence.consistency_checks).every(Boolean);
  evidence.verdict = allMatch ? 'PASS' : 'FAIL';

  const evidencePath = path.join(ARTIFACTS_DIR, 'ac12-3-consistency-evidence.json');
  await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2));

  console.log(`\n✅ AC12.3 consistency evidence written to: artifacts/ac12-3-consistency-evidence.json`);
  console.log(`   Verdict: ${evidence.verdict}`);
  console.log(`   strategy_id match:      ${evidence.consistency_checks.strategy_id_match}`);
  console.log(`   baseline_revenue match: ${evidence.consistency_checks.baseline_revenue_match}`);
  console.log(`   final_revenue match:    ${evidence.consistency_checks.final_revenue_match}`);
  console.log(`   holdout_uplift match:   ${evidence.consistency_checks.holdout_uplift_match}`);
  console.log(`   diff.price.before:      ${evidence.consistency_checks.diff_price_before_match}`);
  console.log(`   diff.price.after:       ${evidence.consistency_checks.diff_price_after_match}`);

  expect(allMatch, `Not all consistency checks passed: ${JSON.stringify(evidence.consistency_checks)}`).toBe(true);
  expect(evidence.verdict).toBe('PASS');
});
