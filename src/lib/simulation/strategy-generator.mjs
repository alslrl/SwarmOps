import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRATEGY_CANDIDATES_SCHEMA, assertStrategyCandidatesPayload } from '../openai/schemas.mjs';
import { clamp } from './scorer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.resolve(__dirname, '../prompts/strategy-proposer.md');

function buildFallbackStrategies({ currentStrategy, ourProduct, competitors, runConfig, iteration }) {
  const prices = competitors.competitors.map((item) => item.price_krw);
  const minCompetitor = Math.min(...prices);
  const maxCompetitor = Math.max(...prices);
  const lowBound = Math.round(currentStrategy.price_krw * (1 + runConfig.price_change_percent_min));
  const highBound = Math.round(currentStrategy.price_krw * (1 + runConfig.price_change_percent_max));
  const trustBase = '전문가 설계와 두피과학 관점에서 신뢰감 있게 관리하는 탈모 샴푸';

  return [
    {
      id: `iter-${iteration}-steady-trust`,
      title: `${ourProduct.brand_name} 전문가 설계 탈모 샴푸 500ml`,
      top_copy: `${trustBase} — 가격은 지키고 핵심 신뢰 메시지를 더 분명하게 전달합니다.`,
      price_krw: clamp(Math.round((currentStrategy.price_krw + maxCompetitor) / 2), lowBound, highBound),
      rationale: '가격은 크게 건드리지 않고 전문가 신뢰 메시지를 강화하는 방어형 전략',
    },
    {
      id: `iter-${iteration}-narrow-gap`,
      title: `${ourProduct.brand_name} 두피과학 기반 탈모 샴푸 500ml`,
      top_copy: `${trustBase} — 경쟁 제품 대비 신뢰 포인트는 유지하되 가격 간극을 소폭 줄이는 전략입니다.`,
      price_krw: clamp(Math.round((currentStrategy.price_krw + minCompetitor) / 2), lowBound, highBound),
      rationale: '신뢰감은 유지하면서 가격 차이를 줄여 더 많은 선택을 유도하는 전략',
    },
    {
      id: `iter-${iteration}-premium-clarity`,
      title: `${ourProduct.brand_name} 프리미엄 스칼프 탈모 샴푸 500ml`,
      top_copy: `${trustBase} — 프리미엄 가격을 유지하되 왜 더 믿을 수 있는지 한 번에 이해되는 전략입니다.`,
      price_krw: clamp(Math.round(Math.max(currentStrategy.price_krw, maxCompetitor + 1000)), lowBound, highBound),
      rationale: '프리미엄 포지션을 유지하면서 메시지 명확도를 높이는 전략',
    },
  ];
}

export async function generateCandidateStrategies({ currentStrategy, ourProduct, competitors, runConfig, iteration, client }) {
  const promptTemplate = await fs.readFile(PROMPT_PATH, 'utf8');
  const lowerBound = Math.round(currentStrategy.price_krw * (1 + runConfig.price_change_percent_min));
  const upperBound = Math.round(currentStrategy.price_krw * (1 + runConfig.price_change_percent_max));
  const fallback = async () => ({
    strategies: buildFallbackStrategies({ currentStrategy, ourProduct, competitors, runConfig, iteration }),
  });

  const { data } = await client.generateJson({
    model: runConfig.strategy_model,
    schema: STRATEGY_CANDIDATES_SCHEMA,
    system: promptTemplate,
    user: JSON.stringify({
      iteration,
      current_strategy: currentStrategy,
      our_product: {
        brand_name: ourProduct.brand_name,
        category: ourProduct.category,
        core_promise: ourProduct.core_promise,
        tone_keywords: ourProduct.tone_keywords,
        avoid_tone: ourProduct.avoid_tone,
      },
      competitors: competitors.competitors.map(({ product_id, product_name, price_krw, positioning, top_copy_hint }) => ({ product_id, product_name, price_krw, positioning, top_copy_hint })),
      constraints: {
        lower_price_bound: lowerBound,
        upper_price_bound: upperBound,
        mutable_fields: ['title', 'top_copy', 'price_krw'],
      },
    }, null, 2),
    fallback,
  });

  const payload = assertStrategyCandidatesPayload(data);
  return payload.strategies.map((strategy, index) => ({
    ...strategy,
    id: strategy.id || `iter-${iteration}-candidate-${index + 1}`,
    price_krw: clamp(Math.round(Number(strategy.price_krw)), lowerBound, upperBound),
  }));
}
