import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createCatalogService } from '../src/services/catalog-service.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');
const cacheDir = path.join(serverDir, 'cache');
const reportDir = path.join(serverDir, 'reports');

const service = createCatalogService({ cacheDir });
const observer = { lat: 0, lon: 0, altM: 0 };

const scenarios = [
  { name: 'GNSS global', options: { catalogs: ['GNSS'], mode: 'global', limit: 2000 } },
  { name: 'Starlink global', options: { catalogs: ['STARLINK'], mode: 'global', limit: 20000 } },
  { name: 'Combined global', options: { catalogs: ['GNSS', 'STARLINK'], mode: 'global', limit: 20000 } },
  { name: 'Starlink visible', options: { catalogs: ['STARLINK'], mode: 'visible', observer, horizonDeg: 0, limit: 20000 } },
];

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function runScenario(scenario) {
  const samples = [];
  let lastResult = null;
  for (let run = 0; run < 3; run += 1) {
    const started = performance.now();
    lastResult = await service.scene({ ...scenario.options, at: new Date() });
    const sceneMs = performance.now() - started;

    const serializeStart = performance.now();
    const json = JSON.stringify(lastResult);
    const serializeMs = performance.now() - serializeStart;

    samples.push({
      run: run + 1,
      sceneMs: round(sceneMs),
      serializeMs: round(serializeMs),
      payloadBytes: Buffer.byteLength(json),
      rows: lastResult.rows.length,
      visibleCount: lastResult.visibleCount,
    });
  }

  const average = (key) => samples.reduce((sum, row) => sum + Number(row[key] || 0), 0) / samples.length;
  return {
    name: scenario.name,
    samples,
    summary: {
      averageSceneMs: round(average('sceneMs')),
      averageSerializeMs: round(average('serializeMs')),
      averagePayloadBytes: Math.round(average('payloadBytes')),
      rows: lastResult?.rows?.length ?? 0,
      visibleCount: lastResult?.visibleCount ?? null,
    },
  };
}

const report = {
  schema: 'astris.scene-benchmark.v1',
  product: 'ASTRIS',
  version: '0.2.0',
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  note: 'Catalog downloads are mediated by the normal ASTRIS cache and retain the >=2 hour CelesTrak refresh floor.',
  scenarios: [],
};

for (const scenario of scenarios) {
  process.stdout.write(`Benchmark: ${scenario.name}... `);
  try {
    const result = await runScenario(scenario);
    report.scenarios.push(result);
    console.log(`${result.summary.averageSceneMs} ms avg, ${result.summary.rows} rows`);
  } catch (error) {
    report.scenarios.push({ name: scenario.name, error: error?.message || String(error) });
    console.log(`FAILED: ${error?.message || error}`);
  }
}

await mkdir(reportDir, { recursive: true });
const stamp = report.generatedAt.replace(/[:.]/g, '-');
const output = path.join(reportDir, `scene-benchmark-${stamp}.json`);
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Report: ${output}`);
