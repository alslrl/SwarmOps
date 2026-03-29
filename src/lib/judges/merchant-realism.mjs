import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REALISM_JUDGE_SCHEMA, assertRealismJudgePayload } from '../openai/schemas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.resolve(__dirname, '../prompts/merchant-realism-judge.md');

function localIssues(candidate) {
  const issues = [];
  const combined = `${candidate.title} ${candidate.top_copy}`;
  if (/최저가|무조건|완치|100%|기적/i.test(combined)) issues.push('Contains spammy or overclaiming language');
  if ((candidate.title.match(/[!]/g) ?? []).length > 1) issues.push('Title is too sensational');
  if (candidate.title.length < 8 || candidate.top_copy.length < 16) issues.push('Copy is too thin to be credible');
  if (candidate.top_copy.includes('병원') && candidate.top_copy.includes('보장')) issues.push('Copy implies medical certainty too strongly');
  return issues;
}

export async function judgeMerchantRealism({ candidate, ourProduct, runConfig, client }) {
  const promptTemplate = await fs.readFile(PROMPT_PATH, 'utf8');
  const local = localIssues(candidate);
  if (local.length > 0) {
    return assertRealismJudgePayload({
      verdict: 'fail',
      score: 0.1,
      issues: local,
      summary: 'Rejected by local realism heuristics',
    });
  }

  const fallback = async () => ({
    verdict: 'pass',
    score: 0.78,
    issues: [],
    summary: `Heuristic pass for ${ourProduct.core_promise}`,
  });

  const { data } = await client.generateJson({
    model: runConfig.realism_judge_model,
    schema: REALISM_JUDGE_SCHEMA,
    system: promptTemplate,
    user: JSON.stringify({ candidate, our_product: ourProduct }, null, 2),
    fallback,
  });

  return assertRealismJudgePayload(data);
}
