import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtureBundle } from './lib/fixtures.mjs';
import { runSimulation } from './lib/simulation/engine.mjs';
import { formatSimulationEvent } from './lib/sse/stream-formatter.mjs';
import { ARCHETYPES } from './lib/simulation/archetypes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, 'app');
const FIXTURE_DIR = path.resolve(__dirname, '../fixtures');

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function serveStatic(res, filename, contentType) {
  const file = await fs.readFile(path.join(APP_DIR, filename), 'utf8');
  res.writeHead(200, { 'content-type': contentType });
  res.end(file);
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') {
        await serveStatic(res, 'dashboard.html', 'text/html; charset=utf-8');
        return;
      }
      if (req.method === 'GET' && req.url === '/dashboard.js') {
        await serveStatic(res, 'dashboard.js', 'application/javascript; charset=utf-8');
        return;
      }
      if (req.method === 'GET' && req.url === '/styles.css') {
        await serveStatic(res, 'styles.css', 'text/css; charset=utf-8');
        return;
      }
      if (req.method === 'GET' && req.url === '/particle-engine.mjs') {
        await serveStatic(res, 'particle-engine.mjs', 'application/javascript; charset=utf-8');
        return;
      }
      if (req.method === 'GET' && req.url === '/api/fixtures') {
        const bundle = await loadFixtureBundle(FIXTURE_DIR);
        json(res, 200, {
          product: {
            product_name: bundle.ourProduct.product_name,
            brand_name: bundle.ourProduct.brand_name,
            current_title: bundle.ourProduct.current_title,
            current_top_copy: bundle.ourProduct.current_top_copy,
            current_price_krw: bundle.ourProduct.current_price_krw,
            current_cost_krw: bundle.ourProduct.current_cost_krw,
          },
          competitors: bundle.competitors.competitors.map((item) => ({
            id: item.product_id,
            brand_name: item.brand_name,
            product_name: item.product_name,
            price_krw: item.price_krw,
          })),
          archetypes: ARCHETYPES.map((item) => ({
            id: item.id,
            label: item.label,
            cohort_weight_percent: item.cohort_weight_percent,
          })),
          defaults: {
            iteration_count: bundle.runConfig.default_iteration_count,
            minimum_margin_floor: bundle.runConfig.default_minimum_margin_floor,
          },
        });
        return;
      }
      if (req.method === 'POST' && req.url === '/api/run') {
        const body = await parseBody(req);
        const overrides = {};
        if (body.title !== undefined) overrides.title = body.title;
        if (body.topCopy !== undefined) overrides.topCopy = body.topCopy;
        if (body.priceKrw !== undefined) overrides.priceKrw = Number(body.priceKrw);
        if (body.costKrw !== undefined) overrides.costKrw = Number(body.costKrw);
        const archetypeCounts = (body.archetypeCounts && typeof body.archetypeCounts === 'object')
          ? body.archetypeCounts : undefined;
        const result = await runSimulation({
          fixtureDir: FIXTURE_DIR,
          iterationCount: body.iterationCount,
          minimumMarginFloor: body.minimumMarginFloor,
          overrides,
          archetypeCounts,
        });
        json(res, 200, result);
        return;
      }
      if (req.method === 'POST' && req.url === '/api/run/stream') {
        const body = await parseBody(req);
        const overrides = {};
        if (body.title !== undefined) overrides.title = body.title;
        if (body.topCopy !== undefined) overrides.topCopy = body.topCopy;
        if (body.priceKrw !== undefined) overrides.priceKrw = Number(body.priceKrw);
        if (body.costKrw !== undefined) overrides.costKrw = Number(body.costKrw);
        const archetypeCounts = (body.archetypeCounts && typeof body.archetypeCounts === 'object')
          ? body.archetypeCounts : undefined;

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        // TCP Nagle 알고리즘 비활성화 — 작은 패킷도 즉시 전송
        res.socket?.setNoDelay(true);

        try {
          await runSimulation({
            fixtureDir: FIXTURE_DIR,
            iterationCount: body.iterationCount,
            minimumMarginFloor: body.minimumMarginFloor,
            overrides,
            archetypeCounts,
            onEvent: async (event) => {
              // Use stream-formatter to normalise and enrich events before SSE emission.
              res.write(formatSimulationEvent(event));
              // 즉시 flush: cork/uncork 패턴으로 강제 전송
              res.uncork?.();
              if (event.type === 'simulation_complete') {
                res.end();
              }
            },
          });
        } catch (error) {
          res.write(formatSimulationEvent({ type: 'error', message: error.message, recoverable: false }));
          res.end();
        }
        return;
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3001);
  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`Seller War Game listening on http://127.0.0.1:${port}`);
  });
}
