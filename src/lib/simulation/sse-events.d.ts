/**
 * SSE Event Schema for Seller War Game simulation streaming.
 *
 * Event sequence per iteration:
 *   iteration_start → agent_decision (×800) → iteration_complete
 *
 * After all iterations:
 *   holdout_start → simulation_complete
 *
 * Note: archetype_evaluated has been superseded by agent_decision.
 *       Each of the 800 buyer agents now makes an independent LLM call,
 *       emitting one agent_decision event per agent rather than one
 *       archetype_evaluated event per archetype batch.
 */

// ---------------------------------------------------------------------------
// HTTP API Request Body Types
// ---------------------------------------------------------------------------

/**
 * Request body for POST /api/run and POST /api/run/stream.
 * All product override fields are optional — omitted fields use fixture defaults.
 */
export interface RunRequestBody {
  /** Number of simulation iterations to run (optional, defaults to fixture value) */
  iterationCount?: number;
  /** Minimum margin floor fraction (optional, e.g. 0.35 for 35%) */
  minimumMarginFloor?: number;
  /** Override product title (Korean string) */
  title?: string;
  /** Override product top copy / description (Korean string) */
  topCopy?: string;
  /** Override product price in KRW (integer) */
  priceKrw?: number;
  /** Override product cost in KRW (integer) */
  costKrw?: number;
}

/**
 * Validated and coerced run request body, safe to pass to runSimulation().
 */
export interface ValidatedRunRequestBody {
  iterationCount?: number;
  minimumMarginFloor?: number;
  overrides: {
    title?: string;
    topCopy?: string;
    priceKrw?: number;
    costKrw?: number;
  };
}

// ---------------------------------------------------------------------------
// Shared sub-types
// ---------------------------------------------------------------------------

/** Candidate strategy summary emitted in iteration_start */
export interface StrategyCandidate {
  /** Strategy identifier (e.g. "strategy_1_a") */
  id: string;
  /** Korean product title */
  title: string;
  /** Price in KRW (integer) */
  price_krw: number;
  /** One-line Korean rationale for this candidate strategy (from gpt-5.4) */
  rationale: string;
}

/** Product choice option keys */
export type ProductChoice =
  | 'our_product'
  | 'competitor_a'
  | 'competitor_b'
  | 'competitor_c'
  | 'pass';

/** Aggregated counts of buyer choices, one count per product option */
export interface ChoiceSummary {
  our_product: number;
  competitor_a: number;
  competitor_b: number;
  competitor_c: number;
  pass: number;
}

/**
 * Per-archetype breakdown mapping each archetype_id to its ChoiceSummary.
 * Keys are archetype identifiers (e.g. "price_sensitive", "brand_loyal").
 */
export interface ArchetypeBreakdown {
  [archetype_id: string]: ChoiceSummary;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/**
 * Emitted before each iteration begins, after candidate strategies are generated.
 * Consumers may use this to reset per-iteration UI state.
 */
export interface IterationStartEvent {
  type: 'iteration_start';
  /** Current iteration number (1-based) */
  iteration: number;
  /** Total iteration count for this simulation run */
  total: number;
  /** Candidate strategy summaries generated for this iteration */
  candidates: StrategyCandidate[];
  /**
   * Top-level strategy reasoning from gpt-5.4 explaining why these candidates were proposed.
   * Optional — derived from candidate rationales when present.
   */
  strategy_reasoning?: string;
}

/**
 * Emitted once per individual buyer agent evaluation.
 *
 * Replaces the legacy archetype-batch archetype_evaluated event.
 * Each simulation run emits 800 of these events per iteration
 * (one per buyer agent, each backed by an independent gpt-5-nano LLM call).
 * Consumers can use these events to drive real-time particle-flow visualization
 * and populate the agent chat log.
 */
export interface AgentDecisionEvent {
  type: 'agent_decision';
  /** Current iteration number (1-based) */
  iteration: number;
  /** Unique identifier for this agent instance (e.g. "agent_0042") */
  agent_id: string;
  /** Korean display name for the agent (e.g. "구매자 #42") */
  agent_name: string;
  /** Archetype identifier this agent belongs to (e.g. "price_sensitive") */
  archetype_id: string;
  /** The product the agent chose */
  chosen_product: ProductChoice;
  /** LLM reasoning text for the choice (may be truncated for SSE payload size) */
  reasoning: string;
  /** 0-based index of this agent within the current iteration (0–799) */
  agent_index: number;
  /** Total number of agents in this iteration (typically 800) */
  agent_total: number;
}

/**
 * Emitted after all agents in an iteration have evaluated all candidate strategies.
 * Contains the winning strategy summary plus aggregated choice statistics.
 */
export interface IterationCompleteEvent {
  type: 'iteration_complete';
  /** Current iteration number (1-based) */
  iteration: number;
  /** ID of the winning strategy for this iteration */
  winner_id: string;
  /** Simulated revenue of the winner in KRW (integer) */
  winner_revenue: number;
  /** Whether the winner passed all acceptance gates (margin floor + realism judge) */
  accepted: boolean;
  /** Number of candidate strategies rejected in this iteration */
  rejected_count: number;
  /** Aggregated choice counts across all 800 agents for the winning strategy */
  choice_summary: ChoiceSummary;
  /** Per-archetype breakdown of agent choices for the winning strategy */
  archetype_breakdown: ArchetypeBreakdown;
}

/**
 * Emitted immediately before holdout validation begins.
 * No heavy computation follows until simulation_complete.
 */
export interface HoldoutStartEvent {
  type: 'holdout_start';
  /** Human-readable status message (English) */
  message: string;
}

/**
 * Emitted exactly once when the entire simulation pipeline completes.
 * This is always the final event in the stream.
 */
export interface SimulationCompleteEvent {
  type: 'simulation_complete';
  /** Scored baseline strategy (current product before optimization) */
  baseline: ScoredStrategy;
  /** Final selected strategy after all iterations */
  selected_strategy: CandidateStrategy;
  /** Holdout evaluation result */
  holdout: HoldoutResult;
  /**
   * Field-level diff between baseline and selected_strategy.
   * Each field is { before, after, changed } or null if unchanged.
   */
  diff: StrategyDiff;
  /** Artifact file metadata written to the artifacts directory */
  artifact: ArtifactMeta;
}

/**
 * Emitted when the server encounters an unrecoverable error during simulation.
 * Always the final event when present; closes the stream immediately after.
 */
export interface SimulationErrorEvent {
  type: 'error';
  /** Human-readable error message (no stack trace) */
  message: string;
  /** Whether the client can retry the simulation */
  recoverable: boolean;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

/**
 * Union of all SSE event types emitted by /api/run/stream.
 *
 * Note: archetype_evaluated is NOT part of this union.
 *       It has been removed and superseded by agent_decision.
 */
export type SimulationEvent =
  | IterationStartEvent
  | AgentDecisionEvent
  | IterationCompleteEvent
  | HoldoutStartEvent
  | SimulationCompleteEvent
  | SimulationErrorEvent;

// ---------------------------------------------------------------------------
// Supporting object types referenced by SimulationCompleteEvent
// ---------------------------------------------------------------------------

export interface CandidateStrategy {
  id: string;
  title: string;
  top_copy: string;
  price_krw: number;
  rationale: string;
}

export interface ScoredStrategy extends CandidateStrategy {
  simulated_revenue: number;
  uplift_vs_baseline: number;
  margin_floor_violations: number;
}

export interface HoldoutResult {
  /** Revenue uplift fraction relative to baseline (e.g. 0.12 = +12%) */
  holdout_uplift: number;
  baseline_revenue: number;
  final_revenue: number;
}

export interface DiffField<T = unknown> {
  before: T;
  after: T;
  changed: boolean;
}

export interface StrategyDiff {
  title: DiffField<string>;
  top_copy: DiffField<string>;
  price: DiffField<number>;
}

export interface ArtifactMeta {
  path: string;
  written_at: string;
}
