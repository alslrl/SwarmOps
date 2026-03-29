# PRD — SwarmOps Ralphthon 0→1

## 1. Goal

Ralphthon 당일 `12:10 ~ 17:00` 동안, `SwarmOps`을 **실제로 시연 가능한 operator product**로 완성한다.

이 문서의 전제는 다음과 같다.

- 행사 전에 하네스, fixture, 모델 연결, 기본 서버 구조는 준비될 수 있다.
- 하지만 심사받는 결과물은 **행사 중 Ralph loop를 통해 만들어진 0→1 product outcome**이어야 한다.
- 따라서 이 PRD는 “사전 준비물”이 아니라 “행사 당일 5시간 동안 무엇을 완성해야 하는가”를 정의한다.

## 2. Product Definition

SwarmOps은 셀러가 상품 전략을 바꾸기 전에, buyer-agent swarm 시뮬레이션으로 더 나은 상품 페이지 조합을 찾도록 돕는 `diff-only seller optimization dashboard`다.

행사 당일 최종 데모에서는 사용자가:

1. 상품 fixture를 읽고 현재 상품 상태를 이해한다
2. 대시보드에서 seller-side 입력값을 수정한다
3. `Run simulation`을 클릭한다
4. live OpenAI-backed 시뮬레이션이 수행된다
5. 결과로 baseline/final/holdout/diff를 확인한다
6. artifact와 screenshot evidence를 함께 제시한다

## 3. Day-Of Deliverable

행사 종료 시점에 반드시 보여줘야 하는 결과물은 아래 5개다.

### A. Operator dashboard
- 브라우저에서 열리는 대시보드
- fixture summary를 사람이 이해할 수 있는 카드 UI로 표시
- raw JSON 없이도 제품/경쟁/실험 설정을 이해할 수 있어야 함

### B. Editable simulation input
- 사용자 수정 가능 입력:
  - current title
  - current top copy
  - current price
  - current cost
  - iteration count
  - minimum margin floor
- 이 값은 **run-time override**로만 적용되고 fixture 파일은 변경하지 않음

### C. Live simulation result
- live OpenAI-backed simulation run 성공
- 결과 화면에 반드시 표시:
  - baseline revenue
  - final revenue
  - holdout uplift
  - selected strategy summary
  - diff (`title`, `top copy`, `price`)

### D. Artifact output
- `artifacts/latest-run-summary.json`
- live run 기준 결과 반영
- UI에 artifact summary가 함께 표시되어야 함

### E. Demo evidence
- completed-state screenshot
- mock/live browser verification evidence
- 최종 recommendation 설명 1개

## 4. In Scope

- one product
- three competitors
- one dashboard
- one buyer swarm simulator
- diff-only recommendation flow
- live OpenAI integration
- Playwright 기반 mock/live browser verification
- visual/usability verification

## 5. Out of Scope

- Shopify mutation
- live competitor scraping
- image editing / generation
- multi-product support
- multi-channel optimization
- long-term persistence productization
- analytics platform 수준의 히스토리 관리

## 6. Core User Flow

1. User opens dashboard at `http://127.0.0.1:3001/`
2. Dashboard fetches `GET /api/fixtures` and populates Input Panel with product/competitor/settings data
3. User sees product info, competitors, and default settings in editable fields (empty state)
4. User modifies seller-controlled fields: title, top copy, price, cost
5. User adjusts iteration count and minimum margin floor
6. User clicks `Run simulation` (`data-testid="btn-run"`)
7. Button becomes disabled, status text shows "Connecting…"
8. Client opens SSE connection to `POST /api/run/stream`
9. Simulation Panel activates force-directed graph with 8 archetype nodes + 5 product nodes
10. Each `agent_decision` SSE event animates edges from archetype to chosen product
11. Each `iteration_complete` SSE event updates progress bar and highlights iteration winner
12. On `simulation_complete` SSE event, Results Panel populates with metrics/strategy/diff/artifact
13. User sees full recommendation with holdout validation and artifact summary

## 7. Product Constraints

- The simulator remains **diff-only**
- Only these output fields may change:
  - title
  - top copy
  - price
- Buyer action model remains:
  - `our_product`
  - `competitor_a`
  - `competitor_b`
  - `competitor_c`
  - `pass`
- Swarm:
  - 8 archetypes → 800 individual buyer agents (아키타입 비율에 따라 분배)
  - 각 에이전트는 고유 persona (이름, 성격 변형)를 가지며 개별 LLM 호출로 제품 선택
  - 200 holdout buyers (동일 구조, 별도 seed)
  - 에이전트 선택은 deterministic sampler가 아닌 개별 LLM 판단
- Live mode must use:
  - `gpt-5.4` for strategy/judge
  - `gpt-5-nano` for buyer evaluation

## 8. Success Criteria

SwarmOps is considered **Ralphthon-successful** only if all of the following are true by the end of the event:

1. `data-testid="panel-input"`, `data-testid="panel-simulation"`, `data-testid="panel-results"` are all visible — no raw JSON displayed.
2. User edits `data-testid="input-title"` and reruns → `data-testid="diff-title"` shows the change.
3. A browser-driven live run from `data-testid="btn-run"` click to `data-testid="state-completed"` visible succeeds end-to-end.
4. After completion, the following are non-empty and visible:
   - `data-testid="metric-baseline"` (baseline revenue, formatted KRW)
   - `data-testid="metric-final"` (final revenue, formatted KRW)
   - `data-testid="metric-holdout"` (holdout uplift, formatted KRW)
   - `data-testid="strategy-summary"` (selected strategy as readable card)
   - `data-testid="diff-title"`, `data-testid="diff-top-copy"`, `data-testid="diff-price"` (before→after)
5. The selected strategy satisfies:
   - `holdout_uplift > 0`
   - `margin_floor_violations = 0`
6. `artifacts/latest-run-summary.json` exists, and its `selected_strategy.id` matches `data-testid="strategy-summary"` content.
7. All 4 UI states render correctly:
   - Empty: `data-testid="state-empty"` visible on load
   - Loading: `data-testid="btn-run"` disabled + `data-testid="sim-progress"` visible during run
   - Completed: `data-testid="state-completed"` visible + all metrics populated
   - Error: `data-testid="state-error"` visible with readable message on failure
8. The simulation visualization (`data-testid="sim-canvas"`) shows animated force-directed graph during SSE streaming.

## 9. Failure Conditions

SwarmOps is considered **incomplete** if any of the following are true:

- mock mode works but live mode does not
- user can edit values in UI but the run still uses fixture defaults
- the result is only understandable through raw JSON
- the browser path fails even if the API works
- the artifact does not match the UI-visible result
- the final strategy violates margin or fails holdout
- the completed screen is visually unusable for demo

## 10. Completion Contract for Ralph

Ralph may only stop when all of the following are proven:

1. Fresh test evidence passes
2. Browser-driven mock verification passes
3. Browser-driven live verification passes
4. The dashboard supports editable seller inputs
5. The live run produces a valid recommendation/diff/artifact bundle
6. Visual/usability review says the UI is demo-usable
7. Architect/verifier review agrees the result is coherent and complete

## 11. Deliverable Summary for Judges

The simplest judge-facing statement should be:

> “We built a live seller optimization operator. You can edit a product listing, run a 1,000-buyer simulation, and immediately get a defendable recommendation with holdout validation, readable UI diff, and live-generated artifact output.”

## 12. UI/UX Specification

### 12.1 Layout

3-panel grid layout. **Single Viewport Dashboard** — 스크롤 없이 1440×900 화면에 전부 표시.

```
┌──────────────────┬────────────────────────┬──────────────────┐
│  Input Panel     │  Simulation Panel      │  Activity Panel  │
│  (340px fixed)   │  (flex, 중앙)           │  (380px fixed)   │
│                  │  파티클 플로우 (크게)     │  👑🦞 전략가재    │
│  data-testid=    │  data-testid=          │  + 채팅 로그      │
│  “panel-input”   │  “panel-simulation”    │  data-testid=    │
│                  │                        │  “panel-activity” │
└──────────────────┴────────────────────────┴──────────────────┘
                              ↓ simulation_complete 시
                     ┌─ Results Popup (모달) ─┐
                     │  data-testid=          │
                     │  “results-popup”       │
                     └────────────────────────┘
```

### 12.1.1 Single Viewport Constraint

대시보드는 **스크롤 없이 한 화면(1440×900)에 모든 콘텐츠가 표시**되어야 한다. Supabase Dashboard처럼 고정 레이아웃.

**필수 규칙:**
```css
html, body {
  height: 100vh;
  overflow: hidden;        /* 페이지 스크롤 금지 */
}
.layout {
  height: 100vh;
  display: grid;
  grid-template-columns: 340px 1fr 380px;
  gap: var(--layout-gap);
  padding: var(--space-lg);
}
```

**각 패널 내부 스크롤:**
- `panel-input`: `overflow-y: auto` (상품 정보가 길 때 패널 내부에서만 스크롤)
- `panel-simulation`: 고정 — `agent-log`만 `overflow-y: auto; max-height: 200px`
- `panel-results`: `overflow-y: auto` (결과가 길 때 패널 내부에서만 스크롤)

**콘텐츠 압축 전략:**
| 컴포넌트 | 높이 제한 방법 |
|----------|---------------|
| Product Card | textarea 2줄, 가격/원가 한 줄 inline |
| Competitors | 3개 한 줄씩, compact |
| Settings | inline flex (iteration + margin 같은 줄) |
| 👑🦞 Strategy Lobster | 후보 3개 가로 배치 (flex-row), 접히기 가능 |
| 파티클 캔버스 | `flex: 1` (남은 공간 채움) |
| Agent Log | `max-height: 200px; overflow-y: auto` |
| Metrics Row | 3열 한 줄 |
| Strategy/Diff/Insights | compact 카드, 필요 시 패널 내부 스크롤 |
| Artifact | 1줄 요약 |

**금지 사항:**
- `body` 레벨 세로 스크롤 금지 (`overflow: hidden`)
- 카드 간 과도한 margin/padding 금지 (compact 유지)
- 전체 높이가 100vh를 초과하는 레이아웃 금지

**기준 뷰포트:** 1440 × 900 (MacBook Pro 기본)

### 12.2 Design Tokens — Supanova Premium Aesthetic

에이전트는 아래 Supanova 프리미엄 design token을 `styles.css`에 적용해야 한다.
**디자인 바이브: Vantablack Luxe** — OLED 블랙, 글래스 카드, 시네마틱 깊이감.

```css
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable.css');

:root {
  /* ── Colors — Vantablack Luxe ── */
  --bg-primary: #050505;              /* OLED 블랙 */
  --bg-secondary: #0a0a0a;
  --bg-card-outer: rgba(255, 255, 255, 0.03);  /* Double-bezel 외부 */
  --bg-card-inner: rgba(255, 255, 255, 0.06);  /* Double-bezel 내부 */
  --bg-input: rgba(255, 255, 255, 0.08);
  --border-card: rgba(255, 255, 255, 0.08);    /* 헤어라인 보더 */
  --border-input: rgba(255, 255, 255, 0.12);

  --text-primary: #f0f0f0;
  --text-secondary: #8a8a8a;
  --text-muted: #555555;

  --accent-blue: #3b82f6;
  --accent-blue-hover: #60a5fa;
  --accent-green: #34d399;
  --accent-red: #f87171;
  --accent-orange: #fb923c;
  --accent-yellow: #fbbf24;

  /* Product node colors */
  --node-our: #3b82f6;
  --node-comp-a: #f87171;
  --node-comp-b: #fb923c;
  --node-comp-c: #fbbf24;
  --node-pass: #6b7280;

  /* ── Typography — Pretendard (Inter 금지) ── */
  --font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.25rem;
  --font-size-xl: 1.5rem;
  --font-size-2xl: 2rem;

  /* ── Spacing — 넉넉한 여백 ── */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 20px;
  --space-2xl: 24px;
  --space-3xl: 32px;

  /* ── Card — Double-Bezel Architecture ── */
  --card-radius-outer: 1.5rem;         /* 24px */
  --card-radius-inner: calc(1.5rem - 6px);
  --card-padding-outer: 6px;           /* 외부 쉘 패딩 */
  --card-padding-inner: 20px;          /* 내부 코어 패딩 */
  --card-shadow: 0 20px 60px -15px rgba(0, 0, 0, 0.5);
  --card-highlight: inset 0 1px 1px rgba(255, 255, 255, 0.08);  /* 내부 하이라이트 */
  --card-gap: 16px;

  /* ── Input ── */
  --input-radius: 12px;
  --input-padding: 12px 14px;

  /* ── Button — Pill + Glow ── */
  --btn-radius: 9999px;               /* 완전 둥근 pill */
  --btn-padding: 14px 28px;
  --btn-glow: 0 0 30px rgba(59, 130, 246, 0.25);  /* hover 시 글로우 */

  /* ── Motion — Supanova Signature ── */
  --transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);  /* 스프링 물리 */
  --transition-fast: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);

  /* ── Layout ── */
  --panel-left-width: 340px;
  --panel-right-width: 380px;
  --layout-max-width: 1440px;
  --layout-gap: 20px;
}
```

**Supanova 디자인 규칙 (MUST):**
1. **Double-Bezel 카드**: 외부 쉘(bg-card-outer, ring-1 ring-white/8, padding 6px) + 내부 코어(bg-card-inner, card-highlight). 평평한 단일 배경 카드 금지.
2. **글래스 효과**: 주요 카드에 `backdrop-filter: blur(20px)` 적용.
3. **CTA 버튼**: 완전 둥근 pill(border-radius: 9999px), hover 시 `scale(1.02)` + glow 효과.
4. **모션**: 모든 transition에 `cubic-bezier(0.16, 1, 0.3, 1)` 사용. `linear`이나 `ease-in-out` 금지.
5. **폰트**: Pretendard Variable 사용. Inter, Noto Sans KR, Roboto 금지.
6. **한글 타이포**: 모든 한글 블록에 `word-break: keep-all`, 헤드라인에 `line-height: 1.4`.
7. **Scroll 진입 애니메이션**: 요소가 정적으로 나타나면 안 됨. `IntersectionObserver`로 fade-in + translateY(2rem) 진입.
8. **배경**: subtle radial mesh gradient orb 효과 (움직이는 배경 그라데이션).
9. **GPU-safe 애니메이션만**: `transform`과 `opacity`만 애니메이션. `top/left/width/height` 금지.
10. **Eyebrow 태그**: 섹션 제목 위에 작은 pill 배지 (`text-[11px] uppercase tracking-[0.15em] bg-accent/10`).

### 12.3 Card Internal Layouts

**Product Card 내부 구조:**
```
┌─ Product Card ─────────────────┐
│ [brand_name] 읽기전용, xs, muted│
│ [product_name] 읽기전용, base   │
│ ─────────────────────────────  │
│ 제목 (라벨, xs, secondary)      │
│ ┌─ textarea ────────────────┐  │
│ │ current_title              │  │
│ └────────────────────────────┘  │
│ 카피 (라벨)                     │
│ ┌─ textarea ────────────────┐  │
│ │ current_top_copy           │  │
│ └────────────────────────────┘  │
│ ┌─ 가격 (₩) ─┐┌─ 원가 (₩) ─┐  │
│ │  29,900     ││  11,000     │  │
│ └─────────────┘└─────────────┘  │
│ 마진율: 63.2% (자동 계산, 읽기전용)│
└─────────────────────────────────┘
```
- textarea: 3줄 높이, resize: vertical
- 가격/원가: 가로 2열 grid, gap: `--space-md`
- 마진율: `(price - cost) / price * 100`, `--text-secondary`, 자동 업데이트

**Competitor Card 내부 구조:**
```
┌─ Competitors ──────────────────┐
│ 경쟁사 (섹션 제목, base)         │
│ ┌─ competitor-a ────────────┐  │
│ │ 상품명        ₩25,900      │  │
│ └────────────────────────────┘  │
│ ┌─ competitor-b ────────────┐  │
│ │ 상품명        ₩27,000      │  │
│ └────────────────────────────┘  │
│ ┌─ competitor-c ────────────┐  │
│ │ 상품명        ₩31,500      │  │
│ └────────────────────────────┘  │
└─────────────────────────────────┘
```
- 각 경쟁사: 한 줄 flex row, 상품명 왼쪽 + 가격 오른쪽 정렬
- 배경: `--bg-input`, 둥근 모서리: `--input-radius`
- 가격은 `Intl.NumberFormat('ko-KR')` 포맷

**Metrics Row 내부 구조:**
```
┌─ Metrics Row ──────────────────────────────────────┐
│ ┌─ baseline ───┐ ┌─ final ──────┐ ┌─ holdout ───┐ │
│ │ Baseline     │ │ Final        │ │ Holdout     │ │
│ │ revenue      │ │ revenue      │ │ uplift      │ │
│ │ (xs,muted)   │ │ (xs,muted)   │ │ (xs,muted)  │ │
│ │              │ │              │ │             │ │
│ │ ₩24,500,000  │ │ ₩28,200,000  │ │ +₩3,700,000 │ │
│ │ (lg, white)  │ │ (lg, white)  │ │ (lg, green) │ │
│ └──────────────┘ └──────────────┘ └─────────────┘ │
└────────────────────────────────────────────────────┘
```
- 3열 균등 grid
- holdout uplift: 양수 → `--accent-green` + “+” prefix, 음수 → `--accent-red`

**Strategy Summary Card 내부 구조:**
```
┌─ 추천 전략 (strategy-summary) ──────────────────┐
│ 추천 전략 (섹션 제목, base)                        │
│                                                  │
│ 제목  새로운 타이틀 텍스트                          │
│       (sm, primary)                              │
│ 카피  새로운 카피 텍스트                            │
│       (sm, primary)                              │
│ 가격  ₩28,500  (sm, primary)                      │
│ 마진  57.9%    (sm, secondary)                    │
│ 근거  “가격 민감형 고객 확보를 위해...”              │
│       (xs, muted, 최대 2줄)                       │
└──────────────────────────────────────────────────┘
```
- 라벨: 왼쪽 정렬, 고정 폭 60px, `--text-muted`
- 값: 라벨 오른쪽, `--text-primary`
- raw JSON 절대 사용 금지

**Diff Card 내부 구조:**
```
┌─ 변경 사항 (diff-output) ─────────────────────────┐
│ 변경 사항 (섹션 제목, base)                         │
│                                                   │
│ ┌─ diff-title ─────────────────────────────────┐  │
│ │ 제목                                          │  │
│ │ 현재  트리클리닉 엑스퍼트 스칼프 탈모 샴푸 500ml │  │
│ │       (xs, text-secondary, line-through)      │  │
│ │ 추천  새로운 최적화된 타이틀                      │  │
│ │       (sm, accent-green)                      │  │
│ └───────────────────────────────────────────────┘  │
│ ┌─ diff-top-copy ──────────────────────────────┐  │
│ │ 카피  (동일 구조)                               │  │
│ └───────────────────────────────────────────────┘  │
│ ┌─ diff-price ─────────────────────────────────┐  │
│ │ 가격                                          │  │
│ │ 현재  ₩29,900                                  │  │
│ │ 추천  ₩28,500 (-4.7%)                          │  │
│ │       (변동률: 하락=green, 상승=red)             │  │
│ └───────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```
- “현재” 줄: `text-decoration: line-through`, `--text-secondary`
- “추천” 줄: `--accent-green` (개선), 가격 옆 변동률 %
- 각 diff 항목은 구분선 또는 카드 배경으로 시각적 분리

### 12.4 Simulation Panel — Particle Flow Visualization

중앙 패널은 800개 개별 에이전트의 제품 선택을 **파티클 플로우 + 실시간 카운터**로 시각화한다.

**레이아웃:**
```
┌─ 시뮬레이션 (panel-simulation) ────────────────────────────┐
│  ┌─ 상단: 상태 + 진행 ─────────────────────────────────┐  │
│  │ [Running... / Complete]  Iteration 3/5  ████░░ 60%   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─ 파티클 캔버스 (sim-canvas) ────────────────────────┐  │
│  │                                                      │  │
│  │   ·· ·                    ┌─ 우리제품 ──┐            │  │
│  │  · ·· ·  ───→            │  287명      │ ████████   │  │
│  │   · ·     ──→            ├─ 경쟁사A ──┤            │  │
│  │  · · ·                    │  198명      │ █████      │  │
│  │   800개     ───→          ├─ 경쟁사B ──┤            │  │
│  │   에이전트   ──→           │  142명      │ ████       │  │
│  │  ·· · ·                   ├─ 경쟁사C ──┤            │  │
│  │   · ··    ──→            │   93명      │ ███        │  │
│  │                           ├─ 패스 ─────┤            │  │
│  │                           │   80명      │ ██         │  │
│  │                           └────────────┘            │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌─ 하단: 아키타입별 요약 (iteration 완료 후) ───────────┐  │
│  │ 가격민감형: 우리 22% | A 35% | B 18% | C 12% | 패스 13%│  │
│  │ 가성비형:   우리 38% | A 22% | B 20% | C  8% | 패스 12%│  │
│  │ ...                                                  │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**파티클 동작:**
- 왼쪽에서 에이전트 파티클이 🦞 이모지(font-size 14px)로 생성
- 파티클 색상: 아키타입별 색상 배경 (8가지), 🦞 이모지는 공통
- 각 `agent_decision` SSE 이벤트마다 1개 파티클이 선택한 제품 방향으로 이동 (0.2s 애니메이션)
- 오른쪽 제품 버킷에 도착하면 카운터 +1, 바 길이 증가
- 동시에 여러 파티클이 날아가는 효과 (concurrent LLM 호출 반영)

**제품 카운터:**
| Element | data-testid | 내용 |
|---------|-------------|------|
| 우리제품 카운터 | `product-counter-our_product` | 이름 + 선택 수 + 비율 바 |
| 경쟁A 카운터 | `product-counter-competitor_a` | 동일 |
| 경쟁B 카운터 | `product-counter-competitor_b` | 동일 |
| 경쟁C 카운터 | `product-counter-competitor_c` | 동일 |
| 패스 카운터 | `product-counter-pass` | 동일 |

**카운터 색상**: 제품별 고정 색상 (§12.2 design tokens의 node 색상과 동일)

**아키타입별 요약 테이블** (`data-testid=”archetype-summary-table”`):
- Iteration 완료 후 표시
- 각 행: 아키타입 이름 + 5개 제품별 선택 비율 (%)
- 우리 제품 비율이 가장 높으면 초록, 가장 낮으면 빨강 하이라이트

### 12.4.1 Archetype Mixer (`data-testid=”archetype-mixer”`)

Simulation Panel 하단. 파티클 캔버스 아래에 위치. 아키타입 비율과 성별을 조절.

```
┌─ 🎛️ 그룹 설정 (archetype-mixer) ─────────────────────────────────┐
│ 가격민감 [144]  가성비 [128]  프리미엄 [ 96]  신뢰우선 [120]       │
│ 감성    [ 64]  탈모인🦞[ 88]  할인반응 [ 80]  가족    [ 80]       │
│ ────────────────────────────────────────────────────────────── │
│ 성별:  남 [480] ───○─── 여 [320]          합계: 800명 ✓          │
└───────────────────────────────────────────────────────────────────┘
```

**구조:**
- 컨테이너: `data-testid=”archetype-mixer”`, Simulation Panel 하단 고정
- 레이아웃: 4열 × 2행 compact grid (아키타입 8개) + 성별 1행
- 각 입력: `data-testid=”count-{archetype_id}”` (`<input type=”number”>`, min=0, max=800)
- 합계: `data-testid=”agent-total”` — 8개 합산 실시간 표시
- 성별: `data-testid=”gender-male-count”`, `data-testid=”gender-female-count”` (number input)
- 기본값: fixture의 `cohort_weight_percent`에서 800명 기준 계산

**합산 검증 로직:**
```javascript
// 입력값 변경 시 합산 검증
function validateTotal(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const isValid = total === 800;
  // agent-total 표시: “800명 ✓” (초록) 또는 “652명 ✗ (148명 부족)” (빨강)
  return { total, isValid, diff: 800 - total };
}
```
- 합이 **정확히 800**이어야 Run 버튼 활성화
- 800이 아니면 `btn-run` disabled + 부족/초과 수 표시 (빨간색)
- 정수 입력만 허용 (소수점 없음)

**성별 검증:**
- `gender-male-count` + `gender-female-count` = 800
- 성별 합도 800이어야 함 (아키타입 합과 동일)
- 성별은 에이전트 이름/persona 생성에만 영향 (아키타입 분배와 독립)

**에이전트 총 카운터** (`data-testid=”agent-count”`):
- “247 / 800 에이전트 완료” 형태로 실시간 업데이트

**Implementation:**
- Canvas 2D로 파티클 렌더링 (성능: 800개 파티클 동시 처리)
- 카운터/바/테이블은 DOM 요소 (data-testid 검증 가능)
- 파티클 생성 속도: SSE 이벤트 속도에 맞춤 (concurrent 호출로 초당 10-30개)

### 12.5 Agent Chat Log (`data-testid=”agent-log”`)

시뮬레이션 패널 하단. 800개 에이전트의 선택을 실시간 채팅처럼 스크롤 표시.

```
┌─ 에이전트 라이브 로그 (agent-log) ──────────────────────┐
│ 🟢 김지수 (가격민감형)                                    │
│   → 경쟁사A 선택                                        │
│   “가격이 더 저렴해서”                                    │
│                                                        │
│ 🟡 이민호 (프리미엄형)                                    │
│   → 우리제품 선택                                        │
│   “전문가 설계라는 점이 마음에”                              │
│                                                        │
│ 🟠 박수진 (할인반응형)                                    │
│   → 패스                                               │
│   “마땅한 할인이 없어서 보류”                               │
│                                                        │
│ ░░░░░░░░░░░░░░░░░░░░░░ 자동 스크롤 ░░░░░░░░░░░░░░░░░░░░ │
└────────────────────────────────────────────────────────┘
```

**구조:**
- 컨테이너: `data-testid=”agent-log”`, max-height 300px, overflow-y: auto, auto-scroll
- 개별 메시지: `data-testid=”agent-log-entry”` (800개)
- 각 메시지 내용:
  - 색상 원: 아키타입별 색상
  - 이름 + 아키타입 라벨 (1줄, `--font-size-sm`, `--text-primary`)
  - → 선택한 제품 (선택 제품 색상)
  - 이유 1줄 (`--font-size-xs`, `--text-muted`, 인용 형식)
- 각 `agent_decision` SSE 이벤트마다 1개 엔트리 추가 + 자동 스크롤
- 클릭 시 에이전트 프로필 팝업 표시

### 12.6 Revenue Progress Chart (`data-testid=”revenue-chart”`)

Results Panel 내 Metrics Row 아래. Iteration별 매출 변화를 바 차트로 시각화.

```
┌─ Iteration Revenue Chart (revenue-chart) ──────────┐
│                                                     │
│ ₩6.2M │              █  █                           │
│ ₩5.8M │        █     │  │                           │
│ ₩5.4M │  █     │     │  │                           │
│ ₩5.0M │  │  █  │     │  │                           │
│ ₩4.6M │  │  │  │     │  │                           │
│ Base  │──│──│──│──│──│──│── (baseline 점선)          │
│        I1  I2  I3  I4  I5                           │
│                                                     │
│  --- baseline    █ winner revenue/iter              │
└─────────────────────────────────────────────────────┘
```

**구조:**
- Canvas 또는 SVG, `data-testid=”revenue-chart”`
- X축: iteration 번호 (1~N)
- Y축: revenue (KRW, 자동 스케일)
- 바: 각 iteration의 winner revenue, 색상 `--accent-blue`
- baseline 점선: `--accent-red`, 가로 수평선
- 바가 baseline 위면 초록 테두리, 아래면 빨강 테두리
- 각 `iteration_complete` SSE 이벤트마다 바 1개 추가 (애니메이션)
- data-testid: 개별 바 `revenue-bar-{n}`, baseline 선 `revenue-baseline`

### 12.7 Auto-Generated Insights (`data-testid=”insights-panel”`)

Results Panel 내 Diff 아래. 시뮬레이션 결과에서 자동으로 핵심 인사이트를 추출하여 표시.

```
┌─ 핵심 인사이트 (insights-panel) ─────────────────────┐
│                                                      │
│ ⚠️ 가격민감형 45%가 경쟁사A로 이탈                       │
│    → 가격 인하 전략 검토 필요                            │
│                                                      │
│ ✅ 신뢰우선형 72%가 우리제품 선택                        │
│    → 전문성 메시지가 효과적                              │
│                                                      │
│ 🟡 할인반응형 60%가 패스                                │
│    → 프로모션 전략 부재                                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**구조:**
- 컨테이너: `data-testid=”insights-panel”`
- 개별 인사이트: `data-testid=”insight-item”` (최소 3개, 최대 8개)
- 각 인사이트 내용:
  - 아이콘: ⚠️ (이탈 높음, 우리<경쟁), ✅ (우리 우세), 🟡 (패스 높음)
  - 아키타입 이름 + 비율 + 행동 (1줄, `--font-size-sm`)
  - → 추천 액션 (1줄, `--font-size-xs`, `--text-muted`)
- 생성 로직 (`iteration_complete`의 `archetype_breakdown` 기반):
  - 우리제품 선택률 < 25%인 아키타입 → ⚠️ 이탈 인사이트
  - 우리제품 선택률 > 50%인 아키타입 → ✅ 우세 인사이트
  - 패스 선택률 > 40%인 아키타입 → 🟡 패스 인사이트
- `simulation_complete` 시 표시

### 12.8 Agent Profile Popup (`data-testid=”agent-profile”`)

에이전트 채팅 로그에서 클릭 시 나타나는 상세 프로필 모달.

```
┌─ 에이전트 프로필 (agent-profile) ──────────────────────┐
│                                                  [✕]  │
│ 🦞 김지수  32세                                        │
│ 📍 판교  |  💼 IT 기업 PM                               │
│ 아키타입: 가격 민감형                                     │
│                                                       │
│ “판교에서 일하는 32세 PM. 물건을 살 때 항상               │
│  3개 이상 비교하고, 가성비를 꼼꼼히 따지는 편입니다.”        │
│                                                       │
│ ┌─ 성향 ───────────────────────────────────────┐      │
│ │ 가격민감도   ████████████████████░░  4.8/5    │      │
│ │ 신뢰민감도   ████░░░░░░░░░░░░░░░░░  1.9/5    │      │
│ │ 프로모선호   █████████████████████  4.7/5    │      │
│ │ 브랜드충성   ████░░░░░░░░░░░░░░░░░  1.8/5    │      │
│ │ 패스임계값   ██████████████░░░░░░░  0.72     │      │
│ └───────────────────────────────────────────────┘      │
│                                                       │
│ 선택: 경쟁사A                                           │
│ 이유: “가격이 더 저렴하고 충분한 품질”                       │
└───────────────────────────────────────────────────────┘
```

**구조:**
- 모달 오버레이: `data-testid=”agent-profile”`, position: fixed, z-index: 1000
- 닫기 버튼: `data-testid=”agent-profile-close”`
- 표시 필드:
  - 이름: `data-testid=”profile-name”` (🦞 + 이름 + 나이)
  - 위치+직업: `data-testid=”profile-location”` (📍 도시), `data-testid=”profile-occupation”` (💼 직업)
  - 아키타입: `data-testid=”profile-archetype”`
  - 자기소개: `data-testid=”profile-bio”` (1~2줄, `--text-muted`, 인용 형식)
  - 성향 바 5개: 각각 `data-testid=”profile-stat-{name}”` (progress bar, 0-5 스케일)
  - 선택 제품: `data-testid=”profile-choice”` (제품 색상)
  - 선택 이유: `data-testid=”profile-reasoning”`
- 트리거: `agent-log-entry` 클릭 시 해당 에이전트의 데이터로 팝업 표시
- ESC 키 또는 오버레이 클릭으로 닫기

### 12.9 Activity Panel (`data-testid=”panel-activity”`)

오른쪽 패널. 시뮬레이션 진행 중 실시간 정보를 표시. Results가 아닌 **활동 로그** 패널.

**구성 (위에서 아래로):**
1. 👑🦞 Strategy Lobster (§12.10)
2. 실시간 채팅 로그 (§12.6) — `overflow-y: auto`, 남은 높이 전부 사용

### 12.10 Results Popup (`data-testid=”results-popup”`)

`simulation_complete` SSE 이벤트 수신 시 **모달 팝업**으로 결과 표시.

```
┌─ Results Popup (results-popup) ──────────────────────────┐
│                                                    [✕]   │
│                                                          │
│ ┌─ Metrics ────────────────────────────────────────────┐ │
│ │ Baseline ₩5,651,100 │ Final ₩6,200,000 │ +₩548,900  │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─ 추천 전략 ──────────┐ ┌─ 변경 사항 ─────────────────┐ │
│ │ 제목: 새 타이틀       │ │ 제목: 현재 → 추천           │ │
│ │ 카피: 새 카피         │ │ 카피: 현재 → 추천           │ │
│ │ 가격: ₩26,500        │ │ 가격: ₩29,900 → ₩26,500   │ │
│ │ 마진: 55.2%          │ │      (-11.4%)              │ │
│ └──────────────────────┘ └─────────────────────────────┘ │
│                                                          │
│ ┌─ Revenue Chart ──────┐ ┌─ 핵심 인사이트 ─────────────┐ │
│ │ I1 ████ ₩4.2M       │ │ ⚠️ 가격민감형 45% 이탈       │ │
│ │ I2 ██████ ₩5.1M     │ │ ✅ 간절탈모인 92% 선택       │ │
│ │ I3 ████████ ₩5.8M   │ │ ✅ 신뢰우선형 72% 선택       │ │
│ │ I4 █████████ ₩6.2M  │ │ 🟡 할인반응형 58% 패스       │ │
│ │ ---- baseline ----  │ │                             │ │
│ └──────────────────────┘ └─────────────────────────────┘ │
│                                                          │
│                        📁 Artifact: latest-run-summary ✓ │
└──────────────────────────────────────────────────────────┘
```

**구조:**
- 모달 오버레이: `data-testid=”results-popup”`, position: fixed, z-index: 1000
- 닫기 버튼: `data-testid=”results-popup-close”`
- 배경: `backdrop-filter: blur(20px)` + 반투명 오버레이
- 크기: `max-width: 900px; max-height: 80vh; overflow-y: auto`
- 내부 2열 grid: 전략+변경 | Revenue+인사이트
- **트리거**: `simulation_complete` SSE 이벤트 수신 시 자동 표시
- **닫기**: X 버튼, ESC 키, 오버레이 클릭
- 닫은 후에도 “결과 보기” 버튼(`data-testid=”btn-show-results”`)으로 다시 열기 가능

모든 기존 Results data-testid(`metric-baseline`, `metric-final`, `metric-holdout`, `strategy-summary`, `diff-*`, `insights-panel`, `revenue-chart`, `artifact-output`)는 팝업 내부에 위치.

### 12.11 Strategy Lobster (`data-testid=”strategy-lobster”`)

Simulation Panel 상단 (sim-canvas 위). 각 iteration에서 전략가재(👑🦞)가 **왜 이 전략을 제안했는지** 보여주는 카드.

```
┌─ 👑🦞 전략가재 (strategy-lobster) ────────────────────┐
│                                                       │
│ Iteration 3/5                                         │
│                                                       │
│ 📋 후보 전략 3개:                                       │
│ ┌─────────────────────────────────────────────────┐   │
│ │ ① 신뢰 강화형  ₩29,900                           │   │
│ │   “전문가 설계 메시지를 더 분명하게”                  │   │
│ ├─────────────────────────────────────────────────┤   │
│ │ ② 가격 접근형  ₩26,500  ← 👑 승자                │   │
│ │   “경쟁사 대비 가격 간극을 줄여 가격민감형 확보”       │   │
│ ├─────────────────────────────────────────────────┤   │
│ │ ③ 프리미엄형   ₩31,000                           │   │
│ │   “프리미엄 포지션 유지, 메시지 명확화”               │   │
│ └─────────────────────────────────────────────────┘   │
│                                                       │
│ 💡 전략 근거: “Iter 2에서 가격민감형 45% 이탈 →          │
│    가격 간극 줄이기로 이탈 방어”                          │
└───────────────────────────────────────────────────────┘
```

**구조:**
- 컨테이너: `data-testid=”strategy-lobster”`
- Iteration 라벨: `data-testid=”strategy-iteration-label”`
- 후보 카드 3개: `data-testid=”strategy-candidate-{n}”` (n=1,2,3)
  - 각 카드: 전략명 + 가격 + rationale 1줄
  - 승자 카드: 👑 아이콘 + 하이라이트 테두리 (`--accent-blue`)
- 전략 근거: `data-testid=”strategy-rationale”` — gpt-5.4가 왜 이 방향을 택했는지 (1~2줄)
- `iteration_start` SSE 이벤트에서 후보 표시
- `iteration_complete` SSE 이벤트에서 승자 👑 표시
- 매 iteration마다 갱신

### 12.10 Input Panel (`data-testid=”panel-input”`)

**Product Card** (`data-testid=”product-card”`):
| Element | data-testid | Type | Default Source |
|---------|-------------|------|----------------|
| Product name | `product-name` | 읽기 전용 텍스트 | `ourProduct.product_name` |
| Brand | `product-brand` | 읽기 전용 텍스트 | `ourProduct.brand_name` |
| Title | `input-title` | `<textarea>` | `ourProduct.current_title` |
| Top copy | `input-top-copy` | `<textarea>` | `ourProduct.current_top_copy` |
| Price (₩) | `input-price` | `<input type=”number”>` | `ourProduct.current_price_krw` |
| Cost (₩) | `input-cost` | `<input type=”number”>` | `ourProduct.current_cost_krw` |

**Competitors Card** (`data-testid=”competitors-card”`):
- 각 경쟁사는 개별 카드: `data-testid=”competitor-a”`, `competitor-b”`, `competitor-c”`
- 각 카드에 표시: product name, price (₩), 읽기 전용
- 카드는 가격 순 정렬

**Settings Card** (`data-testid=”settings-card”`):
| Element | data-testid | Type | Default | Range |
|---------|-------------|------|---------|-------|
| Iteration count | `input-iteration-count` | `<input type=”number”>` | 5 | 1–10 |
| Margin floor | `input-margin-floor` | `<input type=”number” step=”0.01”>` | 0.35 | 0.10–0.90 |

**Run Controls**:
| Element | data-testid | Behavior |
|---------|-------------|----------|
| Run button | `btn-run` | 클릭 → SSE 연결, disabled during run |
| Status text | `status-text` | 상태 메시지 표시 (idle/running/complete/error) |

### 12.3 Simulation Panel (`data-testid=”panel-simulation”`)

중앙 패널. Force-directed node graph로 멀티 에이전트 시뮬레이션을 실시간 시각화.

**Canvas** (`data-testid=”sim-canvas”`):
- 구현: Canvas 2D 또는 SVG (vanilla JS, 외부 라이브러리 없음. D3.js 허용)
- 반응형: 중앙 패널 크기에 맞춤

**Archetype Nodes** (8개, `data-testid=”archetype-{id}”`):
- 원형 노드, 아키타입 이름 라벨
- 크기: 해당 아키타입의 구매자 수에 비례
- 색상: 기본 회색, 활성화 시 선택한 제품 색상으로 변경

**Product Nodes** (5개, `data-testid=”product-node-{id}”`):
- 하단 고정 위치, 더 큰 원형
- `our_product`: 파랑 (`#2563eb`)
- `competitor_a`: 빨강 (`#dc2626`)
- `competitor_b`: 주황 (`#ea580c`)
- `competitor_c`: 노랑 (`#ca8a04`)
- `pass`: 회색 (`#6b7280`)

**Edges**:
- `agent_decision` SSE 이벤트마다 아키타입 → 선택된 제품으로 엣지 그리기
- 엣지 두께: 선택 확률에 비례
- 엣지 색상: 대상 제품 노드 색상
- 애니메이션: 0.3s transition

**Progress** (`data-testid=”sim-progress”`):
- 프로그레스 바 또는 텍스트: `Iteration 3/5`
- 라벨: `data-testid=”sim-iteration-label”`

### 12.4 Results Panel (`data-testid=”panel-results”`)

**Metrics Row** (`data-testid=”metrics-row”`):
| Metric | data-testid | Format |
|--------|-------------|--------|
| Baseline revenue | `metric-baseline` | `₩XX,XXX,XXX` (Intl.NumberFormat ko-KR) |
| Final revenue | `metric-final` | `₩XX,XXX,XXX` |
| Holdout uplift | `metric-holdout` | `+₩XX,XXX,XXX` (양수 초록, 음수 빨강) |

**Strategy Card** (`data-testid=”strategy-summary”`):
- 카드 형태로 선택된 전략 표시 (raw JSON 아님)
- 표시 항목: title, top_copy, price_krw, margin_rate
- 제목: “추천 전략”

**Diff Card** (`data-testid=”diff-output”`):
| Field | data-testid | Display |
|-------|-------------|---------|
| Title | `diff-title` | `현재값` → `추천값` (before→after 형식) |
| Top copy | `diff-top-copy` | `현재값` → `추천값` |
| Price | `diff-price` | `₩현재` → `₩추천` (변동률 %) |

**Artifact Card** (`data-testid=”artifact-output”`):
- 제목: “Artifact”
- 파일 경로: `artifacts/latest-run-summary.json`
- 요약: selected_strategy_id, holdout_uplift, timestamp

### 12.5 UI States

| State | Trigger | panel-input | panel-simulation | panel-results |
|-------|---------|-------------|------------------|---------------|
| **Empty** | 초기 로드 | fixture 데이터 표시, 필드 수정 가능 | `data-testid=”state-empty”`: 안내 텍스트 “Run a simulation to see buyer agent decisions” | `data-testid=”state-empty”`: “Run the simulation to see a recommendation” |
| **Loading** | btn-run 클릭 | 필드 disabled | `data-testid=”state-loading”`: force graph 애니메이션 + progress bar | 이전 결과 dim 처리 또는 숨김 |
| **Completed** | simulation_complete SSE | 필드 re-enabled | `data-testid=”state-completed”`: 최종 graph 정지 | 모든 metric/strategy/diff/artifact 표시 |
| **Error** | error SSE or fetch 실패 | 필드 re-enabled | 에러 표시 | `data-testid=”state-error”`: 빨간 텍스트로 에러 메시지 |

## 13. SSE Streaming Protocol

### 13.1 Endpoint

- **Path**: `POST /api/run/stream`
- **Request Content-Type**: `application/json`
- **Request Body**:
  ```json
  {
    “iterationCount”: 5,
    “minimumMarginFloor”: 0.35,
    “title”: “override title (optional)”,
    “topCopy”: “override copy (optional)”,
    “priceKrw”: 29900,
    “costKrw”: 11000,
    “archetypeCounts”: {“price_sensitive”: 144, “desperate_hairloss”: 88, ...},
    “genderMaleCount”: 480
  }
  ```
- `archetypeCounts`: 아키타입별 에이전트 수 override (optional, 합계 = 800 정수)
- `genderMaleCount`: 남성 에이전트 수 (optional, 기본 400, 여성 = 800 - 남성)
- **Response Content-Type**: `text/event-stream`

### 13.2 Event Types

```
event: iteration_start
data: {“iteration”:1,”total”:5,”candidates”:[{“id”:”c1”,”title”:”...”,”price_krw”:28900,”rationale”:”가격 간극 줄이기”}],”strategy_reasoning”:”Iter 0 baseline에서 가격민감형 이탈이 높아 가격 접근 전략을 추가”,”agent_count”:800}

event: agent_decision
data: {“iteration”:1,”agent_id”:”agent_042”,”agent_name”:”김지수”,”archetype_id”:”price_sensitive”,”archetype_name”:”가격 민감형”,”chosen_product”:”competitor_a”,”reasoning”:”가격이 더 저렴하고 충분한 품질”,”agent_index”:42,”agent_total”:800}

event: iteration_complete
data: {“iteration”:1,”winner_id”:”c1”,”winner_revenue”:24500000,”accepted”:true,”rejected_count”:1,”choice_summary”:{“our_product”:287,”competitor_a”:198,”competitor_b”:142,”competitor_c”:93,”pass”:80},”archetype_breakdown”:[{“archetype_id”:”price_sensitive”,”our_product”:22,”competitor_a”:50,”competitor_b”:26,”competitor_c”:18,”pass”:28},...]}

event: holdout_start
data: {“message”:”200명 홀드아웃 에이전트로 최종 검증 중...”,”agent_count”:200}

event: simulation_complete
data: {“baseline”:{...},”selected_strategy”:{...},”holdout”:{...},”diff”:{...},”artifact”:{...},”total_agents”:800,”total_llm_calls”:4020}

event: error
data: {“message”:”OpenAI API timeout”,”recoverable”:true}
```

**이벤트 흐름 (1 iteration):**
```
iteration_start (1회)
  → agent_decision × 800 (개별 에이전트, concurrent 전송)
  → iteration_complete (1회, 집계 포함)
```

**agent_decision 이벤트 특징:**
- `agent_id`: 고유 에이전트 ID (예: `agent_042`)
- `agent_name`: 한국 이름 (예: `김지수`, `이민호`)
- `archetype_id`: 소속 아키타입
- `chosen_product`: 선택한 제품 (`our_product`, `competitor_a`, `competitor_b`, `competitor_c`, `pass` 중 1개)
- `reasoning`: 선택 이유 1줄 (LLM 생성)
- `agent_index` / `agent_total`: 진행 상황 (42/800)

### 13.3 Client Integration

- `POST` with `fetch`, read `response.body` as `ReadableStream`
- Parse SSE format: lines starting with `event:` and `data:`
- Each `agent_decision` → 파티클 생성 + 카운터 증가 + 에이전트 카운트 업데이트
- Each `iteration_complete` → 아키타입별 요약 테이블 표시, 프로그레스 바 갱신
- `simulation_complete` → 파티클 정지, Results Panel 채우기
- `error` → show `data-testid=”state-error”`, re-enable Run button

### 13.4 Individual Agent Architecture

**에이전트 생성:**
- 8개 아키타입에서 `cohort_weight_percent` 비율로 800명 분배
  - 가격민감형 18% → 144명
  - 가성비균형형 16% → 128명
  - 프리미엄형 12% → 96명
  - 신뢰우선형 15% → 120명
  - 감성형 8% → 64명
  - 간절한탈모인 11% → 88명
  - 할인반응형 10% → 80명
  - 가족구매형 10% → 80명

**에이전트 persona 생성:**
- 아키타입 기본 속성(price_sensitivity, trust_sensitivity 등)에 ±10% 랜덤 변형
- 한국 이름 랜덤 부여 (성 30개 × 이름 50개 풀에서)
- 각 에이전트에 풍부한 persona 프로필 생성:

| 필드 | 생성 방식 | 예시 |
|------|----------|------|
| `name` | 성 30개 × 이름 50개 풀 | 김지수 |
| `age` | 아키타입별 범위에서 랜덤 (20~65) | 32 |
| `location` | 한국 도시 20개 풀 (서울/판교/부산/대전 등) | 판교 |
| `occupation` | 아키타입별 직업 풀 (5~8개씩) | IT 기업 PM |
| `personality` | 아키타입 특성 기반 1줄 성격 묘사 | 합리적이고 비교를 좋아함 |
| `bio` | 아키타입+직업+성격 조합 자기소개 1~2줄 | "판교에서 일하는 32세 PM. 물건을 살 때 항상 3개 이상 비교하고, 가성비를 꼼꼼히 따지는 편입니다." |

**아키타입별 직업 풀 예시:**
- 가격민감형: 대학생, 사회초년생, 프리랜서, 알바생, 취준생
- 프리미엄형: 의사, 변호사, 대기업 임원, 자산가, 교수
- 신뢰우선형: 공무원, 교사, 은행원, 약사, 간호사
- 간절한 탈모인: 스타트업 CTO, 야근 많은 개발자, 스트레스 많은 직장인, 대학원생, 자영업자
- 가족구매형: 주부, 워킹맘, 육아 블로거, 시니어 부모

- 각 에이전트의 LLM prompt에 전체 persona 포함 (더 사실적인 선택 유도)

**LLM 호출 (gpt-5-nano):**
- System: “당신은 {agent_name}입니다. {age}세 {gender} {location} 거주 {occupation}. {bio}. 다음 상품 중 하나를 선택하세요. reasoning은 당신의 성격과 상황에 맞게 생생하고 재미있는 한국어 1~2문장으로 작성하세요. 진지한 분석이 아니라 실제 소비자가 카톡에서 친구에게 말하듯이 자연스럽게.”
- User: 5개 상품(우리+경쟁3+패스)의 title, top_copy, price 정보
- Output: `{ chosen_product, reasoning }` (structured output)
- Concurrent: max_concurrency 200+ (rate limit 허용 범위 내 최대)

### 13.5 Performance Requirements

| 항목 | 목표 | 비고 |
|------|------|------|
| 전체 시뮬레이션 시간 | **≤ 600초 (10분)** | 5 iterations + holdout, hard constraint |
| 파티클 플로우 FPS | **≥ 30fps** | 800개 파티클 동시 렌더링 |
| UI 응답 시간 | **≤ 500ms** | 차트 바, 프로필 팝업, 카운터 업데이트 |
| concurrent | **200+** | rate limit 허용 범위 내 최대 |

**서버 변경:**
- `engine.mjs`의 `evaluateStrategies` 함수를 개별 에이전트 호출로 교체
- 기존 `evaluateArchetypeBatch` → 새로운 `evaluateIndividualAgent` 함수
- sampler.mjs의 deterministic 분배 로직 제거 (LLM이 직접 선택)

## 14. Runtime Configuration

### 14.1 Server

| Item | Value |
|------|-------|
| Start command | `npm run dev` 또는 `npm start` |
| Entry point | `src/server.mjs` |
| Port | `3001` (env `PORT`로 변경 가능) |
| Ready probe | `GET http://127.0.0.1:3001/` → 200 |

### 14.2 API Endpoints

| Method | Path | Purpose | data-testid 연관 |
|--------|------|---------|-------------------|
| GET | `/` | Dashboard HTML | — |
| GET | `/dashboard.js` | Client JavaScript | — |
| GET | `/styles.css` | Styles | — |
| GET | `/api/fixtures` | Fixture summary (product, competitors, config) | Input Panel 초기화 |
| POST | `/api/run` | Batch simulation (전체 결과 한번에 반환) | 테스트용 |
| POST | `/api/run/stream` | SSE streaming simulation (iteration별 이벤트) | Simulation Panel |

### 14.4 GET `/api/fixtures` Response Schema

Input Panel의 6개 editable field를 초기화하기 위해, fixture API는 다음을 모두 반환해야 한다:

```json
{
  "product": {
    "product_name": "트리클리닉 엑스퍼트 스칼프 탈모 샴푸",
    "brand_name": "트리클리닉",
    "current_title": "트리클리닉 엑스퍼트 스칼프 탈모 샴푸 500ml",
    "current_top_copy": "두피과학 기반의 성분 설계로...",
    "current_price_krw": 29900,
    "current_cost_krw": 11000
  },
  "competitors": [
    { "id": "competitor_a", "product_name": "...", "price_krw": 25900 },
    { "id": "competitor_b", "product_name": "...", "price_krw": 27000 },
    { "id": "competitor_c", "product_name": "...", "price_krw": 31500 }
  ],
  "archetypes": [
    { "id": "price_sensitive", "label": "가격 민감형", "cohort_weight_percent": 18 },
    ...
  ],
  "defaults": {
    "iteration_count": 5,
    "minimum_margin_floor": 0.35
  }
}
```

**주의**: 현재 서버 코드(`server.mjs:45-59`)는 `product_name`과 `price_krw`만 반환한다. 에이전트는 위 스키마에 맞게 응답을 확장해야 한다.

### 14.5 POST `/api/run` 및 `/api/run/stream` Request Schema

두 endpoint 모두 동일한 request body를 받는다. 모든 override 필드는 optional:

```json
{
  "iterationCount": 5,
  "minimumMarginFloor": 0.35,
  "title": "오버라이드 타이틀 (optional)",
  "topCopy": "오버라이드 카피 (optional)",
  "priceKrw": 29900,
  "costKrw": 11000
}
```

- override가 없으면 fixture 기본값을 사용
- override가 있으면 해당 값으로 baseline을 대체하여 시뮬레이션 실행
- **주의**: 현재 서버 코드(`server.mjs:61-69`)와 엔진(`engine.mjs`)은 `iterationCount`와 `minimumMarginFloor`만 받는다. 에이전트는 title/topCopy/priceKrw/costKrw override를 서버와 엔진 모두에 구현해야 한다.

### 14.3 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | 서버 포트 |
| `OPENAI_API_KEY` | Yes (live) | — | OpenAI API 키 |
| `SELLER_WAR_GAME_MODEL_MODE` | No | `live` | `live` 또는 `mock` |

## 15. Brownfield Context

### 15.1 Existing Stack

- **Runtime**: Node.js (ESM, `.mjs` 확장자)
- **Framework**: 없음 (vanilla `http.createServer`)
- **Frontend**: Vanilla HTML/CSS/JS (React/Vue 사용 안 함)
- **Testing**: `node:test` (Node.js 내장 테스트 러너)
- **AI**: OpenAI API (`gpt-5.4` for strategy/judge, `gpt-5-nano` for buyer eval)

### 15.2 File Structure

```
seller-war-game/
├── src/
│   ├── server.mjs                     # HTTP server (수정 필요: SSE endpoint 추가)
│   ├── app/
│   │   ├── dashboard.html             # Main HTML (수정 필요: 3-panel layout)
│   │   ├── dashboard.js               # Client JS (수정 필요: SSE + visualization)
│   │   └── styles.css                 # Styles (수정 필요: 3-panel grid)
│   └── lib/
│       ├── fixtures.mjs               # Fixture loader (유지)
│       ├── simulation/
│       │   ├── engine.mjs             # Simulation engine (수정 필요: SSE callback 지원)
│       │   ├── strategy-generator.mjs # (유지)
│       │   ├── evaluator-nano.mjs     # (유지)
│       │   ├── sampler.mjs            # (유지)
│       │   ├── scorer.mjs             # (유지)
│       │   ├── holdout.mjs            # (유지)
│       │   └── archetypes.mjs         # (유지)
│       ├── judges/
│       │   └── merchant-realism.mjs   # (유지)
│       ├── openai/
│       │   ├── client.mjs             # (유지)
│       │   └── schemas.mjs            # (유지)
│       ├── diff/
│       │   └── build-diff.mjs         # (유지)
│       ├── reports/
│       │   └── latest-run-summary.mjs # (유지)
│       └── prompts/                   # (유지)
├── fixtures/                          # (유지, 읽기 전용)
├── tests/                             # (수정 필요: SSE + UI 테스트 추가)
├── artifacts/                         # (유지)
└── package.json                       # (수정 필요: 필요시 devDependencies 추가)
```

### 15.3 Conventions

- 모든 소스 파일: `.mjs` 확장자 (ESM)
- Fixture 파일: Markdown with YAML-like metadata (읽기 전용, 수정 금지)
- 빌드 단계 없음: `node`로 직접 실행
- 테스트: `node --test tests/*.test.mjs`
- 기존 element ID 보존 (새 `data-testid` 추가, 기존 `id` 제거 금지)
- 금액: KRW 정수 (소수점 없음)
- 상품 콘텐츠: 한국어, 코드/기술 콘텐츠: 영어

## 16. Data-Testid Contract (전체 목록)

아래 `data-testid` 속성은 browser_flows 및 screenshot_checks에서 검증에 사용된다. 에이전트는 이 목록의 모든 항목을 구현해야 한다.

### Layout
- `panel-input`, `panel-simulation`, `panel-results`

### Input Panel
- `product-card`, `product-name`, `product-brand`
- `input-title`, `input-top-copy`, `input-price`, `input-cost`
- `competitors-card`, `competitor-a`, `competitor-b`, `competitor-c`
- `settings-card`, `input-iteration-count`, `input-margin-floor`
- `btn-run`, `status-text`

### Simulation Panel
- `archetype-mixer` — 그룹 설정 (파티클 캔버스 하단)
- `count-{archetype_id}` — 아키타입별 에이전트 수 input (8개, 정수)
- `agent-total` — 합계 표시 ("800명 ✓" 또는 "652명 ✗")
- `gender-male-count`, `gender-female-count` — 성별 에이전트 수 input
- `strategy-lobster` — 👑🦞 전략가재 패널 → Activity Panel로 이동
- `strategy-iteration-label` — iteration 번호
- `strategy-candidate-{n}` — 후보 전략 카드 (3개)
- `strategy-rationale` — 전략 근거 텍스트
- `sim-canvas` — 파티클 플로우 Canvas
- `sim-progress`, `sim-iteration-label` — 진행 상황
- `agent-count` — "247 / 800 에이전트 완료" 카운터
- `product-counter-our_product`, `product-counter-competitor_a`, `product-counter-competitor_b`, `product-counter-competitor_c`, `product-counter-pass` — 제품별 선택 수 카운터
- `archetype-summary-table` — 아키타입별 선택 비율 테이블 (iteration 완료 후 표시)
- `agent-log` — 에이전트 라이브 채팅 로그 (스크롤 컨테이너)
- `agent-log-entry` — 개별 로그 항목 (800개, 클릭 가능)

### Activity Panel (오른쪽)
- `panel-activity` — 오른쪽 패널 (전략가재 + 채팅 로그)

### Results Popup (모달)
- `results-popup` — 모달 오버레이
- `results-popup-close` — 닫기 버튼
- `btn-show-results` — 팝업 닫은 후 다시 열기 버튼
- `revenue-chart` — Iteration별 매출 바 차트
- `revenue-bar-{n}` — 개별 iteration 바
- `revenue-baseline` — baseline 점선
- `insights-panel` — 자동 생성 인사이트 컨테이너
- `insight-item` — 개별 인사이트 항목 (최소 3개)

### Agent Profile Popup
- `agent-profile` — 모달 오버레이
- `agent-profile-close` — 닫기 버튼
- `profile-name` — 🦞 + 이름 + 나이
- `profile-location` — 📍 거주 지역
- `profile-occupation` — 💼 직업
- `profile-archetype` — 아키타입
- `profile-bio` — 자기소개 (1~2줄)
- `profile-stat-{name}` — 성향 progress bar (5개)
- `profile-choice` — 선택 제품
- `profile-reasoning` — 선택 이유

### Results Panel
- `metrics-row`, `metric-baseline`, `metric-final`, `metric-holdout`
- `strategy-summary`
- `diff-output`, `diff-title`, `diff-top-copy`, `diff-price`
- `artifact-output`

### State Indicators
- `state-empty`, `state-loading`, `state-completed`, `state-error`

## 17. Ontology Schema (Seed 필수 필드)

도메인 데이터 모델 정의. Seed YAML의 `ontology_schema` 필드에 매핑된다.

```yaml
ontology_schema:
  name: "SellerWarGame"
  description: "Buyer-agent swarm 시뮬레이션을 통한 seller listing 최적화 도메인"
  fields:
    - name: "product"
      field_type: "entity"
      description: "셀러의 상품. title, top_copy, price_krw는 mutable, product_name/brand_name은 immutable"
      required: true

    - name: "competitor"
      field_type: "entity"
      description: "경쟁 상품 3개. product_name, price_krw. 읽기 전용, 시뮬레이션 기간 내 변경 불가"
      required: true

    - name: "buyer_archetype"
      field_type: "entity"
      description: |
        구매자 페르소나 아키타입 8개:
        price_sensitive(18%), value_seeker(16%), premium_quality(12%),
        trust_first(15%), aesthetics_first(8%), desperate_hairloss(11%),
        promo_hunter(10%), gift_or_family_buyer(10%).
        각 아키타입은 price_sensitivity, trust_sensitivity, pass_threshold 등의 속성을 가짐
      required: true

    - name: "strategy"
      field_type: "entity"
      description: "후보 최적화 전략. id, title, top_copy, price_krw, rationale 포함. iteration당 3개 생성"
      required: true

    - name: "evaluation"
      field_type: "action"
      description: "아키타입이 전략을 평가하는 행위. 결과: choices 분포 (our_product, competitor_a/b/c, pass별 buyer 수)"
      required: true

    - name: "realism_judgment"
      field_type: "action"
      description: "merchant-realism judge가 전략의 현실성을 판정. verdict: pass/fail, reasoning 포함"
      required: true

    - name: "simulation_run"
      field_type: "entity"
      description: |
        전체 시뮬레이션 실행 단위.
        N회 iteration, 각 iteration에서 strategy 생성→evaluation→judgment→scoring.
        최종 winner에 대해 holdout 검증 수행
      required: true

    - name: "diff"
      field_type: "entity"
      description: "baseline과 selected_strategy 간 차이. title, top_copy, price 3개 필드의 before→after"
      required: true

    - name: "holdout_validation"
      field_type: "action"
      description: "별도 200명 buyer cohort로 최종 전략 검증. holdout_uplift > 0이면 통과"
      required: true

    - name: "sse_event"
      field_type: "action"
      description: |
        실시간 스트리밍 이벤트. 5개 타입:
        iteration_start, agent_decision, iteration_complete, holdout_start, simulation_complete.
        force-directed graph 시각화에 사용
      required: true
```

## 18. Evaluation Principles (Seed 필수 필드)

출력 품질을 평가하는 원칙과 가중치. Seed YAML의 `evaluation_principles` 필드에 매핑된다.

```yaml
evaluation_principles:
  - name: "simulation_correctness"
    description: |
      시뮬레이션 파이프라인이 올바른 결과를 생성하는가:
      - fixture 파싱 성공
      - 전략 생성 schema 유효
      - buyer evaluation schema 유효
      - realism judgment schema 유효
      - margin floor 적용 정상
      - holdout 검증 정상
      - diff가 title/top_copy/price 3개만 포함
    weight: 1.0

  - name: "holdout_validation"
    description: |
      최종 선택된 전략이 holdout 검증을 통과하는가:
      - holdout_uplift > 0 (최종 전략이 baseline보다 수익 높음)
      - margin_floor_violations = 0 (마진 제약 준수)
    weight: 1.0

  - name: "data_consistency"
    description: |
      세 군데 데이터가 일치하는가:
      - UI에 표시된 값 (data-testid 셀렉터)
      - /api/run 또는 /api/run/stream 응답값
      - artifacts/latest-run-summary.json 파일 내용
      7개 필드: strategy_id, baseline_revenue, final_revenue, holdout_uplift, diff_title, diff_top_copy, diff_price
    weight: 1.0

  - name: "ui_completeness"
    description: |
      §16 Data-Testid Contract의 모든 요소가 렌더링되는가:
      - 3-panel layout (panel-input, panel-simulation, panel-results)
      - Input Panel: product-card, 6개 editable inputs, competitors-card, settings-card, btn-run
      - Simulation Panel: sim-canvas, archetype nodes(8), product nodes(5), progress
      - Results Panel: metrics(3), strategy-summary, diff(3), artifact-output
      - 4개 state indicator (state-empty, state-loading, state-completed, state-error)
    weight: 1.0

  - name: "visual_quality"
    description: |
      UI가 데모 가능한 수준인가 (객관적 기준):
      - raw JSON 표시 없음 (product-card, strategy-summary, diff-output 내 '{' 문자 없음)
      - 3-panel 가로 배치 유지 (3개 패널 top 값 동일 ±10px)
      - KRW 금액 형식 (₩ + 천단위 구분자)
      - 에러 메시지에 stack trace/기술 용어 없음
    weight: 0.9

  - name: "sse_streaming"
    description: |
      SSE 실시간 스트리밍이 올바르게 동작하는가:
      - POST /api/run/stream → Content-Type: text/event-stream
      - 이벤트 순서: iteration_start → agent_decision(×8) → iteration_complete (반복) → holdout_start → simulation_complete
      - 각 agent_decision의 choices 합산 = train_buyers/archetype_count (±1)
      - simulation_complete에 baseline, selected_strategy, holdout, diff, artifact 모두 포함
    weight: 0.9

  - name: "simulation_visualization"
    description: |
      force-directed node graph가 SSE 이벤트에 따라 시각화되는가:
      - sim-canvas 내에 8개 archetype 노드 + 5개 product 노드 렌더링
      - agent_decision 이벤트마다 엣지 애니메이션 (0.3s transition)
      - 엣지 두께: 선택 확률 비례, 엣지 색상: 대상 product 색상
      - iteration_complete마다 progress 업데이트
      - simulation_complete 시 graph 정지
    weight: 0.8

  - name: "input_override"
    description: |
      사용자 입력 수정이 시뮬레이션 결과에 반영되는가:
      - 6개 필드 (title, top_copy, price, cost, iteration_count, margin_floor) 수정 가능
      - 수정된 값이 /api/run/stream request body에 포함
      - 가격 변경 후 재실행 시 baseline revenue 변경 확인
      - fixture markdown 파일은 변경되지 않음
    weight: 0.9

  - name: "error_resilience"
    description: |
      에러 상황에서 적절히 대응하는가:
      - API 키 무효 시 state-error 표시, readable 메시지
      - SSE 연결 끊김 시 에러 상태 전환
      - btn-run 재활성화 (재시도 가능)
      - stack trace나 ECONNREFUSED 등 기술 용어 미노출
    weight: 0.7
```

## 19. Exit Conditions (Seed 필수 필드)

워크플로우 종료 조건. Seed YAML의 `exit_conditions` 필드에 매핑된다.

```yaml
exit_conditions:
  - name: "all_gates_pass"
    description: "test spec의 8개 검증 gate가 모두 통과"
    evaluation_criteria: |
      1. Engine Gate: npm test 전체 통과
      2. Live OpenAI Gate: gpt-5.4 + gpt-5-nano live call 성공
      3. HTTP API Gate: /, /api/fixtures, /api/run, /api/run/stream 모두 정상
      4. Browser UI Gate: 4개 Playwright flow (empty/mock-run/live-run/error) 통과
      5. SSE Streaming Gate: 이벤트 순서, archetype 수, choices 합산 검증 통과
      6. Editable Input Gate: 입력 변경→결과 변경 확인, fixture 파일 무변경
      7. Visual Gate: screenshot 4장, 객관적 usability 기준 5개 통과
      8. Artifact/Consistency Gate: UI·API·파일 7개 필드 일치

  - name: "evidence_bundle_complete"
    description: "Required Evidence Bundle의 11개 항목이 모두 수집됨"
    evaluation_criteria: |
      npm test 결과, node --check 결과,
      mock E2E pass, live E2E pass,
      screenshot 4장 (empty/loading/completed/error),
      live run artifact, consistency proof, input override proof

  - name: "live_run_success"
    description: "최소 1회 live OpenAI 시뮬레이션이 end-to-end 성공"
    evaluation_criteria: |
      SELLER_WAR_GAME_MODEL_MODE=live 상태에서
      btn-run 클릭 → SSE 스트리밍 → simulation_complete 수신 →
      holdout_uplift > 0 AND margin_floor_violations = 0

  - name: "no_raw_json_in_ui"
    description: "UI에 raw JSON이 하나도 없음"
    evaluation_criteria: |
      product-card, strategy-summary, diff-output, artifact-output 내부에
      <pre> 태그나 '{' 문자열이 포함되지 않음.
      모든 데이터는 카드/테이블/라벨 형식으로 표시

  - name: "max_iterations_safety"
    description: "Ralph Loop 안전 한계"
    evaluation_criteria: "10회 iteration 후에도 미달성 시 중단하고 결과 보고"
```
