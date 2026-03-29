import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { loadFixtureBundle } from '../src/lib/fixtures.mjs';
import { createServer } from '../src/server.mjs';

const fixtureDir = path.resolve(process.cwd(), 'fixtures');

test('fixture bundle loads shampoo demo inputs', async () => {
  const bundle = await loadFixtureBundle(fixtureDir);
  assert.equal(bundle.ourProduct.product_name, '트리클리닉 엑스퍼트 스칼프 탈모 샴푸');
  assert.equal(bundle.competitors.competitors.length, 3);
  assert.equal(bundle.personas.archetypes.length, 8);
  assert.equal(bundle.runConfig.default_iteration_count, 5);
});

test('GET /api/fixtures returns full product schema per PRD §14.4', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const data = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/fixtures`, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
        });
        res.on('error', reject);
      }).on('error', reject);
    });

    // product object — all 6 fields required by PRD §14.4
    assert.ok(data.product, 'response must have product object');
    assert.equal(typeof data.product.product_name, 'string', 'product.product_name must be string');
    assert.ok(data.product.product_name.length > 0, 'product.product_name must not be empty');
    assert.equal(typeof data.product.brand_name, 'string', 'product.brand_name must be string');
    assert.ok(data.product.brand_name.length > 0, 'product.brand_name must not be empty');
    assert.equal(typeof data.product.current_title, 'string', 'product.current_title must be string');
    assert.ok(data.product.current_title.length > 0, 'product.current_title must not be empty');
    assert.equal(typeof data.product.current_top_copy, 'string', 'product.current_top_copy must be string');
    assert.ok(data.product.current_top_copy.length > 0, 'product.current_top_copy must not be empty');
    assert.equal(typeof data.product.current_price_krw, 'number', 'product.current_price_krw must be number');
    assert.ok(Number.isInteger(data.product.current_price_krw), 'product.current_price_krw must be integer (KRW)');
    assert.ok(data.product.current_price_krw > 0, 'product.current_price_krw must be positive');
    assert.equal(typeof data.product.current_cost_krw, 'number', 'product.current_cost_krw must be number');
    assert.ok(Number.isInteger(data.product.current_cost_krw), 'product.current_cost_krw must be integer (KRW)');
    assert.ok(data.product.current_cost_krw > 0, 'product.current_cost_krw must be positive');

    // competitors array — 3 items with id, product_name, price_krw
    assert.ok(Array.isArray(data.competitors), 'response must have competitors array');
    assert.equal(data.competitors.length, 3, 'competitors must have exactly 3 items');
    for (const c of data.competitors) {
      assert.equal(typeof c.id, 'string', 'competitor.id must be string');
      assert.equal(typeof c.product_name, 'string', 'competitor.product_name must be string');
      assert.equal(typeof c.price_krw, 'number', 'competitor.price_krw must be number');
      assert.ok(Number.isInteger(c.price_krw), 'competitor.price_krw must be integer (KRW)');
      assert.ok(c.price_krw > 0, 'competitor.price_krw must be positive');
    }

    // archetypes array — 8 items with id, label, cohort_weight_percent
    assert.ok(Array.isArray(data.archetypes), 'response must have archetypes array');
    assert.equal(data.archetypes.length, 8, 'archetypes must have exactly 8 items');
    const totalWeight = data.archetypes.reduce((sum, a) => sum + a.cohort_weight_percent, 0);
    assert.equal(totalWeight, 100, 'archetype cohort_weight_percent must sum to 100');
    for (const a of data.archetypes) {
      assert.equal(typeof a.id, 'string', 'archetype.id must be string');
      assert.equal(typeof a.label, 'string', 'archetype.label must be string');
      assert.equal(typeof a.cohort_weight_percent, 'number', 'archetype.cohort_weight_percent must be number');
    }

    // defaults object
    assert.ok(data.defaults, 'response must have defaults object');
    assert.equal(typeof data.defaults.iteration_count, 'number', 'defaults.iteration_count must be number');
    assert.ok(data.defaults.iteration_count > 0, 'defaults.iteration_count must be positive');
    assert.equal(typeof data.defaults.minimum_margin_floor, 'number', 'defaults.minimum_margin_floor must be number');
    assert.ok(data.defaults.minimum_margin_floor > 0, 'defaults.minimum_margin_floor must be positive');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
