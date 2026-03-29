import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeMerchantRealism } from '../src/lib/judges/merchant-realism.mjs';

const client = { generateJson: async ({ fallback }) => ({ data: await fallback() }) };
const runConfig = { realism_judge_model: 'mock' };
const ourProduct = { core_promise: '전문가 설계 / 두피과학 기반의 신뢰감' };

test('merchant judge rejects spammy copy', async () => {
  const result = await judgeMerchantRealism({ candidate: { title: '최저가 탈모 샴푸!!', top_copy: '100% 완치 기적의 샴푸' }, ourProduct, runConfig, client });
  assert.equal(result.verdict, 'fail');
});

test('merchant judge allows sane copy', async () => {
  const result = await judgeMerchantRealism({ candidate: { title: '전문가 설계 탈모 샴푸', top_copy: '두피과학 기반으로 신뢰감 있게 관리하는 탈모 샴푸' }, ourProduct, runConfig, client });
  assert.equal(result.verdict, 'pass');
});
