import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUYER_EVALUATION_SCHEMA,
  assertBuyerEvaluationPayload,
  INDIVIDUAL_AGENT_EVALUATION_SCHEMA,
  assertIndividualAgentEvaluationPayload,
} from '../openai/schemas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.resolve(__dirname, '../prompts/buyer-evaluator.md');
const INDIVIDUAL_PROMPT_PATH = path.resolve(__dirname, '../prompts/buyer-agent-individual.md');

/**
 * Product choice labels in the order they appear in weights.
 * Used by both batch heuristic and individual mock mode.
 */
const PRODUCT_CHOICES = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];

/**
 * Fast, seedable pseudo-random number generator (mulberry32).
 * Used for deterministic per-agent mock responses.
 *
 * @param {number} seed - 32-bit unsigned integer seed
 * @returns {() => number} PRNG that returns [0, 1) floats
 */
function makeAgentRng(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a deterministic 32-bit seed from an agent_id string.
 * Uses a simple djb2-style hash so identical agent_ids always
 * produce the same random sequence.
 *
 * @param {string} agentId
 * @returns {number}
 */
function seedFromAgentId(agentId) {
  let hash = 5381;
  for (let i = 0; i < agentId.length; i += 1) {
    hash = ((hash << 5) + hash + agentId.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Sample a discrete choice from an array of non-negative weights using RNG.
 *
 * @param {number[]} weights - Parallel array of non-negative weights
 * @param {() => number} rng - PRNG returning [0, 1)
 * @param {string[]} labels - Parallel label array (same length as weights)
 * @returns {string} The chosen label
 */
function sampleWeightedChoice(weights, rng, labels) {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) return labels[labels.length - 1];
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= Math.max(0, weights[i]);
    if (roll <= 0) return labels[i];
  }
  return labels[labels.length - 1];
}

/**
 * Korean reasoning templates for mock mode, keyed by archetype id.
 * These are short, realistic-sounding justifications used in mock/test runs.
 */
const MOCK_REASONING_TEMPLATES = {
  price_sensitive: [
    '가격이 가장 저렴한 옵션을 선택했습니다.',
    '비용 대비 효율을 최우선으로 고려한 결과입니다.',
    '할인 혜택이 있는 제품을 선호합니다.',
  ],
  value_seeker: [
    '가격과 품질의 균형이 좋아 보이는 제품을 골랐습니다.',
    '성능 대비 가격이 합리적인 옵션입니다.',
    '가성비가 뛰어난 제품을 선택했습니다.',
  ],
  premium_quality: [
    '프리미엄 성분과 전문적인 포지셔닝이 마음에 들었습니다.',
    '고급스러운 이미지와 품질을 중시해 선택했습니다.',
    '전문가 브랜드의 차별화된 제품을 선호합니다.',
  ],
  trust_first: [
    '과학적 근거와 신뢰할 수 있는 브랜드를 선택했습니다.',
    '전문가 추천과 성분 신뢰도를 우선 고려했습니다.',
    '검증된 제품을 중시해 선택했습니다.',
  ],
  aesthetics_first: [
    '깔끔하고 세련된 브랜드 이미지가 매력적입니다.',
    '감성적인 디자인과 톤이 마음에 들었습니다.',
    '브랜드 심미성을 중요하게 생각해 선택했습니다.',
  ],
  urgency_buyer: [
    '빠르게 효과를 볼 수 있다는 확신을 주는 제품입니다.',
    '문제 해결에 즉각적인 도움이 될 것 같아 선택했습니다.',
    '빠른 효과와 신뢰성을 동시에 갖춘 제품입니다.',
  ],
  desperate_hairloss: [
    '탈모가 심해서 효과 있다는 제품이면 일단 사봐야 합니다.',
    '성분과 후기를 꼼꼼히 봤을 때 가장 믿을 수 있는 제품입니다.',
    '탈모 고민이 간절해서 전문성 있는 브랜드를 선택했습니다.',
  ],
  promo_hunter: [
    '할인과 혜택이 가장 많은 제품을 선택했습니다.',
    '프로모션 가격이 매력적이어서 구매를 결정했습니다.',
    '지금 구매해야 하는 이유가 충분한 옵션입니다.',
  ],
  gift_or_family_buyer: [
    '가족에게 선물하기에 안전하고 믿을 수 있는 제품입니다.',
    '전문가가 추천하는 성분으로 가족에게도 적합합니다.',
    '신뢰도 높은 브랜드라 가족 선물로 적합합니다.',
  ],
};

const MOCK_PASS_REASONING = [
  '마음에 드는 제품이 없어 구매를 보류합니다.',
  '가격과 품질 모두 만족스럽지 않아 패스합니다.',
  '현재로서는 구매 의향이 없습니다.',
];

/**
 * Build per-agent weight vector with individual noise.
 *
 * Takes the archetype's batch evaluation weights and adds per-agent
 * Gaussian-like noise so that agents within the same archetype make
 * statistically diverse (but archetype-coherent) choices.
 *
 * Noise magnitude is ±10% multiplicative, matching the ontology
 * buyer_agent.sensitivity_profile specification.
 *
 * @param {{ our_product: number, competitor_a: number, competitor_b: number, competitor_c: number, pass: number }} batchWeights
 * @param {() => number} rng - Per-agent PRNG
 * @param {number} noiseMagnitude - Noise scale (default 0.1 = ±10%)
 * @returns {number[]} Weight vector in PRODUCT_CHOICES order
 */
function buildPerAgentWeights(batchWeights, rng, noiseMagnitude = 0.1) {
  return PRODUCT_CHOICES.map((key) => {
    const base = Math.max(0.1, Number(batchWeights[key]) || 0.1);
    // Add multiplicative noise: uniform on [1-noiseMagnitude, 1+noiseMagnitude]
    const noise = 1 + (rng() * 2 - 1) * noiseMagnitude;
    return Math.max(0, base * noise);
  });
}

/**
 * Pick a reasoning string for mock mode.
 *
 * @param {string} archetypeId
 * @param {string} chosenProduct
 * @param {() => number} rng
 * @returns {string}
 */
function pickMockReasoning(archetypeId, chosenProduct, rng) {
  if (chosenProduct === 'pass') {
    const templates = MOCK_PASS_REASONING;
    return templates[Math.floor(rng() * templates.length)];
  }
  const templates = MOCK_REASONING_TEMPLATES[archetypeId] ?? MOCK_REASONING_TEMPLATES.value_seeker;
  return templates[Math.floor(rng() * templates.length)];
}

/**
 * Build a mock individual agent evaluation response.
 * Uses archetype-level heuristic weights with per-agent noise,
 * producing statistically diverse but archetype-coherent choices.
 *
 * @param {{ agent_id: string, archetype: object, strategy: object, competitors: object, ourProduct: object }} params
 * @returns {{ agent_id: string, chosen_product: string, reasoning: string }}
 */
function buildMockIndividualResponse({ agent_id, archetype, strategy, competitors, ourProduct }) {
  const rng = makeAgentRng(seedFromAgentId(agent_id));

  // Compute base heuristic weights using the existing candidateScore logic
  const ourScore = candidateScore(archetype, strategy, ourProduct);
  const competitorWeights = Object.fromEntries(
    competitors.competitors.map((competitor) => [competitor.product_id, competitorBaseScore(archetype, competitor)])
  );

  const baseWeights = {
    our_product: Math.max(0.2, ourScore),
    competitor_a: Math.max(0.2, competitorWeights.competitor_a ?? 2),
    competitor_b: Math.max(0.2, competitorWeights.competitor_b ?? 2),
    competitor_c: Math.max(0.2, competitorWeights.competitor_c ?? 2),
    pass: Math.max(0.1, archetype.pass_threshold * 10),
  };

  const perAgentWeights = buildPerAgentWeights(baseWeights, rng);
  const chosen_product = sampleWeightedChoice(perAgentWeights, rng, PRODUCT_CHOICES);
  const reasoning = pickMockReasoning(archetype.id, chosen_product, rng);

  // Compute a normalized utility score (0–1) for the chosen product.
  // This represents the agent's relative confidence in their decision as a
  // proportion of total choice weight across all options.
  const totalWeight = perAgentWeights.reduce((sum, w) => sum + Math.max(0, w), 0);
  const chosenIdx = PRODUCT_CHOICES.indexOf(chosen_product);
  const score = totalWeight > 0
    ? parseFloat((Math.max(0, perAgentWeights[chosenIdx]) / totalWeight).toFixed(4))
    : 0.2; // uniform fallback when weights are all zero

  return { agent_id, chosen_product, reasoning, score };
}

function keywordBoost(text, words) {
  const normalized = String(text).toLowerCase();
  return words.reduce((sum, word) => sum + (normalized.includes(word) ? 1 : 0), 0);
}

function competitorBaseScore(archetype, competitor) {
  const priceAnchor = 32000 - competitor.price_krw;
  const priceScore = (archetype.price_sensitivity * priceAnchor) / 15000;
  const trustScore = archetype.brand_bias * (competitor.positioning.includes('메이저') ? 0.6 : 0.2);
  const premiumScore = archetype.label.includes('프리미엄') && competitor.positioning.includes('프리미엄') ? 1.4 : 0;
  const valueScore = archetype.id === 'value_seeker' && competitor.positioning.includes('가성비') ? 1.4 : 0;
  return 2 + priceScore + trustScore + premiumScore + valueScore;
}

function candidateScore(archetype, candidate, ourProduct) {
  const expertBoost = keywordBoost(`${candidate.title} ${candidate.top_copy}`, ['전문가', '두피과학', '프리미엄', '신뢰']);
  const premiumToneBoost = keywordBoost(`${candidate.title} ${candidate.top_copy}`, ['프리미엄', '엑스퍼트', '스칼프']);
  const pricePenalty = (archetype.price_sensitivity * candidate.price_krw) / 25000;
  const trustBoost = (archetype.trust_sensitivity * expertBoost) / 2;
  const premiumBoost = archetype.id === 'premium_quality' ? premiumToneBoost : 0;
  const familyBoost = archetype.id === 'gift_or_family_buyer' ? keywordBoost(candidate.top_copy, ['신뢰', '관리', '전문가']) : 0;
  const urgencyBoost = archetype.id === 'urgency_buyer' ? keywordBoost(candidate.top_copy, ['관리', '신뢰', '핵심']) : 0;
  const desperateBoost = archetype.id === 'desperate_hairloss' ? keywordBoost(`${candidate.title} ${candidate.top_copy}`, ['탈모', '두피', '성분', '전문가', '효과']) : 0;
  const base = 4 + trustBoost + premiumBoost + familyBoost + urgencyBoost + desperateBoost;
  return base - pricePenalty + (ourProduct.positioning.includes('성분') ? 0.5 : 0);
}

function buildHeuristicEvaluation({ archetype, strategies, competitors, ourProduct }) {
  return {
    archetype_id: archetype.id,
    evaluations: strategies.map((strategy) => {
      const ourScore = candidateScore(archetype, strategy, ourProduct);
      const competitorScores = Object.fromEntries(competitors.competitors.map((competitor) => [competitor.product_id, competitorBaseScore(archetype, competitor)]));
      const bestExternal = Math.max(...Object.values(competitorScores));
      const passWeight = bestExternal < archetype.pass_threshold * 10 ? 3 : 0.4 + archetype.pass_threshold;
      return {
        strategy_id: strategy.id,
        weights: {
          our_product: Math.max(0.2, ourScore),
          competitor_a: Math.max(0.2, competitorScores.competitor_a),
          competitor_b: Math.max(0.2, competitorScores.competitor_b),
          competitor_c: Math.max(0.2, competitorScores.competitor_c),
          pass: Math.max(0.1, passWeight),
        },
        summary: `${archetype.label} archetype heuristic evaluation`,
      };
    }),
  };
}

export async function evaluateArchetypeBatch({ archetype, strategies, competitors, ourProduct, runConfig, client }) {
  const promptTemplate = await fs.readFile(PROMPT_PATH, 'utf8');
  const fallback = async () => buildHeuristicEvaluation({ archetype, strategies, competitors, ourProduct });

  const { data } = await client.generateJson({
    model: runConfig.buyer_evaluator_model,
    schema: BUYER_EVALUATION_SCHEMA,
    system: promptTemplate,
    user: JSON.stringify({ archetype, strategies, competitors: competitors.competitors, our_product: ourProduct }, null, 2),
    fallback,
  });

  return assertBuyerEvaluationPayload(data);
}

/**
 * Build the structured user message for an individual agent LLM call.
 *
 * Clearly presents the agent persona and all five product options so the
 * model can make a grounded, persona-coherent discrete choice.
 *
 * @param {{ agent_id: string, archetype: object, strategy: object, competitors: object, ourProduct: object }} params
 * @returns {string} JSON-serialised user message
 */
function buildIndividualAgentUserMessage({ agent_id, archetype, strategy, competitors, ourProduct }) {
  // Build the "our_product" option from the candidate strategy
  const ourProductOption = {
    product_id: 'our_product',
    title: strategy.title,
    top_copy: strategy.top_copy,
    price_krw: strategy.price_krw,
    positioning: ourProduct.positioning ?? ourProduct.core_promise ?? '두피과학 / 성분 전문가 설계',
  };

  // Build competitor options — normalise to a consistent shape
  const competitorOptions = (competitors.competitors ?? []).map((c) => ({
    product_id: c.product_id,
    brand_name: c.brand_name,
    price_krw: c.price_krw,
    positioning: c.positioning,
    top_copy_hint: c.top_copy_hint ?? null,
  }));

  // The pass option — always available
  const passOption = {
    product_id: 'pass',
    description: '마음에 드는 제품이 없어 구매를 보류하고 다음 기회를 기다림',
  };

  // Agent persona — use per-agent fields when available (BuyerAgent), fall back to archetype fields
  const persona = {
    agent_id,
    name: archetype.korean_name ?? archetype.label ?? archetype.id,
    archetype_id: archetype.archetype_id ?? archetype.id,
    budget_band: archetype.budget_band ?? 'mid',
    price_sensitivity: archetype.price_sensitivity,
    trust_sensitivity: archetype.trust_sensitivity,
    promo_affinity: archetype.promo_affinity,
    brand_bias: archetype.brand_bias,
    pass_threshold: archetype.pass_threshold,
    copy_preference: archetype.copy_preference,
  };

  return JSON.stringify(
    {
      persona,
      product_options: {
        our_product: ourProductOption,
        competitor_a: competitorOptions.find((c) => c.product_id === 'competitor_a') ?? null,
        competitor_b: competitorOptions.find((c) => c.product_id === 'competitor_b') ?? null,
        competitor_c: competitorOptions.find((c) => c.product_id === 'competitor_c') ?? null,
        pass: passOption,
      },
      instruction: '위 페르소나 특성을 바탕으로, 제시된 5개 제품 옵션 중 정확히 하나를 선택하십시오. chosen_product는 반드시 product_options의 키 중 하나여야 합니다.',
    },
    null,
    2
  );
}

/**
 * Attempt a single gpt-5-nano call for an individual agent.
 * Returns parsed + validated payload on success, or null on any error.
 *
 * @param {{ agent_id: string, archetype: object, strategy: object, competitors: object, ourProduct: object, runConfig: object, client: object, systemPrompt: string }} params
 * @returns {Promise<{ agent_id: string, chosen_product: string, reasoning: string } | null>}
 */
async function attemptLiveAgentCall({ agent_id, archetype, strategy, competitors, ourProduct, runConfig, client, systemPrompt }) {
  try {
    const userMessage = buildIndividualAgentUserMessage({ agent_id, archetype, strategy, competitors, ourProduct });

    const { data } = await client.generateJson({
      model: runConfig.buyer_evaluator_model,
      schema: INDIVIDUAL_AGENT_EVALUATION_SCHEMA,
      system: systemPrompt,
      user: userMessage,
      // No fallback here — caller handles retry + fallback
    });

    // Validate and enforce agent_id match
    const validated = assertIndividualAgentEvaluationPayload(data);
    return { ...validated, agent_id };
  } catch {
    return null;
  }
}

/**
 * Evaluate a single buyer agent making an independent product choice.
 *
 * Each agent is identified by a unique agent_id and belongs to an archetype.
 * In live mode the agent sends an individual gpt-5-nano request and receives
 * a single discrete product choice with reasoning.
 * In mock/test mode a deterministic but noisy heuristic is used so that:
 *  - Identical agent_ids always produce the same choice (reproducible tests)
 *  - Different agents within the same archetype produce diverse choices
 *    (realistic simulation variance)
 *
 * Retry policy (live mode only):
 *  - Attempt 1: primary call
 *  - Attempt 2: one retry on error or invalid response
 *  - Fallback: deterministic mock heuristic if both attempts fail
 *
 * @param {Object} params
 * @param {string}  params.agent_id    - Unique agent identifier, e.g. "agent_001"
 * @param {Object}  params.archetype   - Archetype profile (or BuyerAgent) from buyer-personas fixture
 * @param {Object}  params.strategy    - Candidate strategy being evaluated (represents "our_product" option)
 * @param {Object}  params.competitors - Competitors bundle (competitors.competitors array)
 * @param {Object}  params.ourProduct  - Our product fixture data (for positioning context)
 * @param {Object}  params.runConfig   - Run configuration (model names, etc.)
 * @param {Object}  params.client      - OpenAIClient instance
 *
 * @returns {Promise<{ agent_id: string, chosen_product: string, reasoning: string }>}
 */
export async function evaluateIndividualAgent({ agent_id, archetype, strategy, competitors, ourProduct, runConfig, client }) {
  // Mock / non-live mode: return fast per-agent heuristic response
  if (client.mode !== 'live') {
    const result = buildMockIndividualResponse({ agent_id, archetype, strategy, competitors, ourProduct });
    return assertIndividualAgentEvaluationPayload(result);
  }

  // Load the individual-agent-specific system prompt
  const systemPrompt = await fs.readFile(INDIVIDUAL_PROMPT_PATH, 'utf8');

  const callParams = { agent_id, archetype, strategy, competitors, ourProduct, runConfig, client, systemPrompt };

  // Attempt 1: primary LLM call
  const firstAttempt = await attemptLiveAgentCall(callParams);
  if (firstAttempt !== null) return firstAttempt;

  // Attempt 2: one retry on failure
  const secondAttempt = await attemptLiveAgentCall(callParams);
  if (secondAttempt !== null) return secondAttempt;

  // Fallback: deterministic mock heuristic (graceful degradation)
  const fallbackResult = buildMockIndividualResponse({ agent_id, archetype, strategy, competitors, ourProduct });
  return assertIndividualAgentEvaluationPayload(fallbackResult);
}
