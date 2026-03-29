import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE_DIR = path.resolve(__dirname, '../../fixtures');

function splitHeading(line) {
  const match = line.match(/^(#{1,6})\s+(.*)$/);
  if (!match) return null;
  return { level: match[1].length, title: match[2].trim() };
}

function parseScalar(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  return value;
}

function toObjectIfPossible(entries) {
  if (entries.length === 0) return [];
  const keyed = entries.every((entry) => entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, '__key'));
  if (!keyed) {
    return entries.map((entry) => {
      if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'label') && Object.prototype.hasOwnProperty.call(entry, 'value')) {
        return { label: entry.label, value: entry.value };
      }
      return entry;
    });
  }

  const seen = new Set();
  const object = {};
  for (const entry of entries) {
    if (seen.has(entry.__key)) {
      return entries.map(({ __key, value }) => ({ key: __key, value }));
    }
    seen.add(entry.__key);
    object[entry.__key] = entry.value;
  }
  return object;
}

function parseBulletTree(lines) {
  const bullets = [];
  for (const line of lines) {
    const match = line.match(/^(\s*)-\s+(.*)$/);
    if (!match) continue;
    bullets.push({ indent: match[1].length, text: match[2].trim() });
  }

  function parseList(startIndex, currentIndent) {
    const entries = [];
    let index = startIndex;
    while (index < bullets.length && bullets[index].indent === currentIndent) {
      const { text } = bullets[index];
      index += 1;
      const colonIndex = text.indexOf(':');
      const hasKey = colonIndex !== -1;

      if (hasKey) {
        const key = text.slice(0, colonIndex).trim();
        const rawValue = text.slice(colonIndex + 1).trim();
        let value;
        if (rawValue) {
          value = parseScalar(rawValue);
        } else if (index < bullets.length && bullets[index].indent > currentIndent) {
          const [child, nextIndex] = parseList(index, bullets[index].indent);
          value = child;
          index = nextIndex;
        } else {
          value = '';
        }
        entries.push({ __key: key, value });
      } else {
        let value = parseScalar(text);
        if (index < bullets.length && bullets[index].indent > currentIndent) {
          const [child, nextIndex] = parseList(index, bullets[index].indent);
          value = { label: value, value: child };
          index = nextIndex;
        }
        entries.push(value);
      }
    }
    return [toObjectIfPossible(entries), index];
  }

  if (bullets.length === 0) return [];
  return parseList(0, bullets[0].indent)[0];
}

function parseMarkdownSections(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    const heading = splitHeading(line);
    if (heading && heading.level >= 2) {
      if (current) sections.push(current);
      current = { title: heading.title, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }

  if (current) sections.push(current);
  const result = {};
  for (const section of sections) {
    result[section.title] = parseBulletTree(section.lines);
  }
  return result;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeOurProduct(sections) {
  const metadata = sections.Metadata ?? {};
  const identity = sections['Product Identity'] ?? {};
  const current = sections['Current Listing'] ?? {};
  const tone = sections['Brand Tone'] ?? {};
  const strengths = sections['Product Strengths'] ?? [];
  const weaknesses = sections['Product Weaknesses'] ?? [];
  const constraints = sections.Constraints ?? {};
  const notes = sections['Notes for Simulator'] ?? [];

  assert(identity.product_id, 'our-product.md: missing product_id');
  assert(current.current_title, 'our-product.md: missing current_title');
  assert(current.current_top_copy, 'our-product.md: missing current_top_copy');
  assert(Number.isFinite(current.current_price_krw), 'our-product.md: missing current_price_krw');
  assert(Number.isFinite(current.current_cost_krw), 'our-product.md: missing current_cost_krw');

  return {
    ...metadata,
    ...identity,
    ...current,
    tone_keywords: tone.tone_keywords ?? [],
    avoid_tone: tone.avoid_tone ?? [],
    strengths,
    weaknesses,
    mutable_fields: constraints.mutable_fields ?? [],
    immutable_fields: constraints.immutable_fields ?? [],
    min_margin_floor_is_user_input: Boolean(constraints.min_margin_floor_is_user_input),
    notes,
  };
}

function normalizeCompetitors(sections) {
  const metadata = sections.Metadata ?? {};
  const comparisonNotes = sections['Comparison Notes'] ?? [];
  const competitors = Object.entries(sections)
    .filter(([title]) => /^competitor_/i.test(title))
    .map(([, entry]) => {
      assert(entry.product_id, 'competitors.md: competitor missing product_id');
      assert(entry.product_name, 'competitors.md: competitor missing product_name');
      assert(Number.isFinite(entry.price_krw), 'competitors.md: competitor missing price_krw');
      return {
        ...entry,
        strengths: entry.strengths ?? [],
        weaknesses: entry.weaknesses ?? [],
      };
    });

  assert(competitors.length === 3, `competitors.md: expected exactly 3 competitors, got ${competitors.length}`);
  return { metadata, competitors, comparisonNotes };
}

function normalizePersonas(sections) {
  const metadata = sections.Metadata ?? {};
  const shared = sections['Shared fields'] ?? [];
  const archetypes = Object.entries(sections)
    .filter(([title]) => /^archetype_/i.test(title))
    .map(([, entry]) => entry)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  assert(archetypes.length === 8, `buyer-personas.md: expected 8 archetypes, got ${archetypes.length}`);
  const totalWeight = archetypes.reduce((sum, archetype) => sum + Number(archetype.cohort_weight_percent ?? 0), 0);
  assert(totalWeight === 100, `buyer-personas.md: expected cohort_weight_percent to sum to 100, got ${totalWeight}`);

  for (const archetype of archetypes) {
    for (const field of ['id', 'label', 'budget_band', 'price_sensitivity', 'copy_preference', 'trust_sensitivity', 'promo_affinity', 'brand_bias', 'pass_threshold']) {
      assert(archetype[field] !== undefined && archetype[field] !== '', `buyer-personas.md: archetype ${archetype.id ?? '<unknown>'} missing ${field}`);
    }
  }

  return { metadata, shared, archetypes };
}

function normalizeRunConfig(sections) {
  const metadata = sections.Metadata ?? {};
  const runtime = sections['Runtime Defaults'] ?? {};
  const models = sections['Model Defaults'] ?? {};
  const swarm = sections['Swarm Defaults'] ?? {};
  const searchBounds = sections['Search Bounds'] ?? {};
  const objective = sections.Objective ?? {};
  const holdout = sections['Holdout Gate'] ?? {};
  const dashboard = sections['Dashboard Expectations'] ?? {};
  const notes = sections.Notes ?? [];

  assert(Number.isFinite(runtime.default_iteration_count), 'run-config.md: missing default_iteration_count');
  assert(Number.isFinite(runtime.default_minimum_margin_floor), 'run-config.md: missing default_minimum_margin_floor');
  assert(models.strategy_model, 'run-config.md: missing strategy_model');
  assert(models.buyer_evaluator_model, 'run-config.md: missing buyer_evaluator_model');

  return {
    ...metadata,
    ...runtime,
    ...models,
    ...swarm,
    ...searchBounds,
    ...objective,
    ...holdout,
    dashboard,
    notes,
  };
}

export async function loadMarkdownFixture(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return parseMarkdownSections(raw);
}

export async function loadFixtureBundle(rootDir = DEFAULT_FIXTURE_DIR) {
  const [ourSections, competitorsSections, personasSections, runConfigSections] = await Promise.all([
    loadMarkdownFixture(path.join(rootDir, 'our-product.md')),
    loadMarkdownFixture(path.join(rootDir, 'competitors.md')),
    loadMarkdownFixture(path.join(rootDir, 'buyer-personas.md')),
    loadMarkdownFixture(path.join(rootDir, 'run-config.md')),
  ]);

  const ourProduct = normalizeOurProduct(ourSections);
  const competitors = normalizeCompetitors(competitorsSections);
  const personas = normalizePersonas(personasSections);
  const runConfig = normalizeRunConfig(runConfigSections);

  return {
    rootDir,
    ourProduct,
    competitors,
    personas,
    runConfig,
  };
}

export function getDefaultFixtureDir() {
  return DEFAULT_FIXTURE_DIR;
}

export function parseMarkdownFixture(raw) {
  return parseMarkdownSections(raw);
}
