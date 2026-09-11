import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const app = read('client/src/App.jsx');
const widget = read('client/src/components/AstrisMapWidget.jsx');
const map = read('client/src/components/OrbitalMap.jsx');
const layer = read('client/src/components/AstrisOrbitalLayer.js');
const settings = read('client/src/map/MapSettingsStore.js');
const cssParity = read('client/src/irmas-map-parity.css');
const cssV15 = read('client/src/astris-map-v015.css');
const main = read('client/src/main.jsx');
const service = read('server/services/catalog-service.mjs');
const pkg = JSON.parse(read('package.json'));
const clientPkg = JSON.parse(read('client/package.json'));
const serverPkg = JSON.parse(read('server/package.json'));

const checks = [];
const check = (name, ok, detail='') => checks.push({ name, ok: Boolean(ok), detail });
check('versions 0.1.5', [pkg.version, clientPkg.version, serverPkg.version].every(v => v === '0.1.5'));
check('persistent full-orbit toggle', widget.includes('Повні орбіти') && settings.includes('tracksRefreshMs') && app.includes('includeTracks'));
check('separate track cache', app.includes('tracksRef') && app.includes('tracksFetchedAtRef') && service.includes('const tracks = []'));
check('client motion interpolation', map.includes('interpolatedSceneRows') && map.includes('requestAnimationFrame(tick)'));
check('movement tuning restored', ['renderFps','interpolationStepMs','smoothingMs','refreshMs','tracksRefreshMs','trackMode','trackMinutes','trackStepMinutes','trackLimit'].every(k => settings.includes(k) && widget.includes(k)));
check('constellation-coloured 2D labels', map.includes("'text-color': ['get', 'color']"));
check('constellation-coloured globe labels', layer.includes("--orbital-fill") && cssV15.includes('var(--orbital-fill'));
check('panel collapse fills map', cssV15.includes('.panel-closed .astris-map-native-workbench') && widget.includes("mapRef.current?.resize?.()"));
check('vector quick-action icons', widget.includes('LocateFixed') && widget.includes('Grid3X3') && widget.includes('Tags') && widget.includes('RefreshCw'));
check('only intended MapLibre controls', map.includes('new maplibregl.NavigationControl') && map.includes('new maplibregl.ScaleControl') && !map.includes('new maplibregl.FullscreenControl') && !map.includes('new maplibregl.AttributionControl'));
check('building ownership recovery', map.includes('enforceBuildingOwnership') && map.includes('ensureBuildingsVisible()') && map.includes('retryBuildings()') && map.includes('diff: false'));
check('observer zoom adaptation', map.includes('observerZoomScale') && map.includes('--observer-core') && cssV15.includes('--observer-core'));
check('late IRMAS CSS imported', main.includes("./irmas-map-parity.css") && cssParity.length > 50000);
check('v0.1.5 final overrides imported', main.includes("./astris-map-v015.css") && cssV15.length > 3000);
check('Starlink scene limit retained', settings.includes('limit: 12000') && layer.includes('MAX_DOM_MARKERS'));

for (const [name, css] of [['irmas-map-parity.css', cssParity], ['astris-map-v015.css', cssV15]]) {
  let balance = 0; let ok = true;
  for (const ch of css) { if (ch === '{') balance += 1; else if (ch === '}') { balance -= 1; if (balance < 0) ok = false; } }
  check(`${name} brace balance`, ok && balance === 0, `balance=${balance}`);
}

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
const failed = checks.filter(c => !c.ok);
console.log(`\nASTRIS v0.1.5 map-parity checks: ${checks.length - failed.length}/${checks.length}`);
if (failed.length) process.exitCode = 1;
