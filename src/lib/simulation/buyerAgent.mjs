/**
 * buyerAgent.mjs
 *
 * BuyerAgent data model for individual-agent simulation.
 *
 * Each of the 800 train-cohort buyers (and 200 holdout) is represented as a
 * BuyerAgent — a discrete entity with its own sampled trait values that will
 * make an independent gpt-5-nano LLM call during simulation.
 *
 * Field definitions mirror the archetype schema in fixtures/buyer-personas.md,
 * extended with per-agent identity fields.
 */

import { mulberry32 } from './sampler.mjs';
import { buildCohortCounts } from './archetypes.mjs';
import { createKoreanNameGenerator, sensitivity_variation } from './agentUtils.mjs';

// ---------------------------------------------------------------------------
// JSON Schema (for structured-output validation / documentation)
// ---------------------------------------------------------------------------

/**
 * JSON Schema describing a single BuyerAgent object.
 * All monetary fields use KRW integer format.
 */
export const BUYER_AGENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'agent_id',
    'korean_name',
    'archetype_id',
    'budget_band',
    'price_sensitivity',
    'trust_sensitivity',
    'promo_affinity',
    'brand_bias',
    'pass_threshold',
    'copy_preference',
  ],
  properties: {
    /** Unique agent identifier: "{archetype_id}_{zero-padded-index}" e.g. "price_sensitive_0001" */
    agent_id: {
      type: 'string',
      pattern: '^[a-z_]+_\\d{4}$',
      description: 'Unique agent ID in format "{archetype_id}_{NNNN}"',
    },
    /** Korean display name sampled deterministically from a name pool */
    korean_name: {
      type: 'string',
      minLength: 2,
      maxLength: 10,
      description: 'Korean full name (성 + 이름) for display purposes',
    },
    /** Parent archetype identifier matching fixtures/buyer-personas.md archetype id */
    archetype_id: {
      type: 'string',
      enum: [
        'price_sensitive',
        'value_seeker',
        'premium_quality',
        'trust_first',
        'aesthetics_first',
        'desperate_hairloss',
        'promo_hunter',
        'gift_or_family_buyer',
      ],
      description: 'Archetype this agent was sampled from',
    },
    /** Budget band: low (< ~15,000 KRW), mid (15,000–30,000), high (> 30,000) */
    budget_band: {
      type: 'string',
      enum: ['low', 'mid', 'high'],
      description: 'Budget band inherited from archetype with possible per-agent override',
    },
    /**
     * How much the agent weighs price when evaluating choices.
     * 1 = price-insensitive, 5 = extremely price-sensitive.
     * Sampled from archetype base ± Gaussian noise clamped to [1, 5].
     */
    price_sensitivity: {
      type: 'number',
      minimum: 1,
      maximum: 5,
      description: 'Price sensitivity on a 1–5 scale',
    },
    /**
     * How much the agent values trust signals (reviews, certifications, brand).
     * 1 = skeptical/indifferent, 5 = heavily trust-driven.
     */
    trust_sensitivity: {
      type: 'number',
      minimum: 1,
      maximum: 5,
      description: 'Trust sensitivity on a 1–5 scale',
    },
    /**
     * How much the agent responds to promotions (discounts, coupons, bundles).
     * 1 = ignores promos, 5 = heavily promo-driven.
     */
    promo_affinity: {
      type: 'number',
      minimum: 1,
      maximum: 5,
      description: 'Promo/discount affinity on a 1–5 scale',
    },
    /**
     * How much the agent is influenced by brand recognition.
     * 1 = brand-agnostic, 5 = strong brand preference.
     */
    brand_bias: {
      type: 'number',
      minimum: 1,
      maximum: 5,
      description: 'Brand bias on a 1–5 scale',
    },
    /**
     * Minimum utility score (0–1) required before the agent will purchase
     * any product instead of choosing "pass".
     * Higher values mean harder to convert.
     */
    pass_threshold: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Minimum utility needed to avoid pass; higher = harder to convert',
    },
    /** Archetype-level copy preference phrase (Korean), guides LLM prompt context */
    copy_preference: {
      type: 'string',
      minLength: 1,
      description: 'Korean short phrase describing what copy style resonates with this agent',
    },
  },
};

// ---------------------------------------------------------------------------
// Korean name generation
// ---------------------------------------------------------------------------
// Names are generated via createKoreanNameGenerator from agentUtils.mjs, which
// Fisher-Yates shuffles the full 1200-name pool (30 surnames × 40 given names)
// and advances a cursor on each call. The first 1200 calls are guaranteed unique,
// covering the 800-agent train cohort and 200-agent holdout cohort with room to spare.

// ---------------------------------------------------------------------------
// Trait sampling helpers
// ---------------------------------------------------------------------------

// sensitivity_variation (imported from agentUtils.mjs) applies ±10% uniform
// multiplicative variation to a base sensitivity value, then clamps to [1, 5]
// and rounds to 1 decimal place. This matches the ontology
// buyer_agent.sensitivity_profile specification exactly.
// Usage: sensitivity_variation(base, rng) → number in [1, 5]

/**
 * Apply ±10% uniform random variation to a pass_threshold value.
 * Clamped to [0, 1], rounded to 3 decimal places.
 *
 * Mirrors the varyPassThreshold logic in agent-spawner.mjs so both spawners
 * use the same ±10% multiplicative noise contract.
 *
 * @param {number} base - Archetype base pass_threshold (0–1)
 * @param {() => number} rng - RNG function returning a value in [0, 1)
 * @returns {number} Varied pass_threshold in [0, 1]
 */
function samplePassThreshold(base, rng) {
  const factor = rng() * 0.2 - 0.1; // uniform [-0.10, +0.10)
  const varied = base * (1 + factor);
  return Math.min(1, Math.max(0, Math.round(varied * 1000) / 1000));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Invariant helper — throws with descriptive message on violation.
 * @param {boolean} condition
 * @param {string} message
 */
function invariant(condition, message) {
  if (!condition) throw new Error(`[BuyerAgent] ${message}`);
}

/**
 * Validate a BuyerAgent object against the schema constraints.
 * Throws an Error if any field is invalid.
 *
 * @param {object} agent - The agent object to validate
 * @returns {object} The same agent (pass-through for chaining)
 */
export function assertBuyerAgent(agent) {
  invariant(agent && typeof agent === 'object', 'agent must be a non-null object');

  // agent_id
  invariant(typeof agent.agent_id === 'string' && agent.agent_id.length > 0, 'agent_id must be a non-empty string');
  invariant(/^[a-z_]+_\d{4}$/.test(agent.agent_id), `agent_id "${agent.agent_id}" must match pattern {archetype_id}_{NNNN}`);

  // korean_name
  invariant(typeof agent.korean_name === 'string' && agent.korean_name.length >= 2 && agent.korean_name.length <= 10,
    `korean_name "${agent.korean_name}" must be 2–10 characters`);

  // archetype_id
  const validArchetypes = [
    'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
    'aesthetics_first', 'urgency_buyer', 'desperate_hairloss', 'promo_hunter', 'gift_or_family_buyer',
  ];
  invariant(validArchetypes.includes(agent.archetype_id),
    `archetype_id "${agent.archetype_id}" must be one of: ${validArchetypes.join(', ')}`);

  // budget_band
  invariant(['low', 'mid', 'high'].includes(agent.budget_band),
    `budget_band "${agent.budget_band}" must be low | mid | high`);

  // numeric traits [1, 5]
  for (const field of ['price_sensitivity', 'trust_sensitivity', 'promo_affinity', 'brand_bias']) {
    invariant(typeof agent[field] === 'number' && Number.isFinite(agent[field]),
      `${field} must be a finite number`);
    invariant(agent[field] >= 1 && agent[field] <= 5,
      `${field} value ${agent[field]} must be in range [1, 5]`);
  }

  // pass_threshold [0, 1]
  invariant(typeof agent.pass_threshold === 'number' && Number.isFinite(agent.pass_threshold),
    'pass_threshold must be a finite number');
  invariant(agent.pass_threshold >= 0 && agent.pass_threshold <= 1,
    `pass_threshold ${agent.pass_threshold} must be in range [0, 1]`);

  // copy_preference
  invariant(typeof agent.copy_preference === 'string' && agent.copy_preference.length > 0,
    'copy_preference must be a non-empty string');

  return agent;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a single validated BuyerAgent from explicit field values.
 * All numeric traits are clamped and rounded on creation.
 *
 * @param {object} fields
 * @param {string} fields.agent_id
 * @param {string} fields.korean_name
 * @param {string} fields.archetype_id
 * @param {string} fields.budget_band
 * @param {number} fields.price_sensitivity - 1–5
 * @param {number} fields.trust_sensitivity - 1–5
 * @param {number} fields.promo_affinity - 1–5
 * @param {number} fields.brand_bias - 1–5
 * @param {number} fields.pass_threshold - 0–1
 * @param {string} fields.copy_preference
 * @returns {object} Validated BuyerAgent
 */
export function createBuyerAgent({
  agent_id,
  korean_name,
  archetype_id,
  budget_band,
  price_sensitivity,
  trust_sensitivity,
  promo_affinity,
  brand_bias,
  pass_threshold,
  copy_preference,
}) {
  const agent = {
    agent_id,
    korean_name,
    archetype_id,
    budget_band,
    price_sensitivity: Math.min(5, Math.max(1, Math.round(price_sensitivity * 10) / 10)),
    trust_sensitivity: Math.min(5, Math.max(1, Math.round(trust_sensitivity * 10) / 10)),
    promo_affinity: Math.min(5, Math.max(1, Math.round(promo_affinity * 10) / 10)),
    brand_bias: Math.min(5, Math.max(1, Math.round(brand_bias * 10) / 10)),
    pass_threshold: Math.min(1, Math.max(0, Math.round(pass_threshold * 1000) / 1000)),
    copy_preference,
  };
  return assertBuyerAgent(agent);
}

// ---------------------------------------------------------------------------
// Cohort spawner — generates the full 800-agent (or N-agent) cohort
// ---------------------------------------------------------------------------

/**
 * Spawn a full buyer-agent cohort from archetype definitions.
 *
 * Each archetype contributes `count` agents (derived from cohort_weight_percent).
 * Per-agent trait values are the archetype base ± 10% multiplicative variation
 * (via sensitivity_variation from agentUtils.mjs), matching the ontology
 * buyer_agent.sensitivity_profile specification. No two agents share identical
 * sensitivity profiles (enforced by rejection sampling).
 *
 * @param {object} options
 * @param {Array<object>} options.archetypes - Parsed archetype objects from fixture
 * @param {number} options.totalBuyers - Total agent count (default 800)
 * @param {number} options.seed - RNG seed for deterministic generation
 * @returns {Array<object>} Array of validated BuyerAgent objects, length === totalBuyers
 */
export function spawnAgentCohort({ archetypes, totalBuyers = 800, seed = 42 }) {
  invariant(Array.isArray(archetypes) && archetypes.length > 0, 'archetypes must be a non-empty array');
  invariant(Number.isInteger(totalBuyers) && totalBuyers > 0, 'totalBuyers must be a positive integer');
  invariant(Number.isInteger(seed), 'seed must be an integer');

  // Compute proportional counts using largest-remainder method so they sum exactly to totalBuyers
  const counts = buildCohortCounts(archetypes, totalBuyers);

  // Use agentUtils.mjs name generator — Fisher-Yates shuffled pool of 1200 unique
  // Korean names (30 surnames × 40 given names). Separate from trait RNG so that
  // name generation does not consume from the trait RNG stream.
  const nameGen = createKoreanNameGenerator(seed);

  // Trait RNG: derive a well-separated seed using Knuth's multiplicative hash so
  // that the trait stream is uncorrelated with the name generator's internal RNG,
  // even when both start from the same user-supplied seed. This prevents accidental
  // profile collisions that can arise when two independent Mulberry32 streams start
  // from nearby seed values.
  const traitSeed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0;
  const rng = mulberry32(traitSeed);

  // profilesSeen tracks the 5-tuple (price_sensitivity, trust_sensitivity,
  // promo_affinity, brand_bias, pass_threshold) for every agent spawned so far.
  // Rejection sampling enforces uniqueness: on the rare occasion that the sampled
  // trait tuple collides with an existing profile, we resample until we get a fresh
  // combination. sensitivity_variation draws uniformly from [-10%, +10%), yielding
  // discrete values at 0.1 resolution across [1, 5]. With 4 sensitivity fields +
  // pass_threshold there are thousands of unique combinations per archetype, far
  // exceeding the largest cohort (144 agents). The 500-attempt guard prevents
  // infinite loops in degenerate edge cases.
  const profilesSeen = new Set();

  const agents = [];
  // Global running index for unique 4-digit suffix across all archetypes
  let globalIndex = 0;

  for (const { archetype, count } of counts) {
    for (let i = 0; i < count; i++) {
      globalIndex += 1;
      const paddedIndex = String(globalIndex).padStart(4, '0');

      // Rejection-sample trait tuples until a unique sensitivity profile is produced.
      // 500-attempt guard prevents infinite loops for hypothetical degenerate archetypes.
      // Per-agent sensitivity variation uses ±10% multiplicative noise (sensitivity_variation
      // from agentUtils.mjs), matching the ontology buyer_agent.sensitivity_profile spec.
      let traits;
      let profile;
      let attempts = 0;
      do {
        traits = {
          price_sensitivity: sensitivity_variation(archetype.price_sensitivity, rng),
          trust_sensitivity: sensitivity_variation(archetype.trust_sensitivity, rng),
          promo_affinity: sensitivity_variation(archetype.promo_affinity, rng),
          brand_bias: sensitivity_variation(archetype.brand_bias, rng),
          pass_threshold: samplePassThreshold(archetype.pass_threshold, rng),
        };
        profile = `${traits.price_sensitivity}|${traits.trust_sensitivity}|${traits.promo_affinity}|${traits.brand_bias}|${traits.pass_threshold}`;
        attempts += 1;
        invariant(
          attempts <= 500,
          `Cannot generate unique sensitivity profile for archetype "${archetype.id}" `
            + `after 500 attempts — profile space may be too small for required agent count.`,
        );
      } while (profilesSeen.has(profile));

      profilesSeen.add(profile);

      agents.push(createBuyerAgent({
        agent_id: `${archetype.id}_${paddedIndex}`,
        // Use createKoreanNameGenerator (agentUtils.mjs) for guaranteed-unique names
        korean_name: nameGen.next(),
        archetype_id: archetype.id,
        budget_band: archetype.budget_band,
        ...traits,
        copy_preference: archetype.copy_preference,
      }));
    }
  }

  // ── Assertion 1: total agent count must equal totalBuyers ──────────────────
  invariant(
    agents.length === totalBuyers,
    `Expected ${totalBuyers} agents but spawned ${agents.length}`,
  );

  // ── Assertion 2: per-archetype counts match weight distribution (±1 rounding) ─
  // buildCohortCounts uses the largest-remainder method so each archetype's count
  // is either Math.floor(weight%) or Math.ceil(weight%). We verify this invariant
  // holds for every archetype to catch weight-definition or rounding bugs.
  for (const { archetype, count: expectedCount } of counts) {
    const actualCount = agents.filter((ag) => ag.archetype_id === archetype.id).length;
    const exactFraction = (archetype.cohort_weight_percent / 100) * totalBuyers;
    const lowerBound = Math.floor(exactFraction);
    const upperBound = Math.ceil(exactFraction);
    invariant(
      actualCount >= lowerBound && actualCount <= upperBound,
      `Archetype "${archetype.id}": expected count in [${lowerBound}, ${upperBound}] `
        + `(${archetype.cohort_weight_percent}% of ${totalBuyers}), got ${actualCount}`,
    );
    invariant(
      actualCount === expectedCount,
      `Archetype "${archetype.id}": buildCohortCounts returned ${expectedCount} `
        + `but spawned ${actualCount}`,
    );
  }

  // ── Assertion 3: no two agents share identical sensitivity profiles ─────────
  // The rejection-sampling loop above structurally guarantees this. The post-hoc
  // check below confirms the invariant across the full cohort.
  invariant(
    profilesSeen.size === totalBuyers,
    `Expected ${totalBuyers} unique sensitivity profiles but got ${profilesSeen.size}`,
  );

  return agents;
}
