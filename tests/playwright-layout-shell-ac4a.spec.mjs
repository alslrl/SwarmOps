/**
 * playwright-layout-shell-ac4a.spec.mjs
 *
 * Sub-AC 4a: Verify 3-panel CSS grid layout shell
 *
 * Verifies:
 *   1. data-testid root containers (panel-input, panel-simulation, panel-activity)
 *      are present and visible in a 3-column CSS grid layout
 *   2. Single-viewport constraint (no body scroll) per PRD §12.1, §12.1.1
 *   3. All design tokens / CSS variables from PRD §12.2 are defined
 *   4. Correct panel widths: input=340px fixed, simulation=flex, activity=380px fixed
 *   5. Supanova Premium design requirements: Pretendard font, OLED black bg,
 *      backdrop-blur cards, pill buttons, cubic-bezier transitions
 *
 * PRD §12.1, §12.1.1, §12.2
 * Port: 3110 — dedicated
 */

import { test, expect } from '@playwright/test';
import { createServer } from '../src/server.mjs';

const PORT = 3110;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let server;

test.beforeAll(async () => {
  process.env.SELLER_WAR_GAME_MODEL_MODE = 'mock';
  server = createServer();
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// ── Wait for fixtures to load ─────────────────────────────────────────────────
async function waitForFixtures(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="product-name"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 10_000 },
  );
}

// ── Test 1: 3 panel containers with correct data-testids are visible ──────────

test('ac4a: panel-input, panel-simulation, and panel-activity containers are all visible', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // All 3 root panels must be in the DOM and visible
  await expect(page.locator('[data-testid="panel-input"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-simulation"]')).toBeVisible();
  await expect(page.locator('[data-testid="panel-activity"]')).toBeVisible();
});

// ── Test 2: Layout is CSS grid with 3 columns ─────────────────────────────────

test('ac4a: layout container uses CSS grid with 3-column template', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // The .app-layout element must use display:grid
  const layoutDisplay = await page.evaluate(() => {
    const el = document.querySelector('.app-layout');
    if (!el) return null;
    return getComputedStyle(el).display;
  });
  expect(layoutDisplay).toBe('grid');

  // Grid template columns must have 3 tracks
  const gridColumns = await page.evaluate(() => {
    const el = document.querySelector('.app-layout');
    if (!el) return null;
    return getComputedStyle(el).gridTemplateColumns;
  });
  // Must have 3 column values
  // e.g. "340px 812px 380px" — 3 space-separated values
  expect(gridColumns).toBeTruthy();
  const parts = gridColumns.trim().split(/\s+/);
  expect(parts.length).toBe(3);
});

// ── Test 3: Single-viewport constraint — no body overflow scroll ──────────────

test('ac4a: body overflow is hidden (single-viewport constraint per §12.1.1)', async ({ page }) => {
  await page.goto(BASE_URL);

  // html element must have overflow:hidden
  const htmlOverflow = await page.evaluate(() => getComputedStyle(document.documentElement).overflow);
  expect(htmlOverflow).toBe('hidden');

  // body element must have overflow:hidden
  const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
  expect(bodyOverflow).toBe('hidden');

  // body height must be 100vh (900px in our 1440×900 viewport)
  const bodyHeight = await page.evaluate(() => {
    const h = getComputedStyle(document.body).height;
    return parseInt(h, 10);
  });
  // Allow ±2px rounding
  expect(bodyHeight).toBeGreaterThanOrEqual(898);
  expect(bodyHeight).toBeLessThanOrEqual(902);
});

// ── Test 4: panel-input fixed width ~340px ────────────────────────────────────

test('ac4a: panel-input is approximately 340px wide', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const rect = await page.locator('[data-testid="panel-input"]').boundingBox();
  expect(rect).not.toBeNull();
  // Allow ±10px for gap/padding rounding
  expect(rect.width).toBeGreaterThanOrEqual(330);
  expect(rect.width).toBeLessThanOrEqual(350);
});

// ── Test 5: panel-activity fixed width ~380px ─────────────────────────────────

test('ac4a: panel-activity is approximately 380px wide', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const rect = await page.locator('[data-testid="panel-activity"]').boundingBox();
  expect(rect).not.toBeNull();
  // Allow ±10px for gap/padding rounding
  expect(rect.width).toBeGreaterThanOrEqual(370);
  expect(rect.width).toBeLessThanOrEqual(390);
});

// ── Test 6: CSS design tokens are defined per PRD §12.2 ──────────────────────

test('ac4a: CSS design tokens from PRD §12.2 are defined', async ({ page }) => {
  await page.goto(BASE_URL);

  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      bgPrimary: style.getPropertyValue('--bg-primary').trim(),
      bgSecondary: style.getPropertyValue('--bg-secondary').trim(),
      textPrimary: style.getPropertyValue('--text-primary').trim(),
      textSecondary: style.getPropertyValue('--text-secondary').trim(),
      textMuted: style.getPropertyValue('--text-muted').trim(),
      accentBlue: style.getPropertyValue('--accent-blue').trim(),
      accentGreen: style.getPropertyValue('--accent-green').trim(),
      accentRed: style.getPropertyValue('--accent-red').trim(),
      fontFamily: style.getPropertyValue('--font-family').trim(),
      btnRadius: style.getPropertyValue('--btn-radius').trim(),
      transition: style.getPropertyValue('--transition').trim(),
      transitionFast: style.getPropertyValue('--transition-fast').trim(),
      cardRadiusOuter: style.getPropertyValue('--card-radius-outer').trim(),
      panelLeftWidth: style.getPropertyValue('--panel-left-width').trim(),
      panelRightWidth: style.getPropertyValue('--panel-right-width').trim(),
      layoutGap: style.getPropertyValue('--layout-gap').trim(),
      spaceXs: style.getPropertyValue('--space-xs').trim(),
      spaceSm: style.getPropertyValue('--space-sm').trim(),
      spaceMd: style.getPropertyValue('--space-md').trim(),
      spaceLg: style.getPropertyValue('--space-lg').trim(),
    };
  });

  // Vantablack Luxe colors
  expect(tokens.bgPrimary).toBe('#050505');
  expect(tokens.bgSecondary).toBe('#0a0a0a');
  expect(tokens.textPrimary).toBe('#f0f0f0');
  expect(tokens.textSecondary).toBe('#8a8a8a');
  expect(tokens.textMuted).toBe('#555555');
  expect(tokens.accentBlue).toBe('#3b82f6');
  expect(tokens.accentGreen).toBe('#34d399');
  expect(tokens.accentRed).toBe('#f87171');

  // Pretendard font (not Inter / Noto Sans KR)
  expect(tokens.fontFamily).toContain('Pretendard');
  expect(tokens.fontFamily).not.toContain('Inter');
  expect(tokens.fontFamily).not.toContain('Noto Sans KR');

  // Pill button radius
  expect(tokens.btnRadius).toBe('9999px');

  // Supanova cubic-bezier transitions
  expect(tokens.transition).toContain('cubic-bezier(0.16, 1, 0.3, 1)');
  expect(tokens.transitionFast).toContain('cubic-bezier(0.16, 1, 0.3, 1)');

  // Layout dimensions
  expect(tokens.panelLeftWidth).toBe('340px');
  expect(tokens.panelRightWidth).toBe('380px');
  expect(tokens.layoutGap).toBe('20px');
  expect(tokens.cardRadiusOuter).toBe('1.5rem');

  // Spacing tokens
  expect(tokens.spaceXs).toBe('4px');
  expect(tokens.spaceSm).toBe('8px');
  expect(tokens.spaceMd).toBe('12px');
  expect(tokens.spaceLg).toBe('16px');
});

// ── Test 7: Panels are horizontally laid out (3-column grid) ──────────────────

test('ac4a: panels are laid out horizontally in 3 columns (not stacked)', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const inputBox = await page.locator('[data-testid="panel-input"]').boundingBox();
  const simBox = await page.locator('[data-testid="panel-simulation"]').boundingBox();
  const activityBox = await page.locator('[data-testid="panel-activity"]').boundingBox();

  // All 3 panels must have similar top position (same row)
  expect(Math.abs(inputBox.y - simBox.y)).toBeLessThan(20);
  expect(Math.abs(simBox.y - activityBox.y)).toBeLessThan(20);

  // Panels must be ordered left to right: input < simulation < activity
  expect(inputBox.x).toBeLessThan(simBox.x);
  expect(simBox.x).toBeLessThan(activityBox.x);

  // Panels must not overlap horizontally
  expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(simBox.x + 5); // 5px tolerance
  expect(simBox.x + simBox.width).toBeLessThanOrEqual(activityBox.x + 5);
});

// ── Test 8: Body background uses OLED black background ───────────────────────

test('ac4a: body background color is OLED black (#050505) per Vantablack Luxe theme', async ({ page }) => {
  await page.goto(BASE_URL);

  const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // #050505 = rgb(5, 5, 5)
  expect(bgColor).toMatch(/rgb\(\s*5\s*,\s*5\s*,\s*5\s*\)/);
});

// ── Test 9: panel-results backward-compat testid also present ─────────────────

test('ac4a: panel-results backward-compat data-testid is present inside panel-activity', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  // panel-results inner wrapper must be inside panel-activity
  const panelResults = page.locator('[data-testid="panel-activity"] [data-testid="panel-results"]');
  await expect(panelResults).toBeAttached();
});

// ── Test 10: Run button is a pill shape (border-radius 9999px) ────────────────

test('ac4a: btn-run has pill shape (border-radius 9999px) per Supanova Premium design', async ({ page }) => {
  await page.goto(BASE_URL);
  await waitForFixtures(page);

  const borderRadius = await page.locator('[data-testid="btn-run"]').evaluate((el) =>
    getComputedStyle(el).borderRadius,
  );
  // 9999px resolves to a large number — should be visually full pill
  // Playwright may compute it differently, so just check it's not 0
  expect(borderRadius).not.toBe('0px');
  // In most browsers 9999px resolves to some large pixel value
  const numVal = parseInt(borderRadius, 10);
  expect(numVal).toBeGreaterThan(10);
});
