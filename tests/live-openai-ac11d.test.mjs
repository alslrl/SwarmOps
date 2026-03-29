/**
 * Sub-AC 11d: Live OpenAI Verification
 *
 * Tests that the full simulation pipeline works end-to-end with real OpenAI
 * API calls (SELLER_WAR_GAME_MODEL_MODE=live).
 *
 * Verification steps:
 *   1. Set SELLER_WAR_GAME_MODEL_MODE=live
 *   2. Start server
 *   3. POST /api/run/stream with iterationCount=1
 *   4. Assert simulation_complete event exists in response
 *   5. Assert holdout_uplift field exists in the simulation_complete payload
 *
 * This test makes real OpenAI API calls and requires OPENAI_API_KEY to be set.
 * Run this test independently — it is NOT included in the standard npm test suite.
 *
 * Usage:
 *   node --test tests/live-openai-ac11d.test.mjs
 *   SELLER_WAR_GAME_MODEL_MODE=live node --test tests/live-openai-ac11d.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helper: Load .env file (mirrors logic in openai/client.mjs)
// ---------------------------------------------------------------------------
async function loadEnvFile() {
  const { default: fs } = await import('node:fs/promises');
  const envPath = path.join(PROJECT_ROOT, '.env');
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env not found — rely on environment variables already set
  }
}

// ---------------------------------------------------------------------------
// Helper: Parse SSE text stream into { type, data } objects
// ---------------------------------------------------------------------------
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
        // ignore malformed lines
      }
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Helper: POST /api/run/stream and collect all SSE events
// ---------------------------------------------------------------------------
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
        const lastDoubleNewline = buffer.lastIndexOf('\n\n');
        if (lastDoubleNewline !== -1) {
          buffer = buffer.slice(lastDoubleNewline + 2);
        }
      });

      res.on('end', () => {
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

// ---------------------------------------------------------------------------
// Helper: Start live-mode server on an OS-assigned port
// ---------------------------------------------------------------------------
async function startLiveServer() {
  // Ensure .env is loaded before importing the server
  await loadEnvFile();

  // Set live mode BEFORE importing the server module so the OpenAI client
  // picks up the mode at construction time.
  process.env.SELLER_WAR_GAME_MODEL_MODE = 'live';

  const { createServer } = await import('../src/server.mjs');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// Guard: skip the test suite if OPENAI_API_KEY is not available
// ---------------------------------------------------------------------------
await loadEnvFile();

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey || apiKey.trim() === '') {
  console.warn(
    '[Sub-AC 11d] OPENAI_API_KEY is not set — skipping live OpenAI verification tests.\n' +
    'Set OPENAI_API_KEY in .env or environment to run this test suite.'
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Sub-AC 11d: Live OpenAI verification tests
// ---------------------------------------------------------------------------

test(
  'Sub-AC 11d: simulation_complete event emitted in live OpenAI mode',
  { timeout: 600_000 }, // 10-minute timeout — live API calls take time
  async () => {
    const server = await startLiveServer();
    try {
      const events = await collectSseEvents(server, {
        iterationCount: 1,
        minimumMarginFloor: 0.35,
      });

      assert.ok(
        events.length > 0,
        'Stream must emit at least 1 event in live mode'
      );

      // Assert that simulation_complete event is present in the stream
      const simComplete = events.find((e) => e.type === 'simulation_complete');
      assert.ok(
        simComplete !== undefined,
        `simulation_complete event must be present in live mode SSE stream. ` +
        `Got event types: [${events.map((e) => e.type).join(', ')}]`
      );

      // Assert simulation_complete is the final event
      const lastEvent = events[events.length - 1];
      assert.strictEqual(
        lastEvent.type,
        'simulation_complete',
        `simulation_complete must be the last event, got: ${lastEvent.type}`
      );
    } finally {
      await stopServer(server);
    }
  }
);

test(
  'Sub-AC 11d: holdout_uplift field exists in simulation_complete payload from live mode',
  { timeout: 600_000 }, // 10-minute timeout — live API calls take time
  async () => {
    const server = await startLiveServer();
    try {
      const events = await collectSseEvents(server, {
        iterationCount: 1,
        minimumMarginFloor: 0.35,
      });

      // Find simulation_complete event
      const simComplete = events.find((e) => e.type === 'simulation_complete');
      assert.ok(
        simComplete !== undefined,
        'simulation_complete event must be present in live mode SSE stream'
      );

      const payload = simComplete.data;

      // Assert holdout object exists
      assert.ok(
        payload.holdout !== null && typeof payload.holdout === 'object',
        `simulation_complete.holdout must be a non-null object, got: ${JSON.stringify(payload.holdout)}`
      );

      // Assert holdout_uplift field exists (the key field per the AC)
      assert.ok(
        'holdout_uplift' in payload.holdout,
        `simulation_complete.holdout must contain holdout_uplift field. ` +
        `Got holdout keys: [${Object.keys(payload.holdout ?? {}).join(', ')}]`
      );

      // Assert holdout_uplift is a finite number
      assert.ok(
        typeof payload.holdout.holdout_uplift === 'number' &&
        Number.isFinite(payload.holdout.holdout_uplift),
        `holdout_uplift must be a finite number, got: ${payload.holdout.holdout_uplift}`
      );

      // Log summary for visibility
      const { holdout_uplift, passes_gate } = payload.holdout;
      console.log(
        `[Sub-AC 11d] Live run complete:\n` +
        `  holdout_uplift = ${holdout_uplift} KRW\n` +
        `  passes_gate    = ${passes_gate}`
      );
    } finally {
      await stopServer(server);
    }
  }
);

test(
  'Sub-AC 11d: simulation_complete payload shape — baseline, selected_strategy, diff, artifact all present',
  { timeout: 600_000 }, // 10-minute timeout — live API calls take time
  async () => {
    const server = await startLiveServer();
    try {
      const events = await collectSseEvents(server, {
        iterationCount: 1,
        minimumMarginFloor: 0.35,
      });

      const simComplete = events.find((e) => e.type === 'simulation_complete');
      assert.ok(simComplete !== undefined, 'simulation_complete event must be present');

      const payload = simComplete.data;

      // Verify all required top-level fields exist in simulation_complete
      const requiredFields = ['baseline', 'selected_strategy', 'holdout', 'diff', 'artifact'];
      for (const field of requiredFields) {
        assert.ok(
          field in payload && payload[field] !== undefined,
          `simulation_complete payload must contain "${field}" field`
        );
      }

      // Verify event type field
      assert.strictEqual(
        payload.type,
        'simulation_complete',
        `payload.type must be "simulation_complete", got: ${payload.type}`
      );
    } finally {
      await stopServer(server);
    }
  }
);

// ---------------------------------------------------------------------------
// Sub-AC 11d (Sub-AC 2): Live OpenAI streaming validation
// Verify that the SSE stream from a live run contains valid, non-mock events
// ---------------------------------------------------------------------------

test(
  'Sub-AC 11d (Sub-AC 2): SSE event sequence — iteration_start before agent_decisions before simulation_complete',
  { timeout: 600_000 },
  async () => {
    const server = await startLiveServer();
    try {
      const events = await collectSseEvents(server, {
        iterationCount: 1,
        minimumMarginFloor: 0.35,
      });

      assert.ok(events.length > 0, 'Stream must emit events in live mode');

      const eventTypes = events.map((e) => e.type);

      // iteration_start must appear before any agent_decision
      const firstIterStart = eventTypes.indexOf('iteration_start');
      const firstAgentDecision = eventTypes.indexOf('agent_decision');
      assert.ok(firstIterStart !== -1, 'iteration_start event must be present in live mode stream');
      assert.ok(firstAgentDecision !== -1, 'agent_decision event must be present in live mode stream');
      assert.ok(
        firstIterStart < firstAgentDecision,
        `iteration_start (index ${firstIterStart}) must appear before first agent_decision (index ${firstAgentDecision})`
      );

      // simulation_complete must be the last event
      const lastEvent = events[events.length - 1];
      assert.strictEqual(
        lastEvent.type,
        'simulation_complete',
        `Last event must be simulation_complete, got: ${lastEvent.type}`
      );

      // No error events in a successful live run
      const errorEvents = events.filter((e) => e.type === 'error');
      assert.strictEqual(
        errorEvents.length,
        0,
        `No error events expected in successful live run. Got: ${JSON.stringify(errorEvents)}`
      );

      console.log(
        `[Sub-AC 2] Event sequence validated:\n` +
        `  Total events: ${events.length}\n` +
        `  Event types: ${[...new Set(eventTypes)].join(', ')}`
      );
    } finally {
      await stopServer(server);
    }
  }
);

test(
  'Sub-AC 11d (Sub-AC 2): agent_decision events — valid structure from live LLM calls',
  { timeout: 600_000 },
  async () => {
    const server = await startLiveServer();
    try {
      const events = await collectSseEvents(server, {
        iterationCount: 1,
        minimumMarginFloor: 0.35,
      });

      const agentDecisions = events.filter((e) => e.type === 'agent_decision');
      assert.ok(
        agentDecisions.length > 0,
        'At least one agent_decision event must be present in live mode stream'
      );

      const VALID_CHOICES = new Set(['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']);

      // Validate a sample of agent_decision events (first 10 for speed)
      const sample = agentDecisions.slice(0, 10);
      for (const event of sample) {
        const d = event.data;

        // Required fields present
        assert.ok(typeof d.agent_id === 'string' && d.agent_id.length > 0,
          `agent_decision.agent_id must be a non-empty string, got: ${d.agent_id}`);
        assert.ok(typeof d.agent_name === 'string' && d.agent_name.length > 0,
          `agent_decision.agent_name must be a non-empty string, got: ${d.agent_name}`);
        assert.ok(typeof d.archetype_id === 'string' && d.archetype_id.length > 0,
          `agent_decision.archetype_id must be a non-empty string, got: ${d.archetype_id}`);

        // chosen_product must be a valid choice
        assert.ok(
          VALID_CHOICES.has(d.chosen_product),
          `agent_decision.chosen_product "${d.chosen_product}" must be one of: ${[...VALID_CHOICES].join(', ')}`
        );

        // reasoning must be non-empty (indicates real LLM response, not empty fallback)
        assert.ok(
          typeof d.reasoning === 'string' && d.reasoning.trim().length > 0,
          `agent_decision.reasoning must be a non-empty string. Got: "${d.reasoning}"`
        );

        // agent_index must be a non-negative number
        assert.ok(
          typeof d.agent_index === 'number' && d.agent_index >= 0,
          `agent_decision.agent_index must be >= 0, got: ${d.agent_index}`
        );

        // iteration must be a positive number
        assert.ok(
          typeof d.iteration === 'number' && d.iteration >= 1,
          `agent_decision.iteration must be >= 1, got: ${d.iteration}`
        );
      }

      console.log(
        `[Sub-AC 2] agent_decision structure validated:\n` +
        `  Total agent_decision events: ${agentDecisions.length}\n` +
        `  Sample validated: ${sample.length}`
      );
    } finally {
      await stopServer(server);
    }
  }
);

test(
  'Sub-AC 11d (Sub-AC 2): agent_decision — Korean agent names present in live mode',
  { timeout: 600_000 },
  async () => {
    const server = await startLiveServer();
    try {
      const events = await collectSseEvents(server, {
        iterationCount: 1,
        minimumMarginFloor: 0.35,
      });

      const agentDecisions = events.filter((e) => e.type === 'agent_decision');
      assert.ok(agentDecisions.length > 0, 'agent_decision events must be present');

      // Check that agent names contain Korean characters (Hangul Unicode range: \uAC00-\uD7A3)
      const koreanRegex = /[\uAC00-\uD7A3]/;
      const sample = agentDecisions.slice(0, 20);
      const namesWithKorean = sample.filter((e) => koreanRegex.test(e.data.agent_name));

      assert.ok(
        namesWithKorean.length > 0,
        `At least some agent_decision.agent_name fields must contain Korean characters. ` +
        `Sample names: ${sample.map((e) => e.data.agent_name).join(', ')}`
      );

      console.log(
        `[Sub-AC 2] Korean agent names validated:\n` +
        `  Sample with Korean names: ${namesWithKorean.length}/${sample.length}`
      );
    } finally {
      await stopServer(server);
    }
  }
);

test(
  'Sub-AC 11d (Sub-AC 2): iteration_complete event — valid structure in live mode',
  { timeout: 600_000 },
  async () => {
    const server = await startLiveServer();
    try {
      const events = await collectSseEvents(server, {
        iterationCount: 1,
        minimumMarginFloor: 0.35,
      });

      const iterComplete = events.find((e) => e.type === 'iteration_complete');
      assert.ok(
        iterComplete !== undefined,
        'iteration_complete event must be present in live mode stream'
      );

      const d = iterComplete.data;

      // winner_id must be a non-empty string
      assert.ok(
        typeof d.winner_id === 'string' && d.winner_id.length > 0,
        `iteration_complete.winner_id must be a non-empty string, got: ${d.winner_id}`
      );

      // winner_revenue must be a positive number (KRW)
      assert.ok(
        typeof d.winner_revenue === 'number' && d.winner_revenue > 0,
        `iteration_complete.winner_revenue must be > 0, got: ${d.winner_revenue}`
      );

      // choice_summary must be present and valid
      assert.ok(
        d.choice_summary && typeof d.choice_summary === 'object',
        `iteration_complete.choice_summary must be a non-null object`
      );

      const CHOICE_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
      for (const key of CHOICE_KEYS) {
        assert.ok(
          key in d.choice_summary,
          `iteration_complete.choice_summary must contain "${key}" key`
        );
        assert.ok(
          typeof d.choice_summary[key].count === 'number',
          `iteration_complete.choice_summary.${key}.count must be a number`
        );
      }

      // Total choices should sum to 800 (main cohort size)
      const totalChoices = CHOICE_KEYS.reduce((sum, k) => sum + (d.choice_summary[k]?.count ?? 0), 0);
      assert.strictEqual(
        totalChoices,
        800,
        `iteration_complete.choice_summary counts must sum to 800, got: ${totalChoices}`
      );

      console.log(
        `[Sub-AC 2] iteration_complete structure validated:\n` +
        `  winner_id: ${d.winner_id}\n` +
        `  winner_revenue: ${d.winner_revenue} KRW\n` +
        `  total_choices: ${totalChoices}`
      );
    } finally {
      await stopServer(server);
    }
  }
);

test(
  'Sub-AC 11d (Sub-AC 2): iteration_start event — gpt-5.4 strategy proposals present in live mode',
  { timeout: 600_000 },
  async () => {
    const server = await startLiveServer();
    try {
      const events = await collectSseEvents(server, {
        iterationCount: 1,
        minimumMarginFloor: 0.35,
      });

      const iterStart = events.find((e) => e.type === 'iteration_start');
      assert.ok(
        iterStart !== undefined,
        'iteration_start event must be present in live mode stream'
      );

      const d = iterStart.data;

      // iteration must be 1-based
      assert.ok(
        typeof d.iteration === 'number' && d.iteration >= 1,
        `iteration_start.iteration must be >= 1, got: ${d.iteration}`
      );

      // total must be >= iteration
      assert.ok(
        typeof d.total === 'number' && d.total >= d.iteration,
        `iteration_start.total (${d.total}) must be >= iteration (${d.iteration})`
      );

      // candidates must be a non-empty array (strategies from gpt-5.4)
      assert.ok(
        Array.isArray(d.candidates) && d.candidates.length > 0,
        `iteration_start.candidates must be a non-empty array (strategies from gpt-5.4). ` +
        `Got: ${JSON.stringify(d.candidates)}`
      );

      // Each candidate must have id, title, price_krw
      for (const candidate of d.candidates) {
        assert.ok(
          typeof candidate.id === 'string' && candidate.id.length > 0,
          `candidate.id must be a non-empty string, got: ${candidate.id}`
        );
        assert.ok(
          typeof candidate.title === 'string' && candidate.title.length > 0,
          `candidate.title must be a non-empty string, got: ${candidate.title}`
        );
        assert.ok(
          typeof candidate.price_krw === 'number' && candidate.price_krw > 0,
          `candidate.price_krw must be a positive number (KRW), got: ${candidate.price_krw}`
        );
      }

      console.log(
        `[Sub-AC 2] iteration_start validated (gpt-5.4 strategy generation):\n` +
        `  iteration: ${d.iteration}/${d.total}\n` +
        `  candidate count: ${d.candidates.length}\n` +
        `  candidates: ${d.candidates.map((c) => `"${c.title}" (${c.price_krw}원)`).join(', ')}`
      );
    } finally {
      await stopServer(server);
    }
  }
);

test(
  'Sub-AC 11d (Sub-AC 2): live mode — reasoning text is substantive (not empty mock response)',
  { timeout: 600_000 },
  async () => {
    const server = await startLiveServer();
    try {
      const events = await collectSseEvents(server, {
        iterationCount: 1,
        minimumMarginFloor: 0.35,
      });

      const agentDecisions = events.filter((e) => e.type === 'agent_decision');
      assert.ok(agentDecisions.length > 0, 'agent_decision events must be present');

      // In live mode, gpt-5-nano should produce substantive reasoning (≥10 chars)
      // This distinguishes a real LLM response from a trivially short or empty fallback.
      const MIN_REASONING_LENGTH = 10;
      const sample = agentDecisions.slice(0, 50);
      const substantiveReasonings = sample.filter(
        (e) => typeof e.data.reasoning === 'string' && e.data.reasoning.trim().length >= MIN_REASONING_LENGTH
      );

      assert.ok(
        substantiveReasonings.length > sample.length * 0.8,
        `At least 80% of agent_decision reasoning fields must be substantive (≥${MIN_REASONING_LENGTH} chars). ` +
        `Got ${substantiveReasonings.length}/${sample.length} substantive. ` +
        `Sample: ${sample.slice(0, 3).map((e) => `"${e.data.reasoning?.slice(0, 50)}..."`).join(', ')}`
      );

      const avgLength = sample.reduce((sum, e) => sum + (e.data.reasoning?.length ?? 0), 0) / sample.length;
      console.log(
        `[Sub-AC 2] Reasoning substantiveness validated:\n` +
        `  Substantive: ${substantiveReasonings.length}/${sample.length}\n` +
        `  Average reasoning length: ${Math.round(avgLength)} chars`
      );
    } finally {
      await stopServer(server);
    }
  }
);
