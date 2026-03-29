# run-config.md

## Metadata
- fixture_version: 1
- environment: local_demo
- snapshot_date: 2026-03-26

## Runtime Defaults
- default_iteration_count: 5
- default_minimum_margin_floor: 0.35
- sampler_seed: 4242
- candidate_strategies_per_iteration: 3
- max_concurrency: 6

## Model Defaults
- strategy_model: gpt-5.4
- buyer_evaluator_model: gpt-5.4-nano
- realism_judge_model: gpt-5.4

## Swarm Defaults
- archetype_count: 8
- train_buyers: 800
- holdout_buyers: 200
- buyer_action_model: discrete_choice

## Search Bounds
- price_change_percent_min: -0.15
- price_change_percent_max: 0.10
- title_variants_per_iteration: 3
- top_copy_variants_per_iteration: 3
- allow_field_changes:
  - title
  - top_copy
  - price
- disallow_field_changes:
  - image
  - discount
  - coupon
  - trust_copy
  - theme
  - live_mutation

## Objective
- optimize_for: constrained_revenue_maximization
- rejection_rules:
  - below_margin_floor
  - invalid_choice_label
  - schema_validation_failed
  - realism_judge_failed

## Holdout Gate
- require_positive_holdout_uplift: true
- tie_breaker_order:
  - higher_margin
  - smaller_text_delta

## Dashboard Expectations
- controls:
  - run_simulation
  - iteration_count
  - minimum_margin_floor
- outputs:
  - baseline_simulated_revenue
  - final_simulated_revenue
  - holdout_uplift
  - selected_strategy_summary
  - diff_title
  - diff_top_copy
  - diff_price

## Notes
- v0는 fixture 기반 simulator이며, live Shopify mutation은 수행하지 않는다.
- 사용자는 dashboard에서 minimum margin floor와 iteration count를 override할 수 있다.
