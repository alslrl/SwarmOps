import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runSimulation } from '../src/lib/simulation/engine.mjs';

const fixtureDir = path.resolve(process.cwd(), 'fixtures');
const artifactPath = path.resolve(process.cwd(), 'artifacts/latest-run-summary.json');

test('simulation writes latest run summary artifact', async () => {
  await runSimulation({ fixtureDir, modelMode: 'mock', iterationCount: 1, minimumMarginFloor: 0.35, samplerSeed: 777 });
  const payload = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
  assert.equal(typeof payload.sampler_seed, 'number');
  assert.equal(typeof payload.selected_strategy_id, 'string');
  assert.equal(typeof payload.holdout_uplift, 'number');
  assert.ok(payload.diff.title);
});
