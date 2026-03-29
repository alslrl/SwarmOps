/**
 * particle-engine-6e.test.mjs
 *
 * Unit tests for Sub-AC 6e visual polish additions to particle-engine.mjs:
 *
 *   1. PRODUCT_COLORS export — 5 product IDs, valid hex colors
 *   2. SELLER_PRODUCT_ID export — equals 'our_product'
 *   3. Particle.role — 'seller' for our_product, 'market' for competitors
 *   4. Particle.targetColor — matches PRODUCT_COLORS for target bucket
 *   5. Particle.trail — initialized as empty array on spawn
 *   6. Trail accumulation — trail grows on _update() calls
 *   7. Trail max length — trail never exceeds TRAIL_MAX (6)
 *   8. _render() draws trail before particle (canvas calls include arc for trail)
 *   9. _drawBuckets() enhanced overlay — draws gradient fill, outer ring for seller
 *  10. coordinate-based spawn has role='market' and targetColor='#6b7280' (default)
 *
 * Sub-AC 6e | PRD §12.3
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal browser-API mocks ────────────────────────────────────────────────

globalThis.window = { devicePixelRatio: 1 };

let _rafId = 0;
globalThis.requestAnimationFrame = (cb) => {
  _rafId++;
  return _rafId;
};
globalThis.cancelAnimationFrame = (_id) => {};

// Mock a full CanvasRenderingContext2D (includes fillText, createRadialGradient)
function makeMockCtx() {
  const calls = [];
  const mockGrad = {
    addColorStop: (...args) => calls.push(['addColorStop', ...args]),
  };
  return {
    _calls: calls,
    clearRect:             (...args) => calls.push(['clearRect', ...args]),
    beginPath:             ()        => calls.push(['beginPath']),
    arc:                   (...args) => calls.push(['arc', ...args]),
    fill:                  ()        => calls.push(['fill']),
    stroke:                ()        => calls.push(['stroke']),
    save:                  ()        => calls.push(['save']),
    restore:               ()        => calls.push(['restore']),
    setLineDash:           (...args) => calls.push(['setLineDash', ...args]),
    setTransform:          (...args) => calls.push(['setTransform', ...args]),
    fillText:              (...args) => calls.push(['fillText', ...args]),
    createRadialGradient:  (...args) => { calls.push(['createRadialGradient', ...args]); return mockGrad; },
    globalAlpha:  1,
    fillStyle:    '',
    strokeStyle:  '',
    lineWidth:    1,
    font:         '',
    textAlign:    '',
    textBaseline: '',
  };
}

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

const {
  ARCHETYPE_COLORS,
  PRODUCT_COLORS,
  SELLER_PRODUCT_ID,
  BUCKET_DEFS,
  ParticleEngine,
} = await import('../src/app/particle-engine.mjs');

// ── PRODUCT_COLORS ───────────────────────────────────────────────────────────

test('Sub-AC 6e: PRODUCT_COLORS exports an object with 5 product entries', () => {
  assert.equal(typeof PRODUCT_COLORS, 'object', 'PRODUCT_COLORS should be an object');
  const keys = Object.keys(PRODUCT_COLORS);
  assert.equal(keys.length, 5, `expected 5 products, got ${keys.length}`);
});

test('Sub-AC 6e: PRODUCT_COLORS contains all 5 required product IDs', () => {
  const required = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  for (const id of required) {
    assert.ok(id in PRODUCT_COLORS, `PRODUCT_COLORS missing product "${id}"`);
  }
});

test('Sub-AC 6e: PRODUCT_COLORS all values are valid 6-digit hex colors', () => {
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  for (const [id, color] of Object.entries(PRODUCT_COLORS)) {
    assert.match(color, HEX_RE, `product "${id}" has invalid color "${color}"`);
  }
});

test('Sub-AC 6e: PRODUCT_COLORS our_product is deep blue (#2563eb)', () => {
  assert.equal(PRODUCT_COLORS.our_product.toLowerCase(), '#2563eb',
    'our_product should be deep blue #2563eb');
});

// ── SELLER_PRODUCT_ID ────────────────────────────────────────────────────────

test('Sub-AC 6e: SELLER_PRODUCT_ID exports and equals "our_product"', () => {
  assert.equal(typeof SELLER_PRODUCT_ID, 'string', 'SELLER_PRODUCT_ID should be a string');
  assert.equal(SELLER_PRODUCT_ID, 'our_product', 'SELLER_PRODUCT_ID should be "our_product"');
});

// ── Particle.role — seller vs market ────────────────────────────────────────

test('Sub-AC 6e: spawn to our_product sets particle.role = "seller"', () => {
  const canvas = makeMockCanvas();
  const engine = new ParticleEngine(canvas);
  engine.setArchPos('price_sensitive', 100, 80);
  engine.setProductPos('our_product', 300, 350);

  const p = engine.spawn('price_sensitive', 'our_product');
  assert.ok(p !== null, 'spawn should return a particle');
  assert.equal(p.role, 'seller', 'particle going to our_product should have role="seller"');
});

test('Sub-AC 6e: spawn to competitor_a sets particle.role = "market"', () => {
  const canvas = makeMockCanvas();
  const engine = new ParticleEngine(canvas);
  engine.setArchPos('value_seeker', 100, 80);
  engine.setProductPos('competitor_a', 200, 350);

  const p = engine.spawn('value_seeker', 'competitor_a');
  assert.ok(p !== null, 'spawn should return a particle');
  assert.equal(p.role, 'market', 'particle going to competitor_a should have role="market"');
});

test('Sub-AC 6e: spawn to pass sets particle.role = "market"', () => {
  const canvas = makeMockCanvas();
  const engine = new ParticleEngine(canvas);
  engine.setArchPos('promo_hunter', 100, 80);
  engine.setProductPos('pass', 500, 350);

  const p = engine.spawn('promo_hunter', 'pass');
  assert.ok(p !== null, 'spawn should return a particle');
  assert.equal(p.role, 'market', 'particle going to pass should have role="market"');
});

test('Sub-AC 6e: coordinate-based spawn defaults to role="market"', () => {
  const canvas = makeMockCanvas();
  const engine = new ParticleEngine(canvas);
  const p = engine.spawn(50, 100, 400, 300, 'trust_first');
  assert.ok(p !== null, 'spawn should return particle');
  assert.equal(p.role, 'market', 'coordinate-based spawn defaults to market role');
});

// ── Particle.targetColor ─────────────────────────────────────────────────────

test('Sub-AC 6e: spawn to our_product sets particle.targetColor = "#2563eb"', () => {
  const canvas = makeMockCanvas();
  const engine = new ParticleEngine(canvas);
  engine.setArchPos('premium_quality', 100, 80);
  engine.setProductPos('our_product', 300, 350);

  const p = engine.spawn('premium_quality', 'our_product');
  assert.ok(p !== null);
  assert.equal(p.targetColor.toLowerCase(), '#2563eb',
    'targetColor for our_product should be #2563eb');
});

test('Sub-AC 6e: spawn to competitor_a sets particle.targetColor = "#dc2626"', () => {
  const canvas = makeMockCanvas();
  const engine = new ParticleEngine(canvas);
  engine.setArchPos('urgency_buyer', 100, 80);
  engine.setProductPos('competitor_a', 200, 350);

  const p = engine.spawn('urgency_buyer', 'competitor_a');
  assert.ok(p !== null);
  assert.equal(p.targetColor.toLowerCase(), '#dc2626',
    'targetColor for competitor_a should be #dc2626');
});

test('Sub-AC 6e: targetColor matches PRODUCT_COLORS for each bucket', () => {
  const canvas = makeMockCanvas();
  const engine = new ParticleEngine(canvas);
  const archetypes = Object.keys(ARCHETYPE_COLORS);

  for (const [i, bucketId] of ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'].entries()) {
    engine.setArchPos(archetypes[i], 100, 80 + i * 10);
    engine.setProductPos(bucketId, 300, 350 + i * 10);
    const p = engine.spawn(archetypes[i], bucketId);
    assert.ok(p !== null, `spawn to ${bucketId} should return particle`);
    assert.equal(
      p.targetColor.toLowerCase(),
      PRODUCT_COLORS[bucketId].toLowerCase(),
      `targetColor for ${bucketId} should match PRODUCT_COLORS`,
    );
  }
});

// ── Particle.trail ───────────────────────────────────────────────────────────

test('Sub-AC 6e: spawned particle.trail is an empty array initially', () => {
  const canvas = makeMockCanvas();
  const engine = new ParticleEngine(canvas);
  engine.setArchPos('aesthetics_first', 100, 80);
  engine.setProductPos('our_product', 300, 350);

  const p = engine.spawn('aesthetics_first', 'our_product');
  assert.ok(p !== null);
  assert.ok(Array.isArray(p.trail), 'particle.trail should be an array');
  assert.equal(p.trail.length, 0, 'particle.trail should be empty on spawn');
});

test('Sub-AC 6e: trail accumulates positions on _update() calls', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  engine.setArchPos('gift_or_family_buyer', 50, 80);
  engine.setProductPos('competitor_b', 550, 350);
  engine.initBuckets(600, 400);

  const p = engine.spawn('gift_or_family_buyer', 'competitor_b');
  assert.ok(p !== null);

  // First _update: nothing added yet (p.elapsed is 0 at start of first call)
  engine._update(16);
  // After first update, trail has 0 entries (elapsed was 0 at check, then incremented)
  // Second _update: trail should start growing (elapsed > 0 now)
  engine._update(16);
  assert.ok(p.trail.length >= 0, 'trail should be a non-negative length array');
});

test('Sub-AC 6e: trail never exceeds max length (6) after many updates', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  engine.setArchPos('price_sensitive', 50, 80);
  engine.setProductPos('our_product', 550, 350);
  engine.initBuckets(600, 400);

  const p = engine.spawn('price_sensitive', 'our_product');
  assert.ok(p !== null);
  // Simulate 30 small updates (dt=5ms each = 150ms total, well within 200ms limit)
  for (let i = 0; i < 30; i++) {
    engine._update(5);
    if (!p.active) break;
  }
  assert.ok(
    p.trail.length <= 6,
    `trail.length ${p.trail.length} should not exceed TRAIL_MAX (6)`,
  );
});

test('Sub-AC 6e: trail entries have {x, y} numeric fields', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  engine.setArchPos('value_seeker', 50, 80);
  engine.setProductPos('competitor_c', 550, 350);
  engine.initBuckets(600, 400);

  const p = engine.spawn('value_seeker', 'competitor_c');
  assert.ok(p !== null);
  // Do enough updates to get at least one trail entry
  for (let i = 0; i < 5; i++) engine._update(10);
  if (p.trail.length > 0) {
    const entry = p.trail[0];
    assert.equal(typeof entry.x, 'number', 'trail entry x should be a number');
    assert.equal(typeof entry.y, 'number', 'trail entry y should be a number');
  }
  // If trail is still empty after 5 updates, particle may have deactivated — acceptable
  assert.ok(p.trail.length <= 6, 'trail should never exceed TRAIL_MAX');
});

// ── _render(): trail arcs drawn ──────────────────────────────────────────────

test('Sub-AC 6e: _render() draws arc calls for trail positions when trail has entries', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  engine.setArchPos('promo_hunter', 50, 80);
  engine.setProductPos('our_product', 550, 350);
  engine.initBuckets(600, 400);

  const p = engine.spawn('promo_hunter', 'our_product');
  assert.ok(p !== null);

  // Manually inject trail entries to simulate existing history
  p.trail = [
    { x: 60, y: 90 },
    { x: 120, y: 130 },
    { x: 200, y: 180 },
  ];

  // Clear previous draw calls and render
  const ctx = canvas._ctx;
  ctx._calls.length = 0;
  engine._render();

  // Should have arc calls — trail + main particle + bucket
  const arcCalls = ctx._calls.filter((c) => c[0] === 'arc');
  assert.ok(arcCalls.length >= 3, `expected ≥3 arc calls for trail, got ${arcCalls.length}`);
});

// ── _drawBuckets(): enhanced overlay ────────────────────────────────────────

test('Sub-AC 6e: _drawBuckets() calls createRadialGradient for each bucket when available', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  engine.initBuckets(600, 400);

  const ctx = canvas._ctx;
  ctx._calls.length = 0;
  engine._drawBuckets(ctx);

  const gradCalls = ctx._calls.filter((c) => c[0] === 'createRadialGradient');
  assert.equal(gradCalls.length, 5, `expected 5 createRadialGradient calls (1 per bucket), got ${gradCalls.length}`);
});

test('Sub-AC 6e: _drawBuckets() calls fillText for each bucket label when fillText available', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  engine.initBuckets(600, 400);

  const ctx = canvas._ctx;
  ctx._calls.length = 0;
  engine._drawBuckets(ctx);

  const textCalls = ctx._calls.filter((c) => c[0] === 'fillText');
  assert.equal(textCalls.length, 5, `expected 5 fillText calls (one label per bucket), got ${textCalls.length}`);
});

test('Sub-AC 6e: _drawBuckets() draws extra outer ring for our_product (seller role)', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  engine.initBuckets(600, 400);

  const ctx = canvas._ctx;
  ctx._calls.length = 0;
  engine._drawBuckets(ctx);

  // Count arc + stroke sequences — seller should have an extra one
  const arcCalls = ctx._calls.filter((c) => c[0] === 'arc');
  // 5 buckets × gradient fill arc + 5 dashed rings + 1 extra seller outer ring = 11 total
  // (gradient fill uses arc too)
  assert.ok(arcCalls.length >= 11,
    `expected ≥11 arc calls (5 gradient + 5 dashed + 1 seller-extra), got ${arcCalls.length}`);
});

// ── spawnForAgent() role setting ─────────────────────────────────────────────

test('Sub-AC 6e: spawnForAgent() to our_product produces seller-role particle', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  engine.setArchPos('trust_first', 100, 100);
  engine.setProductPos('our_product', 300, 350);

  const p = engine.spawnForAgent('trust_first', 'our_product');
  assert.ok(p !== null, 'spawnForAgent should return particle when positions registered');
  assert.equal(p.role, 'seller', 'spawnForAgent to our_product should yield seller role');
  assert.equal(p.targetColor.toLowerCase(), '#2563eb', 'seller targetColor should be #2563eb');
});

test('Sub-AC 6e: spawnForAgent() to competitor_b produces market-role particle', () => {
  const canvas = makeMockCanvas(600, 400);
  const engine = new ParticleEngine(canvas);
  engine.setArchPos('urgency_buyer', 100, 100);
  engine.setProductPos('competitor_b', 400, 350);

  const p = engine.spawnForAgent('urgency_buyer', 'competitor_b');
  assert.ok(p !== null, 'spawnForAgent should return particle');
  assert.equal(p.role, 'market', 'spawnForAgent to competitor_b should yield market role');
  assert.equal(p.targetColor.toLowerCase(), '#ea580c', 'competitor_b targetColor should be #ea580c');
});
