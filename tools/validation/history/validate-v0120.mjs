import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { containsZoomExpression, scaleMapLibreTextSize } from '../client/src/lib/mapStyleExpressions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const rootPackage = JSON.parse(read('package.json'));
const clientPackage = JSON.parse(read('client/package.json'));
const serverPackage = JSON.parse(read('server/package.json'));
const routes = read('server/routes/api.routes.mjs');
const map = read('client/src/components/OrbitalMap.jsx');
const layer = read('client/src/components/AstrisOrbitalLayer.js');

assert.equal(rootPackage.version, '0.1.20');
assert.equal(clientPackage.version, '0.1.20');
assert.equal(serverPackage.version, '0.1.20');
assert.equal(rootPackage.scripts['check:map-parity'], 'node tools/validate-v0120.mjs');
assert.ok(routes.includes("version: '0.1.20'"));

// Globe camera safety.
assert.ok(map.includes('aroundCenter: false'));
assert.ok(map.includes("scrollZoom: initial.globe ? { around: 'center' } : true"));
assert.ok(map.includes("touchZoomRotate: initial.globe ? { around: 'center' } : true"));
assert.ok(map.includes('installGlobeSafeEase(map)'));
assert.ok(map.includes("projection === 'globe' && options && Object.prototype.hasOwnProperty.call(options, 'around')"));
assert.ok(map.includes('antialias: false'));
assert.ok(map.includes("powerPreference: 'high-performance'"));
assert.ok(!map.includes('nativeRef.current?.updateClock?.(nowMs);\n          try { map.triggerRepaint();'));

// GPU streaming: ring-buffered VBOs and no synchronous per-frame GL state queries.
assert.ok(layer.includes('const GPU_BUFFER_RING_SIZE = 4'));
assert.ok(layer.includes('gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices)'));
assert.ok(layer.includes('gl.STREAM_DRAW'));
assert.ok(layer.includes('activeGeometrySlot'));
assert.ok(!layer.includes('gl.getParameter(gl.DEPTH_WRITEMASK)'));
assert.ok(!layer.includes('gl.getParameter(gl.CURRENT_PROGRAM)'));
assert.ok(layer.includes('outColor = vec4(color.rgb * color.a, color.a);'));

// Preserve v0.1.19 label-expression correctness.
const interpolate = ['interpolate', ['linear'], ['zoom'], 0, 10, 4, 14, 8, 20];
const scaledInterpolate = scaleMapLibreTextSize(interpolate, 1.12);
assert.deepEqual(scaledInterpolate.slice(0, 4), ['interpolate', ['linear'], ['zoom'], 0]);
assert.equal(containsZoomExpression(scaledInterpolate), true);

console.log('ASTRIS v0.1.20 validation: PASS');
console.log('  - globe around-easing guard + center-anchored gestures');
console.log('  - high-performance non-MSAA WebGL context');
console.log('  - 4-way streamed GPU VBO ring');
console.log('  - no synchronous custom-layer GL state readback');
console.log('  - premultiplied-alpha custom rendering');
console.log('  - v0.1.19 label-expression fix retained');
