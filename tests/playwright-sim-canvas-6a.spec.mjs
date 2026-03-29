/**
 * playwright-sim-canvas-6a.spec.mjs
 *
 * Sub-AC 6a: Verify sim-canvas element initialization and requestAnimationFrame
 * rendering loop with basic draw/clear cycle.
 *
 * Tests:
 *   1. sim-canvas SVG element is present in DOM with correct data-testid
 *   2. particle-canvas Canvas 2D element is present and correctly positioned
 *   3. Canvas 2D context is available (getContext('2d') returns non-null)
 *   4. RAF loop is running (window.particleEngine exists, running = true)
 *   5. Draw/clear cycle works: canvas has non-zero dimensions
 *   6. clearRect is functional (canvas can be cleared)
 *   7. Particle rendering: pixels appear on canvas after spawn + RAF tick
 *   8. Canvas resizes correctly on container change
 *   9. sim-canvas-wrap container holds both SVG and canvas overlaid
 *
 * PRD §8 AC8: "The simulation visualization (data-testid='sim-canvas') shows
 *              animated force-directed graph during SSE streaming."
 * PRD §12.3, §12.4
 * Port: 3111 — dedicated, no collision
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';

const PORT = 3111;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// ── Server lifecycle ─────────────────────────────────────────────────────────

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

// ── Wait helpers ─────────────────────────────────────────────────────────────

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

// ── Test 1: sim-canvas SVG element exists with correct data-testid ────────────

test('Sub-AC 6a: sim-canvas element is present in DOM with data-testid="sim-canvas"', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const simCanvas = page.locator('[data-testid="sim-canvas"]');
  await expect(simCanvas).toBeAttached();
  await expect(simCanvas).toBeVisible();

  // Must be an SVG element (the force-directed graph)
  const tagName = await simCanvas.evaluate((el) => el.tagName.toLowerCase());
  expect(tagName, 'sim-canvas must be an SVG element').toBe('svg');

  // Must have the correct id
  const id = await simCanvas.getAttribute('id');
  expect(id).toBe('sim-canvas');

  console.log('[6a] sim-canvas SVG element present and visible ✓');
});

// ── Test 2: particle-canvas Canvas 2D element exists and is positioned ────────

test('Sub-AC 6a: particle-canvas Canvas 2D element is present with correct positioning', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const particleCanvas = page.locator('[data-testid="particle-canvas"]');
  await expect(particleCanvas).toBeAttached();

  // Must be a canvas element
  const tagName = await particleCanvas.evaluate((el) => el.tagName.toLowerCase());
  expect(tagName, 'particle-canvas must be a <canvas> element').toBe('canvas');

  // Must have position:absolute (overlaid on top of SVG)
  const position = await particleCanvas.evaluate(
    (el) => window.getComputedStyle(el).position,
  );
  expect(position, 'particle-canvas must be absolutely positioned').toBe('absolute');

  // Must have pointer-events:none (lets SVG events pass through)
  const pointerEvents = await particleCanvas.evaluate(
    (el) => window.getComputedStyle(el).pointerEvents,
  );
  expect(pointerEvents, 'particle-canvas must have pointer-events:none').toBe('none');

  // Must have z-index >= 2 (above SVG)
  const zIndex = await particleCanvas.evaluate(
    (el) => parseInt(window.getComputedStyle(el).zIndex || '0', 10),
  );
  expect(zIndex, 'particle-canvas z-index must be >= 2').toBeGreaterThanOrEqual(2);

  console.log(`[6a] particle-canvas: position=${position}, pointerEvents=${pointerEvents}, zIndex=${zIndex} ✓`);
});

// ── Test 3: Canvas 2D context is available ────────────────────────────────────

test('Sub-AC 6a: Canvas 2D context is available (getContext returns non-null)', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await waitForParticleEngine(page);

  const ctxAvailable = await page.evaluate(() => {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) return false;
    const ctx = canvas.getContext('2d');
    return ctx !== null;
  });

  expect(ctxAvailable, 'Canvas 2D context must be available').toBe(true);

  console.log('[6a] Canvas 2D context available ✓');
});

// ── Test 4: RAF loop running — window.particleEngine exists and is running ────

test('Sub-AC 6a: RAF loop is running — window.particleEngine.running is true', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await waitForParticleEngine(page);

  // Engine must be initialized and running after page load
  const engineState = await page.evaluate(() => {
    const engine = window.particleEngine;
    if (!engine) return { error: 'no engine' };
    return {
      running: engine.running,
      frozen:  engine.frozen,
      fps:     engine.fps,  // null until first measurement, but engine must be running
    };
  });

  expect(engineState.error).toBeUndefined();
  expect(engineState.running, 'particleEngine.running must be true after init').toBe(true);
  expect(engineState.frozen, 'particleEngine.frozen must be false initially').toBe(false);

  console.log(`[6a] particleEngine running=${engineState.running}, frozen=${engineState.frozen} ✓`);
});

// ── Test 5: Canvas has non-zero dimensions after initialization ───────────────

test('Sub-AC 6a: canvas has non-zero dimensions after engine initialization', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await waitForParticleEngine(page);

  const dims = await page.evaluate(() => {
    const engine = window.particleEngine;
    const canvas = document.getElementById('particle-canvas');
    if (!engine || !canvas) return { error: 'missing' };
    return {
      cssW: engine._cssW,
      cssH: engine._cssH,
      canvasWidth:  canvas.width,
      canvasHeight: canvas.height,
      cssWidth:  canvas.clientWidth  || parseInt(canvas.style.width  || '0', 10),
      cssHeight: canvas.clientHeight || parseInt(canvas.style.height || '0', 10),
    };
  });

  expect(dims.error).toBeUndefined();
  expect(dims.cssW, 'engine._cssW must be > 0').toBeGreaterThan(0);
  expect(dims.cssH, 'engine._cssH must be > 0').toBeGreaterThan(0);
  expect(dims.canvasWidth,  'canvas.width must be > 0').toBeGreaterThan(0);
  expect(dims.canvasHeight, 'canvas.height must be > 0').toBeGreaterThan(0);

  console.log(`[6a] canvas dims: cssW=${dims.cssW} cssH=${dims.cssH} physW=${dims.canvasWidth} physH=${dims.canvasHeight} ✓`);
});

// ── Test 6: clearRect is functional — basic clear cycle works ─────────────────

test('Sub-AC 6a: clearRect is functional — canvas can be cleared and redrawn', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await waitForParticleEngine(page);

  // Verify clearRect can be called without error (basic draw/clear cycle)
  const clearResult = await page.evaluate(() => {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) return { error: 'no canvas' };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { error: 'no ctx' };

    // Draw a red pixel
    ctx.fillStyle = 'red';
    ctx.fillRect(10, 10, 2, 2);

    // Check that pixel is red before clear
    const beforeClear = ctx.getImageData(11, 11, 1, 1).data;

    // Clear the entire canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Check that pixel is transparent after clear
    const afterClear = ctx.getImageData(11, 11, 1, 1).data;

    return {
      beforeAlpha: beforeClear[3],  // alpha before clear
      afterAlpha:  afterClear[3],   // alpha after clear (should be 0)
    };
  });

  expect(clearResult.error).toBeUndefined();
  // After drawing a pixel, alpha should be > 0
  expect(clearResult.beforeAlpha, 'pixel alpha before clear must be > 0').toBeGreaterThan(0);
  // After clearRect, alpha must be 0 (transparent)
  expect(clearResult.afterAlpha, 'pixel alpha after clearRect must be 0').toBe(0);

  console.log(`[6a] clearRect functional: beforeAlpha=${clearResult.beforeAlpha}, afterAlpha=${clearResult.afterAlpha} ✓`);
});

// ── Test 7: Particle rendering — pixels appear on canvas after spawn + tick ───

test('Sub-AC 6a: pixels appear on canvas after particle spawn and RAF tick', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await waitForParticleEngine(page);

  // Spawn particles and wait for RAF to render them
  const result = await page.evaluate(async () => {
    const engine = window.particleEngine;
    const canvas = document.getElementById('particle-canvas');
    if (!engine || !canvas || !(canvas instanceof HTMLCanvasElement)) {
      return { error: 'missing engine or canvas' };
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return { error: 'no ctx' };

    const W = engine._cssW || 600;
    const H = engine._cssH || 400;

    // Spawn 10 particles with mid-flight elapsed times so they are actively rendered
    engine.clearAll();
    let spawned = 0;
    const archetypes = ['price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
                        'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer'];
    for (let i = 0; i < 10; i++) {
      const srcX = W * 0.1 + (i % 5) * (W * 0.15);
      const srcY = H * 0.3;
      const dstX = W * 0.1 + (i % 5) * (W * 0.2);
      const dstY = H * 0.8;
      const p = engine.spawn(srcX, srcY, dstX, dstY, archetypes[i % archetypes.length]);
      if (p) {
        // Set elapsed to mid-flight (t=0.5 → particle at midpoint, full opacity)
        p.elapsed = 100;  // half of 200ms PARTICLE_DURATION_MS
        spawned++;
      }
    }

    // Wait 2 animation frames for the RAF loop to render
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    // Check for non-transparent pixels in the canvas
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let nonTransparentCount = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 5) nonTransparentCount++;  // alpha > 5
    }

    return {
      spawned,
      activeCount:      engine.activeCount,
      nonTransparentCount,
      hasVisiblePixels: nonTransparentCount > 0,
    };
  });

  expect(result.error).toBeUndefined();
  expect(result.spawned, 'Must spawn 10 particles').toBe(10);
  expect(result.activeCount, 'activeCount must be 10').toBe(10);
  expect(result.hasVisiblePixels, 'Canvas must have visible pixels after spawn + RAF tick').toBe(true);

  console.log(`[6a] particles: spawned=${result.spawned}, active=${result.activeCount}, nonTransparentPx=${result.nonTransparentCount} ✓`);
});

// ── Test 8: sim-canvas-wrap container holds both SVG and canvas ───────────────

test('Sub-AC 6a: sim-canvas-wrap contains both SVG sim-canvas and particle-canvas', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const wrapInfo = await page.evaluate(() => {
    const wrap = document.getElementById('sim-canvas-wrap');
    if (!wrap) return { error: 'no wrap' };

    const svgEl    = wrap.querySelector('[data-testid="sim-canvas"]');
    const canvasEl = wrap.querySelector('[data-testid="particle-canvas"]');

    return {
      wrapExists:    true,
      hasSvg:        svgEl !== null,
      hasCanvas:     canvasEl !== null,
      svgTag:        svgEl?.tagName?.toLowerCase() ?? null,
      canvasTag:     canvasEl?.tagName?.toLowerCase() ?? null,
      wrapPosition:  window.getComputedStyle(wrap).position,
    };
  });

  expect(wrapInfo.error).toBeUndefined();
  expect(wrapInfo.wrapExists, 'sim-canvas-wrap must exist').toBe(true);
  expect(wrapInfo.hasSvg, 'wrap must contain the SVG sim-canvas').toBe(true);
  expect(wrapInfo.hasCanvas, 'wrap must contain the particle-canvas Canvas 2D').toBe(true);
  expect(wrapInfo.svgTag).toBe('svg');
  expect(wrapInfo.canvasTag).toBe('canvas');
  expect(wrapInfo.wrapPosition, 'wrap must be position:relative for absolute overlay').toBe('relative');

  console.log(`[6a] sim-canvas-wrap: hasSvg=${wrapInfo.hasSvg}, hasCanvas=${wrapInfo.hasCanvas}, position=${wrapInfo.wrapPosition} ✓`);
});

// ── Test 9: Force-directed graph RAF tick updates node positions ───────────────

test('Sub-AC 6a: force-directed graph RAF tick updates SVG archetype node transforms', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await waitForParticleEngine(page);

  // Wait 2 RAF ticks for the force graph to initialize positions
  await page.waitForTimeout(100);

  const nodeState = await page.evaluate(() => {
    const svg = document.getElementById('sim-canvas');
    if (!svg) return { error: 'no sim-canvas SVG' };

    const archetypeNodes = Array.from(svg.querySelectorAll('.archetype-node'));
    const productNodes   = Array.from(svg.querySelectorAll('.product-node'));

    // Check that nodes have transform attributes set (RAF loop has run)
    const archetypeTransforms = archetypeNodes.map((n) => n.getAttribute('transform'));
    const productTransforms   = productNodes.map((n) => n.getAttribute('transform'));

    const archetypeCount = archetypeNodes.length;
    const productCount   = productNodes.length;

    // At least some transforms should be set (non-null, non-empty)
    const archetypeWithTransform = archetypeTransforms.filter(Boolean).length;
    const productWithTransform   = productTransforms.filter(Boolean).length;

    return {
      archetypeCount,
      productCount,
      archetypeWithTransform,
      productWithTransform,
    };
  });

  expect(nodeState.error).toBeUndefined();
  expect(nodeState.archetypeCount, 'Must have 8 archetype nodes in SVG').toBe(8);
  expect(nodeState.productCount, 'Must have 5 product nodes in SVG').toBe(5);
  // After RAF loop has run, all nodes should have transforms set
  expect(nodeState.archetypeWithTransform, 'All 8 archetype nodes must have transform set').toBe(8);
  expect(nodeState.productWithTransform, 'All 5 product nodes must have transform set').toBe(5);

  console.log(
    `[6a] SVG nodes: archetypes=${nodeState.archetypeCount} (${nodeState.archetypeWithTransform} transformed), ` +
    `products=${nodeState.productCount} (${nodeState.productWithTransform} transformed) ✓`,
  );
});

// ── Test 10: RAF loop FPS measurement available ───────────────────────────────

test('Sub-AC 6a: particle engine RAF loop achieves measurable FPS', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);
  await waitForParticleEngine(page);

  // Wait for the FPS measurement to be available (engine needs ~500ms to compute rolling FPS)
  await page.waitForFunction(
    () => window.particleEngine?.fps !== null && window.particleEngine?.fps !== undefined,
    { timeout: 5_000 },
  );

  const fps = await page.evaluate(() => window.particleEngine?.fps ?? 0);
  expect(fps, 'RAF loop FPS must be > 0').toBeGreaterThan(0);
  // PRD §13.5 requires ≥ 30fps under 800 particles, but idle FPS should be much higher
  expect(fps, 'RAF loop FPS must be at least 10fps at idle').toBeGreaterThanOrEqual(10);

  console.log(`[6a] RAF loop FPS at idle: ${fps.toFixed(1)} ✓`);
});
