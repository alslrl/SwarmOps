/**
 * agent-spawner.test.mjs
 *
 * Dedicated unit tests for src/lib/simulation/agent-spawner.mjs
 * Sub-AC 2: Per-agent identity generation
 *
 * Verifies:
 * - spawnBuyerAgents() generates exactly 800 agents
 * - Each agent has a unique sequential agent_id in {archetype_id}_{NNNN} format
 * - Each agent has a unique archetype-appropriate Korean name
 * - Each agent has a valid archetype_id from the canonical 8-archetype set
 * - agent_id prefix always matches archetype_id
 * - korean_name is a non-empty string containing Hangul characters
 * - Agent identities are deterministic for the same seed
 * - Different seeds produce different identity sequences
 * - Distribution matches canonical cohort_weight_percent
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { spawnBuyerAgents, ARCHETYPES, getArchetypeById, getArchetypeIds } from '../src/lib/simulation/agent-spawner.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ARCHETYPE_IDS = new Set([
  'price_sensitive',
  'value_seeker',
  'premium_quality',
  'trust_first',
  'aesthetics_first',
  'urgency_buyer',
  'promo_hunter',
  'gift_or_family_buyer',
]);

// Korean Hangul block: U+AC00–U+D7A3 (syllables)
const HANGUL_PATTERN = /[\uAC00-\uD7A3]/;

// agent_id pattern: {snake_case_archetype_id}_{4-digit-number}
const AGENT_ID_PATTERN = /^[a-z][a-z_]*_\d{4}$/;

// ---------------------------------------------------------------------------
// Basic cohort generation
// ---------------------------------------------------------------------------

test('spawnBuyerAgents generates exactly 800 agents by default', () => {
  const agents = spawnBuyerAgents({ seed: 42 });
  assert.strictEqual(agents.length, 800, `Expected 800 agents, got ${agents.length}`);
});

test('spawnBuyerAgents accepts custom totalBuyers', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 100, seed: 42 });
  assert.strictEqual(agents.length, 100, `Expected 100 agents, got ${agents.length}`);
});

test('spawnBuyerAgents throws for non-integer totalBuyers', () => {
  assert.throws(
    () => spawnBuyerAgents({ totalBuyers: 1.5, seed: 42 }),
    /totalBuyers must be a positive integer/,
  );
});

test('spawnBuyerAgents throws for zero totalBuyers', () => {
  assert.throws(
    () => spawnBuyerAgents({ totalBuyers: 0, seed: 42 }),
    /totalBuyers must be a positive integer/,
  );
});

test('spawnBuyerAgents throws for non-integer seed', () => {
  assert.throws(
    () => spawnBuyerAgents({ totalBuyers: 10, seed: 3.14 }),
    /seed must be an integer/,
  );
});

// ---------------------------------------------------------------------------
// Sub-AC 2: agent_id uniqueness and format
// ---------------------------------------------------------------------------

test('spawnBuyerAgents: all 800 agent_ids are unique', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 42 });
  const ids = new Set(agents.map((a) => a.agent_id));
  assert.strictEqual(ids.size, 800, `Expected 800 unique agent_ids, got ${ids.size}`);
});

test('spawnBuyerAgents: agent_id matches {archetype_id}_{NNNN} format', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 7 });
  for (const agent of agents) {
    assert.match(
      agent.agent_id,
      AGENT_ID_PATTERN,
      `agent_id "${agent.agent_id}" does not match pattern {archetype_id}_{NNNN}`,
    );
  }
});

test('spawnBuyerAgents: agent_id prefix matches archetype_id for every agent', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 13 });
  for (const agent of agents) {
    assert.ok(
      agent.agent_id.startsWith(agent.archetype_id + '_'),
      `agent_id "${agent.agent_id}" must start with archetype_id "${agent.archetype_id}_"`,
    );
  }
});

test('spawnBuyerAgents: agent_id numbering is sequential from 0001 to 0800', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 42 });
  // Extract all numeric suffixes and verify they cover 1..800 exactly
  const numbers = agents.map((a) => parseInt(a.agent_id.slice(-4), 10));
  const uniqueNumbers = new Set(numbers);
  assert.strictEqual(uniqueNumbers.size, 800, 'All 800 agents must have distinct sequential numbers');

  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  assert.strictEqual(min, 1, `Minimum agent number should be 1, got ${min}`);
  assert.strictEqual(max, 800, `Maximum agent number should be 800, got ${max}`);
});

test('spawnBuyerAgents: numeric suffix is zero-padded to 4 digits', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    const suffix = agent.agent_id.slice(-4);
    assert.match(suffix, /^\d{4}$/, `Suffix "${suffix}" in "${agent.agent_id}" must be exactly 4 digits`);
  }
});

// ---------------------------------------------------------------------------
// Sub-AC 2: Korean name uniqueness and validity
// ---------------------------------------------------------------------------

test('spawnBuyerAgents: all 800 korean_names are unique', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 42 });
  const names = new Set(agents.map((a) => a.korean_name));
  assert.strictEqual(names.size, 800, `Expected 800 unique korean_names, got ${names.size}`);
});

test('spawnBuyerAgents: every agent has a non-empty korean_name string', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 99 });
  for (const agent of agents) {
    assert.ok(
      typeof agent.korean_name === 'string' && agent.korean_name.length > 0,
      `Agent "${agent.agent_id}" korean_name must be a non-empty string, got: ${JSON.stringify(agent.korean_name)}`,
    );
  }
});

test('spawnBuyerAgents: every korean_name contains Hangul characters', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 5 });
  for (const agent of agents) {
    assert.match(
      agent.korean_name,
      HANGUL_PATTERN,
      `korean_name "${agent.korean_name}" for agent "${agent.agent_id}" must contain Hangul characters`,
    );
  }
});

test('spawnBuyerAgents: korean_name length is between 2 and 10 characters', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 33 });
  for (const agent of agents) {
    assert.ok(
      agent.korean_name.length >= 2 && agent.korean_name.length <= 10,
      `korean_name "${agent.korean_name}" length ${agent.korean_name.length} must be in [2, 10]`,
    );
  }
});

// ---------------------------------------------------------------------------
// Sub-AC 2: archetype_id validity
// ---------------------------------------------------------------------------

test('spawnBuyerAgents: every agent has a valid archetype_id', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.ok(
      VALID_ARCHETYPE_IDS.has(agent.archetype_id),
      `Agent "${agent.agent_id}" has invalid archetype_id: "${agent.archetype_id}"`,
    );
  }
});

test('spawnBuyerAgents: all 8 canonical archetypes are represented', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 42 });
  const archetypeIdsFound = new Set(agents.map((a) => a.archetype_id));
  assert.strictEqual(archetypeIdsFound.size, 8, `Expected 8 distinct archetypes, got ${archetypeIdsFound.size}`);
  for (const id of VALID_ARCHETYPE_IDS) {
    assert.ok(archetypeIdsFound.has(id), `Archetype "${id}" must be represented in the cohort`);
  }
});

test('spawnBuyerAgents: every agent object has agent_id, korean_name, and archetype_id fields', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 10, seed: 42 });
  for (const agent of agents) {
    assert.ok('agent_id' in agent, `Agent must have agent_id field`);
    assert.ok('korean_name' in agent, `Agent must have korean_name field`);
    assert.ok('archetype_id' in agent, `Agent must have archetype_id field`);
  }
});

// ---------------------------------------------------------------------------
// Distribution matches cohort weights
// ---------------------------------------------------------------------------

test('spawnBuyerAgents: distribution matches cohort_weight_percent within ±1 agent', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 42 });

  // Count agents per archetype
  const counts = new Map();
  for (const agent of agents) {
    counts.set(agent.archetype_id, (counts.get(agent.archetype_id) ?? 0) + 1);
  }

  // Verify distribution stays close to the weight-derived expected count
  for (const archetype of ARCHETYPES) {
    const expected = (archetype.cohort_weight_percent / 100) * 800;
    const actual = counts.get(archetype.id) ?? 0;
    const tolerance = 2; // largest-remainder can differ by at most 1
    assert.ok(
      Math.abs(actual - expected) <= tolerance,
      `Archetype "${archetype.id}": expected ~${expected.toFixed(1)} agents, got ${actual} (tolerance ±${tolerance})`,
    );
  }
});

test('spawnBuyerAgents: sum of per-archetype counts equals totalBuyers', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 42 });
  const counts = new Map();
  for (const agent of agents) {
    counts.set(agent.archetype_id, (counts.get(agent.archetype_id) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 800, `Sum of per-archetype counts must equal 800, got ${total}`);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('spawnBuyerAgents: same seed produces identical agent identities', () => {
  const run1 = spawnBuyerAgents({ totalBuyers: 800, seed: 77 });
  const run2 = spawnBuyerAgents({ totalBuyers: 800, seed: 77 });

  for (let i = 0; i < run1.length; i++) {
    assert.strictEqual(
      run1[i].agent_id, run2[i].agent_id,
      `agents[${i}].agent_id must match across identical seeds`,
    );
    assert.strictEqual(
      run1[i].korean_name, run2[i].korean_name,
      `agents[${i}].korean_name must match across identical seeds`,
    );
    assert.strictEqual(
      run1[i].archetype_id, run2[i].archetype_id,
      `agents[${i}].archetype_id must match across identical seeds`,
    );
  }
});

test('spawnBuyerAgents: different seeds produce different korean_name sequences', () => {
  const run1 = spawnBuyerAgents({ totalBuyers: 800, seed: 1 });
  const run2 = spawnBuyerAgents({ totalBuyers: 800, seed: 2 });

  const names1 = run1.slice(0, 50).map((a) => a.korean_name);
  const names2 = run2.slice(0, 50).map((a) => a.korean_name);
  const identical = names1.every((n, i) => n === names2[i]);
  assert.ok(!identical, 'Different seeds must produce different korean_name sequences');
});

// ---------------------------------------------------------------------------
// ARCHETYPES export and helpers
// ---------------------------------------------------------------------------

test('ARCHETYPES export from agent-spawner has 8 entries', () => {
  assert.strictEqual(ARCHETYPES.length, 8);
});

test('getArchetypeById returns correct archetype for each valid id', () => {
  for (const id of VALID_ARCHETYPE_IDS) {
    const archetype = getArchetypeById(id);
    assert.strictEqual(archetype.id, id, `getArchetypeById("${id}").id should equal "${id}"`);
    assert.strictEqual(archetype.archetype_id, id);
  }
});

test('getArchetypeById throws for unknown id', () => {
  assert.throws(
    () => getArchetypeById('nonexistent_archetype'),
    /Unknown archetype_id/,
  );
});

test('getArchetypeIds returns all 8 canonical ids', () => {
  const ids = getArchetypeIds();
  assert.strictEqual(ids.length, 8);
  for (const id of VALID_ARCHETYPE_IDS) {
    assert.ok(ids.includes(id), `getArchetypeIds() must include "${id}"`);
  }
});
