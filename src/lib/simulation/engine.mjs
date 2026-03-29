import path from 'node:path';
import pLimit from 'p-limit';
import { loadFixtureBundle } from '../fixtures.mjs';
import { loadLocalEnv, OpenAIClient } from '../openai/client.mjs';
import { generateCandidateStrategies } from './strategy-generator.mjs';
import { evaluateIndividualAgent } from './evaluator-nano.mjs';
import { buildScoredStrategy, compareStrategies, isMarginFloorSatisfied } from './scorer.mjs';
import { judgeMerchantRealism } from '../judges/merchant-realism.mjs';
import { evaluateHoldout } from './holdout.mjs';
import { buildDiff } from '../diff/build-diff.mjs';
import { writeLatestRunSummary } from '../reports/latest-run-summary.mjs';
import { spawnAgentCohort } from './buyerAgent.mjs';
import { ARCHETYPES } from './archetypes.mjs';

function buildBaseline(bundle, overrides = {}) {
  return {
    id: 'baseline',
    title: overrides.title ?? bundle.ourProduct.current_title,
    top_copy: overrides.topCopy ?? bundle.ourProduct.current_top_copy,
    price_krw: overrides.priceKrw ?? bundle.ourProduct.current_price_krw,
    rationale: 'Current product baseline',
  };
}

/**
 * Run `items` through `mapper` with at most `concurrency` tasks in flight at once.
 * Uses p-limit for clean, well-tested concurrency semantics.
 * Results array preserves input order.
 *
 * @param {Array} items
 * @param {number} concurrency - max parallel tasks (≥ 1)
 * @param {(item: any, index: number) => Promise<any>} mapper
 * @returns {Promise<Array>}
 */
async function mapLimit(items, concurrency, mapper) {
  const limit = pLimit(Math.max(1, concurrency));
  return Promise.all(items.map((item, index) => limit(() => mapper(item, index))));
}

/**
 * Evaluate a list of candidate strategies using individual-agent LLM calls.
 *
 * For each strategy, spawns `totalBuyers` buyer agents (via spawnAgentCohort) and
 * calls evaluateIndividualAgent for each agent concurrently.  The raw results array
 * is verified (exactly `totalBuyers` entries, each containing agent_id, chosen_product,
 * and reasoning), then aggregated directly into a sampledResults-compatible structure.
 *
 * This replaces the evaluateArchetypeBatch-based evaluateStrategies path and gives
 * true per-agent granularity for scoring — each buyer makes an independent decision
 * rather than being drawn from archetype-level weight distributions.
 *
 * @param {object} options
 * @param {Array<object>} options.strategies  - Candidate strategies to evaluate
 * @param {object}        options.bundle      - Loaded fixture bundle
 * @param {object}        options.client      - OpenAIClient instance
 * @param {number}        options.totalBuyers - Total agent count (typically 800)
 * @param {number}        options.seed        - RNG seed for deterministic cohort generation
 * @param {Array<object>} [options.archetypes] - Optional archetype overrides; defaults to canonical ARCHETYPES
 * @returns {Promise<{ sampledResults: Object, agentResultsByStrategy: Object, agents: Array }>}
 */
async function evaluateWithIndividualAgents({ strategies, bundle, client, totalBuyers, seed, archetypes: archetypesOverride }) {
  const effectiveArchetypes = archetypesOverride ?? ARCHETYPES;
  const archetypeById = Object.fromEntries(effectiveArchetypes.map((a) => [a.id, a]));
  const agents = spawnAgentCohort({
    archetypes: effectiveArchetypes,
    totalBuyers,
    seed,
  });
  // O(1) archetype lookup per agent result
  const agentArchetypeMap = new Map(agents.map((a) => [a.agent_id, a.archetype_id]));
  const concurrency = Math.max(200, Number(bundle.runConfig.max_concurrency ?? 200));

  const sampledResults = {};
  const agentResultsByStrategy = {};

  for (const strategy of strategies) {
    // Evaluate all agents for this strategy concurrently
    const agentResults = await mapLimit(
      agents,
      concurrency,
      (agent) => evaluateIndividualAgent({
        agent_id: agent.agent_id,
        archetype: archetypeById[agent.archetype_id],
        strategy,
        competitors: bundle.competitors,
        ourProduct: bundle.ourProduct,
        runConfig: bundle.runConfig,
        client,
      })
    );

    // ── Verification assertion ────────────────────────────────────────────────
    // The output must contain exactly totalBuyers entries; each entry must have
    // agent_id (string), chosen_product (string), and reasoning (string).
    if (agentResults.length !== totalBuyers) {
      throw new Error(
        `[evaluateWithIndividualAgents] Expected exactly ${totalBuyers} agent results ` +
        `for strategy "${strategy.id}", but got ${agentResults.length}.`
      );
    }
    for (let i = 0; i < agentResults.length; i += 1) {
      const r = agentResults[i];
      if (
        !r ||
        typeof r.agent_id !== 'string' ||
        typeof r.chosen_product !== 'string' ||
        typeof r.reasoning !== 'string'
      ) {
        throw new Error(
          `[evaluateWithIndividualAgents] Agent result at index ${i} for strategy "${strategy.id}" ` +
          `is missing required fields (agent_id, chosen_product, reasoning). ` +
          `Got: ${JSON.stringify(r)}`
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Aggregate individual choices into sampledResults structure
    const choices = { our_product: 0, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 };
    const archetypeBreakdown = {};

    // Pre-initialise breakdown entries so count totals are correct even if an
    // archetype produces zero "our_product" selections.
    for (const agent of agents) {
      if (!archetypeBreakdown[agent.archetype_id]) {
        archetypeBreakdown[agent.archetype_id] = {
          archetype_id: agent.archetype_id,
          count: 0,
          choices: { our_product: 0, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 },
        };
      }
      archetypeBreakdown[agent.archetype_id].count += 1;
    }

    for (const result of agentResults) {
      const chosenProduct = result.chosen_product;
      choices[chosenProduct] = (choices[chosenProduct] || 0) + 1;
      const archetypeId = agentArchetypeMap.get(result.agent_id);
      if (archetypeId && archetypeBreakdown[archetypeId]) {
        archetypeBreakdown[archetypeId].choices[chosenProduct] =
          (archetypeBreakdown[archetypeId].choices[chosenProduct] || 0) + 1;
      }
    }

    sampledResults[strategy.id] = {
      strategy_id: strategy.id,
      total_buyers: totalBuyers,
      choices,
      archetype_breakdown: archetypeBreakdown,
    };

    agentResultsByStrategy[strategy.id] = agentResults;
  }

  return { sampledResults, agentResultsByStrategy, agents };
}

/**
 * Simulation event callback interface.
 *
 * The onEvent callback is called at key points during simulation execution.
 * Each call receives a typed event object. The callback may be async.
 *
 * Event sequence per iteration:
 *   iteration_start → agent_decision (×800) → iteration_complete
 *
 * After all iterations:
 *   holdout_start → simulation_complete
 *
 * Note: archetype_evaluated has been removed and superseded by agent_decision.
 *       See src/lib/simulation/sse-events.d.ts for full TypeScript types.
 *
 * @typedef {Object} IterationStartEvent
 * @property {'iteration_start'} type
 * @property {number} iteration - Current iteration number (1-based)
 * @property {number} total - Total iteration count
 * @property {Array<{id: string, title: string, price_krw: number}>} candidates - Candidate strategy summaries
 *
 * @typedef {Object} AgentDecisionEvent
 * @property {'agent_decision'} type
 * @property {number} iteration - Current iteration number (1-based)
 * @property {string} agent_id - Unique identifier for this agent instance (e.g. "agent_0042")
 * @property {string} agent_name - Korean display name for the agent (e.g. "구매자 #42")
 * @property {string} archetype_id - Archetype identifier this agent belongs to (e.g. "price_sensitive")
 * @property {'our_product'|'competitor_a'|'competitor_b'|'competitor_c'|'pass'} chosen_product - The product the agent chose
 * @property {string} reasoning - LLM reasoning text for the choice
 * @property {number} agent_index - 0-based index of this agent within the iteration (0–799)
 * @property {number} agent_total - Total number of agents in this iteration (typically 800)
 *
 * @typedef {Object} IterationCompleteEvent
 * @property {'iteration_complete'} type
 * @property {number} iteration - Current iteration number (1-based)
 * @property {string} winner_id - ID of the winning strategy
 * @property {number} winner_revenue - Simulated revenue of the winner (KRW integer)
 * @property {boolean} accepted - Whether the winner passed all acceptance gates
 * @property {number} rejected_count - Number of rejected candidates in this iteration
 * @property {{our_product: number, competitor_a: number, competitor_b: number, competitor_c: number, pass: number}} choice_summary - Aggregated choice counts across all agents for the winning strategy
 * @property {Object.<string, {our_product: number, competitor_a: number, competitor_b: number, competitor_c: number, pass: number}>} archetype_breakdown - Per-archetype breakdown of agent choices for the winning strategy
 *
 * @typedef {Object} HoldoutStartEvent
 * @property {'holdout_start'} type
 * @property {string} message - Human-readable status message
 *
 * @typedef {Object} SimulationCompleteEvent
 * @property {'simulation_complete'} type
 * @property {Object} baseline - Scored baseline strategy
 * @property {Object} selected_strategy - Final selected strategy
 * @property {Object} holdout - Holdout evaluation result containing holdout_uplift
 * @property {Object} diff - Diff object with title, top_copy, price fields
 * @property {Object} artifact - Written artifact metadata
 *
 * @typedef {IterationStartEvent | AgentDecisionEvent | IterationCompleteEvent | HoldoutStartEvent | SimulationCompleteEvent} SimulationEvent
 *
 * @callback OnEventCallback
 * @param {SimulationEvent} event
 * @returns {void | Promise<void>}
 */

/**
 * Build a modified archetypes array with cohort_weight_percent derived from
 * user-supplied absolute counts.  The counts must sum to totalBuyers (800).
 *
 * @param {Record<string,number>} archetypeCounts  - Map of archetype_id → agent count
 * @param {number}               totalBuyers       - Expected total (800)
 * @returns {Array<object>} Modified archetype objects with updated cohort_weight_percent
 */
function buildArchetypesFromCounts(archetypeCounts, totalBuyers) {
  return ARCHETYPES.map((arch) => {
    const count = archetypeCounts[arch.id];
    if (count == null) return arch;
    // Convert count → percentage so buildCohortCounts produces the exact count.
    // e.g. 144 / 800 * 100 = 18  (integer-safe for counts that divide evenly)
    const cohort_weight_percent = (count / totalBuyers) * 100;
    return { ...arch, cohort_weight_percent };
  });
}

export async function runSimulation({ fixtureDir, iterationCount, minimumMarginFloor, samplerSeed, modelMode, overrides = {}, archetypeCounts, onEvent } = {}) {
  await loadLocalEnv();
  const bundle = await loadFixtureBundle(fixtureDir);
  const client = new OpenAIClient({ mode: modelMode ?? process.env.SELLER_WAR_GAME_MODEL_MODE ?? 'live' });
  const configIterationCount = Number(iterationCount ?? bundle.runConfig.default_iteration_count);
  const marginFloor = Number(minimumMarginFloor ?? bundle.runConfig.default_minimum_margin_floor);
  const baseSeed = Number(samplerSeed ?? bundle.runConfig.sampler_seed);
  const effectiveCostKrw = overrides.costKrw ?? bundle.ourProduct.current_cost_krw;
  const baseline = buildBaseline(bundle, overrides);

  // Build effective archetypes — use user-supplied counts if provided, else canonical defaults
  const trainBuyers = Number(bundle.runConfig.train_buyers);
  const effectiveArchetypes = (archetypeCounts && Object.keys(archetypeCounts).length > 0)
    ? buildArchetypesFromCounts(archetypeCounts, trainBuyers)
    : ARCHETYPES;

  const baselineEval = await evaluateWithIndividualAgents({
    strategies: [baseline],
    bundle,
    client,
    totalBuyers: trainBuyers,
    seed: baseSeed,
    archetypes: effectiveArchetypes,
  });

  const baselineScored = buildScoredStrategy({
    candidate: baseline,
    baseline,
    sampledResult: baselineEval.sampledResults.baseline,
    cost: effectiveCostKrw,
    minimumMarginFloor: marginFloor,
  });

  let currentStrategy = baseline;
  const iterations = [];
  for (let iteration = 1; iteration <= configIterationCount; iteration += 1) {
    const candidates = await generateCandidateStrategies({
      currentStrategy,
      ourProduct: bundle.ourProduct,
      competitors: bundle.competitors,
      runConfig: bundle.runConfig,
      iteration,
      client,
    });

    // Emit iteration_start before evaluation begins
    if (onEvent) {
      // Derive top-level strategy_reasoning from candidate rationales (joined, 1-2 sentences)
      const strategy_reasoning = candidates
        .map((c) => c.rationale)
        .filter(Boolean)
        .slice(0, 2)
        .join(' / ') || undefined;
      await onEvent({
        type: 'iteration_start',
        iteration,
        total: configIterationCount,
        candidates: candidates.map((c) => ({
          id: c.id,
          title: c.title,
          price_krw: c.price_krw,
          rationale: c.rationale ?? '',
        })),
        strategy_reasoning,
      });
    }

    const evaluated = await evaluateWithIndividualAgents({
      strategies: candidates,
      bundle,
      client,
      totalBuyers: trainBuyers,
      seed: baseSeed + iteration,
      archetypes: effectiveArchetypes,
    });

    const judged = [];
    for (const candidate of candidates) {
      const realism = await judgeMerchantRealism({ candidate, ourProduct: bundle.ourProduct, runConfig: bundle.runConfig, client });
      const sampled = evaluated.sampledResults[candidate.id];
      const scored = buildScoredStrategy({
        candidate,
        baseline,
        sampledResult: sampled,
        cost: effectiveCostKrw,
        minimumMarginFloor: marginFloor,
      });
      const accepted = isMarginFloorSatisfied(candidate.price_krw, effectiveCostKrw, marginFloor) && realism.verdict === 'pass';
      judged.push({
        ...scored,
        realism,
        accepted,
        rejection_reason: accepted ? null : (scored.margin_floor_violations ? 'below_margin_floor' : 'realism_judge_failed'),
      });
    }

    const acceptedStrategies = judged.filter((item) => item.accepted).sort(compareStrategies);
    const winner = acceptedStrategies[0] ?? judged.sort(compareStrategies)[0];

    // Emit agent_decision for each of the 800 buyer agents (one event per agent).
    // Results are reused from the evaluateWithIndividualAgents scoring run above —
    // no second LLM call is needed.  The winner's pre-computed agentResults are
    // emitted concurrently to preserve the visual streaming effect on the client.
    const iterationChoiceSummary = { our_product: 0, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 };
    const iterationArchetypeBreakdown = {};

    if (onEvent) {
      // The same agent cohort used for scoring (identical seed → identical agents)
      const iterationAgents = evaluated.agents;
      const winnerAgentResults = evaluated.agentResultsByStrategy[winner.id];
      const agentTotal = iterationAgents.length;
      const concurrency = Math.max(200, Number(bundle.runConfig.max_concurrency ?? 200));

      // Shuffle agents randomly so they don't stream archetype-by-archetype
      const shuffledIndices = Array.from({ length: iterationAgents.length }, (_, i) => i);
      for (let i = shuffledIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
      }

      // Emit agent_decision events SEQUENTIALLY with 15ms delay for real-time SSE streaming
      for (let seq = 0; seq < shuffledIndices.length; seq++) {
        const index = shuffledIndices[seq];
        const agent = iterationAgents[index];
        const result = winnerAgentResults[index];

        // Accumulate choice counts for iteration_complete summary
        iterationChoiceSummary[result.chosen_product] = (iterationChoiceSummary[result.chosen_product] || 0) + 1;
        if (!iterationArchetypeBreakdown[agent.archetype_id]) {
          iterationArchetypeBreakdown[agent.archetype_id] = { our_product: 0, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 };
        }
        iterationArchetypeBreakdown[agent.archetype_id][result.chosen_product] =
          (iterationArchetypeBreakdown[agent.archetype_id][result.chosen_product] || 0) + 1;

        await onEvent({
          type: 'agent_decision',
          iteration,
          agent_id: agent.agent_id,
          agent_name: agent.korean_name,
          archetype_id: agent.archetype_id,
          chosen_product: result.chosen_product,
          decision: result.chosen_product,
          reasoning: result.reasoning,
          score: typeof result.score === 'number' ? result.score : 0,
          agent_index: index,
          agent_total: agentTotal,
          price_sensitivity: agent.price_sensitivity ?? null,
          trust_sensitivity: agent.trust_sensitivity ?? null,
          promo_affinity: agent.promo_affinity ?? null,
          brand_bias: agent.brand_bias ?? null,
          pass_threshold: agent.pass_threshold ?? null,
          budget_band: agent.budget_band ?? null,
        });

        // 15ms 지연: SSE 이벤트가 개별 TCP 패킷으로 전송되어 실시간 파티클 렌더링 가능
        await new Promise(r => setTimeout(r, 15));
      }
    }

    // Emit iteration_complete after all agent decisions have been emitted
    if (onEvent) {
      await onEvent({
        type: 'iteration_complete',
        iteration,
        winner_id: winner.id,
        winner_revenue: winner.simulated_revenue,
        accepted: winner.accepted,
        rejected_count: judged.filter((item) => !item.accepted).length,
        choice_summary: iterationChoiceSummary,
        archetype_breakdown: iterationArchetypeBreakdown,
        // Sub-AC 3c: pass archetype definitions so the stream-formatter can build
        // explicit {count, pct} format and resolve archetype_label from id.
        archetypes: ARCHETYPES.map((a) => ({ id: a.id, label: a.label ?? a.id })),
      });
    }

    iterations.push({
      iteration,
      candidates: judged,
      winner_id: winner.id,
      winner_revenue: winner.simulated_revenue,
    });
    currentStrategy = winner;
  }

  // Emit holdout_start before holdout evaluation begins
  if (onEvent) {
    await onEvent({
      type: 'holdout_start',
      message: `Running holdout validation with ${bundle.runConfig.holdout_buyers} buyers...`,
    });
  }

  // For holdout, scale archetype counts proportionally to holdout_buyers size
  const holdoutBuyers = Number(bundle.runConfig.holdout_buyers);
  const holdoutArchetypes = (archetypeCounts && Object.keys(archetypeCounts).length > 0)
    ? buildArchetypesFromCounts(archetypeCounts, trainBuyers)
    : ARCHETYPES;

  const holdoutEval = await evaluateWithIndividualAgents({
    strategies: [baseline, currentStrategy],
    bundle,
    client,
    totalBuyers: holdoutBuyers,
    seed: baseSeed + 999,
    archetypes: holdoutArchetypes,
  });

  const holdoutBaseline = buildScoredStrategy({
    candidate: baseline,
    baseline,
    sampledResult: holdoutEval.sampledResults.baseline,
    cost: effectiveCostKrw,
    minimumMarginFloor: marginFloor,
  });

  const holdoutFinal = buildScoredStrategy({
    candidate: currentStrategy,
    baseline,
    sampledResult: holdoutEval.sampledResults[currentStrategy.id],
    cost: effectiveCostKrw,
    minimumMarginFloor: marginFloor,
  });

  const holdout = evaluateHoldout({
    baselineRevenue: holdoutBaseline.simulated_revenue,
    finalRevenue: holdoutFinal.simulated_revenue,
  });

  const result = {
    fixture_dir: fixtureDir,
    sampler_seed: baseSeed,
    iteration_count: configIterationCount,
    minimum_margin_floor: marginFloor,
    baseline: baselineScored,
    selected_strategy: currentStrategy,
    holdout,
    diff: buildDiff(baseline, currentStrategy),
    iterations,
    rejected_strategies: iterations.flatMap((entry) => entry.candidates.filter((candidate) => !candidate.accepted)),
  };

  const artifactsDir = path.resolve(path.dirname(bundle.rootDir), 'artifacts');
  const artifact = await writeLatestRunSummary({ outputDir: artifactsDir, result });
  const finalResult = { ...result, artifact };

  // Emit simulation_complete with the complete result payload
  if (onEvent) {
    await onEvent({
      type: 'simulation_complete',
      baseline: finalResult.baseline,
      selected_strategy: finalResult.selected_strategy,
      holdout: finalResult.holdout,
      diff: finalResult.diff,
      artifact: finalResult.artifact,
    });
  }

  return finalResult;
}
