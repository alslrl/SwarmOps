/**
 * agentSimulation.test.mjs
 *
 * Unit tests for src/lib/agentSimulation.mjs (Sub-AC 3a)
 *
 * Verifies:
 *  - runAgentBatch() produces correct agentDecisions payload shape
 *  - runAgentBatch() produces correct choice_summary aggregation
 *  - runAgentBatch() produces correct archetype_breakdown aggregation
 *  - runAgentSimulation() is a valid convenience wrapper (spawns + evaluates)
 *  - choice_summary totals match agent count
 *  - archetype_breakdown totals match agent count
 *  - All 5 choice keys are present in every output map
 *  - agentDecisions: agentId, archetype, choice, price_sensitivity fields
 *  - price_sensitivity is in [1, 5] range
 *  - choice is one of the 5 valid product keys
 *  - Determinism: same seed → same agentDecisions in mock mode
 *  - Error thrown for empty agents array
 *  - Error thrown for empty archetypes array
 *  - Error thrown for non-object strategy
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentBatch, runAgentSimulation } from '../src/lib/agentSimulation.mjs';
import { spawnAgentCohort } from '../src/lib/simulation/buyerAgent.mjs';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

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

const MOCK_STRATEGY = {
  id: 'strategy_test_001',
  title: '두피과학 전문가 샴푸 500ml',
  top_copy: '두피 전문가가 설계한 탈모케어 솔루션',
  price_krw: 29900,
  rationale: '전문가 포지셔닝으로 신뢰도 강화',
};

const MOCK_COMPETITORS = {
  metadata: { fixture_version: 1 },
  competitors: [
    {
      product_id: 'competitor_a',
      brand_name: '닥터포헤어',
      price_krw: 27900,
      positioning: '프리미엄 메이저 탈모 샴푸',
    },
    {
      product_id: 'competitor_b',
      brand_name: '라보에이치',
      price_krw: 16120,
      positioning: '기능성 / 두피강화형 메이저 브랜드',
    },
    {
      product_id: 'competitor_c',
      brand_name: '닥터방기원',
      price_krw: 13900,
      positioning: '가성비 / 대용량형 탈모 샴푸',
    },
  ],
  comparisonNotes: [],
};

const MOCK_OUR_PRODUCT = {
  product_id: 'our_product',
  current_title: '트리클리닉 엑스퍼트 스칼프 탈모 샴푸 500ml',
  current_top_copy: '두피과학 기반의 성분 설계로 매일 신뢰감 있게 관리하는 프리미엄 탈모 샴푸',
  current_price_krw: 29900,
  current_cost_krw: 11000,
  positioning: '두피과학 / 성분 전문가 설계 프리미엄',
};

const MOCK_RUN_CONFIG = {
  strategy_model: 'gpt-5.4',
  buyer_evaluator_model: 'gpt-5-nano',
  realism_judge_model: 'gpt-5.4',
};

const MOCK_CLIENT = {
  mode: 'mock',
  async generateJson({ fallback }) {
    return { data: await fallback(), source: 'fallback' };
  },
};

const VALID_PRODUCT_CHOICES = new Set([
  'our_product',
  'competitor_a',
  'competitor_b',
  'competitor_c',
  'pass',
]);

// Small cohort for fast tests (40 agents: 24 price_sensitive + 16 value_seeker)
const SMALL_TOTAL = 40;
const SMALL_SEED = 99;

// ---------------------------------------------------------------------------
// Helper: spawn a small cohort for test use
// ---------------------------------------------------------------------------

function spawnSmallCohort() {
  return spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: SMALL_TOTAL, seed: SMALL_SEED });
}

// ---------------------------------------------------------------------------
// runAgentBatch — output shape
// ---------------------------------------------------------------------------

test('runAgentBatch returns object with agentDecisions, choice_summary, archetype_breakdown', async () => {
  const agents = spawnSmallCohort();
  const result = await runAgentBatch({
    agents,
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
  });

  assert.ok(result && typeof result === 'object', 'result must be a non-null object');
  assert.ok(Array.isArray(result.agentDecisions), 'agentDecisions must be an array');
  assert.ok(result.choice_summary && typeof result.choice_summary === 'object', 'choice_summary must be an object');
  assert.ok(result.archetype_breakdown && typeof result.archetype_breakdown === 'object', 'archetype_breakdown must be an object');
});

// ---------------------------------------------------------------------------
// runAgentBatch — agentDecisions length matches input agent count
// ---------------------------------------------------------------------------

test('runAgentBatch agentDecisions.length equals input agent count', async () => {
  const agents = spawnSmallCohort();
  const { agentDecisions } = await runAgentBatch({
    agents,
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
  });

  assert.strictEqual(agentDecisions.length, agents.length, 'agentDecisions.length must equal agents.length');
});

// ---------------------------------------------------------------------------
// runAgentBatch — agentDecision payload shape
// ---------------------------------------------------------------------------

test('each agentDecision has agentId, archetype, choice, price_sensitivity', async () => {
  const agents = spawnSmallCohort();
  const { agentDecisions } = await runAgentBatch({
    agents,
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
  });

  for (const decision of agentDecisions) {
    assert.ok(typeof decision.agentId === 'string' && decision.agentId.length > 0,
      `agentId must be a non-empty string, got: ${decision.agentId}`);
    assert.ok(typeof decision.archetype === 'string' && decision.archetype.length > 0,
      `archetype must be a non-empty string, got: ${decision.archetype}`);
    assert.ok(VALID_PRODUCT_CHOICES.has(decision.choice),
      `choice must be one of the 5 valid keys, got: ${decision.choice}`);
    assert.ok(typeof decision.price_sensitivity === 'number' && Number.isFinite(decision.price_sensitivity),
      `price_sensitivity must be a finite number, got: ${decision.price_sensitivity}`);
  }
});

// ---------------------------------------------------------------------------
// runAgentBatch — price_sensitivity in [1, 5]
// ---------------------------------------------------------------------------

test('each agentDecision price_sensitivity is in [1, 5]', async () => {
  const agents = spawnSmallCohort();
  const { agentDecisions } = await runAgentBatch({
    agents,
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
  });

  for (const decision of agentDecisions) {
    assert.ok(decision.price_sensitivity >= 1 && decision.price_sensitivity <= 5,
      `price_sensitivity ${decision.price_sensitivity} must be in [1, 5]`);
  }
});

// ---------------------------------------------------------------------------
// runAgentBatch — choice is always a valid key
// ---------------------------------------------------------------------------

test('each agentDecision choice is one of the 5 valid product keys', async () => {
  const agents = spawnSmallCohort();
  const { agentDecisions } = await runAgentBatch({
    agents,
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
  });

  for (const decision of agentDecisions) {
    assert.ok(VALID_PRODUCT_CHOICES.has(decision.choice),
      `Invalid choice: ${decision.choice}`);
  }
});

// ---------------------------------------------------------------------------
// runAgentBatch — agentId matches input agent's agent_id
// ---------------------------------------------------------------------------

test('agentDecision.agentId matches the corresponding agent.agent_id', async () => {
  const agents = spawnSmallCohort();
  const { agentDecisions } = await runAgentBatch({
    agents,
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
  });

  for (let i = 0; i < agents.length; i += 1) {
    assert.strictEqual(agentDecisions[i].agentId, agents[i].agent_id,
      `agentDecision[${i}].agentId must match agents[${i}].agent_id`);
  }
});

// ---------------------------------------------------------------------------
// runAgentBatch — choice_summary has all 5 keys
// ---------------------------------------------------------------------------

test('choice_summary has all 5 product keys', async () => {
  const agents = spawnSmallCohort();
  const { choice_summary } = await runAgentBatch({
    agents,
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
  });

  for (const key of ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']) {
    assert.ok(key in choice_summary, `choice_summary must have key: ${key}`);
    assert.ok(typeof choice_summary[key] === 'number', `choice_summary.${key} must be a number`);
    assert.ok(choice_summary[key] >= 0, `choice_summary.${key} must be non-negative`);
  }
});

// ---------------------------------------------------------------------------
// runAgentBatch — choice_summary totals equal agent count
// ---------------------------------------------------------------------------

test('choice_summary totals equal the input agent count', async () => {
  const agents = spawnSmallCohort();
  const { choice_summary } = await runAgentBatch({
    agents,
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
  });

  const total = Object.values(choice_summary).reduce((s, n) => s + n, 0);
  assert.strictEqual(total, agents.length,
    `choice_summary total ${total} must equal agents.length ${agents.length}`);
});

// ---------------------------------------------------------------------------
// runAgentBatch — archetype_breakdown has all 5 keys per archetype
// ---------------------------------------------------------------------------

test('archetype_breakdown has all 5 product keys per archetype', async () => {
  const agents = spawnSmallCohort();
  const { archetype_breakdown } = await runAgentBatch({
    agents,
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
  });

  const archetypeIds = [...new Set(agents.map((a) => a.archetype_id))];
  for (const archetypeId of archetypeIds) {
    assert.ok(archetypeId in archetype_breakdown, `archetype_breakdown must have key: ${archetypeId}`);
    const breakdown = archetype_breakdown[archetypeId];
    for (const key of ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']) {
      assert.ok(key in breakdown, `archetype_breakdown.${archetypeId} must have key: ${key}`);
      assert.ok(typeof breakdown[key] === 'number', `archetype_breakdown.${archetypeId}.${key} must be a number`);
      assert.ok(breakdown[key] >= 0, `archetype_breakdown.${archetypeId}.${key} must be non-negative`);
    }
  }
});

// ---------------------------------------------------------------------------
// runAgentBatch — archetype_breakdown totals equal per-archetype agent count
// ---------------------------------------------------------------------------

test('archetype_breakdown per-archetype totals match agent distribution', async () => {
  const agents = spawnSmallCohort();
  const { archetype_breakdown } = await runAgentBatch({
    agents,
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
  });

  // Count actual per-archetype agents
  const expectedCounts = {};
  for (const agent of agents) {
    expectedCounts[agent.archetype_id] = (expectedCounts[agent.archetype_id] ?? 0) + 1;
  }

  for (const [archetypeId, expected] of Object.entries(expectedCounts)) {
    const actual = Object.values(archetype_breakdown[archetypeId] ?? {}).reduce((s, n) => s + n, 0);
    assert.strictEqual(actual, expected,
      `archetype_breakdown["${archetypeId}"] total ${actual} must equal ${expected}`);
  }
});

// ---------------------------------------------------------------------------
// runAgentBatch — archetype field in agentDecision matches agent's archetype_id
// ---------------------------------------------------------------------------

test('agentDecision.archetype matches agent.archetype_id', async () => {
  const agents = spawnSmallCohort();
  const { agentDecisions } = await runAgentBatch({
    agents,
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
  });

  for (let i = 0; i < agents.length; i += 1) {
    assert.strictEqual(agentDecisions[i].archetype, agents[i].archetype_id,
      `agentDecision[${i}].archetype must match agents[${i}].archetype_id`);
  }
});

// ---------------------------------------------------------------------------
// runAgentBatch — consistency: choice_summary matches agentDecisions counts
// ---------------------------------------------------------------------------

test('choice_summary is consistent with agentDecisions choice counts', async () => {
  const agents = spawnSmallCohort();
  const { agentDecisions, choice_summary } = await runAgentBatch({
    agents,
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
  });

  const counted = { our_product: 0, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 };
  for (const d of agentDecisions) {
    counted[d.choice] = (counted[d.choice] ?? 0) + 1;
  }

  for (const key of Object.keys(counted)) {
    assert.strictEqual(choice_summary[key], counted[key],
      `choice_summary.${key} (${choice_summary[key]}) must match counted ${counted[key]}`);
  }
});

// ---------------------------------------------------------------------------
// runAgentBatch — determinism: same inputs → same output in mock mode
// ---------------------------------------------------------------------------

test('runAgentBatch is deterministic across two calls with same inputs in mock mode', async () => {
  const agents = spawnAgentCohort({ archetypes: ARCHETYPES, totalBuyers: 20, seed: 7 });

  const params = {
    agents,
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
  };

  const run1 = await runAgentBatch(params);
  const run2 = await runAgentBatch(params);

  assert.deepStrictEqual(
    run1.agentDecisions.map((d) => d.choice),
    run2.agentDecisions.map((d) => d.choice),
    'choices must be identical across two runs with same inputs'
  );
  assert.deepStrictEqual(run1.choice_summary, run2.choice_summary, 'choice_summary must be identical');
});

// ---------------------------------------------------------------------------
// runAgentBatch — error on empty agents
// ---------------------------------------------------------------------------

test('runAgentBatch throws on empty agents array', async () => {
  await assert.rejects(
    () => runAgentBatch({
      agents: [],
      archetypes: ARCHETYPES,
      strategy: MOCK_STRATEGY,
      competitors: MOCK_COMPETITORS,
      ourProduct: MOCK_OUR_PRODUCT,
      runConfig: MOCK_RUN_CONFIG,
      client: MOCK_CLIENT,
    }),
    /agents must be a non-empty array/,
    'should throw with descriptive message for empty agents'
  );
});

// ---------------------------------------------------------------------------
// runAgentBatch — error on empty archetypes
// ---------------------------------------------------------------------------

test('runAgentBatch throws on empty archetypes array', async () => {
  const agents = spawnSmallCohort();
  await assert.rejects(
    () => runAgentBatch({
      agents,
      archetypes: [],
      strategy: MOCK_STRATEGY,
      competitors: MOCK_COMPETITORS,
      ourProduct: MOCK_OUR_PRODUCT,
      runConfig: MOCK_RUN_CONFIG,
      client: MOCK_CLIENT,
    }),
    /archetypes must be a non-empty array/,
    'should throw with descriptive message for empty archetypes'
  );
});

// ---------------------------------------------------------------------------
// runAgentBatch — error on non-object strategy
// ---------------------------------------------------------------------------

test('runAgentBatch throws on non-object strategy', async () => {
  const agents = spawnSmallCohort();
  await assert.rejects(
    () => runAgentBatch({
      agents,
      archetypes: ARCHETYPES,
      strategy: null,
      competitors: MOCK_COMPETITORS,
      ourProduct: MOCK_OUR_PRODUCT,
      runConfig: MOCK_RUN_CONFIG,
      client: MOCK_CLIENT,
    }),
    /strategy must be a non-null object/,
    'should throw with descriptive message for null strategy'
  );
});

// ---------------------------------------------------------------------------
// runAgentSimulation — spawn + evaluate convenience wrapper
// ---------------------------------------------------------------------------

test('runAgentSimulation returns agents + agentDecisions + choice_summary + archetype_breakdown', async () => {
  const result = await runAgentSimulation({
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
    totalBuyers: SMALL_TOTAL,
    seed: SMALL_SEED,
  });

  assert.ok(Array.isArray(result.agents), 'agents must be an array');
  assert.strictEqual(result.agents.length, SMALL_TOTAL, `agents.length must equal totalBuyers (${SMALL_TOTAL})`);
  assert.ok(Array.isArray(result.agentDecisions), 'agentDecisions must be an array');
  assert.strictEqual(result.agentDecisions.length, SMALL_TOTAL, 'agentDecisions.length must equal totalBuyers');
  assert.ok(result.choice_summary && typeof result.choice_summary === 'object', 'choice_summary must be an object');
  assert.ok(result.archetype_breakdown && typeof result.archetype_breakdown === 'object', 'archetype_breakdown must be an object');
});

// ---------------------------------------------------------------------------
// runAgentSimulation — seed determines cohort: same seed → same agentIds
// ---------------------------------------------------------------------------

test('runAgentSimulation same seed → same agentIds', async () => {
  const params = {
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
    totalBuyers: SMALL_TOTAL,
    seed: SMALL_SEED,
  };

  const run1 = await runAgentSimulation(params);
  const run2 = await runAgentSimulation(params);

  const ids1 = run1.agents.map((a) => a.agent_id);
  const ids2 = run2.agents.map((a) => a.agent_id);

  assert.deepStrictEqual(ids1, ids2, 'Agent IDs must be identical for the same seed');
});

// ---------------------------------------------------------------------------
// runAgentSimulation — different seeds → different agentIds
// ---------------------------------------------------------------------------

test('runAgentSimulation different seeds → different cohort', async () => {
  const baseParams = {
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
    totalBuyers: SMALL_TOTAL,
  };

  const run1 = await runAgentSimulation({ ...baseParams, seed: 1 });
  const run2 = await runAgentSimulation({ ...baseParams, seed: 2 });

  const names1 = run1.agents.map((a) => a.korean_name);
  const names2 = run2.agents.map((a) => a.korean_name);

  // Different seeds should produce different name orderings
  assert.notDeepStrictEqual(names1, names2, 'Different seeds should produce different agent cohorts');
});

// ---------------------------------------------------------------------------
// runAgentSimulation — totalBuyers respected
// ---------------------------------------------------------------------------

test('runAgentSimulation respects totalBuyers parameter', async () => {
  const total20 = await runAgentSimulation({
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
    totalBuyers: 20,
    seed: SMALL_SEED,
  });

  const total40 = await runAgentSimulation({
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
    totalBuyers: 40,
    seed: SMALL_SEED,
  });

  assert.strictEqual(total20.agents.length, 20, 'totalBuyers=20 must spawn 20 agents');
  assert.strictEqual(total40.agents.length, 40, 'totalBuyers=40 must spawn 40 agents');
  assert.strictEqual(total20.agentDecisions.length, 20);
  assert.strictEqual(total40.agentDecisions.length, 40);
});

// ---------------------------------------------------------------------------
// runAgentSimulation — choice_summary total equals totalBuyers
// ---------------------------------------------------------------------------

test('runAgentSimulation choice_summary total equals totalBuyers', async () => {
  const result = await runAgentSimulation({
    archetypes: ARCHETYPES,
    strategy: MOCK_STRATEGY,
    competitors: MOCK_COMPETITORS,
    ourProduct: MOCK_OUR_PRODUCT,
    runConfig: MOCK_RUN_CONFIG,
    client: MOCK_CLIENT,
    totalBuyers: SMALL_TOTAL,
    seed: SMALL_SEED,
  });

  const total = Object.values(result.choice_summary).reduce((s, n) => s + n, 0);
  assert.strictEqual(total, SMALL_TOTAL, `choice_summary total ${total} must equal totalBuyers ${SMALL_TOTAL}`);
});

// ---------------------------------------------------------------------------
// runAgentSimulation — error on empty archetypes
// ---------------------------------------------------------------------------

test('runAgentSimulation throws on empty archetypes', async () => {
  await assert.rejects(
    () => runAgentSimulation({
      archetypes: [],
      strategy: MOCK_STRATEGY,
      competitors: MOCK_COMPETITORS,
      ourProduct: MOCK_OUR_PRODUCT,
      runConfig: MOCK_RUN_CONFIG,
      client: MOCK_CLIENT,
    }),
    /archetypes must be a non-empty array/,
    'should throw descriptive error for empty archetypes'
  );
});
