// ==========================================================
//  Seller War Game — Dashboard Client JS
//  PRD §12, §13, §16
// ==========================================================

import { ParticleEngine } from './particle-engine.mjs';

// ── Global particle engine reference (initialized after force-graph) ──
/** @type {ParticleEngine|null} */
let _particleEngine = null;

// ── Element refs ──────────────────────────────────────────
// Input Panel
const elProductBrand        = document.querySelector('[data-testid="product-brand"]');
const elProductName         = document.querySelector('[data-testid="product-name"]');
const elInputTitle          = document.querySelector('[data-testid="input-title"]');
const elInputTopCopy        = document.querySelector('[data-testid="input-top-copy"]');
const elInputPrice          = document.querySelector('[data-testid="input-price"]');
const elInputCost           = document.querySelector('[data-testid="input-cost"]');
const elMarginRateValue     = document.getElementById('margin-rate-value');

// Competitors
const elCompetitorA         = document.querySelector('[data-testid="competitor-a"]');
const elCompetitorB         = document.querySelector('[data-testid="competitor-b"]');
const elCompetitorC         = document.querySelector('[data-testid="competitor-c"]');

// Settings
const iterationInput        = document.querySelector('[data-testid="input-iteration-count"]');
const marginInput           = document.querySelector('[data-testid="input-margin-floor"]');

// Archetype weights card (Sub-AC 4b)
const ARCHETYPE_IDS = [
  'price_sensitive', 'value_seeker', 'premium_quality', 'trust_first',
  'aesthetics_first', 'urgency_buyer', 'promo_hunter', 'gift_or_family_buyer',
];
/** @type {Record<string, HTMLInputElement>} */
const archetypeCountInputs = Object.fromEntries(
  ARCHETYPE_IDS.map(id => [id, document.querySelector(`[data-testid="count-${id}"]`)])
);
const elAgentTotalDisplay   = document.querySelector('[data-testid="agent-total"]');
const elGenderMaleCount     = document.querySelector('[data-testid="gender-male-count"]');
const elGenderFemaleCount   = document.querySelector('[data-testid="gender-female-count"]');
const elGenderTotalDisplay  = document.getElementById('gender-total-display');

/**
 * Read all 8 archetype count inputs and return { archetypeCounts, total, isValid }.
 */
function readArchetypeCounts() {
  const counts = {};
  for (const id of ARCHETYPE_IDS) {
    const el = archetypeCountInputs[id];
    counts[id] = el ? Math.max(0, Math.floor(Number(el.value) || 0)) : 0;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total, isValid: total === 800 };
}

/**
 * Read gender counts and return { male, female, total, isValid }.
 */
function readGenderCounts() {
  const male   = Math.max(0, Math.floor(Number(elGenderMaleCount?.value)   || 0));
  const female = Math.max(0, Math.floor(Number(elGenderFemaleCount?.value) || 0));
  const total  = male + female;
  return { male, female, total, isValid: total === 800 };
}

/**
 * Validate archetype total and gender total; update displays and btn-run state.
 * Sub-AC 7c: Both archetype total AND gender total must equal 800 to enable btn-run.
 * Shows red '✗ N명 부족' or '✗ N명 초과' when either total deviates from 800.
 */
function validateArchetypeCounts() {
  const { total, isValid } = readArchetypeCounts();
  const gender              = readGenderCounts();
  const bothValid           = isValid && gender.isValid;

  // Update agent-total display — Sub-AC 7c: show 부족/초과 with exact N count
  if (elAgentTotalDisplay) {
    if (isValid) {
      elAgentTotalDisplay.textContent = '800명 ✓';
      elAgentTotalDisplay.classList.remove('invalid');
    } else {
      const diff = 800 - total;
      // 부족 when under 800, 초과 when over 800
      const diffLabel = diff > 0
        ? `${diff}명 부족`
        : `${Math.abs(diff)}명 초과`;
      elAgentTotalDisplay.textContent = `${total}명 ✗ ${diffLabel}`;
      elAgentTotalDisplay.classList.add('invalid');
    }
  }

  // Update gender total display — Sub-AC 7c: show 부족/초과
  if (elGenderTotalDisplay) {
    if (gender.isValid) {
      elGenderTotalDisplay.textContent = '합계 800 ✓';
      elGenderTotalDisplay.style.color = 'var(--accent-green)';
    } else {
      const gDiff = 800 - gender.total;
      const gDiffLabel = gDiff > 0
        ? `${gDiff}명 부족`
        : `${Math.abs(gDiff)}명 초과`;
      elGenderTotalDisplay.textContent = `합계 ${gender.total} ✗ ${gDiffLabel}`;
      elGenderTotalDisplay.style.color = 'var(--accent-red)';
    }
  }

  // Sub-AC 7c: Disable btn-run unless BOTH archetype AND gender totals = 800
  if (runButton && !_isRunning) {
    runButton.disabled = !bothValid;
    if (!isValid && statusEl) {
      statusEl.textContent = `에이전트 합계가 800명이어야 합니다 (현재 ${total}명)`;
    } else if (!gender.isValid && statusEl) {
      statusEl.textContent = `성별 합계가 800명이어야 합니다 (현재 ${gender.total}명)`;
    } else if (bothValid && statusEl &&
               (statusEl.textContent.includes('에이전트') || statusEl.textContent.includes('성별'))) {
      statusEl.textContent = '시뮬레이션 실행 준비 완료';
    }
  }

  return bothValid;
}

/**
 * Sub-AC 7c: Enforce integer-only input — strip decimals and clamp to [0, 800].
 * Called on 'input' event before validateArchetypeCounts.
 * @param {HTMLInputElement} el
 */
function enforceIntegerInput(el) {
  const raw = el.value;
  // If the value contains a decimal point, floor it
  if (raw.includes('.')) {
    el.value = String(Math.max(0, Math.floor(Number(raw) || 0)));
  }
}

// Attach change listeners to archetype count inputs
function initArchetypeInputListeners() {
  for (const id of ARCHETYPE_IDS) {
    const el = archetypeCountInputs[id];
    if (el) {
      el.addEventListener('input', () => { enforceIntegerInput(el); validateArchetypeCounts(); });
      el.addEventListener('change', () => { enforceIntegerInput(el); validateArchetypeCounts(); });
    }
  }
  if (elGenderMaleCount) {
    elGenderMaleCount.addEventListener('input', () => { enforceIntegerInput(elGenderMaleCount); validateArchetypeCounts(); });
    elGenderMaleCount.addEventListener('change', () => { enforceIntegerInput(elGenderMaleCount); validateArchetypeCounts(); });
  }
  if (elGenderFemaleCount) {
    elGenderFemaleCount.addEventListener('input', () => { enforceIntegerInput(elGenderFemaleCount); validateArchetypeCounts(); });
    elGenderFemaleCount.addEventListener('change', () => { enforceIntegerInput(elGenderFemaleCount); validateArchetypeCounts(); });
  }
}

// Run controls
const runButton             = document.querySelector('[data-testid="btn-run"]');
const statusEl              = document.querySelector('[data-testid="status-text"]');

// Simulation running flag — used to prevent archetype validation from
/** @type {AbortController|null} */
let _abortController = null;
// re-enabling btn-run mid-run (the finally block handles that)
let _isRunning = false;

// Simulation panel state elements
const simStateEmpty         = document.getElementById('sim-state-empty');
const simStateLoading       = document.getElementById('sim-state-loading');
const simStateCompleted     = document.getElementById('sim-state-completed');
const simProgress           = document.getElementById('sim-progress');
const simProgressBar        = document.getElementById('sim-progress-bar');
const simIterationLabel     = document.getElementById('sim-iteration-label');

// Results panel state elements
const resultsStateEmpty     = document.getElementById('results-state-empty');
const resultsStateError     = document.getElementById('results-state-error');
const resultsContent        = document.getElementById('results-content');
const errorMessage          = document.getElementById('error-message');

// Results panel — metrics (data-testid refs)
const elMetricBaseline      = document.querySelector('[data-testid="metric-baseline"]');
const elMetricFinal         = document.querySelector('[data-testid="metric-final"]');
const elMetricHoldout       = document.querySelector('[data-testid="metric-holdout"]');

// Results panel — strategy summary
const elStrategyTitle       = document.getElementById('strategy-title');
const elStrategyCopy        = document.getElementById('strategy-copy');
const elStrategyPrice       = document.getElementById('strategy-price');
const elStrategyMargin      = document.getElementById('strategy-margin');
const elStrategyRationale   = document.getElementById('strategy-rationale');

// Results panel — diff
const elDiffTitleBefore     = document.getElementById('diff-title-before');
const elDiffTitleAfter      = document.getElementById('diff-title-after');
const elDiffCopyBefore      = document.getElementById('diff-copy-before');
const elDiffCopyAfter       = document.getElementById('diff-copy-after');
const elDiffPriceBefore     = document.getElementById('diff-price-before');
const elDiffPriceAfter      = document.getElementById('diff-price-after');

// Results panel — artifact
const elArtifactStrategyId  = document.getElementById('artifact-strategy-id');
const elArtifactUplift      = document.getElementById('artifact-holdout-uplift');
const elArtifactTimestamp   = document.getElementById('artifact-timestamp');

// Legacy ID refs (kept for backward compatibility — dashboard-smoke.test.mjs checks these)
const artifactOutput        = document.getElementById('artifactOutput');

// Agent log (Sub-AC 5a)
const elAgentLog            = document.getElementById('agent-log');
const elAgentLogEntries     = document.getElementById('agent-log-entries');
const elAgentLogCount       = document.getElementById('agent-log-count');
const elAgentLogEmpty       = document.getElementById('agent-log-empty');

// Revenue chart (Sub-AC 6a)
const elRevenueChart        = document.getElementById('revenue-chart');
const elRevenueChartSvg     = document.getElementById('revenue-chart-svg');
const elRevenueChartBars    = document.getElementById('revenue-chart-bars');
const elRevenueBaselineLine = document.getElementById('revenue-baseline-line');
const elRevenueBaselineLabel= document.getElementById('revenue-baseline-label');
const elRevenueChartYAxis   = document.getElementById('revenue-chart-yaxis');
const elRevenueChartXAxis   = document.getElementById('revenue-chart-xaxis');
const elRevenueChartGrid    = document.getElementById('revenue-chart-grid');
const elRevenueChartTooltip = document.getElementById('revenue-chart-tooltip');
// Popup chart elements (revenue chart mirrored in results popup)
const elPopupRevenueChartSvg      = document.getElementById('popup-revenue-chart-svg');
const elPopupRevenueChartBars     = document.getElementById('popup-revenue-chart-bars');
const elPopupRevenueBaselineLine  = document.getElementById('popup-revenue-baseline-line');
const elPopupRevenueBaselineLabel = document.getElementById('popup-revenue-baseline-label');
const elPopupRevenueChartYAxis    = document.getElementById('popup-revenue-chart-yaxis');
const elPopupRevenueChartGrid     = document.getElementById('popup-revenue-chart-grid');
const elPopupRevenueChartTooltip  = document.getElementById('popup-revenue-chart-tooltip');

// Insights panel (Sub-AC 6b)
const elInsightsPanel       = document.getElementById('insights-panel');
const elInsightsList        = document.getElementById('insights-list');

// Particle flow SVG indicator — Sub-AC 6b (🦞 shown during simulation)
const elSimLobsterIndicator     = document.getElementById('sim-lobster-indicator');

// Strategy Lobster (PRD §12.11 + §16 — Sub-AC 4d)
const elStrategyLobster         = document.getElementById('strategy-lobster');
const elStrategyIterationLabel  = document.querySelector('[data-testid="strategy-iteration-label"]');
const elStrategyLobsterRationale= document.getElementById('strategy-lobster-rationale');
const strategyLobsterCandidates = [1, 2, 3].map(n => ({
  card:      document.getElementById(`strategy-candidate-${n}`),
  title:     document.getElementById(`candidate-${n}-title`),
  price:     document.getElementById(`candidate-${n}-price`),
  rationale: document.getElementById(`candidate-${n}-rationale`),
  winner:    document.getElementById(`candidate-${n}-winner`),
}));

// Results Popup (PRD §12.10 + §16 — Sub-AC 4d)
const elResultsPopup            = document.getElementById('results-popup');
const elResultsPopupBackdrop    = document.getElementById('results-popup-backdrop');
const elResultsPopupClose       = document.getElementById('results-popup-close');
const elResultsPopupBody        = document.getElementById('results-popup-body');
const elResultsPopupMetrics     = document.getElementById('results-popup-metrics');
const elResultsPopupGrid        = document.getElementById('results-popup-grid');
const elResultsPopupArtifact    = document.getElementById('results-popup-artifact');
const elBtnShowResults          = document.getElementById('btnShowResults');

// Agent Count & Archetype Summary (Sub-AC 4c)
const elAgentCount              = document.getElementById('agent-count');
const elArchetypeSummaryWrap    = document.getElementById('archetype-summary-wrap');
const elArchetypeSummaryIter    = document.getElementById('archetype-summary-iteration');
const elArchetypeSummaryTbody   = document.getElementById('archetype-summary-tbody');
const elArchetypeSummaryTfoot   = document.getElementById('archetype-summary-tfoot-row');

// Product Bucket Panel (Sub-AC 6c) — HTML overlay on right side of canvas
const elProductBucketPanel = document.getElementById('product-bucket-panel');
/** @type {Record<string, HTMLElement|null>} bucket count display elements */
const elBucketCounts = {};
/** @type {Record<string, HTMLElement|null>} bucket bar fill elements */
const elBucketBars = {};

// Product Counter Overlays (Sub-AC 4c) — now using HTML bucket panel elements (Sub-AC 6c)
// data-testid="product-counter-{id}" lives on the HTML bucket count divs
const PRODUCT_COUNTER_IDS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
/** @type {Record<string, HTMLElement|null>} primary counter elements (data-testid) */
const elProductCounters = {};
/** @type {Record<string, SVGTextElement|null>} SVG overlay text elements (visual only) */
const elSvgProductCounters = {};
for (const id of PRODUCT_COUNTER_IDS) {
  // HTML bucket count div carries the canonical data-testid (Sub-AC 6c)
  elProductCounters[id] = document.getElementById(`bucket-count-${id}`);
  // SVG text overlay for visual display during animation (data-svg-counter-id, no data-testid)
  elSvgProductCounters[id] = document.querySelector(`.product-counter[data-svg-counter-id="${id}"]`);
  // Bucket panel display elements (Sub-AC 6c)
  elBucketCounts[id] = document.getElementById(`bucket-count-${id}`);
  elBucketBars[id]   = document.getElementById(`bucket-bar-${id}`);
}

/** Live running totals per product bucket in the current iteration */
const _productCounterState = {
  our_product:  0,
  competitor_a: 0,
  competitor_b: 0,
  competitor_c: 0,
  pass:         0,
};

// ── Helpers ───────────────────────────────────────────────

function formatKRW(value) {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(value);
}

function computeMarginRate(price, cost) {
  if (!price || price <= 0) return null;
  return ((price - cost) / price * 100).toFixed(1);
}

function updateMarginDisplay() {
  const price = Number(elInputPrice?.value ?? 0);
  const cost  = Number(elInputCost?.value  ?? 0);
  const rate  = computeMarginRate(price, cost);
  if (elMarginRateValue) {
    elMarginRateValue.textContent = rate != null ? `${rate}%` : '—';
  }
}

/** Enable or disable all 6 editable input fields */
function setInputsDisabled(disabled) {
  [elInputTitle, elInputTopCopy, elInputPrice, elInputCost, iterationInput, marginInput].forEach((el) => {
    if (el) el.disabled = disabled;
  });
  // Also disable archetype + gender inputs during run
  for (const el of Object.values(archetypeCountInputs)) {
    if (el) el.disabled = disabled;
  }
  if (elGenderMaleCount)   elGenderMaleCount.disabled   = disabled;
  if (elGenderFemaleCount) elGenderFemaleCount.disabled = disabled;
}

// ── Fixture Loader ────────────────────────────────────────

async function loadFixture() {
  try {
    const res = await fetch('/api/fixtures');
    if (!res.ok) throw new Error('Fixtures load failed');
    const json = await res.json();

    const p = json.product ?? {};

    // Populate read-only identity — SwarmOps branding
    if (elProductBrand) elProductBrand.textContent = 'SwarmOps';
    if (elProductName)  elProductName.textContent  = 'SwarmOps';

    // Populate editable fields
    if (elInputTitle   && p.current_title)       elInputTitle.value    = p.current_title;
    if (elInputTopCopy && p.current_top_copy)    elInputTopCopy.value  = p.current_top_copy;
    if (elInputPrice   && p.current_price_krw)   elInputPrice.value    = p.current_price_krw;
    if (elInputCost    && p.current_cost_krw)    elInputCost.value     = p.current_cost_krw;

    // Populate competitor rows
    const competitors = json.competitors ?? [];
    function fillCompetitor(el, comp) {
      if (!el || !comp) return;
      const nameEl  = el.querySelector('span:first-child');
      const priceEl = el.querySelector('.competitor-price');
      // Use brand_name for compact display; fall back to product_name if absent
      if (nameEl)  nameEl.textContent  = comp.brand_name ?? comp.product_name ?? '';
      if (priceEl) priceEl.textContent = formatKRW(comp.price_krw ?? 0);
    }
    fillCompetitor(elCompetitorA, competitors.find(c => c.id === 'competitor_a'));
    fillCompetitor(elCompetitorB, competitors.find(c => c.id === 'competitor_b'));
    fillCompetitor(elCompetitorC, competitors.find(c => c.id === 'competitor_c'));

    // Populate archetype count inputs from fixture cohort_weight_percent (Sub-AC 7b)
    // Mapping: fixture uses 'desperate_hairloss'; UI uses 'urgency_buyer' for the same archetype
    const FIXTURE_ID_TO_UI_ID = { 'desperate_hairloss': 'urgency_buyer' };
    const archetypes = json.archetypes ?? [];
    if (archetypes.length > 0) {
      for (const arch of archetypes) {
        const fixtureId = arch.id;
        const uiId      = FIXTURE_ID_TO_UI_ID[fixtureId] ?? fixtureId;
        const pct       = Number(arch.cohort_weight_percent ?? 0);
        const el        = archetypeCountInputs[uiId];
        if (el && pct > 0) {
          // Convert percent → agent count: cohort_weight_percent × 800 (Sub-AC 7b)
          el.value = Math.round(800 * pct / 100);
        }
      }
      validateArchetypeCounts();
    }

    // Populate settings defaults
    const defs = json.defaults ?? {};
    if (iterationInput && defs.iteration_count)       iterationInput.value = defs.iteration_count;
    if (marginInput    && defs.minimum_margin_floor)  marginInput.value    = defs.minimum_margin_floor;

    // Update margin display after fixture load
    updateMarginDisplay();
  } catch (err) {
    console.warn('loadFixture error:', err);
    // Show a non-blocking status hint so the user knows fixture data failed to load
    if (statusEl) statusEl.textContent = '⚠ 설정 데이터 로드 실패 — 기본값을 사용합니다';
  }
}

// ── Margin auto-update ────────────────────────────────────
elInputPrice?.addEventListener('input', updateMarginDisplay);
elInputCost?.addEventListener('input',  updateMarginDisplay);

// Initial margin display
updateMarginDisplay();

// ── UI State Management ────────────────────────────────────

function showLoadingState() {
  // Sub-AC 6d: Remove frozen state from previous simulation run
  // Sub-AC 6e: Add sim-running class for canvas overlay glow styling
  const canvasWrap = document.getElementById('sim-canvas-wrap');
  if (canvasWrap) {
    canvasWrap.classList.remove('sim-frozen');
    canvasWrap.classList.add('sim-running');
  }
  // Sub-AC 6e: Show seller-role badge overlay
  const sellerBadge = document.getElementById('canvas-seller-badge');
  if (sellerBadge) sellerBadge.classList.add('visible');

  // Show 🦞 lobster indicator in SVG during simulation — Sub-AC 6b
  if (elSimLobsterIndicator) elSimLobsterIndicator.style.display = 'block';

  // Simulation panel
  if (simStateEmpty)     simStateEmpty.style.display     = 'none';
  if (simStateLoading)   simStateLoading.style.display   = 'block';
  if (simStateCompleted) simStateCompleted.style.display = 'none';
  if (simProgress) {
    simProgress.style.display       = 'flex';
    simProgress.style.flexDirection = 'column';
    simProgress.style.gap           = 'var(--space-xs)';
  }
  if (simProgressBar) simProgressBar.style.width = '0%';

  // Show agent log panel with reset state
  resetAgentLog();
  // Show and reset revenue chart
  resetRevenueChart();
  // Reset insights panel (Sub-AC 6b)
  resetInsightsPanel();
  // Reset agent count display and archetype summary (Sub-AC 4c)
  _agentCountCurrent = 0;
  if (elAgentCount) {
    elAgentCount.textContent = `0 / ${_agentCountTotal} 에이전트 완료`;
    elAgentCount.style.display = 'none';  // hidden until first agent_decision arrives
  }
  if (elArchetypeSummaryWrap) elArchetypeSummaryWrap.style.display = 'none';
  // Reset product bucket counters (Sub-AC 4c)
  resetProductCounters();
  // Show product bucket panel on right side of canvas (Sub-AC 6c)
  if (elProductBucketPanel) {
    elProductBucketPanel.style.display = 'flex';
    elProductBucketPanel.style.flexDirection = 'column';
    elProductBucketPanel.style.justifyContent = 'center';
  }

  // Results panel — hide previous results while running
  if (resultsStateEmpty) resultsStateEmpty.style.display = 'none';
  if (resultsStateError) resultsStateError.style.display = 'none';
  if (resultsContent)    resultsContent.style.display    = 'none';
}

function showCompletedState() {
  // Hide 🦞 lobster indicator after simulation ends — Sub-AC 6b
  if (elSimLobsterIndicator) elSimLobsterIndicator.style.display = 'none';

  // Simulation panel
  if (simStateLoading)   simStateLoading.style.display   = 'none';
  if (simStateCompleted) simStateCompleted.style.display = 'block';
  if (simStateEmpty)     simStateEmpty.style.display     = 'none';
  if (simProgressBar)    simProgressBar.style.width      = '100%';
}

function showErrorState(message) {
  // Hide 🦞 lobster indicator on error — Sub-AC 6b
  if (elSimLobsterIndicator) elSimLobsterIndicator.style.display = 'none';

  // Simulation panel
  if (simStateLoading)   simStateLoading.style.display   = 'none';
  if (simStateCompleted) simStateCompleted.style.display = 'none';

  // Results panel — show error card
  if (resultsStateEmpty) resultsStateEmpty.style.display = 'none';
  if (resultsContent)    resultsContent.style.display    = 'none';
  if (resultsStateError) resultsStateError.style.display = 'block';
  if (errorMessage)      errorMessage.textContent        = message || '알 수 없는 오류가 발생했습니다.';

  if (statusEl) statusEl.textContent = `오류: ${message}`;
}

function showResultsPanel() {
  if (resultsStateEmpty) resultsStateEmpty.style.display = 'none';
  if (resultsStateError) resultsStateError.style.display = 'none';
  if (resultsContent) {
    resultsContent.style.display       = 'flex';
    resultsContent.style.flexDirection = 'column';
    resultsContent.style.gap           = 'var(--card-gap)';
  }
}

// ── Product node color map (PRD §12.3) ────────────────────
const PRODUCT_COLORS = {
  our_product:  '#2563eb',
  competitor_a: '#dc2626',
  competitor_b: '#ea580c',
  competitor_c: '#ca8a04',
  pass:         '#6b7280',
};

// ── Archetype color map (for agent log dots) ──────────────
const ARCHETYPE_COLORS = {
  price_sensitive:      '#38bdf8',  // sky-400
  value_seeker:         '#34d399',  // emerald-400
  premium_quality:      '#fbbf24',  // amber-400
  trust_first:          '#a78bfa',  // violet-400
  aesthetics_first:     '#f472b6',  // pink-400
  urgency_buyer:        '#fb923c',  // orange-400
  promo_hunter:         '#f87171',  // red-400
  gift_or_family_buyer: '#c084fc',  // purple-400
};

// ── Product display labels for the agent log ──────────────
const PRODUCT_LABELS = {
  our_product:  '트리클리닉',
  competitor_a: '경쟁A',
  competitor_b: '경쟁B',
  competitor_c: '경쟁C',
  pass:         '패스',
};

// ── Archetype Korean display labels (Sub-AC 4c) ───────────
const ARCHETYPE_LABELS = {
  price_sensitive:      '가격민감형',
  value_seeker:         '가성비균형형',
  premium_quality:      '프리미엄형',
  trust_first:          '신뢰우선형',
  aesthetics_first:     '감성형',
  urgency_buyer:        '문제해결형',
  promo_hunter:         '할인반응형',
  gift_or_family_buyer: '가족구매형',
};

// Ordered list of product keys for the summary table columns
const PRODUCT_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];

// ── Agent Count State (Sub-AC 4c) ─────────────────────────
/** Number of agent_decision events received in the current iteration */
let _agentCountCurrent = 0;
/** Expected total agents per iteration (from agent_total field) */
let _agentCountTotal   = 800;

/**
 * Reset agent count display for a new iteration.
 */
function resetAgentCount() {
  _agentCountCurrent = 0;
  if (elAgentCount) {
    elAgentCount.textContent = `0 / ${_agentCountTotal} 에이전트 완료`;
    elAgentCount.style.display = 'inline-flex';
  }
}

/**
 * Increment and update the agent count display.
 * @param {number} agentTotal - Total expected agents (from event.agent_total)
 */
function updateAgentCount(agentTotal) {
  _agentCountTotal   = agentTotal ?? _agentCountTotal;
  _agentCountCurrent = Math.min(_agentCountCurrent + 1, _agentCountTotal);
  if (elAgentCount) {
    elAgentCount.textContent = `${_agentCountCurrent} / ${_agentCountTotal} 에이전트 완료`;
    elAgentCount.style.display = 'inline-flex';
  }
}

// ── Product Counter State & Functions (Sub-AC 4c) ─────────

/**
 * Reset all product bucket counters to 0.
 * Called at the start of each iteration and on simulation reset.
 */
function resetProductCounters() {
  for (const id of PRODUCT_COUNTER_IDS) {
    _productCounterState[id] = 0;
    // Reset HTML bucket count (canonical, data-testid element)
    const el = elProductCounters[id];
    if (el) el.textContent = '0';
    // Reset SVG overlay text (visual)
    const svgEl = elSvgProductCounters[id];
    if (svgEl) svgEl.textContent = '0';
    // Reset bucket panel bar
    const barEl = elBucketBars[id];
    if (barEl) barEl.style.width = '0%';
  }
}

/**
 * Update the bucket zone panel bars based on current counter state.
 * Called after incrementProductCounter to keep bars proportional.
 * @private
 */
function _updateBucketPanelBars() {
  const total = PRODUCT_COUNTER_IDS.reduce((sum, id) => sum + (_productCounterState[id] || 0), 0);
  if (total === 0) return;
  for (const id of PRODUCT_COUNTER_IDS) {
    const pct = Math.round((_productCounterState[id] / total) * 100);
    const barEl = elBucketBars[id];
    if (barEl) barEl.style.width = `${pct}%`;
  }
}

/**
 * Increment the counter for a given product bucket.
 * Called after the particle animation completes (~200ms after agent_decision event).
 * @param {string} productId - One of our_product, competitor_a, competitor_b, competitor_c, pass
 */
function incrementProductCounter(productId) {
  if (!(productId in _productCounterState)) return;
  _productCounterState[productId]++;
  const val = String(_productCounterState[productId]);
  // Update HTML bucket count (canonical, data-testid element — Sub-AC 6c)
  const el = elProductCounters[productId];
  if (el) el.textContent = val;
  // Update SVG overlay text (visual — Sub-AC 4c)
  const svgEl = elSvgProductCounters[productId];
  if (svgEl) svgEl.textContent = val;
  // Update proportional bars
  _updateBucketPanelBars();
}

/**
 * Normalize archetype_breakdown to legacy flat format for consumers
 * (like populateInsightsPanel) that expect plain number values.
 *
 * Handles:
 *   - Sub-AC 3c explicit array format: [{archetype_id, choices: {key: {count, pct}}}]
 *   - Legacy flat object format: { archetypeId: { our_product: N, ... } }
 *
 * @param {Array|Object|null} breakdown
 * @returns {Object} Flat format: { archetypeId: { our_product: N, ... } }
 */
function normalizeArchetypeBreakdownToFlat(breakdown) {
  if (!breakdown) return {};
  if (Array.isArray(breakdown)) {
    const flat = {};
    for (const item of breakdown) {
      const id = item.archetype_id;
      if (!id || typeof id !== 'string') continue;
      flat[id] = {};
      for (const k of PRODUCT_KEYS) {
        const v = item.choices ? item.choices[k] : null;
        flat[id][k] = (v !== null && typeof v === 'object' && 'count' in v)
          ? (v.count ?? 0)
          : (typeof v === 'number' ? v : 0);
      }
    }
    return flat;
  }
  // Already flat format
  return breakdown;
}

/**
 * Render the per-archetype breakdown table from an iteration_complete event.
 *
 * Handles two archetype_breakdown formats:
 *   - Sub-AC 3c explicit array format (from SSE stream formatter):
 *       [{archetype_id, archetype_label, sample_size, choices: {key: {count, pct}}}]
 *   - Legacy flat object format (from mock tests and engine direct output):
 *       { archetypeId: { our_product: N, competitor_a: N, ... } }
 *
 * @param {Array|Object} archetypeBreakdown
 * @param {number} iteration - Current iteration number (1-based)
 */
function renderArchetypeSummary(archetypeBreakdown, iteration) {
  if (!elArchetypeSummaryTbody || !elArchetypeSummaryTfoot) return;

  // Show the summary panel
  if (elArchetypeSummaryWrap) elArchetypeSummaryWrap.style.display = 'flex';
  if (elArchetypeSummaryIter) {
    elArchetypeSummaryIter.textContent = `Iteration ${iteration ?? '—'}`;
  }

  // Accumulate totals for the footer row
  const totalCounts = { our_product: 0, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 };
  let grandTotal = 0;

  /** @type {Array<{archetypeId: string, label: string, choices: Object, rowTotal: number, ourPct: string}>} */
  let rows = [];

  if (Array.isArray(archetypeBreakdown)) {
    // ── Sub-AC 3c explicit array format ───────────────────────────────────
    // archetype_breakdown is [{archetype_id, archetype_label, sample_size, choices: {key: {count, pct}}}]
    rows = archetypeBreakdown.map((item) => {
      const archetypeId = item.archetype_id ?? '';
      const label = item.archetype_label ?? ARCHETYPE_LABELS[archetypeId] ?? archetypeId;
      // Sub-AC 6d: extract BOTH count and pct for per-archetype choice percentages
      const flatChoices = {};
      /** @type {Record<string, number>} Per-product percentage values (0–100) */
      const choicePcts = {};
      for (const k of PRODUCT_KEYS) {
        const v = item.choices ? item.choices[k] : null;
        if (v !== null && typeof v === 'object' && 'count' in v) {
          flatChoices[k] = v.count ?? 0;
          choicePcts[k]  = v.pct   ?? 0;  // use pre-computed pct from stream-formatter
        } else {
          flatChoices[k] = typeof v === 'number' ? v : 0;
          choicePcts[k]  = null;  // compute from total below
        }
      }
      const rowTotal = PRODUCT_KEYS.reduce((sum, k) => sum + flatChoices[k], 0);
      PRODUCT_KEYS.forEach((k) => { totalCounts[k] += flatChoices[k]; });
      grandTotal += rowTotal;
      // Compute any missing pct values from counts
      for (const k of PRODUCT_KEYS) {
        if (choicePcts[k] == null) {
          choicePcts[k] = rowTotal > 0 ? parseFloat((flatChoices[k] / rowTotal * 100).toFixed(1)) : 0;
        }
      }
      const ourPct = rowTotal > 0 ? (flatChoices.our_product / rowTotal * 100).toFixed(0) : '0';
      return { archetypeId, label, choices: flatChoices, choicePcts, rowTotal, ourPct };
    });
  } else {
    // ── Legacy flat object format ──────────────────────────────────────────
    // archetype_breakdown is { archetypeId: { our_product: N, ... } }
    rows = Object.entries(archetypeBreakdown ?? {}).map(([archetypeId, choices]) => {
      const rowTotal = PRODUCT_KEYS.reduce((sum, k) => sum + (choices[k] ?? 0), 0);
      PRODUCT_KEYS.forEach((k) => { totalCounts[k] = (totalCounts[k] ?? 0) + (choices[k] ?? 0); });
      grandTotal += rowTotal;
      // Sub-AC 6d: compute per-archetype choice percentages for each product
      /** @type {Record<string, number>} Per-product percentage values (0–100) */
      const choicePcts = {};
      for (const k of PRODUCT_KEYS) {
        choicePcts[k] = rowTotal > 0
          ? parseFloat(((choices[k] ?? 0) / rowTotal * 100).toFixed(1))
          : 0;
      }
      const ourPct = rowTotal > 0 ? ((choices.our_product ?? 0) / rowTotal * 100).toFixed(0) : '0';
      const label = ARCHETYPE_LABELS[archetypeId] ?? archetypeId;
      return { archetypeId, label, choices, choicePcts, rowTotal, ourPct };
    });
  }

  /**
   * Build CSS class for a product percentage cell.
   * Sub-AC 6d: highlight green if our_product% is highest, red if lowest.
   * @param {string} productKey
   * @param {Record<string, number>} choicePcts
   * @returns {string}
   */
  function cellClass(productKey, choicePcts) {
    if (productKey !== 'our_product') return '';
    // Compare our_product pct vs all other non-pass products
    const ourPctVal = choicePcts.our_product ?? 0;
    const compPcts  = ['competitor_a', 'competitor_b', 'competitor_c'].map((k) => choicePcts[k] ?? 0);
    const maxComp   = Math.max(...compPcts);
    const minComp   = Math.min(...compPcts);
    if (ourPctVal >= maxComp) return ' cell-our cell-our-best';
    if (ourPctVal <= minComp) return ' cell-our cell-our-worst';
    return ' cell-our';
  }

  // Build tbody HTML — Sub-AC 6d: show per-archetype choice percentages in product columns
  elArchetypeSummaryTbody.innerHTML = rows.map(({ label, choices, choicePcts, rowTotal, ourPct }) => {
    const ourClass = cellClass('our_product', choicePcts);
    return `
      <tr>
        <td>${label}</td>
        <td class="${ourClass.trim() || 'cell-our'}">${(choicePcts.our_product ?? 0).toFixed(0)}%</td>
        <td>${(choicePcts.competitor_a ?? 0).toFixed(0)}%</td>
        <td>${(choicePcts.competitor_b ?? 0).toFixed(0)}%</td>
        <td>${(choicePcts.competitor_c ?? 0).toFixed(0)}%</td>
        <td>${(choicePcts.pass ?? 0).toFixed(0)}%</td>
        <td class="cell-total">${rowTotal}</td>
        <td class="cell-pct">${ourPct}%</td>
      </tr>
    `.trim();
  }).join('');

  // Build tfoot totals row — show aggregate percentages across all archetypes
  const totalOurPct = grandTotal > 0 ? ((totalCounts.our_product) / grandTotal * 100).toFixed(0) : '0';
  const totalCompAPct = grandTotal > 0 ? (totalCounts.competitor_a / grandTotal * 100).toFixed(0) : '0';
  const totalCompBPct = grandTotal > 0 ? (totalCounts.competitor_b / grandTotal * 100).toFixed(0) : '0';
  const totalCompCPct = grandTotal > 0 ? (totalCounts.competitor_c / grandTotal * 100).toFixed(0) : '0';
  const totalPassPct  = grandTotal > 0 ? (totalCounts.pass          / grandTotal * 100).toFixed(0) : '0';
  elArchetypeSummaryTfoot.innerHTML = `
    <td>합계</td>
    <td class="cell-our">${totalOurPct}%</td>
    <td>${totalCompAPct}%</td>
    <td>${totalCompBPct}%</td>
    <td>${totalCompCPct}%</td>
    <td>${totalPassPct}%</td>
    <td class="cell-total">${grandTotal}</td>
    <td class="cell-pct">${totalOurPct}%</td>
  `.trim();
}

// ── Agent Log State ───────────────────────────────────────
const AGENT_LOG_MAX_ENTRIES = 800;   // Sub-AC 1: support up to 800 entries per iteration
let _agentLogCount   = 0;
let _agentLogTotal   = 0;

/** Reset the agent log for a new simulation run */
function resetAgentLog() {
  _agentLogCount = 0;
  _agentLogTotal = 0;
  // Remove only the agent-log-entry elements, not the static empty placeholder
  if (elAgentLogEntries) {
    const entries = elAgentLogEntries.querySelectorAll('[data-testid="agent-log-entry"]');
    entries.forEach((el) => el.remove());
  }
  // Re-show the empty placeholder (it stays in the DOM as it's outside the entry list)
  if (elAgentLogEmpty)   elAgentLogEmpty.style.display = 'block';
  if (elAgentLogCount)   elAgentLogCount.textContent   = '0 / 0';
  // Show log panel when simulation starts
  if (elAgentLog)        elAgentLog.style.display = 'block';
}

/**
 * Append one agent decision entry to the chat log.
 * @param {{ agent_name: string, archetype_id: string, chosen_product: string, reasoning: string, agent_index: number, agent_total: number }} data
 */
function addAgentLogEntry(data) {
  if (!elAgentLogEntries) return;

  // Hide empty placeholder on first entry
  if (elAgentLogEmpty && _agentLogCount === 0) {
    elAgentLogEmpty.style.display = 'none';
  }

  _agentLogCount++;
  _agentLogTotal = data.agent_total || _agentLogTotal;

  // Update counter label
  if (elAgentLogCount) {
    elAgentLogCount.textContent = `${_agentLogCount} / ${_agentLogTotal}`;
  }

  // Prune oldest entries if over the cap (remove first child in the entries list)
  while (elAgentLogEntries.children.length >= AGENT_LOG_MAX_ENTRIES) {
    elAgentLogEntries.removeChild(elAgentLogEntries.firstChild);
  }

  // Build archetype color dot
  const archetypeColor = ARCHETYPE_COLORS[data.archetype_id] ?? '#64748b';
  const productLabel   = PRODUCT_LABELS[data.chosen_product] ?? data.chosen_product ?? '알 수 없음';
  const reasoningText  = data.reasoning ?? '';

  // Create entry element
  const entry = document.createElement('div');
  entry.className = 'agent-log-entry clickable';
  entry.setAttribute('data-testid', 'agent-log-entry');
  entry.setAttribute('data-agent-id', data.agent_id ?? '');
  entry.setAttribute('data-archetype', data.archetype_id ?? '');
  // Store per-agent stats as data attributes for the profile popup (Sub-AC 5b)
  if (data.price_sensitivity != null) entry.setAttribute('data-price-sensitivity', data.price_sensitivity);
  if (data.trust_sensitivity  != null) entry.setAttribute('data-trust-sensitivity',  data.trust_sensitivity);
  if (data.promo_affinity     != null) entry.setAttribute('data-promo-affinity',     data.promo_affinity);
  if (data.brand_bias         != null) entry.setAttribute('data-brand-bias',         data.brand_bias);
  if (data.pass_threshold     != null) entry.setAttribute('data-pass-threshold',     data.pass_threshold);
  if (data.budget_band        != null) entry.setAttribute('data-budget-band',        data.budget_band);
  // Store display fields for popup retrieval
  entry.setAttribute('data-agent-name',     data.agent_name ?? data.agent_id ?? '구매자');
  entry.setAttribute('data-chosen-product', data.chosen_product ?? 'pass');
  entry.setAttribute('data-reasoning',      data.reasoning ?? '');

  const dot = document.createElement('span');
  dot.className = 'agent-dot';
  dot.style.backgroundColor = archetypeColor;
  dot.style.color = archetypeColor;   // used for box-shadow currentColor
  dot.title = data.archetype_id ?? '';

  const body = document.createElement('div');
  body.className = 'agent-log-body';

  const meta = document.createElement('div');
  meta.className = 'agent-log-meta';

  const nameEl = document.createElement('span');
  nameEl.className = 'agent-name';
  nameEl.textContent = data.agent_name ?? data.agent_id ?? '구매자';

  // Archetype label (Sub-AC 1) — Korean label in parentheses e.g. "(가격민감형)"
  const archetypeLabel = ARCHETYPE_LABELS[data.archetype_id] ?? data.archetype_id ?? '';
  const archLabelEl = document.createElement('span');
  archLabelEl.className = 'agent-archetype-label';
  archLabelEl.textContent = archetypeLabel ? `(${archetypeLabel})` : '';

  const productEl = document.createElement('span');
  productEl.className = `agent-chosen-product choice-${data.chosen_product ?? 'pass'}`;
  productEl.textContent = productLabel;

  // Timestamp (Sub-AC 1) — HH:MM:SS format, right-aligned in meta row
  const tsEl = document.createElement('span');
  tsEl.className = 'agent-log-timestamp';
  const now = new Date();
  tsEl.textContent = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  tsEl.setAttribute('data-testid', 'agent-log-timestamp');

  meta.appendChild(nameEl);
  meta.appendChild(archLabelEl);
  meta.appendChild(productEl);
  meta.appendChild(tsEl);

  const reasonEl = document.createElement('p');
  reasonEl.className = 'agent-reasoning';
  reasonEl.textContent = reasoningText;

  body.appendChild(meta);
  body.appendChild(reasonEl);

  entry.appendChild(dot);
  entry.appendChild(body);

  elAgentLogEntries.appendChild(entry);

  // Auto-scroll to latest entry
  if (elAgentLog) {
    elAgentLog.scrollTop = elAgentLog.scrollHeight;
  }
}

// ── Revenue Chart State & Rendering (Sub-AC 6a) ───────────

/** Per-iteration revenue data: { iteration, revenue, accepted } */
let _revenueData = [];
/** Baseline revenue from simulation_complete event */
let _revenueBaseline = null;

/**
 * Cumulative array of all iteration_complete event payloads received during the
 * current simulation run.  Each entry preserves the full archetype_breakdown and
 * choice_summary fields so that both the revenue chart and insights panel can
 * consume properly aggregated data across all iterations.
 *
 * Shape per element:
 *   { iteration, winner_id, winner_revenue, accepted, rejected_count,
 *     choice_summary: ChoiceSummary, archetype_breakdown: ArchetypeBreakdown }
 *
 * @type {Array<import('../lib/simulation/sse-events.d.ts').IterationCompleteEvent>}
 */
let _iterationResults = [];

/** Reset the revenue chart for a new simulation run */
function resetRevenueChart() {
  _revenueData = [];
  _iterationResults = [];
  _revenueBaseline = null;
  if (elRevenueChartBars) elRevenueChartBars.innerHTML = '';
  if (elRevenueBaselineLine) elRevenueBaselineLine.setAttribute('opacity', '0');
  if (elRevenueBaselineLabel) elRevenueBaselineLabel.setAttribute('opacity', '0');
  if (elRevenueChart) elRevenueChart.style.display = 'block';
}

/**
 * Add an iteration data point and re-render the chart.
 * Also appends the full event payload to _iterationResults so that both
 * the revenue chart and the insights panel can consume the same source.
 * Called on iteration_complete SSE events.
 *
 * Sub-AC 6b: Revenue = choice_summary.our_product.count × product price_krw.
 * The first iteration's revenue is stored as the baseline reference line.
 *
 * @param {import('../lib/simulation/sse-events.d.ts').IterationCompleteEvent} data
 */
function addRevenueBar(data) {
  // ── Append full iteration payload to cumulative results store ──────────
  _iterationResults.push({
    iteration:           data.iteration,
    winner_id:           data.winner_id,
    winner_revenue:      data.winner_revenue ?? 0,
    accepted:            data.accepted !== false,
    rejected_count:      data.rejected_count ?? 0,
    choice_summary:      data.choice_summary      ?? null,
    archetype_breakdown: data.archetype_breakdown  ?? null,
  });

  // ── Sub-AC 6b: Revenue = winner_revenue from iteration_complete event ──────
  // Use winner_revenue directly (KRW integer from simulation engine).
  // Falls back to our_product count × price_krw if winner_revenue is absent.
  const revenue = (data.winner_revenue != null && data.winner_revenue > 0)
    ? data.winner_revenue
    : (() => {
        const cs = data.choice_summary ?? {};
        const ourProductEntry = cs.our_product;
        const ourProductCount = (ourProductEntry != null && typeof ourProductEntry === 'object')
          ? (ourProductEntry.count ?? 0)
          : (typeof ourProductEntry === 'number' ? ourProductEntry : 0);
        return ourProductCount * (Number(elInputPrice?.value) || 0);
      })();

  // ── Revenue chart point ─────────────────────────────────────────────────
  _revenueData.push({
    iteration: data.iteration,
    revenue,
    accepted:  data.accepted !== false,
  });

  // ── Sub-AC 6b: Baseline from iteration 0 (first bar in chart) ──────────
  // The first iteration's revenue serves as the baseline reference line so
  // subsequent bars can be compared against where we started.
  if (_revenueData.length === 1 && _revenueBaseline == null) {
    _revenueBaseline = revenue;
  }

  _renderRevenueChart();
}

/**
 * Override the baseline revenue line.
 * Called from simulation_complete as a fallback if no bars have been added yet
 * (e.g., if the simulation produced no iteration_complete events).
 * In normal operation, the baseline is set automatically from the first iteration bar.
 * @param {number} baselineRevenue
 */
function setRevenueBaseline(baselineRevenue) {
  // Only set if not already established from iteration 0 (first bar)
  if (_revenueBaseline == null && baselineRevenue != null) {
    _revenueBaseline = baselineRevenue;
    _renderRevenueChart();
  }
}

// ── Revenue Chart: Y-axis tick calculation ────────────────

/**
 * Calculate nice Y-axis tick values for the chart.
 * Returns an array of 3-5 evenly-spaced round KRW values.
 * @param {number} minVal
 * @param {number} maxVal
 * @returns {number[]}
 */
function _calcYTicks(minVal, maxVal) {
  const range = maxVal - minVal;
  if (range <= 0) return [minVal];
  // Target 4 ticks; pick a nice round step
  const rawStep = range / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  let step;
  if (normalized <= 1.5)      step = 1 * magnitude;
  else if (normalized <= 3.5) step = 2 * magnitude;
  else if (normalized <= 7.5) step = 5 * magnitude;
  else                        step = 10 * magnitude;

  const tickMin = Math.floor(minVal / step) * step;
  const tickMax = Math.ceil(maxVal / step) * step;
  const ticks = [];
  for (let v = tickMin; v <= tickMax + step * 0.01; v += step) {
    ticks.push(Math.round(v));
  }
  return ticks;
}

/**
 * Format KRW value for Y-axis label (compact: 만, 억 suffixes).
 * @param {number} v
 * @returns {string}
 */
function _shortKRW(v) {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (v >= 10_000)      return `${(v / 10_000).toFixed(0)}만`;
  return String(v);
}

/** Internal: render all bars + optional baseline + axes + grid into the SVG */
function _renderRevenueChart() {
  _renderRevenueChartInto({
    svgEl:         elRevenueChartSvg,
    barsEl:        elRevenueChartBars,
    baselineEl:    elRevenueBaselineLine,
    baselineLblEl: elRevenueBaselineLabel,
    yaxisEl:       elRevenueChartYAxis,
    gridEl:        elRevenueChartGrid,
    tooltipEl:     elRevenueChartTooltip,
    bodyEl:        document.getElementById('revenue-chart-body'),
  });
}

/** Render popup revenue chart (mirrored from main chart data) */
function _renderPopupRevenueChart() {
  _renderRevenueChartInto({
    svgEl:         elPopupRevenueChartSvg,
    barsEl:        elPopupRevenueChartBars,
    baselineEl:    elPopupRevenueBaselineLine,
    baselineLblEl: elPopupRevenueBaselineLabel,
    yaxisEl:       elPopupRevenueChartYAxis,
    gridEl:        elPopupRevenueChartGrid,
    tooltipEl:     elPopupRevenueChartTooltip,
    bodyEl:        document.getElementById('popup-revenue-chart-body'),
  });
}

/**
 * Core chart renderer — draws bars, axes, baseline, grid, tooltip into any SVG.
 * @param {{ svgEl, barsEl, baselineEl, baselineLblEl, yaxisEl, gridEl, tooltipEl, bodyEl }} opts
 */
function _renderRevenueChartInto({ svgEl, barsEl, baselineEl, baselineLblEl, yaxisEl, gridEl, tooltipEl, bodyEl }) {
  if (!svgEl || !barsEl) return;

  const PADDING_LEFT   = 48; // room for Y-axis labels
  const PADDING_RIGHT  = 12;
  const PADDING_TOP    = 10;
  const PADDING_BOTTOM = 22;
  const BAR_GAP        = 5;

  const svgRect = svgEl.getBoundingClientRect();
  const W = svgRect.width  || 400;
  const H = svgRect.height || 120;

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const numBars = _revenueData.length;
  if (numBars === 0) return;

  const chartW = W - PADDING_LEFT - PADDING_RIGHT;
  const chartH = H - PADDING_TOP  - PADDING_BOTTOM;
  const barW   = Math.max(4, (chartW - (numBars - 1) * BAR_GAP) / numBars);

  const revenues  = _revenueData.map((d) => d.revenue);
  const allValues = _revenueBaseline != null ? [...revenues, _revenueBaseline] : revenues;
  const maxVal    = Math.max(...allValues, 1);
  const minVal    = Math.min(...allValues, 0);
  const range     = maxVal - minVal || 1;

  function valToY(v) {
    return PADDING_TOP + chartH - ((v - minVal) / range) * chartH;
  }

  const svgNS = 'http://www.w3.org/2000/svg';

  // ── Y-axis ticks + grid lines ───────────────────────────────────────────────
  if (yaxisEl) {
    yaxisEl.innerHTML = '';
    const ticks = _calcYTicks(minVal, maxVal);
    ticks.forEach((tickVal) => {
      const ty = valToY(tickVal);
      // Tick mark
      const tick = document.createElementNS(svgNS, 'line');
      tick.setAttribute('x1', PADDING_LEFT - 4);
      tick.setAttribute('y1', ty);
      tick.setAttribute('x2', PADDING_LEFT);
      tick.setAttribute('y2', ty);
      tick.setAttribute('stroke', 'rgba(255,255,255,0.2)');
      tick.setAttribute('stroke-width', '1');
      yaxisEl.appendChild(tick);
      // Label
      const lbl = document.createElementNS(svgNS, 'text');
      lbl.setAttribute('x',           PADDING_LEFT - 6);
      lbl.setAttribute('y',           ty + 3);
      lbl.setAttribute('text-anchor', 'end');
      lbl.setAttribute('fill',        'var(--text-muted)');
      lbl.setAttribute('font-size',   '8');
      lbl.setAttribute('font-family', 'Pretendard Variable,system-ui,sans-serif');
      lbl.textContent = _shortKRW(tickVal);
      yaxisEl.appendChild(lbl);
    });
    // Y-axis vertical line
    const axisLine = document.createElementNS(svgNS, 'line');
    axisLine.setAttribute('x1', PADDING_LEFT);
    axisLine.setAttribute('y1', PADDING_TOP);
    axisLine.setAttribute('x2', PADDING_LEFT);
    axisLine.setAttribute('y2', PADDING_TOP + chartH);
    axisLine.setAttribute('stroke', 'rgba(255,255,255,0.12)');
    axisLine.setAttribute('stroke-width', '1');
    yaxisEl.appendChild(axisLine);
  }

  // ── Grid lines (horizontal) ─────────────────────────────────────────────────
  if (gridEl) {
    gridEl.innerHTML = '';
    const ticks = _calcYTicks(minVal, maxVal);
    ticks.forEach((tickVal) => {
      const ty = valToY(tickVal);
      const gl = document.createElementNS(svgNS, 'line');
      gl.setAttribute('x1', PADDING_LEFT);
      gl.setAttribute('y1', ty);
      gl.setAttribute('x2', W - PADDING_RIGHT);
      gl.setAttribute('y2', ty);
      gl.setAttribute('stroke', 'rgba(255,255,255,0.04)');
      gl.setAttribute('stroke-width', '1');
      gridEl.appendChild(gl);
    });
  }

  // ── Baseline dashed line ────────────────────────────────────────────────────
  if (_revenueBaseline != null && baselineEl && baselineLblEl) {
    const baseY = valToY(_revenueBaseline);
    baselineEl.setAttribute('x1', PADDING_LEFT);
    baselineEl.setAttribute('y1', baseY);
    baselineEl.setAttribute('x2', W - PADDING_RIGHT);
    baselineEl.setAttribute('y2', baseY);
    baselineEl.setAttribute('opacity', '1');
    baselineLblEl.setAttribute('x', W - PADDING_RIGHT - 2);
    baselineLblEl.setAttribute('y', baseY - 3);
    baselineLblEl.setAttribute('text-anchor', 'end');
    baselineLblEl.setAttribute('opacity', '1');
    baselineLblEl.textContent = `기준 ${formatKRW(_revenueBaseline)}`;
  }

  // ── Bars ────────────────────────────────────────────────────────────────────
  barsEl.innerHTML = '';

  _revenueData.forEach((d, i) => {
    const x             = PADDING_LEFT + i * (barW + BAR_GAP);
    const yTop          = valToY(d.revenue);
    const yBase         = valToY(Math.max(minVal, 0));
    const barH          = Math.max(2, Math.abs(yBase - yTop));
    const barY          = Math.min(yTop, yBase);
    const aboveBaseline = _revenueBaseline == null || d.revenue >= _revenueBaseline;
    // PRD §12.6: bar fill is accent-blue; green/red border (stroke) indicates above/below baseline
    const borderColor   = aboveBaseline ? 'var(--accent-green)' : 'var(--accent-red)';

    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x',            x);
    rect.setAttribute('y',            barY);
    rect.setAttribute('width',        barW);
    rect.setAttribute('height',       barH);
    rect.setAttribute('rx',           2);
    rect.setAttribute('fill',         'var(--accent-blue)');
    rect.setAttribute('stroke',       borderColor);
    rect.setAttribute('stroke-width', '2');
    rect.setAttribute('opacity',      d.accepted ? '0.9' : '0.4');
    rect.setAttribute('class',        aboveBaseline ? 'revenue-bar above-baseline' : 'revenue-bar below-baseline');
    rect.setAttribute('data-testid',  `revenue-bar-${d.iteration}`);
    rect.setAttribute('data-iteration', d.iteration);
    rect.setAttribute('data-revenue',   d.revenue);

    // SVG native tooltip (accessibility)
    const titleEl = document.createElementNS(svgNS, 'title');
    titleEl.textContent = `Iteration ${d.iteration}: ${formatKRW(d.revenue)}${d.accepted ? '' : ' (기각됨)'}`;
    rect.appendChild(titleEl);

    // ── Custom hover tooltip (requires bodyEl to position) ─────────────────
    if (tooltipEl && bodyEl) {
      rect.addEventListener('mouseenter', (e) => {
        const bodyRect = bodyEl.getBoundingClientRect();
        const svgRectNow = svgEl.getBoundingClientRect();
        const scaleX = svgRectNow.width  / W;
        const scaleY = svgRectNow.height / H;
        // Bar center X in screen coords
        const bx = svgRectNow.left + (x + barW / 2) * scaleX - bodyRect.left;
        const by = svgRectNow.top  + barY * scaleY            - bodyRect.top;
        const statusStr = d.accepted ? '✅ 채택됨' : '❌ 기각됨';
        const baselineStr = _revenueBaseline != null
          ? (aboveBaseline ? `▲ +${formatKRW(d.revenue - _revenueBaseline)}` : `▼ ${formatKRW(d.revenue - _revenueBaseline)}`)
          : '';
        tooltipEl.innerHTML =
          `<strong>Iteration ${d.iteration}</strong><br>` +
          `${formatKRW(d.revenue)}<br>` +
          (baselineStr ? `${baselineStr}<br>` : '') +
          statusStr;
        tooltipEl.style.left = `${Math.max(0, bx - 60)}px`;
        tooltipEl.style.top  = `${Math.max(0, by - 70)}px`;
        tooltipEl.classList.add('visible');
      });
      rect.addEventListener('mouseleave', () => {
        tooltipEl.classList.remove('visible');
      });
    }

    // Value label above bar (only when bar is wide enough)
    if (barW >= 20) {
      const valLabel = document.createElementNS(svgNS, 'text');
      valLabel.setAttribute('x',           x + barW / 2);
      valLabel.setAttribute('y',           barY - 3);
      valLabel.setAttribute('text-anchor', 'middle');
      valLabel.setAttribute('fill',        borderColor);
      valLabel.setAttribute('font-size',   '8');
      valLabel.setAttribute('font-family', 'Pretendard Variable,system-ui,sans-serif');
      valLabel.setAttribute('class',       'revenue-bar-label');
      const shortVal = d.revenue >= 10000
        ? `${(d.revenue / 10000).toFixed(0)}만`
        : formatKRW(d.revenue);
      valLabel.textContent = shortVal;
      barsEl.appendChild(valLabel);
    }

    // X-axis label (iteration number)
    const xLabel = document.createElementNS(svgNS, 'text');
    xLabel.setAttribute('x',           x + barW / 2);
    xLabel.setAttribute('y',           H - PADDING_BOTTOM + 13);
    xLabel.setAttribute('text-anchor', 'middle');
    xLabel.setAttribute('fill',        'var(--text-muted)');
    xLabel.setAttribute('font-size',   '9');
    xLabel.setAttribute('font-family', 'Pretendard Variable,system-ui,sans-serif');
    xLabel.setAttribute('class',       'revenue-bar-label');
    xLabel.textContent = String(d.iteration);

    barsEl.appendChild(rect);
    barsEl.appendChild(xLabel);
  });

  // ── X-axis bottom line ──────────────────────────────────────────────────────
  const xAxisGroup = svgEl.querySelector('#revenue-chart-xaxis, #popup-revenue-chart-xaxis');
  if (xAxisGroup) {
    xAxisGroup.innerHTML = '';
    const xLine = document.createElementNS(svgNS, 'line');
    xLine.setAttribute('x1', PADDING_LEFT);
    xLine.setAttribute('y1', PADDING_TOP + chartH);
    xLine.setAttribute('x2', W - PADDING_RIGHT);
    xLine.setAttribute('y2', PADDING_TOP + chartH);
    xLine.setAttribute('stroke', 'rgba(255,255,255,0.12)');
    xLine.setAttribute('stroke-width', '1');
    xAxisGroup.appendChild(xLine);
    // X-axis label "Iteration"
    const xAxisLbl = document.createElementNS(svgNS, 'text');
    xAxisLbl.setAttribute('x',           PADDING_LEFT + chartW / 2);
    xAxisLbl.setAttribute('y',           H - 2);
    xAxisLbl.setAttribute('text-anchor', 'middle');
    xAxisLbl.setAttribute('fill',        'var(--text-muted)');
    xAxisLbl.setAttribute('font-size',   '8');
    xAxisLbl.setAttribute('font-family', 'Pretendard Variable,system-ui,sans-serif');
    xAxisLbl.textContent = 'Iteration';
    xAxisGroup.appendChild(xAxisLbl);
  }
}


// ── SimEventBus — Typed SSE event bus (Sub-AC 3a) ─────────
//
// Exposes a subscribe/emit interface for typed simulation events.
// Used by canvas, particle engine, and UI components to consume
// SSE events without direct coupling to the stream parser.
//
// Supported event types (from POST /api/run/stream):
//   iteration_start    { iteration, total, candidates }
//   agent_decision     { agent_id, archetype_id, chosen_product, decision,
//                        reasoning, score, agent_index, agent_total,
//                        price_sensitivity, trust_sensitivity, promo_affinity,
//                        brand_bias, pass_threshold, budget_band }
//   iteration_complete { iteration, winner_id, winner_revenue, accepted,
//                        rejected_count, choice_summary, archetype_breakdown }
//   holdout_start      { message }
//   simulation_complete { baseline, selected_strategy, holdout, diff, artifact }
//   error              { message, recoverable }

class SimEventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
  }

  /**
   * Subscribe to a specific typed event from the SSE stream.
   *
   * @param {string}   type    - SSE event type (e.g. 'agent_decision')
   * @param {Function} handler - Callback invoked with (data) on each matching event
   * @returns {Function}  Unsubscribe function — call to remove the handler
   *
   * @example
   *   const unsub = window.simEventBus.on('agent_decision', (data) => {
   *     // data.archetype_id, data.chosen_product are guaranteed non-null strings
   *     console.log(data.archetype_id, '->', data.chosen_product);
   *   });
   *   // later: unsub();
   */
  on(type, handler) {
    if (typeof type !== 'string' || typeof handler !== 'function') return () => {};
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(handler);
    return () => this.off(type, handler);
  }

  /**
   * Unsubscribe a typed handler.
   * @param {string}   type
   * @param {Function} handler
   */
  off(type, handler) {
    this._handlers.get(type)?.delete(handler);
  }

  /**
   * Subscribe to ALL SSE event types.
   * The handler receives (type, data) so it can branch on event type.
   *
   * @param {Function} handler - Callback invoked with (type, data) for every event
   * @returns {Function}  Unsubscribe function
   *
   * @example
   *   window.simEventBus.onAny((type, data) => {
   *     if (type === 'agent_decision') { ... }
   *   });
   */
  onAny(handler) {
    if (typeof handler !== 'function') return () => {};
    if (!this._handlers.has('*')) this._handlers.set('*', new Set());
    this._handlers.get('*').add(handler);
    return () => this._handlers.get('*')?.delete(handler);
  }

  /**
   * Emit an event to all matching subscribers.
   * Called by the SSE stream parser in runSimulation().
   *
   * agent_decision payload contract (Sub-AC 3a):
   *   data.archetype_id    {string}  — archetype the buyer belongs to
   *   data.chosen_product  {string}  — canonical choice key (one of
   *     our_product | competitor_a | competitor_b | competitor_c | pass)
   *   data.decision        {string}  — alias for chosen_product
   *
   * @param {string} type - SSE event type
   * @param {object} data - Parsed JSON payload
   */
  emit(type, data) {
    // Type-specific handlers receive only (data)
    const handlers = this._handlers.get(type);
    if (handlers) {
      for (const h of handlers) {
        try { h(data); } catch (err) {
          console.warn('[SimEventBus] handler error for event', type, ':', err);
        }
      }
    }
    // Wildcard handlers receive (type, data)
    const wildcards = this._handlers.get('*');
    if (wildcards) {
      for (const h of wildcards) {
        try { h(type, data); } catch (err) {
          console.warn('[SimEventBus] wildcard handler error:', err);
        }
      }
    }
  }

  /** Remove all handlers (useful for test cleanup). */
  clear() {
    this._handlers.clear();
  }
}

/**
 * Global typed event bus for simulation SSE events.
 * Exposed as window.simEventBus for canvas, particle engine, and
 * downstream UI components to subscribe to specific event types.
 *
 * @type {SimEventBus}
 */
const simEventBus = new SimEventBus();
window.simEventBus = simEventBus;

// ── SSE Event Handlers ────────────────────────────────────

let _totalIterations = 5;

function handleSSEEvent(type, data) {
  try {
  switch (type) {
    case 'iteration_start': {
      const { iteration, total, candidates, strategy_reasoning } = data;
      _totalIterations = total ?? _totalIterations;
      if (simIterationLabel) simIterationLabel.textContent = `Iteration ${iteration}/${_totalIterations}`;
      if (statusEl) statusEl.textContent = `Iteration ${iteration}/${_totalIterations} 진행 중...`;
      // Clear edges and in-flight particles at the start of each new iteration
      window.simGraph?.clearEdges();
      window.particleEngine?.clearAll();
      // Reset agent log for this iteration
      resetAgentLog();
      // Reset agent count for this iteration (Sub-AC 4c)
      resetAgentCount();
      // Reset product bucket counters for this iteration (Sub-AC 4c)
      resetProductCounters();
      // ── Strategy Lobster: populate candidates (PRD §12.11 + §16 Sub-AC 4d) ──
      updateStrategyLobster({ iteration, total: _totalIterations, candidates, strategy_reasoning });
      break;
    }

    case 'agent_decision': {
      addAgentLogEntry(data);
      // Update agent count progress display (Sub-AC 4c)
      updateAgentCount(data.agent_total);
      // Update the force graph archetype node color to reflect running dominant product
      const productColor = PRODUCT_COLORS[data.chosen_product] ?? '#475569';
      window.simGraph?.setArchetypeColor(data.archetype_id, productColor);
      // Spawn a Canvas 2D particle — archetype color, 0.2s linear travel to product bucket
      _particleEngine?.spawnForAgent(data.archetype_id, data.chosen_product);
      // Increment product bucket counter after particle animation (~0.22s) — Sub-AC 4c
      {
        const _pid = data.chosen_product;
        setTimeout(() => incrementProductCounter(_pid), 220);
      }
      break;
    }

    case 'archetype_evaluated': {
      const choices = data.choices ?? {};
      const totalChoices = Object.values(choices).reduce((a, b) => a + b, 0) || 1;

      // Find the product that got the most buyers from this archetype
      const [dominantProduct, dominantCount] = Object.entries(choices)
        .sort(([, a], [, b]) => b - a)[0] ?? ['pass', 0];

      const edgeWeight = dominantCount / totalChoices;
      window.simGraph?.drawEdge(data.archetype_id, dominantProduct, edgeWeight);
      window.simGraph?.setArchetypeColor(data.archetype_id, PRODUCT_COLORS[dominantProduct] ?? '#475569');
      break;
    }

    case 'iteration_complete': {
      const { iteration, accepted, winner_id } = data;
      const pct = Math.round((iteration / _totalIterations) * 100);
      if (simProgressBar) simProgressBar.style.width = `${pct}%`;
      if (simIterationLabel) simIterationLabel.textContent = `Iteration ${iteration}/${_totalIterations}`;
      if (statusEl) statusEl.textContent = `Iteration ${iteration} 완료${accepted ? '' : ' (기각됨)'}`;
      // Revenue chart: add per-iteration bar
      addRevenueBar(data);
      // Archetype summary table: render per-archetype totals (Sub-AC 4d)
      // renderArchetypeSummary handles both explicit array format (Sub-AC 3c) and legacy flat format
      renderArchetypeSummary(data.archetype_breakdown, iteration);
      // Insights panel: update with the LATEST iteration's archetype_breakdown (Sub-AC 6c)
      // Called on each iteration_complete so the panel is pre-populated before results are shown.
      // Normalize to flat format first since populateInsightsPanel expects plain number values.
      {
        const flatBreakdown = normalizeArchetypeBreakdownToFlat(data.archetype_breakdown);
        const hasData = flatBreakdown && Object.keys(flatBreakdown).length > 0;
        if (hasData) {
          _lastArchetypeBreakdown = flatBreakdown;
          populateInsightsPanel(flatBreakdown);
        }
      }
      // Strategy Lobster: mark winner candidate (PRD §12.11 — Sub-AC 4d, Sub-AC 8b3)
      if (winner_id) markStrategyLobsterWinner(winner_id);
      // Sub-AC 8b3: update strategy-iteration-label with current iteration from iteration_complete
      if (elStrategyIterationLabel) {
        elStrategyIterationLabel.textContent = `Iteration ${iteration}/${_totalIterations ?? '?'}`;
      }
      break;
    }

    case 'holdout_start': {
      if (statusEl) statusEl.textContent = data.message ?? 'Holdout 검증 중...';
      break;
    }

    case 'simulation_complete': {
      populateResults(data);
      showCompletedState();
      showResultsPanel();
      // 파티클이 목적지까지 도달할 시간을 충분히 주고 정지 + 잔여 파티클 제거
      setTimeout(() => {
        window.simGraph?.stop();
        _particleEngine?.clearAll();
      }, 5000);
      // Revenue chart: fallback baseline from simulation_complete if no iteration bars.
      // In normal operation, baseline is already set from iteration 0 (first bar),
      // so setRevenueBaseline skips (only sets when _revenueBaseline is still null).
      if (data.baseline?.simulated_revenue != null) {
        setRevenueBaseline(data.baseline.simulated_revenue);
      }
      // Sub-AC 6d: Freeze all particles — stop animation loop but preserve the last
      // rendered canvas frame (final particle distribution stays visible).
      // After in-flight particles finish their 0.2s travel, freeze the engine.
      // Sub-AC 6e: Also remove sim-running and hide seller badge on freeze.
      setTimeout(() => {
        if (window.particleEngine) {
          window.particleEngine.freeze();
          // Add frozen state visual indicator to canvas container
          const canvasContainer = document.getElementById('sim-canvas-wrap');
          if (canvasContainer) {
            canvasContainer.classList.add('sim-frozen');
            canvasContainer.classList.remove('sim-running');
          }
          // Hide seller badge on completion
          const sellerBadge = document.getElementById('canvas-seller-badge');
          if (sellerBadge) sellerBadge.classList.remove('visible');
        }
      }, 300);
      if (statusEl) statusEl.textContent = '시뮬레이션 완료 ✓';
      // Populate Results Popup content + show btn-show-results (PRD §12.10 — Sub-AC 4d)
      // NOTE: Do NOT auto-show the popup; agent-log-entries must remain clickable
      // immediately after simulation. User opens via btn-show-results.
      openResultsPopup(data, false);
      if (elBtnShowResults) {
        elBtnShowResults.style.display = 'block';
      }
      break;
    }

    case 'error': {
      showErrorState(data.message ?? '시뮬레이션 오류가 발생했습니다.');
      window.simGraph?.stop();
      window.particleEngine?.clearAll();
      break;
    }

    default:
      break;
  }
  } catch (eventErr) {
    // Catch unexpected errors from individual event handlers (e.g. malformed event data
    // that causes a runtime error inside a case block) so the stream stays alive.
    console.warn('handleSSEEvent internal error:', eventErr, 'type:', type, 'data:', data);
    if (statusEl) statusEl.textContent = `⚠ 이벤트 처리 오류 (${type})`;
  }
}

// ── Register UI event handler on the simulation event bus (Sub-AC 3a) ────────
//
// handleSSEEvent is subscribed as a wildcard listener so that all SSE events
// dispatched through simEventBus.emit() are routed to the existing UI handlers.
// Downstream canvas and particle engine code subscribes independently via
//   window.simEventBus.on('agent_decision', handler)
// without needing to modify this registration.
simEventBus.onAny((type, data) => handleSSEEvent(type, data));

// ── Results Populator ─────────────────────────────────────

/** Format a margin_rate (0–1 float or 0–100 number) as a percentage string */
function formatMarginRate(rate) {
  if (rate == null) return '—';
  // Engine stores margin_rate as a fraction (e.g. 0.632) or percentage
  const pct = rate > 1 ? rate : rate * 100;
  return `${pct.toFixed(1)}%`;
}

/**
 * Populate all results panel elements from simulation_complete event data.
 * @param {{ baseline, selected_strategy, holdout, diff, artifact }} data
 */
function populateResults(data) {
  const baseline = data.baseline          ?? {};
  const strategy = data.selected_strategy ?? {};
  const holdout  = data.holdout           ?? {};
  const diff     = data.diff              ?? {};
  const artifact = data.artifact          ?? {};
  const payload  = artifact.payload       ?? {};

  // ── Metrics Row ──────────────────────────────────────────
  if (elMetricBaseline) {
    elMetricBaseline.textContent = formatKRW(baseline.simulated_revenue ?? 0);
    elMetricBaseline.className   = 'metric-value';
  }
  if (elMetricFinal) {
    elMetricFinal.textContent = formatKRW(strategy.simulated_revenue ?? 0);
    elMetricFinal.className   = 'metric-value';
  }
  const uplift = holdout.holdout_uplift ?? 0;
  if (elMetricHoldout) {
    elMetricHoldout.textContent = (uplift >= 0 ? '+' : '') + formatKRW(uplift);
    // 3-way color coding: positive=green, negative=red, neutral(zero)=white
    const upliftClass = uplift > 0 ? 'positive' : uplift < 0 ? 'negative' : 'neutral';
    elMetricHoldout.className   = 'metric-value ' + upliftClass;
  }

  // ── Strategy Summary Card ─────────────────────────────────
  if (elStrategyTitle)     elStrategyTitle.textContent     = strategy.title     ?? '—';
  if (elStrategyCopy)      elStrategyCopy.textContent      = strategy.top_copy  ?? '—';
  if (elStrategyPrice)     elStrategyPrice.textContent     = formatKRW(strategy.price_krw ?? 0);
  if (elStrategyMargin)    elStrategyMargin.textContent    = formatMarginRate(strategy.margin_rate);
  if (elStrategyRationale) elStrategyRationale.textContent = strategy.rationale ?? '—';

  // ── Diff Card — conditional line-through on changed items (PRD §12.3) ──
  //
  // Rule: line-through + text-secondary on "before" ONLY when before !== after.
  //       "after" shows in accent-green when changed, italic muted "변경 없음" otherwise.

  /**
   * Apply diff styling to a before/after element pair.
   * @param {HTMLElement|null} beforeEl
   * @param {HTMLElement|null} afterEl
   * @param {string|null} beforeVal
   * @param {string|null} afterVal
   * @param {function} [fmt] optional formatter
   */
  function applyDiffRow(beforeEl, afterEl, beforeVal, afterVal, fmt) {
    const display = fmt || ((v) => (v != null ? String(v) : '—'));
    const changed  = String(beforeVal ?? '') !== String(afterVal ?? '');

    if (beforeEl) {
      beforeEl.textContent          = beforeVal != null ? display(beforeVal) : '—';
      // Override CSS default (`.diff-before { text-decoration: line-through }`)
      // Only apply line-through when the value actually changed.
      beforeEl.style.textDecoration = changed ? 'line-through' : 'none';
      beforeEl.style.color          = changed ? 'var(--text-secondary)' : 'var(--text-muted)';
    }
    if (afterEl) {
      if (changed) {
        afterEl.textContent    = afterVal != null ? display(afterVal) : '—';
        afterEl.style.color    = 'var(--accent-green)';
        afterEl.style.fontStyle = '';
      } else {
        afterEl.textContent    = '변경 없음';
        afterEl.style.color    = 'var(--text-muted)';
        afterEl.style.fontStyle = 'italic';
      }
    }
  }

  // Title and top-copy diffs (plain text)
  applyDiffRow(elDiffTitleBefore, elDiffTitleAfter, diff.title?.before, diff.title?.after);
  applyDiffRow(elDiffCopyBefore,  elDiffCopyAfter,  diff.top_copy?.before, diff.top_copy?.after);

  // Price diff — KRW with direction-aware percentage change (PRD §12.3)
  // "하락=green, 상승=red"
  const priceBefore = diff.price?.before ?? null;
  const priceAfter  = diff.price?.after  ?? null;
  const priceStr    = (v) => formatKRW(v);

  if (elDiffPriceBefore) {
    elDiffPriceBefore.textContent          = priceBefore != null ? formatKRW(priceBefore) : '—';
    const priceChanged = String(priceBefore ?? '') !== String(priceAfter ?? '');
    elDiffPriceBefore.style.textDecoration = priceChanged ? 'line-through' : 'none';
    elDiffPriceBefore.style.color          = priceChanged ? 'var(--text-secondary)' : 'var(--text-muted)';
  }
  if (elDiffPriceAfter) {
    const priceChanged = String(priceBefore ?? '') !== String(priceAfter ?? '');
    if (priceChanged && priceAfter != null) {
      const rawPct = (priceBefore != null && priceBefore !== 0)
        ? ((priceAfter - priceBefore) / priceBefore) * 100
        : 0;
      const pctStr = rawPct !== 0 ? ` (${rawPct >= 0 ? '+' : ''}${rawPct.toFixed(1)}%)` : '';
      elDiffPriceAfter.textContent    = formatKRW(priceAfter) + pctStr;
      // 하락(price decrease) → green, 상승(price increase) → red
      elDiffPriceAfter.style.color    = rawPct <= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
      elDiffPriceAfter.style.fontStyle = '';
    } else {
      elDiffPriceAfter.textContent    = '변경 없음';
      elDiffPriceAfter.style.color    = 'var(--text-muted)';
      elDiffPriceAfter.style.fontStyle = 'italic';
    }
  }

  // ── Artifact Card ─────────────────────────────────────────
  const strategyId  = payload.selected_strategy_id ?? strategy.id ?? '—';
  const artUplift   = payload.holdout_uplift        ?? uplift;
  const generatedAt = payload.generated_at;

  if (elArtifactStrategyId) elArtifactStrategyId.textContent = strategyId;
  if (elArtifactUplift) {
    elArtifactUplift.textContent = (artUplift >= 0 ? '+' : '') + formatKRW(artUplift);
    // Mirror holdout uplift 3-way color coding in the artifact card
    const artUpliftCls = artUplift > 0 ? 'text-green' : artUplift < 0 ? 'text-red' : '';
    elArtifactUplift.className = ['strategy-val', 'text-sm', artUpliftCls].filter(Boolean).join(' ');
  }
  if (elArtifactTimestamp) {
    elArtifactTimestamp.textContent = generatedAt
      ? new Date(generatedAt).toLocaleString('ko-KR')
      : '—';
  }

  // Legacy compatibility — keep artifactOutput accessible for smoke tests
  if (artifactOutput) {
    artifactOutput.dataset.strategyId = strategyId;
  }

  // ── Insights Panel (Sub-AC 6c) ────────────────────────────
  // Use the LATEST iteration's archetype_breakdown as the authoritative source.
  // _lastArchetypeBreakdown is updated on every iteration_complete event so it
  // holds the most recent per-archetype choice distribution when this runs.
  // Fall back to aggregated data only when _lastArchetypeBreakdown is not yet
  // populated (e.g. legacy batch path where iteration_complete was never fired).
  const insightBreakdown = _lastArchetypeBreakdown
    ?? _aggregateArchetypeBreakdown(_iterationResults);
  populateInsightsPanel(insightBreakdown);
}

// ── Insights Panel (Sub-AC 6b) ────────────────────────────
//
// Derives 3–8 actionable insight items from the archetype_breakdown
// captured from the last accepted iteration_complete event.
//
// Threshold rules (per PRD):
//   ⚠️  our_product rate < 25%  → warning: low capture for this archetype
//   ✅  our_product rate > 50%  → positive: strong capture for this archetype
//   🟡  pass rate > 40%         → caution: high indifference / skip rate
//
// Up to 8 insights are displayed, prioritised by significance (largest
// delta from the neutral zone first).

/** Korean display labels for each archetype_id */
const ARCHETYPE_LABELS_KO = {
  price_sensitive:      '가격민감형',
  value_seeker:         '가성비균형형',
  premium_quality:      '프리미엄형',
  trust_first:          '신뢰우선형',
  aesthetics_first:     '감성형',
  urgency_buyer:        '문제해결형',
  promo_hunter:         '할인반응형',
  gift_or_family_buyer: '가족구매형',
};

/** Module-level holder for the latest iteration_complete archetype_breakdown */
let _lastArchetypeBreakdown = null;

/**
 * Aggregate archetype_breakdown across all iteration results in _iterationResults.
 *
 * Each accepted iteration_complete event carries a per-archetype ChoiceSummary.
 * This helper sums counts across all iterations so that the insights panel
 * reflects the full simulation run rather than just the last iteration.
 *
 * @param {Array} iterationResults - Contents of _iterationResults
 * @returns {Object|null} Aggregated ArchetypeBreakdown, or null if no data
 */
function _aggregateArchetypeBreakdown(iterationResults) {
  if (!iterationResults || iterationResults.length === 0) return null;

  /** @type {Record<string, { our_product: number, competitor_a: number, competitor_b: number, competitor_c: number, pass: number }>} */
  const aggregated = {};
  const CHOICE_KEYS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];

  for (const result of iterationResults) {
    const breakdown = result.archetype_breakdown;
    if (!breakdown || typeof breakdown !== 'object') continue;

    // Normalize to flat format: handles both Sub-AC 3c array format and legacy object format
    const flat = normalizeArchetypeBreakdownToFlat(breakdown);

    for (const [archetypeId, counts] of Object.entries(flat)) {
      if (!aggregated[archetypeId]) {
        aggregated[archetypeId] = { our_product: 0, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 };
      }
      for (const key of CHOICE_KEYS) {
        // counts[key] is always a plain number after normalization
        aggregated[archetypeId][key] += (counts[key] ?? 0);
      }
    }
  }

  return Object.keys(aggregated).length > 0 ? aggregated : null;
}

/**
 * Aggregate choice_summary totals across all iteration results in _iterationResults.
 *
 * @param {Array} iterationResults - Contents of _iterationResults
 * @returns {Object|null} Aggregated ChoiceSummary, or null if no data
 */
function _aggregateChoiceSummary(iterationResults) {
  if (!iterationResults || iterationResults.length === 0) return null;

  const totals = { our_product: 0, competitor_a: 0, competitor_b: 0, competitor_c: 0, pass: 0 };
  const CHOICE_KEYS = Object.keys(totals);
  let hasData = false;

  for (const result of iterationResults) {
    const cs = result.choice_summary;
    if (!cs || typeof cs !== 'object') continue;
    hasData = true;
    for (const key of CHOICE_KEYS) {
      const val = cs[key];
      // Handle Sub-AC 3c explicit {count, pct} format as well as legacy plain numbers
      const count = (val != null && typeof val === 'object')
        ? (val.count ?? 0)
        : (typeof val === 'number' ? val : 0);
      totals[key] += count;
    }
  }

  return hasData ? totals : null;
}

/**
 * Reset the insights panel for a fresh simulation run.
 * Called from showLoadingState().
 */
function resetInsightsPanel() {
  _lastArchetypeBreakdown = null;
  if (elInsightsList)  elInsightsList.innerHTML = '';
  if (elInsightsPanel) elInsightsPanel.style.display = 'none';
}

/**
 * Derive insight items from archetype_breakdown and render them.
 *
 * Accepts both Sub-AC 3c explicit array format and legacy flat object format —
 * both are normalized to flat before processing.
 *
 * @param {Array|Object|null} archetypeBreakdown
 *   Array format (Sub-AC 3c SSE): [{archetype_id, choices: {key: {count, pct}}}]
 *   Object format (legacy): { archetypeId: { our_product: N, ... } }
 */
function populateInsightsPanel(archetypeBreakdown) {
  if (!elInsightsPanel || !elInsightsList) return;
  if (!archetypeBreakdown) return;

  // Normalize to flat object format: { archetypeId: { our_product: N, ... } }
  const flat = normalizeArchetypeBreakdownToFlat(archetypeBreakdown);
  if (Object.keys(flat).length === 0) return;

  // ── Derive candidate insight objects ─────────────────────
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
        text:              `트리클리닉 선택 비율 ${ourPct}% — 이 고객군에서 경쟁력이 낮습니다.`,
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
        text:              `트리클리닉 선택 비율 ${ourPct}% — 이 고객군에서 강한 성과를 보입니다.`,
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

  // ── Sort by descending score, cap at 8 ───────────────────
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
          text:              `트리클리닉 선택 비율 ${ourPct}% — 추가 최적화 여지가 있습니다.`,
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

  if (insights.length === 0) return;

  // ── Render ────────────────────────────────────────────────
  elInsightsList.innerHTML = '';
  for (const insight of insights) {
    const item = document.createElement('div');
    item.className = `insight-item ${insight.cls}`;
    item.setAttribute('data-testid', 'insight-item');

    const iconEl = document.createElement('span');
    iconEl.className   = 'insight-icon';
    iconEl.textContent = insight.icon;

    const bodyEl = document.createElement('div');
    bodyEl.className = 'insight-body';

    const archetypeEl = document.createElement('div');
    archetypeEl.className   = 'insight-archetype';
    archetypeEl.textContent = insight.archetypeLabel;

    const textEl = document.createElement('div');
    textEl.className   = 'insight-text';
    textEl.textContent = insight.text;

    bodyEl.appendChild(archetypeEl);
    bodyEl.appendChild(textEl);

    // → Recommended action line (PRD §12.7 — font-size-xs, text-muted)
    if (insight.recommendedAction) {
      const actionEl = document.createElement('div');
      actionEl.className   = 'insight-action';
      actionEl.textContent = `→ ${insight.recommendedAction}`;
      bodyEl.appendChild(actionEl);
    }

    item.appendChild(iconEl);
    item.appendChild(bodyEl);
    elInsightsList.appendChild(item);
  }

  // Reveal the panel
  elInsightsPanel.style.display = 'block';
}

// ── SSE Simulation Runner ─────────────────────────────────

async function runSimulation() {
  const iterationCount = Number(iterationInput?.value ?? 5);
  _totalIterations = iterationCount;

  // Collect all 6 editable fields + archetype counts + gender
  const { counts: archetypeCounts } = readArchetypeCounts();
  const { male: genderMaleCount, female: genderFemaleCount } = readGenderCounts();

  const body = {
    iterationCount,
    minimumMarginFloor:  Number(marginInput?.value    ?? 0.35),
    title:               elInputTitle?.value   || undefined,
    topCopy:             elInputTopCopy?.value || undefined,
    priceKrw:            Number(elInputPrice?.value ?? 0) || undefined,
    costKrw:             Number(elInputCost?.value  ?? 0) || undefined,
    archetypeCounts,
    genderMaleCount,
    genderFemaleCount,
  };

  // Transition to loading state
  if (statusEl) statusEl.textContent = 'Connecting...';
  _isRunning = true;
  _abortController = new AbortController();
  runButton.textContent = '⏹ 중지';
  runButton.disabled = false;
  setInputsDisabled(true);
  showLoadingState();

  // Reheat force graph + clear particle canvas for fresh run
  window.simGraph?.resetColors();
  window.simGraph?.clearEdges();
  window.simGraph?.start();
  window.particleEngine?.clearAll();

  try {
    // ── Fetch with network-error handling ─────────────────────────────
    let response;
    try {
      response = await fetch('/api/run/stream', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  _abortController.signal,
      });
    } catch (networkErr) {
      // fetch() rejects on network-level failure (no connection, DNS, etc.)
      throw new Error(`서버에 연결할 수 없습니다 — ${networkErr.message}`);
    }

    // ── Non-2xx response handling ─────────────────────────────────────
    if (!response.ok) {
      let errMsg = `서버 오류 (HTTP ${response.status} ${response.statusText})`;
      try {
        const errJson = await response.json();
        if (errJson.error) errMsg = errJson.error;
      } catch {
        // response body not valid JSON — keep the HTTP status message
      }
      throw new Error(errMsg);
    }

    // ── SSE stream parsing ───────────────────────────────────────────
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer           = '';
    let currentEventType = '';
    let sseParseErrors   = 0;        // count malformed data lines
    let completedReceived = false;   // set true on simulation_complete event
    const SSE_PARSE_ERROR_THRESHOLD = 5;  // abort stream after this many bad lines

    // Emit parsed SSE events through the typed event bus (Sub-AC 3a).
    // simEventBus.onAny (registered above) routes events to handleSSEEvent.
    // Downstream canvas/particle components subscribe independently via
    //   window.simEventBus.on('agent_decision', handler).
    function dispatch(type, data) {
      if (type === 'simulation_complete') completedReceived = true;
      simEventBus.emit(type, data);
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';   // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('event:')) {
          currentEventType = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          const rawData = trimmed.slice(5).trim();
          try {
            const eventData = JSON.parse(rawData);
            dispatch(currentEventType, eventData);
          } catch (parseErr) {
            sseParseErrors++;
            console.warn(`SSE parse error #${sseParseErrors}:`, parseErr, 'raw:', rawData);
            // Show a user-visible warning in the status bar
            if (statusEl) {
              statusEl.textContent = `⚠ 스트림 파싱 오류 (${sseParseErrors}회)`;
            }
            // After too many consecutive parse failures, abort with a clear error
            if (sseParseErrors >= SSE_PARSE_ERROR_THRESHOLD) {
              throw new Error(
                `SSE 스트림 오류: 데이터 형식이 올바르지 않습니다 (${sseParseErrors}회 실패). 잠시 후 다시 시도해 주세요.`
              );
            }
          }
        }
      }
    }

    // ── Stream closed without simulation_complete ─────────────────────
    // This can happen if the server crashed mid-stream or closed the connection early.
    if (!completedReceived && simStateLoading && simStateLoading.style.display !== 'none') {
      throw new Error('시뮬레이션 스트림이 완료 이벤트 없이 종료되었습니다. 잠시 후 다시 시도해 주세요.');
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      if (statusEl) statusEl.textContent = '시뮬레이션이 중지되었습니다.';
    } else {
      showErrorState(err.message);
    }
    window.simGraph?.stop();
  } finally {
    _isRunning = false;
    _abortController = null;
    runButton.textContent = '▶ Run simulation';
    runButton.disabled = false;
    setInputsDisabled(false);
    // Revalidate archetype counts so btn-run reflects current input state
    validateArchetypeCounts();
    // Hide loading indicator if still showing (error path)
    if (simStateLoading && simStateLoading.style.display === 'block') {
      const isCompleted = simStateCompleted && simStateCompleted.style.display !== 'none';
      if (!isCompleted) simStateLoading.style.display = 'none';
    }
  }
}

runButton?.addEventListener('click', () => {
  if (_isRunning && _abortController) {
    _abortController.abort();
  } else {
    runSimulation();
  }
});

// ── Init ──────────────────────────────────────────────────
loadFixture();

// ==========================================================
//  Force-Directed Graph — PRD §12.3 Simulation Panel
//  Vanilla JS, SVG-based, no external libraries
//  8 archetype nodes + 5 product nodes
// ==========================================================

function initForceGraph() {
  const svg  = document.getElementById('sim-canvas');
  const wrap = document.getElementById('sim-canvas-wrap');
  if (!svg || !wrap) return;

  // Gather DOM node elements
  const archetypeEls = Array.from(svg.querySelectorAll('.archetype-node'));
  const productEls   = Array.from(svg.querySelectorAll('.product-node'));

  // ── Node data structures ─────────────────────────────────

  /** @type {{ el: SVGGElement, r: number, weight: number, x: number, y: number, vx: number, vy: number }[]} */
  const archetypes = archetypeEls.map((el) => ({
    el,
    r:      Number(el.querySelector('circle')?.getAttribute('r') || 16),
    weight: Number(el.dataset.weight || 10),
    x: 0, y: 0,
    vx: 0, vy: 0,
    initialized: false,
  }));

  /** @type {{ el: SVGGElement, r: number, x: number, y: number }[]} */
  const products = productEls.map((el) => ({
    el,
    r: Number(el.querySelector('circle')?.getAttribute('r') || 24),
    x: 0, y: 0,
  }));

  // ── Simulation state ─────────────────────────────────────
  let W = 0, H = 0;
  let alpha = 1.0;            // "temperature" — decays toward 0
  let animFrame = null;
  let simRunning = false;

  // ── Layout helpers ───────────────────────────────────────

  /**
   * Lay out product nodes along the bottom row and seed archetype positions
   * in the upper region.  Called on first render and on resize.
   */
  function layout(width, height) {
    W = width;
    H = height;

    // Update SVG viewBox to match physical pixel size
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    // ── Product row (fixed at bottom) ──
    const productY    = H - 55;
    const bucketPanelW = 140; // match bucket panel width
    const usableW     = W - bucketPanelW;
    const productStep = usableW / (products.length + 1);
    products.forEach((p, i) => {
      p.x = productStep * (i + 1);
      p.y = productY;
      p.el.setAttribute('transform', `translate(${p.x},${p.y})`);
      // Register product bucket coordinates with the particle engine
      const pid = p.el.dataset.productId;
      if (pid) window.particleEngine?.setProductPos(pid, p.x, p.y);
    });

    // ── Archetype row (fixed at top) ──
    const archY    = 35;  // fixed top row
    const archStep = usableW / (archetypes.length + 1);
    archetypes.forEach((a, i) => {
      a.x = archStep * (i + 1);
      a.y = archY;
      a.vx = 0;
      a.vy = 0;
      a.initialized = true;
      a.el.setAttribute('transform', `translate(${a.x},${a.y})`);
      const aid = a.el.dataset.archetypeId;
      if (aid) window.particleEngine?.setArchPos(aid, a.x, a.y);
    });
  }

  // ── Physics tick ─────────────────────────────────────────

  function tick() {
    // Archetypes are now fixed in a top row — no physics needed.
    // Keep the animation frame running for particle engine coordination.
    animFrame = requestAnimationFrame(tick);
  }

  // ── Public API (for SSE-driven animation) ────────────────

  window.simGraph = {
    /** Start / resume the physics loop */
    start() {
      if (simRunning) return;
      simRunning = true;
      alpha = Math.max(alpha, 0.3);  // reheat
      if (!animFrame) animFrame = requestAnimationFrame(tick);
    },

    /** Freeze the graph (called on simulation_complete) */
    stop() {
      simRunning = false;
      if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    },

    /** Set an archetype node's circle fill to reflect chosen product color */
    setArchetypeColor(archetypeId, colorHex) {
      const node = svg.querySelector(`[data-archetype-id="${archetypeId}"] .arch-circle`);
      if (node) {
        node.setAttribute('fill', colorHex);
        node.setAttribute('stroke', colorHex);
        node.setAttribute('stroke-opacity', '0.4');
        node.setAttribute('stroke-width', '3');
      }
    },

    /** Reset all archetype node colors to default gray */
    resetColors() {
      svg.querySelectorAll('.arch-circle').forEach((c) => {
        c.setAttribute('fill', '#475569');
        c.setAttribute('stroke', 'rgba(148,163,184,0.35)');
        c.setAttribute('stroke-opacity', '1');
        c.setAttribute('stroke-width', '1.5');
      });
    },

    /**
     * Draw/update an animated edge from an archetype node to a product node.
     * Called on each `archetype_evaluated` SSE event.
     * @param {string} archetypeId
     * @param {string} productId   - one of our_product | competitor_a | competitor_b | competitor_c | pass
     * @param {number} edgeWeight  - 0-1 relative thickness
     */
    drawEdge(archetypeId, productId, edgeWeight = 0.5) {
      const arch    = archetypes.find((a) => a.el.dataset.archetypeId === archetypeId);
      const prod    = products.find((p) =>   p.el.dataset.productId   === productId);
      if (!arch || !prod) return;

      const color     = PRODUCT_COLORS[productId] || '#94a3b8';
      const thickness = Math.max(1, edgeWeight * 5);
      const edgeId    = `edge-${archetypeId}-${productId}`;

      let line = document.getElementById(edgeId);
      if (!line) {
        line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.id = edgeId;
        document.getElementById('sim-edges')?.appendChild(line);
      }
      line.setAttribute('x1', arch.x);
      line.setAttribute('y1', arch.y);
      line.setAttribute('x2', prod.x);
      line.setAttribute('y2', prod.y);
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', thickness);
      line.setAttribute('stroke-opacity', '0.55');
      line.setAttribute('stroke-linecap', 'round');
      line.style.transition = 'all 0.3s ease';
    },

    /** Clear all edges (call before each iteration) */
    clearEdges() {
      const edgeGroup = document.getElementById('sim-edges');
      if (edgeGroup) edgeGroup.innerHTML = '';
    },

    /**
     * Return the current {x, y} of any archetype or product node by its data-id.
     * Used by initParticleEngine to seed product positions, and available for
     * external benchmark calls.
     * @param {string} id  archetype-id or product-id
     * @returns {{x: number, y: number}|null}
     */
    getNodePos(id) {
      const arch = archetypes.find((a) => a.el.dataset.archetypeId === id);
      if (arch) return { x: arch.x, y: arch.y };
      const prod = products.find((p) => p.el.dataset.productId === id);
      if (prod) return { x: prod.x, y: prod.y };
      return null;
    },
  };

  // ── Bootstrap ────────────────────────────────────────────

  // Responsive sizing via ResizeObserver
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) layout(width, height);
    }
  });
  resizeObserver.observe(wrap);

  // Initial layout from current DOM dimensions
  const rect = wrap.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    layout(rect.width, rect.height);
  } else {
    // Fallback: wait one frame for layout to settle
    requestAnimationFrame(() => {
      const r2 = wrap.getBoundingClientRect();
      layout(r2.width || 600, r2.height || 400);
    });
  }

  // Auto-start the idle animation (gentle floating motion)
  simRunning = true;
  animFrame  = requestAnimationFrame(tick);
}

// ==========================================================
//  Particle Engine Initializer — Sub-AC 4a
//  Must run AFTER initForceGraph() so window.simGraph is ready.
// ==========================================================

function initParticleEngine() {
  const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('particle-canvas'));
  const wrap   = document.getElementById('sim-canvas-wrap');
  if (!canvas || !wrap) return;

  // Create the engine
  _particleEngine = new ParticleEngine(canvas);

  // Expose on window for benchmark access from devtools / tests
  window.particleEngine = _particleEngine;

  // ── Sub-AC 6b: Attach SVG emoji group for DOM-visible 🦞 particles ──
  // The <g id="sim-emoji-particles"> inside the SVG receives transient
  // <text>🦞</text> elements on each spawn, making them detectable by
  // Playwright's assert_text_contains on [data-testid='sim-canvas'].
  const emojiGroup = document.getElementById('sim-emoji-particles');
  if (emojiGroup) _particleEngine.setEmojiGroup(emojiGroup);

  // ── Initial sizing ────────────────────────────────────────
  const rect = wrap.getBoundingClientRect();
  const initW = rect.width  || 600;
  const initH = rect.height || 400;
  _particleEngine.resize(initW, initH);

  // ── Initialize static bucket layout (Sub-AC 4a) ───────────
  // Seeds bucket positions from BUCKET_DEFS defaults so hit-detection
  // and canvas ring rendering work immediately, before SVG node positions
  // are available.
  _particleEngine.initBuckets(initW, initH);

  // ── Seed product node positions (they are fixed after layout) ──
  const PRODUCT_IDS = ['our_product', 'competitor_a', 'competitor_b', 'competitor_c', 'pass'];
  function syncProductPositions() {
    for (const pid of PRODUCT_IDS) {
      const pos = window.simGraph?.getNodePos(pid);
      // setProductPos() also updates the bucket registry for hit-detection
      if (pos) _particleEngine.setProductPos(pid, pos.x, pos.y);
    }
  }
  // Wait a frame so force-graph layout has run at least once
  requestAnimationFrame(() => syncProductPositions());

  // ── Responsive resize ─────────────────────────────────────
  new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        _particleEngine.resize(width, height);  // also calls initBuckets() internally
        syncProductPositions();
      }
    }
  }).observe(wrap);

  // ── Start the animation loop ──────────────────────────────
  _particleEngine.start();

  // ── Performance benchmark: run 2s after init ──────────────
  // Spawns 800 particles and verifies ≥30fps via performance.now().
  setTimeout(() => {
    const getPos = (id) => window.simGraph?.getNodePos(id) ?? null;
    _particleEngine.runPerfBench(getPos).then(({ fps, passed, activeOnSpawn }) => {
      // Expose result on window for automated test assertions
      window._particleBenchResult = { fps, passed, activeOnSpawn };
    });
  }, 2000);
}

// ==========================================================
//  Scroll Entry Animations — IntersectionObserver (PRD §12.2 rule 7)
//  Elements with .reveal start at opacity:0 + translateY(2rem)
//  Observer fires .is-visible once they intersect the viewport.
//  Fixed-viewport layout: all panels are always in-view, so this
//  triggers immediately on page load producing a staggered fade-in.
// ==========================================================

function initRevealObserver() {
  // Graceful degradation for browsers without IntersectionObserver
  if (typeof IntersectionObserver === 'undefined') {
    document.querySelectorAll('.reveal, .reveal-stagger').forEach((el) => {
      el.classList.add('is-visible');
    });
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target); // animate only once
        }
      });
    },
    {
      root: null,      // use viewport
      threshold: 0.05, // trigger as soon as 5% is visible
    },
  );

  document.querySelectorAll('.reveal, .reveal-stagger').forEach((el) => {
    observer.observe(el);
  });

  // Safety fallback: if observer hasn't fired within 400ms
  // (can happen when elements are inside overflow:hidden parents),
  // make everything visible so the UI is never stuck blank.
  setTimeout(() => {
    document.querySelectorAll('.reveal:not(.is-visible), .reveal-stagger:not(.is-visible)').forEach((el) => {
      el.classList.add('is-visible');
    });
  }, 400);
}

// ── Combined init ─────────────────────────────────────────

function initAll() {
  initForceGraph();
  initParticleEngine();
  initRevealObserver();
  initArchetypeInputListeners();
  initRevenueChartResize();
  // Run initial validation to set correct display state
  validateArchetypeCounts();
}

/**
 * Set up ResizeObserver on the revenue chart container for responsive re-rendering.
 * Re-renders the chart whenever the container changes size (window resize, panel resize, etc.)
 */
function initRevenueChartResize() {
  if (!elRevenueChart) return;
  if (typeof ResizeObserver === 'undefined') return;
  let _debounceTimer = null;
  const ro = new ResizeObserver(() => {
    // Debounce to avoid thrashing during continuous resize
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      if (_revenueData.length > 0) {
        _renderRevenueChart();
      }
    }, 60);
  });
  ro.observe(elRevenueChart);
}

// Run after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAll);
} else {
  initAll();
}

// ==========================================================
//  Agent Profile Popup — Sub-AC 5b
//  data-testid="agent-profile"
//  Triggered by clicking a log entry;
//  dismissible via X button, ESC key, backdrop click
// ==========================================================

// Note: ARCHETYPE_LABELS is declared near top of file (Sub-AC 4c) — shared here

// ── Popup element refs ────────────────────────────────────
const elAgentProfilePopup     = document.getElementById('agent-profile-popup');
const elAgentProfileBackdrop  = document.getElementById('agent-profile-backdrop');
const elAgentProfileClose     = document.getElementById('agent-profile-close');
const elAgentProfileDot       = document.getElementById('agent-profile-dot');
const elAgentProfileName      = document.getElementById('agent-profile-name');
const elAgentProfileArchetype = document.getElementById('agent-profile-archetype');
const elAgentProfileChoice    = document.getElementById('agent-profile-choice');
const elAgentProfileReasoning = document.getElementById('agent-profile-reasoning');

// Stat bar elements: { bar, val }
const statEls = {
  price_sensitivity: {
    bar: document.getElementById('stat-price-sensitivity'),
    val: document.getElementById('stat-val-price-sensitivity'),
  },
  trust_sensitivity: {
    bar: document.getElementById('stat-trust-sensitivity'),
    val: document.getElementById('stat-val-trust-sensitivity'),
  },
  promo_affinity: {
    bar: document.getElementById('stat-promo-affinity'),
    val: document.getElementById('stat-val-promo-affinity'),
  },
  brand_bias: {
    bar: document.getElementById('stat-brand-bias'),
    val: document.getElementById('stat-val-brand-bias'),
  },
  pass_threshold: {
    bar: document.getElementById('stat-pass-threshold'),
    val: document.getElementById('stat-val-pass-threshold'),
  },
};

// ── Popup open / close helpers ─────────────────────────────

/**
 * Open the agent profile popup with data from a log entry element.
 * @param {HTMLElement} entryEl - The clicked .agent-log-entry element
 */
function openAgentProfile(entryEl) {
  if (!elAgentProfilePopup) return;

  const archetypeId     = entryEl.getAttribute('data-archetype')       ?? '';
  const agentName       = entryEl.getAttribute('data-agent-name')      ?? entryEl.getAttribute('data-agent-id') ?? '구매자';
  const chosenProduct   = entryEl.getAttribute('data-chosen-product')  ?? 'pass';
  const reasoning       = entryEl.getAttribute('data-reasoning')       ?? '';

  // Per-agent stats (may be null if not present in legacy event)
  const priceSens  = parseFloat(entryEl.getAttribute('data-price-sensitivity') ?? '');
  const trustSens  = parseFloat(entryEl.getAttribute('data-trust-sensitivity')  ?? '');
  const promoAff   = parseFloat(entryEl.getAttribute('data-promo-affinity')     ?? '');
  const brandBias  = parseFloat(entryEl.getAttribute('data-brand-bias')         ?? '');
  const passThresh = parseFloat(entryEl.getAttribute('data-pass-threshold')     ?? '');

  // ── Populate header ────────────────────────────────────────
  const archetypeColor = ARCHETYPE_COLORS[archetypeId] ?? '#64748b';
  if (elAgentProfileDot) {
    elAgentProfileDot.style.backgroundColor = archetypeColor;
    elAgentProfileDot.style.color           = archetypeColor;
  }
  if (elAgentProfileName)      elAgentProfileName.textContent      = agentName;
  if (elAgentProfileArchetype) elAgentProfileArchetype.textContent = ARCHETYPE_LABELS[archetypeId] ?? archetypeId;

  // ── Populate stat bars ─────────────────────────────────────
  // Stats on 1–5 scale → width = (value / 5) * 100%
  function setStatBar(key, value, scale) {
    const els = statEls[key];
    if (!els) return;
    if (!isNaN(value)) {
      const pct = Math.min(100, Math.max(0, (value / scale) * 100));
      if (els.bar) els.bar.style.width = `${pct.toFixed(1)}%`;
      if (els.val) els.val.textContent  = value.toFixed(1);
    } else {
      if (els.bar) els.bar.style.width = '0%';
      if (els.val) els.val.textContent  = '—';
    }
  }
  setStatBar('price_sensitivity', priceSens,  5);
  setStatBar('trust_sensitivity', trustSens,  5);
  setStatBar('promo_affinity',    promoAff,   5);
  setStatBar('brand_bias',        brandBias,  5);
  // pass_threshold is 0–1 → width = value * 100%
  setStatBar('pass_threshold',    passThresh, 1);

  // ── Populate choice badge ──────────────────────────────────
  if (elAgentProfileChoice) {
    const productLabel = PRODUCT_LABELS[chosenProduct] ?? chosenProduct;
    elAgentProfileChoice.textContent = productLabel;
    elAgentProfileChoice.className   = `agent-chosen-product choice-${chosenProduct}`;
  }

  // ── Populate reasoning ─────────────────────────────────────
  if (elAgentProfileReasoning) {
    elAgentProfileReasoning.textContent = reasoning || '—';
  }

  // ── Populate PRD §16 profile-* testid fields (Sub-AC 4d) ──
  // Called here so it runs every time openAgentProfile is called
  // (populatePrdProfileFields is defined later in the file; hoisting handles it)
  if (typeof populatePrdProfileFields === 'function') {
    populatePrdProfileFields(entryEl);
  }

  // ── Show popup ─────────────────────────────────────────────
  elAgentProfilePopup.style.display = 'flex';
  // Re-trigger animation by removing and re-adding the dialog class animation
  const dialog = document.getElementById('agent-profile-dialog');
  if (dialog) {
    dialog.style.animation = 'none';
    // Force reflow then restore animation
    // eslint-disable-next-line no-unused-expressions
    dialog.offsetHeight;
    dialog.style.animation = '';
  }

  // Trap focus: focus the close button
  elAgentProfileClose?.focus();
}

/** Close the agent profile popup */
function closeAgentProfile() {
  if (elAgentProfilePopup) {
    elAgentProfilePopup.style.display = 'none';
  }
}

// ── Event listeners ────────────────────────────────────────

// X button
elAgentProfileClose?.addEventListener('click', closeAgentProfile);

// Backdrop click (not dialog itself)
elAgentProfileBackdrop?.addEventListener('click', closeAgentProfile);

// ESC key (global)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && elAgentProfilePopup?.style.display !== 'none') {
    closeAgentProfile();
  }
});

// ── Event delegation: log entry clicks ────────────────────
// Using the entries container as the delegated target so it works for
// dynamically created entries without adding a listener to each one.
elAgentLogEntries?.addEventListener('click', (e) => {
  const entry = e.target.closest('[data-testid="agent-log-entry"]');
  if (entry) {
    openAgentProfile(entry);
  }
});

// ==========================================================
//  Strategy Lobster — PRD §12.11 + §16 (Sub-AC 4d)
//  Shows per-iteration candidate strategies + winner crown
// ==========================================================

/** Candidate ID → lobster slot index (1-based); populated in updateStrategyLobster */
let _candidateIdToSlot = {};

/**
 * Populate the strategy lobster panel with candidates from iteration_start event.
 * @param {{ iteration:number, total:number, candidates:Array, strategy_reasoning:string }} opts
 */
function updateStrategyLobster({ iteration, total, candidates, strategy_reasoning }) {
  if (!elStrategyLobster) return;

  // Show the panel
  elStrategyLobster.style.display = 'block';

  // Update iteration label
  if (elStrategyIterationLabel) {
    elStrategyIterationLabel.textContent = `Iteration ${iteration}/${total ?? '?'}`;
  }

  // Clear winner icons and candidate map
  _candidateIdToSlot = {};
  strategyLobsterCandidates.forEach(({ winner }) => {
    if (winner) winner.style.display = 'none';
  });

  // Populate up to 3 candidate cards
  const cands = Array.isArray(candidates) ? candidates.slice(0, 3) : [];
  cands.forEach((c, i) => {
    const slot = strategyLobsterCandidates[i];
    if (!slot) return;
    if (slot.card) {
      slot.card.classList.remove('candidate-winner-active');
      slot.card.style.borderColor = ''; // clear inline override from prior winner
    }
    if (slot.title)     slot.title.textContent = c.title ?? c.id ?? `전략 ${i + 1}`;
    if (slot.price) {
      const priceVal = c.price_krw ?? c.priceKrw;
      slot.price.textContent = priceVal != null ? formatKRW(priceVal) : '';
    }
    // Render per-candidate rationale (from gpt-5.4 strategy proposer)
    if (slot.rationale) slot.rationale.textContent = c.rationale ?? '';
    // Map candidate id → slot index for winner marking
    if (c.id) _candidateIdToSlot[c.id] = i;
  });
  // Hide unused slots
  for (let i = cands.length; i < 3; i++) {
    const slot = strategyLobsterCandidates[i];
    if (slot?.card) slot.card.style.opacity = '0.2';
  }
  for (let i = 0; i < cands.length; i++) {
    const slot = strategyLobsterCandidates[i];
    if (slot?.card) slot.card.style.opacity = '1';
  }

  // Strategy reasoning (gpt-5.4 rationale)
  if (elStrategyLobsterRationale) {
    elStrategyLobsterRationale.textContent = strategy_reasoning
      ? `💡 ${strategy_reasoning}`
      : '';
  }
}

/**
 * Mark the winning candidate with 👑 on iteration_complete.
 * @param {string} winnerId - The winner_id from iteration_complete event
 */
function markStrategyLobsterWinner(winnerId) {
  if (!elStrategyLobster) return;
  const slotIdx = _candidateIdToSlot[winnerId];
  if (slotIdx == null) return;
  const slot = strategyLobsterCandidates[slotIdx];
  if (!slot) return;
  if (slot.winner) slot.winner.style.display = 'inline';
  if (slot.card) {
    slot.card.classList.add('candidate-winner-active');
    slot.card.style.borderColor = '#3b82f6'; // Explicit inline: ensures getComputedStyle picks up blue
  }
}

// ==========================================================
//  Results Popup — PRD §12.10 + §16 (Sub-AC 4d)
//  Opens automatically on simulation_complete
//  Dismissible via X button, ESC key, backdrop click
//  Re-openable via btn-show-results
// ==========================================================

/**
 * Open the results popup with a summary of the simulation_complete data.
 * @param {object} simData - The simulation_complete event data
 * @param {boolean} [autoShow=true] - If false, populate content but don't show the popup.
 *   Set to false when called from simulation_complete so agent-log-entries remain clickable.
 */
function openResultsPopup(simData, autoShow = true) {
  if (!elResultsPopup) return;

  // Populate popup body — fill static data-testid skeleton elements per PRD §12.10 + §16
  try {
    const baseline   = simData?.baseline  ?? {};
    const strategy   = simData?.selected_strategy ?? {};
    const holdout    = simData?.holdout   ?? {};
    const diff       = simData?.diff      ?? {};
    const artifact   = simData?.artifact  ?? {};

    const baseRev        = baseline.simulated_revenue ?? 0;
    const finalRev       = strategy.simulated_revenue ?? 0;
    const uplift         = holdout.holdout_uplift ?? (finalRev - baseRev);
    const upliftPositive = uplift >= 0;

    // ── Metrics — populate popup-specific data-testid="metric-*" elements ──────
    const elPopupMetricBaseline = document.getElementById('popup-metric-baseline');
    const elPopupMetricFinal    = document.getElementById('popup-metric-final');
    const elPopupMetricHoldout  = document.getElementById('popup-metric-holdout');
    if (elPopupMetricBaseline) elPopupMetricBaseline.textContent = formatKRW(baseRev);
    if (elPopupMetricFinal)    elPopupMetricFinal.textContent    = formatKRW(finalRev);
    if (elPopupMetricHoldout) {
      elPopupMetricHoldout.textContent  = (upliftPositive ? '+' : '') + formatKRW(uplift);
      elPopupMetricHoldout.style.color  = `var(${upliftPositive ? '--accent-green' : '--accent-red'})`;
    }

    // ── Strategy Summary — populate popup-specific data-testid="strategy-summary" ──
    const elPopupStratTitle    = document.getElementById('popup-strategy-title');
    const elPopupStratCopy     = document.getElementById('popup-strategy-copy');
    const elPopupStratPrice    = document.getElementById('popup-strategy-price');
    const elPopupStratMargin   = document.getElementById('popup-strategy-margin');
    const elPopupStratRationale = document.getElementById('popup-strategy-rationale-text');
    if (elPopupStratTitle)     elPopupStratTitle.textContent    = strategy.title ?? '—';
    if (elPopupStratCopy)      elPopupStratCopy.textContent     = strategy.top_copy ?? '—';
    if (elPopupStratPrice)     elPopupStratPrice.textContent    = strategy.price_krw != null ? formatKRW(strategy.price_krw) : '—';
    if (elPopupStratMargin) {
      const cost = strategy.cost_krw ?? 0;
      const price = strategy.price_krw ?? 1;
      const marginRate = price > 0 ? ((price - cost) / price * 100).toFixed(1) : '—';
      elPopupStratMargin.textContent = marginRate !== '—' ? `${marginRate}%` : '—';
    }
    if (elPopupStratRationale) elPopupStratRationale.textContent = strategy.rationale ?? strategy.strategy_reasoning ?? '—';

    // ── Diff Card — populate popup-specific data-testid="diff-*" elements ───────
    const stratTitle   = strategy.title ?? '—';
    const stratPriceKrw = strategy.price_krw;
    const diffTitle    = diff.title   ?? {};
    const diffTopCopy  = diff.top_copy ?? {};
    const diffPrice    = diff.price   ?? {};

    const elPopupDiffTitleBefore  = document.getElementById('popup-diff-title-before');
    const elPopupDiffTitleAfter   = document.getElementById('popup-diff-title-after');
    const elPopupDiffCopyBefore   = document.getElementById('popup-diff-copy-before');
    const elPopupDiffCopyAfter    = document.getElementById('popup-diff-copy-after');
    const elPopupDiffPriceBefore  = document.getElementById('popup-diff-price-before');
    const elPopupDiffPriceAfter   = document.getElementById('popup-diff-price-after');

    if (elPopupDiffTitleBefore) elPopupDiffTitleBefore.textContent = diffTitle.before ?? '—';
    if (elPopupDiffTitleAfter)  elPopupDiffTitleAfter.textContent  = diffTitle.after ?? stratTitle;
    if (elPopupDiffCopyBefore)  elPopupDiffCopyBefore.textContent  = diffTopCopy.before ?? '—';
    if (elPopupDiffCopyAfter)   elPopupDiffCopyAfter.textContent   = diffTopCopy.after ?? strategy.top_copy ?? '—';
    if (elPopupDiffPriceBefore) {
      const priceBefore = diffPrice.before ?? baseline.current_price_krw;
      elPopupDiffPriceBefore.textContent = priceBefore != null ? formatKRW(priceBefore) : '—';
    }
    if (elPopupDiffPriceAfter) {
      const priceAfter   = diffPrice.after ?? stratPriceKrw;
      const priceBefore2 = diffPrice.before ?? baseline.current_price_krw;
      let pctStr = '';
      if (priceAfter != null && priceBefore2 != null && priceBefore2 !== 0) {
        const pct = ((priceAfter - priceBefore2) / priceBefore2 * 100).toFixed(1);
        pctStr = ` (${pct > 0 ? '+' : ''}${pct}%)`;
        elPopupDiffPriceAfter.style.color = pct <= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
      }
      elPopupDiffPriceAfter.textContent = priceAfter != null ? formatKRW(priceAfter) + pctStr : '—';
    }

    // ── Artifact — populate popup-specific data-testid="artifact-output" ────────
    const stratId    = strategy.id ?? artifact?.payload?.selected_strategy?.id ?? '—';
    const artUplift  = artifact?.payload?.holdout_uplift ?? holdout.holdout_uplift ?? (finalRev - baseRev);
    const artTs      = artifact?.payload?.timestamp ?? artifact?.timestamp ?? '';
    const elPopupArtId      = document.getElementById('popup-artifact-strategy-id');
    const elPopupArtUplift  = document.getElementById('popup-artifact-holdout-uplift');
    const elPopupArtTs      = document.getElementById('popup-artifact-timestamp');
    if (elPopupArtId)     elPopupArtId.textContent     = stratId;
    if (elPopupArtUplift) elPopupArtUplift.textContent = (artUplift >= 0 ? '+' : '') + formatKRW(artUplift);
    if (elPopupArtTs)     elPopupArtTs.textContent     = artTs ? new Date(artTs).toLocaleString('ko-KR') : '—';

    // ── Insights — mirror from panel-results to popup ────────────────────────────
    const srcInsightsList = document.getElementById('insights-list');
    const dstInsightsList = document.getElementById('popup-insights-list');
    if (srcInsightsList && dstInsightsList && srcInsightsList.children.length > 0) {
      // Copy rendered insight items into the popup's insights list,
      // but strip data-testid to avoid duplicate testid strict-mode violations in Playwright.
      dstInsightsList.innerHTML = srcInsightsList.innerHTML;
      dstInsightsList.querySelectorAll('[data-testid]').forEach((el) => el.removeAttribute('data-testid'));
      // Hide placeholder
      const placeholder = document.getElementById('popup-insights-placeholder');
      if (placeholder) placeholder.style.display = 'none';
    }

    // ── Legacy innerHTML fallback for results-popup-artifact text (kept for compat)
    // The static artifact-output block above is the primary, but the legacy
    // elResultsPopupArtifact container text still gets a quick summary:
    if (elResultsPopupArtifact && !elResultsPopupArtifact.querySelector('[data-testid="artifact-output"]')) {
      // Only set textContent if the static skeleton hasn't been rendered inside it
      // (this branch is a no-op when the static skeleton is present, but guards against
      //  any edge case where the element is empty)
    }

  } catch (err) {
    console.warn('openResultsPopup error:', err);
  }

  if (autoShow) {
    elResultsPopup.style.display = 'flex';
    // Render popup revenue chart after popup is visible (needs layout dimensions)
    requestAnimationFrame(() => _renderPopupRevenueChart());
    // Trap focus
    elResultsPopupClose?.focus();
  }
}

/** Close the results popup */
function closeResultsPopup() {
  if (elResultsPopup) {
    elResultsPopup.style.display = 'none';
  }
}

/** Simple HTML escaping for user-generated content in popup */
function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Results popup event listeners
elResultsPopupClose?.addEventListener('click', closeResultsPopup);
elResultsPopupBackdrop?.addEventListener('click', closeResultsPopup);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && elResultsPopup?.style.display !== 'none') {
    closeResultsPopup();
  }
});

// btn-show-results: re-open the popup after it was dismissed
elBtnShowResults?.addEventListener('click', () => {
  if (elResultsPopup) {
    elResultsPopup.style.display = 'flex';
    // Re-render popup revenue chart (dimensions may have changed)
    requestAnimationFrame(() => _renderPopupRevenueChart());
    elResultsPopupClose?.focus();
  }
});

// ==========================================================
//  Profile Popup — PRD §16 extra fields (Sub-AC 4d)
//  profile-location, profile-occupation, profile-bio,
//  profile-archetype, profile-choice, profile-reasoning
// ==========================================================

// Extra element refs for PRD §16 testids (added Sub-AC 4d)
const elProfileArchetype   = document.getElementById('profile-archetype');
const elProfileLocation    = document.getElementById('profile-location');
const elProfileLocationTxt = document.getElementById('profile-location-text');
const elProfileOccupation  = document.getElementById('profile-occupation');
const elProfileOccupationT = document.getElementById('profile-occupation-text');
const elProfileBio         = document.getElementById('profile-bio');
const elProfileChoice      = document.getElementById('profile-choice');
const elProfileReasoning   = document.getElementById('profile-reasoning');

/**
 * Populate the PRD §16 profile-* testid fields from agent entry data.
 * Called from openAgentProfile after the existing elements are populated.
 * @param {HTMLElement} entryEl
 */
function populatePrdProfileFields(entryEl) {
  const archetypeId   = entryEl.getAttribute('data-archetype')      ?? '';
  const chosenProduct = entryEl.getAttribute('data-chosen-product') ?? 'pass';
  const reasoning     = entryEl.getAttribute('data-reasoning')      ?? '';
  const location      = entryEl.getAttribute('data-location')       ?? '';
  const occupation    = entryEl.getAttribute('data-occupation')     ?? '';
  const bio           = entryEl.getAttribute('data-bio')            ?? '';

  // profile-archetype (mirrors agent-profile-archetype)
  if (elProfileArchetype) {
    elProfileArchetype.textContent = ARCHETYPE_LABELS[archetypeId] ?? archetypeId;
    elProfileArchetype.style.display = '';
  }

  // profile-location
  if (elProfileLocation && location) {
    if (elProfileLocationTxt) elProfileLocationTxt.textContent = location;
    elProfileLocation.style.display = '';
  } else if (elProfileLocation) {
    elProfileLocation.style.display = 'none';
  }

  // profile-occupation
  if (elProfileOccupation && occupation) {
    if (elProfileOccupationT) elProfileOccupationT.textContent = occupation;
    elProfileOccupation.style.display = '';
  } else if (elProfileOccupation) {
    elProfileOccupation.style.display = 'none';
  }

  // profile-bio
  if (elProfileBio) {
    if (bio) {
      elProfileBio.textContent = bio;
      elProfileBio.style.display = '';
    } else {
      elProfileBio.style.display = 'none';
    }
  }

  // profile-choice (mirrors agent-profile-choice)
  if (elProfileChoice) {
    const productLabel = PRODUCT_LABELS[chosenProduct] ?? chosenProduct;
    elProfileChoice.textContent = productLabel;
    elProfileChoice.className   = `agent-chosen-product choice-${chosenProduct}`;
    elProfileChoice.style.display = '';
  }

  // profile-reasoning (mirrors agent-profile-reasoning)
  if (elProfileReasoning) {
    elProfileReasoning.textContent = reasoning || '—';
    elProfileReasoning.style.display = '';
  }
}
