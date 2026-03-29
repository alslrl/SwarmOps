import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

function parseEnvContent(raw) {
  const output = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    output[key] = value;
  }
  return output;
}

function candidateEnvPaths(startDir) {
  const paths = [];
  let current = startDir;
  while (true) {
    paths.push(path.join(current, '.env'));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return paths;
}

export async function loadLocalEnv(envPath = path.resolve(process.cwd(), '.env')) {
  const candidates = [envPath, ...candidateEnvPaths(process.cwd())];
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      const vars = parseEnvContent(raw);
      for (const [key, value] of Object.entries(vars)) {
        if (!process.env[key]) process.env[key] = value;
      }
      return vars;
    } catch {
      // keep scanning upward
    }
  }
  return {};
}

function stableHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function defaultCacheDir() {
  return path.resolve(process.cwd(), '.cache');
}

function extractText(responseJson) {
  if (typeof responseJson.output_text === 'string' && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }
  const maybeText = responseJson.output?.flatMap((item) => item.content ?? [])?.find((content) => typeof content.text === 'string');
  if (maybeText?.text) return maybeText.text.trim();
  throw new Error('OpenAI response did not contain parsable text output');
}

export class OpenAIClient {
  constructor({ apiKey = process.env.OPENAI_API_KEY, fetchImpl = globalThis.fetch, cacheDir = defaultCacheDir(), mode = process.env.SELLER_WAR_GAME_MODEL_MODE ?? 'live' } = {}) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.cacheDir = cacheDir;
    this.mode = mode;
  }

  async generateJson({ model, system, user, schema, temperature = 0.2, fallback }) {
    const cacheInput = { model, system, user, schema };
    const cacheKey = stableHash(cacheInput);
    const cachePath = path.join(this.cacheDir, `${cacheKey}.json`);

    try {
      const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
      return { data: cached.data, source: 'cache' };
    } catch {
      // no-op
    }

    if (this.mode !== 'live' || !this.apiKey || !this.fetchImpl) {
      if (fallback) return { data: await fallback(), source: 'fallback' };
      throw new Error('OpenAI client unavailable and no fallback provided');
    }

    const body = {
      model,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: system }]
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: user }]
        }
      ],
      temperature,
      text: {
        format: {
          type: 'json_schema',
          name: schema.name,
          strict: true,
          schema: schema.schema
        }
      }
    };

    try {
      const response = await this.fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
      }

      const json = await response.json();
      const text = extractText(json);
      const data = JSON.parse(text);
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify({ data, meta: { model, cached_at: new Date().toISOString() } }, null, 2));
      return { data, source: 'live' };
    } catch (error) {
      if (fallback) {
        return { data: await fallback(error), source: 'fallback' };
      }
      throw error;
    }
  }
}
