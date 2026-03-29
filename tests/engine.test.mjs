import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runSimulation } from '../src/lib/simulation/engine.mjs';
import { spawnAgentCohort } from '../src/lib/simulation/buyerAgent.mjs';
import { spawnBuyerAgents } from '../src/lib/simulation/agent-spawner.mjs';
import { evaluateIndividualAgent } from '../src/lib/simulation/evaluator-nano.mjs';

const fixtureDir = path.resolve(process.cwd(), 'fixtures');

// ---------------------------------------------------------------------------
// Pre-existing tests — must continue to pass
// ---------------------------------------------------------------------------

test('engine runs end-to-end in mock mode', async () => {
  const result = await runSimulation({ fixtureDir, modelMode: 'mock', iterationCount: 2, minimumMarginFloor: 0.35, samplerSeed: 4242 });
  assert.ok(result.baseline.simulated_revenue >= 0);
  assert.ok(result.selected_strategy.id);
  assert.ok(typeof result.holdout.holdout_uplift === 'number');
  assert.deepEqual(Object.keys(result.diff), ['title', 'top_copy', 'price']);
});

test('engine applies overrides to baseline scenario', async () => {
  const overrideTitle = '오버라이드 테스트 샴푸 500ml';
  const overrideTopCopy = '오버라이드된 카피 문구입니다';
  const overridePriceKrw = 24900;
  const overrideCostKrw = 9500;

  const result = await runSimulation({
    fixtureDir,
    modelMode: 'mock',
    iterationCount: 1,
    minimumMarginFloor: 0.35,
    samplerSeed: 1234,
    overrides: {
      title: overrideTitle,
      topCopy: overrideTopCopy,
      priceKrw: overridePriceKrw,
      costKrw: overrideCostKrw,
    },
  });

  // Baseline should use override values instead of fixture defaults
  assert.strictEqual(result.baseline.title, overrideTitle, 'baseline.title should reflect override');
  assert.strictEqual(result.baseline.top_copy, overrideTopCopy, 'baseline.top_copy should reflect override');
  assert.strictEqual(result.baseline.price_krw, overridePriceKrw, 'baseline.price_krw should reflect override');

  // The margin should be computed using the overridden cost
  const expectedMarginRate = (overridePriceKrw - overrideCostKrw) / overridePriceKrw;
  assert.ok(
    Math.abs(result.baseline.margin_rate - expectedMarginRate) < 0.0001,
    `baseline.margin_rate (${result.baseline.margin_rate}) should use override costKrw (expected ~${expectedMarginRate})`
  );

  // Simulation should still complete normally
  assert.ok(result.baseline.simulated_revenue >= 0);
  assert.ok(result.selected_strategy.id);
  assert.ok(typeof result.holdout.holdout_uplift === 'number');
  assert.deepEqual(Object.keys(result.diff), ['title', 'top_copy', 'price']);
});

// ---------------------------------------------------------------------------
// Determinism — same seed produces identical results
// ---------------------------------------------------------------------------

test('engine produces deterministic results for the same samplerSeed', async () => {
  const opts = { fixtureDir, modelMode: 'mock', iterationCount: 1, minimumMarginFloor: 0.35, samplerSeed: 9999 };
  const run1 = await runSimulation(opts);
  const run2 = await runSimulation(opts);

  assert.strictEqual(
    run1.baseline.simulated_revenue,
    run2.baseline.simulated_revenue,
    'baseline revenue must be identical across identical seeds'
  );
  assert.strictEqual(
    run1.holdout.holdout_uplift,
    run2.holdout.holdout_uplift,
    'holdout_uplift must be identical across identical seeds'
  );
  assert.strictEqual(
    run1.selected_strategy.id,
    run2.selected_strategy.id,
    'selected strategy id must be identical across identical seeds'
  );
});

// ---------------------------------------------------------------------------
// iterationCount override — result reflects the requested iteration count
// ---------------------------------------------------------------------------

test('engine respects iterationCount override in result metadata', async () => {
  const result = await runSimulation({ fixtureDir, modelMode: 'mock', iterationCount: 3, minimumMarginFloor: 0.35, samplerSeed: 555 });
  assert.strictEqual(result.iteration_count, 3, 'result.iteration_count should match the iterationCount argument');
  assert.strictEqual(result.iterations.length, 3, 'result.iterations array length should match iterationCount');
});

// ---------------------------------------------------------------------------
// minimumMarginFloor override — a very high floor should flag violations
// ---------------------------------------------------------------------------

test('engine respects minimumMarginFloor override — extreme floor causes violations', async () => {
  // margin floor of 0.99 means cost must be <= 1% of price; virtually impossible
  const result = await runSimulation({ fixtureDir, modelMode: 'mock', iterationCount: 1, minimumMarginFloor: 0.99, samplerSeed: 321 });
  assert.strictEqual(result.minimum_margin_floor, 0.99, 'result.minimum_margin_floor should reflect the override');
  // The baseline itself will violate the floor at 0.99
  assert.ok(result.baseline.margin_floor_violations > 0, 'baseline margin_floor_violations should be > 0 with extreme floor');
});

// ---------------------------------------------------------------------------
// Partial overrides — only priceKrw changed, other fields come from fixture
// ---------------------------------------------------------------------------

test('engine applies partial override — only priceKrw is overridden', async () => {
  // First run without any overrides to capture fixture defaults
  const defaultResult = await runSimulation({ fixtureDir, modelMode: 'mock', iterationCount: 1, minimumMarginFloor: 0.35, samplerSeed: 7777 });
  const fixtureTitle = defaultResult.baseline.title;
  const fixtureTopCopy = defaultResult.baseline.top_copy;

  const overridePriceKrw = 15900;
  const overrideResult = await runSimulation({
    fixtureDir,
    modelMode: 'mock',
    iterationCount: 1,
    minimumMarginFloor: 0.35,
    samplerSeed: 7777,
    overrides: { priceKrw: overridePriceKrw },
  });

  assert.strictEqual(overrideResult.baseline.price_krw, overridePriceKrw, 'baseline.price_krw should use override');
  assert.strictEqual(overrideResult.baseline.title, fixtureTitle, 'baseline.title should remain as fixture default when not overridden');
  assert.strictEqual(overrideResult.baseline.top_copy, fixtureTopCopy, 'baseline.top_copy should remain as fixture default when not overridden');
});

// ---------------------------------------------------------------------------
// onEvent callback — events are emitted in the documented sequence
// ---------------------------------------------------------------------------

test('engine emits SSE events in correct sequence via onEvent callback', async () => {
  const events = [];
  await runSimulation({
    fixtureDir,
    modelMode: 'mock',
    iterationCount: 2,
    minimumMarginFloor: 0.35,
    samplerSeed: 8080,
    onEvent: (event) => { events.push(event.type); },
  });

  // Per-iteration sequence: iteration_start → agent_decision (×800) → iteration_complete
  // After all iterations: holdout_start → simulation_complete
  const iterationStartCount = events.filter((e) => e === 'iteration_start').length;
  const agentDecisionCount = events.filter((e) => e === 'agent_decision').length;
  const iterationCompleteCount = events.filter((e) => e === 'iteration_complete').length;
  const holdoutStartCount = events.filter((e) => e === 'holdout_start').length;
  const simulationCompleteCount = events.filter((e) => e === 'simulation_complete').length;

  assert.strictEqual(iterationStartCount, 2, 'should emit iteration_start once per iteration');
  assert.strictEqual(agentDecisionCount, 1600, 'should emit agent_decision 800× per iteration (800 agents × 2 iterations)');
  assert.strictEqual(iterationCompleteCount, 2, 'should emit iteration_complete once per iteration');
  assert.strictEqual(holdoutStartCount, 1, 'should emit holdout_start exactly once');
  assert.strictEqual(simulationCompleteCount, 1, 'should emit simulation_complete exactly once');

  // Verify ordering: last event is always simulation_complete
  assert.strictEqual(events[events.length - 1], 'simulation_complete', 'simulation_complete must be the last emitted event');
  // holdout_start must come before simulation_complete
  assert.ok(events.indexOf('holdout_start') < events.indexOf('simulation_complete'), 'holdout_start must precede simulation_complete');
});

// ---------------------------------------------------------------------------
// onEvent payload shape — key fields present on simulation_complete event
// ---------------------------------------------------------------------------

test('engine simulation_complete event payload has required fields', async () => {
  let completeEvent = null;
  await runSimulation({
    fixtureDir,
    modelMode: 'mock',
    iterationCount: 1,
    minimumMarginFloor: 0.35,
    samplerSeed: 1111,
    onEvent: (event) => {
      if (event.type === 'simulation_complete') completeEvent = event;
    },
  });

  assert.ok(completeEvent, 'simulation_complete event must be emitted');
  assert.ok(typeof completeEvent.holdout.holdout_uplift === 'number', 'holdout.holdout_uplift must be a number');
  assert.ok(completeEvent.selected_strategy?.id, 'selected_strategy.id must be present');
  assert.deepEqual(Object.keys(completeEvent.diff), ['title', 'top_copy', 'price'], 'diff must have exactly title, top_copy, price keys');
  assert.ok(completeEvent.baseline?.simulated_revenue >= 0, 'baseline.simulated_revenue must be present and non-negative');
});

// ---------------------------------------------------------------------------
// Sub-AC 2c: 800 individual-agent evaluations — output shape verification
// ---------------------------------------------------------------------------

test('engine individual-agent evaluation produces exactly 800 agent_decision events per iteration', async () => {
  const agentDecisionEvents = [];

  await runSimulation({
    fixtureDir,
    modelMode: 'mock',
    iterationCount: 1,
    minimumMarginFloor: 0.35,
    samplerSeed: 2222,
    onEvent: (event) => {
      if (event.type === 'agent_decision') agentDecisionEvents.push(event);
    },
  });

  // Must emit exactly 800 agent_decision events for 1 iteration (one per buyer agent)
  assert.strictEqual(
    agentDecisionEvents.length,
    800,
    `Expected exactly 800 agent_decision events, got ${agentDecisionEvents.length}`
  );
});

test('engine agent_decision events each contain agent_id, chosen_product, and reasoning fields', async () => {
  const agentDecisionEvents = [];

  await runSimulation({
    fixtureDir,
    modelMode: 'mock',
    iterationCount: 1,
    minimumMarginFloor: 0.35,
    samplerSeed: 3333,
    onEvent: (event) => {
      if (event.type === 'agent_decision') agentDecisionEvents.push(event);
    },
  });

  const VALID_PRODUCT_CHOICES = new Set(['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']);

  for (let i = 0; i < agentDecisionEvents.length; i += 1) {
    const e = agentDecisionEvents[i];

    assert.ok(
      typeof e.agent_id === 'string' && e.agent_id.length > 0,
      `agent_decision[${i}].agent_id must be a non-empty string, got: ${JSON.stringify(e.agent_id)}`
    );
    assert.ok(
      typeof e.chosen_product === 'string' && VALID_PRODUCT_CHOICES.has(e.chosen_product),
      `agent_decision[${i}].chosen_product must be a valid product choice, got: ${JSON.stringify(e.chosen_product)}`
    );
    assert.ok(
      typeof e.reasoning === 'string' && e.reasoning.length > 0,
      `agent_decision[${i}].reasoning must be a non-empty string, got: ${JSON.stringify(e.reasoning)}`
    );
  }
});

test('engine individual-agent evaluation: all 800 agent_ids are unique within an iteration', async () => {
  const agentIds = [];

  await runSimulation({
    fixtureDir,
    modelMode: 'mock',
    iterationCount: 1,
    minimumMarginFloor: 0.35,
    samplerSeed: 4444,
    onEvent: (event) => {
      if (event.type === 'agent_decision') agentIds.push(event.agent_id);
    },
  });

  const uniqueIds = new Set(agentIds);
  assert.strictEqual(
    uniqueIds.size,
    agentIds.length,
    `Expected all 800 agent_ids to be unique, but found ${agentIds.length - uniqueIds.size} duplicates`
  );
});

// ---------------------------------------------------------------------------
// Sub-AC 7a: Unit tests — agent spawning (800 agents, unique IDs)
// ---------------------------------------------------------------------------

// Full 8-archetype fixture matching fixtures/buyer-personas.md
const FULL_ARCHETYPES_FOR_ENGINE = [
  { id: 'price_sensitive',     label: '가격 민감형',         cohort_weight_percent: 18, budget_band: 'low',  price_sensitivity: 5, trust_sensitivity: 2, promo_affinity: 5, brand_bias: 2, pass_threshold: 0.72, copy_preference: '저렴하고 실속 있는 선택' },
  { id: 'value_seeker',        label: '가성비 균형형',       cohort_weight_percent: 16, budget_band: 'mid',  price_sensitivity: 4, trust_sensitivity: 3, promo_affinity: 4, brand_bias: 2, pass_threshold: 0.60, copy_preference: '가격 대비 효율과 기능이 좋아 보이는 문구' },
  { id: 'premium_quality',     label: '프리미엄 품질형',     cohort_weight_percent: 12, budget_band: 'high', price_sensitivity: 2, trust_sensitivity: 4, promo_affinity: 1, brand_bias: 3, pass_threshold: 0.45, copy_preference: '고급감, 전문성, 차별화' },
  { id: 'trust_first',         label: '신뢰 우선형',         cohort_weight_percent: 15, budget_band: 'mid',  price_sensitivity: 3, trust_sensitivity: 5, promo_affinity: 2, brand_bias: 4, pass_threshold: 0.48, copy_preference: '믿을 수 있는 설계, 전문가, 과학 기반' },
  { id: 'aesthetics_first',    label: '감성/브랜드 인상형',  cohort_weight_percent:  8, budget_band: 'mid',  price_sensitivity: 3, trust_sensitivity: 3, promo_affinity: 2, brand_bias: 4, pass_threshold: 0.58, copy_preference: '깔끔하고 세련된 프리미엄 톤' },
  { id: 'urgency_buyer',       label: '문제 해결 급한형',    cohort_weight_percent: 11, budget_band: 'mid',  price_sensitivity: 3, trust_sensitivity: 4, promo_affinity: 2, brand_bias: 3, pass_threshold: 0.42, copy_preference: '빠르게 믿고 선택할 수 있는 확신형 문구' },
  { id: 'promo_hunter',        label: '할인 반응형',         cohort_weight_percent: 10, budget_band: 'low',  price_sensitivity: 4, trust_sensitivity: 2, promo_affinity: 5, brand_bias: 1, pass_threshold: 0.68, copy_preference: '할인/혜택/지금 사야 하는 이유' },
  { id: 'gift_or_family_buyer',label: '가족/대리 구매형',    cohort_weight_percent: 10, budget_band: 'mid',  price_sensitivity: 3, trust_sensitivity: 5, promo_affinity: 2, brand_bias: 3, pass_threshold: 0.56, copy_preference: '안전하고 믿을 수 있어 가족에게도 권할 수 있는 문구' },
];

test('spawnAgentCohort creates exactly 800 agents from the 8-archetype fixture', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 42 });
  assert.strictEqual(
    agents.length,
    800,
    `Expected exactly 800 agents, got ${agents.length}`
  );
});

test('spawnAgentCohort assigns unique agent_ids to all 800 agents', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 42 });
  const ids = new Set(agents.map((a) => a.agent_id));
  assert.strictEqual(
    ids.size,
    800,
    `Expected 800 unique agent_ids, but found ${ids.size} (${800 - ids.size} duplicates)`
  );
});

test('spawnAgentCohort agent_id format matches {archetype_id}_{NNNN} pattern for all 800 agents', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 42 });
  const AGENT_ID_PATTERN = /^[a-z_]+_\d{4}$/;
  for (const agent of agents) {
    assert.match(
      agent.agent_id,
      AGENT_ID_PATTERN,
      `agent_id "${agent.agent_id}" does not match pattern {archetype_id}_{NNNN}`
    );
  }
});

test('spawnAgentCohort each agent belongs to a valid archetype from the 8-archetype set', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 42 });
  const validArchetypeIds = new Set(FULL_ARCHETYPES_FOR_ENGINE.map((a) => a.id));
  for (const agent of agents) {
    assert.ok(
      validArchetypeIds.has(agent.archetype_id),
      `Agent "${agent.agent_id}" has invalid archetype_id: "${agent.archetype_id}"`
    );
  }
});

test('spawnBuyerAgents (agent-spawner.mjs) creates 800 agents with unique IDs', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 42 });
  assert.strictEqual(agents.length, 800, `Expected 800 agents, got ${agents.length}`);
  const ids = new Set(agents.map((a) => a.agent_id));
  assert.strictEqual(
    ids.size,
    800,
    `Expected 800 unique agent_ids from spawnBuyerAgents, found ${ids.size}`
  );
});

test('spawnBuyerAgents agent_id format uses archetype_id prefix for all agents', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 7 });
  const AGENT_ID_PATTERN = /^[a-z_]+_\d{4}$/;
  for (const agent of agents) {
    assert.match(
      agent.agent_id,
      AGENT_ID_PATTERN,
      `agent_id "${agent.agent_id}" from spawnBuyerAgents does not match pattern`
    );
    // The prefix must match the agent's archetype_id
    assert.ok(
      agent.agent_id.startsWith(agent.archetype_id),
      `agent_id "${agent.agent_id}" must start with archetype_id "${agent.archetype_id}"`
    );
  }
});

test('spawnAgentCohort is deterministic — same seed produces identical agent IDs', () => {
  const first = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 123 });
  const second = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 123 });
  assert.deepStrictEqual(
    first.map((a) => a.agent_id),
    second.map((a) => a.agent_id),
    'Same seed must produce identical agent_id order'
  );
});

// ---------------------------------------------------------------------------
// Sub-AC 7a: Unit tests — individual evaluation logic (independent score/decision)
// ---------------------------------------------------------------------------

// Shared evaluation fixtures
const EVAL_ARCHETYPE = {
  id: 'value_seeker',
  label: '가성비 균형형',
  budget_band: 'mid',
  price_sensitivity: 4,
  trust_sensitivity: 3,
  promo_affinity: 4,
  brand_bias: 2,
  pass_threshold: 0.60,
  copy_preference: '가격 대비 효율과 기능이 좋아 보이는 문구',
};

const EVAL_STRATEGY = {
  id: 'strategy_test',
  title: '두피케어 전문 샴푸 500ml',
  top_copy: '전문가 두피 솔루션',
  price_krw: 29000,
  rationale: '테스트용 전략',
};

const EVAL_COMPETITORS = {
  competitors: [
    { product_id: 'competitor_a', brand_name: '경쟁사A', price_krw: 27900, positioning: '프리미엄 메이저 탈모 샴푸' },
    { product_id: 'competitor_b', brand_name: '경쟁사B', price_krw: 16120, positioning: '기능성 / 두피강화형 메이저 브랜드' },
    { product_id: 'competitor_c', brand_name: '경쟁사C', price_krw: 13900, positioning: '가성비 / 대용량형 탈모 샴푸' },
  ],
};

const EVAL_OUR_PRODUCT = {
  product_id: 'our_product',
  current_title: '스칼프 엑스퍼트 탈모케어 샴푸 500ml',
  current_top_copy: '두피과학 기반, 전문가 설계 탈모 솔루션',
  current_price_krw: 35000,
  current_cost_krw: 12000,
  positioning: '두피과학 / 성분 전문가 설계 프리미엄',
};

const EVAL_RUN_CONFIG = {
  strategy_model: 'gpt-5.4',
  buyer_evaluator_model: 'gpt-5-nano',
  realism_judge_model: 'gpt-5.4',
};

const EVAL_MOCK_CLIENT = {
  mode: 'mock',
  async generateJson({ fallback }) {
    return { data: await fallback(), source: 'fallback' };
  },
};

const VALID_PRODUCT_CHOICES = new Set(['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']);

test('evaluateIndividualAgent: each agent produces { agent_id, chosen_product, reasoning } output', async () => {
  const result = await evaluateIndividualAgent({
    agent_id: 'value_seeker_0001',
    archetype: EVAL_ARCHETYPE,
    strategy: EVAL_STRATEGY,
    competitors: EVAL_COMPETITORS,
    ourProduct: EVAL_OUR_PRODUCT,
    runConfig: EVAL_RUN_CONFIG,
    client: EVAL_MOCK_CLIENT,
  });

  assert.ok(result && typeof result === 'object', 'result must be an object');
  assert.strictEqual(result.agent_id, 'value_seeker_0001', 'agent_id must be echoed back');
  assert.ok(
    VALID_PRODUCT_CHOICES.has(result.chosen_product),
    `chosen_product must be valid, got: ${result.chosen_product}`
  );
  assert.ok(
    typeof result.reasoning === 'string' && result.reasoning.length > 0,
    'reasoning must be a non-empty string'
  );
});

test('evaluateIndividualAgent: different agent_ids produce independent decisions (not all identical)', async () => {
  const agentCount = 50;
  const choiceSet = new Set();

  for (let i = 0; i < agentCount; i += 1) {
    const result = await evaluateIndividualAgent({
      agent_id: `value_seeker_${String(i).padStart(4, '0')}`,
      archetype: EVAL_ARCHETYPE,
      strategy: EVAL_STRATEGY,
      competitors: EVAL_COMPETITORS,
      ourProduct: EVAL_OUR_PRODUCT,
      runConfig: EVAL_RUN_CONFIG,
      client: EVAL_MOCK_CLIENT,
    });
    choiceSet.add(result.chosen_product);
  }

  // With 50 agents, at least 2 distinct choices must appear — confirms independence
  assert.ok(
    choiceSet.size >= 2,
    `Expected at least 2 distinct choices across 50 agents, got ${choiceSet.size}: [${[...choiceSet].join(', ')}]`
  );
});

test('evaluateIndividualAgent: same agent_id always produces identical score (determinism)', async () => {
  const params = {
    agent_id: 'price_sensitive_0099',
    archetype: EVAL_ARCHETYPE,
    strategy: EVAL_STRATEGY,
    competitors: EVAL_COMPETITORS,
    ourProduct: EVAL_OUR_PRODUCT,
    runConfig: EVAL_RUN_CONFIG,
    client: EVAL_MOCK_CLIENT,
  };

  const run1 = await evaluateIndividualAgent(params);
  const run2 = await evaluateIndividualAgent(params);
  const run3 = await evaluateIndividualAgent(params);

  assert.strictEqual(run1.chosen_product, run2.chosen_product, 'chosen_product must match on repeat calls with same agent_id');
  assert.strictEqual(run2.chosen_product, run3.chosen_product, 'chosen_product must match on repeat calls with same agent_id');
  assert.strictEqual(run1.reasoning, run2.reasoning, 'reasoning must match on repeat calls with same agent_id');
});

test('evaluateIndividualAgent: evaluates all 800 spawned agents independently without collision', async () => {
  // Spawn 800 agents, evaluate each, verify all 800 produce valid independent results.
  // The engine passes the full archetype (with label) per archetypeById[agent.archetype_id],
  // so we replicate that pattern here.
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 55 });
  const archetypeById = Object.fromEntries(FULL_ARCHETYPES_FOR_ENGINE.map((a) => [a.id, a]));

  const results = await Promise.all(
    agents.map((agent) =>
      evaluateIndividualAgent({
        agent_id: agent.agent_id,
        archetype: archetypeById[agent.archetype_id],
        strategy: EVAL_STRATEGY,
        competitors: EVAL_COMPETITORS,
        ourProduct: EVAL_OUR_PRODUCT,
        runConfig: EVAL_RUN_CONFIG,
        client: EVAL_MOCK_CLIENT,
      })
    )
  );

  // All 800 evaluations must return valid results
  assert.strictEqual(results.length, 800, `Expected 800 evaluation results, got ${results.length}`);

  // Every result must have the correct shape
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    assert.ok(
      typeof r.agent_id === 'string' && r.agent_id.length > 0,
      `results[${i}].agent_id must be a non-empty string`
    );
    assert.ok(
      VALID_PRODUCT_CHOICES.has(r.chosen_product),
      `results[${i}].chosen_product must be valid, got: ${r.chosen_product}`
    );
    assert.ok(
      typeof r.reasoning === 'string' && r.reasoning.length > 0,
      `results[${i}].reasoning must be non-empty`
    );
  }

  // The agent_id values in results must match the spawned agents (order preserved)
  for (let i = 0; i < agents.length; i += 1) {
    assert.strictEqual(
      results[i].agent_id,
      agents[i].agent_id,
      `results[${i}].agent_id must match agents[${i}].agent_id`
    );
  }

  // At least 2 distinct choices must appear across 800 agents (confirms independence)
  const allChoices = new Set(results.map((r) => r.chosen_product));
  assert.ok(
    allChoices.size >= 2,
    `Expected at least 2 distinct chosen_product values across 800 agents, got ${allChoices.size}`
  );
});

// ---------------------------------------------------------------------------
// Sub-AC 7a (extended): score field — individual agent utility score
// ---------------------------------------------------------------------------

test('evaluateIndividualAgent: result includes a numeric score field in [0, 1]', async () => {
  const result = await evaluateIndividualAgent({
    agent_id: 'value_seeker_0001',
    archetype: EVAL_ARCHETYPE,
    strategy: EVAL_STRATEGY,
    competitors: EVAL_COMPETITORS,
    ourProduct: EVAL_OUR_PRODUCT,
    runConfig: EVAL_RUN_CONFIG,
    client: EVAL_MOCK_CLIENT,
  });

  assert.ok(
    typeof result.score === 'number',
    `score must be a number, got: ${typeof result.score}`
  );
  assert.ok(
    Number.isFinite(result.score),
    `score must be a finite number, got: ${result.score}`
  );
  assert.ok(
    result.score >= 0 && result.score <= 1,
    `score must be in [0, 1], got: ${result.score}`
  );
});

test('evaluateIndividualAgent: scores are diverse across 50 agents (not all identical)', async () => {
  const scores = [];

  for (let i = 0; i < 50; i += 1) {
    const result = await evaluateIndividualAgent({
      agent_id: `value_seeker_${String(i).padStart(4, '0')}`,
      archetype: EVAL_ARCHETYPE,
      strategy: EVAL_STRATEGY,
      competitors: EVAL_COMPETITORS,
      ourProduct: EVAL_OUR_PRODUCT,
      runConfig: EVAL_RUN_CONFIG,
      client: EVAL_MOCK_CLIENT,
    });
    scores.push(result.score);
  }

  // All scores must be valid
  for (let i = 0; i < scores.length; i += 1) {
    assert.ok(
      typeof scores[i] === 'number' && scores[i] >= 0 && scores[i] <= 1,
      `scores[${i}] must be a valid [0,1] float, got: ${scores[i]}`
    );
  }

  // Scores should not all be identical — at least 2 distinct values across 50 agents
  const uniqueScores = new Set(scores);
  assert.ok(
    uniqueScores.size >= 2,
    `Expected at least 2 distinct score values across 50 agents, got ${uniqueScores.size}`
  );
});

test('evaluateIndividualAgent: same agent_id produces the same score on repeated calls', async () => {
  const params = {
    agent_id: 'trust_first_0042',
    archetype: EVAL_ARCHETYPE,
    strategy: EVAL_STRATEGY,
    competitors: EVAL_COMPETITORS,
    ourProduct: EVAL_OUR_PRODUCT,
    runConfig: EVAL_RUN_CONFIG,
    client: EVAL_MOCK_CLIENT,
  };

  const run1 = await evaluateIndividualAgent(params);
  const run2 = await evaluateIndividualAgent(params);
  const run3 = await evaluateIndividualAgent(params);

  assert.strictEqual(run1.score, run2.score, 'score must be identical on repeated calls with same agent_id (run1 vs run2)');
  assert.strictEqual(run2.score, run3.score, 'score must be identical on repeated calls with same agent_id (run2 vs run3)');
});

// ---------------------------------------------------------------------------
// Sub-AC 7a (extended): archetype distribution — cohort weights
// ---------------------------------------------------------------------------

test('spawnAgentCohort distributes agents according to archetype cohort_weight_percent', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 42 });

  // Count agents per archetype
  const countByArchetype = {};
  for (const agent of agents) {
    countByArchetype[agent.archetype_id] = (countByArchetype[agent.archetype_id] || 0) + 1;
  }

  // Each archetype count must be within 1 of its expected fractional share (largest-remainder rounding)
  for (const archetype of FULL_ARCHETYPES_FOR_ENGINE) {
    const expectedFraction = (archetype.cohort_weight_percent / 100) * 800;
    const lowerBound = Math.floor(expectedFraction);
    const upperBound = Math.ceil(expectedFraction);
    const actual = countByArchetype[archetype.id] ?? 0;
    assert.ok(
      actual >= lowerBound && actual <= upperBound,
      `Archetype "${archetype.id}": expected ${lowerBound}–${upperBound} agents ` +
      `(${archetype.cohort_weight_percent}% of 800), got ${actual}`
    );
  }
});

test('spawnAgentCohort total distribution across all 8 archetypes sums to exactly 800', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 42 });

  // Ensure all 8 archetypes are represented
  const representedArchetypes = new Set(agents.map((a) => a.archetype_id));
  assert.strictEqual(
    representedArchetypes.size,
    FULL_ARCHETYPES_FOR_ENGINE.length,
    `All ${FULL_ARCHETYPES_FOR_ENGINE.length} archetypes must be represented, ` +
    `but only ${representedArchetypes.size} were found`
  );

  // Total must sum to exactly 800
  assert.strictEqual(agents.length, 800, 'Total agent count must be exactly 800');
});

test('spawnBuyerAgents distributes 8 archetypes according to canonical weight percentages', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 42 });

  // Canonical weights must sum to 100
  const totalWeight = FULL_ARCHETYPES_FOR_ENGINE.reduce((sum, a) => sum + a.cohort_weight_percent, 0);
  assert.strictEqual(totalWeight, 100, `Archetype weights must sum to 100, got ${totalWeight}`);

  const countByArchetype = {};
  for (const agent of agents) {
    countByArchetype[agent.archetype_id] = (countByArchetype[agent.archetype_id] || 0) + 1;
  }

  // Every archetype ID must appear
  for (const archetype of FULL_ARCHETYPES_FOR_ENGINE) {
    assert.ok(
      countByArchetype[archetype.id] > 0,
      `Archetype "${archetype.id}" must appear at least once in the cohort`
    );
  }
});

// ---------------------------------------------------------------------------
// Sub-AC 7a (extended): agent trait ranges — valid field values on spawned agents
// ---------------------------------------------------------------------------

test('spawnAgentCohort: all 800 agents have valid trait field ranges', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 42 });

  for (let i = 0; i < agents.length; i += 1) {
    const agent = agents[i];

    // price_sensitivity, trust_sensitivity, promo_affinity, brand_bias: [1, 5]
    for (const field of ['price_sensitivity', 'trust_sensitivity', 'promo_affinity', 'brand_bias']) {
      assert.ok(
        typeof agent[field] === 'number' && Number.isFinite(agent[field]),
        `agents[${i}].${field} must be a finite number, got: ${agent[field]}`
      );
      assert.ok(
        agent[field] >= 1 && agent[field] <= 5,
        `agents[${i}].${field} must be in [1, 5], got: ${agent[field]}`
      );
    }

    // pass_threshold: [0, 1]
    assert.ok(
      typeof agent.pass_threshold === 'number' && Number.isFinite(agent.pass_threshold),
      `agents[${i}].pass_threshold must be a finite number, got: ${agent.pass_threshold}`
    );
    assert.ok(
      agent.pass_threshold >= 0 && agent.pass_threshold <= 1,
      `agents[${i}].pass_threshold must be in [0, 1], got: ${agent.pass_threshold}`
    );

    // korean_name: non-empty string
    assert.ok(
      typeof agent.korean_name === 'string' && agent.korean_name.length >= 2,
      `agents[${i}].korean_name must be a string with at least 2 chars, got: "${agent.korean_name}"`
    );

    // budget_band: must be low | mid | high
    assert.ok(
      ['low', 'mid', 'high'].includes(agent.budget_band),
      `agents[${i}].budget_band must be low/mid/high, got: "${agent.budget_band}"`
    );

    // copy_preference: non-empty string
    assert.ok(
      typeof agent.copy_preference === 'string' && agent.copy_preference.length > 0,
      `agents[${i}].copy_preference must be a non-empty string`
    );
  }
});

test('spawnAgentCohort: all 800 agents have unique korean_names', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 42 });

  const names = agents.map((a) => a.korean_name);
  const uniqueNames = new Set(names);
  assert.strictEqual(
    uniqueNames.size,
    names.length,
    `Expected all 800 korean_names to be unique, but found ${names.length - uniqueNames.size} duplicates`
  );
});

test('spawnAgentCohort: all 800 agents have unique sensitivity profiles (no duplicate trait tuples)', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 42 });

  const profiles = new Set();
  for (const agent of agents) {
    const profile = `${agent.price_sensitivity}|${agent.trust_sensitivity}|${agent.promo_affinity}|${agent.brand_bias}|${agent.pass_threshold}`;
    profiles.add(profile);
  }

  assert.strictEqual(
    profiles.size,
    800,
    `Expected 800 unique sensitivity profiles, got ${profiles.size} (${800 - profiles.size} duplicates)`
  );
});

test('spawnAgentCohort: trait variation is ±10% multiplicative — stays close to archetype base', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 42 });
  const archetypeById = Object.fromEntries(FULL_ARCHETYPES_FOR_ENGINE.map((a) => [a.id, a]));

  for (const agent of agents) {
    const archetype = archetypeById[agent.archetype_id];

    for (const field of ['price_sensitivity', 'trust_sensitivity', 'promo_affinity', 'brand_bias']) {
      const base = archetype[field];
      const varied = agent[field];
      // ±10% multiplicative: |varied - base| / base ≤ 0.10 + small float tolerance
      const relativeDeviation = Math.abs(varied - base) / base;
      assert.ok(
        relativeDeviation <= 0.11, // 0.10 + 0.01 tolerance for rounding
        `agents[${agent.agent_id}].${field}: relative deviation ${relativeDeviation.toFixed(4)} ` +
        `exceeds ±10% threshold. base=${base}, varied=${varied}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Sub-AC 7a (extended): archetype assignment integrity
// ---------------------------------------------------------------------------

test('spawnAgentCohort: every agent_id prefix matches its archetype_id', () => {
  const agents = spawnAgentCohort({ archetypes: FULL_ARCHETYPES_FOR_ENGINE, totalBuyers: 800, seed: 42 });

  for (const agent of agents) {
    assert.ok(
      agent.agent_id.startsWith(agent.archetype_id),
      `agent_id "${agent.agent_id}" must start with archetype_id "${agent.archetype_id}"`
    );
  }
});

test('spawnBuyerAgents: every agent has a valid archetype_id from the canonical 8-archetype set', () => {
  const agents = spawnBuyerAgents({ totalBuyers: 800, seed: 42 });
  const validArchetypeIds = new Set(FULL_ARCHETYPES_FOR_ENGINE.map((a) => a.id));

  for (const agent of agents) {
    assert.ok(
      validArchetypeIds.has(agent.archetype_id),
      `Agent "${agent.agent_id}" has invalid archetype_id: "${agent.archetype_id}"`
    );
    assert.ok(
      agent.agent_id.startsWith(agent.archetype_id),
      `Agent "${agent.agent_id}" agent_id prefix must match archetype_id "${agent.archetype_id}"`
    );
  }
});

test('spawnBuyerAgents is deterministic — same seed produces identical cohort', () => {
  const first = spawnBuyerAgents({ totalBuyers: 800, seed: 77 });
  const second = spawnBuyerAgents({ totalBuyers: 800, seed: 77 });

  assert.deepStrictEqual(
    first.map((a) => a.agent_id),
    second.map((a) => a.agent_id),
    'Same seed must produce identical agent_id order for spawnBuyerAgents'
  );

  // Also verify trait values are identical
  for (let i = 0; i < first.length; i += 1) {
    assert.strictEqual(
      first[i].price_sensitivity,
      second[i].price_sensitivity,
      `agents[${i}].price_sensitivity must be identical across seeded runs`
    );
  }
});

// ---------------------------------------------------------------------------
// Sub-AC 7a (extended): engine archetype_breakdown in iteration_complete events
// ---------------------------------------------------------------------------

test('engine iteration_complete event contains archetype_breakdown with all 8 archetype keys', async () => {
  let iterCompleteEvent = null;

  await runSimulation({
    fixtureDir,
    modelMode: 'mock',
    iterationCount: 1,
    minimumMarginFloor: 0.35,
    samplerSeed: 5555,
    onEvent: (event) => {
      if (event.type === 'iteration_complete') iterCompleteEvent = event;
    },
  });

  assert.ok(iterCompleteEvent, 'iteration_complete event must be emitted');
  assert.ok(
    iterCompleteEvent.archetype_breakdown && typeof iterCompleteEvent.archetype_breakdown === 'object',
    'archetype_breakdown must be an object in iteration_complete event'
  );

  // All 8 archetypes must appear in the breakdown
  const archetypeIds = FULL_ARCHETYPES_FOR_ENGINE.map((a) => a.id);
  for (const archetypeId of archetypeIds) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(iterCompleteEvent.archetype_breakdown, archetypeId),
      `archetype_breakdown must contain key "${archetypeId}"`
    );
  }
});

test('engine iteration_complete archetype_breakdown choice_summary sums match total agent count', async () => {
  let iterCompleteEvent = null;

  await runSimulation({
    fixtureDir,
    modelMode: 'mock',
    iterationCount: 1,
    minimumMarginFloor: 0.35,
    samplerSeed: 6666,
    onEvent: (event) => {
      if (event.type === 'iteration_complete') iterCompleteEvent = event;
    },
  });

  assert.ok(iterCompleteEvent, 'iteration_complete event must be emitted');

  // choice_summary totals must sum to 800 (one decision per agent)
  const choiceSummary = iterCompleteEvent.choice_summary;
  assert.ok(choiceSummary && typeof choiceSummary === 'object', 'choice_summary must be present');

  const totalChoices = Object.values(choiceSummary).reduce((sum, count) => sum + count, 0);
  assert.strictEqual(
    totalChoices,
    800,
    `choice_summary totals must sum to 800 (one per agent), got ${totalChoices}`
  );

  // archetype_breakdown values (choice sub-objects) must each contain the 5 valid product keys
  const VALID_KEYS = new Set(['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']);
  for (const [archetypeId, breakdown] of Object.entries(iterCompleteEvent.archetype_breakdown)) {
    for (const key of Object.keys(breakdown)) {
      assert.ok(
        VALID_KEYS.has(key),
        `archetype_breakdown["${archetypeId}"] contains unexpected key: "${key}"`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Sub-AC 11a: Override parameter tests — title, price, and cost variations
// ---------------------------------------------------------------------------

test('engine applies partial override — only title is overridden', async () => {
  // First run without overrides to capture fixture defaults
  const defaultResult = await runSimulation({
    fixtureDir,
    modelMode: 'mock',
    iterationCount: 1,
    minimumMarginFloor: 0.35,
    samplerSeed: 11001,
  });
  const fixturePrice = defaultResult.baseline.price_krw;
  const fixtureTopCopy = defaultResult.baseline.top_copy;

  const overrideTitle = '테스트 전용 두피케어 샴푸 400ml';
  const overrideResult = await runSimulation({
    fixtureDir,
    modelMode: 'mock',
    iterationCount: 1,
    minimumMarginFloor: 0.35,
    samplerSeed: 11001,
    overrides: { title: overrideTitle },
  });

  assert.strictEqual(
    overrideResult.baseline.title,
    overrideTitle,
    'baseline.title must use the overridden title value'
  );
  assert.notStrictEqual(
    overrideResult.baseline.title,
    defaultResult.baseline.title,
    'overridden title must differ from fixture default'
  );
  assert.strictEqual(
    overrideResult.baseline.price_krw,
    fixturePrice,
    'baseline.price_krw must remain as fixture default when only title is overridden'
  );
  assert.strictEqual(
    overrideResult.baseline.top_copy,
    fixtureTopCopy,
    'baseline.top_copy must remain as fixture default when only title is overridden'
  );
  // Simulation must still complete normally
  assert.ok(overrideResult.selected_strategy.id, 'selected_strategy.id must be present');
  assert.ok(typeof overrideResult.holdout.holdout_uplift === 'number', 'holdout_uplift must be a number');
});

test('engine applies partial override — only costKrw is overridden', async () => {
  // Fixture defaults: current_price_krw=29900, current_cost_krw=11000
  // Default margin rate = (29900 - 11000) / 29900 ≈ 0.6321
  const defaultResult = await runSimulation({
    fixtureDir,
    modelMode: 'mock',
    iterationCount: 1,
    minimumMarginFloor: 0.35,
    samplerSeed: 11002,
  });
  const fixtureTitle = defaultResult.baseline.title;
  const fixturePrice = defaultResult.baseline.price_krw;
  const fixtureMarginRate = defaultResult.baseline.margin_rate;

  const overrideCostKrw = 18000; // Higher cost → lower margin
  const expectedMarginRate = (fixturePrice - overrideCostKrw) / fixturePrice;

  const overrideResult = await runSimulation({
    fixtureDir,
    modelMode: 'mock',
    iterationCount: 1,
    minimumMarginFloor: 0.35,
    samplerSeed: 11002,
    overrides: { costKrw: overrideCostKrw },
  });

  // Title and price must remain unchanged from fixture
  assert.strictEqual(
    overrideResult.baseline.title,
    fixtureTitle,
    'baseline.title must remain as fixture default when only costKrw is overridden'
  );
  assert.strictEqual(
    overrideResult.baseline.price_krw,
    fixturePrice,
    'baseline.price_krw must remain as fixture default when only costKrw is overridden'
  );
  // Margin rate must reflect the overridden cost
  assert.ok(
    Math.abs(overrideResult.baseline.margin_rate - expectedMarginRate) < 0.0001,
    `baseline.margin_rate (${overrideResult.baseline.margin_rate}) must reflect overridden costKrw ` +
    `(expected ~${expectedMarginRate.toFixed(4)})`
  );
  // Overridden margin must differ from default margin
  assert.notStrictEqual(
    overrideResult.baseline.margin_rate,
    fixtureMarginRate,
    'baseline.margin_rate must change when costKrw is overridden with a different value'
  );
  // Simulation must complete normally
  assert.ok(overrideResult.selected_strategy.id, 'selected_strategy.id must be present');
  assert.ok(typeof overrideResult.holdout.holdout_uplift === 'number', 'holdout_uplift must be a number');
});

test('engine: different title overrides each produce distinct baseline.title values', async () => {
  const titles = [
    '두피 전문 A 샴푸 500ml',
    '탈모 케어 B 샴푸 500ml',
    '프리미엄 C 두피케어 샴푸 500ml',
  ];

  const baselineTitles = await Promise.all(
    titles.map((title) =>
      runSimulation({
        fixtureDir,
        modelMode: 'mock',
        iterationCount: 1,
        minimumMarginFloor: 0.35,
        samplerSeed: 11003,
        overrides: { title },
      }).then((r) => r.baseline.title)
    )
  );

  // Each override title must appear verbatim in the result
  for (let i = 0; i < titles.length; i += 1) {
    assert.strictEqual(
      baselineTitles[i],
      titles[i],
      `baseline.title for override[${i}] must match the provided title`
    );
  }

  // All 3 results must be distinct
  const uniqueTitles = new Set(baselineTitles);
  assert.strictEqual(
    uniqueTitles.size,
    titles.length,
    `All ${titles.length} title overrides must produce distinct baseline.title values`
  );
});

test('engine: different price overrides produce distinct baseline margin rates', async () => {
  // Use a fixed cost so margin rate is purely driven by price
  const fixedCostKrw = 11000;
  const prices = [19900, 24900, 34900];

  const marginRates = await Promise.all(
    prices.map((priceKrw) =>
      runSimulation({
        fixtureDir,
        modelMode: 'mock',
        iterationCount: 1,
        minimumMarginFloor: 0.10, // low floor so none violate
        samplerSeed: 11004,
        overrides: { priceKrw, costKrw: fixedCostKrw },
      }).then((r) => r.baseline.margin_rate)
    )
  );

  // Verify each price override produces the expected margin rate
  for (let i = 0; i < prices.length; i += 1) {
    const expectedRate = (prices[i] - fixedCostKrw) / prices[i];
    assert.ok(
      Math.abs(marginRates[i] - expectedRate) < 0.0001,
      `margin_rate for price ${prices[i]} must be ~${expectedRate.toFixed(4)}, got ${marginRates[i]}`
    );
  }

  // All 3 margin rates must be distinct (different prices → different margins)
  const uniqueRates = new Set(marginRates.map((r) => r.toFixed(6)));
  assert.strictEqual(
    uniqueRates.size,
    prices.length,
    `All ${prices.length} price overrides must produce distinct baseline margin rates`
  );
});

test('engine: different cost overrides produce distinct baseline margin rates with same price', async () => {
  // Use a fixed price so margin rate is purely driven by cost
  const fixedPriceKrw = 29900;
  const costs = [8000, 12000, 16000];

  const marginRates = await Promise.all(
    costs.map((costKrw) =>
      runSimulation({
        fixtureDir,
        modelMode: 'mock',
        iterationCount: 1,
        minimumMarginFloor: 0.10, // low floor so none violate
        samplerSeed: 11005,
        overrides: { priceKrw: fixedPriceKrw, costKrw },
      }).then((r) => r.baseline.margin_rate)
    )
  );

  // Verify each cost override produces the expected margin rate
  for (let i = 0; i < costs.length; i += 1) {
    const expectedRate = (fixedPriceKrw - costs[i]) / fixedPriceKrw;
    assert.ok(
      Math.abs(marginRates[i] - expectedRate) < 0.0001,
      `margin_rate for cost ${costs[i]} must be ~${expectedRate.toFixed(4)}, got ${marginRates[i]}`
    );
  }

  // All 3 margin rates must be distinct (different costs → different margins)
  const uniqueRates = new Set(marginRates.map((r) => r.toFixed(6)));
  assert.strictEqual(
    uniqueRates.size,
    costs.length,
    `All ${costs.length} cost overrides must produce distinct baseline margin rates`
  );
});
