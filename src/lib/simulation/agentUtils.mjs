/**
 * agentUtils.mjs
 *
 * Utility functions for individual-agent simulation:
 *   - createKoreanNameGenerator: stateful generator producing unique Korean names
 *   - generateUniqueKoreanNames: convenience wrapper returning an array of unique names
 *   - sensitivity_variation: applies ±10% random variation to a base sensitivity value
 *
 * All functions are deterministic when given the same RNG seed.
 */

import { mulberry32 } from './sampler.mjs';

// ---------------------------------------------------------------------------
// Name pools
// ---------------------------------------------------------------------------

/** 30 common Korean family names (성) */
const KOREAN_SURNAMES = [
  '김', '이', '박', '최', '정', '강', '조', '윤', '장', '임',
  '한', '오', '서', '신', '권', '황', '안', '송', '류', '전',
  '홍', '고', '문', '양', '손', '배', '백', '허', '유', '남',
];

/** 40 common Korean given names (이름) — gender-neutral selection */
const KOREAN_GIVEN_NAMES = [
  '민준', '서연', '지호', '수빈', '예준', '하은', '도윤', '지아',
  '시우', '채원', '준서', '소윤', '지후', '지유', '주원', '아린',
  '현우', '나은', '건우', '수아', '우진', '민서', '지원', '예린',
  '은우', '서현', '민재', '지은', '준혁', '하린', '성민', '유진',
  '태양', '다은', '진우', '수연', '민성', '보미', '재원', '혜린',
];

/**
 * Total unique name combinations available: 30 surnames × 40 given names = 1200.
 * This exceeds the 800-agent simulation capacity, ensuring no name collisions.
 */
export const MAX_UNIQUE_NAMES = KOREAN_SURNAMES.length * KOREAN_GIVEN_NAMES.length;

// ---------------------------------------------------------------------------
// Korean name generator
// ---------------------------------------------------------------------------

/**
 * Create a stateful unique Korean name generator.
 *
 * Internally builds the full combinatorial pool (surname × given-name pairs),
 * Fisher-Yates shuffles it with the provided seed, then advances a cursor on
 * each call to next(). The first MAX_UNIQUE_NAMES calls are guaranteed unique;
 * beyond that the pool cycles.
 *
 * @param {number} [seed=42] - RNG seed for deterministic shuffling
 * @returns {{ next: () => string, size: number }}
 */
export function createKoreanNameGenerator(seed = 42) {
  const rng = mulberry32(seed);

  // Build all surname + given-name combinations
  const pool = [];
  for (const surname of KOREAN_SURNAMES) {
    for (const given of KOREAN_GIVEN_NAMES) {
      pool.push(surname + given);
    }
  }

  // Fisher-Yates shuffle for randomised ordering
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }

  let cursor = 0;

  return {
    /** Total unique names before the pool cycles */
    size: pool.length,

    /**
     * Return the next unique name.
     * The first `size` calls are guaranteed to be distinct.
     *
     * @returns {string} Korean full name (성 + 이름)
     */
    next() {
      const name = pool[cursor % pool.length];
      cursor += 1;
      return name;
    },
  };
}

/**
 * Generate an array of unique Korean names.
 *
 * All names in the returned array are distinct within the array.
 * Throws when `count` exceeds MAX_UNIQUE_NAMES.
 *
 * @param {number} count - Number of unique names to generate
 * @param {number} [seed=42] - RNG seed
 * @returns {string[]} Array of `count` unique Korean names
 * @throws {RangeError} if count > MAX_UNIQUE_NAMES
 */
export function generateUniqueKoreanNames(count, seed = 42) {
  if (count > MAX_UNIQUE_NAMES) {
    throw new RangeError(
      `Cannot generate ${count} unique names; the pool contains ${MAX_UNIQUE_NAMES} combinations.`,
    );
  }
  const gen = createKoreanNameGenerator(seed);
  const names = [];
  for (let i = 0; i < count; i++) {
    names.push(gen.next());
  }
  return names;
}

// ---------------------------------------------------------------------------
// Sensitivity variation
// ---------------------------------------------------------------------------

/**
 * Apply ±10% uniform random variation to a base archetype sensitivity value.
 *
 * The variation factor is drawn uniformly from [-0.10, +0.10), so the raw
 * output is `base × (1 + factor)`.  The result is then:
 *   - clamped to the valid sensitivity range [1, 5]
 *   - rounded to 1 decimal place
 *
 * @param {number} base - Archetype base sensitivity (typically 1–5)
 * @param {() => number} rng - RNG function returning a value in [0, 1)
 * @returns {number} Varied sensitivity in [1, 5], rounded to 1 d.p.
 */
export function sensitivity_variation(base, rng) {
  // Uniform factor in [-0.10, +0.10)
  const factor = rng() * 0.2 - 0.1;
  const varied = base * (1 + factor);
  return Math.min(5, Math.max(1, Math.round(varied * 10) / 10));
}
