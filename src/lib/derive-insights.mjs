/**
 * derive-insights.mjs
 *
 * Pure function: derives 3–8 actionable insight items from archetype_breakdown data.
 *
 * Exported so it can be unit-tested independently from the browser DOM.
 * The dashboard.js frontend keeps an inline copy of this logic for browser execution
 * (server only serves specific static files from src/app/).
 *
 * Accepts two input formats for `archetypeBreakdown`:
 *
 *   1. Flat object (legacy / unit-test format):
 *        { [archetypeId]: { our_product, competitor_a, competitor_b, competitor_c, pass } }
 *        where values are plain numbers.
 *
 *   2. Array (Sub-AC 3c SSE format):
 *        [{ archetype_id, archetype_label, sample_size, choices: { [key]: { count, pct } } }]
 *        as emitted in iteration_complete events by stream-formatter.mjs.
 *
 * When the array format is detected, it is normalised to the flat object format
 * internally before applying the threshold rules below.
 *
 * Threshold rules (per PRD §12.4):
 *   ⚠️  our_product rate < 25%  → warning: low capture for this archetype
 *   ✅  our_product rate > 50%  → positive: strong capture for this archetype
 *   🟡  pass rate > 40%         → caution: high indifference / skip rate
 *
 * Up to 8 insights are returned, prioritised by significance (largest delta from
 * the neutral zone first). Minimum 3 items guaranteed by supplementation with
 * neutral archetypes sorted by distance from 37.5% midpoint.
 *
 * @param {Object|Array} archetypeBreakdown
 *   Flat object: { [archetypeId]: { our_product, competitor_a, competitor_b, competitor_c, pass } }
 *   Array (Sub-AC 3c): [{ archetype_id, archetype_label, sample_size, choices: {key: {count, pct}} }]
 * @returns {Array<{ icon: string, cls: string, archetypeLabel: string, text: string, score: number }>}
 */

/** Korean display labels for each archetype_id */
export const ARCHETYPE_LABELS_KO = {
  price_sensitive:      '가격민감형',
  value_seeker:         '가성비균형형',
  premium_quality:      '프리미엄형',
  trust_first:          '신뢰우선형',
  aesthetics_first:     '감성형',
  urgency_buyer:        '문제해결형',
  desperate_hairloss:   '간절한탈모인',
  promo_hunter:         '할인반응형',
  gift_or_family_buyer: '가족구매형',
};

/**
 * Normalise archetypeBreakdown to flat format internally.
 *
 * Handles:
 *   - Array (Sub-AC 3c SSE format): [{archetype_id, archetype_label, choices: {key: {count, pct}}}]
 *   - Flat object (legacy): {[archetypeId]: {key: number}}
 *   - null / undefined → returns {}
 *
 * @param {Object|Array|null} input
 * @returns {Object} Flat format { [archetypeId]: { our_product, competitor_a, ... } }
 */
function normaliseToFlat(input) {
  if (!input) return {};

  // Array format (Sub-AC 3c): [{archetype_id, archetype_label, sample_size, choices: {key: {count, pct}}}]
  if (Array.isArray(input)) {
    const flat = {};
    for (const entry of input) {
      if (!entry || typeof entry !== 'object') continue;
      const archetypeId = entry.archetype_id;
      if (typeof archetypeId !== 'string') continue;

      const choices = entry.choices;
      if (!choices || typeof choices !== 'object') continue;

      // Extract count values from {count, pct} objects (or plain numbers for compat)
      flat[archetypeId] = {
        our_product:  typeof choices.our_product?.count  === 'number' ? choices.our_product.count  : (typeof choices.our_product  === 'number' ? choices.our_product  : 0),
        competitor_a: typeof choices.competitor_a?.count === 'number' ? choices.competitor_a.count : (typeof choices.competitor_a === 'number' ? choices.competitor_a : 0),
        competitor_b: typeof choices.competitor_b?.count === 'number' ? choices.competitor_b.count : (typeof choices.competitor_b === 'number' ? choices.competitor_b : 0),
        competitor_c: typeof choices.competitor_c?.count === 'number' ? choices.competitor_c.count : (typeof choices.competitor_c === 'number' ? choices.competitor_c : 0),
        pass:         typeof choices.pass?.count         === 'number' ? choices.pass.count         : (typeof choices.pass         === 'number' ? choices.pass         : 0),
      };
    }
    return flat;
  }

  // Flat object format (legacy / unit tests)
  if (typeof input === 'object') return input;

  return {};
}

/**
 * Derive insight items from archetypeBreakdown.
 *
 * @param {Object|Array|null} archetypeBreakdown
 *   Flat object or Sub-AC 3c array format (both accepted).
 * @returns {Array<{ icon: string, cls: string, archetypeLabel: string, text: string, score: number }>}
 *   Empty array if input is null/empty. Otherwise 3–8 items.
 */
export function deriveInsights(archetypeBreakdown) {
  // Normalise input to flat format regardless of input shape
  const flat = normaliseToFlat(archetypeBreakdown);

  if (Object.keys(flat).length === 0) return [];

  // ── Derive candidate insight objects ─────────────────────────────────────
  /** @type {{ icon: string, cls: string, archetypeLabel: string, text: string, score: number }[]} */
  const candidates = [];

  for (const [archetypeId, counts] of Object.entries(flat)) {
    const total = (counts.our_product  ?? 0)
                + (counts.competitor_a ?? 0)
                + (counts.competitor_b ?? 0)
                + (counts.competitor_c ?? 0)
                + (counts.pass         ?? 0);
    if (total === 0) continue;

    const ourRate  = (counts.our_product ?? 0) / total;
    const passRate = (counts.pass        ?? 0) / total;
    const label    = ARCHETYPE_LABELS_KO[archetypeId] ?? archetypeId;
    const ourPct   = Math.round(ourRate  * 100);
    const passPct  = Math.round(passRate * 100);

    // ⚠️  Warning: our_product rate < 25%
    if (ourRate < 0.25) {
      candidates.push({
        icon:              '⚠️',
        cls:               'insight-warn',
        archetypeLabel:    label,
        text:              `우리 제품 선택 비율 ${ourPct}% — 이 고객군에서 경쟁력이 낮습니다.`,
        recommendedAction: '가격 또는 메시지 전략을 재검토하세요',
        score:             0.25 - ourRate,   // larger delta = higher priority
      });
    }

    // ✅  Good: our_product rate > 50%
    if (ourRate > 0.50) {
      candidates.push({
        icon:              '✅',
        cls:               'insight-good',
        archetypeLabel:    label,
        text:              `우리 제품 선택 비율 ${ourPct}% — 이 고객군에서 강한 성과를 보입니다.`,
        recommendedAction: '이 고객군 핵심 타겟팅을 유지하세요',
        score:             ourRate - 0.50,
      });
    }

    // 🟡  Caution: pass rate > 40%
    if (passRate > 0.40) {
      candidates.push({
        icon:              '🟡',
        cls:               'insight-caution',
        archetypeLabel:    label,
        text:              `구매 포기율 ${passPct}% — 이 고객군의 구매 결정을 유도하기 어렵습니다.`,
        recommendedAction: '구매 유인 프로모션 또는 리뷰 강화를 검토하세요',
        score:             passRate - 0.40,
      });
    }
  }

  // ── Sort by descending score, cap at 8 ───────────────────────────────────
  candidates.sort((a, b) => b.score - a.score);
  const insights = candidates.slice(0, 8);

  // Ensure minimum 3 items: if fewer threshold rules fired, supplement with
  // neutral archetypes sorted by how far our_product rate is from 37.5% midpoint.
  if (insights.length < 3) {
    const supplemented = Object.entries(flat)
      .map(([archetypeId, counts]) => {
        const total = (counts.our_product  ?? 0)
                    + (counts.competitor_a ?? 0)
                    + (counts.competitor_b ?? 0)
                    + (counts.competitor_c ?? 0)
                    + (counts.pass         ?? 0);
        if (total === 0) return null;
        const ourRate = (counts.our_product ?? 0) / total;
        const label   = ARCHETYPE_LABELS_KO[archetypeId] ?? archetypeId;
        const ourPct  = Math.round(ourRate * 100);
        if (insights.some((ins) => ins.archetypeLabel === label)) return null;
        return {
          icon:              '🟡',
          cls:               'insight-caution',
          archetypeLabel:    label,
          text:              `우리 제품 선택 비율 ${ourPct}% — 추가 최적화 여지가 있습니다.`,
          recommendedAction: '추가 최적화 전략을 검토하세요',
          score:             Math.abs(ourRate - 0.375),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    for (const item of supplemented) {
      if (insights.length >= 3) break;
      insights.push(item);
    }
  }

  return insights;
}
