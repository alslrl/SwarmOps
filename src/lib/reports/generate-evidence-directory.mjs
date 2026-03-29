/**
 * generate-evidence-directory.mjs
 *
 * Sub-AC 8d: Evidence directory bundler.
 * Copies all captured artifacts (screenshots, logs, test reports) into a
 * structured artifacts/evidence/ directory and writes an index.json manifest.
 *
 * Directory layout produced:
 *   artifacts/evidence/
 *     index.json              ← index manifest (this file lists everything)
 *     screenshots/            ← all .png screenshots
 *       01-initial-load.png
 *       ...
 *     logs/                   ← harness + watchdog logs
 *       ralph-harness-*.log
 *       watchdog.log
 *       sse-audit.txt
 *     reports/                ← JSON + Markdown test / judgment reports
 *       ac-playwright-results.json
 *       artifact-consistency-report.json
 *       latest-run-summary.json
 *       visual_judgment_report.json
 *       visual-judgment-report.md
 *       evidence_bundle.json
 *       sse-network-log-ac8b.json
 *       ac12-3-consistency-evidence.json
 *
 * Run standalone:  node src/lib/reports/generate-evidence-directory.mjs
 * Import:          import { generateEvidenceDirectory } from '.../generate-evidence-directory.mjs'
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '../../..');
const ARTIFACTS  = path.join(ROOT, 'artifacts');
const EVIDENCE   = path.join(ARTIFACTS, 'evidence');
const SCREENS_SRC = path.join(ARTIFACTS, 'screenshots');
const SCREENS_DST = path.join(EVIDENCE, 'screenshots');
const LOGS_DST    = path.join(EVIDENCE, 'logs');
const REPORTS_DST = path.join(EVIDENCE, 'reports');

// ── helpers ────────────────────────────────────────────────────────────────────

async function statFile(p) {
  try {
    const s = await fs.stat(p);
    return { size_bytes: s.size, mtime: s.mtime.toISOString() };
  } catch {
    return null;
  }
}

async function copyIfExists(src, dstDir, dstName) {
  const stat = await statFile(src);
  if (!stat || stat.size_bytes === 0) return null;
  const dst = path.join(dstDir, dstName ?? path.basename(src));
  await fs.copyFile(src, dst);
  return { src: path.relative(ROOT, src), dst: path.relative(ROOT, dst), ...stat };
}

// ── main ───────────────────────────────────────────────────────────────────────

export async function generateEvidenceDirectory() {
  // 1. Create directory tree
  await fs.mkdir(EVIDENCE,     { recursive: true });
  await fs.mkdir(SCREENS_DST,  { recursive: true });
  await fs.mkdir(LOGS_DST,     { recursive: true });
  await fs.mkdir(REPORTS_DST,  { recursive: true });

  // 2. Copy screenshots ───────────────────────────────────────────────────────
  let screenshotFiles;
  try {
    screenshotFiles = (await fs.readdir(SCREENS_SRC)).filter(f => f.endsWith('.png'));
  } catch {
    screenshotFiles = [];
  }
  screenshotFiles.sort();

  const screenshots = await Promise.all(
    screenshotFiles.map(async (fname) => {
      const result = await copyIfExists(path.join(SCREENS_SRC, fname), SCREENS_DST);
      return result ? { filename: fname, ...result } : null;
    })
  );
  const screenshotsCopied = screenshots.filter(Boolean);

  // 3. Copy log files ─────────────────────────────────────────────────────────
  const logCandidates = [
    // Harness logs – discover all matching the pattern
    ...await (async () => {
      try {
        return (await fs.readdir(ROOT))
          .filter(f => /^ralph-harness-.*\.log$/.test(f))
          .map(f => ({ src: path.join(ROOT, f), name: f }));
      } catch { return []; }
    })(),
    { src: path.join(ROOT, 'watchdog.log'),              name: 'watchdog.log' },
    { src: path.join(ARTIFACTS, 'sse-audit.txt'),        name: 'sse-audit.txt' },
  ];

  const logsCopied = [];
  for (const { src, name } of logCandidates) {
    const result = await copyIfExists(src, LOGS_DST, name);
    if (result) logsCopied.push({ filename: name, ...result });
  }

  // 4. Copy report files ──────────────────────────────────────────────────────
  const reportCandidates = [
    'ac-playwright-results.json',
    'artifact-consistency-report.json',
    'latest-run-summary.json',
    'visual_judgment_report.json',
    'visual-judgment-report.md',
    'evidence_bundle.json',
    'sse-network-log-ac8b.json',
    'ac12-3-consistency-evidence.json',
    'consistency_report.json',
    'visual_checks.json',
  ];

  const reportsCopied = [];
  for (const fname of reportCandidates) {
    const result = await copyIfExists(path.join(ARTIFACTS, fname), REPORTS_DST);
    if (result) reportsCopied.push({ filename: fname, ...result });
  }

  // 5. Build index manifest ──────────────────────────────────────────────────
  const manifest = {
    manifest_version: 'v1',
    generated_at: new Date().toISOString(),
    project: 'seller-war-game',
    sub_ac: '8d',
    description: 'Structured evidence directory for the seller-war-game operator dashboard demo. ' +
      'Bundles all captured screenshots, harness/watchdog logs, and test/judgment reports into ' +
      'artifacts/evidence/ with this index.json manifest.',

    directory_layout: {
      root: 'artifacts/evidence/',
      subdirs: {
        screenshots: 'artifacts/evidence/screenshots/',
        logs:        'artifacts/evidence/logs/',
        reports:     'artifacts/evidence/reports/',
      },
    },

    screenshots: {
      directory: 'artifacts/evidence/screenshots/',
      count: screenshotsCopied.length,
      files: screenshotsCopied,
    },

    logs: {
      directory: 'artifacts/evidence/logs/',
      count: logsCopied.length,
      files: logsCopied,
    },

    reports: {
      directory: 'artifacts/evidence/reports/',
      count: reportsCopied.length,
      files: reportsCopied,
    },

    summary: {
      total_files: screenshotsCopied.length + logsCopied.length + reportsCopied.length,
      screenshots: screenshotsCopied.length,
      logs: logsCopied.length,
      reports: reportsCopied.length,
    },

    overall_verdict: (
      screenshotsCopied.length > 0 &&
      logsCopied.length > 0 &&
      reportsCopied.length > 0
    ) ? 'PASS' : 'WARN',
  };

  // 6. Write index manifest ──────────────────────────────────────────────────
  const INDEX_PATH = path.join(EVIDENCE, 'index.json');
  await fs.writeFile(INDEX_PATH, JSON.stringify(manifest, null, 2));

  return manifest;
}

// Run as standalone script
const url        = import.meta.url;
const scriptPath = process.argv[1] ? 'file://' + process.argv[1] : '';
if (url === scriptPath || url.endsWith(path.basename(process.argv[1] ?? ''))) {
  const manifest = await generateEvidenceDirectory();
  console.log(`\nEvidence Directory Generated — ${manifest.overall_verdict}`);
  console.log(`  Screenshots: ${manifest.summary.screenshots}`);
  console.log(`  Logs:        ${manifest.summary.logs}`);
  console.log(`  Reports:     ${manifest.summary.reports}`);
  console.log(`  Total files: ${manifest.summary.total_files}`);
  console.log(`\nDirectory:   artifacts/evidence/`);
  console.log(`Manifest:    artifacts/evidence/index.json`);
  process.exit(manifest.overall_verdict === 'PASS' ? 0 : 1);
}
