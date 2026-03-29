import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runSimulation } from '../src/lib/simulation/engine.mjs';

const appDir = path.resolve(process.cwd(), 'src/app');
const fixtureDir = path.resolve(process.cwd(), 'fixtures');

test('dashboard assets expose the expected controls and labels', async () => {
  const html = await fs.readFile(path.join(appDir, 'dashboard.html'), 'utf8');
  const js = await fs.readFile(path.join(appDir, 'dashboard.js'), 'utf8');

  assert.match(html, /Run simulation/);
  assert.match(html, /Iteration count/);
  assert.match(html, /Minimum margin floor/);
  assert.match(html, /Baseline revenue/);
  assert.match(js, /artifactOutput/);
});

test('dashboard HTML contains insights-panel element with correct data-testid', async () => {
  const html = await fs.readFile(path.join(appDir, 'dashboard.html'), 'utf8');
  // data-testid="insights-panel" present
  assert.match(html, /data-testid="insights-panel"/, 'insights-panel data-testid must be present');
  // insights-list container present
  assert.match(html, /id="insights-list"/, 'insights-list container must be present');
  // Section title for insights panel
  assert.match(html, /아키타입 인사이트/, 'Korean section title 아키타입 인사이트 must be present');
});

test('dashboard JS contains populateInsightsPanel with correct icon thresholds', async () => {
  const js = await fs.readFile(path.join(appDir, 'dashboard.js'), 'utf8');
  // Must have the three icon threshold conditions
  assert.match(js, /ourRate < 0\.25/, '⚠️ threshold ourRate < 0.25 must be present');
  assert.match(js, /ourRate > 0\.50/, '✅ threshold ourRate > 0.50 must be present');
  assert.match(js, /passRate > 0\.40/, '🟡 threshold passRate > 0.40 must be present');
  // Must assign correct icon strings
  assert.match(js, /'⚠️'/, '⚠️ icon string must be present');
  assert.match(js, /'✅'/, '✅ icon string must be present');
  assert.match(js, /'🟡'/, '🟡 icon string must be present');
  // Must use data-testid="insight-item" for each rendered item
  assert.match(js, /data-testid.*insight-item/, 'insight-item data-testid must be set on rendered items');
  // Must cap at 8 and guarantee minimum 3
  assert.match(js, /slice\(0, 8\)/, 'insights must be capped at 8 items');
  assert.match(js, /insights\.length < 3/, 'minimum 3 items supplement must be present');
});

test('dashboard-visible result shape can be produced from the engine', async () => {
  const result = await runSimulation({ fixtureDir, modelMode: 'mock', iterationCount: 1, minimumMarginFloor: 0.35, samplerSeed: 4242 });
  assert.ok(result.baseline.simulated_revenue >= 0);
  assert.ok(result.selected_strategy.simulated_revenue >= 0);
  assert.equal(typeof result.holdout.holdout_uplift, 'number');
  assert.deepEqual(Object.keys(result.diff), ['title', 'top_copy', 'price']);
});
