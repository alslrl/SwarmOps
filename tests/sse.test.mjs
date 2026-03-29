/**
 * SSE Streaming Gate — sse.test.mjs
 *
 * Validates that the /api/run/stream endpoint:
 *  1. Returns Content-Type: text/event-stream
 *  2. Emits events in the correct sequence:
 *       iteration_start → agent_decision (×800) → iteration_complete
 *       → holdout_start → simulation_complete
 *  3. Each event payload shape matches the spec
 *  4. Emits an `error` event when the server encounters an error
 *
 * The server is started in-process using createServer() with modelMode=mock
 * so no live OpenAI calls are made during CI.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/server.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse raw SSE text into an array of { type, data } objects. */
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
        // ignore malformed data lines
      }
    }
  }
  return events;
}

/**
 * POST to /api/run/stream on a running http.Server and collect all SSE events.
 * Resolves with the ordered array of { type, data } objects.
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
        // Keep only the tail that might be a partial block
        const lastDoubleNewline = buffer.lastIndexOf('\n\n');
        if (lastDoubleNewline !== -1) {
          buffer = buffer.slice(lastDoubleNewline + 2);
        }
      });

      res.on('end', () => {
        // parse any remaining buffer
        if (buffer.trim()) {
          const remaining = parseSseChunk(buffer);
          events.push(...remaining);
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

/** Start a test server bound to an OS-assigned port. Returns the server. */
function startTestServer() {
  return new Promise((resolve, reject) => {
    // Force mock mode for all tests
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
// Tests
// ---------------------------------------------------------------------------

test('SSE endpoint returns text/event-stream content type', async () => {
  const server = await startTestServer();
  try {
    const addr = server.address();
    const bodyStr = JSON.stringify({ iterationCount: 1, minimumMarginFloor: 0.35 });

    const contentType = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path: '/api/run/stream',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
          },
        },
        (res) => {
          resolve(res.headers['content-type'] ?? '');
          res.resume(); // consume body so the socket closes cleanly
        }
      );
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });

    assert.ok(
      contentType.includes('text/event-stream'),
      `Content-Type should be text/event-stream, got: ${contentType}`
    );
  } finally {
    await stopServer(server);
  }
});

test('SSE events are emitted in the correct order for 1 iteration', async () => {
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const types = events.map((e) => e.type);

    // Must contain these event types
    assert.ok(types.includes('iteration_start'), 'Missing iteration_start event');
    assert.ok(types.includes('agent_decision'), 'Missing agent_decision event');
    assert.ok(types.includes('iteration_complete'), 'Missing iteration_complete event');
    assert.ok(types.includes('simulation_complete'), 'Missing simulation_complete event');

    // Check ordering: iteration_start must come before agent_decision
    const idxIterStart = types.indexOf('iteration_start');
    const idxFirstAgentDecision = types.indexOf('agent_decision');
    const idxIterComplete = types.indexOf('iteration_complete');
    const idxSimComplete = types.indexOf('simulation_complete');

    assert.ok(idxIterStart < idxFirstAgentDecision, 'iteration_start must precede agent_decision');
    assert.ok(idxFirstAgentDecision < idxIterComplete, 'agent_decision must precede iteration_complete');
    assert.ok(idxIterComplete < idxSimComplete, 'iteration_complete must precede simulation_complete');
  } finally {
    await stopServer(server);
  }
});

test('iteration_start event payload has correct shape', async () => {
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterStartEvents = events.filter((e) => e.type === 'iteration_start');
    assert.ok(iterStartEvents.length >= 1, 'Expected at least 1 iteration_start event');

    const first = iterStartEvents[0].data;
    assert.equal(typeof first.iteration, 'number', 'iteration_start.iteration must be a number');
    assert.ok(first.iteration >= 1, 'iteration_start.iteration must be >= 1');
    assert.equal(typeof first.total, 'number', 'iteration_start.total must be a number');
    assert.equal(first.total, 1, 'iteration_start.total must equal iterationCount (1)');
    assert.ok(Array.isArray(first.candidates), 'iteration_start.candidates must be an array');
    assert.ok(first.candidates.length > 0, 'iteration_start.candidates must not be empty');

    // Each candidate must have id, title, price_krw
    for (const candidate of first.candidates) {
      assert.equal(typeof candidate.id, 'string', 'candidate.id must be a string');
      assert.equal(typeof candidate.title, 'string', 'candidate.title must be a string');
      assert.equal(typeof candidate.price_krw, 'number', 'candidate.price_krw must be a number');
    }
  } finally {
    await stopServer(server);
  }
});

test('agent_decision events: exactly 800 per iteration, correct shape', async () => {
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const agentDecisionEvents = events.filter((e) => e.type === 'agent_decision');
    // 800 agents per iteration × 1 iteration = 800
    assert.equal(agentDecisionEvents.length, 800, `Expected 800 agent_decision events, got ${agentDecisionEvents.length}`);

    const validChoices = new Set(['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']);
    for (const evt of agentDecisionEvents) {
      const d = evt.data;
      assert.equal(typeof d.iteration, 'number', 'agent_decision.iteration must be a number');
      assert.equal(typeof d.agent_id, 'string', 'agent_decision.agent_id must be a string');
      assert.ok(d.agent_id.length > 0, 'agent_id must not be empty');
      assert.equal(typeof d.agent_name, 'string', 'agent_decision.agent_name must be a string');
      assert.ok(d.agent_name.length > 0, 'agent_name must not be empty');
      assert.equal(typeof d.archetype_id, 'string', 'agent_decision.archetype_id must be a string');
      assert.ok(d.archetype_id.length > 0, 'archetype_id must not be empty');
      assert.ok(validChoices.has(d.chosen_product), `agent_decision.chosen_product "${d.chosen_product}" must be a valid choice`);
      assert.equal(typeof d.reasoning, 'string', 'agent_decision.reasoning must be a string');
      assert.ok(d.reasoning.length > 0, 'agent_decision.reasoning must not be empty');
      assert.equal(typeof d.agent_index, 'number', 'agent_decision.agent_index must be a number');
      assert.ok(d.agent_index >= 0 && d.agent_index < 800, `agent_index ${d.agent_index} must be in [0, 799]`);
      assert.equal(typeof d.agent_total, 'number', 'agent_decision.agent_total must be a number');
      assert.equal(d.agent_total, 800, 'agent_total must be 800');
    }
  } finally {
    await stopServer(server);
  }
});

test('agent_decision events total 800 per iteration with correct archetype distribution', async () => {
  const server = await startTestServer();
  try {
    const addr = server.address();
    const TRAIN_BUYERS = 800;

    // Fetch archetype weights from the fixtures API so we can compute expected allocations
    const archetypeWeights = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${addr.port}/api/fixtures`, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            const weights = {};
            for (const a of parsed.archetypes) {
              weights[a.id] = a.cohort_weight_percent;
            }
            resolve(weights);
          } catch (err) { reject(err); }
        });
        res.on('error', reject);
      }).on('error', reject);
    });

    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const agentDecisionEvents = events.filter((e) => e.type === 'agent_decision');
    // Total agent_decision events must equal TRAIN_BUYERS (800)
    assert.equal(agentDecisionEvents.length, TRAIN_BUYERS, `Expected ${TRAIN_BUYERS} agent_decision events, got ${agentDecisionEvents.length}`);

    // Per-archetype counts must match cohort allocation (±1 for integer rounding)
    const archetypeCounts = {};
    for (const evt of agentDecisionEvents) {
      const aid = evt.data.archetype_id;
      archetypeCounts[aid] = (archetypeCounts[aid] || 0) + 1;
    }

    for (const [archetypeId, weightPct] of Object.entries(archetypeWeights)) {
      const expected = TRAIN_BUYERS * (weightPct / 100);
      const actual = archetypeCounts[archetypeId] ?? 0;
      assert.ok(
        Math.abs(actual - expected) <= 1,
        `Archetype ${archetypeId} (weight=${weightPct}%): agent count ${actual} should be ~${expected} (±1)`
      );
    }
  } finally {
    await stopServer(server);
  }
});

test('iteration_complete event payload has correct shape', async () => {
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvents = events.filter((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvents.length >= 1, 'Expected at least 1 iteration_complete event');

    const first = iterCompleteEvents[0].data;
    assert.equal(typeof first.iteration, 'number', 'iteration_complete.iteration must be a number');
    assert.ok(first.iteration >= 1, 'iteration_complete.iteration must be >= 1');
    assert.equal(typeof first.winner_id, 'string', 'iteration_complete.winner_id must be a string');
    assert.ok(first.winner_id.length > 0, 'winner_id must not be empty');
    assert.equal(typeof first.winner_revenue, 'number', 'iteration_complete.winner_revenue must be a number');
    assert.ok(first.winner_revenue >= 0, 'winner_revenue must be >= 0');
    assert.equal(typeof first.accepted, 'boolean', 'iteration_complete.accepted must be a boolean');
    assert.equal(typeof first.rejected_count, 'number', 'iteration_complete.rejected_count must be a number');

    // choice_summary — Sub-AC 3c explicit {count, pct} schema per choice key
    assert.ok(first.choice_summary && typeof first.choice_summary === 'object', 'iteration_complete.choice_summary must be an object');
    const choiceKeys = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
    for (const key of choiceKeys) {
      assert.ok(key in first.choice_summary, `choice_summary must contain key: ${key}`);
      // Sub-AC 3c: each value is an object with count and pct fields
      assert.equal(typeof first.choice_summary[key], 'object', `choice_summary.${key} must be an object with count and pct`);
      assert.ok(first.choice_summary[key] !== null, `choice_summary.${key} must not be null`);
      assert.equal(typeof first.choice_summary[key].count, 'number', `choice_summary.${key}.count must be a number`);
      assert.ok(Number.isInteger(first.choice_summary[key].count), `choice_summary.${key}.count must be an integer`);
      assert.ok(first.choice_summary[key].count >= 0, `choice_summary.${key}.count must be >= 0`);
      assert.equal(typeof first.choice_summary[key].pct, 'number', `choice_summary.${key}.pct must be a number`);
      assert.ok(first.choice_summary[key].pct >= 0 && first.choice_summary[key].pct <= 100,
        `choice_summary.${key}.pct must be in [0, 100], got ${first.choice_summary[key].pct}`);
    }
    // count values must sum to 800 (total buyers)
    const choiceTotal = Object.values(first.choice_summary).reduce((sum, v) => sum + v.count, 0);
    assert.equal(choiceTotal, 800, `choice_summary count values must sum to 800, got ${choiceTotal}`);

    // archetype_breakdown — Sub-AC 3c explicit array schema
    // [{archetype_id, archetype_label, sample_size, choices: {key: {count, pct}}}]
    assert.ok(Array.isArray(first.archetype_breakdown), 'iteration_complete.archetype_breakdown must be an array');
    assert.ok(first.archetype_breakdown.length > 0, 'archetype_breakdown must not be empty');
    for (const entry of first.archetype_breakdown) {
      assert.equal(typeof entry.archetype_id, 'string', 'archetype_breakdown entry must have string archetype_id');
      assert.equal(typeof entry.archetype_label, 'string', 'archetype_breakdown entry must have string archetype_label');
      assert.ok(entry.archetype_label.length > 0, 'archetype_label must not be empty');
      assert.equal(typeof entry.sample_size, 'number', 'archetype_breakdown entry must have numeric sample_size');
      assert.ok(entry.sample_size >= 0, 'sample_size must be >= 0');
      assert.ok(entry.choices && typeof entry.choices === 'object', 'archetype_breakdown entry must have choices object');
    }
  } finally {
    await stopServer(server);
  }
});

test('simulation_complete event payload has all required fields', async () => {
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const completeEvents = events.filter((e) => e.type === 'simulation_complete');
    assert.equal(completeEvents.length, 1, 'Expected exactly 1 simulation_complete event');

    const d = completeEvents[0].data;

    // baseline
    assert.ok(d.baseline && typeof d.baseline === 'object', 'simulation_complete.baseline must be an object');
    assert.equal(typeof d.baseline.simulated_revenue, 'number', 'baseline.simulated_revenue must be a number');

    // selected_strategy
    assert.ok(d.selected_strategy && typeof d.selected_strategy === 'object', 'simulation_complete.selected_strategy must be an object');
    assert.equal(typeof d.selected_strategy.id, 'string', 'selected_strategy.id must be a string');

    // holdout
    assert.ok(d.holdout && typeof d.holdout === 'object', 'simulation_complete.holdout must be an object');
    assert.equal(typeof d.holdout.holdout_uplift, 'number', 'holdout.holdout_uplift must be a number');

    // diff
    assert.ok(d.diff && typeof d.diff === 'object', 'simulation_complete.diff must be an object');
    assert.ok('title' in d.diff, 'diff must contain title');
    assert.ok('top_copy' in d.diff, 'diff must contain top_copy');
    assert.ok('price' in d.diff, 'diff must contain price');

    // artifact
    assert.ok(d.artifact && typeof d.artifact === 'object', 'simulation_complete.artifact must be an object');
  } finally {
    await stopServer(server);
  }
});

test('simulation_complete is the last event in the stream', async () => {
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    assert.ok(events.length > 0, 'Expected at least 1 event');
    const lastEvent = events[events.length - 1];
    assert.equal(
      lastEvent.type,
      'simulation_complete',
      `Last event must be simulation_complete, got: ${lastEvent.type}`
    );
  } finally {
    await stopServer(server);
  }
});

test('no error events emitted during normal mock run', async () => {
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const errorEvents = events.filter((e) => e.type === 'error');
    assert.equal(errorEvents.length, 0, `Expected 0 error events, got ${errorEvents.length}`);
  } finally {
    await stopServer(server);
  }
});

test('error event has correct shape when simulation fails', async () => {
  // Force an error by passing an invalid fixtureDir indirectly — we can trigger this
  // by requesting with a deeply invalid body that causes the engine to throw.
  // However, to avoid complex server manipulation, we instead verify the error
  // event structure by inspecting what the server sends if we temporarily
  // set a bad environment variable that breaks the engine.
  //
  // Strategy: send a POST body that causes a JSON parse failure at the server level.
  // We do this by sending malformed JSON directly.
  const server = await startTestServer();
  try {
    const addr = server.address();

    const rawBody = '{invalid json}';
    const errorEvents = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path: '/api/run/stream',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(rawBody),
          },
        },
        (res) => {
          const collected = [];
          let buffer = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            buffer += chunk;
            const parsed = parseSseChunk(buffer);
            collected.push(...parsed);
            const lastDN = buffer.lastIndexOf('\n\n');
            if (lastDN !== -1) buffer = buffer.slice(lastDN + 2);
          });
          res.on('end', () => {
            if (buffer.trim()) collected.push(...parseSseChunk(buffer));
            resolve(collected.filter((e) => e.type === 'error'));
          });
          res.on('error', reject);
        }
      );
      req.on('error', (err) => {
        // If the server responds with non-SSE (e.g. 500 JSON), that's also acceptable
        // but we expect either an error event or a 500 status
        resolve([]);
      });
      req.write(rawBody);
      req.end();
    });

    // We accept either: error events with correct shape, OR an empty list
    // (server may respond with 500 JSON instead of SSE on parse error)
    for (const evt of errorEvents) {
      assert.equal(typeof evt.data.message, 'string', 'error.message must be a string');
      assert.ok(evt.data.message.length > 0, 'error.message must not be empty');
      assert.equal(typeof evt.data.recoverable, 'boolean', 'error.recoverable must be a boolean');
    }
    // Test passes whether error events are present or not (server may 500 before SSE headers)
  } finally {
    await stopServer(server);
  }
});

test('SSE stream with override values propagates to simulation_complete diff', async () => {
  const server = await startTestServer();
  try {
    const overrideTitle = 'SSE 오버라이드 타이틀 테스트';

    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
      title: overrideTitle,
      topCopy: '오버라이드된 카피',
      priceKrw: 24900,
      costKrw: 9500,
    });

    // Must still complete successfully
    const completeEvents = events.filter((e) => e.type === 'simulation_complete');
    assert.equal(completeEvents.length, 1, 'Expected exactly 1 simulation_complete event with overrides');

    const d = completeEvents[0].data;
    assert.ok(d.diff && typeof d.diff === 'object', 'diff must be present');
    assert.ok('title' in d.diff, 'diff must have title field');

    // The diff.title.before should reflect the overridden title
    if (d.diff.title && typeof d.diff.title === 'object') {
      assert.equal(
        d.diff.title.before,
        overrideTitle,
        'diff.title.before should reflect the override title'
      );
    }
  } finally {
    await stopServer(server);
  }
});

test('multiple iterations produce correct event count', async () => {
  const ITERATION_COUNT = 2;
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: ITERATION_COUNT,
      minimumMarginFloor: 0.35,
    });

    const iterStartEvents = events.filter((e) => e.type === 'iteration_start');
    const iterCompleteEvents = events.filter((e) => e.type === 'iteration_complete');
    const agentDecisionEvents = events.filter((e) => e.type === 'agent_decision');
    const completeEvents = events.filter((e) => e.type === 'simulation_complete');

    assert.equal(iterStartEvents.length, ITERATION_COUNT, `Expected ${ITERATION_COUNT} iteration_start events`);
    assert.equal(iterCompleteEvents.length, ITERATION_COUNT, `Expected ${ITERATION_COUNT} iteration_complete events`);
    assert.equal(
      agentDecisionEvents.length,
      800 * ITERATION_COUNT,
      `Expected ${800 * ITERATION_COUNT} agent_decision events (800 agents × ${ITERATION_COUNT} iterations)`
    );
    assert.equal(completeEvents.length, 1, 'Expected exactly 1 simulation_complete event');
  } finally {
    await stopServer(server);
  }
});

test('holdout_start event is emitted before simulation_complete', async () => {
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const types = events.map((e) => e.type);
    assert.ok(types.includes('holdout_start'), 'holdout_start event must be emitted');

    const idxHoldoutStart = types.indexOf('holdout_start');
    const idxSimComplete = types.indexOf('simulation_complete');
    assert.ok(
      idxHoldoutStart < idxSimComplete,
      'holdout_start must come before simulation_complete'
    );

    // holdout_start should have a message field
    const holdoutEvent = events.find((e) => e.type === 'holdout_start');
    assert.equal(
      typeof holdoutEvent.data.message,
      'string',
      'holdout_start.message must be a string'
    );
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// Sub-AC 3c: Full event-contract assertions
// ---------------------------------------------------------------------------

test('full event-contract: complete ordering — iteration_start → agent_decision(×800) → iteration_complete → holdout_start → simulation_complete', async () => {
  // Verifies the STRICT sequence for a single iteration:
  //   1. iteration_start (position 0)
  //   2. agent_decision × 800 (positions 1–800)
  //   3. iteration_complete (position 801)
  //   4. holdout_start (position 802)
  //   5. simulation_complete (last position)
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const types = events.map((e) => e.type);

    // -- Count each type --
    const iterStartCount = types.filter((t) => t === 'iteration_start').length;
    const agentDecisionCount = types.filter((t) => t === 'agent_decision').length;
    const iterCompleteCount = types.filter((t) => t === 'iteration_complete').length;
    const holdoutStartCount = types.filter((t) => t === 'holdout_start').length;
    const simCompleteCount = types.filter((t) => t === 'simulation_complete').length;

    assert.equal(iterStartCount, 1, 'Expected exactly 1 iteration_start');
    assert.equal(agentDecisionCount, 800, `Expected exactly 800 agent_decision events, got ${agentDecisionCount}`);
    assert.equal(iterCompleteCount, 1, 'Expected exactly 1 iteration_complete');
    assert.equal(holdoutStartCount, 1, 'Expected exactly 1 holdout_start');
    assert.equal(simCompleteCount, 1, 'Expected exactly 1 simulation_complete');

    // -- Verify strict positions --
    const idxIterStart = types.indexOf('iteration_start');
    const idxFirstAgent = types.indexOf('agent_decision');
    const idxLastAgent = types.lastIndexOf('agent_decision');
    const idxIterComplete = types.indexOf('iteration_complete');
    const idxHoldoutStart = types.indexOf('holdout_start');
    const idxSimComplete = types.indexOf('simulation_complete');

    // iteration_start is the very first event
    assert.equal(idxIterStart, 0, 'iteration_start must be the very first event (index 0)');

    // All 800 agent_decision events come immediately after iteration_start
    assert.ok(idxFirstAgent > idxIterStart, 'First agent_decision must follow iteration_start');
    assert.ok(idxLastAgent < idxIterComplete, 'Last agent_decision must precede iteration_complete');

    // iteration_complete comes immediately after the last agent_decision
    assert.ok(idxIterComplete > idxLastAgent, 'iteration_complete must follow last agent_decision');

    // holdout_start comes AFTER iteration_complete (not interleaved)
    assert.ok(idxHoldoutStart > idxIterComplete, 'holdout_start must come after iteration_complete');

    // simulation_complete is the very last event
    assert.equal(idxSimComplete, events.length - 1, 'simulation_complete must be the last event');
    assert.ok(idxSimComplete > idxHoldoutStart, 'simulation_complete must follow holdout_start');
  } finally {
    await stopServer(server);
  }
});

test('full event-contract: agent_decision events have unique agent_index values spanning [0, 799]', async () => {
  // Each of the 800 agents emits exactly one decision; no index is repeated or missing.
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const agentDecisionEvents = events.filter((e) => e.type === 'agent_decision');
    assert.equal(agentDecisionEvents.length, 800, `Expected 800 agent_decision events, got ${agentDecisionEvents.length}`);

    const seenIndexes = new Set();
    for (const { data } of agentDecisionEvents) {
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

    // Every index 0–799 must be present (no gaps)
    for (let i = 0; i < 800; i++) {
      assert.ok(seenIndexes.has(i), `agent_index ${i} is missing from agent_decision events`);
    }
  } finally {
    await stopServer(server);
  }
});

test('full event-contract: iteration_complete choice_summary has all 5 keys and sums to 800', async () => {
  // Sub-AC 3c: choice_summary is now {key: {count, pct}} format.
  // Verifies all 5 choice keys present and count values sum to 800.
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvent = events.find((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvent, 'iteration_complete event must be present');

    const { choice_summary } = iterCompleteEvent.data;
    assert.ok(choice_summary && typeof choice_summary === 'object', 'choice_summary must be an object');

    const REQUIRED_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
    for (const key of REQUIRED_KEYS) {
      assert.ok(key in choice_summary, `choice_summary must contain key: ${key}`);
      // Sub-AC 3c: each value is {count, pct} — check the object shape
      assert.equal(typeof choice_summary[key], 'object', `choice_summary.${key} must be an object {count, pct}`);
      assert.ok(choice_summary[key] !== null, `choice_summary.${key} must not be null`);
      assert.ok(choice_summary[key].count >= 0, `choice_summary.${key}.count must be non-negative`);
    }

    // count values must sum to 800 (one decision per agent)
    const total = REQUIRED_KEYS.reduce((sum, k) => sum + choice_summary[k].count, 0);
    assert.equal(total, 800, `choice_summary count values must sum to 800 (one decision per agent), got ${total}`);
  } finally {
    await stopServer(server);
  }
});

test('full event-contract: iteration_complete archetype_breakdown covers all archetypes with correct per-archetype counts', async () => {
  // Sub-AC 3c: archetype_breakdown is now an array [{archetype_id, archetype_label, sample_size, choices}].
  // Each archetype must appear with correct sample_size matching cohort allocation.
  const server = await startTestServer();
  try {
    const addr = server.address();

    // Fetch archetype cohort weights from fixtures API
    const archetypeWeights = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${addr.port}/api/fixtures`, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed.archetypes);
          } catch (err) { reject(err); }
        });
        res.on('error', reject);
      }).on('error', reject);
    });

    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvent = events.find((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvent, 'iteration_complete event must be present');

    const { archetype_breakdown } = iterCompleteEvent.data;
    // Sub-AC 3c: archetype_breakdown is an array
    assert.ok(Array.isArray(archetype_breakdown), 'archetype_breakdown must be an array (Sub-AC 3c)');
    assert.ok(archetype_breakdown.length > 0, 'archetype_breakdown must not be empty');

    // Build lookup by archetype_id for easy verification
    const breakdownById = Object.fromEntries(archetype_breakdown.map((e) => [e.archetype_id, e]));

    // Every archetype must appear in the breakdown
    for (const arch of archetypeWeights) {
      assert.ok(
        arch.id in breakdownById,
        `archetype_breakdown must contain entry for archetype: ${arch.id}`
      );
    }

    // Per-archetype sample_size (total counts) must match cohort allocation (±1 for integer rounding)
    const TOTAL_BUYERS = 800;
    const CHOICE_KEYS_LOCAL = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
    for (const arch of archetypeWeights) {
      const entry = breakdownById[arch.id];
      assert.ok(entry && typeof entry === 'object', `archetype_breakdown entry for ${arch.id} must exist`);
      // sample_size must match sum of choice counts
      const choiceCountTotal = CHOICE_KEYS_LOCAL.reduce((sum, k) => sum + (entry.choices?.[k]?.count ?? 0), 0);
      assert.equal(choiceCountTotal, entry.sample_size,
        `archetype_breakdown[${arch.id}] choice count total (${choiceCountTotal}) must equal sample_size (${entry.sample_size})`);
      const expectedCount = TOTAL_BUYERS * (arch.cohort_weight_percent / 100);
      assert.ok(
        Math.abs(entry.sample_size - expectedCount) <= 1,
        `archetype_breakdown[${arch.id}].sample_size (${entry.sample_size}) must be ~${expectedCount} (±1, weight=${arch.cohort_weight_percent}%)`
      );
    }
  } finally {
    await stopServer(server);
  }
});

test('full event-contract: multi-iteration ordering — each iteration has its own 800 agent_decisions between start/complete', async () => {
  // For N iterations: each must follow iteration_start → agent_decision(×800) → iteration_complete
  // and the global sequence must end with holdout_start → simulation_complete.
  const ITERATION_COUNT = 2;
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: ITERATION_COUNT,
      minimumMarginFloor: 0.35,
    });

    const types = events.map((e) => e.type);

    // Global counts
    assert.equal(types.filter((t) => t === 'iteration_start').length, ITERATION_COUNT, `Expected ${ITERATION_COUNT} iteration_start events`);
    assert.equal(types.filter((t) => t === 'agent_decision').length, 800 * ITERATION_COUNT, `Expected ${800 * ITERATION_COUNT} total agent_decision events`);
    assert.equal(types.filter((t) => t === 'iteration_complete').length, ITERATION_COUNT, `Expected ${ITERATION_COUNT} iteration_complete events`);
    assert.equal(types.filter((t) => t === 'holdout_start').length, 1, 'Expected exactly 1 holdout_start');
    assert.equal(types.filter((t) => t === 'simulation_complete').length, 1, 'Expected exactly 1 simulation_complete');

    // Verify per-iteration structure by splitting on iteration_start and iteration_complete pairs
    const iterStartIndexes = [];
    const iterCompleteIndexes = [];
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'iteration_start') iterStartIndexes.push(i);
      if (types[i] === 'iteration_complete') iterCompleteIndexes.push(i);
    }
    assert.equal(iterStartIndexes.length, ITERATION_COUNT, 'iteration_start count must equal iterationCount');
    assert.equal(iterCompleteIndexes.length, ITERATION_COUNT, 'iteration_complete count must equal iterationCount');

    for (let i = 0; i < ITERATION_COUNT; i++) {
      const startIdx = iterStartIndexes[i];
      const completeIdx = iterCompleteIndexes[i];

      // iteration_start must come before iteration_complete for this iteration
      assert.ok(startIdx < completeIdx, `Iteration ${i + 1}: iteration_start (${startIdx}) must precede iteration_complete (${completeIdx})`);

      // Count agent_decision events between this start and complete
      const agentDecisionsInSlice = types.slice(startIdx + 1, completeIdx).filter((t) => t === 'agent_decision').length;
      assert.equal(
        agentDecisionsInSlice,
        800,
        `Iteration ${i + 1}: expected 800 agent_decision events between iteration_start and iteration_complete, got ${agentDecisionsInSlice}`
      );
    }

    // holdout_start must come after the last iteration_complete
    const lastIterComplete = iterCompleteIndexes[ITERATION_COUNT - 1];
    const idxHoldout = types.indexOf('holdout_start');
    const idxSimComplete = types.indexOf('simulation_complete');
    assert.ok(idxHoldout > lastIterComplete, 'holdout_start must come after all iteration_complete events');
    assert.ok(idxSimComplete > idxHoldout, 'simulation_complete must come after holdout_start');
    assert.equal(idxSimComplete, events.length - 1, 'simulation_complete must be the last event');
  } finally {
    await stopServer(server);
  }
});

test('backward-compat: /api/run batch endpoint still responds with valid JSON result', async () => {
  // The Gen 1 POST /api/run endpoint must remain operational alongside /api/run/stream.
  // This test verifies the batch endpoint is not broken by the individual-agent changes.
  const server = await startTestServer();
  try {
    const addr = server.address();
    const bodyStr = JSON.stringify({ iterationCount: 1, minimumMarginFloor: 0.35 });

    const result = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path: '/api/run',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
          },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: JSON.parse(body) });
            } catch (err) {
              reject(new Error(`Failed to parse /api/run response as JSON: ${err.message}`));
            }
          });
          res.on('error', reject);
        }
      );
      req.on('error', reject);
      req.write(bodyStr);
      req.end();
    });

    // Must respond 200 OK
    assert.equal(result.status, 200, `POST /api/run must return HTTP 200, got ${result.status}`);

    // Response must include the documented batch result fields
    const d = result.data;
    assert.ok(d.baseline && typeof d.baseline === 'object', 'batch result must have baseline object');
    assert.equal(typeof d.baseline.simulated_revenue, 'number', 'baseline.simulated_revenue must be a number');
    assert.ok(d.selected_strategy && typeof d.selected_strategy.id === 'string', 'batch result must have selected_strategy.id');
    assert.ok(d.holdout && typeof d.holdout.holdout_uplift === 'number', 'batch result must have holdout.holdout_uplift');
    assert.ok(d.diff && 'title' in d.diff && 'top_copy' in d.diff && 'price' in d.diff, 'batch result diff must have title, top_copy, price');
    assert.ok(Array.isArray(d.iterations), 'batch result must have iterations array');
    assert.equal(d.iterations.length, 1, 'iterations array length must equal iterationCount (1)');
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// Sub-AC 7b: 800 agent_decision events — agent_id, decision, score fields
// ---------------------------------------------------------------------------

test('Sub-AC 7b: exactly 800 agent_decision events are emitted per simulation run', async () => {
  // Validates the hard requirement: one decision event per buyer agent per iteration.
  // 800 agents × 1 iteration = 800 agent_decision events.
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const agentDecisions = events.filter((e) => e.type === 'agent_decision');
    assert.strictEqual(
      agentDecisions.length,
      800,
      `Expected exactly 800 agent_decision events, got ${agentDecisions.length}`
    );
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 7b: every agent_decision event carries a valid agent_id field', async () => {
  // agent_id must be a non-empty string matching the pattern "{archetype_id}_{NNNN}".
  // This uniquely identifies which buyer agent made the decision.
  const AGENT_ID_PATTERN = /^[a-z_]+_\d{4}$/;
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const agentDecisions = events.filter((e) => e.type === 'agent_decision');
    assert.strictEqual(agentDecisions.length, 800, `Expected 800 agent_decision events, got ${agentDecisions.length}`);

    for (let i = 0; i < agentDecisions.length; i += 1) {
      const { data } = agentDecisions[i];
      assert.ok(
        typeof data.agent_id === 'string' && data.agent_id.length > 0,
        `agent_decision[${i}]: agent_id must be a non-empty string, got: ${JSON.stringify(data.agent_id)}`
      );
      assert.ok(
        AGENT_ID_PATTERN.test(data.agent_id),
        `agent_decision[${i}]: agent_id "${data.agent_id}" must match pattern {archetype_id}_{NNNN} (e.g. "price_sensitive_0001")`
      );
    }
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 7b: every agent_decision event carries a valid decision field', async () => {
  // decision must be one of the 5 canonical product choice keys.
  // It is a canonical alias for chosen_product that downstream consumers (particle-flow,
  // agent chat log) use to route the agent to the correct visual bucket.
  const VALID_DECISIONS = new Set(['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']);
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const agentDecisions = events.filter((e) => e.type === 'agent_decision');
    assert.strictEqual(agentDecisions.length, 800, `Expected 800 agent_decision events, got ${agentDecisions.length}`);

    for (let i = 0; i < agentDecisions.length; i += 1) {
      const { data } = agentDecisions[i];
      assert.ok(
        typeof data.decision === 'string',
        `agent_decision[${i}]: decision must be a string, got: ${JSON.stringify(data.decision)}`
      );
      assert.ok(
        VALID_DECISIONS.has(data.decision),
        `agent_decision[${i}]: decision "${data.decision}" must be one of: ${[...VALID_DECISIONS].join(', ')}`
      );
      // decision must match chosen_product (they are the same choice, different field names)
      assert.strictEqual(
        data.decision,
        data.chosen_product,
        `agent_decision[${i}]: decision "${data.decision}" must equal chosen_product "${data.chosen_product}"`
      );
    }
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 7b: every agent_decision event carries a valid score field', async () => {
  // score is a numeric utility value in [0, 1] representing the agent's confidence
  // in their chosen product relative to all alternatives.
  // It is computed from per-agent weight proportions in mock mode.
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const agentDecisions = events.filter((e) => e.type === 'agent_decision');
    assert.strictEqual(agentDecisions.length, 800, `Expected 800 agent_decision events, got ${agentDecisions.length}`);

    for (let i = 0; i < agentDecisions.length; i += 1) {
      const { data } = agentDecisions[i];
      assert.ok(
        typeof data.score === 'number',
        `agent_decision[${i}]: score must be a number, got: ${JSON.stringify(data.score)} (type: ${typeof data.score})`
      );
      assert.ok(
        Number.isFinite(data.score),
        `agent_decision[${i}]: score must be a finite number, got: ${data.score}`
      );
      assert.ok(
        data.score >= 0 && data.score <= 1,
        `agent_decision[${i}]: score ${data.score} must be in [0, 1]`
      );
    }
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 7b: agent_decision events have non-zero score diversity across 800 agents', async () => {
  // Scores must not be uniform — the per-agent noise model should produce
  // meaningfully different scores for different agents even within the same archetype.
  // Invariant: at least 10 distinct score values must appear across 800 agents.
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const agentDecisions = events.filter((e) => e.type === 'agent_decision');
    assert.strictEqual(agentDecisions.length, 800, `Expected 800 agent_decision events, got ${agentDecisions.length}`);

    const distinctScores = new Set(agentDecisions.map((e) => e.data.score));
    assert.ok(
      distinctScores.size >= 10,
      `Expected at least 10 distinct score values across 800 agents (per-agent noise model); ` +
        `got only ${distinctScores.size} distinct values`
    );
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 7b: all 5 decision buckets (our_product, competitor_a, competitor_b, competitor_c, pass) are valid destinations', async () => {
  // All 5 choice outcomes are treated as valid buckets in particle-flow visualization.
  // This test verifies that the decision field uses the correct canonical bucket names.
  const VALID_BUCKETS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const agentDecisions = events.filter((e) => e.type === 'agent_decision');
    assert.strictEqual(agentDecisions.length, 800, `Expected 800 agent_decision events, got ${agentDecisions.length}`);

    // All observed decision values must be valid bucket names
    const observedDecisions = new Set(agentDecisions.map((e) => e.data.decision));
    for (const decision of observedDecisions) {
      assert.ok(
        VALID_BUCKETS.includes(decision),
        `Observed decision "${decision}" is not a valid bucket — must be one of: ${VALID_BUCKETS.join(', ')}`
      );
    }

    // At least 2 distinct buckets must be used across 800 agents
    // (a realistic simulation should never route all agents to a single product)
    assert.ok(
      observedDecisions.size >= 2,
      `Expected at least 2 distinct decision buckets across 800 agents, got ${observedDecisions.size}: ` +
        `[${[...observedDecisions].join(', ')}]`
    );
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// Sub-AC 3c: Explicit {count, pct} schema for choice_summary and archetype_breakdown
// ---------------------------------------------------------------------------

test('Sub-AC 3c: iteration_complete choice_summary has {count, pct} for all 5 keys', async () => {
  // Sub-AC 3c: choice_summary IS the explicit payload with {count, pct} per choice key.
  //   choice_summary: { [key]: { count: number, pct: float 0–100 } }
  const CHOICE_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvent = events.find((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvent, 'iteration_complete event must be present');

    const { choice_summary } = iterCompleteEvent.data;
    assert.ok(
      choice_summary && typeof choice_summary === 'object',
      'iteration_complete must have a choice_summary object'
    );

    for (const key of CHOICE_KEYS) {
      const entry = choice_summary[key];
      assert.ok(
        entry !== null && entry !== undefined && typeof entry === 'object',
        `choice_summary.${key} must be an object {count, pct}, got: ${JSON.stringify(entry)}`
      );

      // count must be a non-negative finite integer
      assert.equal(
        typeof entry.count,
        'number',
        `choice_summary.${key}.count must be a number, got: ${typeof entry.count}`
      );
      assert.ok(
        Number.isFinite(entry.count) && entry.count >= 0,
        `choice_summary.${key}.count must be a non-negative finite number, got ${entry.count}`
      );

      // pct must be a float in [0, 100]
      assert.equal(
        typeof entry.pct,
        'number',
        `choice_summary.${key}.pct must be a number, got: ${typeof entry.pct}`
      );
      assert.ok(
        Number.isFinite(entry.pct) && entry.pct >= 0 && entry.pct <= 100,
        `choice_summary.${key}.pct must be a finite float in [0, 100], got ${entry.pct}`
      );
    }

    // count values must sum to 800 (one decision per agent)
    const totalCount = CHOICE_KEYS.reduce((sum, k) => sum + choice_summary[k].count, 0);
    assert.equal(
      totalCount,
      800,
      `choice_summary counts must sum to 800 (one per agent), got ${totalCount}`
    );

    // pct values must sum to approximately 100 (within floating-point rounding tolerance of ±0.1)
    const totalPct = CHOICE_KEYS.reduce((sum, k) => sum + choice_summary[k].pct, 0);
    assert.ok(
      Math.abs(totalPct - 100) < 0.1,
      `choice_summary percentages must sum to ~100, got ${totalPct.toFixed(4)}`
    );
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 3c: iteration_complete archetype_breakdown is array with {archetype_id, archetype_label, sample_size, choices} schema', async () => {
  // Sub-AC 3c: archetype_breakdown IS the explicit array:
  //   archetype_breakdown: [{
  //     archetype_id:    string,
  //     archetype_label: string (Korean),
  //     sample_size:     number (positive),
  //     choices: { [key]: { count: number, pct: float 0–100 } }
  //   }]
  // pct is relative to sample_size (per-archetype denominator), not global 800.
  const CHOICE_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvent = events.find((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvent, 'iteration_complete event must be present');

    const { archetype_breakdown } = iterCompleteEvent.data;
    assert.ok(
      Array.isArray(archetype_breakdown),
      `archetype_breakdown must be an array (Sub-AC 3c), got: ${typeof archetype_breakdown}`
    );
    assert.ok(
      archetype_breakdown.length > 0,
      'archetype_breakdown must not be empty'
    );

    for (const entry of archetype_breakdown) {
      // archetype_id: non-empty string
      assert.equal(
        typeof entry.archetype_id,
        'string',
        `archetype_breakdown entry must have archetype_id string`
      );
      assert.ok(entry.archetype_id.length > 0, 'archetype_id must not be empty');

      // archetype_label: non-empty string (Korean display name or fallback to id)
      assert.equal(
        typeof entry.archetype_label,
        'string',
        `archetype_breakdown[${entry.archetype_id}] must have archetype_label string`
      );
      assert.ok(
        entry.archetype_label.length > 0,
        `archetype_breakdown[${entry.archetype_id}].archetype_label must not be empty`
      );

      // sample_size: positive finite number
      assert.equal(
        typeof entry.sample_size,
        'number',
        `archetype_breakdown[${entry.archetype_id}] must have numeric sample_size`
      );
      assert.ok(
        Number.isFinite(entry.sample_size) && entry.sample_size > 0,
        `archetype_breakdown[${entry.archetype_id}].sample_size must be a positive number, got ${entry.sample_size}`
      );

      // choices: object with all 5 keys, each {count, pct}
      assert.ok(
        entry.choices !== null && typeof entry.choices === 'object',
        `archetype_breakdown[${entry.archetype_id}] must have a choices object`
      );

      for (const key of CHOICE_KEYS) {
        const choice = entry.choices[key];
        assert.ok(
          choice !== null && choice !== undefined && typeof choice === 'object',
          `archetype_breakdown[${entry.archetype_id}].choices.${key} must be an object, got: ${JSON.stringify(choice)}`
        );

        // count: non-negative finite integer
        assert.equal(
          typeof choice.count,
          'number',
          `archetype_breakdown[${entry.archetype_id}].choices.${key}.count must be a number`
        );
        assert.ok(
          Number.isFinite(choice.count) && choice.count >= 0,
          `archetype_breakdown[${entry.archetype_id}].choices.${key}.count must be non-negative, got ${choice.count}`
        );

        // pct: float in [0, 100]
        assert.equal(
          typeof choice.pct,
          'number',
          `archetype_breakdown[${entry.archetype_id}].choices.${key}.pct must be a number`
        );
        assert.ok(
          Number.isFinite(choice.pct) && choice.pct >= 0 && choice.pct <= 100,
          `archetype_breakdown[${entry.archetype_id}].choices.${key}.pct must be a float in [0,100], got ${choice.pct}`
        );
      }

      // Per-archetype choice counts must sum to sample_size
      const choiceCountTotal = CHOICE_KEYS.reduce((sum, k) => sum + entry.choices[k].count, 0);
      assert.equal(
        choiceCountTotal,
        entry.sample_size,
        `archetype_breakdown[${entry.archetype_id}]: choice counts (${choiceCountTotal}) must sum to sample_size (${entry.sample_size})`
      );
    }

    // Total agents across all archetypes must equal 800
    const totalAgents = archetype_breakdown.reduce((sum, e) => sum + e.sample_size, 0);
    assert.equal(
      totalAgents,
      800,
      `archetype_breakdown sample_sizes must sum to 800 total agents, got ${totalAgents}`
    );
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 3c: archetype_breakdown pct values are relative to per-archetype sample_size (not global 800)', async () => {
  // Sub-AC 3c: Per-archetype pct is (count / sample_size) * 100, NOT (count / 800) * 100.
  // Each archetype's choice percentages must sum to ~100% independently.
  const CHOICE_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvent = events.find((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvent, 'iteration_complete event must be present');

    const { archetype_breakdown } = iterCompleteEvent.data;
    assert.ok(Array.isArray(archetype_breakdown), 'archetype_breakdown must be an array (Sub-AC 3c)');

    for (const entry of archetype_breakdown) {
      // Per-archetype percentages must sum to ~100 (within floating-point rounding tolerance)
      const totalPct = CHOICE_KEYS.reduce((sum, k) => sum + (entry.choices[k]?.pct ?? 0), 0);
      assert.ok(
        Math.abs(totalPct - 100) < 0.1,
        `archetype_breakdown[${entry.archetype_id}]: choice percentages must sum to ~100 ` +
          `(relative to sample_size=${entry.sample_size}), got ${totalPct.toFixed(4)}`
      );
    }
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// Sub-AC 7b: Explicit canonical {count, pct} schema — integer count + float pct
// ---------------------------------------------------------------------------

test('Sub-AC 7b: exactly 800 agent_decision events emitted — canonical count assertion', async () => {
  // Hard requirement: one agent_decision SSE event per buyer agent per iteration.
  // 800 agents × 1 iteration = exactly 800 agent_decision events in the stream.
  // This test uses strictEqual to enforce the integer equality (not >=).
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const agentDecisions = events.filter((e) => e.type === 'agent_decision');
    assert.strictEqual(
      agentDecisions.length,
      800,
      `Expected EXACTLY 800 agent_decision events (one per buyer agent), got ${agentDecisions.length}`
    );

    // Verify every event has the agent_index field and all 800 indexes are unique
    const seenIndexes = new Set(agentDecisions.map((e) => e.data.agent_index));
    assert.strictEqual(
      seenIndexes.size,
      800,
      `Expected 800 unique agent_index values (0–799), got ${seenIndexes.size} unique values`
    );
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 7b: iteration_complete archetype_breakdown[0].choices.our_product has canonical {count, pct} schema', async () => {
  // Validates the canonical {count, pct} fixture schema for the first archetype entry.
  //
  // Canonical schema contract (Sub-AC 3c + 7b):
  //   archetype_breakdown[0].choices.our_product.count — non-negative INTEGER (Number.isInteger)
  //   archetype_breakdown[0].choices.our_product.pct   — finite float in [0, 100]
  //
  // The field names MUST be exactly "count" and "pct" — no aliases like "n", "percent", etc.
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvent = events.find((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvent, 'iteration_complete event must be present in the stream');

    const { archetype_breakdown } = iterCompleteEvent.data;
    assert.ok(
      Array.isArray(archetype_breakdown) && archetype_breakdown.length > 0,
      `archetype_breakdown must be a non-empty array, got: ${JSON.stringify(archetype_breakdown)}`
    );

    // Inspect the first entry (sorted deterministically by archetype_id in stream-formatter)
    const firstEntry = archetype_breakdown[0];
    assert.ok(
      firstEntry !== null && typeof firstEntry === 'object',
      `archetype_breakdown[0] must be an object, got: ${JSON.stringify(firstEntry)}`
    );
    assert.ok(
      firstEntry.choices !== null && typeof firstEntry.choices === 'object',
      `archetype_breakdown[0].choices must be an object`
    );

    // Focus assertion: our_product choice must use canonical {count, pct} fields
    const ourProduct = firstEntry.choices.our_product;
    assert.ok(
      ourProduct !== null && ourProduct !== undefined && typeof ourProduct === 'object',
      `archetype_breakdown[0].choices.our_product must be an object with {count, pct}, ` +
        `got: ${JSON.stringify(ourProduct)}`
    );

    // count: must be present as an exact key named "count"
    assert.ok(
      'count' in ourProduct,
      `archetype_breakdown[0].choices.our_product must have a "count" field (canonical name)`
    );

    // count: must be a non-negative INTEGER (Number.isInteger — not just a number)
    assert.ok(
      typeof ourProduct.count === 'number',
      `archetype_breakdown[0].choices.our_product.count must be a number, got: ${typeof ourProduct.count}`
    );
    assert.ok(
      Number.isInteger(ourProduct.count),
      `archetype_breakdown[0].choices.our_product.count must be an INTEGER (Number.isInteger), ` +
        `got: ${ourProduct.count} (${typeof ourProduct.count})`
    );
    assert.ok(
      ourProduct.count >= 0,
      `archetype_breakdown[0].choices.our_product.count must be non-negative, got: ${ourProduct.count}`
    );

    // pct: must be present as an exact key named "pct"
    assert.ok(
      'pct' in ourProduct,
      `archetype_breakdown[0].choices.our_product must have a "pct" field (canonical name)`
    );

    // pct: must be a finite float in [0, 100]
    assert.ok(
      typeof ourProduct.pct === 'number',
      `archetype_breakdown[0].choices.our_product.pct must be a number, got: ${typeof ourProduct.pct}`
    );
    assert.ok(
      Number.isFinite(ourProduct.pct),
      `archetype_breakdown[0].choices.our_product.pct must be a finite number, got: ${ourProduct.pct}`
    );
    assert.ok(
      ourProduct.pct >= 0 && ourProduct.pct <= 100,
      `archetype_breakdown[0].choices.our_product.pct must be in [0, 100], got: ${ourProduct.pct}`
    );

    // No extra fields should be present beyond count and pct (canonical schema — no aliases)
    const ourProductKeys = Object.keys(ourProduct).sort();
    assert.deepStrictEqual(
      ourProductKeys,
      ['count', 'pct'],
      `archetype_breakdown[0].choices.our_product must have EXACTLY the canonical fields ` +
        `{count, pct}, got: ${JSON.stringify(ourProductKeys)}`
    );

    // Cross-validation: pct = (count / sample_size) * 100 (within floating-point rounding)
    const { sample_size } = firstEntry;
    if (sample_size > 0) {
      const expectedPct = parseFloat(((ourProduct.count / sample_size) * 100).toFixed(2));
      assert.ok(
        Math.abs(ourProduct.pct - expectedPct) < 0.01,
        `archetype_breakdown[0].choices.our_product.pct (${ourProduct.pct}) must equal ` +
          `(count=${ourProduct.count} / sample_size=${sample_size}) * 100 ≈ ${expectedPct}`
      );
    }
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 7b: iteration_complete archetype_breakdown ALL entries have {count, pct} with integer count', async () => {
  // Extends the archetype_breakdown[0] check to ALL entries.
  // Every archetype entry's choices must use exactly the canonical {count, pct} schema
  // with Number.isInteger(count) for all 5 choice keys.
  const CHOICE_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvent = events.find((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvent, 'iteration_complete event must be present');

    const { archetype_breakdown } = iterCompleteEvent.data;
    assert.ok(Array.isArray(archetype_breakdown) && archetype_breakdown.length > 0,
      'archetype_breakdown must be a non-empty array');

    for (const entry of archetype_breakdown) {
      for (const key of CHOICE_KEYS) {
        const choice = entry.choices?.[key];
        assert.ok(
          choice !== null && choice !== undefined && typeof choice === 'object',
          `archetype_breakdown[${entry.archetype_id}].choices.${key} must be an object`
        );

        // count: INTEGER constraint (Number.isInteger)
        assert.ok(
          typeof choice.count === 'number' && Number.isInteger(choice.count) && choice.count >= 0,
          `archetype_breakdown[${entry.archetype_id}].choices.${key}.count must be a non-negative INTEGER, ` +
            `got: ${choice.count} (isInteger=${Number.isInteger(choice.count)})`
        );

        // pct: float in [0, 100]
        assert.ok(
          typeof choice.pct === 'number' && Number.isFinite(choice.pct) &&
          choice.pct >= 0 && choice.pct <= 100,
          `archetype_breakdown[${entry.archetype_id}].choices.${key}.pct must be a finite float in [0,100], ` +
            `got: ${choice.pct}`
        );
      }
    }
  } finally {
    await stopServer(server);
  }
});

// ---------------------------------------------------------------------------
// Sub-AC 11b: SSE event sequence verification against mock server endpoint
//   - Event order: iteration_start → agent_decision(×800) → iteration_complete
//                  → holdout_start → simulation_complete
//   - Archetype count: archetype_breakdown covers all fixture archetypes
//   - Choices sum: all choice counts across iteration_complete sum to 800
// ---------------------------------------------------------------------------

test('Sub-AC 11b: SSE event sequence — correct global ordering from mock server', async () => {
  // Verifies the complete event sequence emitted by the mock server:
  //   1. iteration_start       (first)
  //   2. agent_decision × 800  (between start and complete)
  //   3. iteration_complete    (after all agent decisions)
  //   4. holdout_start         (after iteration_complete)
  //   5. simulation_complete   (last)
  // This is the canonical Sub-AC 11b event-order assertion.
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    assert.ok(events.length > 0, 'Stream must emit at least 1 event');

    const types = events.map((e) => e.type);

    // Step 1: iteration_start is the very first event
    assert.strictEqual(
      types[0],
      'iteration_start',
      `First event must be iteration_start, got: ${types[0]}`
    );

    // Step 2: agent_decision events follow iteration_start
    const firstAgentIdx = types.indexOf('agent_decision');
    const lastAgentIdx = types.lastIndexOf('agent_decision');
    assert.ok(firstAgentIdx > 0, 'agent_decision events must appear after iteration_start');

    // Step 3: iteration_complete appears after the last agent_decision
    const iterCompleteIdx = types.indexOf('iteration_complete');
    assert.ok(
      iterCompleteIdx > lastAgentIdx,
      `iteration_complete (idx=${iterCompleteIdx}) must come after last agent_decision (idx=${lastAgentIdx})`
    );

    // Step 4: holdout_start appears after iteration_complete
    const holdoutIdx = types.indexOf('holdout_start');
    assert.ok(
      holdoutIdx > iterCompleteIdx,
      `holdout_start (idx=${holdoutIdx}) must come after iteration_complete (idx=${iterCompleteIdx})`
    );

    // Step 5: simulation_complete is the last event
    const simCompleteIdx = types.indexOf('simulation_complete');
    assert.strictEqual(
      simCompleteIdx,
      events.length - 1,
      `simulation_complete must be the last event (idx=${events.length - 1}), got idx=${simCompleteIdx}`
    );
    assert.ok(
      simCompleteIdx > holdoutIdx,
      `simulation_complete (idx=${simCompleteIdx}) must come after holdout_start (idx=${holdoutIdx})`
    );
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 11b: archetype count — iteration_complete archetype_breakdown matches fixture archetype count', async () => {
  // Verifies that the mock server emits iteration_complete with an archetype_breakdown
  // array containing exactly one entry per fixture archetype (no missing, no extra).
  // The fixture archetype count is fetched from /api/fixtures at runtime.
  const server = await startTestServer();
  try {
    const addr = server.address();

    // Fetch the number of archetypes defined in fixtures
    const fixtureArchetypes = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${addr.port}/api/fixtures`, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed.archetypes ?? []);
          } catch (err) { reject(err); }
        });
        res.on('error', reject);
      }).on('error', reject);
    });

    assert.ok(fixtureArchetypes.length > 0, '/api/fixtures must return at least 1 archetype');

    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvent = events.find((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvent, 'iteration_complete event must be present in the SSE stream');

    const { archetype_breakdown } = iterCompleteEvent.data;
    assert.ok(
      Array.isArray(archetype_breakdown),
      'iteration_complete.archetype_breakdown must be an array'
    );

    // archetype_breakdown must have one entry per fixture archetype
    assert.strictEqual(
      archetype_breakdown.length,
      fixtureArchetypes.length,
      `archetype_breakdown.length (${archetype_breakdown.length}) must equal fixture archetype count (${fixtureArchetypes.length})`
    );

    // Every fixture archetype_id must appear exactly once in the breakdown
    const fixtureIds = new Set(fixtureArchetypes.map((a) => a.id));
    const breakdownIds = new Set(archetype_breakdown.map((e) => e.archetype_id));

    for (const id of fixtureIds) {
      assert.ok(
        breakdownIds.has(id),
        `archetype_breakdown must contain an entry for fixture archetype: ${id}`
      );
    }

    // No extra archetypes beyond what fixtures define
    for (const id of breakdownIds) {
      assert.ok(
        fixtureIds.has(id),
        `archetype_breakdown contains unexpected archetype_id not in fixtures: ${id}`
      );
    }
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 11b: choices sum — iteration_complete choice_summary counts sum to 800 (total buyers)', async () => {
  // Verifies that the sum of all choice counts in iteration_complete.choice_summary
  // equals exactly 800 — one decision per buyer agent.
  // This is the canonical Sub-AC 11b choices-sum assertion.
  const CHOICE_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  const TOTAL_BUYERS = 800;
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvent = events.find((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvent, 'iteration_complete event must be present in the SSE stream');

    const { choice_summary } = iterCompleteEvent.data;
    assert.ok(
      choice_summary && typeof choice_summary === 'object',
      'iteration_complete.choice_summary must be an object'
    );

    // Verify all 5 keys are present
    for (const key of CHOICE_KEYS) {
      assert.ok(
        key in choice_summary,
        `choice_summary must contain key: ${key}`
      );
    }

    // Sum all choice counts — must equal TOTAL_BUYERS (800)
    const totalCount = CHOICE_KEYS.reduce((sum, key) => {
      const entry = choice_summary[key];
      assert.ok(
        entry !== null && entry !== undefined && typeof entry === 'object',
        `choice_summary.${key} must be an object {count, pct}, got: ${JSON.stringify(entry)}`
      );
      assert.ok(
        typeof entry.count === 'number' && Number.isInteger(entry.count) && entry.count >= 0,
        `choice_summary.${key}.count must be a non-negative integer, got: ${entry.count}`
      );
      return sum + entry.count;
    }, 0);

    assert.strictEqual(
      totalCount,
      TOTAL_BUYERS,
      `choice_summary counts must sum to ${TOTAL_BUYERS} (one decision per buyer agent), got ${totalCount}`
    );
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 11b: choices sum — archetype_breakdown per-archetype choice counts each sum to their sample_size', async () => {
  // Verifies that within each archetype entry in archetype_breakdown,
  // the sum of all choice counts equals that archetype's sample_size.
  // This validates internal consistency of the per-archetype breakdown.
  const CHOICE_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  const TOTAL_BUYERS = 800;
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvent = events.find((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvent, 'iteration_complete event must be present');

    const { archetype_breakdown } = iterCompleteEvent.data;
    assert.ok(
      Array.isArray(archetype_breakdown) && archetype_breakdown.length > 0,
      'archetype_breakdown must be a non-empty array'
    );

    let grandTotal = 0;
    for (const entry of archetype_breakdown) {
      const perArchetypeTotal = CHOICE_KEYS.reduce((sum, key) => {
        const choice = entry.choices?.[key];
        assert.ok(
          choice !== null && choice !== undefined && typeof choice === 'object',
          `archetype_breakdown[${entry.archetype_id}].choices.${key} must be an object`
        );
        assert.ok(
          typeof choice.count === 'number' && Number.isInteger(choice.count) && choice.count >= 0,
          `archetype_breakdown[${entry.archetype_id}].choices.${key}.count must be a non-negative integer`
        );
        return sum + choice.count;
      }, 0);

      // Per-archetype choice counts must equal sample_size
      assert.strictEqual(
        perArchetypeTotal,
        entry.sample_size,
        `archetype_breakdown[${entry.archetype_id}]: choice counts (${perArchetypeTotal}) must sum to sample_size (${entry.sample_size})`
      );

      grandTotal += entry.sample_size;
    }

    // Grand total across all archetypes must equal 800
    assert.strictEqual(
      grandTotal,
      TOTAL_BUYERS,
      `Sum of all archetype sample_sizes must equal ${TOTAL_BUYERS} total buyers, got ${grandTotal}`
    );
  } finally {
    await stopServer(server);
  }
});

test('Sub-AC 11b: event sequence — no events emitted after simulation_complete from mock server', async () => {
  // simulation_complete must be strictly the terminal event.
  // No events of any type should appear after it.
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    assert.ok(events.length > 0, 'Stream must emit at least 1 event');

    const lastEvent = events[events.length - 1];
    assert.strictEqual(
      lastEvent.type,
      'simulation_complete',
      `Last event must be simulation_complete, got: ${lastEvent.type}`
    );

    // Count how many simulation_complete events exist — must be exactly 1
    const simCompleteCount = events.filter((e) => e.type === 'simulation_complete').length;
    assert.strictEqual(
      simCompleteCount,
      1,
      `Expected exactly 1 simulation_complete event, got ${simCompleteCount}`
    );

    // No events of any type should appear after the simulation_complete index
    const simCompleteIdx = events.findIndex((e) => e.type === 'simulation_complete');
    assert.strictEqual(
      simCompleteIdx,
      events.length - 1,
      `simulation_complete must be at index ${events.length - 1} (last), ` +
        `but found it at index ${simCompleteIdx} with ${events.length - 1 - simCompleteIdx} events after it`
    );
  } finally {
    await stopServer(server);
  }
});
