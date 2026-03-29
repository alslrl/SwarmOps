/**
 * Sub-AC 2c: Verify end-to-end that POST /api/run with priceKrw=19900 returns a
 * different baseline revenue than the default fixture price (29900 KRW).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Force mock mode so the test works without an OpenAI API key
process.env.SELLER_WAR_GAME_MODEL_MODE = 'mock';

const { createServer } = await import('../src/server.mjs');

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
    server.once('error', reject);
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function postRun(port, body) {
  const response = await fetch(`http://127.0.0.1:${port}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, `POST /api/run returned status ${response.status}`);
  return response.json();
}

test('POST /api/run with priceKrw=19900 returns different baseline revenue than default fixture price', async () => {
  const { server, port } = await startServer();

  try {
    // Default run — uses fixture price of 29900 KRW
    const defaultResult = await postRun(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
    });

    // Override run — price forced to 19900 KRW
    const overrideResult = await postRun(port, {
      iterationCount: 1,
      minimumMarginFloor: 0.35,
      priceKrw: 19900,
    });

    // Verify the baseline price fields
    assert.strictEqual(
      defaultResult.baseline.price_krw,
      29900,
      `default baseline.price_krw should be 29900 (fixture value), got ${defaultResult.baseline.price_krw}`
    );
    assert.strictEqual(
      overrideResult.baseline.price_krw,
      19900,
      `overridden baseline.price_krw should be 19900, got ${overrideResult.baseline.price_krw}`
    );

    // Verify baseline revenues differ — they must differ because:
    // simulated_revenue = buyers_choosing_our_product * price_krw
    // At a minimum, the price multiplier 19900 ≠ 29900 produces different revenue.
    const defaultRevenue = defaultResult.baseline.simulated_revenue;
    const overrideRevenue = overrideResult.baseline.simulated_revenue;

    assert.notStrictEqual(
      overrideRevenue,
      defaultRevenue,
      `baseline revenue with priceKrw=19900 (${overrideRevenue}) must differ from default price revenue (${defaultRevenue})`
    );

    // Sanity: both revenues are non-negative integers
    assert.ok(defaultRevenue >= 0, `default revenue should be >= 0, got ${defaultRevenue}`);
    assert.ok(overrideRevenue >= 0, `override revenue should be >= 0, got ${overrideRevenue}`);
    assert.strictEqual(
      Math.floor(defaultRevenue),
      defaultRevenue,
      'default revenue should be an integer (KRW)'
    );
    assert.strictEqual(
      Math.floor(overrideRevenue),
      overrideRevenue,
      'override revenue should be an integer (KRW)'
    );
  } finally {
    await stopServer(server);
  }
});
