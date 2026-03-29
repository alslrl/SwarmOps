/**
 * tests/sim-event-bus.test.mjs
 *
 * Sub-AC 3a: Unit tests for the SimEventBus typed event bus.
 *
 * Verifies:
 *   1. SimEventBus class is defined and instantiable from dashboard.js source
 *   2. on(type, handler) receives data for matching event types
 *   3. on() does NOT fire for non-matching event types
 *   4. onAny(handler) receives (type, data) for every emitted event
 *   5. agent_decision events correctly expose chosen_product and archetype_id
 *   6. Unsubscribe function returned by on() stops future deliveries
 *   7. clear() removes all handlers
 *   8. Multiple subscribers on the same event all receive the payload
 *   9. emit() with an unknown type does not throw
 *  10. window.simEventBus is exposed on the simulated global
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Minimal browser-API shim for evaluating dashboard.js in Node.js
// We only need enough to bootstrap SimEventBus without crashing on DOM APIs.
// ---------------------------------------------------------------------------

function makeShimmedContext() {
  const shim = {
    // SimEventBus only needs these from the global scope
    window: null,         // will be self-referential after assignment
    document: {
      querySelector:    () => null,
      querySelectorAll: () => [],
      getElementById:   () => null,
      createElement:    (tag) => ({
        style: {}, className: '', textContent: '',
        setAttribute: () => {}, appendChild: () => {}, remove: () => {},
        removeChild: () => {},
      }),
      addEventListener: () => {},
    },
    requestAnimationFrame: () => {},
    cancelAnimationFrame:  () => {},
    performance:           { now: () => Date.now() },
    // Intl shim (used by formatKRW)
    Intl: globalThis.Intl,
  };
  shim.window = shim;
  return shim;
}

// ---------------------------------------------------------------------------
// Extract SimEventBus source from dashboard.js and evaluate it in isolation
// ---------------------------------------------------------------------------

/**
 * Returns a new SimEventBus instance by extracting the class definition
 * from dashboard.js and evaluating it in a shimmed context.
 */
async function loadSimEventBus() {
  const dashboardPath = path.resolve(__dirname, '..', 'src', 'app', 'dashboard.js');
  const source = await fs.readFile(dashboardPath, 'utf8');

  // Extract just the SimEventBus class definition (bounded by the class block)
  const classMatch = source.match(/class SimEventBus \{[\s\S]*?\n\}/);
  assert.ok(classMatch, 'SimEventBus class must be present in dashboard.js');

  const classSource = classMatch[0];

  // Evaluate in an isolated Function scope with a minimal window shim
  const shim = makeShimmedContext();

  // Use Function constructor for cross-ESM eval — returns the class constructor
  // eslint-disable-next-line no-new-func
  const factory = new Function('window', `${classSource}\nreturn SimEventBus;`);
  const SimEventBusCtor = factory(shim);

  assert.strictEqual(typeof SimEventBusCtor, 'function', 'SimEventBus must be a constructor function');
  return SimEventBusCtor;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('Sub-AC 3a: SimEventBus class is present in dashboard.js source', async () => {
  const dashboardPath = path.resolve(__dirname, '..', 'src', 'app', 'dashboard.js');
  const source = await fs.readFile(dashboardPath, 'utf8');
  assert.match(source, /class SimEventBus/, 'SimEventBus class must be defined in dashboard.js');
});

test('Sub-AC 3a: window.simEventBus is assigned in dashboard.js source', async () => {
  const dashboardPath = path.resolve(__dirname, '..', 'src', 'app', 'dashboard.js');
  const source = await fs.readFile(dashboardPath, 'utf8');
  assert.match(source, /window\.simEventBus\s*=\s*simEventBus/, 'window.simEventBus must be exposed globally');
});

test('Sub-AC 3a: simEventBus.onAny is registered with handleSSEEvent', async () => {
  const dashboardPath = path.resolve(__dirname, '..', 'src', 'app', 'dashboard.js');
  const source = await fs.readFile(dashboardPath, 'utf8');
  assert.match(
    source,
    /simEventBus\.onAny\(\s*\([^)]*\)\s*=>\s*handleSSEEvent/,
    'simEventBus.onAny must register handleSSEEvent as a wildcard handler'
  );
});

test('Sub-AC 3a: dispatch() in runSimulation calls simEventBus.emit', async () => {
  const dashboardPath = path.resolve(__dirname, '..', 'src', 'app', 'dashboard.js');
  const source = await fs.readFile(dashboardPath, 'utf8');
  assert.match(
    source,
    /simEventBus\.emit\(type,\s*data\)/,
    'dispatch() inside runSimulation must call simEventBus.emit(type, data)'
  );
});

test('Sub-AC 3a: SimEventBus.on() delivers event data to typed handler', async () => {
  const SimEventBus = await loadSimEventBus();
  const bus = new SimEventBus();

  const received = [];
  bus.on('agent_decision', (data) => received.push(data));

  const payload = { archetype_id: 'price_sensitive', chosen_product: 'our_product', agent_index: 0, agent_total: 800 };
  bus.emit('agent_decision', payload);

  assert.strictEqual(received.length, 1, 'Handler must receive exactly one call');
  assert.strictEqual(received[0].archetype_id,   'price_sensitive', 'archetype_id must match');
  assert.strictEqual(received[0].chosen_product, 'our_product',     'chosen_product must match');
});

test('Sub-AC 3a: SimEventBus.on() does NOT fire for non-matching event types', async () => {
  const SimEventBus = await loadSimEventBus();
  const bus = new SimEventBus();

  let called = false;
  bus.on('agent_decision', () => { called = true; });
  bus.emit('iteration_start', { iteration: 1, total: 5 });

  assert.strictEqual(called, false, 'Handler must not be called for non-matching event type');
});

test('Sub-AC 3a: SimEventBus.onAny() receives all event types with (type, data)', async () => {
  const SimEventBus = await loadSimEventBus();
  const bus = new SimEventBus();

  const received = [];
  bus.onAny((type, data) => received.push({ type, data }));

  bus.emit('iteration_start',    { iteration: 1 });
  bus.emit('agent_decision',     { archetype_id: 'trust_first', chosen_product: 'pass' });
  bus.emit('iteration_complete', { iteration: 1, accepted: true });

  assert.strictEqual(received.length, 3, 'onAny handler must receive all three events');
  assert.strictEqual(received[0].type, 'iteration_start');
  assert.strictEqual(received[1].type, 'agent_decision');
  assert.strictEqual(received[2].type, 'iteration_complete');
});

test('Sub-AC 3a: agent_decision payload exposes chosen_product and archetype_id', async () => {
  const SimEventBus = await loadSimEventBus();
  const bus = new SimEventBus();

  /** @type {Array<{archetype_id: string, chosen_product: string}>} */
  const decisions = [];
  bus.on('agent_decision', (data) => {
    decisions.push({ archetype_id: data.archetype_id, chosen_product: data.chosen_product });
  });

  // Emit a set of representative agent_decision payloads
  const testCases = [
    { archetype_id: 'price_sensitive',      chosen_product: 'our_product'  },
    { archetype_id: 'value_seeker',         chosen_product: 'competitor_a' },
    { archetype_id: 'premium_quality',      chosen_product: 'competitor_b' },
    { archetype_id: 'trust_first',          chosen_product: 'pass'         },
    { archetype_id: 'gift_or_family_buyer', chosen_product: 'competitor_c' },
  ];

  for (const tc of testCases) {
    bus.emit('agent_decision', { ...tc, agent_index: 0, agent_total: 800, reasoning: '' });
  }

  assert.strictEqual(decisions.length, testCases.length, 'All decisions must be delivered');

  const validChoices = new Set(['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']);
  for (const d of decisions) {
    assert.ok(typeof d.archetype_id   === 'string' && d.archetype_id.length > 0,   `archetype_id must be a non-empty string, got: ${JSON.stringify(d.archetype_id)}`);
    assert.ok(validChoices.has(d.chosen_product), `chosen_product "${d.chosen_product}" must be a valid choice key`);
  }
});

test('Sub-AC 3a: on() returns an unsubscribe function that stops delivery', async () => {
  const SimEventBus = await loadSimEventBus();
  const bus = new SimEventBus();

  let count = 0;
  const unsub = bus.on('iteration_start', () => { count++; });

  bus.emit('iteration_start', { iteration: 1 });
  assert.strictEqual(count, 1, 'Handler should fire before unsubscribe');

  unsub(); // unsubscribe

  bus.emit('iteration_start', { iteration: 2 });
  assert.strictEqual(count, 1, 'Handler must NOT fire after unsubscribe');
});

test('Sub-AC 3a: clear() removes all handlers', async () => {
  const SimEventBus = await loadSimEventBus();
  const bus = new SimEventBus();

  let fires = 0;
  bus.on('agent_decision',  () => { fires++; });
  bus.onAny(              () => { fires++; });

  bus.emit('agent_decision', { archetype_id: 'urgency_buyer', chosen_product: 'our_product' });
  assert.strictEqual(fires, 2, 'Both handlers should fire before clear');

  bus.clear();
  fires = 0;

  bus.emit('agent_decision', { archetype_id: 'promo_hunter', chosen_product: 'pass' });
  assert.strictEqual(fires, 0, 'No handlers should fire after clear()');
});

test('Sub-AC 3a: multiple subscribers on the same event all receive the payload', async () => {
  const SimEventBus = await loadSimEventBus();
  const bus = new SimEventBus();

  const log = [];
  bus.on('agent_decision', (d) => log.push(`h1:${d.chosen_product}`));
  bus.on('agent_decision', (d) => log.push(`h2:${d.archetype_id}`));
  bus.on('agent_decision', (d) => log.push(`h3:${d.agent_index}`));

  bus.emit('agent_decision', { archetype_id: 'aesthetics_first', chosen_product: 'competitor_a', agent_index: 42, agent_total: 800 });

  assert.strictEqual(log.length, 3, 'All three handlers must be called');
  assert.ok(log.includes('h1:competitor_a'), 'h1 must receive chosen_product');
  assert.ok(log.includes('h2:aesthetics_first'), 'h2 must receive archetype_id');
  assert.ok(log.includes('h3:42'), 'h3 must receive agent_index');
});

test('Sub-AC 3a: emit() with unknown type does not throw', async () => {
  const SimEventBus = await loadSimEventBus();
  const bus = new SimEventBus();

  // Should silently no-op — no handlers registered for this type
  assert.doesNotThrow(() => {
    bus.emit('unknown_event_type_xyz', { foo: 'bar' });
  });
});
