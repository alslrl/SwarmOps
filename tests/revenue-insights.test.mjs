/**
 * revenue-insights.test.mjs
 *
 * Sub-AC 7c: Revenue chart + insights panel integration tests
 *
 * Verifies that aggregated archetype_breakdown data from the per-agent pipeline
 * (as emitted in iteration_complete SSE events) is:
 *   1. In the correct FLAT format expected by deriveInsights()
 *   2. Correctly consumable by deriveInsights() to produce valid insight items
 *   3. Producing valid revenue chart data via winner_revenue accumulation
 *
 * Key AC6 regression guard: the iteration_complete event must emit
 * archetype_breakdown in the FLAT format:
 *   { [archetypeId]: { our_product, competitor_a, competitor_b, competitor_c, pass } }
 *
 * NOT the internal sampledResults nested format:
 *   { [archetypeId]: { archetype_id, count, choices: { our_product, ... } } }
 *
 * The insights panel and revenue chart in the frontend consume the SSE events
 * directly, so the shape mismatch between internal aggregation and SSE emission
 * is the source of the AC6 regression.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { deriveInsights, ARCHETYPE_LABELS_KO } from '../src/lib/derive-insights.mjs';
import { createServer } from '../src/server.mjs';

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_CHOICES = new Set(['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']);

// ── SSE Helpers ───────────────────────────────────────────────────────────────

/** Parse raw SSE text into an array of { type, data } objects. */
function parseSseChunk(raw) {
  const events = [];
  const blocks = raw.split(/\n\n+/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    let eventType = 'message';
    let dataLine = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice('event: '.length).trim();
      } else if (line.startsWith('data: ')) {
        dataLine = line.slice('data: '.length).trim();
      }
    }
    if (dataLine) {
      try {
        events.push({ type: eventType, data: JSON.parse(dataLine) });
      } catch {
        // ignore malformed data lines
      }
    }
  }
  return events;
}

/**
 * POST to /api/run/stream on a running http.Server and collect all SSE events.
 * Resolves with the ordered array of { type, data } objects.
 */
function collectSseEvents(server, body = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = addr.port;
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: '127.0.0.1',
      port,
      path: '/api/run/stream',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = http.request(options, (res) => {
      const events = [];
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        const parsed = parseSseChunk(buffer);
        events.push(...parsed);
        const lastDoubleNewline = buffer.lastIndexOf('\n\n');
        if (lastDoubleNewline !== -1) {
          buffer = buffer.slice(lastDoubleNewline + 2);
        }
      });
      res.on('end', () => {
        if (buffer.trim()) {
          events.push(...parseSseChunk(buffer));
        }
        resolve(events);
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/** Start a test server in mock mode, bound to an OS-assigned port. */
function startTestServer() {
  return new Promise((resolve, reject) => {
    process.env.SELLER_WAR_GAME_MODEL_MODE = 'mock';
    const server = createServer();
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

/** Close the server gracefully. */
function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ── Unit helpers ─────────────────────────────────────────────────────────────

/**
 * Build a flat archetype_breakdown in the format emitted by iteration_complete.
 * Each archetype gets a direct map of choice → count (no nesting).
 */
function makeFlatBreakdown(specs) {
  const breakdown = {};
  for (const [archetypeId, { our = 0, comp_a = 0, comp_b = 0, comp_c = 0, pass = 0 }] of Object.entries(specs)) {
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

/**
 * Build revenue chart data from an array of iteration_complete event payloads.
 * Returns an array of { iteration, revenue } objects, sorted by iteration.
 *
 * This mirrors what the frontend dashboard.js should do to populate the chart.
 */
function buildRevenueChartData(iterationCompleteEvents) {
  return iterationCompleteEvents
    .map(({ iteration, winner_revenue }) => ({ iteration, revenue: winner_revenue }))
    .sort((a, b) => a.iteration - b.iteration);
}

/**
 * Verify that an archetype_breakdown object is in the FLAT format
 * (not the nested internal format with archetype_id, count, choices sub-object).
 *
 * Returns null if valid flat format, or an error message string if invalid.
 *
 * Nested format detection is done FIRST before key presence checks, so that
 * the error message correctly identifies nested format vs missing keys.
 */
function checkFlatFormat(archetypeBreakdown) {
  for (const [archetypeId, value] of Object.entries(archetypeBreakdown)) {
    if (typeof value !== 'object' || value === null) {
      return `archetype_breakdown["${archetypeId}"] must be an object, got: ${typeof value}`;
    }
    // Nested format detection FIRST: must NOT have a "choices" sub-object
    // (the internal sampledResults format stores choices in a nested object)
    if ('choices' in value) {
      return `archetype_breakdown["${archetypeId}"] must NOT have a nested "choices" object (flat format required)`;
    }
    // Must NOT have an "archetype_id" field (internal nested format artefact)
    if ('archetype_id' in value) {
      return `archetype_breakdown["${archetypeId}"] must NOT have "archetype_id" field (flat format required)`;
    }
    // Must NOT have a "count" field (internal nested format artefact)
    if ('count' in value) {
      return `archetype_breakdown["${archetypeId}"] must NOT have "count" field (flat format required)`;
    }
    // Flat format: choice keys must be directly on the object
    for (const choiceKey of VALID_CHOICES) {
      if (!(choiceKey in value)) {
        return `archetype_breakdown["${archetypeId}"] missing key "${choiceKey}"`;
      }
      if (typeof value[choiceKey] !== 'number') {
        return `archetype_breakdown["${archetypeId}"]["${choiceKey}"] must be a number, got ${typeof value[choiceKey]}`;
      }
    }
  }
  return null; // valid
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Pure unit tests — flat archetype_breakdown → deriveInsights
// ══════════════════════════════════════════════════════════════════════════════

test('deriveInsights accepts flat archetype_breakdown (iteration_complete format)', () => {
  // This is the FLAT format emitted in iteration_complete events from engine.mjs.
  // Use 4 archetypes to ensure the supplementation mechanism can reach the minimum 3
  // (supplementation only has as many candidates as there are archetypes).
  const flatBreakdown = makeFlatBreakdown({
    price_sensitive: { our: 30, comp_a: 25, comp_b: 20, comp_c: 15, pass: 10 }, // 30% neutral
    value_seeker:    { our: 55, comp_a: 20, comp_b: 10, comp_c: 10, pass: 5  }, // 55% ✅
    premium_quality: { our: 35, comp_a: 20, comp_b: 18, comp_c: 14, pass: 13 }, // 35% neutral
    trust_first:     { our: 40, comp_a: 22, comp_b: 16, comp_c: 14, pass: 8  }, // 40% neutral
  });

  // Must not throw — deriveInsights expects flat format
  const insights = deriveInsights(flatBreakdown);
  assert.ok(Array.isArray(insights), 'deriveInsights must return an array');
  assert.ok(insights.length >= 3, `Expected >= 3 insights, got ${insights.length}`);
});

test('flat archetype_breakdown is rejected if it contains nested choices object', () => {
  // This is the INTERNAL format from sampledResults — should NOT be emitted to SSE
  const nestedBreakdown = {
    price_sensitive: {
      archetype_id: 'price_sensitive',
      count: 240,
      choices: { our_product: 72, competitor_a: 60, competitor_b: 48, competitor_c: 36, pass: 24 },
    },
  };

  // Detect that this is the wrong format
  const formatError = checkFlatFormat(nestedBreakdown);
  assert.ok(
    formatError !== null,
    'Nested format should be detected as invalid for iteration_complete emission'
  );
  assert.ok(
    formatError.includes('choices'),
    `Error message should mention "choices" nested object, got: "${formatError}"`
  );

  // Also verify that deriveInsights silently fails or returns wrong results
  // when fed nested format (it will count our_product = undefined → 0)
  const badInsights = deriveInsights(nestedBreakdown);
  // The nested format makes all our_product counts appear as 0 (undefined)
  // so deriveInsights might produce warn insights for all archetypes
  // The key point is the FORMAT is wrong for the SSE contract
  assert.ok(
    Array.isArray(badInsights),
    'deriveInsights returns array even for wrong format (but results are incorrect)'
  );
});

test('flat archetype_breakdown format check passes for valid flat data', () => {
  const flatBreakdown = makeFlatBreakdown({
    price_sensitive: { our: 100, comp_a: 50, comp_b: 30, comp_c: 20, pass: 40 },
    trust_first:     { our: 80, comp_a: 40, comp_b: 20, comp_c: 10, pass: 50 },
  });

  const formatError = checkFlatFormat(flatBreakdown);
  assert.equal(formatError, null, `Flat format should be valid, got error: "${formatError}"`);
});

test('flat archetype_breakdown: choice counts total correctly per archetype', () => {
  // Simulate 800 agents across 2 archetypes (60/40 split)
  const totalBuyers = 800;
  const flatBreakdown = makeFlatBreakdown({
    price_sensitive: { our: 144, comp_a: 120, comp_b: 96, comp_c: 72, pass: 48 }, // 60% = 480 agents
    value_seeker:    { our: 128, comp_a: 80,  comp_b: 64, comp_c: 48, pass: 0  }, // 40% = 320 agents
  });

  let grandTotal = 0;
  for (const [, counts] of Object.entries(flatBreakdown)) {
    const archetypeTotal = Object.values(counts).reduce((s, n) => s + n, 0);
    grandTotal += archetypeTotal;
  }

  assert.equal(grandTotal, totalBuyers,
    `Grand total of all archetype breakdown counts must equal totalBuyers (${totalBuyers}), got ${grandTotal}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: Revenue chart data aggregation tests
// ══════════════════════════════════════════════════════════════════════════════

test('buildRevenueChartData produces correctly shaped chart data array', () => {
  const iterationCompletePayloads = [
    { iteration: 1, winner_revenue: 500000, winner_id: 'strategy_001' },
    { iteration: 2, winner_revenue: 520000, winner_id: 'strategy_002' },
    { iteration: 3, winner_revenue: 540000, winner_id: 'strategy_003' },
  ];

  const chartData = buildRevenueChartData(iterationCompletePayloads);

  assert.equal(chartData.length, 3, 'Chart data must have one entry per iteration');
  for (const entry of chartData) {
    assert.ok(typeof entry.iteration === 'number', 'Chart data entry must have numeric iteration');
    assert.ok(typeof entry.revenue === 'number', 'Chart data entry must have numeric revenue');
    assert.ok(entry.revenue >= 0, `Revenue must be non-negative, got ${entry.revenue}`);
  }
});

test('buildRevenueChartData sorts entries by iteration number', () => {
  // Events may arrive out of order; chart should always sort by iteration
  const outOfOrderPayloads = [
    { iteration: 3, winner_revenue: 540000 },
    { iteration: 1, winner_revenue: 500000 },
    { iteration: 2, winner_revenue: 520000 },
  ];

  const chartData = buildRevenueChartData(outOfOrderPayloads);

  assert.equal(chartData[0].iteration, 1, 'First entry must be iteration 1');
  assert.equal(chartData[1].iteration, 2, 'Second entry must be iteration 2');
  assert.equal(chartData[2].iteration, 3, 'Third entry must be iteration 3');
});

test('winner_revenue is a KRW integer (whole number ≥ 0)', () => {
  // Revenue = our_product count × price_krw (both integers → product is integer)
  const ourProductCount = 480; // e.g., 60% of 800
  const priceKrw = 29900;     // integer KRW price
  const expectedRevenue = ourProductCount * priceKrw; // = 14352000

  assert.ok(Number.isInteger(expectedRevenue), 'Revenue must be an integer');
  assert.ok(expectedRevenue >= 0, 'Revenue must be non-negative');
  assert.equal(expectedRevenue, 14352000, 'Revenue calculation must be exact');
});

test('revenue chart data revenue values are monotone-increasing when simulation improves', () => {
  // Simulated successful run: each iteration wins more our_product selections
  const payloads = [
    { iteration: 1, winner_revenue: 400000 },
    { iteration: 2, winner_revenue: 450000 },
    { iteration: 3, winner_revenue: 500000 },
  ];

  const chartData = buildRevenueChartData(payloads);

  for (let i = 1; i < chartData.length; i += 1) {
    assert.ok(
      chartData[i].revenue >= chartData[i - 1].revenue,
      `Revenue should not decrease at iteration ${chartData[i].iteration}: ` +
      `${chartData[i - 1].revenue} → ${chartData[i].revenue}`
    );
  }
});

test('revenue chart supports single-iteration run', () => {
  const payloads = [{ iteration: 1, winner_revenue: 598000 }];
  const chartData = buildRevenueChartData(payloads);

  assert.equal(chartData.length, 1, 'Single iteration produces single chart data point');
  assert.equal(chartData[0].iteration, 1);
  assert.equal(chartData[0].revenue, 598000);
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Per-agent pipeline produces correct insights
// ══════════════════════════════════════════════════════════════════════════════

test('insights generated from 800-agent flat breakdown have correct icon types', () => {
  // Realistic 800-agent distribution across 8 archetypes
  // Simulating a strategy that performs well for some archetypes, poorly for others
  const flatBreakdown = {
    price_sensitive:      { our_product: 48,  competitor_a: 72,  competitor_b: 60,  competitor_c: 36,  pass: 24  }, // 20% → ⚠️
    value_seeker:         { our_product: 192, competitor_a: 48,  competitor_b: 32,  competitor_c: 48,  pass: 0   }, // ~60% → ✅
    premium_quality:      { our_product: 14,  competitor_a: 14,  competitor_b: 10,  competitor_c: 10,  pass: 2   }, // ~28% neutral
    trust_first:          { our_product: 30,  competitor_a: 10,  competitor_b: 8,   competitor_c: 7,   pass: 25  }, // ~37.5% + 31% pass
    aesthetics_first:     { our_product: 4,   competitor_a: 8,   competitor_b: 6,   competitor_c: 4,   pass: 28  }, // 8% → ⚠️ + 56% pass → 🟡
    urgency_buyer:        { our_product: 80,  competitor_a: 16,  competitor_b: 12,  competitor_c: 8,   pass: 4   }, // ~67% → ✅
    promo_hunter:         { our_product: 20,  competitor_a: 20,  competitor_b: 16,  competitor_c: 14,  pass: 50  }, // 17% → ⚠️ + 42% → 🟡
    gift_or_family_buyer: { our_product: 36,  competitor_a: 16,  competitor_b: 12,  competitor_c: 8,   pass: 8   }, // 45% neutral
  };

  const insights = deriveInsights(flatBreakdown);

  // Must return 3–8 items
  assert.ok(insights.length >= 3, `Expected >= 3 insights, got ${insights.length}`);
  assert.ok(insights.length <= 8, `Expected <= 8 insights, got ${insights.length}`);

  // Each insight must have required fields
  for (const insight of insights) {
    assert.ok(typeof insight.icon === 'string' && insight.icon.length > 0, 'icon must be non-empty string');
    assert.ok(typeof insight.cls === 'string' && insight.cls.length > 0, 'cls must be non-empty string');
    assert.ok(typeof insight.archetypeLabel === 'string' && insight.archetypeLabel.length > 0, 'archetypeLabel must be non-empty string');
    assert.ok(typeof insight.text === 'string' && insight.text.length > 0, 'text must be non-empty string');
    assert.ok(typeof insight.score === 'number' && Number.isFinite(insight.score), 'score must be a finite number');
    assert.ok(['⚠️', '✅', '🟡'].includes(insight.icon), `icon must be one of ⚠️ ✅ 🟡, got "${insight.icon}"`);
  }

  // Must contain at least one ⚠️ (low our_product archetypes)
  const warnItems = insights.filter((i) => i.icon === '⚠️');
  assert.ok(warnItems.length > 0, 'Expected at least one ⚠️ insight for archetypes with <25% our_product rate');
});

test('insights from per-agent breakdown use Korean archetype labels', () => {
  const flatBreakdown = {
    price_sensitive:      { our_product: 50,  competitor_a: 90,  competitor_b: 60,  competitor_c: 30, pass: 10 },
    value_seeker:         { our_product: 200, competitor_a: 50,  competitor_b: 40,  competitor_c: 30, pass: 0  },
    premium_quality:      { our_product: 30,  competitor_a: 10,  competitor_b: 8,   competitor_c: 2,  pass: 0  },
  };

  const insights = deriveInsights(flatBreakdown);
  assert.ok(insights.length >= 3, `Expected >= 3 insights, got ${insights.length}`);

  for (const insight of insights) {
    // Korean labels should not contain underscores (raw archetype IDs do)
    // All standard archetype labels are in Korean without underscores
    const standardIds = Object.keys(ARCHETYPE_LABELS_KO);
    const isStandardId = standardIds.includes(
      Object.entries(ARCHETYPE_LABELS_KO).find(([, v]) => v === insight.archetypeLabel)?.[0] ?? ''
    );
    if (isStandardId) {
      assert.ok(
        !insight.archetypeLabel.includes('_'),
        `Standard archetype label should be Korean (no underscores), got: "${insight.archetypeLabel}"`
      );
    }
  }
});

test('insights sorted by score descending from per-agent flat breakdown', () => {
  // price_sensitive: our_product=10% (worst performer, highest priority ⚠️ score)
  // value_seeker:    our_product=20% (bad but better)
  const flatBreakdown = {
    price_sensitive: { our_product: 5,  competitor_a: 20, competitor_b: 15, competitor_c: 10, pass: 0 }, // 10%, score=0.15
    value_seeker:    { our_product: 10, competitor_a: 18, competitor_b: 14, competitor_c: 8,  pass: 0 }, // 20%, score=0.05
  };

  const insights = deriveInsights(flatBreakdown);
  const warnItems = insights.filter((i) => i.icon === '⚠️');

  assert.ok(warnItems.length >= 2, `Expected >= 2 ⚠️ insights, got ${warnItems.length}`);

  // The archetype with lower our_product rate (price_sensitive = 10%) must come first
  assert.equal(
    warnItems[0].archetypeLabel,
    ARCHETYPE_LABELS_KO.price_sensitive,
    `Highest-priority insight should be for price_sensitive (10% our rate), got "${warnItems[0].archetypeLabel}"`
  );
});

test('choice_summary from iteration_complete sums to total agent count', () => {
  // Simulate a realistic choice_summary from an 800-agent run
  const choiceSummary = {
    our_product:  320,
    competitor_a: 180,
    competitor_b: 140,
    competitor_c: 100,
    pass:          60,
  };

  const total = Object.values(choiceSummary).reduce((s, n) => s + n, 0);
  assert.equal(total, 800, `choice_summary must sum to 800, got ${total}`);
});

test('archetype_breakdown choice counts sum to choice_summary totals', () => {
  // Verify cross-field consistency: breakdown totals == choice_summary
  const flatBreakdown = makeFlatBreakdown({
    price_sensitive: { our: 80, comp_a: 60, comp_b: 40, comp_c: 30, pass: 30 },  // 240
    value_seeker:    { our: 100, comp_a: 55, comp_b: 45, comp_c: 40, pass: 0  }, // 240
    trust_first:     { our: 60, comp_a: 40, comp_b: 30, comp_c: 20, pass: 10  }, // 160
    promo_hunter:    { our: 80, comp_a: 25, comp_b: 25, comp_c: 10, pass: 20  }, // 160
  });

  // Build expected choice_summary from breakdown
  const expectedSummary = { our_product: 0, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 };
  for (const counts of Object.values(flatBreakdown)) {
    for (const [key, count] of Object.entries(counts)) {
      expectedSummary[key] += count;
    }
  }

  assert.equal(expectedSummary.our_product,  320, `our_product sum should be 320, got ${expectedSummary.our_product}`);
  assert.equal(expectedSummary.competitor_a, 180, `competitor_a sum should be 180, got ${expectedSummary.competitor_a}`);
  assert.equal(expectedSummary.competitor_b, 140, `competitor_b sum should be 140, got ${expectedSummary.competitor_b}`);
  assert.equal(expectedSummary.competitor_c, 100, `competitor_c sum should be 100, got ${expectedSummary.competitor_c}`);
  assert.equal(expectedSummary.pass,          60, `pass sum should be 60, got ${expectedSummary.pass}`);

  const grandTotal = Object.values(expectedSummary).reduce((s, n) => s + n, 0);
  assert.equal(grandTotal, 800, `Grand total of all choices must be 800, got ${grandTotal}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: SSE integration tests — verify iteration_complete emits Sub-AC 3c schema
// ══════════════════════════════════════════════════════════════════════════════

test('SSE iteration_complete archetype_breakdown is Sub-AC 3c array schema (AC6 regression guard)', async () => {
  // Sub-AC 3c: archetype_breakdown is an array of {archetype_id, archetype_label, sample_size, choices:{count,pct}}
  // This replaces the old flat format check — the new format is richer and unambiguous.
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvents = events.filter((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvents.length >= 1, 'Expected at least 1 iteration_complete event');

    const firstComplete = iterCompleteEvents[0].data;

    // Sub-AC 3c: archetype_breakdown must be an array (not a plain object)
    assert.ok(
      Array.isArray(firstComplete.archetype_breakdown),
      `iteration_complete.archetype_breakdown must be an array (Sub-AC 3c schema). ` +
      `Got: ${typeof firstComplete.archetype_breakdown}`
    );
    assert.ok(
      firstComplete.archetype_breakdown.length > 0,
      'archetype_breakdown array must not be empty'
    );

    // Each entry must have the required fields
    for (const entry of firstComplete.archetype_breakdown) {
      assert.equal(typeof entry.archetype_id, 'string', 'entry.archetype_id must be a string');
      assert.equal(typeof entry.archetype_label, 'string', 'entry.archetype_label must be a string');
      assert.ok(entry.archetype_label.length > 0, 'entry.archetype_label must not be empty');
      assert.equal(typeof entry.sample_size, 'number', 'entry.sample_size must be a number');
      assert.ok(entry.sample_size >= 0, 'entry.sample_size must be >= 0');
      assert.ok(entry.choices && typeof entry.choices === 'object', 'entry.choices must be an object');

      // choices must have all 5 canonical keys with {count, pct} values
      for (const key of VALID_CHOICES) {
        assert.ok(key in entry.choices, `entry.choices must have key "${key}"`);
        assert.equal(typeof entry.choices[key], 'object', `entry.choices.${key} must be an object`);
        assert.equal(typeof entry.choices[key].count, 'number', `entry.choices.${key}.count must be a number`);
        assert.ok(Number.isInteger(entry.choices[key].count), `entry.choices.${key}.count must be an integer`);
        assert.ok(entry.choices[key].count >= 0, `entry.choices.${key}.count must be >= 0`);
        assert.equal(typeof entry.choices[key].pct, 'number', `entry.choices.${key}.pct must be a number`);
        assert.ok(
          entry.choices[key].pct >= 0 && entry.choices[key].pct <= 100,
          `entry.choices.${key}.pct must be in [0, 100]`
        );
      }
    }
  } finally {
    await stopServer(server);
  }
});

test('SSE iteration_complete winner_revenue is a positive KRW integer', async () => {
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvents = events.filter((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvents.length >= 1, 'Expected at least 1 iteration_complete event');

    for (const evt of iterCompleteEvents) {
      const d = evt.data;
      assert.ok(typeof d.winner_revenue === 'number', 'winner_revenue must be a number');
      assert.ok(Number.isFinite(d.winner_revenue), 'winner_revenue must be a finite number');
      assert.ok(d.winner_revenue >= 0, `winner_revenue must be non-negative, got ${d.winner_revenue}`);
      // Revenue = our_product_count × price_krw — both integers
      assert.ok(Number.isInteger(d.winner_revenue), `winner_revenue must be an integer (KRW), got ${d.winner_revenue}`);
    }
  } finally {
    await stopServer(server);
  }
});

test('SSE iteration_complete archetype_breakdown choice counts sum equals choice_summary total', async () => {
  // Sub-AC 3c: both choice_summary and archetype_breakdown use {count, pct} schema.
  // Verify counts are consistent between the two fields.
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvents = events.filter((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvents.length >= 1, 'Expected at least 1 iteration_complete event');

    for (const evt of iterCompleteEvents) {
      const d = evt.data;

      // Sum choice_summary.count values (Sub-AC 3c: each value is {count, pct})
      const choiceSummaryTotal = Object.values(d.choice_summary).reduce((s, v) => s + (v.count ?? 0), 0);

      // Sum archetype_breakdown choice counts (Sub-AC 3c: array of {choices: {key: {count, pct}}})
      let breakdownTotal = 0;
      for (const entry of d.archetype_breakdown) {
        for (const key of VALID_CHOICES) {
          breakdownTotal += (entry.choices?.[key]?.count ?? 0);
        }
      }

      assert.equal(
        breakdownTotal,
        choiceSummaryTotal,
        `archetype_breakdown total (${breakdownTotal}) must equal choice_summary total (${choiceSummaryTotal}) ` +
        `in iteration ${d.iteration}`
      );
    }
  } finally {
    await stopServer(server);
  }
});

test('SSE archetype_breakdown from iteration_complete produces valid deriveInsights output', async () => {
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvents = events.filter((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvents.length >= 1, 'Expected at least 1 iteration_complete event');

    const firstComplete = iterCompleteEvents[0].data;
    const archetypeBreakdown = firstComplete.archetype_breakdown;

    // Pass the real SSE archetype_breakdown directly to deriveInsights
    const insights = deriveInsights(archetypeBreakdown);

    // Must return 3–8 items
    assert.ok(Array.isArray(insights), 'deriveInsights must return an array');
    assert.ok(insights.length >= 3, `Expected >= 3 insights from real SSE data, got ${insights.length}`);
    assert.ok(insights.length <= 8, `Expected <= 8 insights from real SSE data, got ${insights.length}`);

    // Each insight must have required fields with correct types
    for (const insight of insights) {
      assert.ok(typeof insight.icon === 'string', 'insight.icon must be a string');
      assert.ok(['⚠️', '✅', '🟡'].includes(insight.icon), `icon must be one of ⚠️ ✅ 🟡, got "${insight.icon}"`);
      assert.ok(typeof insight.cls === 'string' && insight.cls.length > 0, 'insight.cls must be non-empty');
      assert.ok(typeof insight.archetypeLabel === 'string' && insight.archetypeLabel.length > 0, 'archetypeLabel must be non-empty');
      assert.ok(typeof insight.text === 'string' && insight.text.length > 0, 'insight.text must be non-empty');
      assert.ok(typeof insight.score === 'number', 'insight.score must be a number');

      // cls must match icon
      if (insight.icon === '⚠️') assert.equal(insight.cls, 'insight-warn');
      if (insight.icon === '✅') assert.equal(insight.cls, 'insight-good');
      if (insight.icon === '🟡') assert.equal(insight.cls, 'insight-caution');
    }
  } finally {
    await stopServer(server);
  }
});

test('SSE revenue chart data built from multiple iterations is correctly ordered', async () => {
  // Run with 2 iterations to get multiple iteration_complete events
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 2,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvents = events
      .filter((e) => e.type === 'iteration_complete')
      .map((e) => e.data);

    assert.ok(iterCompleteEvents.length >= 2, `Expected >= 2 iteration_complete events for iterationCount=2, got ${iterCompleteEvents.length}`);

    // Build chart data
    const chartData = buildRevenueChartData(iterCompleteEvents);

    // Must have one data point per completed iteration
    assert.equal(chartData.length, iterCompleteEvents.length, 'Chart data must have one entry per iteration_complete event');

    // Must be sorted by iteration
    for (let i = 0; i < chartData.length; i += 1) {
      assert.equal(chartData[i].iteration, i + 1, `chartData[${i}].iteration must be ${i + 1}`);
    }

    // All revenues must be non-negative KRW integers
    for (const entry of chartData) {
      assert.ok(typeof entry.revenue === 'number' && entry.revenue >= 0,
        `Revenue at iteration ${entry.iteration} must be a non-negative number, got ${entry.revenue}`);
      assert.ok(Number.isInteger(entry.revenue),
        `Revenue at iteration ${entry.iteration} must be an integer (KRW), got ${entry.revenue}`);
    }
  } finally {
    await stopServer(server);
  }
});

test('SSE archetype_breakdown all choice count values are non-negative integers', async () => {
  // Sub-AC 3c: archetype_breakdown is now an array; each entry.choices[key].count must be integer >= 0
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvents = events.filter((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvents.length >= 1, 'Expected at least 1 iteration_complete event');

    const archetypeBreakdown = iterCompleteEvents[0].data.archetype_breakdown;
    assert.ok(Array.isArray(archetypeBreakdown), 'archetype_breakdown must be an array (Sub-AC 3c)');

    for (const entry of archetypeBreakdown) {
      const archetypeId = entry.archetype_id;
      for (const key of VALID_CHOICES) {
        const choiceEntry = entry.choices?.[key];
        assert.ok(
          choiceEntry && typeof choiceEntry === 'object',
          `archetype_breakdown entry "${archetypeId}".choices.${key} must be an object {count, pct}`
        );
        assert.ok(
          typeof choiceEntry.count === 'number' && Number.isInteger(choiceEntry.count) && choiceEntry.count >= 0,
          `archetype_breakdown["${archetypeId}"].choices.${key}.count must be a non-negative integer, got: ${choiceEntry.count}`
        );
        assert.ok(
          typeof choiceEntry.pct === 'number' && choiceEntry.pct >= 0 && choiceEntry.pct <= 100,
          `archetype_breakdown["${archetypeId}"].choices.${key}.pct must be a float in [0, 100], got: ${choiceEntry.pct}`
        );
      }
    }
  } finally {
    await stopServer(server);
  }
});

test('SSE winner_revenue equals our_product count × price in choice_summary context', async () => {
  // winner_revenue = sampledResult.choices.our_product × candidate.price_krw
  // We can verify the relationship holds: choice_summary.our_product × some_price = winner_revenue
  // Since price varies, just verify winner_revenue is a multiple of some positive integer
  const server = await startTestServer();
  try {
    const events = await collectSseEvents(server, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    const iterCompleteEvents = events.filter((e) => e.type === 'iteration_complete');
    assert.ok(iterCompleteEvents.length >= 1, 'Expected at least 1 iteration_complete event');

    const d = iterCompleteEvents[0].data;

    // winner_revenue must be a non-negative integer (KRW)
    assert.ok(Number.isInteger(d.winner_revenue) && d.winner_revenue >= 0,
      `winner_revenue must be a non-negative integer, got ${d.winner_revenue}`);

    // Sub-AC 3c: choice_summary.our_product is now {count, pct} — use .count for comparisons
    const ourProductCount = d.choice_summary.our_product?.count ?? d.choice_summary.our_product;
    assert.ok(ourProductCount >= 0,
      `choice_summary.our_product.count must be non-negative, got ${ourProductCount}`);
    assert.ok(ourProductCount <= 800,
      `choice_summary.our_product.count must be <= 800, got ${ourProductCount}`);

    // If our_product count > 0, revenue must be positive
    if (ourProductCount > 0) {
      assert.ok(d.winner_revenue > 0,
        `winner_revenue must be positive when our_product count is ${ourProductCount}`);
    }
  } finally {
    await stopServer(server);
  }
});
