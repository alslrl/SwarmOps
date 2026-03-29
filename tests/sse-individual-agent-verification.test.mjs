/**
 * Sub-AC 3d — Individual-Agent SSE Verification Test
 *
 * Runs the /api/run/stream endpoint for exactly ONE iteration and asserts the
 * following mandatory event-count invariants:
 *
 *   ✓  exactly 800   events of type `agent_decision`
 *   ✗  exactly 0     events of type `archetype_evaluated`  (batch mode is gone)
 *   ✓  exactly 1     event  of type `iteration_start`
 *   ✓  exactly 1     event  of type `iteration_complete`
 *   ✓  exactly 1     event  of type `holdout_start`
 *   ✓  exactly 1     event  of type `simulation_complete`
 *
 * The server is started in-process with modelMode=mock so no live OpenAI
 * calls are made; the test is safe to run in CI.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/server.mjs';

// ---------------------------------------------------------------------------
// SSE helpers (self-contained — no shared import)
// ---------------------------------------------------------------------------

/**
 * Parse raw SSE text into an array of { type, data } objects.
 * Handles partial buffers by splitting on double-newlines.
 */
function parseSseChunk(raw) {
  const events = [];
  const blocks = raw.split(/\n\n+/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    let eventType = 'message';
    let dataLine = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice('event: '.length).trim();
      } else if (line.startsWith('data: ')) {
        dataLine = line.slice('data: '.length).trim();
      }
    }
    if (dataLine) {
      try {
        events.push({ type: eventType, data: JSON.parse(dataLine) });
      } catch {
        // Ignore malformed data lines (keep parsing remainder)
      }
    }
  }
  return events;
}

/**
 * POST to /api/run/stream on a running http.Server and collect ALL SSE events.
 * Resolves with the ordered array of { type, data } objects once the stream ends.
 */
function collectSseEvents(server, body = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = addr.port;
    const bodyStr = JSON.stringify(body);

    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/api/run/stream',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = http.request(options, (res) => {
      const contentType = res.headers['content-type'] ?? '';
      if (!contentType.includes('text/event-stream')) {
        reject(new Error(`Expected text/event-stream, got: ${contentType}`));
        return;
      }

      const events = [];
      let buffer = '';

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        const parsed = parseSseChunk(buffer);
        events.push(...parsed);
        // Retain only the trailing partial block (after the last complete \n\n)
        const lastDoubleNewline = buffer.lastIndexOf('\n\n');
        if (lastDoubleNewline !== -1) {
          buffer = buffer.slice(lastDoubleNewline + 2);
        }
      });

      res.on('end', () => {
        // Flush any remaining partial block
        if (buffer.trim()) {
          events.push(...parseSseChunk(buffer));
        }
        resolve(events);
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/** Start a test server bound to an OS-assigned port. Returns the bound server. */
function startTestServer() {
  return new Promise((resolve, reject) => {
    // Force mock mode — no live OpenAI calls
    process.env.SELLER_WAR_GAME_MODEL_MODE = 'mock';
    const server = createServer();
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

/** Close the server gracefully. */
function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Sub-AC 3d: single-iteration event-count verification
// ---------------------------------------------------------------------------

test('Sub-AC 3d: one-iteration SSE stream emits exactly the required event types and counts', async () => {
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    // Build a frequency map for easy assertions
    const countByType = {};
    for (const { type } of events) {
      countByType[type] = (countByType[type] ?? 0) + 1;
    }

    // ── 1. Exactly 800 agent_decision events ──────────────────────────────
    assert.strictEqual(
      countByType['agent_decision'] ?? 0,
      800,
      `Expected exactly 800 agent_decision events, got ${countByType['agent_decision'] ?? 0}`
    );

    // ── 2. Zero archetype_evaluated events (batch mode must be absent) ────
    assert.strictEqual(
      countByType['archetype_evaluated'] ?? 0,
      0,
      `Expected 0 archetype_evaluated events (batch mode eliminated), got ${countByType['archetype_evaluated'] ?? 0}`
    );

    // ── 3. Exactly one iteration_start ───────────────────────────────────
    assert.strictEqual(
      countByType['iteration_start'] ?? 0,
      1,
      `Expected exactly 1 iteration_start event, got ${countByType['iteration_start'] ?? 0}`
    );

    // ── 4. Exactly one iteration_complete ────────────────────────────────
    assert.strictEqual(
      countByType['iteration_complete'] ?? 0,
      1,
      `Expected exactly 1 iteration_complete event, got ${countByType['iteration_complete'] ?? 0}`
    );

    // ── 5. Exactly one holdout_start ─────────────────────────────────────
    assert.strictEqual(
      countByType['holdout_start'] ?? 0,
      1,
      `Expected exactly 1 holdout_start event, got ${countByType['holdout_start'] ?? 0}`
    );

    // ── 6. Exactly one simulation_complete ───────────────────────────────
    assert.strictEqual(
      countByType['simulation_complete'] ?? 0,
      1,
      `Expected exactly 1 simulation_complete event, got ${countByType['simulation_complete'] ?? 0}`
    );
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 3d: archetype_evaluated event type is never emitted (individual-agent architecture)', async () => {
  // Dedicated test that explicitly documents the removal of the batch archetype_evaluated event.
  // Any presence of archetype_evaluated indicates the old batch simulation path is still active.
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const batchEvents = events.filter((e) => e.type === 'archetype_evaluated');
    assert.strictEqual(
      batchEvents.length,
      0,
      `archetype_evaluated events must not appear — found ${batchEvents.length}. ` +
        'The simulation must use individual-agent (agent_decision) events instead.'
    );
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 3d: agent_decision events cover all 800 buyer agents (no duplicates or gaps)', async () => {
  // Each of the 800 agents must emit exactly one decision event.
  // agent_index values must form the complete set [0 … 799] with no duplicates.
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const agentDecisions = events.filter((e) => e.type === 'agent_decision');
    assert.strictEqual(agentDecisions.length, 800, `Expected 800 agent_decision events, got ${agentDecisions.length}`);

    const seenIndexes = new Set();
    for (const { data } of agentDecisions) {
      assert.ok(
        typeof data.agent_index === 'number' && data.agent_index >= 0 && data.agent_index < 800,
        `agent_index ${data.agent_index} must be in [0, 799]`
      );
      assert.ok(
        !seenIndexes.has(data.agent_index),
        `Duplicate agent_index detected: ${data.agent_index}`
      );
      seenIndexes.add(data.agent_index);
    }

    // Every index 0–799 must be present
    for (let i = 0; i < 800; i++) {
      assert.ok(seenIndexes.has(i), `agent_index ${i} is missing from agent_decision events`);
    }
  } finally {
    await stopServer(server);
  }
});
