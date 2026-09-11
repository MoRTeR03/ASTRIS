import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
const add = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const app = read('client/src/App.jsx');
const widget = read('client/src/components/AstrisMapWidget.jsx');
const map = read('client/src/components/OrbitalMap.jsx');
const layer = read('client/src/components/AstrisOrbitalLayer.js');
const css = read('client/src/map-parity.css');
const pkg = JSON.parse(read('package.json'));
const clientPkg = JSON.parse(read('client/package.json'));
const serverPkg = JSON.parse(read('server/package.json'));
const api = read('server/routes/api.routes.mjs');

add('root version 0.1.10', pkg.version === '0.1.10');
add('client version 0.1.10', clientPkg.version === '0.1.10');
add('server version 0.1.10', serverPkg.version === '0.1.10');
add('health version 0.1.10', api.includes("version: '0.1.10'"));
add('native compact attribution restored', map.includes("new maplibregl.AttributionControl({ compact: true })"));
add('native attribution in bottom-left', map.includes("AttributionControl({ compact: true }), 'bottom-left'"));
add('custom map-info popover removed from widget', !widget.includes('mapInfoOpen') && !widget.includes('astris-map-native-info-popover'));
add('same-satellite click toggles selection off', app.includes("String(currentId) === nextId ? '' : nextId"));
add('3D detail buttons receive OLED styling', css.includes('.astris-map-building-detail-mode button'));
add('observer marker reset receives OLED styling', css.includes('.astris-map-marker-control-head button'));
add('globe labels use constellation color token', css.includes('color: var(--orbital-fill);'));
add('viewport DOM marker budget retained', layer.includes('const MAX_DOM_MARKERS = 360;'));
add('viewport label budget added', layer.includes('const MAX_VIEWPORT_LABELS = 180;'));
add('viewport shortlist function added', layer.includes('function refreshViewportMarkerRows(args, matrix)'));
add('viewport selection uses exact projection clip', layer.includes('multiplyMat4Vec4(matrix'));
add('viewport selection includes globe occlusion', layer.includes('globeOcclusionFrame(map, args, matrix)'));
add('viewport shortlist refreshed after gesture', layer.includes('viewportSelectionDirty = true;'));
add('client-side constellation filter invalidates globe marker buffer', layer.includes('rowsChanged || nextDynamicStateKey'));
add('2D interaction rows are viewport-aware', map.includes('interactiveRowsIn2dViewport'));
add('2D viewport shortlist refreshes after camera move', map.includes('refresh2dInteractiveRows(map);'));
add('Node watch keeps console output', serverPkg.scripts?.dev?.includes('--watch-preserve-output'));
add('fullscreen control remains absent', !map.includes('FullscreenControl'));

const failed = checks.filter((c) => !c.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length) process.exit(1);
