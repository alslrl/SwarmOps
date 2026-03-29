import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUYER_AGENT_SCHEMA,
  assertBuyerAgent,
  createBuyerAgent,
  spawnAgentCohort,
} from '../src/lib/simulation/buyerAgent.mjs';

// ---------------------------------------------------------------------------
// Minimal valid agent fixture
// ---------------------------------------------------------------------------
const VALID_AGENT = {
  agent_id: 'price_sensitive_0001',
  korean_name: '김민준',
  archetype_id: 'price_sensitive',
  budget_band: 'low',
  price_sensitivity: 5,
  trust_sensitivity: 2,
  promo_affinity: 5,
  brand_bias: 2,
  pass_threshold: 0.72,
  copy_preference: '저렴하고 실속 있는 선택',
};

// Minimal archetype array (matches fixture structure)
const ARCHETYPES = [
  {
    id: 'price_sensitive',
    label: '가격 민감형',
    cohort_weight_percent: 60,
    budget_band: 'low',
    price_sensitivity: 5,
    trust_sensitivity: 2,
    promo_affinity: 5,
    brand_bias: 2,
    pass_threshold: 0.72,
    copy_preference: '저렴하고 실속 있는 선택',
  },
  {
    id: 'value_seeker',
    label: '가성비 균형형',
    cohort_weight_percent: 40,
    budget_band: 'mid',
    price_sensitivity: 4,
    trust_sensitivity: 3,
    promo_affinity: 4,
    brand_bias: 2,
    pass_threshold: 0.60,
    copy_preference: '가격 대비 효율과 기능이 좋아 보이는 문구',
  },
];

// ---------------------------------------------------------------------------
// Schema definition tests
// ---------------------------------------------------------------------------
test('BUYER_AGENT_SCHEMA is a valid JSON Schema object', () => {
  assert.equal(typeof BUYER_AGENT_SCHEMA, 'object');
  assert.equal(BUYER_AGENT_SCHEMA.type, 'object');
  assert.ok(Array.isArray(BUYER_AGENT_SCHEMA.required));
  assert.ok(typeof BUYER_AGENT_SCHEMA.properties === 'object');
});

test('BUYER_AGENT_SCHEMA requires all 10 core fields', () => {
  const required = new Set(BUYER_AGENT_SCHEMA.required);
  for (const field of [
    'agent_id', 'korean_name', 'archetype_id', 'budget_band',
    'price_sensitivity', 'trust_sensitivity', 'promo_affinity',
    'brand_bias', 'pass_threshold', 'copy_preference',
  ]) {
    assert.ok(required.has(field), `Schema should require field: ${field}`);
  }
});

test('BUYER_AGENT_SCHEMA properties include correct type annotations', () => {
  const props = BUYER_AGENT_SCHEMA.properties;
  assert.equal(props.agent_id.type, 'string');
  assert.equal(props.korean_name.type, 'string');
  assert.equal(props.archetype_id.type, 'string');
  assert.equal(props.budget_band.type, 'string');
  assert.equal(props.price_sensitivity.type, 'number');
  assert.equal(props.trust_sensitivity.type, 'number');
  assert.equal(props.promo_affinity.type, 'number');
  assert.equal(props.brand_bias.type, 'number');
  assert.equal(props.pass_threshold.type, 'number');
  assert.equal(props.copy_preference.type, 'string');
});

test('BUYER_AGENT_SCHEMA numeric traits have [1,5] bounds', () => {
  for (const field of ['price_sensitivity', 'trust_sensitivity', 'promo_affinity', 'brand_bias']) {
    const prop = BUYER_AGENT_SCHEMA.properties[field];
    assert.equal(prop.minimum, 1, `${field} minimum should be 1`);
    assert.equal(prop.maximum, 5, `${field} maximum should be 5`);
  }
});

test('BUYER_AGENT_SCHEMA pass_threshold has [0,1] bounds', () => {
  const prop = BUYER_AGENT_SCHEMA.properties.pass_threshold;
  assert.equal(prop.minimum, 0);
  assert.equal(prop.maximum, 1);
});

test('BUYER_AGENT_SCHEMA archetype_id enum has 8 values', () => {
  const enumValues = BUYER_AGENT_SCHEMA.properties.archetype_id.enum;
  assert.equal(enumValues.length, 8);
  assert.ok(enumValues.includes('price_sensitive'));
  assert.ok(enumValues.includes('gift_or_family_buyer'));
});

// ---------------------------------------------------------------------------
// assertBuyerAgent validation tests
// ---------------------------------------------------------------------------
test('assertBuyerAgent accepts a valid agent', () => {
  const result = assertBuyerAgent({ ...VALID_AGENT });
  assert.equal(result.agent_id, 'price_sensitive_0001');
});

test('assertBuyerAgent rejects missing agent_id', () => {
  const bad = { ...VALID_AGENT, agent_id: undefined };
  assert.throws(() => assertBuyerAgent(bad), /agent_id/);
});

test('assertBuyerAgent rejects malformed agent_id pattern', () => {
  const bad = { ...VALID_AGENT, agent_id: 'bad-id' };
  assert.throws(() => assertBuyerAgent(bad), /agent_id/);
});

test('assertBuyerAgent rejects invalid archetype_id', () => {
  const bad = { ...VALID_AGENT, archetype_id: 'unknown_type' };
  assert.throws(() => assertBuyerAgent(bad), /archetype_id/);
});

test('assertBuyerAgent rejects invalid budget_band', () => {
  const bad = { ...VALID_AGENT, budget_band: 'ultra' };
  assert.throws(() => assertBuyerAgent(bad), /budget_band/);
});

test('assertBuyerAgent rejects price_sensitivity out of range (too high)', () => {
  const bad = { ...VALID_AGENT, price_sensitivity: 6 };
  assert.throws(() => assertBuyerAgent(bad), /price_sensitivity/);
});

test('assertBuyerAgent rejects price_sensitivity out of range (too low)', () => {
  const bad = { ...VALID_AGENT, price_sensitivity: 0 };
  assert.throws(() => assertBuyerAgent(bad), /price_sensitivity/);
});

test('assertBuyerAgent rejects pass_threshold > 1', () => {
  const bad = { ...VALID_AGENT, pass_threshold: 1.5 };
  assert.throws(() => assertBuyerAgent(bad), /pass_threshold/);
});

test('assertBuyerAgent rejects pass_threshold < 0', () => {
  const bad = { ...VALID_AGENT, pass_threshold: -0.1 };
  assert.throws(() => assertBuyerAgent(bad), /pass_threshold/);
});

test('assertBuyerAgent rejects empty korean_name', () => {
  const bad = { ...VALID_AGENT, korean_name: 'x' }; // only 1 char, needs ≥2
  assert.throws(() => assertBuyerAgent(bad), /korean_name/);
});

test('assertBuyerAgent rejects empty copy_preference', () => {
  const bad = { ...VALID_AGENT, copy_preference: '' };
  assert.throws(() => assertBuyerAgent(bad), /copy_preference/);
});

test('assertBuyerAgent rejects non-finite trust_sensitivity', () => {
  const bad = { ...VALID_AGENT, trust_sensitivity: NaN };
  assert.throws(() => assertBuyerAgent(bad), /trust_sensitivity/);
});

// ---------------------------------------------------------------------------
// createBuyerAgent factory tests
// ---------------------------------------------------------------------------
test('createBuyerAgent creates a valid agent from explicit fields', () => {
  const agent = createBuyerAgent({ ...VALID_AGENT });
  assert.equal(agent.agent_id, 'price_sensitive_0001');
  assert.equal(agent.archetype_id, 'price_sensitive');
  assert.equal(agent.budget_band, 'low');
  assert.equal(agent.price_sensitivity, 5);
  assert.equal(agent.pass_threshold, 0.72);
});

test('createBuyerAgent clamps price_sensitivity to [1, 5]', () => {
  const agent = createBuyerAgent({ ...VALID_AGENT, price_sensitivity: 7 });
  assert.equal(agent.price_sensitivity, 5);
});

test('createBuyerAgent clamps pass_threshold to [0, 1]', () => {
  const agent = createBuyerAgent({ ...VALID_AGENT, pass_threshold: 1.99 });
  assert.equal(agent.pass_threshold, 1);
});

// ---------------------------------------------------------------------------
// spawnAgentCohort tests
// ---------------------------------------------------------------------------
test('spawnAgentCohort produces exactly totalBuyers agents', () => {
  const agents = spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: 10, seed: 1 });
  assert.equal(agents.length, 10);
});

test('spawnAgentCohort is deterministic for the same seed', () => {
  const first = spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: 10, seed: 42 });
  const second = spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: 10, seed: 42 });
  assert.deepEqual(first, second);
});

test('spawnAgentCohort produces different results for different seeds', () => {
  const a = spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: 10, seed: 1 });
  const b = spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: 10, seed: 999 });
  const same = a.every((agent, i) => agent.agent_id === b[i].agent_id && agent.korean_name === b[i].korean_name);
  assert.equal(same, false, 'Different seeds should produce different agents');
});

test('spawnAgentCohort distributes agents according to cohort_weight_percent', () => {
  // 60% price_sensitive, 40% value_seeker for totalBuyers=10 → 6 + 4
  const agents = spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: 10, seed: 1 });
  const priceSensitiveCount = agents.filter(a => a.archetype_id === 'price_sensitive').length;
  const valueSeekerCount = agents.filter(a => a.archetype_id === 'value_seeker').length;
  assert.equal(priceSensitiveCount, 6);
  assert.equal(valueSeekerCount, 4);
});

test('spawnAgentCohort assigns unique agent_ids', () => {
  const agents = spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: 20, seed: 1 });
  const ids = agents.map(a => a.agent_id);
  const unique = new Set(ids);
  assert.equal(unique.size, agents.length, 'All agent_ids must be unique');
});

test('spawnAgentCohort all agents pass assertBuyerAgent validation', () => {
  const agents = spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: 20, seed: 7 });
  assert.doesNotThrow(() => {
    for (const agent of agents) assertBuyerAgent(agent);
  });
});

test('spawnAgentCohort assigns correct archetype_ids', () => {
  const agents = spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: 10, seed: 1 });
  const validIds = new Set(['price_sensitive', 'value_seeker']);
  for (const agent of agents) {
    assert.ok(validIds.has(agent.archetype_id), `Unexpected archetype_id: ${agent.archetype_id}`);
  }
});

test('spawnAgentCohort trait values are within valid ranges', () => {
  const agents = spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: 50, seed: 12 });
  for (const agent of agents) {
    for (const field of ['price_sensitivity', 'trust_sensitivity', 'promo_affinity', 'brand_bias']) {
      assert.ok(agent[field] >= 1 && agent[field] <= 5, `${field} out of range for agent ${agent.agent_id}`);
    }
    assert.ok(agent.pass_threshold >= 0 && agent.pass_threshold <= 1, `pass_threshold out of range for ${agent.agent_id}`);
  }
});

test('spawnAgentCohort generates Korean names (non-empty, 2+ chars)', () => {
  const agents = spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: 10, seed: 1 });
  for (const agent of agents) {
    assert.ok(typeof agent.korean_name === 'string' && agent.korean_name.length >= 2,
      `Expected Korean name for ${agent.agent_id}, got "${agent.korean_name}"`);
  }
});

test('spawnAgentCohort default totalBuyers=800 works with full 8 archetypes', () => {
  const fullArchetypes = [
    { id: 'price_sensitive', cohort_weight_percent: 18, budget_band: 'low', price_sensitivity: 5, trust_sensitivity: 2, promo_affinity: 5, brand_bias: 2, pass_threshold: 0.72, copy_preference: '저렴한 선택' },
    { id: 'value_seeker', cohort_weight_percent: 16, budget_band: 'mid', price_sensitivity: 4, trust_sensitivity: 3, promo_affinity: 4, brand_bias: 2, pass_threshold: 0.60, copy_preference: '가성비' },
    { id: 'premium_quality', cohort_weight_percent: 12, budget_band: 'high', price_sensitivity: 2, trust_sensitivity: 4, promo_affinity: 1, brand_bias: 3, pass_threshold: 0.45, copy_preference: '고급감' },
    { id: 'trust_first', cohort_weight_percent: 15, budget_band: 'mid', price_sensitivity: 3, trust_sensitivity: 5, promo_affinity: 2, brand_bias: 4, pass_threshold: 0.48, copy_preference: '신뢰' },
    { id: 'aesthetics_first', cohort_weight_percent: 8, budget_band: 'mid', price_sensitivity: 3, trust_sensitivity: 3, promo_affinity: 2, brand_bias: 4, pass_threshold: 0.58, copy_preference: '세련' },
    { id: 'urgency_buyer', cohort_weight_percent: 11, budget_band: 'mid', price_sensitivity: 3, trust_sensitivity: 4, promo_affinity: 2, brand_bias: 3, pass_threshold: 0.42, copy_preference: '빠른 해결' },
    { id: 'promo_hunter', cohort_weight_percent: 10, budget_band: 'low', price_sensitivity: 4, trust_sensitivity: 2, promo_affinity: 5, brand_bias: 1, pass_threshold: 0.68, copy_preference: '할인' },
    { id: 'gift_or_family_buyer', cohort_weight_percent: 10, budget_band: 'mid', price_sensitivity: 3, trust_sensitivity: 5, promo_affinity: 2, brand_bias: 3, pass_threshold: 0.56, copy_preference: '가족 신뢰' },
  ];
  const agents = spawnAgentCohort({ archetypes: fullArchetypes, seed: 1 });
  assert.equal(agents.length, 800);
});

test('spawnAgentCohort rejects empty archetypes array', () => {
  assert.throws(() => spawnAgentCohort({ archetypes: [], totalBuyers: 10, seed: 1 }), /archetypes/);
});

test('spawnAgentCohort rejects non-positive totalBuyers', () => {
  assert.throws(() => spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: 0, seed: 1 }), /totalBuyers/);
});

// ---------------------------------------------------------------------------
// Sub-AC 3 assertions: count distribution, unique profiles, agentUtils usage
// ---------------------------------------------------------------------------

// Full 8-archetype fixture matching fixtures/buyer-personas.md
const FULL_ARCHETYPES = [
  { id: 'price_sensitive',     cohort_weight_percent: 18, budget_band: 'low',  price_sensitivity: 5, trust_sensitivity: 2, promo_affinity: 5, brand_bias: 2, pass_threshold: 0.72, copy_preference: '저렴하고 실속 있는 선택' },
  { id: 'value_seeker',        cohort_weight_percent: 16, budget_band: 'mid',  price_sensitivity: 4, trust_sensitivity: 3, promo_affinity: 4, brand_bias: 2, pass_threshold: 0.60, copy_preference: '가격 대비 효율과 기능이 좋아 보이는 문구' },
  { id: 'premium_quality',     cohort_weight_percent: 12, budget_band: 'high', price_sensitivity: 2, trust_sensitivity: 4, promo_affinity: 1, brand_bias: 3, pass_threshold: 0.45, copy_preference: '고급감, 전문성, 차별화' },
  { id: 'trust_first',         cohort_weight_percent: 15, budget_band: 'mid',  price_sensitivity: 3, trust_sensitivity: 5, promo_affinity: 2, brand_bias: 4, pass_threshold: 0.48, copy_preference: '믿을 수 있는 설계, 전문가, 과학 기반' },
  { id: 'aesthetics_first',    cohort_weight_percent:  8, budget_band: 'mid',  price_sensitivity: 3, trust_sensitivity: 3, promo_affinity: 2, brand_bias: 4, pass_threshold: 0.58, copy_preference: '깔끔하고 세련된 프리미엄 톤' },
  { id: 'urgency_buyer',       cohort_weight_percent: 11, budget_band: 'mid',  price_sensitivity: 3, trust_sensitivity: 4, promo_affinity: 2, brand_bias: 3, pass_threshold: 0.42, copy_preference: '빠르게 믿고 선택할 수 있는 확신형 문구' },
  { id: 'promo_hunter',        cohort_weight_percent: 10, budget_band: 'low',  price_sensitivity: 4, trust_sensitivity: 2, promo_affinity: 5, brand_bias: 1, pass_threshold: 0.68, copy_preference: '할인/혜택/지금 사야 하는 이유' },
  { id: 'gift_or_family_buyer',cohort_weight_percent: 10, budget_band: 'mid',  price_sensitivity: 3, trust_sensitivity: 5, promo_affinity: 2, brand_bias: 3, pass_threshold: 0.56, copy_preference: '안전하고 믿을 수 있어 가족에게도 권할 수 있는 문구' },
];

// Verify weights sum to 100 (precondition for these tests)
assert.equal(
  FULL_ARCHETYPES.reduce((s, a) => s + a.cohort_weight_percent, 0),
  100,
  'FULL_ARCHETYPES cohort_weight_percent must sum to 100',
);

test('spawnAgentCohort total count equals 800 for full 8-archetype fixture', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 800, seed: 42 });
  assert.equal(agents.length, 800, 'Total agent count must be exactly 800');
});

test('spawnAgentCohort per-archetype counts match weight distribution within rounding', () => {
  // Each archetype count must be within ±1 of its exact proportional target:
  //   lowerBound = Math.floor(weight% / 100 * 800)
  //   upperBound = Math.ceil(weight%  / 100 * 800)
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 800, seed: 42 });
  for (const archetype of FULL_ARCHETYPES) {
    const actual = agents.filter(a => a.archetype_id === archetype.id).length;
    const exact = (archetype.cohort_weight_percent / 100) * 800;
    const lower = Math.floor(exact);
    const upper = Math.ceil(exact);
    assert.ok(
      actual >= lower && actual <= upper,
      `Archetype "${archetype.id}": expected count in [${lower}, ${upper}] (${archetype.cohort_weight_percent}% of 800), got ${actual}`,
    );
  }
});

test('spawnAgentCohort per-archetype counts sum to totalBuyers', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 800, seed: 99 });
  const totalSpawned = FULL_ARCHETYPES.reduce(
    (sum, a) => sum + agents.filter(ag => ag.archetype_id === a.id).length,
    0,
  );
  assert.equal(totalSpawned, 800, 'Sum of per-archetype counts must equal 800');
});

test('spawnAgentCohort exact expected counts for full 8 archetypes at 800 buyers', () => {
  // 18%→144, 16%→128, 12%→96, 15%→120, 8%→64, 11%→88, 10%→80, 10%→80 = 800 ✓
  const expectedCounts = {
    price_sensitive:      144,
    value_seeker:         128,
    premium_quality:       96,
    trust_first:          120,
    aesthetics_first:      64,
    urgency_buyer:         88,
    promo_hunter:          80,
    gift_or_family_buyer:  80,
  };
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 800, seed: 42 });
  for (const [archetypeId, expected] of Object.entries(expectedCounts)) {
    const actual = agents.filter(a => a.archetype_id === archetypeId).length;
    assert.equal(actual, expected, `Archetype "${archetypeId}": expected ${expected}, got ${actual}`);
  }
});

test('spawnAgentCohort per-archetype counts hold across multiple seeds', () => {
  // Distribution must be seed-invariant (only trait values change, not counts)
  const seeds = [1, 7, 42, 100, 999];
  for (const seed of seeds) {
    const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 800, seed });
    for (const archetype of FULL_ARCHETYPES) {
      const actual = agents.filter(a => a.archetype_id === archetype.id).length;
      const exact = (archetype.cohort_weight_percent / 100) * 800;
      assert.ok(
        actual >= Math.floor(exact) && actual <= Math.ceil(exact),
        `seed=${seed}, archetype="${archetype.id}": count ${actual} not in rounding range`,
      );
    }
  }
});

test('spawnAgentCohort no two agents share identical sensitivity profiles (full cohort)', () => {
  // Sensitivity profile = (price_sensitivity, trust_sensitivity, promo_affinity, brand_bias, pass_threshold)
  // Box-Muller sigma=0.4 gives >7M unique profile combinations per archetype,
  // making collisions statistically negligible across 800 agents.
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 800, seed: 42 });
  const profiles = agents.map(a =>
    `${a.price_sensitivity}|${a.trust_sensitivity}|${a.promo_affinity}|${a.brand_bias}|${a.pass_threshold}`,
  );
  const uniqueProfiles = new Set(profiles);
  assert.equal(
    uniqueProfiles.size,
    agents.length,
    `Expected ${agents.length} unique sensitivity profiles but found ${uniqueProfiles.size}`,
  );
});

test('spawnAgentCohort no duplicate sensitivity profiles across multiple seeds', () => {
  for (const seed of [1, 7, 42, 100, 999]) {
    const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 800, seed });
    const profiles = new Set(
      agents.map(a =>
        `${a.price_sensitivity}|${a.trust_sensitivity}|${a.promo_affinity}|${a.brand_bias}|${a.pass_threshold}`,
      ),
    );
    assert.equal(
      profiles.size,
      agents.length,
      `seed=${seed}: found duplicate sensitivity profiles (${agents.length - profiles.size} collisions)`,
    );
  }
});

test('spawnAgentCohort uses createKoreanNameGenerator — all 800 names are unique', () => {
  // createKoreanNameGenerator (from agentUtils.mjs) guarantees no name repeats
  // for the first 1200 calls. Verifying 800 unique names confirms the generator is used.
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 800, seed: 42 });
  const names = agents.map(a => a.korean_name);
  const uniqueNames = new Set(names);
  assert.equal(uniqueNames.size, 800, 'All 800 agents must have distinct Korean names');
});

test('spawnAgentCohort name uniqueness holds across different seeds', () => {
  for (const seed of [1, 7, 42, 100, 999]) {
    const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 800, seed });
    const names = new Set(agents.map(a => a.korean_name));
    assert.equal(names.size, agents.length, `seed=${seed}: found duplicate Korean names`);
  }
});

test('spawnAgentCohort names are valid Korean (Hangul characters)', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 20, seed: 5 });
  const koreanPattern = /[\uAC00-\uD7A3\u1100-\u11FF]/;
  for (const agent of agents) {
    assert.match(agent.korean_name, koreanPattern,
      `Agent ${agent.agent_id} name "${agent.korean_name}" should contain Korean characters`);
  }
});

test('spawnAgentCohort 2-archetype per-archetype count within rounding for odd split', () => {
  // 3 archetypes with weights 33/33/34 — tests largest-remainder rounding
  const oddArchetypes = [
    { id: 'price_sensitive', cohort_weight_percent: 33, budget_band: 'low', price_sensitivity: 5, trust_sensitivity: 2, promo_affinity: 5, brand_bias: 2, pass_threshold: 0.72, copy_preference: '저렴한 선택' },
    { id: 'value_seeker',    cohort_weight_percent: 33, budget_band: 'mid', price_sensitivity: 4, trust_sensitivity: 3, promo_affinity: 4, brand_bias: 2, pass_threshold: 0.60, copy_preference: '가성비' },
    { id: 'premium_quality', cohort_weight_percent: 34, budget_band: 'high', price_sensitivity: 2, trust_sensitivity: 4, promo_affinity: 1, brand_bias: 3, pass_threshold: 0.45, copy_preference: '고급감' },
  ];
  const agents = spawnAgentCohort({ archetypes: oddArchetypes, totalBuyers: 100, seed: 42 });
  assert.equal(agents.length, 100, 'Total count must be 100');
  for (const a of oddArchetypes) {
    const actual = agents.filter(ag => ag.archetype_id === a.id).length;
    const exact = (a.cohort_weight_percent / 100) * 100;
    assert.ok(
      actual >= Math.floor(exact) && actual <= Math.ceil(exact),
      `"${a.id}": expected ~${exact}, got ${actual}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Sub-AC 3: ±10% multiplicative variation constraint verification
// ---------------------------------------------------------------------------

test('spawnAgentCohort sensitivity values are within ±10% of archetype base (price_sensitivity)', () => {
  // price_sensitive archetype has base price_sensitivity = 5
  // ±10% of 5 = [4.5, 5.5] → clamped to [1, 5] → [4.5, 5]
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 800, seed: 42 });
  for (const archetype of FULL_ARCHETYPES) {
    const base = archetype.price_sensitivity;
    const lower = Math.max(1, base * 0.9);
    const upper = Math.min(5, base * 1.1);
    const archetypeAgents = agents.filter(a => a.archetype_id === archetype.id);
    for (const agent of archetypeAgents) {
      assert.ok(
        agent.price_sensitivity >= lower - 0.05 && agent.price_sensitivity <= upper + 0.05,
        `Agent ${agent.agent_id} price_sensitivity ${agent.price_sensitivity} `
        + `outside ±10% of base ${base} ([${lower.toFixed(1)}, ${upper.toFixed(1)}])`,
      );
    }
  }
});

test('spawnAgentCohort sensitivity values are within ±10% of archetype base (trust_sensitivity)', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 800, seed: 42 });
  for (const archetype of FULL_ARCHETYPES) {
    const base = archetype.trust_sensitivity;
    const lower = Math.max(1, base * 0.9);
    const upper = Math.min(5, base * 1.1);
    const archetypeAgents = agents.filter(a => a.archetype_id === archetype.id);
    for (const agent of archetypeAgents) {
      assert.ok(
        agent.trust_sensitivity >= lower - 0.05 && agent.trust_sensitivity <= upper + 0.05,
        `Agent ${agent.agent_id} trust_sensitivity ${agent.trust_sensitivity} `
        + `outside ±10% of base ${base}`,
      );
    }
  }
});

test('spawnAgentCohort pass_threshold is within ±10% of archetype base', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 800, seed: 42 });
  for (const archetype of FULL_ARCHETYPES) {
    const base = archetype.pass_threshold;
    const lower = Math.max(0, base * 0.9);
    const upper = Math.min(1, base * 1.1);
    const archetypeAgents = agents.filter(a => a.archetype_id === archetype.id);
    for (const agent of archetypeAgents) {
      assert.ok(
        agent.pass_threshold >= lower - 0.001 && agent.pass_threshold <= upper + 0.001,
        `Agent ${agent.agent_id} pass_threshold ${agent.pass_threshold} `
        + `outside ±10% of base ${base} ([${lower.toFixed(3)}, ${upper.toFixed(3)}])`,
      );
    }
  }
});

test('spawnAgentCohort uses ±10% multiplicative variation — not Gaussian (sensitivity range check)', () => {
  // With Gaussian sigma=0.4, base=3 could drift to 3±1.2 (40% range).
  // With ±10% multiplicative, base=3 is bounded to [2.7, 3.3].
  // Verify agents from value_seeker (base price_sensitivity=4) stay within [3.6, 4.4].
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES, totalBuyers: 800, seed: 42 });
  const valueSeekers = agents.filter(a => a.archetype_id === 'value_seeker');
  for (const agent of valueSeekers) {
    assert.ok(
      agent.price_sensitivity >= 3.6 && agent.price_sensitivity <= 4.4,
      `value_seeker agent ${agent.agent_id} price_sensitivity ${agent.price_sensitivity} `
      + `is outside ±10% range [3.6, 4.4] for base=4 — Gaussian noise may have been used`,
    );
  }
});
