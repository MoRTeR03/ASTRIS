import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { containsZoomExpression, scaleMapLibreTextSize } from '../client/src/lib/mapStyleExpressions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

const orbitalMap = read('client/src/components/OrbitalMap.jsx');
const viteConfig = read('client/vite.config.js');
const serverIndex = read('server/index.mjs');
const routes = read('server/routes/api.routes.mjs');
const rootPackage = JSON.parse(read('package.json'));

assert.match(rootPackage.version, /^0\.1\.19$/);
assert.equal(rootPackage.scripts['check:map-parity'], 'node tools/validate-v0119.mjs');

assert.ok(orbitalMap.includes("scaleMapLibreTextSize(original.textSize, scale)"));
assert.ok(!orbitalMap.includes("['*', original.textSize, scale]"));
assert.ok(orbitalMap.includes('labelAppliedRef.current'));

assert.ok(viteConfig.includes("ASTRIS_CLIENT_PORT || 5174"));
assert.ok(viteConfig.includes("ASTRIS_PORT || 3101"));
assert.ok(viteConfig.includes('strictPort: true'));
assert.ok(viteConfig.includes("'/api'"));

assert.ok(serverIndex.includes("ASTRIS_PORT || 3101"));
assert.ok(serverIndex.includes("EADDRINUSE"));
assert.ok(routes.includes("version: '0.1.19'"));

const interpolate = ['interpolate', ['linear'], ['zoom'], 0, 10, 4, 14, 8, 20];
const scaledInterpolate = scaleMapLibreTextSize(interpolate, 1.12);
assert.deepEqual(scaledInterpolate.slice(0, 4), ['interpolate', ['linear'], ['zoom'], 0]);
assert.ok(Math.abs(scaledInterpolate[4] - 11.2) < 1e-9);
assert.ok(Math.abs(scaledInterpolate[6] - 15.68) < 1e-9);
assert.ok(Math.abs(scaledInterpolate[8] - 22.4) < 1e-9);
assert.equal(containsZoomExpression(scaledInterpolate), true);
assert.equal(containsZoomExpression(scaledInterpolate[4]), false);

const step = ['step', ['zoom'], 10, 5, 14, 9, 18];
const scaledStep = scaleMapLibreTextSize(step, 1.5);
assert.deepEqual(scaledStep, ['step', ['zoom'], 15, 5, 21, 9, 27]);

const dataOnly = ['interpolate', ['linear'], ['get', 'rank'], 0, 10, 10, 20];
const scaledDataOnly = scaleMapLibreTextSize(dataOnly, 1.2);
assert.deepEqual(scaledDataOnly, ['*', dataOnly, 1.2]);

const unknownZoomShape = ['case', ['>', ['zoom'], 4], 18, 12];
const safeFallback = scaleMapLibreTextSize(unknownZoomShape, 1.2);
assert.deepEqual(safeFallback, unknownZoomShape);

console.log('ASTRIS v0.1.19 validation: PASS');
console.log('  - dedicated client/API ports');
console.log('  - strict Vite port binding');
console.log('  - MapLibre zoom expression scaling preserved at top level');
console.log('  - repeated label writes deduplicated');
