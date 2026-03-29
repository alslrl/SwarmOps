/**
 * artifact-consistency.test.mjs
 *
 * Sub-AC 8c: Artifact consistency check and evidence bundle consolidation.
 *
 * Verifies:
 *   1. verifyArtifacts() runs without error and returns PASS verdict
 *   2. artifact-consistency-report.json is written with expected shape
 *   3. All 6 screenshots exist with non-zero file sizes
 *   4. Screenshot filenames follow NN[b]-kebab-case.png naming convention
 *   5. visual-judgment-report.md references all 4 core screenshots
 *   6. visual_judgment_report.json is valid (required fields, 7 check types)
 *   7. latest-run-summary.json is valid (schema, diff shape, KRW integers)
 *   8. generateEvidenceBundle() writes evidence_bundle.json with all fields
 *   9. evidence_bundle.json overall_verdict === 'PASS'
 *  10. evidence_bundle.json covers all 11 sub-AC coverage items
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyArtifacts } from '../src/lib/reports/verify-artifacts.mjs';
import { generateEvidenceBundle } from '../src/lib/reports/generate-evidence-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(ROOT, 'artifacts');
const SCREENSHOTS = path.join(ARTIFACTS, 'screenshots');

const EXPECTED_SCREENSHOTS = [
  '01-initial-load.png',
  '02-simulation-running.png',
  '02b-loading-particles-midflight.png',
  '03-results-populated.png',
  '04-error-state.png',
  '05-agent-profile-popup.png',
  // Sub-AC 4d: individual-agent SSE mid-flow verification screenshots
  'ac4d-01-mid-flow-sim-canvas.png',
  'ac4d-02-mid-flow-full-page.png',
  'ac4d-03-canvas-pixel-check.png',
  // Sub-AC 4d extra: archetype summary table during loading state
  'ac4d-04-archetype-table-loading-state.png',
  'ac4d-05-sim-panel-with-archetype-table.png',
  // Sub-AC 6c: product bucket zones + right-side canvas overlay
  'ac6c-01-bucket-zones-completed.png',
  'ac6c-02-full-page-completed.png',
  // Sub-AC 6d: post-simulation frozen state screenshots
  'ac6d-01-sim-panel-frozen-state.png',
  'ac6d-02-full-page-completed-state.png',
  // Sub-AC 10.2: insights panel and completed state screenshots
  'ac10-2-full-completed-state.png',
  'ac10-2-insights-panel.png',
  // Sub-AC 11c: Playwright E2E 4 UI state screenshots (canonical AC8 evidence names)
  'empty_state_desktop.png',
  'loading_state_desktop.png',
  'completed_state_desktop.png',
  'error_state_desktop.png',
];

// Matches:  NN[b]-kebab-case.png     (legacy format: 01-initial-load.png, 02b-loading-particles-midflight.png)
//           ac4d-NN-kebab-case.png   (Sub-AC 4d format: ac4d-01-mid-flow-sim-canvas.png)
//           ac10-NN-kebab-case.png   (Sub-AC 10.x format: ac10-2-full-completed-state.png)
//           word_state_desktop.png   (AC8 canonical names: empty_state_desktop.png, etc.)
const SCREENSHOT_NAME_PATTERN = /^(?:[0-9]{2}[a-z]?|ac[0-9]+[a-z]?-[0-9]+)-[a-z0-9-]+\.png$|^[a-z]+_state_desktop\.png$/;

// ── 1. verifyArtifacts() ──────────────────────────────────────────────────────

test('verifyArtifacts returns a report object without throwing', async () => {
  const report = await verifyArtifacts();
  assert.ok(report, 'verifyArtifacts must return a value');
  assert.ok(typeof report.generated_at === 'string', 'report.generated_at must be a string');
  assert.ok(Array.isArray(report.checks), 'report.checks must be an array');
  assert.ok(typeof report.summary === 'object', 'report.summary must be an object');
  assert.ok(typeof report.verdict === 'string', 'report.verdict must be a string');
});

test('verifyArtifacts verdict is PASS', async () => {
  const report = await verifyArtifacts();
  assert.strictEqual(
    report.verdict,
    'PASS',
    `Expected verdict PASS but got ${report.verdict}. Failed checks: ${
      report.checks.filter(c => c.status === 'FAIL').map(c => c.id).join(', ') || 'none'
    }`
  );
});

test('verifyArtifacts has zero FAIL checks', async () => {
  const report = await verifyArtifacts();
  const failedChecks = report.checks.filter(c => c.status === 'FAIL');
  assert.strictEqual(
    failedChecks.length,
    0,
    `Expected 0 FAIL checks but got ${failedChecks.length}: ${failedChecks.map(c => c.id).join(', ')}`
  );
});

test('verifyArtifacts has at least 20 PASS checks', async () => {
  const report = await verifyArtifacts();
  assert.ok(
    report.summary.passed >= 20,
    `Expected at least 20 PASS checks but got ${report.summary.passed}`
  );
});

// ── 2. artifact-consistency-report.json written correctly ────────────────────

test('artifact-consistency-report.json exists after verifyArtifacts', async () => {
  await verifyArtifacts();
  const reportPath = path.join(ARTIFACTS, 'artifact-consistency-report.json');
  const stat = await fs.stat(reportPath);
  assert.ok(stat.size > 0, 'artifact-consistency-report.json must have non-zero size');
});

test('artifact-consistency-report.json is valid JSON with required fields', async () => {
  await verifyArtifacts();
  const raw = await fs.readFile(path.join(ARTIFACTS, 'artifact-consistency-report.json'), 'utf8');
  const report = JSON.parse(raw);
  assert.ok('generated_at' in report, 'must have generated_at');
  assert.ok(Array.isArray(report.checks), 'must have checks array');
  assert.ok('summary' in report, 'must have summary');
  assert.ok('verdict' in report, 'must have verdict');
  assert.ok(typeof report.summary.passed === 'number', 'summary.passed must be a number');
  assert.ok(typeof report.summary.failed === 'number', 'summary.failed must be a number');
});

// ── 3. Screenshot existence and non-zero sizes ────────────────────────────────

test('all 13 expected screenshots exist under artifacts/screenshots/', async () => {
  for (const name of EXPECTED_SCREENSHOTS) {
    const filePath = path.join(SCREENSHOTS, name);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (err) {
      assert.fail(`Screenshot missing: ${name} (${err.message})`);
    }
    assert.ok(stat.size > 0, `Screenshot ${name} has zero file size`);
  }
});

test('screenshot count matches expected (exactly 21)', async () => {
  const entries = await fs.readdir(SCREENSHOTS);
  const pngs = entries.filter(f => f.endsWith('.png')).sort();
  assert.strictEqual(
    pngs.length,
    EXPECTED_SCREENSHOTS.length,
    `Expected ${EXPECTED_SCREENSHOTS.length} screenshots but found ${pngs.length}: ${pngs.join(', ')}`
  );
});

// ── 4. Screenshot naming convention ──────────────────────────────────────────

test('all screenshots follow NN[b]-kebab-case.png naming convention', async () => {
  const entries = await fs.readdir(SCREENSHOTS);
  const pngs = entries.filter(f => f.endsWith('.png'));
  const violations = pngs.filter(f => !SCREENSHOT_NAME_PATTERN.test(f));
  assert.deepEqual(
    violations,
    [],
    `Naming convention violations: ${violations.join(', ')}`
  );
});

// ── 5. visual-judgment-report.md references ──────────────────────────────────

test('visual-judgment-report.md exists and is non-empty', async () => {
  const reportPath = path.join(ARTIFACTS, 'visual-judgment-report.md');
  const stat = await fs.stat(reportPath);
  assert.ok(stat.size > 0, 'visual-judgment-report.md must have non-zero size');
});

test('visual-judgment-report.md references all 4 core screenshots', async () => {
  const coreScreenshots = [
    '01-initial-load.png',
    '02-simulation-running.png',
    '03-results-populated.png',
    '04-error-state.png',
  ];
  const content = await fs.readFile(path.join(ARTIFACTS, 'visual-judgment-report.md'), 'utf8');
  for (const name of coreScreenshots) {
    assert.ok(
      content.includes(name),
      `visual-judgment-report.md must reference ${name}`
    );
  }
});

test('visual-judgment-report.md contains a final verdict section', async () => {
  const content = await fs.readFile(path.join(ARTIFACTS, 'visual-judgment-report.md'), 'utf8');
  assert.ok(/final verdict/i.test(content), 'visual-judgment-report.md must contain a final verdict section');
});

// ── 6. visual_judgment_report.json validity ───────────────────────────────────

test('visual_judgment_report.json exists and is valid JSON', async () => {
  const filePath = path.join(ARTIFACTS, 'visual_judgment_report.json');
  const raw = await fs.readFile(filePath, 'utf8');
  const report = JSON.parse(raw);
  assert.ok('generated_at' in report, 'must have generated_at');
  assert.ok(Array.isArray(report.checks), 'must have checks array');
  assert.ok('summary' in report, 'must have summary');
  assert.ok('verdict' in report, 'must have verdict');
});

test('visual_judgment_report.json verdict is PASS', async () => {
  const filePath = path.join(ARTIFACTS, 'visual_judgment_report.json');
  const report = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.strictEqual(report.verdict, 'PASS', `visual_judgment_report.json verdict must be PASS, got: ${report.verdict}`);
});

test('visual_judgment_report.json has zero failed checks', async () => {
  const filePath = path.join(ARTIFACTS, 'visual_judgment_report.json');
  const report = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.strictEqual(
    report.summary.failed,
    0,
    `Expected 0 failed visual judgment checks but got ${report.summary.failed}`
  );
});

test('visual_judgment_report.json covers all 7 check types', async () => {
  const filePath = path.join(ARTIFACTS, 'visual_judgment_report.json');
  const report = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const expectedCheckTypes = [
    'verifyNoRawJson',
    'verifyThreePanelLayout',
    'verifyKrwFormat',
    'verifyButtonState',
    'verifyDesignTokens',
    'verifyDiffFormat',
    'verifyErrorReadability',
  ];
  const presentTypes = new Set((report.checks ?? []).map(c => c.check));
  for (const t of expectedCheckTypes) {
    assert.ok(presentTypes.has(t), `visual_judgment_report.json must include check type: ${t}`);
  }
});

// ── 7. latest-run-summary.json validity ──────────────────────────────────────

test('latest-run-summary.json exists and contains required fields', async () => {
  const filePath = path.join(ARTIFACTS, 'latest-run-summary.json');
  const raw = await fs.readFile(filePath, 'utf8');
  const summary = JSON.parse(raw);
  const requiredFields = ['generated_at', 'sampler_seed', 'selected_strategy_id', 'holdout_uplift', 'diff'];
  for (const field of requiredFields) {
    assert.ok(field in summary, `latest-run-summary.json must have field: ${field}`);
  }
});

test('latest-run-summary.json diff has title/top_copy/price keys', async () => {
  const filePath = path.join(ARTIFACTS, 'latest-run-summary.json');
  const summary = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.ok(summary.diff, 'diff must exist');
  assert.ok('title' in summary.diff, 'diff must have title');
  assert.ok('top_copy' in summary.diff, 'diff must have top_copy');
  assert.ok('price' in summary.diff, 'diff must have price');
});

test('latest-run-summary.json price values are KRW integers', async () => {
  const filePath = path.join(ARTIFACTS, 'latest-run-summary.json');
  const summary = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const before = summary.diff?.price?.before;
  const after = summary.diff?.price?.after;
  assert.ok(Number.isInteger(before), `diff.price.before must be an integer, got: ${before}`);
  assert.ok(Number.isInteger(after), `diff.price.after must be an integer, got: ${after}`);
  assert.ok(before > 0, `diff.price.before must be positive KRW, got: ${before}`);
  assert.ok(after > 0, `diff.price.after must be positive KRW, got: ${after}`);
});

// ── 8. generateEvidenceBundle() ───────────────────────────────────────────────

test('generateEvidenceBundle returns a bundle object without throwing', async () => {
  const bundle = await generateEvidenceBundle();
  assert.ok(bundle, 'generateEvidenceBundle must return a value');
  assert.ok(typeof bundle.bundle_version === 'string', 'bundle.bundle_version must be a string');
  assert.ok(typeof bundle.generated_at === 'string', 'bundle.generated_at must be a string');
  assert.ok(typeof bundle.project === 'string', 'bundle.project must be a string');
  assert.ok(typeof bundle.artifacts === 'object', 'bundle.artifacts must be an object');
  assert.ok(typeof bundle.sub_ac_coverage === 'object', 'bundle.sub_ac_coverage must be an object');
  assert.ok(typeof bundle.consistency_checks === 'object', 'bundle.consistency_checks must be an object');
  assert.ok(typeof bundle.overall_verdict === 'string', 'bundle.overall_verdict must be a string');
  assert.ok(typeof bundle.overall_summary === 'object', 'bundle.overall_summary must be an object');
});

// ── 9. evidence_bundle.json overall_verdict ───────────────────────────────────

test('evidence_bundle.json overall_verdict is PASS', async () => {
  const bundle = await generateEvidenceBundle();
  assert.strictEqual(
    bundle.overall_verdict,
    'PASS',
    `Expected overall_verdict PASS but got ${bundle.overall_verdict}`
  );
});

test('evidence_bundle.json is written to artifacts/ with non-zero size', async () => {
  await generateEvidenceBundle();
  const bundlePath = path.join(ARTIFACTS, 'evidence_bundle.json');
  const stat = await fs.stat(bundlePath);
  assert.ok(stat.size > 0, 'evidence_bundle.json must have non-zero size');
});

test('evidence_bundle.json is valid JSON with all required top-level fields', async () => {
  await generateEvidenceBundle();
  const raw = await fs.readFile(path.join(ARTIFACTS, 'evidence_bundle.json'), 'utf8');
  const bundle = JSON.parse(raw);
  const requiredFields = [
    'bundle_version', 'generated_at', 'project', 'description',
    'artifacts', 'sub_ac_coverage', 'consistency_checks',
    'overall_verdict', 'overall_summary',
  ];
  for (const field of requiredFields) {
    assert.ok(field in bundle, `evidence_bundle.json must have field: ${field}`);
  }
});

test('evidence_bundle.json artifacts includes screenshots section with 9 files', async () => {
  const bundle = await generateEvidenceBundle();
  assert.ok(bundle.artifacts.screenshots, 'artifacts.screenshots must exist');
  assert.strictEqual(
    bundle.artifacts.screenshots.count,
    9,
    `Expected 9 screenshots in bundle, got ${bundle.artifacts.screenshots.count}`
  );
  assert.ok(bundle.artifacts.screenshots.all_present, 'artifacts.screenshots.all_present must be true');
  assert.ok(
    Array.isArray(bundle.artifacts.screenshots.files),
    'artifacts.screenshots.files must be an array'
  );
  assert.strictEqual(
    bundle.artifacts.screenshots.files.length,
    9,
    `Expected 9 file entries in screenshots, got ${bundle.artifacts.screenshots.files.length}`
  );
});

test('evidence_bundle.json overall_summary has correct artifact counts', async () => {
  const bundle = await generateEvidenceBundle();
  assert.strictEqual(bundle.overall_summary.screenshots, 9, 'screenshots count must be 9');
  assert.strictEqual(bundle.overall_summary.json_reports, 3, 'json_reports count must be 3');
  assert.strictEqual(bundle.overall_summary.markdown_reports, 1, 'markdown_reports count must be 1');
  assert.strictEqual(bundle.overall_summary.consistency_checks_failed, 0, 'consistency_checks_failed must be 0');
});

// ── 10. sub-AC coverage completeness ─────────────────────────────────────────

test('evidence_bundle.json covers all 11 sub-AC coverage items', async () => {
  const bundle = await generateEvidenceBundle();
  const expectedSubACs = [
    'AC1_fixture_parsing',
    'AC2_strategy_generation',
    'AC3_buyer_evaluation',
    'AC4_realism_judge_holdout',
    'AC5_sse_streaming',
    'AC5b_agent_profile_popup',
    'AC6_particle_visualization',
    'AC7_input_override_ui',
    'AC8a_screenshots',
    'AC8b_visual_judgment',
    'AC8c_artifact_consistency',
  ];
  for (const subAC of expectedSubACs) {
    assert.ok(
      subAC in bundle.sub_ac_coverage,
      `evidence_bundle.json must include sub-AC coverage for: ${subAC}`
    );
    assert.strictEqual(
      bundle.sub_ac_coverage[subAC].status,
      'COVERED',
      `${subAC} must have status COVERED`
    );
  }
  assert.strictEqual(
    bundle.overall_summary.sub_ac_items_covered,
    expectedSubACs.length,
    `Expected ${expectedSubACs.length} sub-AC items covered, got ${bundle.overall_summary.sub_ac_items_covered}`
  );
});

test('evidence_bundle.json consistency_checks all have PASS or WARN status (no FAIL)', async () => {
  const bundle = await generateEvidenceBundle();
  for (const [key, check] of Object.entries(bundle.consistency_checks)) {
    assert.notStrictEqual(
      check.status,
      'FAIL',
      `consistency_checks.${key} must not be FAIL (got: ${check.status})`
    );
  }
});
