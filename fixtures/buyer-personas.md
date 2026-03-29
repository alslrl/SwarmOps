# buyer-personas.md

## Metadata
- fixture_version: 1
- cohort_design: archetype_to_sampled_swarm
- archetype_count: 8
- train_buyers: 800
- holdout_buyers: 200
- choice_space:
  - our_product
  - competitor_a
  - competitor_b
  - competitor_c
  - pass

## Shared fields
- budget_band: low | mid | high
- price_sensitivity: 1-5
- copy_preference: short phrase
- trust_sensitivity: 1-5
- promo_affinity: 1-5
- brand_bias: 1-5
- pass_threshold: 0-1
- cohort_weight_percent: integer sum to 100

## archetype_1
- id: price_sensitive
- label: 가격 민감형
- cohort_weight_percent: 18
- budget_band: low
- price_sensitivity: 5
- copy_preference: 저렴하고 실속 있는 선택
- trust_sensitivity: 2
- promo_affinity: 5
- brand_bias: 2
- pass_threshold: 0.72

## archetype_2
- id: value_seeker
- label: 가성비 균형형
- cohort_weight_percent: 16
- budget_band: mid
- price_sensitivity: 4
- copy_preference: 가격 대비 효율과 기능이 좋아 보이는 문구
- trust_sensitivity: 3
- promo_affinity: 4
- brand_bias: 2
- pass_threshold: 0.60

## archetype_3
- id: premium_quality
- label: 프리미엄 품질형
- cohort_weight_percent: 12
- budget_band: high
- price_sensitivity: 2
- copy_preference: 고급감, 전문성, 차별화
- trust_sensitivity: 4
- promo_affinity: 1
- brand_bias: 3
- pass_threshold: 0.45

## archetype_4
- id: trust_first
- label: 신뢰 우선형
- cohort_weight_percent: 15
- budget_band: mid
- price_sensitivity: 3
- copy_preference: 믿을 수 있는 설계, 전문가, 과학 기반
- trust_sensitivity: 5
- promo_affinity: 2
- brand_bias: 4
- pass_threshold: 0.48

## archetype_5
- id: aesthetics_first
- label: 감성/브랜드 인상형
- cohort_weight_percent: 8
- budget_band: mid
- price_sensitivity: 3
- copy_preference: 깔끔하고 세련된 프리미엄 톤
- trust_sensitivity: 3
- promo_affinity: 2
- brand_bias: 4
- pass_threshold: 0.58

## archetype_6
- id: desperate_hairloss
- label: 간절한 탈모인
- cohort_weight_percent: 11
- budget_band: high
- price_sensitivity: 1
- copy_preference: 효과 있다는 말이면 일단 사고 본다, 후기와 성분에 진심
- trust_sensitivity: 5
- promo_affinity: 1
- brand_bias: 5
- pass_threshold: 0.15

## archetype_7
- id: promo_hunter
- label: 할인 반응형
- cohort_weight_percent: 10
- budget_band: low
- price_sensitivity: 4
- copy_preference: 할인/혜택/지금 사야 하는 이유
- trust_sensitivity: 2
- promo_affinity: 5
- brand_bias: 1
- pass_threshold: 0.68

## archetype_8
- id: gift_or_family_buyer
- label: 가족/대리 구매형
- cohort_weight_percent: 10
- budget_band: mid
- price_sensitivity: 3
- copy_preference: 안전하고 믿을 수 있어 가족에게도 권할 수 있는 문구
- trust_sensitivity: 5
- promo_affinity: 2
- brand_bias: 3
- pass_threshold: 0.56

## Simulator Notes
- train cohort는 위 archetype weight를 따라 800명으로 샘플링한다.
- holdout cohort는 같은 archetype 구조를 유지하되 별도 seed로 200명 샘플링한다.
- LLM은 archetype-level 선호 판단만 수행하고, 개별 buyer 확장은 deterministic sampler가 한다.
