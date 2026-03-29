/**
 * agentSimulation.mjs
 *
 * Per-agent simulation engine — runs N independent buyer agents against a
 * single candidate strategy and aggregates results.
 *
 * Design principles:
 *  - No SSE or HTTP concerns (fully unit-testable in isolation)
 *  - All monetary values in KRW integer format
 *  - Max concurrency ≥ 200 (matching PRD §8 constraint)
 *  - Deterministic in mock mode (agent_id → same choice every run)
 *  - Compatible with Gen 1 batch endpoint — does NOT modify engine.mjs
 *
 * Public API:
 *  runAgentBatch()      — evaluate pre-spawned agents against one strategy
 *  runAgentSimulation() — spawn + evaluate in one call (convenience wrapper)
 */

import pLimit from 'p-limit';
import { spawnAgentCohort } from './simulation/buyerAgent.mjs';
import { evaluateIndividualAgent } from './simulation/evaluator-nano.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All valid product choice keys, in canonical order. */
const CHOICE_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];

/** Default maximum concurrency for LLM calls (PRD §8: must be ≥ 200). */
const DEFAULT_MAX_CONCURRENCY = 200;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run async tasks over `items` with bounded concurrency.
 * Uses p-limit for clean, well-tested concurrency semantics.
 * Results array preserves input order.
 *
 * @template T, R
 * @param {T[]} items - Array of items to process
 * @param {number} concurrency - Maximum concurrent tasks (≥ 1)
 * @param {(item: T, index: number) => Promise<R>} mapper - Async mapper function
 * @returns {Promise<R[]>} Results in same order as items
 */
async function mapLimit(items, concurrency, mapper) {
  const limit = pLimit(Math.max(1, concurrency));
  return Promise.all(items.map((item, index) => limit(() => mapper(item, index))));
}

/**
 * Build a zeroed choice-count map for all five product keys.
 * @returns {{ our_product: number, competitor_a: number, competitor_b: number, competitor_c: number, pass: number }}
 */
function emptyChoiceMap() {
  return Object.fromEntries(CHOICE_KEYS.map((k) => [k, 0]));
}

// ---------------------------------------------------------------------------
// Exported types (JSDoc only)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AgentDecision
 * @property {string} agentId          - Unique agent identifier (e.g. "price_sensitive_0001")
 * @property {string} archetype        - Archetype id this agent belongs to
 * @property {string} choice           - Chosen product key: one of CHOICE_KEYS
 * @property {number} price_sensitivity - Agent's price sensitivity score [1–5]
 */

/**
 * @typedef {Object} AgentBatchResult
 * @property {AgentDecision[]} agentDecisions   - Per-agent decision payloads (length === agents.length)
 * @property {{ our_product: number, competitor_a: number, competitor_b: number, competitor_c: number, pass: number }} choice_summary
 *   Aggregated choice counts across all agents
 * @property {Object.<string, { our_product: number, competitor_a: number, competitor_b: number, competitor_c: number, pass: number }>} archetype_breakdown
 *   Per-archetype choice counts
 */

// ---------------------------------------------------------------------------
// runAgentBatch — core evaluation function
// ---------------------------------------------------------------------------

/**
 * Evaluate a list of pre-spawned buyer agents against a single candidate
 * strategy and aggregate their choices.
 *
 * Each agent makes an independent decision via `evaluateIndividualAgent`
 * (gpt-5-nano in live mode, deterministic heuristic in mock mode).
 *
 * This function is the primary building block of the simulation pipeline.
 * It is intentionally decoupled from SSE, HTTP, and the engine orchestrator
 * so it can be unit-tested in complete isolation.
 *
 * @param {Object} options
 * @param {Array<import('./simulation/buyerAgent.mjs').BuyerAgent>} options.agents
 *   Pre-spawned buyer agent cohort (from spawnAgentCohort)
 * @param {Array<Object>} options.archetypes
 *   Archetype definitions from the persona fixture (used to look up per-agent
 *   archetype context for the LLM prompt)
 * @param {Object} options.strategy
 *   Candidate strategy to evaluate (represents "our_product" in agent prompts)
 *   Shape: { id, title, top_copy, price_krw, rationale }
 * @param {Object} options.competitors
 *   Competitors bundle: { competitors: [{product_id, brand_name, price_krw, positioning}] }
 * @param {Object} options.ourProduct
 *   Our product fixture data (for positioning context)
 * @param {Object} options.runConfig
 *   Run configuration (model names, etc.)
 * @param {Object} options.client
 *   OpenAIClient instance (mode: 'live' | 'mock')
 * @param {number} [options.maxConcurrency=200]
 *   Maximum concurrent LLM calls; clamped to at least 200 per PRD §8
 * @returns {Promise<AgentBatchResult>}
 */
export async function runAgentBatch({
  agents,
  archetypes,
  strategy,
  competitors,
  ourProduct,
  runConfig,
  client,
  maxConcurrency = DEFAULT_MAX_CONCURRENCY,
}) {
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error('[agentSimulation.runAgentBatch] agents must be a non-empty array');
  }
  if (!Array.isArray(archetypes) || archetypes.length === 0) {
    throw new Error('[agentSimulation.runAgentBatch] archetypes must be a non-empty array');
  }
  if (!strategy || typeof strategy !== 'object') {
    throw new Error('[agentSimulation.runAgentBatch] strategy must be a non-null object');
  }

  // O(1) archetype lookup by id
  const archetypeById = Object.fromEntries(archetypes.map((a) => [a.id, a]));

  // Enforce minimum concurrency per PRD §8
  const concurrency = Math.max(DEFAULT_MAX_CONCURRENCY, Number(maxConcurrency) || DEFAULT_MAX_CONCURRENCY);

  // Run all agents concurrently with bounded parallelism
  const rawResults = await mapLimit(
    agents,
    concurrency,
    (agent) => evaluateIndividualAgent({
      agent_id: agent.agent_id,
      archetype: archetypeById[agent.archetype_id] ?? { id: agent.archetype_id },
      strategy,
      competitors,
      ourProduct,
      runConfig,
      client,
    })
  );

  // ---------------------------------------------------------------------------
  // Aggregate results
  // ---------------------------------------------------------------------------

  const choice_summary = emptyChoiceMap();
  const archetype_breakdown = {};

  // Pre-initialise archetype entries so counts are correct even if an archetype
  // contributes zero choices for a particular product key.
  for (const agent of agents) {
    if (!archetype_breakdown[agent.archetype_id]) {
      archetype_breakdown[agent.archetype_id] = emptyChoiceMap();
    }
  }

  const agentDecisions = rawResults.map((result, idx) => {
    const agent = agents[idx];
    const choice = result.chosen_product;

    // Guard against invalid choice keys (shouldn't happen but be defensive)
    const safeChoice = CHOICE_KEYS.includes(choice) ? choice : 'pass';

    // Accumulate choice_summary
    choice_summary[safeChoice] += 1;

    // Accumulate archetype_breakdown
    if (archetype_breakdown[agent.archetype_id]) {
      archetype_breakdown[agent.archetype_id][safeChoice] += 1;
    }

    /** @type {AgentDecision} */
    return {
      agentId: agent.agent_id,
      archetype: agent.archetype_id,
      choice: safeChoice,
      price_sensitivity: agent.price_sensitivity,
    };
  });

  return { agentDecisions, choice_summary, archetype_breakdown };
}

// ---------------------------------------------------------------------------
// runAgentSimulation — convenience wrapper (spawn + evaluate)
// ---------------------------------------------------------------------------

/**
 * Spawn a buyer-agent cohort and immediately evaluate it against one strategy.
 *
 * This is the primary entry-point for callers that do not need fine-grained
 * control over cohort construction.  For multi-strategy comparisons or SSE
 * streaming, use `runAgentBatch` directly with a shared `agents` array.
 *
 * @param {Object} options
 * @param {Array<Object>} options.archetypes
 *   Archetype definitions from the persona fixture
 * @param {Object} options.strategy
 *   Candidate strategy to evaluate
 * @param {Object} options.competitors
 *   Competitors bundle
 * @param {Object} options.ourProduct
 *   Our product fixture data
 * @param {Object} options.runConfig
 *   Run configuration
 * @param {Object} options.client
 *   OpenAIClient instance
 * @param {number} [options.totalBuyers=800]
 *   Total agent count; defaults to the standard simulation size
 * @param {number} [options.seed=42]
 *   RNG seed for deterministic cohort generation
 * @param {number} [options.maxConcurrency=200]
 *   Maximum concurrent LLM calls
 * @returns {Promise<{ agents: Array<Object> } & AgentBatchResult>}
 *   agents: the spawned cohort (useful for SSE streaming downstream)
 *   agentDecisions, choice_summary, archetype_breakdown: aggregated results
 */
export async function runAgentSimulation({
  archetypes,
  strategy,
  competitors,
  ourProduct,
  runConfig,
  client,
  totalBuyers = 800,
  seed = 42,
  maxConcurrency = DEFAULT_MAX_CONCURRENCY,
}) {
  if (!Array.isArray(archetypes) || archetypes.length === 0) {
    throw new Error('[agentSimulation.runAgentSimulation] archetypes must be a non-empty array');
  }

  // Spawn the cohort deterministically
  const agents = spawnAgentCohort({ archetypes, totalBuyers, seed });

  // Evaluate and aggregate
  const { agentDecisions, choice_summary, archetype_breakdown } = await runAgentBatch({
    agents,
    archetypes,
    strategy,
    competitors,
    ourProduct,
    runConfig,
    client,
    maxConcurrency,
  });

  return { agents, agentDecisions, choice_summary, archetype_breakdown };
}
