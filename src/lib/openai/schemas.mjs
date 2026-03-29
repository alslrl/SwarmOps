export const STRATEGY_CANDIDATES_SCHEMA = {
  name: 'strategy_candidates',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['strategies'],
    properties: {
      strategies: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'top_copy', 'price_krw', 'rationale'],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            top_copy: { type: 'string' },
            price_krw: { type: 'number' },
            rationale: { type: 'string' }
          }
        }
      }
    }
  }
};

export const BUYER_EVALUATION_SCHEMA = {
  name: 'buyer_evaluation',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['archetype_id', 'evaluations'],
    properties: {
      archetype_id: { type: 'string' },
      evaluations: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['strategy_id', 'weights', 'summary'],
          properties: {
            strategy_id: { type: 'string' },
            weights: {
              type: 'object',
              additionalProperties: false,
              required: ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'],
              properties: {
                our_product: { type: 'number' },
                competitor_a: { type: 'number' },
                competitor_b: { type: 'number' },
                competitor_c: { type: 'number' },
                pass: { type: 'number' }
              }
            },
            summary: { type: 'string' }
          }
        }
      }
    }
  }
};

/**
 * JSON schema for individual agent evaluation response (gpt-5-nano per-agent call).
 * Each agent makes a single discrete choice given a strategy and competitor context.
 *
 * @typedef {Object} IndividualAgentEvaluation
 * @property {string} agent_id - Unique identifier for the buyer agent (e.g. "agent_001")
 * @property {string} chosen_product - Selected choice: one of our_product | competitor_a | competitor_b | competitor_c | pass
 * @property {string} reasoning - Brief explanation of the agent's decision in Korean
 */
export const INDIVIDUAL_AGENT_EVALUATION_SCHEMA = {
  name: 'individual_agent_evaluation',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['agent_id', 'chosen_product', 'reasoning'],
    properties: {
      agent_id: { type: 'string' },
      chosen_product: {
        type: 'string',
        enum: ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']
      },
      reasoning: { type: 'string' }
    }
  }
};

export const REALISM_JUDGE_SCHEMA = {
  name: 'merchant_realism_judge',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'score', 'issues', 'summary'],
    properties: {
      verdict: { type: 'string', enum: ['pass', 'fail'] },
      score: { type: 'number' },
      issues: {
        type: 'array',
        items: { type: 'string' }
      },
      summary: { type: 'string' }
    }
  }
};

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Validate and coerce a POST /api/run or POST /api/run/stream request body.
 *
 * All fields are optional. Numeric override fields are coerced to Number.
 * Throws if a field is present but has an invalid type or value.
 *
 * @param {unknown} body - Raw parsed JSON body from the HTTP request
 * @returns {{ iterationCount?: number, minimumMarginFloor?: number, overrides: { title?: string, topCopy?: string, priceKrw?: number, costKrw?: number } }}
 */
export function validateRunRequestBody(body) {
  invariant(body === null || typeof body === 'object', 'request body must be an object');
  const b = body ?? {};

  // iterationCount — optional positive integer
  if (b.iterationCount !== undefined) {
    const n = Number(b.iterationCount);
    invariant(Number.isFinite(n) && n > 0, 'iterationCount must be a positive number');
  }

  // minimumMarginFloor — optional fraction in [0, 1]
  if (b.minimumMarginFloor !== undefined) {
    const n = Number(b.minimumMarginFloor);
    invariant(Number.isFinite(n) && n >= 0 && n <= 1, 'minimumMarginFloor must be a number between 0 and 1');
  }

  // title — optional non-empty string
  if (b.title !== undefined) {
    invariant(typeof b.title === 'string' && b.title.trim().length > 0, 'title must be a non-empty string');
  }

  // topCopy — optional non-empty string
  if (b.topCopy !== undefined) {
    invariant(typeof b.topCopy === 'string' && b.topCopy.trim().length > 0, 'topCopy must be a non-empty string');
  }

  // priceKrw — optional positive KRW integer
  if (b.priceKrw !== undefined) {
    const n = Number(b.priceKrw);
    invariant(Number.isFinite(n) && n > 0 && Number.isInteger(n), 'priceKrw must be a positive integer (KRW)');
  }

  // costKrw — optional positive KRW integer
  if (b.costKrw !== undefined) {
    const n = Number(b.costKrw);
    invariant(Number.isFinite(n) && n > 0 && Number.isInteger(n), 'costKrw must be a positive integer (KRW)');
  }

  const overrides = {};
  if (b.title !== undefined) overrides.title = b.title;
  if (b.topCopy !== undefined) overrides.topCopy = b.topCopy;
  if (b.priceKrw !== undefined) overrides.priceKrw = Number(b.priceKrw);
  if (b.costKrw !== undefined) overrides.costKrw = Number(b.costKrw);

  const result = { overrides };
  if (b.iterationCount !== undefined) result.iterationCount = Number(b.iterationCount);
  if (b.minimumMarginFloor !== undefined) result.minimumMarginFloor = Number(b.minimumMarginFloor);

  return result;
}

export function assertStrategyCandidatesPayload(payload) {
  invariant(payload && typeof payload === 'object', 'strategy payload must be an object');
  invariant(Array.isArray(payload.strategies), 'strategy payload must contain strategies[]');
  invariant(payload.strategies.length === 3, 'strategy payload must contain exactly 3 strategies');
  for (const strategy of payload.strategies) {
    invariant(typeof strategy.id === 'string' && strategy.id.length > 0, 'strategy.id must be a non-empty string');
    invariant(typeof strategy.title === 'string' && strategy.title.length > 0, 'strategy.title must be a non-empty string');
    invariant(typeof strategy.top_copy === 'string' && strategy.top_copy.length > 0, 'strategy.top_copy must be a non-empty string');
    invariant(Number.isFinite(strategy.price_krw), 'strategy.price_krw must be numeric');
    invariant(typeof strategy.rationale === 'string' && strategy.rationale.length > 0, 'strategy.rationale must be a non-empty string');
  }
  return payload;
}

export function assertBuyerEvaluationPayload(payload) {
  invariant(payload && typeof payload === 'object', 'buyer evaluation payload must be an object');
  invariant(typeof payload.archetype_id === 'string' && payload.archetype_id.length > 0, 'buyer evaluation must include archetype_id');
  invariant(Array.isArray(payload.evaluations) && payload.evaluations.length > 0, 'buyer evaluation must include evaluations[]');
  for (const evaluation of payload.evaluations) {
    invariant(typeof evaluation.strategy_id === 'string' && evaluation.strategy_id.length > 0, 'evaluation.strategy_id must be a non-empty string');
    const weights = evaluation.weights ?? {};
    for (const key of ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']) {
      invariant(Number.isFinite(weights[key]), `evaluation.weights.${key} must be numeric`);
    }
  }
  return payload;
}

export function assertRealismJudgePayload(payload) {
  invariant(payload && typeof payload === 'object', 'realism judge payload must be an object');
  invariant(payload.verdict === 'pass' || payload.verdict === 'fail', 'realism judge verdict must be pass or fail');
  invariant(Number.isFinite(payload.score), 'realism judge score must be numeric');
  invariant(Array.isArray(payload.issues), 'realism judge issues must be an array');
  invariant(typeof payload.summary === 'string', 'realism judge summary must be a string');
  return payload;
}

const VALID_PRODUCT_CHOICES = new Set(['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']);

/**
 * Validate an individual agent evaluation response.
 *
 * @param {unknown} payload
 * @returns {IndividualAgentEvaluation}
 */
export function assertIndividualAgentEvaluationPayload(payload) {
  invariant(payload && typeof payload === 'object', 'individual agent evaluation payload must be an object');
  invariant(typeof payload.agent_id === 'string' && payload.agent_id.length > 0, 'individual agent evaluation must include a non-empty agent_id');
  invariant(
    VALID_PRODUCT_CHOICES.has(payload.chosen_product),
    `individual agent evaluation chosen_product must be one of: ${[...VALID_PRODUCT_CHOICES].join(', ')}`
  );
  invariant(typeof payload.reasoning === 'string' && payload.reasoning.length > 0, 'individual agent evaluation must include a non-empty reasoning string');
  return payload;
}
