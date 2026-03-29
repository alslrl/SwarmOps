/**
 * src/lib/sse/stream-formatter.mjs
 *
 * Canonical SSE event formatter for the POST /api/run/stream endpoint.
 *
 * Implements explicit typed payload builders for all 5 simulation event types,
 * plus the error event type. Payload contracts match the ontology schemas exactly.
 *
 * ─── EVENT TYPES ───────────────────────────────────────────────────────────
 *
 *   iteration_start      — emitted once before each iteration begins
 *   agent_decision       — emitted once per buyer agent (800× per iteration)
 *   iteration_complete   — emitted once after all 800 agents have evaluated a strategy
 *   holdout_start        — emitted before holdout validation begins
 *   simulation_complete  — emitted exactly once when the full pipeline completes
 *   error                — emitted on unrecoverable server-side errors
 *
 * ─── CANONICAL PAYLOAD CONTRACTS ──────────────────────────────────────────
 *
 *   choice_summary_payload (used in iteration_complete):
 *     {
 *       our_product:  { count: number, pct: number },
 *       competitor_a: { count: number, pct: number },
 *       competitor_b: { count: number, pct: number },
 *       competitor_c: { count: number, pct: number },
 *       pass:         { count: number, pct: number },
 *     }
 *
 *   archetype_breakdown_payload (used in iteration_complete):
 *     Array<{
 *       archetype_id:    string,
 *       archetype_label: string,    // Korean display label
 *       sample_size:     number,    // total agents in this archetype
 *       choices: {
 *         our_product:  { count: number, pct: number },
 *         competitor_a: { count: number, pct: number },
 *         competitor_b: { count: number, pct: number },
 *         competitor_c: { count: number, pct: number },
 *         pass:         { count: number, pct: number },
 *       },
 *     }>
 *
 *   pct: float 0–100, rounded to 2 decimal places.
 *   count: non-negative integer.
 *
 * ─── SSE WIRE FORMAT ───────────────────────────────────────────────────────
 *
 *   event: <eventType>\n
 *   data: <JSON>\n
 *   \n
 *
 * ─── MONETARY VALUES ───────────────────────────────────────────────────────
 *
 *   All monetary values (price_krw, winner_revenue, etc.) are KRW integers.
 *   Korean product content is preserved as-is; all code/field names are English.
 */

import { ARCHETYPES } from '../simulation/archetypes.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical product choice keys in fixed order. */
const CHOICE_KEYS = Object.freeze(['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass']);

/**
 * Default Korean label lookup built from the canonical archetype definitions.
 * Falls back to archetype_id string if the id is not in the canonical list.
 */
const DEFAULT_LABEL_MAP = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a.label]));

// ---------------------------------------------------------------------------
// Payload contract builders
// ---------------------------------------------------------------------------

/**
 * Build a choice_summary_payload — the canonical explicit format.
 *
 * Converts a flat `{ key: number }` choice counts object into the explicit
 * `{ key: { count: number, pct: number } }` schema required by the ontology.
 *
 * @param {Object} flatCounts   - Flat choice counts `{ key: number }`
 * @param {number} totalBuyers  - Total buyer count (denominator for pct).
 *                                If 0 or omitted, computed from sum of flatCounts.
 * @returns {Object}            - `{ key: { count: number, pct: number } }`
 *                                where pct is a float 0–100 rounded to 2 dp.
 */
export function buildChoiceSummaryPayload(flatCounts, totalBuyers) {
  const total =
    typeof totalBuyers === 'number' && totalBuyers > 0
      ? totalBuyers
      : CHOICE_KEYS.reduce((sum, k) => sum + (typeof flatCounts?.[k] === 'number' ? Math.max(0, flatCounts[k]) : 0), 0);

  const payload = {};
  for (const key of CHOICE_KEYS) {
    const count =
      flatCounts && typeof flatCounts[key] === 'number'
        ? Math.max(0, Math.round(flatCounts[key]))
        : 0;
    payload[key] = {
      count,
      pct: total > 0 ? parseFloat(((count / total) * 100).toFixed(2)) : 0,
    };
  }
  return payload;
}

// Alias kept for backward compatibility with existing imports.
export const buildChoiceSummaryExplicit = buildChoiceSummaryPayload;

/**
 * Build an archetype_breakdown_payload — the canonical explicit array format.
 *
 * Converts the engine's per-archetype counts map into the ontology array schema.
 * Accepts two input formats from the simulation engine:
 *
 *   Flat format:   `{ [archetypeId]: { our_product: N, competitor_a: N, ... } }`
 *   Nested format: `{ [archetypeId]: { archetype_id, count, choices: { key: N } } }`
 *
 * @param {Object} rawBreakdown  - Raw breakdown from the simulation engine
 * @param {Array}  [archetypes]  - Optional [{id, label}] overrides for label lookup
 * @returns {Array}              - Archetype breakdown array, sorted by archetype_id
 */
export function buildArchetypeBreakdownPayload(rawBreakdown, archetypes) {
  if (!rawBreakdown || typeof rawBreakdown !== 'object') {
    return [];
  }

  // Build label map: canonical defaults merged with caller-provided overrides
  const labelMap = { ...DEFAULT_LABEL_MAP };
  if (Array.isArray(archetypes)) {
    for (const a of archetypes) {
      if (a && typeof a.id === 'string') {
        labelMap[a.id] = a.label ?? a.id;
      }
    }
  }

  const entries = [];
  for (const [archetypeId, value] of Object.entries(rawBreakdown)) {
    if (!value || typeof value !== 'object') continue;

    // Normalise: if value has a 'choices' sub-object, use it; otherwise use value directly
    const counts = 'choices' in value && value.choices && typeof value.choices === 'object'
      ? value.choices
      : value;

    // sample_size = sum of all choice counts for this archetype
    const sampleSize = CHOICE_KEYS.reduce(
      (sum, key) => sum + (typeof counts[key] === 'number' ? Math.max(0, counts[key]) : 0),
      0,
    );

    // Build per-choice {count, pct} — pct relative to sample_size
    const choices = {};
    for (const key of CHOICE_KEYS) {
      const count = typeof counts[key] === 'number' ? Math.max(0, Math.round(counts[key])) : 0;
      choices[key] = {
        count,
        pct: sampleSize > 0 ? parseFloat(((count / sampleSize) * 100).toFixed(2)) : 0,
      };
    }

    entries.push({
      archetype_id:    archetypeId,
      archetype_label: labelMap[archetypeId] ?? archetypeId,
      sample_size:     sampleSize,
      choices,
    });
  }

  // Sort by archetype_id for deterministic ordering across runs
  entries.sort((a, b) => a.archetype_id.localeCompare(b.archetype_id));
  return entries;
}

// Alias kept for backward compatibility with existing imports.
export const buildArchetypeBreakdownDetail = buildArchetypeBreakdownPayload;

/**
 * Normalise a raw archetype_breakdown object to the engine's flat format.
 *
 * Utility for backward compatibility: `{ [archetypeId]: { key: number } }`.
 *
 * @param {Object} rawBreakdown
 * @returns {Object} Flat-format archetype_breakdown
 */
export function normalizeFlatBreakdown(rawBreakdown) {
  if (!rawBreakdown || typeof rawBreakdown !== 'object') return {};
  const flat = {};
  for (const [archetypeId, value] of Object.entries(rawBreakdown)) {
    if (!value || typeof value !== 'object') continue;
    const src = 'choices' in value && value.choices ? value.choices : value;
    flat[archetypeId] = {};
    for (const key of CHOICE_KEYS) {
      flat[archetypeId][key] = typeof src[key] === 'number' ? src[key] : 0;
    }
  }
  return flat;
}

// ---------------------------------------------------------------------------
// Low-level SSE frame builder
// ---------------------------------------------------------------------------

/**
 * Serialize a typed SSE event frame.
 *
 * Wire format:
 *   event: <eventType>\n
 *   data: <JSON>\n
 *   \n
 *
 * @param {string} eventType - The SSE event type name
 * @param {object} data      - JSON-serializable event payload
 * @returns {string}         - Ready-to-write SSE frame string
 */
export function formatSseFrame(eventType, data) {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ---------------------------------------------------------------------------
// Per-event-type payload builders (explicit typed contracts)
// ---------------------------------------------------------------------------

/**
 * Build and format an `iteration_start` event payload.
 *
 * Emitted once before each iteration, after candidate strategies are generated.
 *
 * Payload contract:
 *   {
 *     type:       'iteration_start',
 *     iteration:  number,    // 1-based iteration counter
 *     total:      number,    // total iterations in this run
 *     candidates: Array<{    // candidate strategy summaries
 *       id:        string,
 *       title:     string,
 *       price_krw: number,   // KRW integer
 *     }>,
 *   }
 *
 * @param {{ iteration: number, total: number, candidates: Array }} event
 * @returns {string} SSE frame string
 */
export function formatIterationStart({ iteration, total, candidates, strategy_reasoning }) {
  const payload = {
    type:      'iteration_start',
    iteration: Number(iteration),
    total:     Number(total),
    candidates: Array.isArray(candidates)
      ? candidates.map((c) => ({
          id:        String(c.id),
          title:     String(c.title),
          price_krw: Math.round(Number(c.price_krw)),
          rationale: String(c.rationale ?? ''),
        }))
      : [],
  };
  // Include strategy_reasoning if provided (optional top-level rationale from gpt-5.4)
  if (strategy_reasoning) {
    payload.strategy_reasoning = String(strategy_reasoning);
  }
  return formatSseFrame('iteration_start', payload);
}

/**
 * Build and format an `agent_decision` event payload.
 *
 * Emitted once per buyer agent per iteration (800 events per iteration).
 *
 * Payload contract:
 *   {
 *     type:            'agent_decision',
 *     iteration:       number,   // 1-based iteration counter
 *     agent_id:        string,   // unique agent identifier (e.g. "agent_0042")
 *     agent_name:      string,   // Korean display name (e.g. "구매자 #42")
 *     archetype_id:    string,   // archetype identifier
 *     chosen_product:  string,   // canonical choice key
 *     decision:        string,   // alias for chosen_product
 *     reasoning:       string,   // LLM reasoning text
 *     score:           number,   // normalised utility score 0–1
 *     agent_index:     number,   // 0-based index within the iteration (0–799)
 *     agent_total:     number,   // total agents in this iteration (typically 800)
 *     // nullable per-agent trait fields for profile popup and analytics:
 *     price_sensitivity: number|null,
 *     trust_sensitivity: number|null,
 *     promo_affinity:    number|null,
 *     brand_bias:        number|null,
 *     pass_threshold:    number|null,
 *     budget_band:       string|null,
 *   }
 *
 * @param {object} event
 * @returns {string} SSE frame string
 */
export function formatAgentDecision({
  iteration,
  agent_id,
  agent_name,
  archetype_id,
  chosen_product,
  decision,
  reasoning,
  score,
  agent_index,
  agent_total,
  price_sensitivity = null,
  trust_sensitivity = null,
  promo_affinity    = null,
  brand_bias        = null,
  pass_threshold    = null,
  budget_band       = null,
}) {
  // chosen_product and decision are aliases — prefer chosen_product, fall back to decision
  const resolvedChoice = chosen_product ?? decision ?? 'pass';

  return formatSseFrame('agent_decision', {
    type:            'agent_decision',
    iteration:       Number(iteration),
    agent_id:        String(agent_id),
    agent_name:      String(agent_name),
    archetype_id:    String(archetype_id),
    chosen_product:  resolvedChoice,
    decision:        resolvedChoice,
    reasoning:       String(reasoning ?? ''),
    score:           typeof score === 'number' ? score : 0,
    agent_index:     Number(agent_index),
    agent_total:     Number(agent_total),
    price_sensitivity,
    trust_sensitivity,
    promo_affinity,
    brand_bias,
    pass_threshold,
    budget_band,
  });
}

/**
 * Build and format an `iteration_complete` event payload.
 *
 * Emitted after all 800 agent decisions for a given iteration have been emitted.
 * Uses the canonical choice_summary_payload and archetype_breakdown_payload schemas.
 *
 * Payload contract:
 *   {
 *     type:                'iteration_complete',
 *     iteration:           number,   // 1-based iteration counter
 *     winner_id:           string,   // ID of the winning strategy
 *     winner_revenue:      number,   // simulated revenue (KRW integer)
 *     accepted:            boolean,  // whether winner passed all acceptance gates
 *     rejected_count:      number,   // number of candidates rejected
 *     choice_summary:      choice_summary_payload,      // see canonical schema above
 *     archetype_breakdown: archetype_breakdown_payload, // see canonical schema above
 *   }
 *
 * @param {object} event
 * @param {number}  event.iteration
 * @param {string}  event.winner_id
 * @param {number}  event.winner_revenue        - KRW integer
 * @param {boolean} event.accepted
 * @param {number}  event.rejected_count
 * @param {Object}  event.choice_summary        - Flat `{ key: number }` counts from engine
 * @param {Object}  event.archetype_breakdown   - Raw per-archetype counts from engine
 * @param {Array}   [event.archetypes]          - Optional [{id, label}] for label lookup
 * @returns {string} SSE frame string
 */
export function formatIterationComplete({
  iteration,
  winner_id,
  winner_revenue,
  accepted,
  rejected_count,
  choice_summary,
  archetype_breakdown,
  archetypes,
}) {
  // Normalise flat counts (ensuring non-negative integers)
  const flatCounts = {};
  for (const key of CHOICE_KEYS) {
    flatCounts[key] =
      choice_summary && typeof choice_summary[key] === 'number'
        ? Math.max(0, Math.round(choice_summary[key]))
        : 0;
  }

  return formatSseFrame('iteration_complete', {
    type:                'iteration_complete',
    iteration:           Number(iteration),
    winner_id:           String(winner_id),
    winner_revenue:      Math.round(Number(winner_revenue)),
    accepted:            Boolean(accepted),
    rejected_count:      Number(rejected_count),
    // Canonical choice_summary_payload: { key: { count, pct } }
    choice_summary:      buildChoiceSummaryPayload(flatCounts),
    // Canonical archetype_breakdown_payload: Array<{ archetype_id, archetype_label, sample_size, choices }>
    archetype_breakdown: buildArchetypeBreakdownPayload(archetype_breakdown, archetypes),
  });
}

/**
 * Build and format a `holdout_start` event payload.
 *
 * Emitted immediately before holdout validation begins, after all iterations complete.
 *
 * Payload contract:
 *   {
 *     type:    'holdout_start',
 *     message: string,  // human-readable status message
 *   }
 *
 * @param {{ message?: string }} event
 * @returns {string} SSE frame string
 */
export function formatHoldoutStart({ message }) {
  return formatSseFrame('holdout_start', {
    type:    'holdout_start',
    message: String(message ?? 'Running holdout validation...'),
  });
}

/**
 * Build and format a `simulation_complete` event payload.
 *
 * This is always the final event in a successful stream.
 *
 * Payload contract:
 *   {
 *     type:              'simulation_complete',
 *     baseline:          object,  // scored baseline strategy
 *     selected_strategy: object,  // final selected strategy
 *     holdout:           object,  // holdout result { holdout_uplift, ... }
 *     diff:              object,  // field-level diff { title, top_copy, price }
 *     artifact:          object,  // artifact metadata { path, written_at }
 *   }
 *
 * @param {{ baseline: object, selected_strategy: object, holdout: object, diff: object, artifact: object }} event
 * @returns {string} SSE frame string
 */
export function formatSimulationComplete({
  baseline,
  selected_strategy,
  holdout,
  diff,
  artifact,
}) {
  return formatSseFrame('simulation_complete', {
    type:              'simulation_complete',
    baseline,
    selected_strategy,
    holdout,
    diff,
    artifact,
  });
}

/**
 * Build and format a simulation `error` event payload.
 *
 * Emitted on unrecoverable server-side errors. Always the final event when present.
 * No stack traces are included — only a human-readable message.
 *
 * Payload contract:
 *   {
 *     type:        'error',
 *     message:     string,   // human-readable error description
 *     recoverable: boolean,  // whether the client can retry
 *   }
 *
 * @param {{ message?: string, recoverable?: boolean }} event
 * @returns {string} SSE frame string
 */
export function formatSimulationError({ message, recoverable = false }) {
  return formatSseFrame('error', {
    type:        'error',
    message:     String(message ?? 'An unexpected error occurred during simulation'),
    recoverable: Boolean(recoverable),
  });
}

// ---------------------------------------------------------------------------
// Main dispatcher — primary entry point for server-side SSE emission
// ---------------------------------------------------------------------------

/**
 * Format any simulation event by dispatching on `event.type`.
 *
 * This is the primary entry point for server-side SSE emission.
 * Pass any typed simulation event object; the correct formatter is selected
 * automatically and the canonical payload shape is applied.
 *
 * @param {object} event - Simulation event with a `type` field
 * @returns {string}     - Ready-to-write SSE frame string
 *
 * @example
 *   import { formatSimulationEvent } from './src/lib/sse/stream-formatter.mjs';
 *   res.write(formatSimulationEvent(event));
 */
export function formatSimulationEvent(event) {
  if (!event || typeof event.type !== 'string') {
    return formatSseFrame('unknown', event ?? {});
  }

  switch (event.type) {
    case 'iteration_start':
      return formatIterationStart(event);
    case 'agent_decision':
      return formatAgentDecision(event);
    case 'iteration_complete':
      return formatIterationComplete(event);
    case 'holdout_start':
      return formatHoldoutStart(event);
    case 'simulation_complete':
      return formatSimulationComplete(event);
    case 'error':
      return formatSimulationError(event);
    default:
      // Unknown event type — pass through as a generic SSE frame
      return formatSseFrame(event.type, event);
  }
}
