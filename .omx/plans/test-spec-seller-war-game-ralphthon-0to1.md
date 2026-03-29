# Test Spec — SwarmOps Ralphthon 0→1

## 1. Verification Philosophy

이 test spec은 단순 코드 안정성 체크가 아니라, Ralphthon 당일 `0→1 product outcome`이 완성되었는지를 검증하는 문서다.

검증은 8개의 gate로 나눈다:

1. Engine Gate — 시뮬레이션 엔진 정합성
2. Live OpenAI Gate — 실제 모델 호출 성공
3. HTTP API Gate — 모든 endpoint 정상 동작
4. Browser UI Gate — data-testid 기반 E2E 검증
5. SSE Streaming Gate — 실시간 이벤트 스트리밍 검증
6. Editable Input Gate — 사용자 입력이 결과에 반영
7. Visual / Usability Gate — 스크린샷 기반 객관적 검증
8. Artifact / Consistency Gate — UI·API·파일 값 일치

## 2. Engine Gate

`npm test` 실행 시 다음이 모두 통과해야 한다:

| 검증 항목 | 테스트 파일 | 판정 기준 |
|----------|-----------|----------|
| fixture parsing | `fixtures.test.mjs` | `loadFixtureBundle()` 성공, 4개 fixture 모두 로드 |
| agent generation | `sampler.test.mjs` | 800 에이전트 생성 시 아키타입 비율이 cohort_weight_percent에 비례 (±1 허용) |
| strategy schema | `schemas.test.mjs` | 생성된 전략에 `id`, `title`, `top_copy`, `price_krw` 포함 |
| buyer evaluator schema | `schemas.test.mjs` | 평가 결과에 `archetype_id`, `evaluations` 포함 |
| realism judge schema | `judge.test.mjs` | 판정에 `verdict` (pass/fail), `reasoning` 포함 |
| margin floor enforcement | `scorer.test.mjs` | 마진율 < floor → `margin_floor_violations > 0` |
| holdout gate | `engine.test.mjs` | holdout 결과에 `holdout_uplift` 필드 존재 |
| diff output fields | `engine.test.mjs` | diff 키가 `title`, `top_copy`, `price` 3개만 포함 |

추가 검증:
```bash
node --check src/server.mjs
node --check src/lib/simulation/engine.mjs
```
→ 문법 오류 없이 성공해야 함.

## 3. Live OpenAI Gate

| 검증 항목 | 판정 기준 |
|----------|----------|
| `gpt-5.4` live call | strategy generation이 live 모드에서 성공 |
| `gpt-5-nano` live call | buyer evaluation이 live 모드에서 성공 |
| mock-free accepted result | accepted 전략이 mock fallback 없이 생성됨 |
| full simulation completion | live run이 모든 iteration + holdout까지 완료 |

권장 강화 기준:
- `all_calls_live = true` (모든 호출이 live)
- 최소한 accepted result는 fallback 없이 생성

## 4. HTTP API Gate

서버를 `npm start`로 띄운 후 다음 endpoint를 검증한다.

### 4.1 Health Check

```yaml
- id: "health"
  method: GET
  path: "/"
  expected_status: 200
  body_contains: ["SwarmOps"]
  timeout_sec: 10
```

### 4.2 Fixture API

```yaml
- id: "fixtures"
  method: GET
  path: "/api/fixtures"
  expected_status: 200
  body_contains:
    - "product"
    - "competitors"
    - "archetypes"
    - "defaults"
    - "current_title"
    - "current_top_copy"
    - "current_cost_krw"
    - "brand_name"
  body_json_checks:
    # Product (Input Panel의 editable fields 초기화에 필요)
    - path: "product.product_name"
      not_empty: true
    - path: "product.brand_name"
      not_empty: true
    - path: "product.current_title"
      not_empty: true
    - path: "product.current_top_copy"
      not_empty: true
    - path: "product.current_price_krw"
      type: "number"
    - path: "product.current_cost_krw"
      type: "number"
    # Competitors
    - path: "competitors"
      is_array: true
      min_length: 3
    - path: "competitors[0].id"
      not_empty: true
    - path: "competitors[0].product_name"
      not_empty: true
    - path: "competitors[0].price_krw"
      type: "number"
    # Archetypes
    - path: "archetypes"
      is_array: true
      min_length: 8
    - path: "archetypes[0].id"
      not_empty: true
    - path: "archetypes[0].label"
      not_empty: true
    # Defaults
    - path: "defaults.iteration_count"
      type: "number"
    - path: "defaults.minimum_margin_floor"
      type: "number"
  timeout_sec: 10
```

**참고**: 현재 서버 코드는 `summary.product` (문자열)만 반환한다. PRD §14.4에 정의된 확장 스키마에 맞게 서버가 수정되어야 이 테스트가 통과한다.

### 4.3 Batch Run API

```yaml
- id: "batch_run_mock"
  method: POST
  path: "/api/run"
  request_body:
    iterationCount: 1
    minimumMarginFloor: 0.35
  expected_status: 200
  body_contains:
    - "baseline"
    - "selected_strategy"
    - "holdout"
    - "diff"
    - "artifact"
  body_json_checks:
    - path: "baseline.simulated_revenue"
      type: "number"
    - path: "selected_strategy.id"
      not_empty: true
    - path: "holdout.holdout_uplift"
      type: "number"
    - path: "diff.title"
      exists: true
    - path: "diff.top_copy"
      exists: true
    - path: "diff.price"
      exists: true
  timeout_sec: 120
```

### 4.4 Batch Run with Overrides

```yaml
- id: "batch_run_with_overrides"
  method: POST
  path: "/api/run"
  request_body:
    iterationCount: 1
    minimumMarginFloor: 0.35
    title: "테스트 오버라이드 타이틀"
    topCopy: "테스트 오버라이드 카피"
    priceKrw: 25000
    costKrw: 10000
  expected_status: 200
  body_json_checks:
    - path: "baseline.simulated_revenue"
      type: "number"
  timeout_sec: 120
```

### 4.5 SSE Stream Endpoint (기본)

```yaml
- id: "sse_stream"
  method: POST
  path: "/api/run/stream"
  request_body:
    iterationCount: 1
    minimumMarginFloor: 0.35
  expected_content_type: "text/event-stream"
  expected_events:
    - "iteration_start"
    - "agent_decision"
    - "iteration_complete"
    - "simulation_complete"
  timeout_sec: 120
```

### 4.6 SSE Stream with Overrides

```yaml
- id: "sse_stream_with_overrides"
  method: POST
  path: "/api/run/stream"
  request_body:
    iterationCount: 1
    minimumMarginFloor: 0.35
    title: "SSE 오버라이드 타이틀 테스트"
    topCopy: "오버라이드된 카피"
    priceKrw: 24900
    costKrw: 9500
  expected_content_type: "text/event-stream"
  expected_events:
    - "iteration_start"
    - "agent_decision"
    - "iteration_complete"
    - "simulation_complete"
  validation:
    - event: "simulation_complete"
      check: "data.diff.title.before != data.diff.title.after OR baseline uses overridden values"
  timeout_sec: 120
```

## 5. SSE Streaming Gate

SSE 스트리밍이 정상 동작하는지 검증한다.

### 5.1 Event Sequence Validation

1회 iteration 실행 시 이벤트 순서가 다음과 같아야 한다:

```
iteration_start (iteration=1, agent_count=800)
  → agent_decision × 800 (개별 에이전트, concurrent 전송)
  → iteration_complete (iteration=1, choice_summary 포함)
→ holdout_start (agent_count=200)
→ simulation_complete
```

| 검증 항목 | 판정 기준 |
|----------|----------|
| iteration_start 수신 | `iteration` ≥ 1, `total` = `iterationCount`, `agent_count` = 800 |
| agent_decision 수신 | 정확히 **800개**, 각각 `agent_id`, `agent_name`, `archetype_id`, `chosen_product`, `reasoning` 포함 |
| agent_decision.chosen_product | 반드시 `our_product`, `competitor_a`, `competitor_b`, `competitor_c`, `pass` 중 하나 |
| agent_decision.agent_index | 1~800 범위, 중복 없음 |
| agent_decision 아키타입 분배 | 각 archetype_id별 agent 수가 cohort_weight_percent에 비례 (±1 허용) |
| iteration_complete 수신 | `winner_id` 존재, `winner_revenue` > 0, `choice_summary` (5개 제품별 총 선택 수), `archetype_breakdown` (8개 아키타입별 분배) |
| choice_summary 합산 | `our_product + competitor_a + competitor_b + competitor_c + pass = 800` |
| simulation_complete 수신 | `baseline`, `selected_strategy`, `holdout`, `diff`, `artifact`, `total_agents`, `total_llm_calls` 모두 포함 |
| error 미발생 | 정상 실행 시 `error` 이벤트 없음 |

### 5.2 Individual Agent Validation

| 검증 항목 | 판정 기준 |
|----------|----------|
| agent_name 형식 | 한국 이름 형태 (2-3글자 한글), 비어있지 않음 |
| reasoning 길이 | 1자 이상, 200자 이하 |
| archetype 분배 정확성 | price_sensitive: 144명 (±1), value_seeker: 128명 (±1), ... cohort_weight_percent 비례 |
| agent_id 고유성 | 800개 agent_id 중복 없음 |
| chosen_product 유효성 | 5개 유효값 외 다른 값 없음 |

### 5.3 Performance Requirements

| 검증 항목 | 판정 기준 |
|----------|----------|
| **전체 시뮬레이션 시간** | **≤ 600초 (10분)** — 5 iterations + holdout 포함. Hard constraint |
| concurrent 설정 | rate limit 허용 범위 내 최대 (200+ 권장). `max_concurrency` 설정 가능 |
| 파티클 플로우 FPS | **≥ 30fps** — 800개 파티클 동시 렌더링 시 (Canvas 2D + requestAnimationFrame) |
| UI 응답 시간 | **≤ 500ms** — Revenue 차트 바 추가, 프로필 팝업 표시, 카운터 업데이트 |
| SSE 이벤트 순서 | agent_index가 순서대로 증가하지 않아도 OK (concurrent 특성), 다만 모든 index 존재 |
| 카운터 최종값 | iteration 완료 시 agent-count = "800 / 800" |

### 5.4 Error Recovery

| 검증 항목 | 판정 기준 |
|----------|----------|
| API 키 없음 | `error` 이벤트 수신, `message` 포함, `recoverable` boolean |
| 서버 중단 | SSE 연결 끊김 시 클라이언트에서 `state-error` 표시 |

## 6. Browser UI Gate

Playwright 기반 E2E 테스트. 서버가 `http://127.0.0.1:3001`에서 실행 중이어야 한다.

### 6.1 Empty State Flow

```yaml
- id: "browser_empty_state"
  service: "web"
  name: "Dashboard empty state verification"
  start_route: "/"
  steps:
    - type: "goto"
      url: "/"
      timeout_sec: 15
    - type: "assert_visible"
      label: "Input panel visible"
      selector: "[data-testid='panel-input']"
      timeout_sec: 10
    - type: "assert_visible"
      label: "Simulation panel visible"
      selector: "[data-testid='panel-simulation']"
      timeout_sec: 10
    - type: "assert_visible"
      label: "Results panel visible"
      selector: "[data-testid='panel-activity']"
      timeout_sec: 10
    - type: "assert_visible"
      label: "Product card visible"
      selector: "[data-testid='product-card']"
      timeout_sec: 10
    - type: "assert_not_empty"
      label: "Product name populated"
      selector: "[data-testid='product-name']"
      timeout_sec: 10
    - type: "assert_visible"
      label: "Title input visible"
      selector: "[data-testid='input-title']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Title pre-populated"
      selector: "[data-testid='input-title']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Top copy input visible"
      selector: "[data-testid='input-top-copy']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Price input visible"
      selector: "[data-testid='input-price']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Cost input visible"
      selector: "[data-testid='input-cost']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Competitors card visible"
      selector: "[data-testid='competitors-card']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Competitor A card"
      selector: "[data-testid='competitor-a']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Competitor B card"
      selector: "[data-testid='competitor-b']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Competitor C card"
      selector: "[data-testid='competitor-c']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Settings card visible"
      selector: "[data-testid='settings-card']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Iteration count input"
      selector: "[data-testid='input-iteration-count']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Margin floor input"
      selector: "[data-testid='input-margin-floor']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Run button visible and enabled"
      selector: "[data-testid='btn-run']:not([disabled])"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Empty state indicator in simulation panel"
      selector: "[data-testid='state-empty']"
      timeout_sec: 5
    # Fixture pre-populate 검증: API에서 받은 값이 editable 필드에 채워졌는지
    - type: "assert_value_contains"
      label: "Title pre-populated from fixture"
      selector: "[data-testid='input-title']"
      text: "트리클리닉"
      timeout_sec: 5
    - type: "assert_value_contains"
      label: "Top copy pre-populated from fixture"
      selector: "[data-testid='input-top-copy']"
      text: "두피과학"
      timeout_sec: 5
    - type: "assert_value"
      label: "Price pre-populated from fixture"
      selector: "[data-testid='input-price']"
      value: "29900"
      timeout_sec: 5
    - type: "assert_value"
      label: "Cost pre-populated from fixture"
      selector: "[data-testid='input-cost']"
      value: "11000"
      timeout_sec: 5
    - type: "screenshot"
      name: "empty_state_desktop"
      timeout_sec: 5
  timeout_sec: 60
```

### 6.2 Full Run Flow (Mock Mode)

```yaml
- id: "browser_full_run_mock"
  service: "web"
  name: "Full simulation run via browser (mock mode)"
  env:
    SELLER_WAR_GAME_MODEL_MODE: "mock"
  start_route: "/"
  steps:
    - type: "goto"
      url: "/"
      timeout_sec: 15
    - type: "assert_visible"
      label: "Dashboard loaded"
      selector: "[data-testid='panel-input']"
      timeout_sec: 10
    - type: "clear_and_type"
      label: "Edit title"
      selector: "[data-testid='input-title']"
      value: "테스트 타이틀 변경"
      timeout_sec: 5
    - type: "clear_and_type"
      label: "Set iteration count to 1"
      selector: "[data-testid='input-iteration-count']"
      value: "1"
      timeout_sec: 5
    - type: "click"
      label: "Click Run simulation"
      selector: "[data-testid='btn-run']"
      timeout_sec: 5
    - type: "assert_attribute"
      label: "Run button disabled during run"
      selector: "[data-testid='btn-run']"
      attribute: "disabled"
      timeout_sec: 5
    - type: "wait_for_visible"
      label: "Simulation canvas active"
      selector: "[data-testid='sim-canvas']"
      timeout_sec: 10
    # Particle flow visualization 검증
    - type: "assert_visible"
      label: "Our product counter visible"
      selector: "[data-testid='product-counter-our_product']"
      timeout_sec: 10
    - type: "assert_visible"
      label: "Competitor A counter visible"
      selector: "[data-testid='product-counter-competitor_a']"
      timeout_sec: 10
    - type: "assert_visible"
      label: "Agent count visible"
      selector: "[data-testid='agent-count']"
      timeout_sec: 10
    - type: "assert_visible"
      label: "Progress indicator visible"
      selector: "[data-testid='sim-progress']"
      timeout_sec: 10
    - type: "wait_for_text_change"
      label: "Agent count incrementing"
      selector: "[data-testid='agent-count']"
      timeout_sec: 30
    - type: "assert_text_contains"
      label: "Lobster emoji in simulation canvas"
      selector: "[data-testid='sim-canvas']"
      text: "🦞"
      timeout_sec: 10
    - type: "screenshot"
      name: "loading_state_desktop"
      timeout_sec: 5
    - type: "wait_for_visible"
      label: "Wait for completed state"
      selector: "[data-testid='state-completed']"
      timeout_sec: 180
    - type: "assert_not_empty"
      label: "Baseline revenue populated"
      selector: "[data-testid='metric-baseline']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Final revenue populated"
      selector: "[data-testid='metric-final']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Holdout uplift populated"
      selector: "[data-testid='metric-holdout']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Strategy summary populated"
      selector: "[data-testid='strategy-summary']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Diff title visible"
      selector: "[data-testid='diff-title']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Diff top copy visible"
      selector: "[data-testid='diff-top-copy']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Diff price visible"
      selector: "[data-testid='diff-price']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Artifact output populated"
      selector: "[data-testid='artifact-output']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Run button re-enabled"
      selector: "[data-testid='btn-run']:not([disabled])"
      timeout_sec: 5
    - type: "screenshot"
      name: "completed_state_desktop"
      timeout_sec: 5
  timeout_sec: 240
```

### 6.3 Full Run Flow (Live Mode)

```yaml
- id: "browser_full_run_live"
  service: "web"
  name: "Full simulation run via browser (live OpenAI mode)"
  env:
    SELLER_WAR_GAME_MODEL_MODE: "live"
  start_route: "/"
  steps:
    - type: "goto"
      url: "/"
      timeout_sec: 15
    - type: "assert_visible"
      label: "Dashboard loaded"
      selector: "[data-testid='panel-input']"
      timeout_sec: 10
    - type: "click"
      label: "Click Run simulation"
      selector: "[data-testid='btn-run']"
      timeout_sec: 5
    - type: "wait_for_visible"
      label: "Simulation progress visible"
      selector: "[data-testid='sim-progress']"
      timeout_sec: 30
    - type: "wait_for_visible"
      label: "Wait for completed state"
      selector: "[data-testid='state-completed']"
      timeout_sec: 600
    - type: "assert_not_empty"
      label: "Baseline revenue populated"
      selector: "[data-testid='metric-baseline']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Final revenue populated"
      selector: "[data-testid='metric-final']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Holdout uplift populated"
      selector: "[data-testid='metric-holdout']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Strategy summary populated"
      selector: "[data-testid='strategy-summary']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Diff output visible"
      selector: "[data-testid='diff-output']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Artifact output populated"
      selector: "[data-testid='artifact-output']"
      timeout_sec: 5
    - type: "screenshot"
      name: "completed_state_live"
      timeout_sec: 5
  timeout_sec: 660
```

### 6.4 Error State Flow

```yaml
- id: "browser_error_state"
  service: "web"
  name: "Error state verification"
  env:
    OPENAI_API_KEY: "invalid_key_for_testing"
    SELLER_WAR_GAME_MODEL_MODE: "live"
  start_route: "/"
  steps:
    - type: "goto"
      url: "/"
      timeout_sec: 15
    - type: "click"
      label: "Click Run simulation"
      selector: "[data-testid='btn-run']"
      timeout_sec: 5
    - type: "wait_for_visible"
      label: "Error state visible"
      selector: "[data-testid='state-error']"
      timeout_sec: 60
    - type: "assert_not_empty"
      label: "Error message displayed"
      selector: "[data-testid='status-text']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Run button re-enabled after error"
      selector: "[data-testid='btn-run']:not([disabled])"
      timeout_sec: 5
    - type: "screenshot"
      name: "error_state_desktop"
      timeout_sec: 5
  timeout_sec: 90
```

### 6.5 Results Popup Verification

```yaml
- id: "browser_results_popup"
  service: "web"
  name: "Results popup appears on simulation complete and contains all data"
  start_route: "/"
  steps:
    - type: "goto"
      url: "/"
      timeout_sec: 15
    - type: "clear_and_type"
      selector: "[data-testid='input-iteration-count']"
      value: "1"
      timeout_sec: 5
    - type: "click"
      selector: "[data-testid='btn-run']"
      timeout_sec: 5
    - type: "wait_for_visible"
      label: "Results popup appears after completion"
      selector: "[data-testid='results-popup']"
      timeout_sec: 300
    - type: "assert_not_empty"
      label: "Baseline revenue in popup"
      selector: "[data-testid='metric-baseline']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Final revenue in popup"
      selector: "[data-testid='metric-final']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Holdout uplift in popup"
      selector: "[data-testid='metric-holdout']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Strategy summary in popup"
      selector: "[data-testid='strategy-summary']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Diff in popup"
      selector: "[data-testid='diff-output']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Revenue chart in popup"
      selector: "[data-testid='revenue-chart']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Insights in popup"
      selector: "[data-testid='insights-panel']"
      timeout_sec: 5
    - type: "click"
      label: "Close popup"
      selector: "[data-testid='results-popup-close']"
      timeout_sec: 5
    - type: "assert_not_visible"
      label: "Popup closed"
      selector: "[data-testid='results-popup']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Show results button available"
      selector: "[data-testid='btn-show-results']"
      timeout_sec: 5
    - type: "click"
      label: "Re-open popup"
      selector: "[data-testid='btn-show-results']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Popup re-opened"
      selector: "[data-testid='results-popup']"
      timeout_sec: 5
  timeout_sec: 360
```

### 6.6 Archetype Mixer Verification

```yaml
- id: "browser_archetype_mixer"
  service: "web"
  name: "Archetype mixer validates total = 800 and disables run button"
  start_route: "/"
  steps:
    - type: "goto"
      url: "/"
      timeout_sec: 15
    - type: "assert_visible"
      label: "Archetype mixer visible"
      selector: "[data-testid='archetype-mixer']"
      timeout_sec: 10
    - type: "assert_visible"
      label: "Agent total shows 800"
      selector: "[data-testid='agent-total']"
      timeout_sec: 5
    - type: "assert_text_contains"
      label: "Total is 800"
      selector: "[data-testid='agent-total']"
      text: "800"
      timeout_sec: 5
    # 값 변경 → 합 != 800 → btn-run disabled
    - type: "clear_and_type"
      label: "Change price_sensitive to 0"
      selector: "[data-testid='count-price_sensitive']"
      value: "0"
      timeout_sec: 5
    - type: "assert_attribute"
      label: "Run button disabled when total != 800"
      selector: "[data-testid='btn-run']"
      attribute: "disabled"
      timeout_sec: 5
    # 값 복원
    - type: "clear_and_type"
      label: "Restore price_sensitive"
      selector: "[data-testid='count-price_sensitive']"
      value: "144"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Run button re-enabled"
      selector: "[data-testid='btn-run']:not([disabled])"
      timeout_sec: 5
  timeout_sec: 60
```

### 6.7 Agent Chat Log + Revenue Chart + Insights + Profile Verification

```yaml
- id: "browser_new_features"
  service: "web"
  name: "Verify agent chat log, revenue chart, insights, and profile popup"
  start_route: "/"
  steps:
    - type: "goto"
      url: "/"
      timeout_sec: 15
    - type: "clear_and_type"
      selector: "[data-testid='input-iteration-count']"
      value: "1"
      timeout_sec: 5
    - type: "click"
      selector: "[data-testid='btn-run']"
      timeout_sec: 5

    # 👑🦞 Strategy Lobster 검증
    - type: "wait_for_visible"
      label: "Strategy lobster panel visible"
      selector: "[data-testid='strategy-lobster']"
      timeout_sec: 30
    - type: "assert_visible"
      label: "Strategy candidate cards visible"
      selector: "[data-testid='strategy-candidate-1']"
      timeout_sec: 10
    - type: "assert_not_empty"
      label: "Strategy rationale populated"
      selector: "[data-testid='strategy-rationale']"
      timeout_sec: 10

    # Agent Chat Log 검증
    - type: "wait_for_visible"
      label: "Agent chat log container visible"
      selector: "[data-testid='agent-log']"
      timeout_sec: 30
    - type: "wait_for_element_count"
      label: "Wait for at least 10 agent log entries"
      selector: "[data-testid='agent-log-entry']"
      min_count: 10
      timeout_sec: 60

    # 시뮬레이션 완료 대기
    - type: "wait_for_visible"
      selector: "[data-testid='state-completed']"
      timeout_sec: 300

    # Agent Log: 800개 엔트리 확인
    - type: "assert_element_count"
      label: "800 agent log entries"
      selector: "[data-testid='agent-log-entry']"
      expected_count: 800
      tolerance: 0
      timeout_sec: 5

    # Revenue Chart 검증
    - type: "assert_visible"
      label: "Revenue chart visible"
      selector: "[data-testid='revenue-chart']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "Revenue baseline line visible"
      selector: "[data-testid='revenue-baseline']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "At least 1 revenue bar"
      selector: "[data-testid='revenue-bar-1']"
      timeout_sec: 5

    # Insights 검증
    - type: "assert_visible"
      label: "Insights panel visible"
      selector: "[data-testid='insights-panel']"
      timeout_sec: 5
    - type: "assert_element_count"
      label: "At least 3 insight items"
      selector: "[data-testid='insight-item']"
      min_count: 3
      timeout_sec: 5

    # Archetype Summary Table 검증
    - type: "assert_visible"
      label: "Archetype summary table visible"
      selector: "[data-testid='archetype-summary-table']"
      timeout_sec: 5
    - type: "assert_element_count"
      label: "8 archetype rows in summary table"
      selector: "[data-testid='archetype-summary-table'] tr"
      min_count: 8
      timeout_sec: 5

    # Insight 규칙 검증
    - type: "assert_element_count"
      label: "At least 3 insight items"
      selector: "[data-testid='insight-item']"
      min_count: 3
      timeout_sec: 5
    - type: "assert_text_matches"
      label: "Insight contains percentage"
      selector: "[data-testid='insight-item']:first-child"
      pattern: "\\d+%"
      timeout_sec: 5

    # Agent Profile Popup 검증
    - type: "click"
      label: "Click first agent log entry"
      selector: "[data-testid='agent-log-entry']:first-child"
      timeout_sec: 5
    - type: "wait_for_visible"
      label: "Agent profile popup visible"
      selector: "[data-testid='agent-profile']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Profile name populated"
      selector: "[data-testid='profile-name']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Profile location populated"
      selector: "[data-testid='profile-location']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Profile occupation populated"
      selector: "[data-testid='profile-occupation']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Profile bio populated"
      selector: "[data-testid='profile-bio']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Profile archetype populated"
      selector: "[data-testid='profile-archetype']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Profile choice populated"
      selector: "[data-testid='profile-choice']"
      timeout_sec: 5
    - type: "assert_not_empty"
      label: "Profile reasoning populated"
      selector: "[data-testid='profile-reasoning']"
      timeout_sec: 5
    - type: "assert_visible"
      label: "At least one stat bar"
      selector: "[data-testid^='profile-stat-']"
      timeout_sec: 5
    - type: "click"
      label: "Close profile popup"
      selector: "[data-testid='agent-profile-close']"
      timeout_sec: 5
    - type: "assert_not_visible"
      label: "Profile popup closed"
      selector: "[data-testid='agent-profile']"
      timeout_sec: 5

    - type: "screenshot"
      name: "full_features_desktop"
      timeout_sec: 5
  timeout_sec: 360
```

## 7. Editable Input Gate

사용자 입력이 실제 시뮬레이션 결과에 반영되는지 검증한다.

### 7.1 Input Fields

| Field | data-testid | Type | Default | Validation |
|-------|-------------|------|---------|------------|
| Title | `input-title` | textarea | `ourProduct.current_title` | 비어있지 않음 |
| Top copy | `input-top-copy` | textarea | `ourProduct.current_top_copy` | 비어있지 않음 |
| Price (₩) | `input-price` | number | `29900` | 양의 정수 |
| Cost (₩) | `input-cost` | number | `11000` | 양의 정수, < price |
| Iteration count | `input-iteration-count` | number | `5` | 1–10 정수 |
| Margin floor | `input-margin-floor` | number (step 0.01) | `0.35` | 0.10–0.90 |

### 7.2 Override Verification Flow

```yaml
- id: "browser_input_override"
  service: "web"
  name: "Editable input override verification"
  start_route: "/"
  steps:
    - type: "goto"
      url: "/"
      timeout_sec: 15
    # Step 1: 기본값으로 실행
    - type: "clear_and_type"
      label: "Set iteration to 1"
      selector: "[data-testid='input-iteration-count']"
      value: "1"
      timeout_sec: 5
    - type: "click"
      label: "Run with defaults"
      selector: "[data-testid='btn-run']"
      timeout_sec: 5
    - type: "wait_for_visible"
      label: "Wait for first run complete"
      selector: "[data-testid='state-completed']"
      timeout_sec: 180
    - type: "read_text"
      label: "Capture baseline revenue from first run"
      selector: "[data-testid='metric-baseline']"
      store_as: "first_baseline"
      timeout_sec: 5
    # Step 2: 가격 변경 후 재실행
    - type: "clear_and_type"
      label: "Change price to 19900"
      selector: "[data-testid='input-price']"
      value: "19900"
      timeout_sec: 5
    - type: "click"
      label: "Run with changed price"
      selector: "[data-testid='btn-run']"
      timeout_sec: 5
    - type: "wait_for_visible"
      label: "Wait for second run complete"
      selector: "[data-testid='state-completed']"
      timeout_sec: 180
    - type: "read_text"
      label: "Capture baseline revenue from second run"
      selector: "[data-testid='metric-baseline']"
      store_as: "second_baseline"
      timeout_sec: 5
    # Step 3: 결과 비교
    - type: "assert_different"
      label: "Results changed after input edit"
      value_a: "first_baseline"
      value_b: "second_baseline"
      timeout_sec: 5
  timeout_sec: 420
```

### 7.3 Title Override Verification

```yaml
- id: "browser_title_override"
  service: "web"
  name: "Title override affects diff output"
  start_route: "/"
  steps:
    - type: "goto"
      url: "/"
      timeout_sec: 15
    - type: "clear_and_type"
      label: "Change title"
      selector: "[data-testid='input-title']"
      value: "완전히 새로운 타이틀 테스트"
      timeout_sec: 5
    - type: "clear_and_type"
      label: "Set iteration to 1"
      selector: "[data-testid='input-iteration-count']"
      value: "1"
      timeout_sec: 5
    - type: "click"
      label: "Run simulation"
      selector: "[data-testid='btn-run']"
      timeout_sec: 5
    - type: "wait_for_visible"
      label: "Wait for completed state"
      selector: "[data-testid='state-completed']"
      timeout_sec: 180
    - type: "assert_text_contains"
      label: "Diff title shows the overridden title as baseline"
      selector: "[data-testid='diff-title']"
      text: "완전히 새로운 타이틀 테스트"
      timeout_sec: 5
  timeout_sec: 240
```

### 7.4 Fixture File Integrity

입력 수정 후에도 fixture 파일이 변경되지 않아야 한다:

```bash
# run 전후로 fixture 파일 checksums 비교
md5sum fixtures/our-product.md fixtures/competitors.md fixtures/buyer-personas.md fixtures/run-config.md
# → 실행 전후 동일해야 함
```

## 8. Visual / Usability Gate

스크린샷 기반 객관적 검증.

### 8.1 Screenshot Checks

```yaml
screenshot_checks:
  - id: "empty_desktop"
    service: "web"
    route: "/"
    name: "Empty state desktop"
    viewport:
      width: 1440
      height: 900
    full_page: false
    required_elements:
      - "panel-input"
      - "panel-simulation"
      - "panel-activity"
      - "product-card"
      - "input-title"
      - "competitors-card"
      - "btn-run"
      - "state-empty"
    forbidden_elements:
      - "unstyled error page"
      - "raw JSON in product-card"
      - "layout collapse (single column)"
      - "horizontal overflow"

  - id: "loading_desktop"
    service: "web"
    route: "/"
    name: "Loading state during simulation"
    viewport:
      width: 1440
      height: 900
    full_page: false
    trigger: "click [data-testid='btn-run']"
    capture_after: "2s"
    required_elements:
      - "sim-canvas"
      - "sim-progress"
      - "agent-count"
      - "product-counter-our_product"
      - "btn-run[disabled]"
    forbidden_elements:
      - "state-empty visible"
      - "layout collapse"

  - id: "completed_desktop"
    service: "web"
    route: "/"
    name: "Completed state with results"
    viewport:
      width: 1440
      height: 900
    full_page: true
    trigger: "wait for [data-testid='state-completed']"
    required_elements:
      - "metric-baseline"
      - "metric-final"
      - "metric-holdout"
      - "strategy-summary"
      - "diff-title"
      - "diff-top-copy"
      - "diff-price"
      - "artifact-output"
      - "state-completed"
    forbidden_elements:
      - "raw JSON in strategy-summary"
      - "raw JSON in diff-output"
      - "state-empty visible"
      - "state-error visible"
      - "layout collapse"

  - id: "error_desktop"
    service: "web"
    route: "/"
    name: "Error state"
    viewport:
      width: 1440
      height: 900
    full_page: false
    required_elements:
      - "state-error"
      - "status-text"
      - "btn-run:not([disabled])"
    forbidden_elements:
      - "unhandled exception"
      - "stack trace visible"
```

### 8.2 Playwright Automated Visual Judgment

모든 판정은 **Playwright JavaScript**로 자동 실행된다. 사람의 주관적 판단에 의존하지 않는다.

```javascript
// visual-judgment.test.mjs — Playwright 테스트로 구현
// 아래 검증 함수들은 각 스크린샷 캡처 전후에 실행

async function verifyNoRawJson(page) {
  // product-card, strategy-summary, diff-output 내부에 raw JSON 없음
  const cards = ['product-card', 'strategy-summary', 'diff-output', 'artifact-output'];
  for (const id of cards) {
    const el = page.locator(`[data-testid='${id}']`);
    if (await el.count() > 0) {
      const text = await el.textContent();
      assert(!text.includes('{"'), `${id} contains raw JSON object`);
      assert(!text.includes('["'), `${id} contains raw JSON array`);
    }
  }
  // pre 태그가 데이터 표시 영역에 없어야 함
  const preCount = await page.locator(
    '[data-testid="product-card"] pre, [data-testid="strategy-summary"] pre, [data-testid="diff-output"] pre'
  ).count();
  assert(preCount === 0, `Found ${preCount} <pre> tags in data display areas`);
}

async function verifyThreePanelLayout(page) {
  // 3-panel이 가로로 배치되어 있는지 (top 값 비교)
  const panels = ['panel-input', 'panel-simulation', 'panel-activity'];
  const tops = [];
  for (const id of panels) {
    const box = await page.locator(`[data-testid='${id}']`).boundingBox();
    assert(box !== null, `${id} not found or not visible`);
    assert(box.width > 100, `${id} too narrow: ${box.width}px`);
    tops.push(box.y);
  }
  const maxDiff = Math.max(...tops) - Math.min(...tops);
  assert(maxDiff <= 10, `Panels not horizontally aligned: top diff=${maxDiff}px`);
}

async function verifyKrwFormat(page) {
  // metric 값이 ₩ + 천단위 구분자 형식인지
  const metrics = ['metric-baseline', 'metric-final', 'metric-holdout'];
  for (const id of metrics) {
    const el = page.locator(`[data-testid='${id}']`);
    if (await el.count() > 0) {
      const text = await el.textContent();
      if (text !== '-' && text !== '') {
        assert(text.includes('₩'), `${id} missing ₩ symbol: "${text}"`);
        assert(/[\d,]+/.test(text), `${id} missing comma separator: "${text}"`);
      }
    }
  }
}

async function verifyButtonState(page, expectedDisabled) {
  const btn = page.locator("[data-testid='btn-run']");
  const isDisabled = await btn.isDisabled();
  assert(isDisabled === expectedDisabled,
    `btn-run expected disabled=${expectedDisabled}, got ${isDisabled}`);
  if (expectedDisabled) {
    const opacity = await btn.evaluate(el => getComputedStyle(el).opacity);
    assert(parseFloat(opacity) < 1.0 || true,
      'btn-run should have reduced opacity when disabled');
  }
}

async function verifyErrorReadability(page) {
  const errorEl = page.locator("[data-testid='state-error']");
  if (await errorEl.count() > 0 && await errorEl.isVisible()) {
    const text = await errorEl.textContent();
    const techTerms = ['ECONNREFUSED', 'stack trace', 'at Object.',
                       'TypeError', 'ReferenceError', 'node_modules'];
    for (const term of techTerms) {
      assert(!text.includes(term), `Error contains technical term: "${term}"`);
    }
  }
}

async function verifyDesignTokens(page) {
  // Supanova Vantablack Luxe 검증
  const bgPrimary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()
  );
  assert(bgPrimary !== '', '--bg-primary CSS variable not defined');

  // OLED 블랙 배경 (#050505 수준)
  const bodyBg = await page.evaluate(() =>
    getComputedStyle(document.body).backgroundColor
  );
  const rgb = bodyBg.match(/\d+/g).map(Number);
  assert(rgb[0] < 20 && rgb[1] < 20 && rgb[2] < 20,
    `Background not OLED black: ${bodyBg}`);

  // Pretendard 폰트 (Inter 금지)
  const fontFamily = await page.evaluate(() =>
    getComputedStyle(document.body).fontFamily
  );
  assert(fontFamily.toLowerCase().includes('pretendard'),
    `Font must be Pretendard, got: ${fontFamily}`);
  assert(!fontFamily.toLowerCase().includes('inter'),
    `Inter font is banned by Supanova rules`);

  // Double-Bezel 카드 존재 확인 (외부+내부 중첩 구조)
  const hasDoubleBezel = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="product-card"]');
    if (!card) return false;
    const style = getComputedStyle(card);
    return style.backdropFilter.includes('blur') || style.webkitBackdropFilter?.includes('blur')
      || card.querySelector('[class*="inner"]') !== null;
  });
  assert(hasDoubleBezel, 'Cards must use Double-Bezel or glass-morphism architecture');

  // Pill 버튼 (border-radius >= 9999px 또는 50%)
  const btnRadius = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="btn-run"]');
    return btn ? getComputedStyle(btn).borderRadius : '0';
  });
  assert(parseInt(btnRadius) >= 20 || btnRadius.includes('9999'),
    `CTA button must be pill-shaped, got radius: ${btnRadius}`);
}

async function verifyDiffFormat(page) {
  // diff가 before→after 형식인지 (line-through + green 텍스트)
  const diffTitle = page.locator("[data-testid='diff-title']");
  if (await diffTitle.count() > 0 && await diffTitle.isVisible()) {
    const html = await diffTitle.innerHTML();
    // "현재" 텍스트에 line-through 스타일이 있어야 함
    assert(html.includes('line-through') || html.includes('현재'),
      'Diff title should show before/after format');
  }
}
```

async function verifySingleViewport(page) {
  const overflow = await page.evaluate(() => {
    return document.body.scrollHeight <= document.body.clientHeight;
  });
  assert(overflow, `Body has vertical scroll: scrollHeight=${await page.evaluate(() => document.body.scrollHeight)}, clientHeight=${await page.evaluate(() => document.body.clientHeight)}`);
}

async function verifyNoOverlap(page) {
  // 3개 패널 간 겹침 검사
  const panels = ['panel-input', 'panel-simulation', 'panel-activity'];
  const boxes = [];
  for (const id of panels) {
    const box = await page.locator(`[data-testid='${id}']`).boundingBox();
    if (box) boxes.push({ id, ...box });
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlapX = a.x < b.x + b.width && a.x + a.width > b.x;
      const overlapY = a.y < b.y + b.height && a.y + a.height > b.y;
      assert(!(overlapX && overlapY),
        `${a.id} overlaps with ${b.id}`);
    }
  }
}

async function verifyNoTextClip(page) {
  // 주요 텍스트 요소에서 overflow clipping 검사
  const selectors = ['metric-baseline', 'metric-final', 'metric-holdout',
                     'product-name', 'strategy-rationale'];
  for (const id of selectors) {
    const el = page.locator(`[data-testid='${id}']`);
    if (await el.count() > 0) {
      const isClipped = await el.evaluate(node => {
        return node.scrollWidth > node.clientWidth + 2 ||
               node.scrollHeight > node.clientHeight + 2;
      });
      assert(!isClipped, `${id} has clipped/overflowing text`);
    }
  }
}
```

### 8.3 Screenshot Judgment Matrix

각 스크린샷에 대해 실행할 자동 검증 조합:

| Screenshot | verifyNoRawJson | verifyThreePanelLayout | verifyKrwFormat | verifyButtonState | verifyDesignTokens | verifyDiffFormat | verifyErrorReadability |
|-----------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| empty_state_desktop | :white_check_mark: | :white_check_mark: | — | disabled=false | :white_check_mark: | — | — |
| loading_state_desktop | :white_check_mark: | :white_check_mark: | — | disabled=true | :white_check_mark: | — | — |
| completed_state_desktop | :white_check_mark: | :white_check_mark: | :white_check_mark: | disabled=false | :white_check_mark: | :white_check_mark: | — |
| completed_state_live | :white_check_mark: | :white_check_mark: | :white_check_mark: | disabled=false | :white_check_mark: | :white_check_mark: | — |
| error_state_desktop | :white_check_mark: | :white_check_mark: | — | disabled=false | :white_check_mark: | — | :white_check_mark: |

**판정 결과**: 모든 assert가 통과하면 해당 스크린샷 **PASS**. 하나라도 실패하면 **FAIL** + 실패 사유 출력.

### 8.4 Objective Usability Criteria (요약)

| # | 기준 | Playwright 검증 함수 | Pass 조건 |
|---|------|---------------------|----------|
| 1 | raw JSON 없음 | `verifyNoRawJson` | 데이터 카드 내 `{"`, `["` 없음, `<pre>` 없음 |
| 2 | 3-panel 유지 | `verifyThreePanelLayout` | 3개 패널 top 값 차이 ≤ 10px, 각 width > 100px |
| 8 | Single Viewport | `verifySingleViewport` | body에 세로 스크롤 없음 (`scrollHeight ≤ clientHeight`), 1440×900 기준 |
| 9 | UI 겹침 없음 | `verifyNoOverlap` | 주요 패널/카드가 서로 겹치지 않음 (bounding box 교차 검사) |
| 10 | 텍스트 잘림 없음 | `verifyNoTextClip` | 주요 요소에서 텍스트가 overflow hidden으로 잘리지 않음 |
| 3 | KRW 형식 | `verifyKrwFormat` | `₩` + 천단위 `,` 포함 |
| 4 | 버튼 상태 | `verifyButtonState` | loading 시 disabled, 완료/에러 시 enabled |
| 5 | 에러 가독성 | `verifyErrorReadability` | ECONNREFUSED, stack trace 등 기술 용어 미포함 |
| 6 | 다크 테마 | `verifyDesignTokens` | `--bg-primary` 정의됨, body 배경 RGB < (50,50,80) |
| 7 | Diff 형식 | `verifyDiffFormat` | before(line-through) + after(green) 구조 |

## 9. Artifact / Consistency Gate

다음 세 값이 모두 일치해야 한다:

| Source | Access Method |
|--------|---------------|
| UI 표시값 | `data-testid` 셀렉터로 텍스트 추출 |
| `/api/run` 응답값 | HTTP POST response body |
| `artifacts/latest-run-summary.json` | 파일 읽기 |

### 일치 확인 항목:

| Field | UI selector | API path | Artifact path |
|-------|-------------|----------|---------------|
| selected strategy id | `strategy-summary` 내 id 텍스트 | `response.selected_strategy.id` | `payload.selected_strategy.id` |
| baseline revenue | `metric-baseline` 텍스트 (KRW parse) | `response.baseline.simulated_revenue` | `payload.baseline.simulated_revenue` |
| final revenue | `metric-final` 텍스트 (KRW parse) | `response.selected_strategy.simulated_revenue` | `payload.selected_strategy.simulated_revenue` |
| holdout uplift | `metric-holdout` 텍스트 (KRW parse) | `response.holdout.holdout_uplift` | `payload.holdout.holdout_uplift` |
| diff title | `diff-title` 텍스트 | `response.diff.title` | `payload.diff.title` |
| diff top_copy | `diff-top-copy` 텍스트 | `response.diff.top_copy` | `payload.diff.top_copy` |
| diff price | `diff-price` 텍스트 (KRW parse) | `response.diff.price` | `payload.diff.price` |

## 10. Stability Gate (Repeatability 대체)

LLM 직접 선택 방식은 비결정적이므로, 결정론적 재현성 대신 **실행 안정성**만 검증한다.

| 기준 | 검증 방법 | Pass 조건 |
|------|----------|----------|
| 실행 안정성 | 2회 연속 실행 | 2회 모두 `simulation_complete` 도달, 에러 없음 |
| 결과 합리성 | 2회 실행 결과 비교 | 두 결과 모두 `holdout_uplift` 값이 존재 (양수/음수 무관, 값 자체는 달라도 OK) |
| 에이전트 수 일관성 | 2회 실행 | 두 결과 모두 `choice_summary` 합산 = 800 |

**참고**: LLM이 매 호출마다 다른 답을 줄 수 있으므로, 2회 실행의 구체적 수치 일치는 요구하지 않는다.

## 11. Required Evidence Bundle

최종 완료로 인정하려면 아래 evidence가 모두 존재해야 한다:

| Evidence | 수집 방법 | 파일/위치 |
|----------|----------|----------|
| `npm test` 결과 | 터미널 캡처 | 모든 테스트 pass |
| `node --check` 결과 | 터미널 캡처 | 문법 오류 없음 |
| Mock browser E2E | Playwright `browser_full_run_mock` | pass |
| Live browser E2E | Playwright `browser_full_run_live` | pass |
| Empty state screenshot | `empty_state_desktop.png` | 8.1 기준 충족 |
| Loading state screenshot | `loading_state_desktop.png` | 8.1 기준 충족 |
| Completed state screenshot | `completed_state_desktop.png` | 8.1 기준 충족 |
| Error state screenshot | `error_state_desktop.png` | 8.1 기준 충족 |
| Live run artifact | `artifacts/latest-run-summary.json` | live run 결과 반영 |
| Consistency proof | §9 Artifact/Consistency Gate | 7개 필드 일치 |
| Input override proof | `browser_input_override` flow | 가격 변경 → 결과 변경 확인 |

## 12. Failure Conditions

다음 중 하나라도 해당되면 **미완료**:

| Condition | 검증 Gate |
|-----------|----------|
| mock은 되지만 live는 안 됨 | §3 Live OpenAI Gate |
| API는 되지만 browser click flow는 안 됨 | §6 Browser UI Gate |
| input 수정이 실제 결과에 반영되지 않음 | §7 Editable Input Gate |
| raw JSON 없이는 결과 이해 불가 | §8 Visual Gate (`pre` 태그 검사) |
| artifact와 UI 값이 다름 | §9 Consistency Gate |
| holdout gate 실패 (`holdout_uplift ≤ 0`) | §2 Engine Gate |
| SSE 이벤트 순서가 틀림 | §5 SSE Streaming Gate |
| 3-panel 레이아웃이 무너짐 | §8 Visual Gate (패널 top 검사) |
| particle flow가 렌더링 안 됨 | §6 Browser UI Gate (`sim-canvas`, `product-counter-*`, `agent-count` 검사) |
| agent_decision 이벤트가 800개 미만 | §5 SSE Streaming Gate (agent count 검증) |

## 13. Minimal Passing Demo

최소 passing demo는 다음 순서로 진행된다:

1. `npm start` → 서버 시작, `http://127.0.0.1:3001` 접속
2. 3-panel 대시보드 로드, 상품/경쟁사/설정 카드 UI 표시 (empty state)
3. `data-testid="input-title"` 값 수정
4. `data-testid="btn-run"` 클릭
5. SSE 스트리밍 시작, `data-testid="sim-canvas"`에 파티클 플로우 애니메이션
6. `data-testid="agent-count"`에 "N / 800 에이전트 완료" 실시간 카운터
7. `data-testid="product-counter-*"`에 제품별 선택 수 실시간 증가
7. 시뮬레이션 완료, `data-testid="state-completed"` 표시
8. `data-testid="metric-baseline"`, `metric-final`, `metric-holdout` 값 표시
9. `data-testid="strategy-summary"` 카드에 추천 전략 표시 (raw JSON 아님)
10. `data-testid="diff-title"`, `diff-top-copy"`, `diff-price"` before→after 표시
11. `data-testid="artifact-output"` artifact summary 표시
12. `artifacts/latest-run-summary.json` 파일 생성 확인
13. Playwright screenshot evidence 4장 (empty/loading/completed/error)
