/**
 * generate-agents.mjs
 *
 * Sub-AC 3a: generateAgents() factory
 *
 * Generates the full 800-agent buyer cohort from 8 archetypes, enriching each
 * agent with a rich persona profile: age, Korean city location, archetype-specific
 * occupation, 1-line personality description, and a 1-2 line bio.
 *
 * All persona fields are generated deterministically from a seed — no LLM calls.
 * Sensitivity traits (±10% variation) are delegated to spawnBuyerAgents().
 *
 * Architecture:
 *   spawnBuyerAgents() → base agents (id, name, sensitivity traits)
 *   enrichWithPersona()  → add age, location, occupation, personality, bio
 *   generateAgents()     → combine both, return typed Agent[]
 *
 * Design principles:
 *   - Separate persona RNG from sensitivity RNG (different seed derivation)
 *   - All per-archetype data is static (no network/file I/O)
 *   - Output is fully deterministic for a given seed
 *   - Age ranges are archetype-realistic (not just 20-65 for all)
 */

import { spawnBuyerAgents } from './agent-spawner.mjs';
import { mulberry32 } from './sampler.mjs';

// ---------------------------------------------------------------------------
// Typed interface (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Agent
 * @property {string}  agent_id          - Unique ID: "{archetype_id}_{NNNN}", e.g. "price_sensitive_0001"
 * @property {string}  korean_name       - Korean full name (성 + 이름), unique within cohort
 * @property {string}  archetype_id      - Parent archetype (one of 8 canonical IDs)
 * @property {string}  budget_band       - 'low' | 'mid' | 'high'
 * @property {number}  price_sensitivity - 1–5 (archetype base ±10%)
 * @property {number}  trust_sensitivity - 1–5 (archetype base ±10%)
 * @property {number}  promo_affinity    - 1–5 (archetype base ±10%)
 * @property {number}  brand_bias        - 1–5 (archetype base ±10%)
 * @property {number}  pass_threshold    - 0–1 (archetype base ±10%)
 * @property {string}  copy_preference   - Korean phrase describing resonant copy style
 * @property {number}  age               - Integer in [20, 65], archetype-range sampled
 * @property {string}  location          - Korean city name (from KOREAN_CITIES pool)
 * @property {string}  occupation        - Archetype-specific occupation (Korean)
 * @property {string}  personality       - 1-line archetype personality summary (Korean)
 * @property {string}  bio               - 1-2 line self-introduction (Korean)
 */

// ---------------------------------------------------------------------------
// Static data pools
// ---------------------------------------------------------------------------

/**
 * Korean city pool (20 cities) used for location assignment.
 * Population-balanced: larger cities appear more frequently via weighted sampling.
 *
 * @type {ReadonlyArray<string>}
 */
export const KOREAN_CITIES = Object.freeze([
  '서울', '서울', '서울', '서울',  // 20% Seoul (capital, largest pop)
  '판교',                           // 5%  Pangyo (tech hub)
  '부산', '부산',                   // 10% Busan
  '인천',                           // 5%  Incheon
  '대구',                           // 5%  Daegu
  '대전',                           // 5%  Daejeon
  '광주',                           // 5%  Gwangju
  '수원',                           // 5%  Suwon
  '울산',                           // 5%  Ulsan
  '성남',                           // 5%  Seongnam
  '고양',                           // 5%  Goyang
  '창원',                           // 5%  Changwon
  '용인',                           // 5%  Yongin
  '청주',                           // 5%  Cheongju
  '전주',                           // 5%  Jeonju
  '천안',                           // 5%  Cheonan
]);

/**
 * Age range [min, max] per archetype.
 * Values are archetype-realistic — overall range is 20–65.
 *
 * @type {Readonly<Record<string, [number, number]>>}
 */
export const ARCHETYPE_AGE_RANGES = Object.freeze({
  price_sensitive:     [20, 38],
  value_seeker:        [25, 45],
  premium_quality:     [30, 55],
  trust_first:         [30, 60],
  aesthetics_first:    [20, 35],
  urgency_buyer:       [25, 50],
  promo_hunter:        [20, 38],
  gift_or_family_buyer:[30, 65],
});

/**
 * Archetype-specific occupation pools (5–6 occupations each, Korean).
 * Sourced from PRD §13.4 archetype occupation pool examples.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const ARCHETYPE_OCCUPATIONS = Object.freeze({
  price_sensitive: Object.freeze([
    '대학생', '사회초년생', '프리랜서', '아르바이트생', '취업준비생', '배달기사',
  ]),
  value_seeker: Object.freeze([
    '중학교 교사', '간호사', '공무원', '사무직 직원', '프리랜서', '중소기업 직원',
  ]),
  premium_quality: Object.freeze([
    '의사', '변호사', '대기업 임원', '사업가', '대학교수', '금융 전문가',
  ]),
  trust_first: Object.freeze([
    '약사', '대학교수', '연구원', '공무원', '은행원', '의료 종사자',
  ]),
  aesthetics_first: Object.freeze([
    '뷰티 크리에이터', '패션 디자이너', '인플루언서', '헤어 아티스트', '스타일리스트', '비주얼 디렉터',
  ]),
  urgency_buyer: Object.freeze([
    'IT 개발자', '자영업자', '소규모 사업주', '영업직', '직장인', '스타트업 종사자',
  ]),
  promo_hunter: Object.freeze([
    '주부', '대학생', '아르바이트생', '프리랜서 강사', '취업준비생', '온라인 셀러',
  ]),
  gift_or_family_buyer: Object.freeze([
    '학부모', '주부', '간병인', '사회복지사', '행정직원', '워킹맘',
  ]),
});

/**
 * 1-line personality description per archetype (Korean).
 * Reflects the archetype's core purchasing motivation.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ARCHETYPE_PERSONALITIES = Object.freeze({
  price_sensitive:     '가격이 조금이라도 저렴하면 바로 구매하는 알뜰파',
  value_seeker:        '가격과 품질을 꼼꼼히 비교하며 최고의 가성비를 추구하는 합리적 소비자',
  premium_quality:     '최고의 품질을 위해서라면 가격을 아끼지 않는 퀄리티 퍼스트 소비자',
  trust_first:         '전문가 추천과 검증된 데이터를 바탕으로 신중하게 구매하는 신뢰 중심형',
  aesthetics_first:    '브랜드 이미지와 감성적 매력에 끌리는 트렌드 세터',
  urgency_buyer:       '문제가 생기면 즉각적인 해결책을 찾는 행동파 구매자',
  promo_hunter:        '할인 알림을 항상 체크하고 최대 혜택을 누리는 쇼핑 전략가',
  gift_or_family_buyer:'가족을 위해 신중하게 최선의 제품을 고르는 책임감 있는 구매자',
});

/**
 * Bio generators per archetype.
 * Each function receives (name, age, location, occupation) and returns a
 * 1-2 sentence Korean self-introduction for that agent.
 *
 * Format inspired by PRD §13.4 example:
 *   "판교에서 일하는 32세 PM. 물건을 살 때 항상 3개 이상 비교하고, 가성비를 꼼꼼히 따지는 편입니다."
 *
 * @type {Readonly<Record<string, (name:string, age:number, location:string, occupation:string) => string>>}
 */
export const ARCHETYPE_BIO_GENERATORS = Object.freeze({
  price_sensitive: (name, age, location, occupation) =>
    `${location}에서 ${occupation}로 생활하는 ${age}세 ${name}. 조금이라도 저렴한 걸 찾아 항상 가격을 비교하며, 불필요한 지출은 절대 하지 않는 스타일이다.`,

  value_seeker: (name, age, location, occupation) =>
    `${location} 거주 ${age}세 ${occupation} ${name}. 물건을 살 때 항상 여러 제품을 꼼꼼히 비교하고, 가격 대비 가장 효율적인 선택을 추구한다.`,

  premium_quality: (name, age, location, occupation) =>
    `${location}에서 일하는 ${age}세 ${occupation} ${name}. 좋은 품질에 투자하는 것을 중요하게 생각하며, 브랜드 신뢰도와 차별화된 성능을 우선시한다.`,

  trust_first: (name, age, location, occupation) =>
    `${location} 기반 ${age}세 ${occupation} ${name}. 구매 전 성분, 인증, 전문가 의견을 꼼꼼히 확인하며, 과학적 근거 없는 제품은 절대 선택하지 않는다.`,

  aesthetics_first: (name, age, location, occupation) =>
    `${location}에서 활동하는 ${age}세 ${occupation} ${name}. 제품의 디자인과 브랜드 스토리에 민감하며, SNS에서 발견한 아름다운 제품에 끌리는 스타일이다.`,

  urgency_buyer: (name, age, location, occupation) =>
    `${location} 기반 ${age}세 ${occupation} ${name}. 문제가 생기면 빠른 해결을 원하며, 믿을 수 있다는 확신이 서면 바로 구매 결정을 내리는 타입이다.`,

  promo_hunter: (name, age, location, occupation) =>
    `${location}에 사는 ${age}세 ${occupation} ${name}. 할인 쿠폰과 특가 행사를 절대 놓치지 않으며, 최저가를 달성할 때까지 기다릴 줄 아는 알뜰족이다.`,

  gift_or_family_buyer: (name, age, location, occupation) =>
    `${location} 거주 ${age}세 ${occupation} ${name}. 가족을 위한 구매라면 더욱 신중하게 선택하며, 안전성과 신뢰성을 최우선으로 고려한다.`,
});

// ---------------------------------------------------------------------------
// Internal RNG helpers
// ---------------------------------------------------------------------------

/**
 * Sample a random integer in the inclusive range [min, max].
 *
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @param {() => number} rng - RNG function returning [0, 1)
 * @returns {number} Random integer in [min, max]
 */
function randInt(min, max, rng) {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Sample a random element from an array.
 *
 * @template T
 * @param {ReadonlyArray<T>} arr - Array to sample from
 * @param {() => number} rng - RNG function returning [0, 1)
 * @returns {T} Random element
 */
function randChoice(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// ---------------------------------------------------------------------------
// Core persona enrichment
// ---------------------------------------------------------------------------

/**
 * Enrich a base agent (from spawnBuyerAgents) with persona fields:
 * age, location, occupation, personality, bio.
 *
 * Uses a deterministic RNG stream separate from the sensitivity variation RNG.
 *
 * @param {object} baseAgent - Agent object from spawnBuyerAgents()
 * @param {() => number} rng - Persona RNG function
 * @returns {Agent} Fully enriched agent with all persona fields
 */
function enrichWithPersona(baseAgent, rng) {
  const { archetype_id, korean_name } = baseAgent;

  // Age: archetype-specific range, integer
  const [ageMin, ageMax] = ARCHETYPE_AGE_RANGES[archetype_id] ?? [20, 65];
  const age = randInt(ageMin, ageMax, rng);

  // Location: sample from Korean cities pool
  const location = randChoice(KOREAN_CITIES, rng);

  // Occupation: sample from archetype-specific pool
  const occupationPool = ARCHETYPE_OCCUPATIONS[archetype_id] ?? ['직장인'];
  const occupation = randChoice(occupationPool, rng);

  // Personality: static 1-line description for this archetype
  const personality = ARCHETYPE_PERSONALITIES[archetype_id] ?? '다양한 요소를 종합적으로 고려하는 소비자';

  // Bio: dynamically generated from template
  const bioGenerator = ARCHETYPE_BIO_GENERATORS[archetype_id];
  const bio = bioGenerator
    ? bioGenerator(korean_name, age, location, occupation)
    : `${location} 거주 ${age}세 ${occupation} ${korean_name}. 자신의 니즈에 맞는 최선의 선택을 추구한다.`;

  return {
    ...baseAgent,
    age,
    location,
    occupation,
    personality,
    bio,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the full buyer-agent cohort with rich persona profiles.
 *
 * Creates 800 individual buyer agents (or `totalBuyers` if specified) from the
 * 8 canonical archetypes, each with:
 *   - Unique agent_id, unique Korean name (from spawnBuyerAgents)
 *   - Archetype-proportional distribution (largest-remainder method)
 *   - ±10% multiplicative sensitivity variation (from spawnBuyerAgents)
 *   - Age sampled from archetype-specific range [20, 65]
 *   - Korean city location from a 20-city pool
 *   - Archetype-specific occupation from a 5-6 item pool
 *   - 1-line personality description matching archetype motivation
 *   - 1-2 line Korean bio narrative
 *
 * All output is deterministic for a given seed.
 * No LLM calls are made — all data is generated from static pools + RNG.
 *
 * @param {object} [options]
 * @param {number} [options.totalBuyers=800] - Total number of agents to generate
 * @param {number} [options.seed=42]         - RNG seed for deterministic output
 * @returns {Agent[]} Array of fully-enriched Agent objects, length === totalBuyers
 * @throws {Error} If totalBuyers is not a positive integer or seed is not an integer
 *
 * @example
 * const agents = generateAgents({ totalBuyers: 800, seed: 42 });
 * console.log(agents[0]);
 * // {
 * //   agent_id: 'price_sensitive_0001',
 * //   korean_name: '김민준',
 * //   archetype_id: 'price_sensitive',
 * //   age: 27,
 * //   location: '서울',
 * //   occupation: '대학생',
 * //   personality: '가격이 조금이라도 저렴하면 바로 구매하는 알뜰파',
 * //   bio: '서울에서 대학생로 생활하는 27세 김민준...',
 * //   price_sensitivity: 4.9,
 * //   ...
 * // }
 */
export function generateAgents({ totalBuyers = 800, seed = 42 } = {}) {
  // Validation is handled by spawnBuyerAgents; we re-validate here for early errors
  if (!Number.isInteger(totalBuyers) || totalBuyers <= 0) {
    throw new Error(`[generate-agents] totalBuyers must be a positive integer, got ${totalBuyers}`);
  }
  if (!Number.isInteger(seed)) {
    throw new Error(`[generate-agents] seed must be an integer, got ${seed}`);
  }

  // Step 1: Generate base agents with sensitivity traits + unique Korean names
  const baseAgents = spawnBuyerAgents({ totalBuyers, seed });

  // Step 2: Set up a persona RNG using a seed derived from the main seed.
  // We use a different hash multiplier than agent-spawner.mjs's traitSeed derivation
  // (0x45d9f3b) to ensure the persona RNG stream is uncorrelated with the trait stream.
  const personaSeed = Math.imul(seed ^ (seed >>> 12), 0x9e3779b9) >>> 0;
  const personaRng = mulberry32(personaSeed);

  // Step 3: Enrich each base agent with persona fields
  const agents = baseAgents.map((baseAgent) => enrichWithPersona(baseAgent, personaRng));

  // ── Post-generation invariants ───────────────────────────────────────────

  if (agents.length !== totalBuyers) {
    throw new Error(
      `[generate-agents] Expected ${totalBuyers} agents but generated ${agents.length}`,
    );
  }

  // All agents must have the required persona fields
  for (const agent of agents) {
    if (typeof agent.age !== 'number' || agent.age < 20 || agent.age > 65) {
      throw new Error(
        `[generate-agents] Agent "${agent.agent_id}" has invalid age: ${agent.age}`,
      );
    }
    if (typeof agent.location !== 'string' || agent.location.length === 0) {
      throw new Error(
        `[generate-agents] Agent "${agent.agent_id}" has missing location`,
      );
    }
    if (typeof agent.occupation !== 'string' || agent.occupation.length === 0) {
      throw new Error(
        `[generate-agents] Agent "${agent.agent_id}" has missing occupation`,
      );
    }
    if (typeof agent.personality !== 'string' || agent.personality.length === 0) {
      throw new Error(
        `[generate-agents] Agent "${agent.agent_id}" has missing personality`,
      );
    }
    if (typeof agent.bio !== 'string' || agent.bio.length === 0) {
      throw new Error(
        `[generate-agents] Agent "${agent.agent_id}" has missing bio`,
      );
    }
  }

  return agents;
}
