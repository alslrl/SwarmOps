/**
 * src/lib/simulation/iteration-result-accumulator.mjs
 *
 * Sub-AC 6a: Iteration Result Accumulator
 *
 * Accumulates iteration_complete SSE event payloads and provides read-only
 * views of aggregated data for the revenue chart and insights panel.
 *
 * Consumes the Sub-AC 3c explicit schema as emitted by stream-formatter.mjs:
 *
 *   choice_summary:
 *     { our_product: {count, pct}, competitor_a: {count, pct}, ... }
 *
 *   archetype_breakdown:
 *     [{ archetype_id, archetype_label, sample_size,
 *        choices: { our_product: {count, pct}, ... } }]
 *
 * Each accumulated item exposes parsed fields:
 *   - our_product_count  — from choice_summary.our_product.count
 *   - our_product_pct    — from choice_summary.our_product.pct
 *   - archetype_our_product_pcts — [{archetype_id, archetype_label, pct}]
 *     from archetype_breakdown[i].choices.our_product.pct
 *
 * Design:
 *   - Pure JS module — no side-effects, no DOM access, no global state
 *   - Factory pattern: call createIterationResultAccumulator() to get an instance
 *   - Immutable snapshots: push() creates a deep snapshot, callers cannot mutate
 *     the internal state via returned references
 *
 * Usage (in dashboard.js or a test):
 *
 *   import { createIterationResultAccumulator } from
 *     '../lib/simulation/iteration-result-accumulator.mjs';
 *
 *   const acc = createIterationResultAccumulator();
 *
 *   // On each iteration_complete SSE event:
 *   acc.push(event.data);
 *
 *   // Build revenue chart data:
 *   const chartData = acc.getRevenueChartData();
 *   // → [{ iteration: 1, revenue: 14352000, accepted: true }, ...]
 *
 *   // Get insights-ready flat archetype breakdown:
 *   const breakdown = acc.getLatestFlatBreakdown();
 *   // → { price_sensitive: { our_product: 72, ... }, ... }  (flat counts)
 *
 *   // Reset for a new run:
 *   acc.reset();
 *
 * All monetary values are KRW integers.
 * Korean content is preserved as-is; code/field names are in English.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical choice keys in fixed order. */
const CHOICE_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract a plain count from a choice value in the Sub-AC 3c schema.
 *
 * Accepts both:
 *   - Explicit format: { count: number, pct: number }  → returns count
 *   - Legacy flat format: number                        → returns the number
 *   - Missing / null                                    → returns 0
 *
 * @param {*} value
 * @returns {number}
 */
function extractCount(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Math.max(0, Math.round(value));
  if (typeof value === 'object' && typeof value.count === 'number') {
    return Math.max(0, Math.round(value.count));
  }
  return 0;
}

/**
 * Extract a percentage from a choice value in the Sub-AC 3c schema.
 *
 * Accepts both:
 *   - Explicit format: { count: number, pct: number }  → returns pct
 *   - Legacy flat format: number                        → returns 0 (no pct available)
 *   - Missing / null                                    → returns 0
 *
 * @param {*} value
 * @returns {number} Float 0–100
 */
function extractPct(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'object' && typeof value.pct === 'number') {
    return Math.max(0, Math.min(100, value.pct));
  }
  return 0;
}

/**
 * Parse choice_summary from an iteration_complete payload.
 *
 * Handles both Sub-AC 3c explicit schema ({ key: {count, pct} })
 * and legacy flat schema ({ key: number }).
 *
 * @param {Object|null|undefined} choiceSummary
 * @returns {{ our_product: {count,pct}, competitor_a: {count,pct}, competitor_b: {count,pct}, competitor_c: {count,pct}, pass: {count,pct} }}
 */
function parseChoiceSummary(choiceSummary) {
  const result = {};
  for (const key of CHOICE_KEYS) {
    const raw = choiceSummary?.[key];
    result[key] = {
      count: extractCount(raw),
      pct:   extractPct(raw),
    };
  }
  return result;
}

/**
 * Parse archetype_breakdown from an iteration_complete payload.
 *
 * Handles both:
 *   - Sub-AC 3c array format: [{archetype_id, archetype_label, sample_size, choices: {key: {count,pct}}}]
 *   - Legacy flat object format: {[archetypeId]: {key: number}}
 *
 * Returns a normalized array of:
 *   { archetype_id, archetype_label, sample_size, choices: {key: {count, pct}} }
 *
 * @param {Array|Object|null|undefined} archetypeBreakdown
 * @returns {Array<{ archetype_id: string, archetype_label: string, sample_size: number, choices: Object }>}
 */
function parseArchetypeBreakdown(archetypeBreakdown) {
  if (!archetypeBreakdown) return [];

  // Sub-AC 3c: array format (primary path)
  if (Array.isArray(archetypeBreakdown)) {
    return archetypeBreakdown
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.archetype_id === 'string')
      .map((entry) => {
        const choices = {};
        for (const key of CHOICE_KEYS) {
          const raw = entry.choices?.[key];
          choices[key] = {
            count: extractCount(raw),
            pct:   extractPct(raw),
          };
        }
        const sampleSize =
          typeof entry.sample_size === 'number'
            ? entry.sample_size
            : CHOICE_KEYS.reduce((sum, k) => sum + choices[k].count, 0);
        return {
          archetype_id:    String(entry.archetype_id),
          archetype_label: typeof entry.archetype_label === 'string' ? entry.archetype_label : entry.archetype_id,
          sample_size:     sampleSize,
          choices,
        };
      });
  }

  // Legacy flat object format: { [archetypeId]: { our_product: number, ... } }
  if (typeof archetypeBreakdown === 'object') {
    return Object.entries(archetypeBreakdown)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([archetypeId, counts]) => {
        // Skip internal nested format artefacts (choices sub-object or archetype_id field)
        const rawCounts = 'choices' in counts ? counts.choices : counts;
        const choices = {};
        let sampleSize = 0;
        for (const key of CHOICE_KEYS) {
          const count = extractCount(rawCounts[key]);
          choices[key] = { count, pct: 0 };
          sampleSize += count;
        }
        // Recalculate pct values now that we have sampleSize
        for (const key of CHOICE_KEYS) {
          choices[key].pct = sampleSize > 0
            ? parseFloat(((choices[key].count / sampleSize) * 100).toFixed(2))
            : 0;
        }
        return {
          archetype_id:    archetypeId,
          archetype_label: archetypeId,  // no label in flat format
          sample_size:     sampleSize,
          choices,
        };
      });
  }

  return [];
}

/**
 * Convert normalized archetype breakdown array to flat object format.
 *
 * Output format: { [archetypeId]: { our_product, competitor_a, competitor_b, competitor_c, pass } }
 * where each value is a plain count number (not {count, pct}).
 *
 * This is the format expected by:
 *   - deriveInsights()  (derive-insights.mjs — also accepts the array format)
 *   - renderArchetypeSummary()  (dashboard.js — expects flat counts)
 *   - populateInsightsPanel()   (dashboard.js — expects flat counts)
 *   - _aggregateArchetypeBreakdown() in dashboard.js
 *
 * @param {Array} parsedBreakdown - Output of parseArchetypeBreakdown()
 * @returns {Object} Flat breakdown object
 */
export function toFlatBreakdown(parsedBreakdown) {
  if (!Array.isArray(parsedBreakdown)) return {};
  const flat = {};
  for (const entry of parsedBreakdown) {
    flat[entry.archetype_id] = {};
    for (const key of CHOICE_KEYS) {
      flat[entry.archetype_id][key] = entry.choices[key]?.count ?? 0;
    }
  }
  return flat;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new IterationResultAccumulator instance.
 *
 * Each simulation run should use a fresh accumulator (call reset() at the
 * start of a new run, or create a new instance).
 *
 * @returns {IterationResultAccumulator}
 */
export function createIterationResultAccumulator() {
  /** @type {Array<AccumulatedIterationResult>} */
  const _results = [];

  return {
    /**
     * Parse and store an iteration_complete event payload.
     *
     * Extracts the explicit Sub-AC 3c schema fields:
     *   - choice_summary.our_product.count  → our_product_count
     *   - choice_summary.our_product.pct    → our_product_pct
     *   - archetype_breakdown[i].choices.our_product.pct → archetype_our_product_pcts[i].pct
     *
     * @param {Object} iterationCompletePayload
     *   The `data` field of an iteration_complete SSE event.
     *   Expected: { iteration, winner_id, winner_revenue, accepted, rejected_count,
     *               choice_summary, archetype_breakdown }
     * @returns {AccumulatedIterationResult} The newly accumulated item (immutable snapshot).
     */
    push(iterationCompletePayload) {
      const d = iterationCompletePayload ?? {};

      // ── Parse choice_summary ──────────────────────────────────────────────
      const choiceSummary = parseChoiceSummary(d.choice_summary);

      // Sub-AC 3c explicit fields: our_product.{count,pct}
      const our_product_count = choiceSummary.our_product.count;
      const our_product_pct   = choiceSummary.our_product.pct;

      // ── Parse archetype_breakdown ─────────────────────────────────────────
      const parsedBreakdown = parseArchetypeBreakdown(d.archetype_breakdown);

      // Sub-AC 3c: archetype_breakdown[i].choices.our_product.pct
      const archetype_our_product_pcts = parsedBreakdown.map((entry) => ({
        archetype_id:    entry.archetype_id,
        archetype_label: entry.archetype_label,
        pct:             entry.choices.our_product?.pct ?? 0,
      }));

      /** @type {AccumulatedIterationResult} */
      const item = Object.freeze({
        iteration:           Number(d.iteration)      || _results.length + 1,
        winner_id:           String(d.winner_id       ?? ''),
        winner_revenue:      Math.round(Number(d.winner_revenue ?? 0)),
        accepted:            d.accepted !== false,
        rejected_count:      Number(d.rejected_count  ?? 0),

        // Sub-AC 3c explicit schema fields
        our_product_count,
        our_product_pct,
        archetype_our_product_pcts,

        // Full parsed structures (for downstream consumers)
        choice_summary:      Object.freeze(choiceSummary),
        archetype_breakdown: Object.freeze(parsedBreakdown),
      });

      _results.push(item);
      return item;
    },

    /**
     * Return all accumulated items in push order.
     *
     * @returns {ReadonlyArray<AccumulatedIterationResult>}
     */
    getAll() {
      return _results.slice();
    },

    /**
     * Return the most recently accumulated item, or null if empty.
     *
     * @returns {AccumulatedIterationResult|null}
     */
    getLatestResult() {
      return _results.length > 0 ? _results[_results.length - 1] : null;
    },

    /**
     * Return the latest archetype_breakdown as a parsed array (Sub-AC 3c format).
     *
     * @returns {Array|null}
     */
    getLatestBreakdown() {
      const latest = this.getLatestResult();
      if (!latest) return null;
      return latest.archetype_breakdown;
    },

    /**
     * Return the latest archetype_breakdown in flat object format.
     *
     * This is the format expected by legacy rendering functions:
     *   { [archetypeId]: { our_product, competitor_a, ... } } (plain counts)
     *
     * @returns {Object|null}
     */
    getLatestFlatBreakdown() {
      const latest = this.getLatestResult();
      if (!latest) return null;
      return toFlatBreakdown(latest.archetype_breakdown);
    },

    /**
     * Return an aggregated flat breakdown across ALL accumulated iterations.
     *
     * Sums counts per archetype×choice across all accepted iterations.
     * Used by the insights panel to reflect the full simulation run.
     *
     * @param {{ acceptedOnly?: boolean }} [options]
     * @returns {Object|null} Aggregated flat breakdown, or null if no data
     */
    getAggregatedFlatBreakdown({ acceptedOnly = false } = {}) {
      const items = acceptedOnly ? _results.filter((r) => r.accepted) : _results;
      if (items.length === 0) return null;

      /** @type {Record<string, Record<string, number>>} */
      const aggregated = {};

      for (const item of items) {
        const flatBreakdown = toFlatBreakdown(item.archetype_breakdown);
        for (const [archetypeId, counts] of Object.entries(flatBreakdown)) {
          if (!aggregated[archetypeId]) {
            aggregated[archetypeId] = { our_product: 0, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 };
          }
          for (const key of CHOICE_KEYS) {
            aggregated[archetypeId][key] += (counts[key] ?? 0);
          }
        }
      }

      return Object.keys(aggregated).length > 0 ? aggregated : null;
    },

    /**
     * Return revenue chart data: sorted array of { iteration, revenue, accepted }.
     *
     * Mirrors the frontend buildRevenueChartData() helper.
     * Sorted by iteration number ascending (handles out-of-order arrivals).
     *
     * @returns {Array<{ iteration: number, revenue: number, accepted: boolean }>}
     */
    getRevenueChartData() {
      return _results
        .map(({ iteration, winner_revenue, accepted }) => ({
          iteration,
          revenue: winner_revenue,
          accepted,
        }))
        .sort((a, b) => a.iteration - b.iteration);
    },

    /**
     * Return per-iteration our_product selection rates.
     *
     * Each element corresponds to one accumulated iteration.
     * Sorted by iteration number ascending.
     *
     * @returns {Array<{ iteration: number, our_product_count: number, our_product_pct: number }>}
     */
    getOurProductRates() {
      return _results
        .map(({ iteration, our_product_count, our_product_pct }) => ({
          iteration,
          our_product_count,
          our_product_pct,
        }))
        .sort((a, b) => a.iteration - b.iteration);
    },

    /**
     * Return per-archetype our_product pct timeseries.
     *
     * Returns an object keyed by archetype_id, each value being an array
     * of { iteration, pct } in iteration order.
     *
     * This is derived from archetype_breakdown[i].choices.our_product.pct
     * as specified in Sub-AC 6a.
     *
     * @returns {Record<string, Array<{ iteration: number, pct: number }>>}
     */
    getArchetypeOurProductTimeseries() {
      /** @type {Record<string, Array<{ iteration: number, pct: number }>>} */
      const timeseries = {};

      for (const item of _results) {
        for (const { archetype_id, pct } of item.archetype_our_product_pcts) {
          if (!timeseries[archetype_id]) timeseries[archetype_id] = [];
          timeseries[archetype_id].push({ iteration: item.iteration, pct });
        }
      }

      // Sort each series by iteration
      for (const series of Object.values(timeseries)) {
        series.sort((a, b) => a.iteration - b.iteration);
      }

      return timeseries;
    },

    /**
     * Clear all accumulated results (start of a new simulation run).
     */
    reset() {
      _results.length = 0;
    },

    /**
     * Return the number of accumulated iterations.
     * @returns {number}
     */
    get size() {
      return _results.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Type documentation
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AccumulatedIterationResult
 * @property {number}  iteration
 *   1-based iteration counter.
 * @property {string}  winner_id
 *   ID of the winning strategy for this iteration.
 * @property {number}  winner_revenue
 *   Simulated revenue in KRW (integer).
 * @property {boolean} accepted
 *   Whether the winner passed all acceptance gates.
 * @property {number}  rejected_count
 *   Number of candidates rejected in this iteration.
 *
 * @property {number}  our_product_count
 *   Count of agents that chose our_product (from choice_summary.our_product.count).
 *   Sub-AC 6a: parsed from the explicit Sub-AC 3c schema.
 * @property {number}  our_product_pct
 *   Percentage of agents that chose our_product (from choice_summary.our_product.pct).
 *   Sub-AC 6a: parsed from the explicit Sub-AC 3c schema.
 * @property {Array<{ archetype_id: string, archetype_label: string, pct: number }>} archetype_our_product_pcts
 *   Per-archetype our_product pct from archetype_breakdown[i].choices.our_product.pct.
 *   Sub-AC 6a: parsed from the explicit Sub-AC 3c schema.
 *
 * @property {{ our_product: {count,pct}, competitor_a: {count,pct}, competitor_b: {count,pct}, competitor_c: {count,pct}, pass: {count,pct} }} choice_summary
 *   Full parsed choice_summary with explicit {count, pct} per key.
 * @property {Array<{ archetype_id: string, archetype_label: string, sample_size: number, choices: Object }>} archetype_breakdown
 *   Full parsed archetype_breakdown array (Sub-AC 3c format).
 */
