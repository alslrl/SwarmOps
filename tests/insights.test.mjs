/**
 * insights.test.mjs
 *
 * Sub-AC 6b: Insights Panel unit tests
 *
 * Tests the deriveInsights() pure function that powers the insights panel.
 * Verifies:
 *   - ⚠️ icon for archetypes where our_product rate < 25%
 *   - ✅ icon for archetypes where our_product rate > 50%
 *   - 🟡 icon for archetypes where pass rate > 40%
 *   - Output always contains 3–8 items (minimum 3 via supplementation)
 *   - Output capped at 8 items when many thresholds fire
 *   - Items sorted by score descending (highest priority first)
 *   - Returns empty array for null / empty input
 *   - data-testid structure: insight-item class and insight type classes
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveInsights, ARCHETYPE_LABELS_KO } from '../src/lib/derive-insights.mjs';

// ── Helper to build a minimal archetype_breakdown from named rates ────────────

/**
 * Build an archetype_breakdown entry from simple rates.
 * total = 100 agents for easy percentage calculation.
 */
function makeArchetypeBreakdown(specs) {
  const breakdown = {};
  for (const [archetypeId, { our, comp_a = 0, comp_b = 0, comp_c = 0, pass = 0 }] of Object.entries(specs)) {
    breakdown[archetypeId] = {
      our_product:  our,
      competitor_a: comp_a,
      competitor_b: comp_b,
      competitor_c: comp_c,
      pass,
    };
  }
  return breakdown;
}

// ── Basic contract tests ──────────────────────────────────────────────────────

test('deriveInsights returns empty array for null input', () => {
  assert.deepEqual(deriveInsights(null), []);
});

test('deriveInsights returns empty array for empty object input', () => {
  assert.deepEqual(deriveInsights({}), []);
});

test('deriveInsights returns empty array for all-zero counts', () => {
  const breakdown = makeArchetypeBreakdown({
    price_sensitive: { our: 0, comp_a: 0, comp_b: 0, comp_c: 0, pass: 0 },
  });
  assert.deepEqual(deriveInsights(breakdown), []);
});

// ── Threshold icon tests ──────────────────────────────────────────────────────

test('⚠️ icon assigned when our_product rate < 25%', () => {
  // our_product = 20/100 = 20% → below 25% threshold
  const breakdown = makeArchetypeBreakdown({
    price_sensitive: { our: 20, comp_a: 40, comp_b: 20, comp_c: 15, pass: 5 },
  });
  const insights = deriveInsights(breakdown);
  const warnItems = insights.filter((i) => i.icon === '⚠️');
  assert.ok(warnItems.length > 0, 'Expected at least one ⚠️ insight for low our_product rate');
  assert.equal(warnItems[0].cls, 'insight-warn');
});

test('✅ icon assigned when our_product rate > 50%', () => {
  // our_product = 60/100 = 60% → above 50% threshold
  const breakdown = makeArchetypeBreakdown({
    trust_first: { our: 60, comp_a: 15, comp_b: 10, comp_c: 10, pass: 5 },
  });
  const insights = deriveInsights(breakdown);
  const goodItems = insights.filter((i) => i.icon === '✅');
  assert.ok(goodItems.length > 0, 'Expected at least one ✅ insight for high our_product rate');
  assert.equal(goodItems[0].cls, 'insight-good');
});

test('🟡 icon assigned when pass rate > 40%', () => {
  // pass = 50/100 = 50% → above 40% threshold
  const breakdown = makeArchetypeBreakdown({
    aesthetics_first: { our: 20, comp_a: 10, comp_b: 10, comp_c: 10, pass: 50 },
  });
  const insights = deriveInsights(breakdown);
  const cautionItems = insights.filter((i) => i.icon === '🟡');
  assert.ok(cautionItems.length > 0, 'Expected at least one 🟡 insight for high pass rate');
  assert.equal(cautionItems[0].cls, 'insight-caution');
});

test('both ⚠️ and 🟡 can fire for the same archetype (low our + high pass)', () => {
  // our=10%, pass=55% → fires both warn and caution
  const breakdown = makeArchetypeBreakdown({
    aesthetics_first: { our: 10, comp_a: 15, comp_b: 10, comp_c: 10, pass: 55 },
  });
  const insights = deriveInsights(breakdown);
  const icons = insights.map((i) => i.icon);
  assert.ok(icons.includes('⚠️'), 'Expected ⚠️ for 10% our_product rate');
  assert.ok(icons.includes('🟡'), 'Expected 🟡 for 55% pass rate');
});

// ── Count range tests (3–8) ───────────────────────────────────────────────────

test('minimum 3 insights returned when only 1 threshold fires', () => {
  // Only one archetype at the boundary, all others neutral
  const breakdown = makeArchetypeBreakdown({
    price_sensitive:      { our: 20, comp_a: 30, comp_b: 25, comp_c: 20, pass: 5 }, // fires ⚠️
    value_seeker:         { our: 35, comp_a: 25, comp_b: 20, comp_c: 15, pass: 5 }, // neutral
    premium_quality:      { our: 38, comp_a: 20, comp_b: 18, comp_c: 15, pass: 9 }, // neutral
    trust_first:          { our: 40, comp_a: 22, comp_b: 16, comp_c: 14, pass: 8 }, // neutral
  });
  const insights = deriveInsights(breakdown);
  assert.ok(insights.length >= 3, `Expected >= 3 insights, got ${insights.length}`);
});

test('minimum 3 insights returned when no thresholds fire (all neutral)', () => {
  // All archetypes in the 25–50% range, pass < 40%
  const breakdown = makeArchetypeBreakdown({
    price_sensitive:      { our: 30, comp_a: 30, comp_b: 20, comp_c: 15, pass: 5 },
    value_seeker:         { our: 35, comp_a: 25, comp_b: 20, comp_c: 15, pass: 5 },
    premium_quality:      { our: 40, comp_a: 22, comp_b: 18, comp_c: 12, pass: 8 },
    trust_first:          { our: 45, comp_a: 20, comp_b: 16, comp_c: 12, pass: 7 },
  });
  const insights = deriveInsights(breakdown);
  assert.ok(insights.length >= 3, `Expected >= 3 insights, got ${insights.length}`);
});

test('maximum 8 insights returned when many thresholds fire', () => {
  // Create 8 archetypes each firing multiple thresholds
  const breakdown = makeArchetypeBreakdown({
    price_sensitive:      { our: 10, comp_a: 20, comp_b: 15, comp_c: 10, pass: 45 }, // ⚠️ + 🟡
    value_seeker:         { our: 10, comp_a: 20, comp_b: 15, comp_c: 10, pass: 45 }, // ⚠️ + 🟡
    premium_quality:      { our: 55, comp_a: 15, comp_b: 12, comp_c: 10, pass: 8  }, // ✅
    trust_first:          { our: 60, comp_a: 12, comp_b: 10, comp_c: 10, pass: 8  }, // ✅
    aesthetics_first:     { our: 10, comp_a: 18, comp_b: 12, comp_c: 10, pass: 50 }, // ⚠️ + 🟡
    urgency_buyer:        { our: 65, comp_a: 10, comp_b: 8,  comp_c: 9,  pass: 8  }, // ✅
    promo_hunter:         { our: 10, comp_a: 15, comp_b: 12, comp_c: 10, pass: 53 }, // ⚠️ + 🟡
    gift_or_family_buyer: { our: 70, comp_a: 8,  comp_b: 8,  comp_c: 7,  pass: 7  }, // ✅
  });
  const insights = deriveInsights(breakdown);
  assert.ok(insights.length <= 8, `Expected <= 8 insights, got ${insights.length}`);
  assert.ok(insights.length >= 3, `Expected >= 3 insights, got ${insights.length}`);
});

// ── Sorting tests ─────────────────────────────────────────────────────────────

test('insights sorted by score descending (highest priority first)', () => {
  // price_sensitive: our=5% (score = 0.20), value_seeker: our=15% (score = 0.10)
  // price_sensitive should come first
  const breakdown = makeArchetypeBreakdown({
    price_sensitive: { our: 5,  comp_a: 30, comp_b: 30, comp_c: 30, pass: 5 },  // ⚠️ score=0.20
    value_seeker:    { our: 15, comp_a: 30, comp_b: 25, comp_c: 25, pass: 5 },  // ⚠️ score=0.10
  });
  const insights = deriveInsights(breakdown);
  const warnItems = insights.filter((i) => i.icon === '⚠️');
  assert.ok(warnItems.length >= 2, 'Expected at least 2 ⚠️ items');
  // First warn item should have the highest score (price_sensitive: 5% our)
  assert.ok(
    warnItems[0].archetypeLabel === ARCHETYPE_LABELS_KO.price_sensitive,
    `Expected price_sensitive first, got ${warnItems[0].archetypeLabel}`
  );
});

// ── Archetype label localisation ─────────────────────────────────────────────

test('Korean labels used for all 8 standard archetype IDs', () => {
  const allArchetypes = makeArchetypeBreakdown({
    price_sensitive:      { our: 55, comp_a: 15, comp_b: 10, comp_c: 12, pass: 8 },
    value_seeker:         { our: 60, comp_a: 12, comp_b: 10, comp_c: 11, pass: 7 },
    premium_quality:      { our: 58, comp_a: 14, comp_b: 10, comp_c: 11, pass: 7 },
    trust_first:          { our: 62, comp_a: 11, comp_b: 9,  comp_c: 11, pass: 7 },
    aesthetics_first:     { our: 56, comp_a: 13, comp_b: 10, comp_c: 13, pass: 8 },
    urgency_buyer:        { our: 59, comp_a: 13, comp_b: 10, comp_c: 11, pass: 7 },
    promo_hunter:         { our: 57, comp_a: 13, comp_b: 11, comp_c: 12, pass: 7 },
    gift_or_family_buyer: { our: 61, comp_a: 11, comp_b: 10, comp_c: 11, pass: 7 },
  });
  const insights = deriveInsights(allArchetypes);
  for (const insight of insights) {
    // All labels should be Korean (no raw archetype_id like 'price_sensitive')
    assert.ok(
      !insight.archetypeLabel.includes('_'),
      `Expected Korean label, got raw archetype ID: "${insight.archetypeLabel}"`
    );
  }
});

test('unknown archetype IDs fall back to the raw ID string', () => {
  const breakdown = {
    unknown_archetype_xyz: { our_product: 10, competitor_a: 30, competitor_b: 30, competitor_c: 25, pass: 5 },
  };
  const insights = deriveInsights(breakdown);
  const warnItem = insights.find((i) => i.icon === '⚠️');
  assert.ok(warnItem, 'Expected ⚠️ for 10% our_product rate');
  assert.equal(warnItem.archetypeLabel, 'unknown_archetype_xyz', 'Unknown IDs should fallback to raw ID');
});

// ── Text content tests ────────────────────────────────────────────────────────

test('⚠️ insight text mentions percentage and competitive weakness', () => {
  const breakdown = makeArchetypeBreakdown({
    price_sensitive: { our: 20, comp_a: 35, comp_b: 25, comp_c: 15, pass: 5 },
  });
  const insights = deriveInsights(breakdown);
  const warnItem = insights.find((i) => i.icon === '⚠️');
  assert.ok(warnItem, 'Expected ⚠️ item');
  assert.ok(warnItem.text.includes('20%'), `Expected 20% in text, got: "${warnItem.text}"`);
  assert.ok(warnItem.text.includes('경쟁력'), `Expected "경쟁력" in warn text, got: "${warnItem.text}"`);
});

test('✅ insight text mentions percentage and strong performance', () => {
  const breakdown = makeArchetypeBreakdown({
    trust_first: { our: 65, comp_a: 15, comp_b: 10, comp_c: 5, pass: 5 },
  });
  const insights = deriveInsights(breakdown);
  const goodItem = insights.find((i) => i.icon === '✅');
  assert.ok(goodItem, 'Expected ✅ item');
  assert.ok(goodItem.text.includes('65%'), `Expected 65% in text, got: "${goodItem.text}"`);
  assert.ok(goodItem.text.includes('성과'), `Expected "성과" in good text, got: "${goodItem.text}"`);
});

test('🟡 insight text mentions pass percentage and purchase difficulty', () => {
  const breakdown = makeArchetypeBreakdown({
    aesthetics_first: { our: 25, comp_a: 10, comp_b: 8, comp_c: 7, pass: 50 },
  });
  const insights = deriveInsights(breakdown);
  // Find the 🟡 item that mentions purchase abandonment (포기)
  const passItem = insights.find((i) => i.icon === '🟡' && i.text.includes('포기'));
  assert.ok(passItem, 'Expected 🟡 item mentioning pass rate (포기)');
  assert.ok(passItem.text.includes('50%'), `Expected 50% in text, got: "${passItem.text}"`);
});

// ── Full realistic archetype_breakdown test ───────────────────────────────────

test('realistic 8-archetype breakdown produces 3–8 insights with mixed icons', () => {
  // Realistic distribution matching ~800 agents across 8 archetypes
  const breakdown = {
    price_sensitive:      { our_product: 82,  competitor_a: 28, competitor_b: 18, competitor_c: 12, pass: 4  }, // ~60% ✅
    value_seeker:         { our_product: 74,  competitor_a: 32, competitor_b: 20, competitor_c: 8,  pass: 2  }, // ~64% ✅
    premium_quality:      { our_product: 58,  competitor_a: 10, competitor_b: 8,  competitor_c: 14, pass: 6  }, // ~60% ✅
    trust_first:          { our_product: 68,  competitor_a: 22, competitor_b: 14, competitor_c: 10, pass: 6  }, // ~57% ✅
    aesthetics_first:     { our_product: 36,  competitor_a: 12, competitor_b: 10, competitor_c: 6,  pass: 4  }, // ~53% ✅
    urgency_buyer:        { our_product: 50,  competitor_a: 16, competitor_b: 14, competitor_c: 10, pass: 8  }, // ~51% ✅
    promo_hunter:         { our_product: 44,  competitor_a: 20, competitor_b: 18, competitor_c: 14, pass: 4  }, // ~44% neutral
    gift_or_family_buyer: { our_product: 42,  competitor_a: 18, competitor_b: 16, competitor_c: 14, pass: 10 }, // ~42% neutral
  };
  const insights = deriveInsights(breakdown);
  assert.ok(insights.length >= 3, `Expected >= 3 insights, got ${insights.length}`);
  assert.ok(insights.length <= 8, `Expected <= 8 insights, got ${insights.length}`);
  // All items must have required fields
  for (const insight of insights) {
    assert.ok(typeof insight.icon === 'string' && insight.icon.length > 0, 'Expected non-empty icon');
    assert.ok(typeof insight.cls  === 'string' && insight.cls.length  > 0, 'Expected non-empty cls');
    assert.ok(typeof insight.archetypeLabel === 'string' && insight.archetypeLabel.length > 0, 'Expected non-empty archetypeLabel');
    assert.ok(typeof insight.text === 'string' && insight.text.length > 0, 'Expected non-empty text');
    assert.ok(typeof insight.score === 'number', 'Expected numeric score');
    // Icon must be one of the three valid values
    assert.ok(['⚠️', '✅', '🟡'].includes(insight.icon), `Unexpected icon: "${insight.icon}"`);
    // cls must match the icon
    if (insight.icon === '⚠️') assert.equal(insight.cls, 'insight-warn');
    if (insight.icon === '✅') assert.equal(insight.cls, 'insight-good');
    if (insight.icon === '🟡') assert.equal(insight.cls, 'insight-caution');
  }
});

// ── ARCHETYPE_LABELS_KO export ────────────────────────────────────────────────

test('ARCHETYPE_LABELS_KO covers all 8 standard archetype IDs', () => {
  const expectedIds = [
    'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
    'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
  ];
  for (const id of expectedIds) {
    assert.ok(id in ARCHETYPE_LABELS_KO, `Expected ARCHETYPE_LABELS_KO to have key: ${id}`);
    assert.ok(typeof ARCHETYPE_LABELS_KO[id] === 'string' && ARCHETYPE_LABELS_KO[id].length > 0,
      `Expected non-empty Korean label for ${id}`);
  }
});
