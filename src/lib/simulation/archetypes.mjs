/**
 * archetypes.mjs
 *
 * Canonical source of truth for all 8 buyer archetype definitions used in the
 * individual-agent simulation pipeline (Gen 2).
 *
 * Each archetype object matches fixtures/buyer-personas.md exactly.
 *
 * Archetype field contract:
 *   - id / archetype_id  : snake_case identifier string (both fields present for compat)
 *   - label              : Korean display name
 *   - cohort_weight_percent : integer, all 8 must sum to 100
 *   - budget_band        : "low" | "mid" | "high"
 *   - price_sensitivity  : base integer [1–5]
 *   - trust_sensitivity  : base integer [1–5]
 *   - promo_affinity     : base integer [1–5]
 *   - brand_bias         : base integer [1–5]
 *   - pass_threshold     : base float [0–1], probability to skip all purchases
 *   - copy_preference    : Korean phrase describing what copy resonates with this archetype
 *
 * Per-agent trait values are the archetype base ± small noise applied at spawn time
 * (see agent-spawner.mjs). Mock-mode noise uses ±10% multiplicative jitter on the
 * base value, per ontology buyer_agent.sensitivity_profile.
 */

/**
 * Canonical archetype definitions for all 8 buyer personas.
 * Weights sum to 100%; used by buildCohortCounts to distribute agents proportionally.
 *
 * @type {ReadonlyArray<{
 *   id: string,
 *   archetype_id: string,
 *   label: string,
 *   cohort_weight_percent: number,
 *   budget_band: 'low'|'mid'|'high',
 *   price_sensitivity: number,
 *   trust_sensitivity: number,
 *   promo_affinity: number,
 *   brand_bias: number,
 *   pass_threshold: number,
 *   copy_preference: string,
 * }>}
 */
export const ARCHETYPES = Object.freeze([
  // ── 1. 가격 민감형 ─────────────────────────────────────────────────────────
  {
    id: 'price_sensitive',
    archetype_id: 'price_sensitive',
    label: '가격 민감형',
    cohort_weight_percent: 18,
    budget_band: 'low',
    price_sensitivity: 5,
    trust_sensitivity: 2,
    promo_affinity: 5,
    brand_bias: 2,
    pass_threshold: 0.72,
    copy_preference: '저렴하고 실속 있는 선택',
  },

  // ── 2. 가성비 균형형 ───────────────────────────────────────────────────────
  {
    id: 'value_seeker',
    archetype_id: 'value_seeker',
    label: '가성비 균형형',
    cohort_weight_percent: 16,
    budget_band: 'mid',
    price_sensitivity: 4,
    trust_sensitivity: 3,
    promo_affinity: 4,
    brand_bias: 2,
    pass_threshold: 0.60,
    copy_preference: '가격 대비 효율과 기능이 좋아 보이는 문구',
  },

  // ── 3. 프리미엄 품질형 ─────────────────────────────────────────────────────
  {
    id: 'premium_quality',
    archetype_id: 'premium_quality',
    label: '프리미엄 품질형',
    cohort_weight_percent: 12,
    budget_band: 'high',
    price_sensitivity: 2,
    trust_sensitivity: 4,
    promo_affinity: 1,
    brand_bias: 3,
    pass_threshold: 0.45,
    copy_preference: '고급감, 전문성, 차별화',
  },

  // ── 4. 신뢰 우선형 ─────────────────────────────────────────────────────────
  {
    id: 'trust_first',
    archetype_id: 'trust_first',
    label: '신뢰 우선형',
    cohort_weight_percent: 15,
    budget_band: 'mid',
    price_sensitivity: 3,
    trust_sensitivity: 5,
    promo_affinity: 2,
    brand_bias: 4,
    pass_threshold: 0.48,
    copy_preference: '믿을 수 있는 설계, 전문가, 과학 기반',
  },

  // ── 5. 감성/브랜드 인상형 ──────────────────────────────────────────────────
  {
    id: 'aesthetics_first',
    archetype_id: 'aesthetics_first',
    label: '감성/브랜드 인상형',
    cohort_weight_percent: 8,
    budget_band: 'mid',
    price_sensitivity: 3,
    trust_sensitivity: 3,
    promo_affinity: 2,
    brand_bias: 4,
    pass_threshold: 0.58,
    copy_preference: '깔끔하고 세련된 프리미엄 톤',
  },

  // ── 6. 문제 해결 급한형 ────────────────────────────────────────────────────
  {
    id: 'urgency_buyer',
    archetype_id: 'urgency_buyer',
    label: '문제 해결 급한형',
    cohort_weight_percent: 11,
    budget_band: 'mid',
    price_sensitivity: 3,
    trust_sensitivity: 4,
    promo_affinity: 2,
    brand_bias: 3,
    pass_threshold: 0.42,
    copy_preference: '빠르게 믿고 선택할 수 있는 확신형 문구',
  },

  // ── 7. 할인 반응형 ─────────────────────────────────────────────────────────
  {
    id: 'promo_hunter',
    archetype_id: 'promo_hunter',
    label: '할인 반응형',
    cohort_weight_percent: 10,
    budget_band: 'low',
    price_sensitivity: 4,
    trust_sensitivity: 2,
    promo_affinity: 5,
    brand_bias: 1,
    pass_threshold: 0.68,
    copy_preference: '할인/혜택/지금 사야 하는 이유',
  },

  // ── 8. 가족/대리 구매형 ────────────────────────────────────────────────────
  {
    id: 'gift_or_family_buyer',
    archetype_id: 'gift_or_family_buyer',
    label: '가족/대리 구매형',
    cohort_weight_percent: 10,
    budget_band: 'mid',
    price_sensitivity: 3,
    trust_sensitivity: 5,
    promo_affinity: 2,
    brand_bias: 3,
    pass_threshold: 0.56,
    copy_preference: '안전하고 믿을 수 있어 가족에게도 권할 수 있는 문구',
  },
]);

// ---------------------------------------------------------------------------
// Compile-time invariant checks
// ---------------------------------------------------------------------------

// Verify all 8 archetypes are present
if (ARCHETYPES.length !== 8) {
  throw new Error(`[archetypes] Expected 8 archetypes, got ${ARCHETYPES.length}`);
}

// Verify cohort_weight_percent sums to 100
const _totalWeight = ARCHETYPES.reduce((sum, a) => sum + a.cohort_weight_percent, 0);
if (_totalWeight !== 100) {
  throw new Error(`[archetypes] cohort_weight_percent must sum to 100, got ${_totalWeight}`);
}

// Verify all archetype_id / id fields match
for (const _archetype of ARCHETYPES) {
  if (_archetype.id !== _archetype.archetype_id) {
    throw new Error(`[archetypes] Archetype "${_archetype.id}" has mismatched id / archetype_id`);
  }
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Look up an archetype by its id.
 *
 * @param {string} archetypeId
 * @returns {object} The archetype object
 * @throws {Error} If the archetype is not found
 */
export function getArchetypeById(archetypeId) {
  const archetype = ARCHETYPES.find((a) => a.id === archetypeId);
  if (!archetype) {
    throw new Error(`[archetypes] Unknown archetype_id: "${archetypeId}"`);
  }
  return archetype;
}

/**
 * Returns the list of valid archetype IDs.
 *
 * @returns {string[]}
 */
export function getArchetypeIds() {
  return ARCHETYPES.map((a) => a.id);
}

// ---------------------------------------------------------------------------
// Cohort count utility (Gen 1 — kept for backward compat)
// ---------------------------------------------------------------------------

export function buildCohortCounts(archetypes, totalBuyers) {
  const exact = archetypes.map((archetype) => ({
    id: archetype.id,
    archetype,
    exact: (archetype.cohort_weight_percent / 100) * totalBuyers,
  }));

  const base = exact.map((entry) => ({ ...entry, count: Math.floor(entry.exact), remainder: entry.exact - Math.floor(entry.exact) }));
  let assigned = base.reduce((sum, entry) => sum + entry.count, 0);
  const leftover = totalBuyers - assigned;
  const sorted = [...base].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < leftover; i += 1) {
    sorted[i % sorted.length].count += 1;
    assigned += 1;
  }
  return archetypes.map((archetype) => {
    const found = sorted.find((entry) => entry.id === archetype.id);
    return { archetype, count: found ? found.count : 0 };
  });
}
