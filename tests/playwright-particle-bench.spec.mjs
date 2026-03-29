/**
 * playwright-particle-bench.spec.mjs
 *
 * Playwright test that verifies the sim-canvas particle engine:
 *  - ParticleEngine initializes and attaches to window.particleEngine
 *  - 800 particles can be spawned from the object pool
 *  - requestAnimationFrame render loop achieves ≥30fps under 800 concurrent particles
 *    (measured via performance.now() bench in particle-engine.mjs::runPerfBench)
 *  - Archetype-based color mapping covers all 8 archetypes
 *  - 0.2s linear animation completes correctly (particles despawn after PARTICLE_DURATION_MS)
 *
 * Sub-AC 4a  |  PRD §12.3
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';

const PORT = 3098;  // dedicated port — avoids collisions with screenshot suite
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

// ── Test 1: Particle engine initialises on page load ─────────────────────────

test('particle-engine: window.particleEngine is initialised after page load', async ({ page }) => {
  await page.goto(BASE_URL);

  // Wait for particle engine to be initialised (initParticleEngine runs after DOMContentLoaded)
  const engineExists = await page.waitForFunction(
    () => typeof window.particleEngine !== 'undefined' && window.particleEngine !== null,
    { timeout: 10_000 },
  );
  expect(engineExists).toBeTruthy();
});

// ── Test 2: Particle pool can hold 800+ particles ──────────────────────────

test('particle-engine: object pool can accommodate 800 concurrent particles', async ({ page }) => {
  await page.goto(BASE_URL);

  // Wait for engine to be ready
  await page.waitForFunction(
    () => typeof window.particleEngine !== 'undefined' && window.particleEngine !== null,
    { timeout: 10_000 },
  );

  // Spawn 800 particles using synthetic positions (no real node positions needed)
  const spawnResult = await page.evaluate(() => {
    const engine = window.particleEngine;
    if (!engine) return { error: 'no engine' };

    engine.clearAll();
    let spawned = 0;
    const archetypes = ['price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
                        'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer'];
    const W = engine._cssW || 600;
    const H = engine._cssH || 400;

    for (let i = 0; i < 800; i++) {
      const archetypeId = archetypes[i % archetypes.length];
      // Use spread-out synthetic positions
      const srcX = (W * 0.1) + (i % 8) * (W * 0.1);
      const srcY = H * 0.3;
      const dstX = (W * 0.1) + (i % 5) * (W * 0.2);
      const dstY = H * 0.8;
      const p = engine.spawn(srcX, srcY, dstX, dstY, archetypeId);
      if (p !== null) spawned++;
    }
    return { spawned, activeCount: engine.activeCount };
  });

  expect(spawnResult.error).toBeUndefined();
  expect(spawnResult.spawned).toBe(800);
  expect(spawnResult.activeCount).toBe(800);
});

// ── Test 3: Archetype color mapping covers all 8 archetypes ─────────────────

test('particle-engine: ARCHETYPE_COLORS covers all 8 archetypes with valid hex colors', async ({ page }) => {
  await page.goto(BASE_URL);

  await page.waitForFunction(
    () => typeof window.particleEngine !== 'undefined' && window.particleEngine !== null,
    { timeout: 10_000 },
  );

  const colorCheck = await page.evaluate(() => {
    // ARCHETYPE_COLORS is exported from particle-engine.mjs and used by the engine
    // We verify the engine assigns correct colors by spawning a particle per archetype
    // and reading the assigned color from the particle object.
    const engine = window.particleEngine;
    engine.clearAll();

    const archetypeIds = [
      'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
      'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
    ];
    const HEX_RE = /^#[0-9a-fA-F]{6}$/;
    const W = engine._cssW || 600;
    const H = engine._cssH || 400;

    const results = {};
    for (const id of archetypeIds) {
      const p = engine.spawn(10, 10, W - 10, H - 10, id);
      if (!p) {
        results[id] = { error: 'spawn failed' };
        continue;
      }
      results[id] = {
        color: p.color,
        validHex: HEX_RE.test(p.color),
        notFallback: p.color !== '#94a3b8',  // fallback color used when id is unknown
      };
      p.active = false;  // return to pool
    }
    return results;
  });

  const archetypeIds = [
    'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
    'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
  ];

  for (const id of archetypeIds) {
    const res = colorCheck[id];
    expect(res.error).toBeUndefined();
    expect(res.validHex).toBe(true);
    expect(res.notFallback).toBe(true);
  }
});

// ── Test 4: 0.2s linear animation completes — particles despawn at t=1 ───────

test('particle-engine: particles despawn after 0.2s PARTICLE_DURATION_MS', async ({ page }) => {
  await page.goto(BASE_URL);

  await page.waitForFunction(
    () => typeof window.particleEngine !== 'undefined' && window.particleEngine !== null,
    { timeout: 10_000 },
  );

  const despawnCheck = await page.evaluate(() => {
    const engine = window.particleEngine;
    engine.clearAll();

    const W = engine._cssW || 600;
    const H = engine._cssH || 400;

    // Spawn one particle and manually advance its elapsed past PARTICLE_DURATION_MS (200ms)
    const p = engine.spawn(10, 10, W - 10, H - 10, 'price_sensitive');
    if (!p) return { error: 'spawn failed' };

    const beforeActive = p.active;  // should be true
    // Simulate 201ms elapsed — one tick beyond the 200ms duration
    engine._update(201);
    const afterActive = p.active;   // should now be false (despawned)

    return { beforeActive, afterActive };
  });

  expect(despawnCheck.error).toBeUndefined();
  expect(despawnCheck.beforeActive).toBe(true);
  expect(despawnCheck.afterActive).toBe(false);
});

// ── Test 5: ≥30fps under 800 concurrent particles (performance.now() bench) ──

test('particle-engine: achieves ≥30fps under 800 concurrent particles', async ({ page }) => {
  // This test waits for the auto-bench that runs 2s after page init
  // The bench result is stored in window._particleBenchResult
  // Total wait: 2s (init delay) + 2s (bench duration) + 1s buffer = 5s max

  await page.goto(BASE_URL);

  // Wait for particle engine to be initialised first
  await page.waitForFunction(
    () => typeof window.particleEngine !== 'undefined' && window.particleEngine !== null,
    { timeout: 10_000 },
  );

  // Wait for the bench result to be available (bench starts 2s after init, runs 2s)
  const benchResult = await page.waitForFunction(
    () => {
      const r = window._particleBenchResult;
      return (r && typeof r.fps === 'number') ? r : null;
    },
    { timeout: 10_000 },  // 10s total timeout
  );

  const result = await benchResult.jsonValue();

  console.log(`[particle-bench] fps=${result.fps?.toFixed(1)} passed=${result.passed} activeOnSpawn=${result.activeOnSpawn}`);

  // Core assertion: ≥30fps under 800 particles
  expect(result.fps).toBeGreaterThanOrEqual(30);
  expect(result.passed).toBe(true);

  // Verify all 800 particles were successfully spawned from the pool
  expect(result.activeOnSpawn).toBe(800);
});

// ── Test 6: particle-canvas element has correct DOM structure ────────────────

test('particle-engine: particle-canvas element is correctly configured in DOM', async ({ page }) => {
  await page.goto(BASE_URL);

  // Verify particle-canvas element exists with correct data-testid
  const canvas = page.locator('[data-testid="particle-canvas"]');
  await expect(canvas).toBeAttached();

  // Canvas must be positioned absolutely over the SVG (z-index:2, pointer-events:none)
  const styles = await canvas.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      position: cs.position,
      pointerEvents: cs.pointerEvents,
      zIndex: cs.zIndex,
    };
  });

  expect(styles.position).toBe('absolute');
  expect(styles.pointerEvents).toBe('none');
  // z-index:2 — canvas is above the SVG force graph layer
  expect(Number(styles.zIndex)).toBeGreaterThanOrEqual(2);
});
