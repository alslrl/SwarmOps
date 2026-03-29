/**
 * particle-engine-unit.test.mjs
 *
 * Node.js unit tests for the Sub-AC 4a particle engine enhancements:
 *  - BUCKET_DEFS export: 5 buckets (4 products + pass), correct IDs
 *  - ARCHETYPE_COLORS export: 8 archetypes, valid hex colors
 *  - ParticleEngine with mocked canvas: Particle vx/vy/targetBucket properties
 *  - initBuckets(): seeds 5 bucket positions from BUCKET_DEFS
 *  - setProductPos(): auto-registers bucket; getters consistent
 *  - Hit-detection: time-based (t≥1) and spatial proximity
 *  - _drawBuckets(): no-op when _buckets empty; draws when populated
 *
 * These tests run in Node.js (no browser) by mocking the minimal
 * browser APIs that particle-engine.mjs depends on.
 *
 * Sub-AC 4a  |  PRD §12.3
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal browser-API mocks ────────────────────────────────────────────────

// Mock window with devicePixelRatio
globalThis.window = { devicePixelRatio: 1 };

// Mock requestAnimationFrame / cancelAnimationFrame (no-op; RAF loop not started in tests)
let _rafId = 0;
globalThis.requestAnimationFrame = (cb) => {
  _rafId++;
  // Don't actually schedule — just return an id for cancelAnimationFrame
  return _rafId;
};
globalThis.cancelAnimationFrame = (_id) => {};

// Mock a minimal CanvasRenderingContext2D
function makeMockCtx() {
  const calls = [];
  return {
    _calls: calls,
    clearRect:      (...args) => calls.push(['clearRect', ...args]),
    beginPath:      ()        => calls.push(['beginPath']),
    arc:            (...args) => calls.push(['arc', ...args]),
    fill:           ()        => calls.push(['fill']),
    stroke:         ()        => calls.push(['stroke']),
    save:           ()        => calls.push(['save']),
    restore:        ()        => calls.push(['restore']),
    setLineDash:    (...args) => calls.push(['setLineDash', ...args]),
    setTransform:   (...args) => calls.push(['setTransform', ...args]),
    globalAlpha:    1,
    fillStyle:      '',
    strokeStyle:    '',
    lineWidth:      1,
  };
}

// Mock HTMLCanvasElement
function makeMockCanvas(cssW = 600, cssH = 400) {
  const ctx = makeMockCtx();
  return {
    getContext: (_type) => ctx,
    clientWidth:  cssW,
    clientHeight: cssH,
    width:  cssW,
    height: cssH,
    style:  { width: '', height: '' },
    _ctx: ctx,
  };
}

// ── Import module under test ─────────────────────────────────────────────────

const { ARCHETYPE_COLORS, BUCKET_DEFS, ParticleEngine } =
  await import('../src/app/particle-engine.mjs');

// ── ARCHETYPE_COLORS ─────────────────────────────────────────────────────────

test('ARCHETYPE_COLORS: exports an object with exactly 8 archetype entries', () => {
  assert.equal(typeof ARCHETYPE_COLORS, 'object');
  const keys = Object.keys(ARCHETYPE_COLORS);
  assert.equal(keys.length, 8, `expected 8 archetypes, got ${keys.length}`);
});

test('ARCHETYPE_COLORS: all values are valid 6-digit hex color strings', () => {
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  for (const [id, color] of Object.entries(ARCHETYPE_COLORS)) {
    assert.match(color, HEX_RE, `archetype "${id}" has invalid color "${color}"`);
  }
});

test('ARCHETYPE_COLORS: contains all 8 expected archetype IDs', () => {
  const expected = [
    'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
    'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
  ];
  for (const id of expected) {
    assert.ok(id in ARCHETYPE_COLORS, `missing archetype "${id}"`);
  }
});

// ── BUCKET_DEFS ──────────────────────────────────────────────────────────────

test('BUCKET_DEFS: exports an array of exactly 5 bucket definitions', () => {
  assert.ok(Array.isArray(BUCKET_DEFS), 'BUCKET_DEFS should be an array');
  assert.equal(BUCKET_DEFS.length, 5, `expected 5 buckets, got ${BUCKET_DEFS.length}`);
});

test('BUCKET_DEFS: contains all 5 required bucket IDs (4 products + pass)', () => {
  const ids = BUCKET_DEFS.map((d) => d.id);
  const required = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  for (const id of required) {
    assert.ok(ids.includes(id), `BUCKET_DEFS missing bucket id "${id}"`);
  }
});

test('BUCKET_DEFS: each entry has id, color, defaultRelX, defaultRelY, hitRadius fields', () => {
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  for (const def of BUCKET_DEFS) {
    assert.equal(typeof def.id, 'string',   `bucket.id should be string: ${JSON.stringify(def)}`);
    assert.match(def.color, HEX_RE,          `bucket "${def.id}" color "${def.color}" is not valid hex`);
    assert.equal(typeof def.defaultRelX, 'number', `bucket "${def.id}" missing defaultRelX`);
    assert.equal(typeof def.defaultRelY, 'number', `bucket "${def.id}" missing defaultRelY`);
    assert.equal(typeof def.hitRadius,   'number', `bucket "${def.id}" missing hitRadius`);
    assert.ok(def.defaultRelX >= 0 && def.defaultRelX <= 1,
      `bucket "${def.id}" defaultRelX out of [0,1]: ${def.defaultRelX}`);
    assert.ok(def.defaultRelY >= 0 && def.defaultRelY <= 1,
      `bucket "${def.id}" defaultRelY out of [0,1]: ${def.defaultRelY}`);
    assert.ok(def.hitRadius > 0, `bucket "${def.id}" hitRadius must be > 0`);
  }
});

// ── ParticleEngine: constructor & initBuckets ────────────────────────────────

test('ParticleEngine: constructs without error and exposes pool of 1200 particles', () => {
  const canvas = makeMockCanvas();
  const engine = new ParticleEngine(canvas);
  assert.equal(engine.pool.length, 1200);
  assert.equal(engine.activeCount, 0);
});

test('ParticleEngine: initBuckets() populates _buckets with all 5 bucket entries', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  engine.initBuckets(600, 400);

  assert.equal(engine._buckets.size, 5, `expected 5 buckets, got ${engine._buckets.size}`);

  const ids = [...engine._buckets.keys()];
  for (const def of BUCKET_DEFS) {
    assert.ok(ids.includes(def.id), `_buckets missing "${def.id}"`);
  }
});

test('ParticleEngine: initBuckets() positions buckets using defaultRelX/Y fractions', () => {
  const W = 800, H = 600;
  const canvas = makeMockCanvas(W, H);
  const engine = new ParticleEngine(canvas);
  engine.initBuckets(W, H);

  for (const def of BUCKET_DEFS) {
    const bucket = engine._buckets.get(def.id);
    assert.ok(bucket, `missing bucket "${def.id}"`);
    assert.equal(bucket.x, def.defaultRelX * W,
      `bucket "${def.id}" x should be ${def.defaultRelX * W}, got ${bucket.x}`);
    assert.equal(bucket.y, def.defaultRelY * H,
      `bucket "${def.id}" y should be ${def.defaultRelY * H}, got ${bucket.y}`);
  }
});

// ── Particle vx/vy/targetBucket ──────────────────────────────────────────────

test('ParticleEngine: spawned particle has vx/vy computed from src→dst / PARTICLE_DURATION_MS', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);

  // Coordinate-based spawn — no targetBucket
  const srcX = 50, srcY = 100, dstX = 550, dstY = 350;
  const p = engine.spawn(srcX, srcY, dstX, dstY, 'price_sensitive');

  assert.ok(p !== null, 'spawn should return a particle');
  assert.equal(typeof p.vx, 'number', 'particle should have vx');
  assert.equal(typeof p.vy, 'number', 'particle should have vy');

  const DURATION = 200;  // PARTICLE_DURATION_MS
  const expectedVx = (dstX - srcX) / DURATION;
  const expectedVy = (dstY - srcY) / DURATION;
  assert.ok(Math.abs(p.vx - expectedVx) < 0.001, `vx=${p.vx} expected≈${expectedVx}`);
  assert.ok(Math.abs(p.vy - expectedVy) < 0.001, `vy=${p.vy} expected≈${expectedVy}`);
});

test('ParticleEngine: coordinate-based spawn has targetBucket=null', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  const p = engine.spawn(10, 10, 500, 350, 'value_seeker');
  assert.ok(p !== null, 'spawn should return particle');
  assert.equal(p.targetBucket, null, 'coordinate-based spawn should have targetBucket=null');
});

test('ParticleEngine: ID-based spawn sets targetBucket to the product ID', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);

  // Register both nodes so ID-based spawn works
  engine.setArchPos('price_sensitive', 100, 80);
  engine.setProductPos('our_product', 300, 350);

  const p = engine.spawn('price_sensitive', 'our_product');
  assert.ok(p !== null, 'ID-based spawn should return a particle when positions registered');
  assert.equal(p.targetBucket, 'our_product', 'targetBucket should be the product ID');
});

// ── setProductPos: auto-registers bucket ────────────────────────────────────

test('ParticleEngine: setProductPos() auto-registers a bucket entry in _buckets', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);

  // Initially empty
  assert.equal(engine._buckets.size, 0);

  engine.setProductPos('our_product', 300, 350);
  assert.equal(engine._buckets.size, 1, 'should have 1 bucket after setProductPos');
  const bucket = engine._buckets.get('our_product');
  assert.ok(bucket, 'our_product bucket should exist');
  assert.equal(bucket.x, 300);
  assert.equal(bucket.y, 350);
  assert.equal(bucket.color, '#2563eb', 'our_product should have blue color');
});

test('ParticleEngine: setProdPos() is an alias for setProductPos()', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  engine.setProdPos('pass', 500, 340);
  const bucket = engine._buckets.get('pass');
  assert.ok(bucket, 'pass bucket should exist after setProdPos');
  assert.equal(bucket.x, 500);
  assert.equal(bucket.y, 340);
});

// ── Hit-detection: time-based (primary) ─────────────────────────────────────

test('ParticleEngine: particle deactivates when elapsed ≥ PARTICLE_DURATION_MS (200ms)', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  const p = engine.spawn(10, 10, 590, 390, 'trust_first');
  assert.ok(p !== null);
  assert.equal(p.active, true, 'particle should be active after spawn');

  // Advance past 200ms
  engine._update(201);
  assert.equal(p.active, false, 'particle should deactivate after elapsed > 200ms');
});

test('ParticleEngine: particle remains active before elapsed reaches 200ms', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  const p = engine.spawn(10, 10, 590, 390, 'urgency_buyer');
  assert.ok(p !== null);

  engine._update(100);  // half-way
  assert.equal(p.active, true, 'particle should still be active at t=0.5');
});

// ── Hit-detection: spatial (secondary) ──────────────────────────────────────

test('ParticleEngine: particle deactivates on spatial hit when within bucket hitRadius', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);

  // Bucket at (300, 350) with hitRadius=26 (competitor_a def)
  const bucketX = 300, bucketY = 350;
  engine.setProductPos('competitor_a', bucketX, bucketY);

  // Archetype at (10, 10), destination = bucket (300, 350)
  engine.setArchPos('promo_hunter', 10, 10);
  const p = engine.spawn('promo_hunter', 'competitor_a');
  assert.ok(p !== null, 'spawn should succeed');
  assert.equal(p.targetBucket, 'competitor_a');

  // Pre-set elapsed to ~95% of the journey (190ms out of 200ms) so that after
  // _update(1ms) the interpolated position is inside the bucket's 26px hitRadius.
  // At t=191/200=0.955: p.x≈287, p.y≈334 → dist to (300,350)≈20px < 26px ← HIT
  p.elapsed = 190;

  engine._update(1);  // advances elapsed to 191ms → t=0.955 → inside hitRadius

  assert.equal(p.active, false, 'particle should deactivate when within bucket hitRadius');
});

test('ParticleEngine: particle does NOT spatial-hit when targetBucket not in _buckets', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  // No buckets registered

  // Coordinate-based spawn (no targetBucket)
  const p = engine.spawn(10, 10, 300, 350, 'aesthetics_first');
  assert.ok(p !== null);
  // Place particle at destination coordinates
  p.x = 300;
  p.y = 350;

  engine._update(1);  // small dt, t << 1

  // Should NOT deactivate — no bucket registered
  assert.equal(p.active, true, 'should stay active when no bucket registered for hit-detection');
});

// ── initBuckets: uses SVG node positions when available ─────────────────────

test('ParticleEngine: initBuckets() prefers registered SVG positions over defaults', () => {
  const W = 600, H = 400;
  const canvas = makeMockCanvas(W, H);
  const engine = new ParticleEngine(canvas);

  // Register a real SVG position for our_product before initBuckets
  const realX = 123, realY = 321;
  engine.setProductPos('our_product', realX, realY);

  // Now call initBuckets — should preserve the registered position
  engine.initBuckets(W, H);

  const bucket = engine._buckets.get('our_product');
  assert.ok(bucket, 'our_product bucket should exist');
  assert.equal(bucket.x, realX, 'initBuckets should preserve registered SVG x position');
  assert.equal(bucket.y, realY, 'initBuckets should preserve registered SVG y position');
});

// ── Pool management ──────────────────────────────────────────────────────────

test('ParticleEngine: object pool supports 800 concurrent particles', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);

  engine.clearAll();
  let spawned = 0;
  const archetypes = Object.keys(ARCHETYPE_COLORS);
  for (let i = 0; i < 800; i++) {
    const id = archetypes[i % archetypes.length];
    const p = engine.spawn(10 + i, 10, 590 - i, 390, id);
    if (p !== null) spawned++;
  }
  assert.equal(spawned, 800, `expected 800 spawned, got ${spawned}`);
  assert.equal(engine.activeCount, 800);
});

test('ParticleEngine: clearAll() deactivates all particles', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);

  // Spawn a few
  engine.spawn(10, 10, 590, 390, 'price_sensitive');
  engine.spawn(20, 20, 580, 380, 'value_seeker');
  assert.ok(engine.activeCount > 0);

  engine.clearAll();
  assert.equal(engine.activeCount, 0);
});

// ── Sub-AC 6d: freeze() tests ────────────────────────────────────────────────

test('Sub-AC 6d — ParticleEngine: freeze() stops animation loop', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);

  // Initially not frozen
  assert.equal(engine.frozen, false, 'engine should not be frozen initially');
  assert.equal(engine.running, false, 'engine should not be running initially');

  // After freeze(), frozen is true and running is false
  engine.freeze();
  assert.equal(engine.frozen, true, 'engine.frozen must be true after freeze()');
  assert.equal(engine.running, false, 'engine.running must be false after freeze()');
});

test('Sub-AC 6d — ParticleEngine: freeze() preserves active particles (does not clear pool)', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);

  // Spawn a few particles
  engine.spawn(10, 10, 590, 390, 'price_sensitive');
  engine.spawn(20, 20, 580, 380, 'value_seeker');
  const countBefore = engine.activeCount;
  assert.ok(countBefore > 0, 'must have active particles before freeze');

  // freeze() should NOT clear the pool (unlike clearAll())
  engine.freeze();
  assert.equal(engine.activeCount, countBefore,
    'freeze() must NOT deactivate particles — they should remain at last positions');
});

test('Sub-AC 6d — ParticleEngine: start() after freeze() resets frozen state', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);

  engine.freeze();
  assert.equal(engine.frozen, true, 'engine should be frozen');

  // start() should reset frozen state
  engine.start();
  assert.equal(engine.frozen, false, 'start() must reset frozen state');
  assert.equal(engine.running, true, 'engine should be running after start()');

  engine.stop();
});

// ── Canvas element DOM attributes (tested indirectly via HTML read) ──────────

test('dashboard.html: particle-canvas element has correct data-testid and CSS attributes', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const html = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.html'),
    'utf8',
  );

  // Verify canvas element exists with data-testid
  assert.match(html, /data-testid="particle-canvas"/, 'particle-canvas data-testid should be present');
  // Verify pointer-events:none (allows mouse events to pass through to SVG)
  assert.match(html, /pointer-events:none/, 'canvas should have pointer-events:none');
  // Verify z-index:2 (above the SVG force-graph)
  assert.match(html, /z-index:2/, 'canvas should have z-index:2');
  // Verify position:absolute (overlaid on SVG)
  assert.match(html, /position:absolute/, 'canvas should be position:absolute');
});

test('dashboard.html: 5 product-node elements match BUCKET_DEFS ids', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const html = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.html'),
    'utf8',
  );

  for (const def of BUCKET_DEFS) {
    const pattern = new RegExp(`data-product-id="${def.id}"`);
    assert.match(html, pattern, `product node "${def.id}" not found in dashboard.html`);
  }
});

test('dashboard.js: imports ParticleEngine and calls initBuckets', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const js = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.js'),
    'utf8',
  );

  assert.match(js, /import \{.*ParticleEngine.*\}.*from.*particle-engine\.mjs/,
    'dashboard.js should import ParticleEngine from particle-engine.mjs');
  assert.match(js, /initBuckets/,
    'dashboard.js should call initBuckets() to set up static bucket layout');
  assert.match(js, /window\.particleEngine/,
    'dashboard.js should expose engine as window.particleEngine for tests');
});

// ── Sub-AC 4c: Product counter overlays & agent-count ────────────────────────

test('Sub-AC 4c — dashboard.html: product-counter-{id} SVG text elements exist for all 5 buckets', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const html = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.html'),
    'utf8',
  );

  const BUCKET_IDS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  for (const id of BUCKET_IDS) {
    const pattern = new RegExp(`data-testid="product-counter-${id}"`);
    assert.match(html, pattern, `product-counter-${id} data-testid not found in dashboard.html`);
  }
});

test('Sub-AC 4c — dashboard.html: product-counter elements have initial text "0"', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const html = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.html'),
    'utf8',
  );

  // Each product-counter should appear with initial text content of "0"
  // The SVG text element looks like: <text data-testid="product-counter-X" ...>0</text>
  const BUCKET_IDS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  for (const id of BUCKET_IDS) {
    // Pattern: data-testid="product-counter-{id}" ... >0<
    const pattern = new RegExp(`data-testid="product-counter-${id}"[^>]*>0<`);
    assert.match(html, pattern,
      `product-counter-${id} should have initial text "0" in dashboard.html`);
  }
});

test('Sub-AC 4c — dashboard.html: product-counter elements use class="product-counter"', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const html = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.html'),
    'utf8',
  );

  // Should have at least 5 occurrences of class="product-counter"
  const matches = html.match(/class="product-counter"/g) ?? [];
  assert.ok(matches.length >= 5,
    `Expected at least 5 elements with class="product-counter", found ${matches.length}`);
});

test('Sub-AC 4c — dashboard.html: agent-count element exists with correct data-testid', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const html = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.html'),
    'utf8',
  );

  assert.match(html, /data-testid="agent-count"/,
    'agent-count data-testid not found in dashboard.html');
});

test('Sub-AC 4c — dashboard.html: agent-count contains Korean suffix "에이전트 완료"', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const html = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.html'),
    'utf8',
  );

  assert.match(html, /에이전트 완료/,
    'dashboard.html should contain "에이전트 완료" text for agent-count display');
});

test('Sub-AC 4c — dashboard.html: agent-count has aria-live="polite" for accessibility', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const html = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.html'),
    'utf8',
  );

  // The agent-count element should have aria-live="polite" for screen readers
  assert.match(html, /data-testid="agent-count"[\s\S]{0,200}aria-live="polite"/,
    'agent-count element should have aria-live="polite" for accessibility');
});

test('Sub-AC 4c — dashboard.html: agent-count initially hidden (display:none)', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const html = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.html'),
    'utf8',
  );

  // The agent-count element should have display:none as its initial inline style
  assert.match(html, /data-testid="agent-count"[\s\S]{0,200}display:none/,
    'agent-count element should start hidden (display:none) until first agent_decision');
});

test('Sub-AC 4c — dashboard.js: defines updateAgentCount() and resetAgentCount() functions', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const js = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.js'),
    'utf8',
  );

  assert.match(js, /function updateAgentCount/,
    'dashboard.js should define updateAgentCount() function');
  assert.match(js, /function resetAgentCount/,
    'dashboard.js should define resetAgentCount() function');
});

test('Sub-AC 4c — dashboard.js: defines incrementProductCounter() and resetProductCounters()', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const js = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.js'),
    'utf8',
  );

  assert.match(js, /function incrementProductCounter/,
    'dashboard.js should define incrementProductCounter() function');
  assert.match(js, /function resetProductCounters/,
    'dashboard.js should define resetProductCounters() function');
});

test('Sub-AC 4c — dashboard.js: updateAgentCount() called on agent_decision SSE event', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const js = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.js'),
    'utf8',
  );

  // The agent_decision handler must call updateAgentCount
  // Check that agent_decision case includes a call to updateAgentCount
  assert.match(js, /case 'agent_decision'[\s\S]{0,400}updateAgentCount/,
    'dashboard.js agent_decision handler should call updateAgentCount()');
});

test('Sub-AC 4c — dashboard.js: incrementProductCounter() called after particle animation (~220ms)', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const js = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.js'),
    'utf8',
  );

  // Should use setTimeout to delay counter increment until particle arrives
  assert.match(js, /setTimeout[\s\S]{0,100}incrementProductCounter/,
    'dashboard.js should use setTimeout to delay incrementProductCounter until particle arrives');
});

test('Sub-AC 4c — dashboard.js: agent-count text format follows "{n} / {total} 에이전트 완료" pattern', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const js = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.js'),
    'utf8',
  );

  // updateAgentCount must produce the Korean format text
  assert.match(js, /에이전트 완료/,
    'dashboard.js should produce "에이전트 완료" text in agent count display');
  // Must use template literal or string concatenation with "/ {total}"
  assert.match(js, /\/.*에이전트 완료/,
    'dashboard.js agent count text should contain "/ {total} 에이전트 완료" pattern');
});

test('Sub-AC 4c — dashboard.html: archetype-summary-table exists with correct data-testid', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const html = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.html'),
    'utf8',
  );

  assert.match(html, /data-testid="archetype-summary-table"/,
    'archetype-summary-table data-testid not found in dashboard.html');
});

test('Sub-AC 4c — dashboard.html: archetype-summary-table initially hidden (display:none)', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const html = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.html'),
    'utf8',
  );

  // archetype-summary-wrap should start hidden
  assert.match(html, /id="archetype-summary-wrap"[\s\S]{0,100}display:none/,
    'archetype-summary-wrap should be initially hidden (display:none)');
});

test('Sub-AC 4c — dashboard.js: renderArchetypeSummary() defined and called on iteration_complete', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const js = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.js'),
    'utf8',
  );

  assert.match(js, /function renderArchetypeSummary/,
    'dashboard.js should define renderArchetypeSummary() function');
  assert.match(js, /case 'iteration_complete'[\s\S]{0,800}renderArchetypeSummary/,
    'dashboard.js iteration_complete handler should call renderArchetypeSummary()');
});

test('Sub-AC 4c — dashboard.js: resetProductCounters() called on iteration_start', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const js = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.js'),
    'utf8',
  );

  assert.match(js, /case 'iteration_start'[\s\S]{0,800}resetProductCounters/,
    'dashboard.js iteration_start handler should call resetProductCounters()');
});

test('Sub-AC 4c — styles.css: .agent-count-display class defined', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const css = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/styles.css'),
    'utf8',
  );

  assert.match(css, /\.agent-count-display\s*\{/,
    'styles.css should define .agent-count-display CSS class');
});

test('Sub-AC 4c — styles.css: .product-counter class defined', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const css = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/styles.css'),
    'utf8',
  );

  assert.match(css, /\.product-counter\s*\{/,
    'styles.css should define .product-counter CSS class');
});

test('Sub-AC 4c — styles.css: .archetype-summary class defined', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const css = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/styles.css'),
    'utf8',
  );

  assert.match(css, /\.archetype-summary\s*\{/,
    'styles.css should define .archetype-summary CSS class');
});

// ── Sub-AC 4b: SSE agent_decision → particle spawner wiring ──────────────────

test('Sub-AC 4b — dashboard.js: spawnForAgent() called in agent_decision SSE event handler', async () => {
  const fs   = await import('node:fs/promises');
  const path = await import('node:path');
  const js   = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.js'),
    'utf8',
  );

  // The agent_decision case must call _particleEngine.spawnForAgent (or spawn)
  // with archetype_id and chosen_product from the event data
  assert.match(js, /spawnForAgent|\.spawn\s*\(/,
    'dashboard.js must call spawnForAgent() or spawn() on agent_decision events');

  // Verify the call is inside or near the agent_decision handler
  assert.match(js, /agent_decision[\s\S]{1,800}spawnForAgent|spawnForAgent[\s\S]{1,800}agent_decision/,
    'spawnForAgent() must be called near the agent_decision event handler');
});

test('Sub-AC 4b — dashboard.js: archetype_id and chosen_product are passed to particle spawner', async () => {
  const fs   = await import('node:fs/promises');
  const path = await import('node:path');
  const js   = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.js'),
    'utf8',
  );

  // spawnForAgent should receive archetype_id and chosen_product from the SSE data
  assert.match(js, /spawnForAgent\s*\(\s*data\.archetype_id\s*,\s*data\.chosen_product\s*\)/,
    'spawnForAgent() must be called with data.archetype_id and data.chosen_product');
});

test('Sub-AC 4b — dashboard.js: agent-count display updated on agent_decision event', async () => {
  const fs   = await import('node:fs/promises');
  const path = await import('node:path');
  const js   = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.js'),
    'utf8',
  );

  // updateAgentCount should be called in agent_decision with data.agent_total
  assert.match(js, /updateAgentCount\s*\(\s*data\.agent_total\s*\)/,
    'updateAgentCount(data.agent_total) must be called in the agent_decision handler');
});

test('Sub-AC 4b — dashboard.js: agent-count text uses Korean "에이전트 완료" suffix', async () => {
  const fs   = await import('node:fs/promises');
  const path = await import('node:path');
  const js   = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.js'),
    'utf8',
  );

  // The agent count display format must use Korean suffix
  assert.match(js, /에이전트 완료/,
    'dashboard.js must contain Korean "에이전트 완료" for agent count display');

  // The format must include both current and total counters separated by " / "
  assert.match(js, /\$\{_agentCountCurrent\}.*\/.*\$\{_agentCountTotal\}/,
    'agent-count text must follow "{current} / {total} 에이전트 완료" pattern');
});

test('Sub-AC 4b — dashboard.html: agent-count element has data-testid="agent-count"', async () => {
  const fs   = await import('node:fs/promises');
  const path = await import('node:path');
  const html = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.html'),
    'utf8',
  );

  assert.match(html, /data-testid="agent-count"/,
    'dashboard.html must have data-testid="agent-count" element');
});

test('Sub-AC 4b — dashboard.js: _particleEngine initialized and exposed as window.particleEngine', async () => {
  const fs   = await import('node:fs/promises');
  const path = await import('node:path');
  const js   = await fs.readFile(
    path.resolve(process.cwd(), 'src/app/dashboard.js'),
    'utf8',
  );

  assert.match(js, /new ParticleEngine\s*\(/,
    'dashboard.js must create a new ParticleEngine instance');
  assert.match(js, /window\.particleEngine\s*=\s*_particleEngine/,
    'dashboard.js must expose engine as window.particleEngine');
});

test('Sub-AC 4b — ParticleEngine: spawnForAgent() delegates to spawn() with archetype and product IDs', () => {
  // The ParticleEngine already has spawnForAgent() as an alias for spawn() per particle-engine.mjs
  // This test verifies the method exists and returns a Particle (or null if pool empty)
  const canvas = makeMockCanvas(300, 200);
  const engine = new ParticleEngine(canvas);

  // Register positions for a test archetype and product
  engine.setArchPos('price_sensitive', 150, 80);
  engine.setProductPos('our_product', 150, 170);
  engine.initBuckets(300, 200);

  // spawnForAgent should successfully spawn a particle when positions are registered
  const p = engine.spawnForAgent('price_sensitive', 'our_product');
  assert.notEqual(p, null, 'spawnForAgent() should return a Particle when positions are registered');
  assert.equal(p.active, true, 'spawned particle should be active');
  assert.equal(p.targetBucket, 'our_product', 'spawned particle target bucket should be our_product');
});

test('Sub-AC 4b — ParticleEngine: spawnForAgent() returns null when archetype position not registered', () => {
  const canvas = makeMockCanvas(300, 200);
  const engine = new ParticleEngine(canvas);
  // Only register product, not archetype
  engine.setProductPos('our_product', 150, 170);

  // Without archetype position, spawn should return null gracefully
  const p = engine.spawnForAgent('unregistered_archetype', 'our_product');
  assert.equal(p, null, 'spawnForAgent() must return null when archetype position is not registered');
});
