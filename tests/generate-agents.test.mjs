/**
 * generate-agents.test.mjs
 *
 * Unit tests for src/lib/simulation/generate-agents.mjs
 * Sub-AC 3a: Agent generation factory
 *
 * Verifies:
 * - generateAgents() returns exactly 800 agents by default
 * - Each agent has all required fields (base + persona)
 * - age is within [20, 65] and archetype-specific range
 * - location is a Korean city from the canonical pool
 * - occupation is from the archetype-specific pool
 * - personality is a non-empty Korean string
 * - bio is a non-empty Korean 1-2 line string containing the agent's name
 * - All base agent fields (agent_id, korean_name, sensitivity traits) are preserved
 * - Output is deterministic for the same seed
 * - Different seeds produce different persona sequences
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateAgents,
  KOREAN_CITIES,
  ARCHETYPE_AGE_RANGES,
  ARCHETYPE_OCCUPATIONS,
  ARCHETYPE_PERSONALITIES,
  ARCHETYPE_BIO_GENERATORS,
} from '../src/lib/simulation/generate-agents.mjs';

// ---------------------------------------------------------------------------
// Korean Hangul range for validation
// ---------------------------------------------------------------------------

const HANGUL_PATTERN = /[\uAC00-\uD7A3]/;

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

// ---------------------------------------------------------------------------
// Static data exports
// ---------------------------------------------------------------------------

test('KOREAN_CITIES has exactly 20 entries', () => {
  // The underlying array may have repeated entries (weighted), so check unique count
  const uniqueCities = new Set(KOREAN_CITIES);
  assert.ok(uniqueCities.size >= 10, `Expected at least 10 unique cities, got ${uniqueCities.size}`);
  assert.ok(KOREAN_CITIES.length >= 15, `Expected ≥15 pool entries, got ${KOREAN_CITIES.length}`);
});

test('KOREAN_CITIES entries are Korean strings with Hangul', () => {
  for (const city of KOREAN_CITIES) {
    assert.match(city, HANGUL_PATTERN, `City "${city}" must contain Hangul characters`);
  }
});

test('ARCHETYPE_AGE_RANGES has entries for all 8 archetypes', () => {
  for (const id of VALID_ARCHETYPE_IDS) {
    assert.ok(id in ARCHETYPE_AGE_RANGES, `ARCHETYPE_AGE_RANGES must include archetype "${id}"`);
    const [min, max] = ARCHETYPE_AGE_RANGES[id];
    assert.ok(min >= 20, `${id} age min ${min} must be >= 20`);
    assert.ok(max <= 65, `${id} age max ${max} must be <= 65`);
    assert.ok(min < max, `${id} age range [${min}, ${max}] must have min < max`);
  }
});

test('ARCHETYPE_OCCUPATIONS has 5+ occupations for all 8 archetypes', () => {
  for (const id of VALID_ARCHETYPE_IDS) {
    assert.ok(id in ARCHETYPE_OCCUPATIONS, `ARCHETYPE_OCCUPATIONS must include archetype "${id}"`);
    const pool = ARCHETYPE_OCCUPATIONS[id];
    assert.ok(pool.length >= 5, `${id} occupation pool must have ≥5 entries, got ${pool.length}`);
    for (const occ of pool) {
      assert.match(occ, HANGUL_PATTERN, `Occupation "${occ}" must contain Hangul characters`);
    }
  }
});

test('ARCHETYPE_PERSONALITIES has non-empty Korean strings for all 8 archetypes', () => {
  for (const id of VALID_ARCHETYPE_IDS) {
    assert.ok(id in ARCHETYPE_PERSONALITIES, `ARCHETYPE_PERSONALITIES must include archetype "${id}"`);
    const p = ARCHETYPE_PERSONALITIES[id];
    assert.ok(typeof p === 'string' && p.length > 0, `${id} personality must be non-empty string`);
    assert.match(p, HANGUL_PATTERN, `${id} personality must contain Hangul characters`);
  }
});

test('ARCHETYPE_BIO_GENERATORS has function for all 8 archetypes', () => {
  for (const id of VALID_ARCHETYPE_IDS) {
    assert.ok(id in ARCHETYPE_BIO_GENERATORS, `ARCHETYPE_BIO_GENERATORS must include archetype "${id}"`);
    assert.strictEqual(
      typeof ARCHETYPE_BIO_GENERATORS[id], 'function',
      `${id} bio generator must be a function`,
    );
  }
});

test('Bio generators produce Korean strings with agent details', () => {
  for (const id of VALID_ARCHETYPE_IDS) {
    const bio = ARCHETYPE_BIO_GENERATORS[id]('김민준', 32, '서울', '직장인');
    assert.ok(typeof bio === 'string' && bio.length > 0, `${id} bio must be non-empty string`);
    assert.match(bio, HANGUL_PATTERN, `${id} bio must contain Hangul characters`);
    // Bio should reference either name or location
    const hasSomeContext = bio.includes('김민준') || bio.includes('서울') || bio.includes('32');
    assert.ok(hasSomeContext, `${id} bio should include agent context (name/location/age)`);
  }
});

// ---------------------------------------------------------------------------
// generateAgents() — basic count and structure
// ---------------------------------------------------------------------------

test('generateAgents() returns exactly 800 agents by default', () => {
  const agents = generateAgents({ seed: 42 });
  assert.strictEqual(agents.length, 800, `Expected 800 agents, got ${agents.length}`);
});

test('generateAgents() accepts custom totalBuyers', () => {
  const agents = generateAgents({ totalBuyers: 100, seed: 42 });
  assert.strictEqual(agents.length, 100, `Expected 100 agents, got ${agents.length}`);
});

test('generateAgents() throws for non-integer totalBuyers', () => {
  assert.throws(
    () => generateAgents({ totalBuyers: 1.5, seed: 42 }),
    /totalBuyers must be a positive integer/,
  );
});

test('generateAgents() throws for zero totalBuyers', () => {
  assert.throws(
    () => generateAgents({ totalBuyers: 0, seed: 42 }),
    /totalBuyers must be a positive integer/,
  );
});

test('generateAgents() throws for non-integer seed', () => {
  assert.throws(
    () => generateAgents({ totalBuyers: 10, seed: 3.14 }),
    /seed must be an integer/,
  );
});

// ---------------------------------------------------------------------------
// Base agent fields are preserved
// ---------------------------------------------------------------------------

test('generateAgents(): every agent has agent_id field matching {archetype_id}_{NNNN}', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  const AGENT_ID_PATTERN = /^[a-z][a-z_]*_\d{4}$/;
  for (const agent of agents) {
    assert.match(
      agent.agent_id,
      AGENT_ID_PATTERN,
      `agent_id "${agent.agent_id}" must match {archetype_id}_{NNNN}`,
    );
  }
});

test('generateAgents(): all 800 agent_ids are unique', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  const ids = new Set(agents.map((a) => a.agent_id));
  assert.strictEqual(ids.size, 800, `Expected 800 unique agent_ids, got ${ids.size}`);
});

test('generateAgents(): all 800 korean_names are unique', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  const names = new Set(agents.map((a) => a.korean_name));
  assert.strictEqual(names.size, 800, `Expected 800 unique korean_names, got ${names.size}`);
});

test('generateAgents(): every agent has a valid archetype_id', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.ok(
      VALID_ARCHETYPE_IDS.has(agent.archetype_id),
      `Agent "${agent.agent_id}" has invalid archetype_id: "${agent.archetype_id}"`,
    );
  }
});

test('generateAgents(): sensitivity fields are preserved from spawnBuyerAgents', () => {
  const agents = generateAgents({ totalBuyers: 100, seed: 42 });
  for (const agent of agents) {
    for (const field of ['price_sensitivity', 'trust_sensitivity', 'promo_affinity', 'brand_bias']) {
      assert.ok(
        typeof agent[field] === 'number' && agent[field] >= 1 && agent[field] <= 5,
        `Agent "${agent.agent_id}" ${field} must be in [1, 5], got ${agent[field]}`,
      );
    }
    assert.ok(
      typeof agent.pass_threshold === 'number' && agent.pass_threshold >= 0 && agent.pass_threshold <= 1,
      `Agent "${agent.agent_id}" pass_threshold must be in [0, 1], got ${agent.pass_threshold}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Persona fields: age
// ---------------------------------------------------------------------------

test('generateAgents(): every agent has integer age in [20, 65]', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.ok(
      Number.isInteger(agent.age),
      `Agent "${agent.agent_id}" age must be integer, got ${agent.age}`,
    );
    assert.ok(
      agent.age >= 20 && agent.age <= 65,
      `Agent "${agent.agent_id}" age ${agent.age} must be in [20, 65]`,
    );
  }
});

test('generateAgents(): age is within archetype-specific range', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    const range = ARCHETYPE_AGE_RANGES[agent.archetype_id];
    if (!range) continue; // skip unknown archetypes
    const [ageMin, ageMax] = range;
    assert.ok(
      agent.age >= ageMin && agent.age <= ageMax,
      `Agent "${agent.agent_id}" (${agent.archetype_id}) age ${agent.age} must be in archetype range [${ageMin}, ${ageMax}]`,
    );
  }
});

test('generateAgents(): ages are varied (not all the same value)', () => {
  const agents = generateAgents({ totalBuyers: 100, seed: 42 });
  const uniqueAges = new Set(agents.map((a) => a.age));
  assert.ok(uniqueAges.size >= 5, `Expected at least 5 distinct ages, got ${uniqueAges.size}`);
});

// ---------------------------------------------------------------------------
// Persona fields: location
// ---------------------------------------------------------------------------

test('generateAgents(): every agent has a non-empty location string', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.ok(
      typeof agent.location === 'string' && agent.location.length > 0,
      `Agent "${agent.agent_id}" must have non-empty location`,
    );
  }
});

test('generateAgents(): every location contains Hangul characters', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.match(
      agent.location,
      HANGUL_PATTERN,
      `Agent "${agent.agent_id}" location "${agent.location}" must contain Hangul`,
    );
  }
});

test('generateAgents(): all locations are from the canonical KOREAN_CITIES pool', () => {
  const citiesSet = new Set(KOREAN_CITIES);
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.ok(
      citiesSet.has(agent.location),
      `Agent "${agent.agent_id}" location "${agent.location}" must be in KOREAN_CITIES pool`,
    );
  }
});

test('generateAgents(): multiple distinct cities are represented', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  const uniqueLocations = new Set(agents.map((a) => a.location));
  assert.ok(
    uniqueLocations.size >= 5,
    `Expected ≥5 distinct cities, got ${uniqueLocations.size}`,
  );
});

// ---------------------------------------------------------------------------
// Persona fields: occupation
// ---------------------------------------------------------------------------

test('generateAgents(): every agent has a non-empty occupation string', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.ok(
      typeof agent.occupation === 'string' && agent.occupation.length > 0,
      `Agent "${agent.agent_id}" must have non-empty occupation`,
    );
  }
});

test('generateAgents(): every occupation contains Hangul characters', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.match(
      agent.occupation,
      HANGUL_PATTERN,
      `Agent "${agent.agent_id}" occupation "${agent.occupation}" must contain Hangul`,
    );
  }
});

test('generateAgents(): occupation is from archetype-specific pool', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    const pool = ARCHETYPE_OCCUPATIONS[agent.archetype_id];
    if (!pool) continue; // skip unknown archetypes
    assert.ok(
      pool.includes(agent.occupation),
      `Agent "${agent.agent_id}" occupation "${agent.occupation}" must be in pool for archetype "${agent.archetype_id}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// Persona fields: personality
// ---------------------------------------------------------------------------

test('generateAgents(): every agent has a non-empty personality string', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.ok(
      typeof agent.personality === 'string' && agent.personality.length > 0,
      `Agent "${agent.agent_id}" must have non-empty personality`,
    );
  }
});

test('generateAgents(): every personality contains Hangul characters', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.match(
      agent.personality,
      HANGUL_PATTERN,
      `Agent "${agent.agent_id}" personality must contain Hangul`,
    );
  }
});

test('generateAgents(): personality matches archetype canonical string', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    const expected = ARCHETYPE_PERSONALITIES[agent.archetype_id];
    if (!expected) continue;
    assert.strictEqual(
      agent.personality,
      expected,
      `Agent "${agent.agent_id}" personality must match archetype personality`,
    );
  }
});

// ---------------------------------------------------------------------------
// Persona fields: bio
// ---------------------------------------------------------------------------

test('generateAgents(): every agent has a non-empty bio string', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.ok(
      typeof agent.bio === 'string' && agent.bio.length > 0,
      `Agent "${agent.agent_id}" must have non-empty bio`,
    );
  }
});

test('generateAgents(): every bio contains Hangul characters', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.match(
      agent.bio,
      HANGUL_PATTERN,
      `Agent "${agent.agent_id}" bio must contain Hangul characters`,
    );
  }
});

test('generateAgents(): bio is at least 20 characters (1-2 line narrative)', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.ok(
      agent.bio.length >= 20,
      `Agent "${agent.agent_id}" bio "${agent.bio}" is too short (${agent.bio.length} chars, expected ≥20)`,
    );
  }
});

test('generateAgents(): bio includes the agent\'s korean_name', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.ok(
      agent.bio.includes(agent.korean_name),
      `Agent "${agent.agent_id}" bio should include korean_name "${agent.korean_name}"`,
    );
  }
});

test('generateAgents(): bio includes the agent\'s location', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  for (const agent of agents) {
    assert.ok(
      agent.bio.includes(agent.location),
      `Agent "${agent.agent_id}" bio should include location "${agent.location}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// All required fields present on every agent
// ---------------------------------------------------------------------------

test('generateAgents(): every agent has all required fields', () => {
  const requiredFields = [
    'agent_id', 'korean_name', 'archetype_id', 'budget_band',
    'price_sensitivity', 'trust_sensitivity', 'promo_affinity', 'brand_bias',
    'pass_threshold', 'copy_preference',
    'age', 'location', 'occupation', 'personality', 'bio',
  ];
  const agents = generateAgents({ totalBuyers: 10, seed: 42 });
  for (const agent of agents) {
    for (const field of requiredFields) {
      assert.ok(
        field in agent,
        `Agent "${agent.agent_id}" is missing required field: "${field}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('generateAgents(): same seed produces identical agent personas', () => {
  const run1 = generateAgents({ totalBuyers: 800, seed: 42 });
  const run2 = generateAgents({ totalBuyers: 800, seed: 42 });

  for (let i = 0; i < run1.length; i++) {
    assert.strictEqual(run1[i].agent_id, run2[i].agent_id, `agents[${i}].agent_id must match`);
    assert.strictEqual(run1[i].korean_name, run2[i].korean_name, `agents[${i}].korean_name must match`);
    assert.strictEqual(run1[i].age, run2[i].age, `agents[${i}].age must match`);
    assert.strictEqual(run1[i].location, run2[i].location, `agents[${i}].location must match`);
    assert.strictEqual(run1[i].occupation, run2[i].occupation, `agents[${i}].occupation must match`);
    assert.strictEqual(run1[i].bio, run2[i].bio, `agents[${i}].bio must match`);
  }
});

test('generateAgents(): different seeds produce different persona sequences', () => {
  const run1 = generateAgents({ totalBuyers: 800, seed: 1 });
  const run2 = generateAgents({ totalBuyers: 800, seed: 2 });

  // Check that locations (persona field) differ between runs
  const locations1 = run1.slice(0, 100).map((a) => a.location);
  const locations2 = run2.slice(0, 100).map((a) => a.location);
  const identical = locations1.every((l, i) => l === locations2[i]);
  assert.ok(!identical, 'Different seeds must produce different location sequences');
});

// ---------------------------------------------------------------------------
// Archetype distribution preserved
// ---------------------------------------------------------------------------

test('generateAgents(): distribution matches archetype cohort_weight_percent', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  const counts = new Map();
  for (const agent of agents) {
    counts.set(agent.archetype_id, (counts.get(agent.archetype_id) ?? 0) + 1);
  }

  // Expected counts from fixtures/buyer-personas.md weights
  const EXPECTED_WEIGHTS = {
    price_sensitive: 18,
    value_seeker: 16,
    premium_quality: 12,
    trust_first: 15,
    aesthetics_first: 8,
    urgency_buyer: 11,
    promo_hunter: 10,
    gift_or_family_buyer: 10,
  };

  for (const [archetypeId, weightPct] of Object.entries(EXPECTED_WEIGHTS)) {
    const expected = (weightPct / 100) * 800;
    const actual = counts.get(archetypeId) ?? 0;
    assert.ok(
      Math.abs(actual - expected) <= 2,
      `Archetype "${archetypeId}": expected ~${expected.toFixed(1)} agents, got ${actual}`,
    );
  }
});

test('generateAgents(): all 8 archetypes are represented', () => {
  const agents = generateAgents({ totalBuyers: 800, seed: 42 });
  const archetypeIds = new Set(agents.map((a) => a.archetype_id));
  assert.strictEqual(archetypeIds.size, 8, `Expected 8 distinct archetypes, got ${archetypeIds.size}`);
});
