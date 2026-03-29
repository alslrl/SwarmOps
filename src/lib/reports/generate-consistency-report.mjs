/**
 * generate-consistency-report.mjs
 *
 * Sub-AC 8c: Artifact consistency check.
 *
 * Validates that all expected artifacts exist, are non-empty, and reference
 * consistent run IDs. Writes a summary report to artifacts/consistency_report.json.
 *
 * Artifact categories validated:
 *  1. Screenshots (9 files) — existence, file size, naming convention
 *  2. visual_checks.json   — existence, schema, verdict
 *  3. SSE event log        — validated via in-process SSE stream run
 *  4. Revenue chart data   — validated via iteration_complete event payloads
 *  5. Run ID consistency   — generated_at timestamps across artifact files
 *
 * Run standalone:  node src/lib/reports/generate-consistency-report.mjs
 * Import:          import { generateConsistencyReport } from '...'
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');
const SCREENSHOTS_DIR = path.join(ARTIFACTS_DIR, 'screenshots');
const REPORT_PATH = path.join(ARTIFACTS_DIR, 'consistency_report.json');

// ── Expected artifacts ────────────────────────────────────────────────────────

const EXPECTED_SCREENSHOTS = [
  '01-initial-load.png',
  '02-simulation-running.png',
  '02b-loading-particles-midflight.png',
  '03-results-populated.png',
  '04-error-state.png',
  '05-agent-profile-popup.png',
  'ac4d-01-mid-flow-sim-canvas.png',
  'ac4d-02-mid-flow-full-page.png',
  'ac4d-03-canvas-pixel-check.png',
];

/** Naming convention: NN[b]-kebab-case.png or ac4d-NN-kebab-case.png */
const SCREENSHOT_NAME_PATTERN = /^(?:[0-9]{2}[a-z]?|ac[0-9]+[a-z]?-[0-9]+)-[a-z0-9-]+\.png$/;

const VALID_CHOICES = new Set(['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']);

// ── SSE helper ────────────────────────────────────────────────────────────────

/**
 * Parse raw SSE text into an array of { type, data } objects.
 */
function parseSseEvents(raw) {
  const events = [];
  const blocks = raw.split(/\n\n+/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    let eventType = 'message';
    let dataLine = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) eventType = line.slice(7).trim();
      else if (line.startsWith('data: ')) dataLine = line.slice(6).trim();
    }
    if (dataLine) {
      try {
        events.push({ type: eventType, data: JSON.parse(dataLine) });
      } catch {
        // ignore malformed data lines
      }
    }
  }
  return events;
}

/**
 * Start the server, run a single SSE simulation, collect all events, stop server.
 * @returns {Promise<Array<{type: string, data: object}>>}
 */
async function runSseCapture() {
  const server = createServer({ modelMode: 'mock' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

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
          server.close();
          resolve(parseSseEvents(chunks.join('')));
        });
      },
    );
    req.on('error', (err) => {
      server.close();
      reject(err);
    });
    req.end(JSON.stringify({ iterationCount: 1 }));
  });
}

// ── File helpers ──────────────────────────────────────────────────────────────

async function statFile(filePath) {
  try {
    const s = await fs.stat(filePath);
    return { exists: true, size_bytes: s.size, mtime: s.mtime.toISOString() };
  } catch {
    return { exists: false, size_bytes: 0, mtime: null };
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ── Report builder ────────────────────────────────────────────────────────────

export async function generateConsistencyReport() {
  const report = {
    generated_at: new Date().toISOString(),
    sub_ac: '8c',
    description:
      'Artifact consistency check: screenshots, visual_checks.json, SSE event log, revenue chart data, run ID consistency.',
    checks: [],
    sse_event_log: null,
    revenue_chart_data: null,
    summary: { total: 0, passed: 0, warned: 0, failed: 0 },
    verdict: 'PASS',
  };

  function addCheck(id, description, status, details = {}) {
    report.checks.push({ id, description, status, details });
    report.summary.total++;
    if (status === 'PASS') report.summary.passed++;
    else if (status === 'WARN') report.summary.warned++;
    else {
      report.summary.failed++;
      report.verdict = 'FAIL';
    }
  }

  // ── 1. Screenshots ────────────────────────────────────────────────────────

  for (const name of EXPECTED_SCREENSHOTS) {
    const filePath = path.join(SCREENSHOTS_DIR, name);
    const stat = await statFile(filePath);
    if (stat.exists && stat.size_bytes > 0) {
      addCheck(
        `screenshot_exists_${name}`,
        `Screenshot ${name} exists and is non-empty`,
        'PASS',
        { file: `artifacts/screenshots/${name}`, size_bytes: stat.size_bytes, mtime: stat.mtime },
      );
    } else if (stat.exists) {
      addCheck(
        `screenshot_exists_${name}`,
        `Screenshot ${name} exists but has zero size`,
        'FAIL',
        { file: `artifacts/screenshots/${name}`, size_bytes: 0 },
      );
    } else {
      addCheck(
        `screenshot_exists_${name}`,
        `Screenshot ${name} is missing`,
        'FAIL',
        { file: `artifacts/screenshots/${name}`, error: 'ENOENT' },
      );
    }
  }

  // Screenshot count
  let allPngs = [];
  try {
    const entries = await fs.readdir(SCREENSHOTS_DIR);
    allPngs = entries.filter((f) => f.endsWith('.png')).sort();
    addCheck(
      'screenshot_count',
      `Exactly ${EXPECTED_SCREENSHOTS.length} screenshots present`,
      allPngs.length === EXPECTED_SCREENSHOTS.length ? 'PASS' : 'WARN',
      { expected: EXPECTED_SCREENSHOTS.length, actual: allPngs.length, files: allPngs },
    );
  } catch {
    addCheck('screenshot_count', 'Cannot read screenshots directory', 'FAIL', {});
  }

  // Naming convention
  const namingViolations = allPngs.filter((f) => !SCREENSHOT_NAME_PATTERN.test(f));
  addCheck(
    'screenshot_naming',
    'All screenshots follow naming convention (NN[b]-kebab.png or acNNd-NN-kebab.png)',
    namingViolations.length === 0 ? 'PASS' : 'WARN',
    { pattern: SCREENSHOT_NAME_PATTERN.toString(), violations: namingViolations },
  );

  // ── 2. visual_checks.json ─────────────────────────────────────────────────

  const vcPath = path.join(ARTIFACTS_DIR, 'visual_checks.json');
  const vcStat = await statFile(vcPath);
  const vcJson = await readJson(vcPath);

  addCheck(
    'visual_checks_exists',
    'visual_checks.json exists and is non-empty',
    vcStat.exists && vcStat.size_bytes > 0 ? 'PASS' : 'FAIL',
    { file: 'artifacts/visual_checks.json', size_bytes: vcStat.size_bytes },
  );

  if (vcJson) {
    const requiredVcFields = ['generated_at', 'summary', 'verifiers', 'verdict'];
    const missingVcFields = requiredVcFields.filter((f) => !(f in vcJson));
    addCheck(
      'visual_checks_schema',
      'visual_checks.json has required fields (generated_at, summary, verifiers, verdict)',
      missingVcFields.length === 0 ? 'PASS' : 'FAIL',
      { missing_fields: missingVcFields, verdict: vcJson.verdict },
    );

    addCheck(
      'visual_checks_verdict',
      'visual_checks.json verdict is PASS',
      vcJson.verdict === 'PASS' ? 'PASS' : 'WARN',
      { verdict: vcJson.verdict },
    );

    const failedVerifiers = (vcJson.verifiers ?? []).filter((v) => v.overall === 'FAIL');
    addCheck(
      'visual_checks_no_failures',
      'visual_checks.json has no failed verifiers',
      failedVerifiers.length === 0 ? 'PASS' : 'FAIL',
      { failed_verifiers: failedVerifiers.map((v) => v.verifier) },
    );
  } else {
    addCheck('visual_checks_schema', 'visual_checks.json is not valid JSON', 'FAIL', {});
  }

  // ── 2b. visual_judgment_report.json ───────────────────────────────────────

  const vjrPath = path.join(ARTIFACTS_DIR, 'visual_judgment_report.json');
  const vjrJson = await readJson(vjrPath);
  const vjrStat = await statFile(vjrPath);

  addCheck(
    'visual_judgment_report_exists',
    'visual_judgment_report.json exists and is non-empty',
    vjrStat.exists && vjrStat.size_bytes > 0 ? 'PASS' : 'FAIL',
    { file: 'artifacts/visual_judgment_report.json', size_bytes: vjrStat.size_bytes },
  );

  if (vjrJson) {
    addCheck(
      'visual_judgment_report_verdict',
      'visual_judgment_report.json verdict is PASS',
      vjrJson.verdict === 'PASS' ? 'PASS' : 'WARN',
      { verdict: vjrJson.verdict, summary: vjrJson.summary },
    );
  }

  // ── 2c. latest-run-summary.json ───────────────────────────────────────────

  const summaryPath = path.join(ARTIFACTS_DIR, 'latest-run-summary.json');
  const summaryJson = await readJson(summaryPath);
  const summaryStat = await statFile(summaryPath);

  addCheck(
    'run_summary_exists',
    'latest-run-summary.json exists and is non-empty',
    summaryStat.exists && summaryStat.size_bytes > 0 ? 'PASS' : 'FAIL',
    { file: 'artifacts/latest-run-summary.json', size_bytes: summaryStat.size_bytes },
  );

  if (summaryJson) {
    const requiredSummaryFields = ['generated_at', 'sampler_seed', 'selected_strategy_id', 'holdout_uplift', 'diff'];
    const missingSummaryFields = requiredSummaryFields.filter((f) => !(f in summaryJson));
    addCheck(
      'run_summary_schema',
      'latest-run-summary.json has required fields',
      missingSummaryFields.length === 0 ? 'PASS' : 'FAIL',
      { missing_fields: missingSummaryFields, selected_strategy_id: summaryJson.selected_strategy_id },
    );

    const hasDiff =
      summaryJson.diff &&
      'title' in summaryJson.diff &&
      'top_copy' in summaryJson.diff &&
      'price' in summaryJson.diff;
    addCheck(
      'run_summary_diff_shape',
      'latest-run-summary.json diff has title/top_copy/price keys',
      hasDiff ? 'PASS' : 'FAIL',
      { diff_keys: summaryJson.diff ? Object.keys(summaryJson.diff) : [] },
    );

    const priceOk =
      Number.isInteger(summaryJson.diff?.price?.before) &&
      Number.isInteger(summaryJson.diff?.price?.after) &&
      summaryJson.diff?.price?.before > 0 &&
      summaryJson.diff?.price?.after > 0;
    addCheck(
      'run_summary_krw_integers',
      'latest-run-summary.json price values are positive KRW integers',
      priceOk ? 'PASS' : 'FAIL',
      {
        price_before: summaryJson.diff?.price?.before,
        price_after: summaryJson.diff?.price?.after,
        are_positive_integers: priceOk,
      },
    );
  }

  // ── 3. SSE event log validation ───────────────────────────────────────────

  let sseEvents = [];
  let sseError = null;
  try {
    sseEvents = await runSseCapture();
  } catch (err) {
    sseError = err.message;
  }

  if (sseError) {
    addCheck(
      'sse_event_log_reachable',
      'SSE /api/run/stream endpoint is reachable and streams events',
      'FAIL',
      { error: sseError },
    );
  } else {
    const eventTypes = sseEvents.map((e) => e.type);
    const agentDecisionEvents = sseEvents.filter((e) => e.type === 'agent_decision');
    const iterationStartEvents = sseEvents.filter((e) => e.type === 'iteration_start');
    const iterationCompleteEvents = sseEvents.filter((e) => e.type === 'iteration_complete');
    const simulationCompleteEvents = sseEvents.filter((e) => e.type === 'simulation_complete');

    // Exactly 800 agent_decision events
    addCheck(
      'sse_agent_decision_count',
      'SSE stream emits exactly 800 agent_decision events per iteration',
      agentDecisionEvents.length === 800 ? 'PASS' : 'FAIL',
      { expected: 800, actual: agentDecisionEvents.length },
    );

    // iteration_start/complete pair
    addCheck(
      'sse_iteration_events',
      'SSE stream emits exactly 1 iteration_start and 1 iteration_complete event',
      iterationStartEvents.length === 1 && iterationCompleteEvents.length === 1 ? 'PASS' : 'FAIL',
      {
        iteration_start_count: iterationStartEvents.length,
        iteration_complete_count: iterationCompleteEvents.length,
      },
    );

    // simulation_complete is the final event
    addCheck(
      'sse_simulation_complete',
      'SSE stream ends with exactly 1 simulation_complete event',
      simulationCompleteEvents.length === 1 ? 'PASS' : 'FAIL',
      { simulation_complete_count: simulationCompleteEvents.length },
    );

    // All agent_decision events have valid agent_id, archetype_id, chosen_product
    const invalidAgents = agentDecisionEvents.filter(
      (e) =>
        !e.data.agent_id ||
        !e.data.archetype_id ||
        !VALID_CHOICES.has(e.data.chosen_product),
    );
    addCheck(
      'sse_agent_decision_schema',
      'All agent_decision events have valid agent_id, archetype_id, chosen_product',
      invalidAgents.length === 0 ? 'PASS' : 'FAIL',
      { invalid_count: invalidAgents.length, sample_invalid: invalidAgents.slice(0, 3).map((e) => e.data) },
    );

    // iteration_complete has archetype_breakdown in correct FLAT format
    const iterComplete = iterationCompleteEvents[0]?.data ?? {};
    const hasArchetypeBreakdown =
      iterComplete.archetype_breakdown &&
      typeof iterComplete.archetype_breakdown === 'object';
    let archetypeBreakdownValid = false;
    if (hasArchetypeBreakdown) {
      archetypeBreakdownValid = Object.values(iterComplete.archetype_breakdown).every(
        (v) =>
          typeof v === 'object' &&
          'our_product' in v &&
          'competitor_a' in v &&
          'competitor_b' in v &&
          'competitor_c' in v &&
          'pass' in v,
      );
    }
    addCheck(
      'sse_archetype_breakdown_format',
      'iteration_complete.archetype_breakdown is in FLAT format { [archetypeId]: { our_product, competitor_a, ... } }',
      archetypeBreakdownValid ? 'PASS' : 'FAIL',
      {
        has_archetype_breakdown: hasArchetypeBreakdown,
        flat_format_valid: archetypeBreakdownValid,
        archetype_keys: hasArchetypeBreakdown ? Object.keys(iterComplete.archetype_breakdown) : [],
      },
    );

    // choice_summary sums to 800
    const cs = iterComplete.choice_summary ?? {};
    const csTotal = Object.values(cs).reduce((s, v) => s + (Number(v) || 0), 0);
    addCheck(
      'sse_choice_summary_total',
      'iteration_complete.choice_summary sums to exactly 800 (total agents)',
      csTotal === 800 ? 'PASS' : 'FAIL',
      { expected_total: 800, actual_total: csTotal, choice_summary: cs },
    );

    // Store SSE event log summary for embedding in report
    report.sse_event_log = {
      validated_at: new Date().toISOString(),
      source: 'in-process SSE run (mock mode, iteration_count=1)',
      total_events: sseEvents.length,
      event_type_counts: eventTypes.reduce((acc, t) => {
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {}),
      agent_decision_sample: agentDecisionEvents.slice(0, 3).map((e) => ({
        agent_id: e.data.agent_id,
        archetype_id: e.data.archetype_id,
        chosen_product: e.data.chosen_product,
        agent_index: e.data.agent_index,
      })),
      iteration_complete_summary: {
        winner_id: iterComplete.winner_id,
        winner_revenue: iterComplete.winner_revenue,
        accepted: iterComplete.accepted,
        choice_summary: iterComplete.choice_summary,
        archetype_breakdown_keys: iterComplete.archetype_breakdown
          ? Object.keys(iterComplete.archetype_breakdown)
          : [],
      },
    };

    // ── 4. Revenue chart data validation ─────────────────────────────────────

    const revenueDataPoints = iterationCompleteEvents.map((e, i) => ({
      iteration: e.data.iteration ?? i + 1,
      winner_id: e.data.winner_id,
      winner_revenue: e.data.winner_revenue,
      accepted: e.data.accepted,
      archetype_breakdown_keys: e.data.archetype_breakdown
        ? Object.keys(e.data.archetype_breakdown)
        : [],
      choice_summary: e.data.choice_summary,
    }));

    addCheck(
      'revenue_chart_data_present',
      'Revenue chart data (winner_revenue per iteration) is present in iteration_complete events',
      revenueDataPoints.length > 0 && revenueDataPoints.every((p) => typeof p.winner_revenue === 'number')
        ? 'PASS'
        : 'FAIL',
      {
        iteration_count: revenueDataPoints.length,
        revenue_values: revenueDataPoints.map((p) => p.winner_revenue),
      },
    );

    addCheck(
      'revenue_chart_data_krw_integers',
      'Revenue chart winner_revenue values are positive KRW integers',
      revenueDataPoints.every((p) => Number.isInteger(p.winner_revenue) && p.winner_revenue > 0)
        ? 'PASS'
        : 'FAIL',
      { revenue_values: revenueDataPoints.map((p) => p.winner_revenue) },
    );

    addCheck(
      'revenue_chart_archetype_breakdown',
      'Revenue chart data includes archetype_breakdown for insights panel rendering',
      revenueDataPoints.every((p) => p.archetype_breakdown_keys.length > 0) ? 'PASS' : 'FAIL',
      { archetype_breakdown_keys_per_iteration: revenueDataPoints.map((p) => p.archetype_breakdown_keys) },
    );

    report.revenue_chart_data = {
      validated_at: new Date().toISOString(),
      source: 'iteration_complete events from in-process SSE run (mock mode)',
      iteration_count: revenueDataPoints.length,
      data_points: revenueDataPoints,
    };
  }

  // ── 5. Run ID / timestamp consistency ────────────────────────────────────

  // Collect all generated_at timestamps from artifact JSON files
  const artifactTimestamps = {};

  const filesToCheck = [
    { label: 'latest-run-summary.json', json: summaryJson },
    { label: 'visual_checks.json', json: vcJson },
    { label: 'visual_judgment_report.json', json: vjrJson },
  ];

  for (const { label, json } of filesToCheck) {
    if (json?.generated_at) {
      artifactTimestamps[label] = json.generated_at;
    }
  }

  const timestamps = Object.values(artifactTimestamps).filter(Boolean);
  let timestampConsistency = 'PASS';
  let timestampDetails = {
    timestamps: artifactTimestamps,
    max_drift_seconds: null,
    note: '',
  };

  if (timestamps.length >= 2) {
    const msValues = timestamps.map((t) => new Date(t).getTime());
    const minMs = Math.min(...msValues);
    const maxMs = Math.max(...msValues);
    const driftSeconds = (maxMs - minMs) / 1000;
    timestampDetails.max_drift_seconds = driftSeconds;

    if (driftSeconds > 3600) {
      timestampConsistency = 'WARN';
      timestampDetails.note = `Artifact timestamps span ${driftSeconds.toFixed(0)}s — artifacts may be from different runs.`;
    } else {
      timestampDetails.note = `All artifact timestamps within ${driftSeconds.toFixed(0)}s of each other — consistent run context.`;
    }
  } else {
    timestampDetails.note = 'Not enough timestamps to compare consistency.';
  }

  addCheck(
    'run_id_consistency',
    'Artifact generated_at timestamps are consistent (within 1 hour)',
    timestampConsistency,
    timestampDetails,
  );

  // Screenshots captured in same generation session
  const screenshotMtimes = await Promise.all(
    EXPECTED_SCREENSHOTS.map(async (name) => {
      const s = await statFile(path.join(SCREENSHOTS_DIR, name));
      return s.mtime ? new Date(s.mtime).getTime() : null;
    }),
  );
  const validMtimes = screenshotMtimes.filter(Boolean);
  if (validMtimes.length >= 2) {
    const mtimeRangeMs = Math.max(...validMtimes) - Math.min(...validMtimes);
    const mtimeRangeSec = mtimeRangeMs / 1000;
    addCheck(
      'screenshot_capture_session',
      'All screenshots were captured within a consistent session (mtime range < 5 min)',
      mtimeRangeSec < 300 ? 'PASS' : 'WARN',
      {
        mtime_range_seconds: mtimeRangeSec,
        oldest: new Date(Math.min(...validMtimes)).toISOString(),
        newest: new Date(Math.max(...validMtimes)).toISOString(),
      },
    );
  }

  // ── 6. evidence_bundle.json presence ─────────────────────────────────────

  const bundleStat = await statFile(path.join(ARTIFACTS_DIR, 'evidence_bundle.json'));
  addCheck(
    'evidence_bundle_exists',
    'evidence_bundle.json exists and is non-empty',
    bundleStat.exists && bundleStat.size_bytes > 0 ? 'PASS' : 'WARN',
    { file: 'artifacts/evidence_bundle.json', size_bytes: bundleStat.size_bytes },
  );

  // ── Write report ──────────────────────────────────────────────────────────

  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));

  return report;
}

// ── Run as standalone script ──────────────────────────────────────────────────

const isMain =
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith(path.basename(process.argv[1])));

if (isMain) {
  const report = await generateConsistencyReport();
  console.log(`\nArtifact Consistency Report — ${report.verdict}`);
  console.log(
    `  PASS: ${report.summary.passed}  WARN: ${report.summary.warned}  FAIL: ${report.summary.failed}  (total: ${report.summary.total})`,
  );
  for (const c of report.checks) {
    const icon = c.status === 'PASS' ? '✅' : c.status === 'WARN' ? '⚠️' : '❌';
    console.log(`  ${icon} [${c.id}] ${c.description}`);
  }
  if (report.sse_event_log) {
    console.log(`\n  SSE Event Log:`);
    console.log(`    Total events: ${report.sse_event_log.total_events}`);
    console.log(`    Event type counts: ${JSON.stringify(report.sse_event_log.event_type_counts)}`);
  }
  if (report.revenue_chart_data) {
    console.log(`\n  Revenue Chart Data:`);
    console.log(`    Iterations captured: ${report.revenue_chart_data.iteration_count}`);
    console.log(`    Revenue values: ${report.revenue_chart_data.data_points.map((p) => p.winner_revenue).join(', ')}`);
  }
  console.log(`\nReport written to: artifacts/consistency_report.json`);
  process.exit(report.verdict === 'FAIL' ? 1 : 0);
}
